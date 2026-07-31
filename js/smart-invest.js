/**
 * Smart Invest Engine v2.0 — Portfolio Optimizer
 * ===============================================
 * Motor de inversión inteligente con:
 * - Knapsack time-based (≤2 segundos, sin límite fijo de items)
 * - Fees configurables (Steam, VAT, impuestos regionales)
 * - Stability Score + Confidence Score
 * - Scoring dinámico no-lineal
 * - Portfolio Optimizer (3 estrategias)
 * - ROI, ROD, Profit diario/semanal
 *
 * Modular, desacoplado, CSP-compliant.
 */
(function() {
  'use strict';

  const CSFLOAT_API = 'https://csfloat.com/api/v1/listings/price-list';
  const KNAPSACK_TIME_LIMIT_MS = 2000;
  const MAX_COMBINATIONS = 100000;

  // ======================================================================
  // FEES CONFIGURABLES
  // ======================================================================
  const DEFAULT_FEES = {
    steamFee: 0.15,        // 15% comisión Steam
    csfloatSellerFee: 0.02,// 2% comisión vendedor CSFloat
    vat: 0,                // 0% IVA (configurable)
    regionalTax: 0,        // 0% impuesto regional
    other: 0,              // Otros cargos
  };

  /**
   * SmartInvestEngine v2 — Portfolio Optimizer
   */
  class SmartInvestEngine {
    constructor() {
      this.budget = 0;
      this.candidates = [];
      this.rawPriceList = [];
      this.combinations = [];
      this.strategy = 'balanced'; // 'conservative' | 'balanced' | 'aggressive'
      this.strategyResults = { conservative: [], balanced: [], aggressive: [] };
      this.history = [];
      this.scanning = false;
      this.fees = { ...DEFAULT_FEES };
      this.scanProgress = { current: 0, total: 0, status: '' };
      this.onProgress = null;
      this.topOpportunities = [];
      this.favorites = [];
      this.priceHistory = {}; // Se carga desde localStorage en constructor
      this._loadPriceHistory();
    }

    // ======================================================================
    // CONFIGURACIÓN
    // ======================================================================

    setBudget(amount) {
      this.budget = Math.max(0, parseFloat(amount) || 0);
    }

    /**
     * Configura las fees.
     * @param {Object} f - { steamFee, csfloatSellerFee, vat, regionalTax, other }
     */
    setFees(f = {}) {
      this.fees.steamFee = f.steamFee ?? this.fees.steamFee;
      this.fees.csfloatSellerFee = f.csfloatSellerFee ?? this.fees.csfloatSellerFee;
      this.fees.vat = f.vat ?? this.fees.vat;
      this.fees.regionalTax = f.regionalTax ?? this.fees.regionalTax;
      this.fees.other = f.other ?? this.fees.other;
      this._saveFees();
    }

    /**
     * Carga las fees guardadas desde localStorage.
     */
    _loadFees() {
      try {
        const raw = StorageHelper.getItem('saintprofit_invest_fees');
        if (raw) {
          const saved = JSON.parse(raw);
          this.fees = { ...this.fees, ...saved };
        }
      } catch(e) {}
    }

    _saveFees() {
      try { StorageHelper.setItem('saintprofit_invest_fees', JSON.stringify(this.fees)); } catch(e) {}
    }

    _loadPriceHistory() {
      try {
        const raw = StorageHelper.getItem('saintprofit_price_history');
        if (raw) {
          const parsed = JSON.parse(raw);
          // Mantener solo datos de las últimas 24hs
          const cutoff = Date.now() - 86400000;
          for (const key of Object.keys(parsed)) {
            parsed[key] = parsed[key].filter(p => p.time > cutoff);
            if (parsed[key].length === 0) delete parsed[key];
          }
          this.priceHistory = parsed;
        }
      } catch(e) { this.priceHistory = {}; }
    }

    _savePriceHistory() {
      try {
        // Limitar a 50 items para no saturar localStorage
        const keys = Object.keys(this.priceHistory);
        if (keys.length > 50) {
          const trimmed = {};
          const sorted = keys.sort((a, b) => this.priceHistory[b].length - this.priceHistory[a].length);
          for (let i = 0; i < 50; i++) trimmed[sorted[i]] = this.priceHistory[sorted[i]];
          StorageHelper.setItem('saintprofit_price_history', JSON.stringify(trimmed));
        } else {
          StorageHelper.setItem('saintprofit_price_history', JSON.stringify(this.priceHistory));
        }
      } catch(e) {}
    }

    /**
     * Calcula el factor multiplicador total de fees.
     * Dinero recibido = steamPrice × (1 - steamFee - vat - regionalTax - other)
     */
    _getSteamMultiplier() {
      const totalFee = this.fees.steamFee + this.fees.vat + this.fees.regionalTax + this.fees.other;
      return Math.max(0, 1 - totalFee);
    }

    setProgressCallback(cb) {
      this.onProgress = cb;
    }

    // ======================================================================
    // PROGRESO
    // ======================================================================

    _emitProgress(current, total, status, phase) {
      this.scanProgress = { current, total, status, phase };
      if (this.onProgress) this.onProgress(this.scanProgress);
    }

    // ======================================================================
    // ADQUISICIÓN DE DATOS
    // ======================================================================

    async    fetchCandidates(options = {}) {
      this._loadFees();
      const {
        category = 'all',
        minProfit = 5,
        maxCsfloatPrice = 500,
        minCsfloatPrice = 0,
        limit = 200,
      } = options;

      this._emitProgress(0, 1, '📡 Obteniendo lista de precios de CSFloat...', 'csfloat');

      try {
        let priceList;
        if (window.CSFloatClient && typeof window.CSFloatClient.getPriceList === 'function') {
          // Centralizado: API key + caché compartida 30 min + cola anti-bloqueo
          priceList = await window.CSFloatClient.getPriceList();
        } else {
          const resp = await fetch(CSFLOAT_API);
          if (!resp.ok) throw new Error(`CSFloat error: ${resp.status}`);
          priceList = await resp.json();
        }
        this.rawPriceList = priceList;

        this._emitProgress(0, 1, `📦 ${priceList.length} items obtenidos. Aplicando filtros...`, 'filter');

        const minCents = minCsfloatPrice * 100;
        const maxCents = maxCsfloatPrice * 100;
        const steamMult = this._getSteamMultiplier();

        let candidates = [];
        for (const item of priceList) {
          const cat = this._detectCategory(item.market_hash_name);
          if (item.min_price < minCents || item.min_price > maxCents) continue;
          if (!item.quantity || item.quantity < 1) continue;
          if (category !== 'all' && cat !== category) continue;
          candidates.push({
            name: item.market_hash_name,
            priceCs: item.min_price / 100,
            quantity: item.quantity,
            score: (item.quantity || 1) * (1 / Math.max(item.min_price, 1)),
            category: cat,
          });
        }

        candidates.sort((a, b) => b.score - a.score);
        const toScan = candidates.slice(0, limit);
        this.candidates = [];

        this._emitProgress(0, toScan.length, `🔍 ${toScan.length} candidatos. Consultando Steam...`, 'steam');

        const BATCH_SIZE = 10;
        const STEAM_DELAY = 2000;
        const totalBatches = Math.ceil(toScan.length / BATCH_SIZE);

        for (let i = 0; i < toScan.length && this.scanning; i += BATCH_SIZE) {
          const batch = toScan.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;

          this._emitProgress(
            Math.min(i + BATCH_SIZE, toScan.length),
            toScan.length,
            `📊 Lote ${batchNum}/${totalBatches} | ${this.candidates.length} con profit`,
            'steam'
          );

          const promises = batch.map(async (item) => {
            const steamResult = await this._fetchSteamPrice(item.name);
            if (!steamResult) return null;

            // Profit REAL después de TODAS las fees
            const steamAfterAllFees = steamResult.price * steamMult;
            const profitUsd = steamAfterAllFees - item.priceCs;
            const profitPct = item.priceCs > 0 ? ((steamAfterAllFees - item.priceCs) / item.priceCs) * 100 : 0;

            if (profitPct < minProfit) return null;

            // Métricas de inversión
            const liquidity = this._calcLiquidity(item.quantity, steamResult.volume);
            const risk = this._calcRisk(item.quantity, steamResult.volume, profitPct);
            const velocity = this._calcVelocity(steamResult.volume, item.quantity);
            const volumeScore = this._calcVolumeScore(steamResult.volume);
            const stability = this._calcStability(item.name, item.priceCs);
            const confidence = this._calcConfidence(steamResult.volume, stability, liquidity, item.quantity);

            return {
              name: item.name,
              csfloatPrice: item.priceCs,
              steamPriceRaw: steamResult.price,
              steamPriceAfterFees: steamAfterAllFees,
              steamVolume: steamResult.volume,
              profitUsd,
              profitPct,
              quantity: item.quantity,
              category: item.category,
              liquidity,
              risk,
              velocity,
              volumeScore,
              stability,
              confidence,
              // Score se calcula con scoring no-lineal
              investScore: 0, // se completa abajo
            };
          });

          const results = await Promise.all(promises);
          results.filter(Boolean).forEach(r => {
            // Calcular score no-lineal
            r.investScore = this._calcNonLinearScore(r);
            this.candidates.push(r);
            this._registerTopOpportunity(r);
          });

          if (i + BATCH_SIZE < toScan.length && this.scanning) {
            await new Promise(r => setTimeout(r, STEAM_DELAY));
          }
        }

        this.candidates.sort((a, b) => b.investScore - a.investScore);

        // Persistir price history después del scan
        this._savePriceHistory();

        this._emitProgress(this.candidates.length, this.candidates.length,
          `✅ ${this.candidates.length} oportunidades encontradas`, 'done');

        return this.candidates;

      } catch (e) {
        this._emitProgress(0, 0, `❌ Error: ${e.message}`, 'error');
        throw e;
      }
    }

    // ======================================================================
    // STEAM PRICE
    // ======================================================================

    async _fetchSteamPrice(name) {
      // Centralizado: caché compartida + cola global + backoff 429.
      // Solo usa SteamClient (js/steam.js, cargado antes que smart-invest.js):
      // ya no hay caché ni fallback local.
      if (window.SteamClient && typeof window.SteamClient.getPrice === 'function') {
        return await window.SteamClient.getPrice(name);
      }
      return null;
    }

    // ======================================================================
    // CATEGORÍA
    // ======================================================================

    _detectCategory(name) {
      if (!name) return 'unknown';
      const n = name.toLowerCase();
      if (n.includes('sticker')) return 'stickers';
      if (n.includes('keychain') || n.includes('charm')) return 'keychains';
      if (n.includes('patch')) return 'patches';
      if (n.includes('music kit')) return 'music-kits';
      if (n.includes(' case') || n.endsWith(' case') || n.includes('capsule') || n.includes('package')) return 'containers';
      if (n.includes('gloves') || n.includes('wrap')) return 'gloves';
      const knives = ['knife','bayonet','karambit','m9 ','gut ','falchion','navaja','stiletto','talon','ursus','classic','paracord','survival','nomad','skeleton','bowie','butterfly','shadow daggers','flip '];
      if (knives.some(p => n.includes(p)) || n.includes('★')) return 'knives';
      if (n.includes('agent') || n.includes('operator')) return 'agents';
      if (n.includes('collectible') || n.includes('medal') || n.includes('coin')) return 'collectibles';
      if (n.includes('graffiti')) return 'graffiti';
      return 'skins';
    }

    // ======================================================================
    // MÉTRICAS DE INVERSIÓN
    // ======================================================================

    _calcLiquidity(csfloatStock, steamVolume) {
      const stockScore = Math.min(100, (csfloatStock || 0) * 5);
      const volumeScore = Math.min(100, (steamVolume || 0) / 10);
      return Math.round(stockScore * 0.4 + volumeScore * 0.6);
    }

    _calcRisk(csfloatStock, steamVolume, profitPct) {
      const baseRisk = 100 - this._calcLiquidity(csfloatStock, steamVolume);
      const profitRisk = profitPct > 50 ? 20 : profitPct > 30 ? 10 : 0;
      const lossRisk = profitPct < 0 ? 30 : 0;
      return Math.min(100, Math.round(baseRisk + profitRisk + lossRisk));
    }

    _calcVelocity(steamVolume, csfloatStock) {
      const v = (steamVolume || 0);
      const s = (csfloatStock || 1);
      if (v === 0) return 0;
      const ratio = v / s;
      if (ratio > 100) return 100;
      if (ratio > 50) return 90;
      if (ratio > 20) return 80;
      if (ratio > 10) return 70;
      if (ratio > 5) return 60;
      if (ratio > 2) return 40;
      if (ratio > 1) return 25;
      return 10;
    }

    _calcVolumeScore(steamVolume) {
      const v = (steamVolume || 0);
      if (v > 10000) return 100;
      if (v > 5000) return 90;
      if (v > 1000) return 80;
      if (v > 500) return 70;
      if (v > 100) return 60;
      if (v > 50) return 50;
      if (v > 10) return 30;
      if (v > 0) return 15;
      return 0;
    }

    // ======================================================================
    // STABILITY SCORE (0-100)
    // Basado en desviación estándar, volatilidad y cambios en 30 días.
    // ======================================================================

    _calcStability(marketName, currentPrice) {
      // Track price history for this item
      if (!this.priceHistory[marketName]) {
        this.priceHistory[marketName] = [];
      }
      this.priceHistory[marketName].push({
        price: currentPrice,
        time: Date.now(),
      });

      // Keep last 30 data points
      if (this.priceHistory[marketName].length > 30) {
        this.priceHistory[marketName] = this.priceHistory[marketName].slice(-30);
      }

      const prices = this.priceHistory[marketName];
      if (prices.length < 3) return 70; // Poco data → estable por defecto

      const vals = prices.map(p => p.price);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      const stdDev = Math.sqrt(variance);

      // Coeficiente de variación (CV) = stdDev / mean
      const cv = mean > 0 ? stdDev / mean : 0;

      // CV bajo → estable. CV alto → volátil.
      // Escala: CV < 0.05 → 95pts, CV > 0.5 → 10pts
      const stabilityScore = Math.round(Math.max(0, Math.min(100, 100 - (cv * 150))));

      return stabilityScore;
    }

    // ======================================================================
    // CONFIDENCE SCORE (0-100)
    // Basado en: ventas, estabilidad, liquidez, antigüedad, volumen.
    // ======================================================================

    _calcConfidence(steamVolume, stability, liquidity, csfloatStock) {
      // Volumen Steam: 0-30pts
      const volPts = Math.min(30, (steamVolume || 0) / 100);

      // Estabilidad: 0-25pts (peso reducido porque es estimada)
      const stabPts = (stability || 50) * 0.25;

      // Liquidez: 0-25pts
      const liqPts = (liquidity || 50) * 0.25;

      // Stock CSFloat: 0-10pts (más stock = más confianza en que existe)
      const stockPts = Math.min(10, (csfloatStock || 0) * 2);

      // Penalización si todo es 0
      const total = volPts + stabPts + liqPts + stockPts;
      const penalty = (steamVolume || 0) === 0 ? -10 : 0;

      return Math.round(Math.max(0, Math.min(100, total + penalty)));
    }

    // ======================================================================
    // SCORING DINÁMICO NO-LINEAL
    // ======================================================================

    /**
     * Scoring no-lineal.
     *
     * Principios:
     * - Si liquidity < 20: el score se penaliza fuerte (no se puede vender)
     * - Si confidence < 30: el score baja mucho (datos no confiables)
     * - Si profitPct > 50: se penaliza por posible error de precio
     * - Si todo está bien: el score es la combinación no-lineal de métricas
     *
     * Fórmula:
     *   rawScore = (profitScaled × 0.25)
     *            + (liquidity × 0.20)
     *            + (confidence × 0.20)
     *            + (stability × 0.15)
     *            + (velocity × 0.10)
     *            - (risk × 0.10)
     *
     *   Si liquidity < 20 → rawScore = rawScore × 0.3 (penalización severa)
     *   Si confidence < 30 → rawScore = rawScore × 0.5
     *   Si risk > 70 → rawScore = rawScore × 0.6
     *   Si profitPct > 50 → rawScore = rawScore × 0.7 (posible error)
     *
     * Esto hace que el scoring sea DINÁMICO y no lineal.
     */
    _calcNonLinearScore(item) {
      const profitScaled = Math.min(100, Math.max(0, (item.profitPct || 0) * 2));

      let score = (profitScaled * 0.25)
                + ((item.liquidity || 0) * 0.20)
                + ((item.confidence || 50) * 0.20)
                + ((item.stability || 50) * 0.15)
                + ((item.velocity || 0) * 0.10)
                - ((item.risk || 50) * 0.10);

      // Penalizaciones no-lineales
      if ((item.liquidity || 0) < 20) score *= 0.3;
      if ((item.confidence || 50) < 30) score *= 0.5;
      if ((item.risk || 50) > 70) score *= 0.6;
      if ((item.profitPct || 0) > 50) score *= 0.7;
      // Bono si liquidity es excelente
      if ((item.liquidity || 0) >= 80) score *= 1.1;
      // Bono si confidence es excelente
      if ((item.confidence || 50) >= 80) score *= 1.05;
      // Bono si profit es alto Y estable
      if ((item.profitPct || 0) >= 20 && (item.stability || 50) >= 70) score *= 1.08;

      return Math.round(Math.max(0, Math.min(100, score)));
    }

    // ======================================================================
    // MÉTRICAS: ROI, ROD, PROFIT DIARIO/SEMANAL
    // ======================================================================

    _calcEstSellDays(steamVolume, csfloatStock) {
      const v = (steamVolume || 0);
      const s = (csfloatStock || 1);
      if (v === 0) return 30;
      const dailySales = v / 30;
      if (dailySales <= 0) return 30;
      return Math.round(Math.max(1, Math.min(60, s / dailySales)));
    }

    _calcDailyProfit(profitPct, sellDays) {
      if (sellDays <= 0) return 0;
      return (profitPct / sellDays);
    }

    _calcWeeklyProfit(profitPct, sellDays) {
      if (sellDays <= 0) return 0;
      return (profitPct / (sellDays / 7));
    }

    /**
     * ROI = Return on Investment (profit / cost)
     * ROD = Return on Days (ROI / días estimados)
     */
    _calcROI(profitUsd, cost) {
      if (cost <= 0) return 0;
      return (profitUsd / cost) * 100;
    }

    _calcROD(profitUsd, cost, sellDays) {
      const roi = this._calcROI(profitUsd, cost);
      if (sellDays <= 0) return 0;
      return (roi / sellDays);
    }

    _calcLiquidityStars(liquidity) {
      if (liquidity >= 80) return 5;
      if (liquidity >= 60) return 4;
      if (liquidity >= 40) return 3;
      if (liquidity >= 20) return 2;
      return 1;
    }

    // ======================================================================
    // TOP OPPORTUNITIES
    // ======================================================================

    _registerTopOpportunity(item) {
      this.topOpportunities.push({
        name: item.name,
        profitPct: item.profitPct,
        profitUsd: item.profitUsd,
        investScore: item.investScore,
        confidence: item.confidence,
        stability: item.stability,
        liquidity: item.liquidity,
        csfloatPrice: item.csfloatPrice,
        steamPrice: item.steamPriceAfterFees,
        date: Date.now(),
      });
      if (this.topOpportunities.length > 100) {
        this.topOpportunities = this.topOpportunities.slice(0, 100);
      }
      this.topOpportunities.sort((a, b) => b.investScore - a.investScore);
    }

    getTopOpportunities(limit = 10) {
      return this.topOpportunities.slice(0, limit);
    }

    // ======================================================================
    // KNAPSACK TIME-BASED
    // ======================================================================

    /**
     * Knapsack con límite de TIEMPO (2s), no de cantidad de items.
     *
     * Estrategia:
     * 1. Ordena candidatos por score descendente
     * 2. Genera combinaciones iterativamente empezando por las más prometedoras
     * 3. Cada combinación se evalúa y se inserta en orden de score
     * 4. Al alcanzar el límite de tiempo, devuelve la mejor combinación
     * 5. Si encuentra una combinación mejor, reemplaza la peor de las top N
     *
     * @param {Object} options
     * @param {number} options.timeLimitMs - Límite de tiempo (default 2000ms)
     * @param {number} options.topN - Top N resultados (default 10)
     * @param {number} options.minScore - Score mínimo (default 30)
     * @param {string} options.strategy - Estrategia: 'conservative' | 'balanced' | 'aggressive'
     * @returns {Array} Combinaciones encontradas
     */
    solveKnapsack(options = {}) {
      const {
        timeLimitMs = KNAPSACK_TIME_LIMIT_MS,
        topN = 10,
        minScore = 30,
        strategy = 'balanced',
      } = options;

      this.strategy = strategy;

      if (this.budget <= 0 || this.candidates.length === 0) {
        this.combinations = [];
        return [];
      }

      // Filtrar candidatos según estrategia
      let affordable = this.candidates.filter(c => c.csfloatPrice <= this.budget);
      if (affordable.length === 0) return [];

      if (strategy === 'conservative') {
        affordable = affordable.filter(c => (c.liquidity || 0) > 50 && (c.risk || 100) < 40 && (c.confidence || 0) > 40);
        // Fallback progresivo
        if (affordable.length === 0) {
          affordable = this.candidates.filter(c => c.csfloatPrice <= this.budget && (c.liquidity || 0) > 30 && (c.risk || 100) < 60);
        }
        if (affordable.length === 0) {
          affordable = this.candidates.filter(c => c.csfloatPrice <= this.budget && (c.liquidity || 0) > 10);
        }
      } else if (strategy === 'aggressive') {
        affordable = affordable.filter(c => (c.profitPct || 0) > 10 && (c.liquidity || 0) > 5);
        if (affordable.length === 0) {
          affordable = this.candidates.filter(c => c.csfloatPrice <= this.budget && (c.profitPct || 0) > 5);
        }
      }
      // balanced: sin filtro extra (usa el scoring no-lineal por defecto)

      // Ordenar por score descendente (los mejores primero)
      affordable.sort((a, b) => b.investScore - a.investScore);

      // Limitar a 80 items para time-based (con 80 items hay ~80M combos de 4 items,
      // el timeout de 2s corta antes)
      const subset = affordable.slice(0, 80);

      const startTime = Date.now();
      const combinations = [];

      this._emitProgress(0, subset.length, `🧮 Optimizando (${strategy})... Timeout: ${timeLimitMs}ms`, 'knapsack');

      // 1 ITEM: siempre los evaluamos, es rápido
      for (let a = 0; a < subset.length && this.scanning; a++) {
        if (Date.now() - startTime > timeLimitMs) break;
        if (subset[a].csfloatPrice <= this.budget) {
          this._addCombination(combinations, [subset[a]], subset[a].csfloatPrice, strategy);
        }
      }

      // 2 ITEMS
      for (let a = 0; a < subset.length && this.scanning; a++) {
        if (Date.now() - startTime > timeLimitMs) break;
        for (let b = a + 1; b < subset.length && this.scanning; b++) {
          if (Date.now() - startTime > timeLimitMs) break;
          const cost = subset[a].csfloatPrice + subset[b].csfloatPrice;
          if (cost <= this.budget) {
            this._addCombination(combinations, [subset[a], subset[b]], cost, strategy);
          }
        }
      }

      // 3 ITEMS
      for (let a = 0; a < subset.length && this.scanning; a++) {
        if (Date.now() - startTime > timeLimitMs) break;
        for (let b = a + 1; b < subset.length && this.scanning; b++) {
          if (Date.now() - startTime > timeLimitMs) break;
          for (let c = b + 1; c < subset.length && this.scanning; c++) {
            if (Date.now() - startTime > timeLimitMs) break;
            const cost = subset[a].csfloatPrice + subset[b].csfloatPrice + subset[c].csfloatPrice;
            if (cost <= this.budget) {
              this._addCombination(combinations, [subset[a], subset[b], subset[c]], cost, strategy);
            }
          }
        }
      }

      // 4+ ITEMS: iterativo, mientras haya tiempo
      let depth = 4;
      while (depth <= 12 && this.scanning && Date.now() - startTime < timeLimitMs) {
        const indices = new Array(depth).fill(0);
        for (let i = 0; i < depth; i++) indices[i] = i;
        let depthIterations = 0;

        while (indices[0] <= subset.length - depth && this.scanning && depthIterations < 50000) {
          if (Date.now() - startTime > timeLimitMs) break;
          depthIterations++;

          let cost = 0;
          for (let i = 0; i < depth; i++) cost += subset[indices[i]].csfloatPrice;
          if (cost <= this.budget) {
            const comboItems = indices.map(idx => subset[idx]);
            this._addCombination(combinations, comboItems, cost, strategy);
          }

          // Avanzar índices (combinatoria sin repetición)
          let idx = depth - 1;
          while (idx >= 0 && indices[idx] >= subset.length - (depth - idx)) idx--;
          if (idx < 0) break;
          indices[idx]++;
          for (let j = idx + 1; j < depth; j++) indices[j] = indices[j - 1] + 1;
        }
        depth++;
      }

      // Ordenar por score descendente
      combinations.sort((a, b) => b.score - a.score);

      // Aplicar filtro por estrategia al score mínimo
      const minScoreMap = { conservative: 40, balanced: 30, aggressive: 20 };
      const effectiveMinScore = minScoreMap[strategy] || minScore;
      const filtered = combinations.filter(c => c.score >= effectiveMinScore);

      this.combinations = filtered.slice(0, topN);

      const elapsed = Date.now() - startTime;
      this._emitProgress(filtered.length, filtered.length,
        `✅ ${filtered.length} combos en ${(elapsed / 1000).toFixed(1)}s (${strategy})`, 'done');

      return this.combinations;
    }

    _addCombination(arr, items, totalCost, strategy) {
      const totalProfitUsd = items.reduce((s, i) => s + i.profitUsd, 0);
      let weightedProfitPct = 0;
      for (const item of items) {
        weightedProfitPct += item.profitPct * (item.csfloatPrice / totalCost);
      }

      const avgScore = Math.round(items.reduce((s, i) => s + i.investScore, 0) / items.length);
      const avgLiquidity = Math.round(items.reduce((s, i) => s + i.liquidity, 0) / items.length);
      const avgRisk = Math.round(items.reduce((s, i) => s + i.risk, 0) / items.length);
      const avgVelocity = Math.round(items.reduce((s, i) => s + i.velocity, 0) / items.length);
      const avgConfidence = Math.round(items.reduce((s, i) => s + (i.confidence || 50), 0) / items.length);
      const avgStability = Math.round(items.reduce((s, i) => s + (i.stability || 50), 0) / items.length);

      const estSellDays = Math.max(...items.map(i => this._calcEstSellDays(i.steamVolume, i.quantity)));
      const dailyProfit = items.reduce((s, i) => {
        const days = this._calcEstSellDays(i.steamVolume, i.quantity);
        return s + this._calcDailyProfit(i.profitPct, days);
      }, 0) / items.length;
      const weeklyProfit = items.reduce((s, i) => {
        const days = this._calcEstSellDays(i.steamVolume, i.quantity);
        return s + this._calcWeeklyProfit(i.profitPct, days);
      }, 0) / items.length;

      const roi = this._calcROI(totalProfitUsd, totalCost);
      const rod = this._calcROD(totalProfitUsd, totalCost, estSellDays);

      const combo = {
        items: items.map(i => ({
          name: i.name,
          csfloatPrice: i.csfloatPrice,
          steamPriceAfterFees: i.steamPriceAfterFees,
          steamPriceRaw: i.steamPriceRaw,
          profitUsd: i.profitUsd,
          profitPct: i.profitPct,
          investScore: i.investScore,
          liquidity: i.liquidity,
          liquidityStars: this._calcLiquidityStars(i.liquidity),
          risk: i.risk,
          velocity: i.velocity,
          confidence: i.confidence,
          stability: i.stability,
          steamVolume: i.steamVolume,
          quantity: i.quantity,
          category: i.category,
        })),
        totalCost,
        budgetUsed: totalCost,
        budgetRemaining: this.budget - totalCost,
        totalProfitUsd,
        profitPct: weightedProfitPct,
        score: avgScore,
        liquidity: avgLiquidity,
        risk: avgRisk,
        velocity: avgVelocity,
        confidence: avgConfidence,
        stability: avgStability,
        estSellDays,
        dailyProfit,
        weeklyProfit,
        roi,
        rod,
        itemCount: items.length,
        strategy,
      };

      arr.push(combo);
    }

    // ======================================================================
    // PORTFOLIO OPTIMIZER — 3 ESTRATEGIAS
    // ======================================================================

    /**
     * Resuelve el knapsack para las 3 estrategias y devuelve los resultados.
     *
     * 🟢 Conservadora: máxima liquidez, menor riesgo.
     * 🟡 Equilibrada: mejor relación riesgo/beneficio.
     * 🔴 Agresiva: máximo profit esperado.
     *
     * @param {Object} options - Opciones (timeLimitMs, topN, etc.)
     * @returns {Object} { conservative: [], balanced: [], aggressive: [] }
     */
    solveAllStrategies(options = {}) {
      const timePerStrategy = Math.floor((options.timeLimitMs || KNAPSACK_TIME_LIMIT_MS) / 3);

      this.strategyResults.conservative = this.solveKnapsack({
        ...options,
        timeLimitMs: timePerStrategy,
        strategy: 'conservative',
      });

      this.strategyResults.balanced = this.solveKnapsack({
        ...options,
        timeLimitMs: timePerStrategy,
        strategy: 'balanced',
      });

      this.strategyResults.aggressive = this.solveKnapsack({
        ...options,
        timeLimitMs: timePerStrategy,
        strategy: 'aggressive',
      });

      // La por defecto es balanced
      this.combinations = this.strategyResults.balanced;

      return this.strategyResults;
    }

    // ======================================================================
    // RECOMENDACIONES
    // ======================================================================

    getRecommendations() {
      if (this.candidates.length > 0 && this.budget > 0 && this.combinations.length === 0) {
        this.solveKnapsack();
      }

      if (this.combinations.length === 0) {
        return {
          bestCombo: null,
          alternatives: [],
          strategies: this.strategyResults,
          stats: { totalCandidates: this.candidates.length, budget: this.budget },
        };
      }

      const best = this.combinations[0];
      return {
        bestCombo: best,
        alternatives: this.combinations.slice(1, 4),
        strategies: this.strategyResults,
        stats: {
          totalCandidates: this.candidates.length,
          budget: this.budget,
          bestScore: best.score,
          bestProfitPct: best.profitPct,
          bestProfitUsd: best.totalProfitUsd,
          bestROI: best.roi,
          bestROD: best.rod,
          bestDaily: best.dailyProfit,
          totalCombinations: this.combinations.length,
        },
      };
    }

    // ======================================================================
    // COMPOUND CALCULATOR
    // ======================================================================

    calculateCompound(initialCapital, avgProfitPct, operations) {
      const capital = parseFloat(initialCapital) || 0;
      const profit = parseFloat(avgProfitPct) || 0;
      const ops = parseInt(operations) || 0;

      if (capital <= 0 || profit <= 0 || ops <= 0) {
        return { finalCapital: 0, totalProfit: 0, totalProfitPct: 0, history: [] };
      }

      const rate = 1 + (profit / 100);
      const finalCapital = capital * Math.pow(rate, ops);
      const totalProfit = finalCapital - capital;
      const totalProfitPct = ((finalCapital - capital) / capital) * 100;

      const history = [];
      let current = capital;
      for (let i = 1; i <= ops; i++) {
        current = current * rate;
        history.push({ operation: i, capital: current, profit: current - capital, profitPct: ((current - capital) / capital) * 100 });
      }

      return {
        finalCapital: Math.round(finalCapital * 100) / 100,
        totalProfit: Math.round(totalProfit * 100) / 100,
        totalProfitPct: Math.round(totalProfitPct * 100) / 100,
        history,
      };
    }

    // ======================================================================
    // FAVORITOS + ALERTAS
    // ======================================================================

    addFavorite(marketName, currentPrice) {
      if (!this.favorites.find(f => f.name === marketName)) {
        this.favorites.push({
          name: marketName,
          addedAt: Date.now(),
          lastPrice: currentPrice || null,
          historicalLow: currentPrice || null,
        });
        this._saveFavorites();
      }
    }

    removeFavorite(marketName) {
      this.favorites = this.favorites.filter(f => f.name !== marketName);
      this._saveFavorites();
    }

    _saveFavorites() {
      try { StorageHelper.setItem('saintprofit_invest_favorites', JSON.stringify(this.favorites)); } catch(e) {}
    }

    _loadFavorites() {
      try {
        const raw = StorageHelper.getItem('saintprofit_invest_favorites');
        if (raw) this.favorites = JSON.parse(raw);
      } catch(e) { this.favorites = []; }
    }

    checkPriceAlerts(priceList) {
      const alerts = [];
      for (const fav of this.favorites) {
        const item = priceList.find(p => p.market_hash_name === fav.name);
        if (!item || !fav.lastPrice) continue;
        const currentPrice = item.min_price / 100;
        const drop = ((fav.lastPrice - currentPrice) / fav.lastPrice) * 100;
        if (drop >= 15) {
          alerts.push({ name: fav.name, oldPrice: fav.lastPrice, newPrice: currentPrice, dropPct: Math.round(drop) });
        }
        if (!fav.historicalLow || currentPrice < fav.historicalLow) fav.historicalLow = currentPrice;
        fav.lastPrice = currentPrice;
      }
      this._saveFavorites();
      return alerts;
    }

    // ======================================================================
    // HISTORIAL
    // ======================================================================

    saveToHistory(filters = {}) {
      const best = this.combinations[0];
      const entry = {
        id: 'inv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date: Date.now(),
        label: new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }),
        budget: this.budget,
        strategy: this.strategy,
        filters,
        stats: {
          candidates: this.candidates.length,
          combinations: this.combinations.length,
          bestScore: best ? best.score : 0,
          bestProfitPct: best ? best.profitPct : 0,
          bestProfitUsd: best ? best.totalProfitUsd : 0,
          bestROI: best ? best.roi : 0,
          bestROD: best ? best.rod : 0,
        },
        topCombinations: this.combinations.slice(0, 7).map(c => ({
          score: c.score,
          profitPct: c.profitPct,
          profitUsd: c.totalProfitUsd,
          roi: c.roi,
          rod: c.rod,
          cost: c.totalCost,
          items: c.items.map(i => i.name),
          itemCount: c.itemCount,
          strategy: c.strategy,
        })),
        results: this.combinations,
      };

      this.history.unshift(entry);
      if (this.history.length > 20) this.history = this.history.slice(0, 20);
      this._saveHistory();
    }

    _saveHistory() {
      try { StorageHelper.setItem('saintprofit_invest_history', JSON.stringify(this.history)); } catch(e) {}
    }

    loadHistory() {
      try {
        const raw = StorageHelper.getItem('saintprofit_invest_history');
        this.history = raw ? JSON.parse(raw) : [];
      } catch(e) { this.history = []; }
      return this.history;
    }

    deleteHistoryEntry(id) {
      this.history = this.history.filter(h => h.id !== id);
      this._saveHistory();
    }

    restoreFromHistory(entry) {
      if (!entry || !entry.results) return false;
      this.combinations = entry.results || [];
      this.budget = entry.budget || this.budget;
      this.strategy = entry.strategy || 'balanced';
      return true;
    }

    clearHistory() {
      this.history = [];
      this._saveHistory();
    }

    // ======================================================================
    // SCAN CONTROL
    // ======================================================================

    async runFullScan(options = {}) {
      if (this.scanning) return [];
      this.scanning = true;

      try {
        await this.fetchCandidates(options);
        if (!this.scanning) {
          this._emitProgress(0, 0, '⏹️ Escaneo detenido', 'stopped');
          return [];
        }

        // Resolver las 3 estrategias
        const results = this.solveAllStrategies(options);

        // Guardar con la estrategia por defecto
        if (results.balanced.length > 0) {
          this.saveToHistory(options);
        }

        return results;
      } catch (e) {
        this._emitProgress(0, 0, `❌ Error: ${e.message}`, 'error');
        throw e;
      } finally {
        this.scanning = false;
        if (typeof window.updateCacheIndicator === 'function') window.updateCacheIndicator();
      }
    }

    stopScan() {
      this.scanning = false;
    }
  }

  // ======================================================================
  // EXPORT
  // ======================================================================
  window.SmartInvestEngine = SmartInvestEngine;
})();

// ======================================================================
// ===== UI INTEGRATION v2 =====
// ======================================================================
(function() {
  'use strict';

  let engine = null;
  let scanTimerInterval = null;
  let scanStartTime = null;

  function formatTimer(ms) {
    const totalSec = Math.floor(ms / 1000);
    return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
  }

  function $(id) { return document.getElementById(id); }

  function showToast(msg, type) {
    if (typeof window._spToast === 'function') window._spToast(msg, type);
  }

  function getScoreClass(score) {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'fair';
    return 'low';
  }

  function getLiquidityStars(stars) {
    if (!stars || stars <= 0) return '';
    return `<span class="inv-liquidity"><span class="star-filled">${'★'.repeat(stars)}</span><span class="star-empty">${'☆'.repeat(5 - stars)}</span></span>`;
  }

  function renderInvestCombos() {
    const container = $('invResultsContainer');
    const comboCount = $('invComboCount');
    const bestScore = $('invBestScore');
    const bestProfit = $('invBestProfit');
    const candidateCount = $('invCandidateCount');
    if (!container || !engine) return;

    const combos = engine.combinations || [];
    const candidates = engine.candidates || [];
    if (candidateCount) candidateCount.textContent = candidates.length;
    if (comboCount) comboCount.textContent = combos.length;
    if (bestScore && combos.length > 0) bestScore.textContent = combos[0].score;
    if (bestProfit && combos.length > 0) bestProfit.textContent = `$${(combos[0].totalProfitUsd || 0).toFixed(2)}`;

    if (combos.length === 0) {
      container.innerHTML = `<div class="empty-state" id="invTutorial" style="padding:14px 10px">
        <span class="empty-icon" style="font-size:1.6rem;display:block;margin-bottom:4px">🧠</span>
        <h3 style="margin-bottom:6px;font-size:0.9rem">Smart Invest — Guía Rápida</h3>
        <div style="text-align:left;font-size:0.7rem;line-height:1.4;color:var(--text-secondary)">

          <div style="background:rgba(255,107,53,0.06);border:1px solid rgba(255,107,53,0.1);border-radius:6px;padding:6px 8px;margin-bottom:8px">
            <p style="font-size:0.65rem;color:var(--text-secondary);margin:0">
              <strong style="color:var(--accent-1)">🎯 ¿Qué hace?</strong> Decís tu saldo en Steam y el motor busca las mejores skins para comprar en CSFloat y revender, maximizando tu ganancia.
            </p>
          </div>

          <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px">
            <div style="display:flex;align-items:flex-start;gap:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:6px 8px">
              <span style="font-size:1rem;line-height:1;flex-shrink:0;margin-top:1px">💰</span>
              <div style="flex:1;min-width:0">
                <strong style="color:var(--text-primary);font-size:0.7rem">1. Ingresá tu saldo</strong>
                <p style="margin:1px 0 0;font-size:0.62rem;color:var(--text-muted)">En <strong style="color:var(--accent-1)">Presupuesto</strong> poné tu dinero disponible. Ej: <strong style="color:var(--profit-green)">$37.52</strong></p>
              </div>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:6px 8px">
              <span style="font-size:1rem;line-height:1;flex-shrink:0;margin-top:1px">🔍</span>
              <div style="flex:1;min-width:0">
                <strong style="color:var(--text-primary);font-size:0.7rem">2. Escaneá</strong>
                <p style="margin:1px 0 0;font-size:0.62rem;color:var(--text-muted)">Apretá <strong style="color:var(--accent-1)">Escanear</strong>. Busca skins en CSFloat y compara con Steam.</p>
              </div>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:6px 8px">
              <span style="font-size:1rem;line-height:1;flex-shrink:0;margin-top:1px">📊</span>
              <div style="flex:1;min-width:0">
                <strong style="color:var(--text-primary);font-size:0.7rem">3. Elegí estrategia</strong>
                <p style="margin:1px 0 0;font-size:0.62rem;color:var(--text-muted)">Probá <strong style="color:var(--profit-green)">Conservadora</strong>, <strong style="color:var(--profit-yellow)">Equilibrada</strong> o <strong style="color:var(--profit-red)">Agresiva</strong>.</p>
              </div>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:6px 8px">
              <span style="font-size:1rem;line-height:1;flex-shrink:0;margin-top:1px">⭐</span>
              <div style="flex:1;min-width:0">
                <strong style="color:var(--text-primary);font-size:0.7rem">4. Invertí</strong>
                <p style="margin:1px 0 0;font-size:0.62rem;color:var(--text-muted)">La ⭐ <strong style="color:var(--accent-1)">ÓPTIMA</strong> es la mejor. Clic en cada skin para abrir en CSFloat.</p>
              </div>
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.02);border-radius:6px;padding:6px 8px;margin-bottom:8px;border:1px solid rgba(255,255,255,0.04)">
            <p style="font-size:0.65rem;color:var(--text-primary);font-weight:700;margin-bottom:4px">🎮 Las 3 Estrategias</p>
            <div style="display:flex;flex-direction:column;gap:3px">
              <div style="display:flex;align-items:center;gap:5px;font-size:0.62rem">
                <span style="color:var(--profit-green);font-size:0.8rem">🟢</span>
                <span><strong style="color:var(--text-primary)">Conservadora</strong> — <span style="color:var(--text-muted)">vendés rápido, poco riesgo, ideal para empezar</span></span>
              </div>
              <div style="display:flex;align-items:center;gap:5px;font-size:0.62rem">
                <span style="color:var(--profit-yellow);font-size:0.8rem">🟡</span>
                <span><strong style="color:var(--text-primary)">Equilibrada</strong> — <span style="color:var(--text-muted)">mejor balance riesgo/beneficio (recomendada)</span></span>
              </div>
              <div style="display:flex;align-items:center;gap:5px;font-size:0.62rem">
                <span style="color:var(--profit-red);font-size:0.8rem">🔴</span>
                <span><strong style="color:var(--text-primary)">Agresiva</strong> — <span style="color:var(--text-muted)">máximo profit posible, aceptando más riesgo</span></span>
              </div>
            </div>
          </div>

          <div style="background:rgba(0,212,170,0.04);border:1px solid rgba(0,212,170,0.08);border-radius:6px;padding:6px 8px;margin-bottom:8px">
            <p style="font-size:0.65rem;color:var(--profit-green);font-weight:700;margin-bottom:4px">📈 Entendé los números</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 6px;font-size:0.58rem;color:var(--text-muted)">
              <span><strong style="color:var(--text-primary)">Profit $</strong> → Ganancia en dólares</span>
              <span><strong style="color:var(--text-primary)">Profit %</strong> → Ganancia porcentual</span>
              <span><strong style="color:var(--text-primary)">ROI</strong> → Retorno de inversión</span>
              <span><strong style="color:var(--text-primary)">ROD</strong> → Retorno por día</span>
              <span><strong style="color:var(--text-primary)">Score</strong> → Puntaje general (0-100)</span>
              <span><strong style="color:var(--text-primary)">Confianza</strong> → Qué tan seguro es</span>
              <span><strong style="color:var(--text-primary)">Liquidez</strong> → ⭐ qué tan fácil se vende</span>
              <span><strong style="color:var(--text-primary)">Riesgo</strong> → Qué tan riesgoso es</span>
            </div>
          </div>

          <div style="background:linear-gradient(135deg,rgba(255,107,53,0.06),rgba(0,212,170,0.04));border:1px solid rgba(255,107,53,0.1);border-radius:6px;padding:6px 8px">
            <p style="font-size:0.62rem;color:var(--accent-1);font-weight:700;margin-bottom:3px">🎯 Ejemplo real</p>
            <p style="font-size:0.65rem;color:var(--text-secondary);margin:0">
              Con <strong style="color:var(--text-primary)">$37.52</strong> → comprar <strong style="color:var(--text-primary)">3 skins</strong> de $12.50 c/u.
              Profit: <strong style="color:var(--profit-green)">+$2.81 (8%)</strong> en ~3 días = <strong style="color:var(--accent-1)">2.7% por día</strong>.
            </p>
          </div>

          <p style="margin-top:6px;font-size:0.58rem;color:var(--text-muted);text-align:center">💡 Clic en skin para abrir CSFloat · ⭐ guarda favoritos</p>
        </div>
      </div>`;
      return;
    }

    const best = combos[0];
    const stratLabel = { conservative: '🟢 Conservadora', balanced: '🟡 Equilibrada', aggressive: '🔴 Agresiva' };

    let html = `
      <div class="inv-recommendation-banner">
        <div class="banner-title">🤖 ${stratLabel[engine.strategy] || '🟡 Equilibrada'} · Recomendación</div>
        <div class="banner-text">
          Con <strong>$${(engine.budget || 0).toFixed(2)}</strong> → Profit esperado: <strong style="color:var(--profit-green)">${(best.profitPct || 0).toFixed(1)}%</strong>
          · ROI: <strong>${(best.roi || 0).toFixed(1)}%</strong> · ROD: <strong>${(best.rod || 0).toFixed(2)}%/día</strong>
          · Score: <strong style="color:var(--accent-1)">${best.score}/100</strong>
          · Confianza: <strong>${best.confidence || 0}%</strong>
        </div>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:8px">
        <button class="btn-icon" data-inv-strategy="conservative" style="flex:1;justify-content:center;padding:6px;font-size:0.65rem;border-color:${engine.strategy === 'conservative' ? 'var(--profit-green)' : 'var(--border)'}">🟢 Cons.</button>
        <button class="btn-icon" data-inv-strategy="balanced" style="flex:1;justify-content:center;padding:6px;font-size:0.65rem;border-color:${engine.strategy === 'balanced' ? 'var(--profit-yellow)' : 'var(--border)'}">🟡 Equi.</button>
        <button class="btn-icon" data-inv-strategy="aggressive" style="flex:1;justify-content:center;padding:6px;font-size:0.65rem;border-color:${engine.strategy === 'aggressive' ? 'var(--profit-red)' : 'var(--border)'}">🔴 Agre.</button>
      </div>
    `;

    const labels = ['⭐ ÓPTIMA', '🥈 Opción B', '🥉 Opción C', '4', '5', '6', '7', '8', '9', '10'];

    combos.forEach((combo, idx) => {
      const isBest = idx === 0;
      const label = labels[idx] || `#${idx + 1}`;
      const scoreClass = getScoreClass(combo.score);

      html += `
        <div class="inv-combo-card ${isBest ? 'best' : ''}">
          <div class="inv-combo-header">
            <span class="inv-combo-rank">${label}</span>
            <div class="inv-combo-score">
              <span class="score-label">Score</span>
              <span class="inv-score-circle ${scoreClass}">${combo.score}</span>
            </div>
          </div>
          <div class="inv-combo-metrics" style="grid-template-columns:1fr 1fr 1fr 1fr">
            <div class="inv-combo-metric">
              <span class="metric-value green">+$${(combo.totalProfitUsd || 0).toFixed(2)}</span>
              <span class="metric-label">Profit \$</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value gold">${(combo.profitPct || 0).toFixed(1)}%</span>
              <span class="metric-label">Profit %</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:var(--accent-3)">$${(combo.budgetUsed || combo.totalCost || 0).toFixed(2)}</span>
              <span class="metric-label">Costo</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:var(--text-secondary)">$${(combo.budgetRemaining || 0).toFixed(2)}</span>
              <span class="metric-label">Restante</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value green">${(combo.roi || 0).toFixed(1)}%</span>
              <span class="metric-label">ROI</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:var(--accent-2)">${(combo.rod || 0).toFixed(2)}%/d</span>
              <span class="metric-label">ROD</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value green">${(combo.dailyProfit || 0).toFixed(1)}%/d</span>
              <span class="metric-label">Profit/día</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value green">${(combo.weeklyProfit || 0).toFixed(1)}%/sem</span>
              <span class="metric-label">Profit/sem</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:var(--text-secondary)">${combo.estSellDays || '—'}d</span>
              <span class="metric-label">Tiempo</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:var(--text-secondary)">${getLiquidityStars(combo.liquidity >= 60 ? 4 : combo.liquidity >= 40 ? 3 : combo.liquidity >= 20 ? 2 : 1)}</span>
              <span class="metric-label">Liquidez</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:${(combo.confidence || 0) >= 70 ? 'var(--profit-green)' : (combo.confidence || 0) >= 40 ? 'var(--profit-yellow)' : 'var(--profit-red)'}">${combo.confidence || 0}%</span>
              <span class="metric-label">Confianza</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:${combo.risk >= 50 ? 'var(--profit-red)' : combo.risk >= 30 ? 'var(--profit-yellow)' : 'var(--profit-green)'}">${combo.risk}</span>
              <span class="metric-label">Riesgo</span>
            </div>
          </div>
          <div class="inv-combo-items">
            ${combo.items.map(item => {
              const nm = item.name.replace(/"/g, '&quot;');
              const isFav = engine && engine.favorites.find(f => f.name === item.name);
              return `<div class="inv-combo-item">
                <span class="inv-score-circle ${getScoreClass(item.investScore)}" style="width:20px;height:20px;font-size:0.5rem">${item.investScore}</span>
                <span class="item-name">${item.name}</span>
                <span class="item-price">$${(item.csfloatPrice || 0).toFixed(2)}</span>
                <span class="item-profit">+$${(item.profitUsd || 0).toFixed(2)}</span>
                <span class="inv-fav-btn" data-inv-fav="${nm}" style="cursor:pointer;font-size:0.7rem;margin-left:4px;${isFav ? 'opacity:1;color:#ffd700' : 'opacity:0.4'};transition:opacity 0.2s" title="${isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}">${isFav ? '★' : '☆'}</span>
              </div>`;
            }).join('')}
          </div>
          ${combo.confidence ? `
          <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.04)">
            <div style="display:flex;align-items:center;gap:8px;font-size:0.55rem;color:var(--text-muted)">
              <span>Stability: ${combo.stability || 0}</span>
              <span>·</span>
              <span>Confidence: ${combo.confidence || 0}</span>
              <span>·</span>
              <span>${stratLabel[combo.strategy] || '🟡 Equilibrada'}</span>
            </div>
          </div>` : ''}
        </div>`;
    });

    container.innerHTML = html;
  }

  async function startInvestScan() {
    if (!engine) return;
    if (engine.scanning) { stopInvestScan(); return; }

    const scanBtn = $('invScanBtn');
    const progress = $('invProgress');
    const statusEl = $('invStatus');
    const progressFill = $('invProgressFill');
    const scanCounter = $('invScanCounter');
    const scanTotal = $('invScanTotal');
    const scanTimer = $('invScanTimer');
    const container = $('invResultsContainer');

    if (scanBtn) { scanBtn.textContent = '⏹ Detener'; scanBtn.classList.add('scanning'); }
    if (progress) progress.classList.add('show');
    if (container) container.innerHTML = '<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">📡</span><h3>Cargando...</h3><p>Obteniendo lista de precios de CSFloat</p></div>';

    const budget = parseFloat($('invBudget')?.value || '0');
    const category = $('invCategory')?.value || 'all';
    const minProfit = parseInt($('invMinProfit')?.value || '5');
    const minPrice = parseFloat($('invMinPrice')?.value || '0');
    const maxPrice = parseFloat($('invMaxPrice')?.value || '500');
    const limit = parseInt($('invLimit')?.value || '50');

    engine.setBudget(budget);

    if (scanTimer) scanTimer.textContent = '0:00';
    if (scanTimerInterval) { clearInterval(scanTimerInterval); scanTimerInterval = null; }
    scanTimerInterval = setInterval(() => { if (scanTimer) scanTimer.textContent = formatTimer(Date.now() - scanStartTime); }, 1000);
    scanStartTime = Date.now();

    engine.setProgressCallback((p) => {
      if (statusEl) statusEl.textContent = p.status;
      if (progressFill) progressFill.style.width = `${Math.min(100, (p.current / Math.max(p.total, 1)) * 90)}%`;
      if (scanCounter) scanCounter.textContent = p.current;
      if (scanTotal) scanTotal.textContent = p.total;
    });

    try {
      await engine.runFullScan({ category, minProfit, minCsfloatPrice: minPrice, maxCsfloatPrice: maxPrice, limit });
      renderInvestCombos();

      if (statusEl) statusEl.textContent = `✅ ${engine.combinations.length} combinaciones (${engine.strategy})`;
      if (progressFill) progressFill.style.width = '100%';

      if (engine.candidates.length === 0) {
        if (container) container.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">😕</span><h3>Sin oportunidades</h3><p>No se encontraron candidatos con profit.</p></div>`;
        showToast('😕 Sin oportunidades de inversión', 'info');
      } else if (engine.combinations.length === 0) {
        if (container) container.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">🧮</span><h3>Sin combinaciones válidas</h3><p>Hay ${engine.candidates.length} candidatos pero ninguno genera combinaciones óptimas con $${budget.toFixed(2)}.</p></div>`;
        showToast('🧮 Sin combinaciones para tu presupuesto', 'warning');
      } else {
        showToast(`✅ ${engine.combinations.length} combinaciones encontradas (${engine.strategy})`, 'success');
      }
      if (typeof window.renderHistoricalTop5 === 'function') window.renderHistoricalTop5();
    } catch (e) {
      if (statusEl) statusEl.textContent = `❌ Error: ${e.message}`;
      if (container) container.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">❌</span><h3>Error</h3><p>${e.message}</p></div>`;
      showToast(`❌ Error: ${e.message}`, 'error');
    }

    if (scanTimerInterval) { clearInterval(scanTimerInterval); scanTimerInterval = null; }
    if (scanBtn) { scanBtn.textContent = '🧠 Escanear'; scanBtn.classList.remove('scanning'); }
    engine.scanning = false;
  }

  function stopInvestScan() { if (engine) { engine.stopScan(); showToast('⏹️ Deteniendo escaneo...', 'warning'); } }

  function renderInvestHistory() {
    const list = $('invHistoryList');
    const badge = $('invHistoryBadge');
    if (!list || !engine) return;
    const history = engine.history || [];
    if (badge) { badge.style.display = history.length > 0 ? 'inline' : 'none'; badge.textContent = history.length; }
    if (history.length === 0) { list.innerHTML = '<div class="history-empty">Sin búsquedas guardadas</div>'; return; }
    list.innerHTML = history.map(h => {
      const s = h.stats || {};
      const top = h.topCombinations || [];
      return `<div class="history-item" data-inv-id="${h.id}">
        <div class="history-item-main">
          <div class="history-item-info">
            <div class="history-item-title">${h.label || ''} · $${h.budget || 0} · ${h.strategy || 'balanced'}</div>
            <div class="history-item-meta">
              <span>📊 ${s.candidates || 0}</span>
              <span>🏆 ${s.bestScore || 0}</span>
              <span>💰 ROI ${(s.bestROI || 0).toFixed(1)}%</span>
              <span>📈 ROD ${(s.bestROD || 0).toFixed(2)}%</span>
            </div>
          </div>
          <div class="history-item-right">
            <span class="history-item-count${(top.length || s.combinations || 0) === 0 ? ' zero' : ''}">${top.length || s.combinations || 0}</span>
            <button class="btn-icon" data-inv-action="delete" data-id="${h.id}" title="Eliminar">✕</button>
          </div>
        </div>
        ${top.length > 0 ? `<div class="history-top"><div class="history-top-header">🏆 Top ${top.length} por Score</div>${top.map((t, i) => `<div class="history-top-item"><span class="ht-rank">#${i + 1}</span><span class="ht-name">${t.items ? t.items[0] + (t.items.length > 1 ? ' +' + (t.items.length - 1) : '') : 'Combo'}</span><span class="ht-pct green">${(t.profitPct || 0).toFixed(1)}%</span><span class="ht-usd">$${(t.profitUsd || 0).toFixed(2)}</span></div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }

  function restoreInvestHistory(id) {
    if (!engine) return;
    const entry = engine.history.find(h => h.id === id);
    if (entry && engine.restoreFromHistory(entry)) {
      renderInvestCombos();
      if ($('invBudget')) $('invBudget').value = entry.budget || '';
      showToast(`📋 Restaurados ${entry.results.length || 0} resultados`, 'success');
    }
  }

  // ===== EVENT DELEGATION =====
  document.addEventListener('click', (e) => {
    // Scan
    if (e.target.closest('#invScanBtn')) { startInvestScan(); return; }

    // Strategy buttons
    const stratBtn = e.target.closest('[data-inv-strategy]');
    if (stratBtn && engine) {
      const strategy = stratBtn.dataset.invStrategy;
      engine.strategy = strategy;
      engine.combinations = engine.strategyResults[strategy] || [];
      renderInvestCombos();
      showToast(`🔄 Cambiado a estrategia ${strategy}`, 'info');
      return;
    }

    // History
    if (e.target.closest('#invHistoryBtn')) {
      const panel = $('invHistoryPanel');
      if (panel) panel.classList.toggle('open');
      renderInvestHistory();
      return;
    }
    if (e.target.closest('#closeInvHistoryBtn')) { if ($('invHistoryPanel')) $('invHistoryPanel').classList.remove('open'); return; }
    if (e.target.closest('#clearInvHistoryBtn')) {
      if (engine && confirm('¿Borrar todo el historial?')) { engine.clearHistory(); renderInvestHistory(); if ($('invHistoryPanel')) $('invHistoryPanel').classList.remove('open'); showToast('🗑️ Historial borrado', 'info'); }
      return;
    }
    const histItem = e.target.closest('.history-item[data-inv-id]');
    if (histItem) {
      if (e.target.closest('[data-inv-action="delete"]')) { e.stopPropagation(); if (engine) { engine.deleteHistoryEntry(e.target.closest('[data-inv-action="delete"]').dataset.id); renderInvestHistory(); } return; }
      restoreInvestHistory(histItem.dataset.invId);
      if ($('invHistoryPanel')) $('invHistoryPanel').classList.remove('open');
      return;
    }

    // Compound
    if (e.target.closest('#invCompoundBtn')) { if ($('invCompoundPopup')) $('invCompoundPopup').classList.add('show'); return; }
    if (e.target.closest('#closeCompoundBtn')) { if ($('invCompoundPopup')) $('invCompoundPopup').classList.remove('show'); return; }
    const compoundPopup = $('invCompoundPopup');
    if (compoundPopup && compoundPopup.classList.contains('show') && e.target === compoundPopup) { compoundPopup.classList.remove('show'); return; }
    if (e.target.closest('#compoundCalculateBtn') && engine) {
      const capital = parseFloat($('compoundCapital')?.value || '0');
      const profit = parseFloat($('compoundProfit')?.value || '0');
      const ops = parseInt($('compoundOps')?.value || '0');
      const result = engine.calculateCompound(capital, profit, ops);
      const resultDiv = $('compoundResult');
      if (resultDiv) {
        if (result.finalCapital > 0) {
          resultDiv.style.display = 'block';
          if ($('compoundFinal')) $('compoundFinal').textContent = `$${result.finalCapital.toFixed(2)}`;
          if ($('compoundOpsResult')) $('compoundOpsResult').textContent = ops;
          if ($('compoundProfitResult')) $('compoundProfitResult').textContent = `$${result.totalProfit.toFixed(2)}`;
          if ($('compoundPctResult')) $('compoundPctResult').textContent = `${result.totalProfitPct.toFixed(1)}%`;
        } else { resultDiv.style.display = 'none'; showToast('⚠️ Completá todos los campos', 'warning'); }
      }
      return;
    }

    // Top Opportunities
    if (e.target.closest('#invTopBtn') && engine) {
      const opportunities = engine.getTopOpportunities(15);
      const popup = $('invTopPopup');
      const list = $('invTopList');
      if (popup && list) {
        if (opportunities.length === 0) {
          list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.78rem">📊 Escaneá primero.</div>';
        } else {
          list.innerHTML = opportunities.map((o, i) => {
            const stars = o.liquidity >= 80 ? 5 : o.liquidity >= 60 ? 4 : o.liquidity >= 40 ? 3 : o.liquidity >= 20 ? 2 : 1;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            const scoreClass = getScoreClass(o.investScore);
            return `<div class="inv-combo-card ${i === 0 ? 'best' : ''}" style="cursor:pointer" data-top-name="${o.name.replace(/"/g, '&quot;')}">
              <div class="inv-combo-header">
                <span class="inv-combo-rank">${medal} ${o.name}</span>
                <div class="inv-combo-score"><span class="score-label">Score</span><span class="inv-score-circle ${scoreClass}">${o.investScore}</span></div>
              </div>
              <div class="inv-combo-metrics" style="grid-template-columns:1fr 1fr 1fr 1fr">
                <div class="inv-combo-metric"><span class="metric-value green">${(o.profitPct || 0).toFixed(1)}%</span><span class="metric-label">Profit</span></div>
                <div class="inv-combo-metric"><span class="metric-value" style="color:var(--accent-3)">$${(o.profitUsd || 0).toFixed(2)}</span><span class="metric-label">Ganancia</span></div>
                <div class="inv-combo-metric"><span class="metric-value" style="color:var(--text-secondary)">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span><span class="metric-label">Liquidez</span></div>
                <div class="inv-combo-metric"><span class="metric-value" style="color:${(o.confidence || 0) >= 70 ? 'var(--profit-green)' : 'var(--profit-yellow)'}">${o.confidence || 0}%</span><span class="metric-label">Confianza</span></div>
              </div>
            </div>`;
          }).join('');
        }
        popup.classList.add('show');
      }
      return;
    }
    if (e.target.closest('#closeTopBtn')) { if ($('invTopPopup')) $('invTopPopup').classList.remove('show'); return; }
    const topPopup = $('invTopPopup');
    if (topPopup && topPopup.classList.contains('show') && e.target === topPopup) { topPopup.classList.remove('show'); return; }
    if (e.target.closest('[data-top-name]')) {
      const name = e.target.closest('[data-top-name]').dataset.topName;
      if (name) window.open(`https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}`, '_blank');
      return;
    }

    // Favorites
    const favBtn = e.target.closest('[data-inv-fav]');
    if (favBtn && engine) {
      e.stopPropagation();
      const name = favBtn.dataset.invFav;
      if (engine.favorites.find(f => f.name === name)) {
        engine.removeFavorite(name);
        favBtn.textContent = '☆'; favBtn.style.opacity = '0.4'; favBtn.title = 'Agregar a favoritos';
        showToast(`⭐ ${name} eliminado de favoritos`, 'info');
      } else {
        let price = null;
        for (const c of engine.candidates) { if (c.name === name) { price = c.csfloatPrice; break; } }
        engine.addFavorite(name, price);
        favBtn.textContent = '★'; favBtn.style.opacity = '1'; favBtn.style.color = '#ffd700'; favBtn.title = 'Quitar de favoritos';
        showToast(`⭐ ${name} agregado a favoritos`, 'success');
      }
      return;
    }

    // Click item → CSFloat
    const comboItem = e.target.closest('.inv-combo-item');
    if (comboItem) {
      const nameEl = comboItem.querySelector('.item-name');
      if (nameEl) window.open(`https://csfloat.com/search?market_hash_name=${encodeURIComponent(nameEl.textContent)}`, '_blank');
      return;
    }
  });

  // ===== INIT =====
  function initInvest() {
    engine = new SmartInvestEngine();
    engine.loadHistory();
    engine._loadFavorites();

    if (engine.history.length > 0) {
      const last = engine.history[0];
      if (last && last.results && last.results.length > 0) {
        engine.restoreFromHistory(last);
        if ($('invBudget')) $('invBudget').value = last.budget || '';
        renderInvestCombos();
      }
    }

    ['invBudget', 'invCategory', 'invMinProfit', 'invMinPrice', 'invMaxPrice', 'invLimit'].forEach(id => {
      const el = $(id);
      const saved = StorageHelper.getItem(id);
      if (el && saved) el.value = saved;
      if (el) el.addEventListener('change', () => StorageHelper.setItem(id, el.value));
    });
  }

  // Hook para History IO (export/import): recarga el historial desde storage
  window.refreshInvestHistory = () => {
    if (!engine) return;
    engine._loadHistory();
    renderInvestHistory();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initInvest);
  else initInvest();
})();
