/**
 * Cross-Market Opportunity Engine v2.0
 * ======================================
 * Sistema modular de detección de oportunidades entre mercados.
 *
 * Arquitectura:
 *   MarketProvider (interface)
 *   ├── SteamProvider  — Steam Community Market
 *   ├── CSFloatProvider  — CSFloat
 *   └── (Future: Skinport, GamerPay, Buff, DMarket...)
 *
 *   CrossMarketEngine (orquestador)
 *    ├── fetchAllListings() — Obtiene listings de todos los providers
 *    ├── analyzeAll() — Analiza cada listing cross-market
 *    ├── Opportunity Score + Confidence Score
 *    └── Alertas en tiempo real
 *
 * CSP-compliant, modular, extensible.
 */
(function() {
  'use strict';

  // ======================================================================
  // CONSTANTS
  // ======================================================================
  const CACHE_TTL = 30 * 60 * 1000; // 30 min
  const STEAM_API = 'https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=';
  const CSFLOAT_LISTINGS_API = 'https://csfloat.com/api/v1/listings';
  const CSFLOAT_PRICE_API = 'https://csfloat.com/api/v1/listings/price-list';
  const STICKER_QUALITIES = ['', ' (Holo)', ' (Foil)', ' (Gold)', ' (Glitter)', ' (Crystal)'];
  const POLL_INTERVAL_MS = 45000; // 45s between real-time polls

  // ======================================================================
  // SHARED HELPERS
  // ======================================================================

  /** Shared Steam price fetcher with sticker quality fallback */
  async function _fetchSteamPrice(name, cache) {
    if (!name) return null;
    const cached = cache[name];
    if (cached && Date.now() - cached.time < CACHE_TTL) return cached;
    try {
      const url = STEAM_API + encodeURIComponent(name);
      const resp = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://steamcommunity.com/market/',
          'Origin': 'https://steamcommunity.com',
        }
      });
      if (resp.status === 429) { await new Promise(r => setTimeout(r, 5000)); return null; }
      const data = await resp.json();
      if (!data.success || !data.lowest_price) {
        if (name.includes('Sticker |') && !name.includes('(')) {
          for (const q of [' (Holo)', ' (Foil)', ' (Gold)', ' (Glitter)', ' (Crystal)']) {
            const altName = name + q;
            const altResp = await fetch(STEAM_API + encodeURIComponent(altName), {
              headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://steamcommunity.com/market/', 'Origin': 'https://steamcommunity.com' }
            });
            if (altResp.status === 429) break;
            const altData = await altResp.json();
            if (altData.success && altData.lowest_price) {
              data.lowest_price = altData.lowest_price;
              data.volume = altData.volume || '0';
              data.success = true;
              break;
            }
          }
        }
        if (!data.success) return null;
      }
      const price = parseFloat(data.lowest_price.replace('$', '').replace(',', ''));
      let volume = 0;
      if (data.volume) volume = parseInt(data.volume.replace(/,/g, ''), 10) || 0;
      if (price && price > 0) {
        const result = { price, volume, time: Date.now() };
        cache[name] = result;
        return result;
      }
      return null;
    } catch (e) { return null; }
  }

  function _calcLiquidity(volume) {
    const v = volume || 0;
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

  function _detectCharms(stickers) {
    if (!stickers || !stickers.length) return [];
    return stickers.filter(s => {
      const n = s.name || '';
      return n.includes('Charm') || n.toLowerCase().includes('charm');
    }).map(s => ({ name: s.name, fullName: s.name }));
  }

  function _detectStickers(stickers) {
    if (!stickers || !stickers.length) return [];
    return stickers.filter(s => {
      const n = s.name || '';
      if (!n.trim()) return false;
      if (n.includes('Charm') || n.toLowerCase().includes('charm')) return false;
      return true;
    }).map(s => ({ name: s.name, fullName: s.name }));
  }

  // ======================================================================
  // 1. MARKET PROVIDER INTERFACE
  // ======================================================================

  /**
   * Base class for all market providers.
   * Each provider must implement:
   *   - name           — human-readable name
   *   - fetchListings(opts) — returns array of listings
   *   - fetchPrice(name)    — returns { price, volume } or null
   *   - fees           — { buy, sell } fee fractions
   *   - listingUrl(id) — URL to view the listing
   */
  class MarketProvider {
    constructor() { this.priceCache = {}; }
    get fees() { return { buy: 0, sell: 0 }; }
    async fetchListings() { throw new Error('Not implemented'); }
    async fetchPrice(name) { throw new Error('Not implemented'); }
    listingUrl(id) { return '#'; }
  }

  // ======================================================================
  // 2. STEAM PROVIDER
  // ======================================================================

  class SteamProvider extends MarketProvider {
    get name() { return 'Steam'; }
    get fees() { return { buy: 0, sell: 0.15 }; } // 15% Steam fee on sell
    get icon() { return '🟦'; }

    async fetchPrice(name) {
      return _fetchSteamPrice(name, this.priceCache);
    }

    /** Steam doesn't have a public "recent listings" API like CSFloat.
     *  We use priceoverview to get current market prices for comparison.
     *  For actual listings, we rely on CSFloat's detailed endpoint.
     */
    async fetchListings() { return []; } // Steam is used as reference, not source

    listingUrl(name) {
      return `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
    }
  }

  // ======================================================================
  // 3. CSFLOAT PROVIDER
  // ======================================================================

  class CSFloatProvider extends MarketProvider {
    get name() { return 'CSFloat'; }
    get fees() { return { buy: 0, sell: 0.02 }; } // 2% CSFloat seller fee
    get icon() { return '🟠'; }

    // CSFloat doesn't have a per-item price API like Steam.
    // Prices are fetched via CSFloatPriceListManager in the engine.
    async fetchPrice(name) { return null; }

    async fetchListings(options = {}) {
      const { maxListings = 100 } = options;
      const listings = [];
      let cursor = null;
      let fetched = 0;
      let retries = 0;
      const MAX_RETRIES = 3;

      while (fetched < maxListings) {
        // CSFloat rejects unknown/incorrect filter params with 400.
        // Only pass `types=buy_now` — CSFloat expects this exact param.
        // We also client-side filter by listing.type === 'purchase' to be safe.
        let url = `${CSFLOAT_LISTINGS_API}?limit=15&types=buy_now`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        try {
          const resp = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://csfloat.com/',
              'Origin': 'https://csfloat.com',
            }
          });

          // Handle rate limiting (429) with exponential backoff
          if (resp.status === 429) {
            if (retries >= MAX_RETRIES) {
              let errorBody = '';
              try { errorBody = await resp.text(); } catch(e) {}
              throw new Error(`CSFloat rate limit: ${errorBody.slice(0,200)}`);
            }
            const waitMs = Math.min(10000 * Math.pow(2, retries), 30000);
            retries++;
            await new Promise(r => setTimeout(r, waitMs));
            continue; // Retry the same request
          }

          if (!resp.ok) {
            let errorBody = '';
            try { errorBody = await resp.text(); } catch(e) {}
            throw new Error(`CSFloat error: ${resp.status} - ${errorBody.slice(0,200)}`);
          }

          retries = 0; // Reset retries on success
          const data = await resp.json();
          const batch = data.data || data || [];
          if (!batch.length) break;
          for (const l of batch) {
            // 🔥 CRITICAL: Skip auctions (pujas) — the price shown is the current bid,
            // NOT the final price, and would create false opportunities.
            // CSFloat listings have `type: 'purchase'` for buy-now, `type: 'auction'` for auctions.
            if (l.type && l.type !== 'purchase') continue;
            // Also skip non-published states
            if (l.state && l.state !== 'published') continue;
            listings.push(l);
            fetched++;
            if (fetched >= maxListings) break;
          }
          cursor = data.cursor || data.next_cursor || null;
          if (!cursor && batch.length < 15) break;
          // Wait 2.5-3.5s between batches to avoid rate limiting
          await new Promise(r => setTimeout(r, 2500 + Math.random() * 1000));
        } catch (e) {
          if (e.message.includes('rate limit') || e.message.includes('429')) {
            throw e; // Already handled with retries
          }
          throw e;
        }
      }
      return listings;
    }

    listingUrl(id) {
      if (!id) return null;
      return `https://csfloat.com/listing/${id}`;
    }

    /** Build a fallback search URL if the listing ID is missing */
    searchUrl(marketName) {
      if (!marketName) return 'https://csfloat.com/';
      return `https://csfloat.com/search?q=${encodeURIComponent(marketName)}`;
    }

    /** Parse a CSFloat listing into a normalized format */
    parseListing(listing) {
      if (!listing || !listing.item) return null;
      // 🔥 CRITICAL: Double-check this is not an auction
      if (listing.type && listing.type !== 'purchase') return null;
      if (listing.state && listing.state !== 'published') return null;
      const item = listing.item;
      const stickers = item.stickers || [];
      const marketName = item.market_hash_name || item.name || '';
      return {
        id: listing.id,
        market: 'CSFloat',
        marketName,
        listedPrice: (listing.price || 0) / 100,
        stickers,
        charms: _detectCharms(stickers),
        regularStickers: _detectStickers(stickers).filter(s =>
          !s.name.includes('Charm') && !s.name.toLowerCase().includes('charm')
        ),
        float: item.float_value,
        paintSeed: item.paint_seed,
        paintIndex: item.paint_index,
        isStatTrak: item.is_stattrak || false,
        isSouvenir: item.is_souvenir || false,
        rarity: item.rarity || '',
        quality: item.quality || '',
        csfloatUrl: this.listingUrl(listing.id) || this.searchUrl(marketName),
        steamUrl: `https://steamcommunity.com/market/listings/730/${encodeURIComponent(marketName)}`,
        listing,
      };
    }
  }

  // ======================================================================
  // 4. CROSS-MARKET ENGINE
  // ======================================================================

  class CrossMarketEngine {
    constructor() {
      this.providers = [];
      this.steamProvider = new SteamProvider();
      this.csfloatProvider = new CSFloatProvider();
      this.providers.push(this.steamProvider, this.csfloatProvider);
      this.opportunities = [];
      this.history = [];
      this.scanning = false;
      this.progress = { current: 0, total: 0, status: '', phase: '' };
      this.onProgress = null;
      this.onOpportunity = null; // callback for real-time alerts
      this._loadHistory();
      this._pollTimer = null;
    }

    // ======================================================================
    // CONFIG
    // ======================================================================

    setProgressCallback(cb) { this.onProgress = cb; }
    setOpportunityCallback(cb) { this.onOpportunity = cb; }

    _emit(current, total, status, phase) {
      this.progress = { current, total, status, phase };
      if (this.onProgress) this.onProgress(this.progress);
    }

    /** Get a provider by name */
    getProvider(name) {
      return this.providers.find(p => p.name === name);
    }

    // ======================================================================
    // PRICE FETCHING (cross-market)
    // ======================================================================

    /**
     * Get the best price for an item across all providers.
     * Returns { steamPrice, csfloatPrice, bestBuy, bestSell, avgPrice }
     */
    async getCrossMarketPrice(marketName) {
      const steamPrice = await this.steamProvider.fetchPrice(marketName);
      let csfloatPrice = null;
      try {
        // CSFloat price-list is an array, not per-item lookup
        // We use the price-list endpoint for batch data
        if (!this._csfloatPriceList) {
          const resp = await fetch(CSFLOAT_PRICE_API);
          if (resp.ok) {
            this._csfloatPriceList = await resp.json();
          }
        }
        if (this._csfloatPriceList) {
          const found = this._csfloatPriceList.find(p =>
            p.market_hash_name === marketName
          );
          if (found) csfloatPrice = found.min_price / 100;
        }
      } catch (e) {}

      // Determine best buy/sell markets
      const steamPriceAfterFee = steamPrice ? steamPrice.price * (1 - 0.15) : null;
      const csfloatPriceAfterFee = csfloatPrice ? csfloatPrice * (1 - 0.02) : null;

      let bestBuy = null;
      let bestSell = null;

      if (steamPrice !== null && csfloatPrice !== null) {
        // Buy where cheaper, sell where gives more after fees
        if (steamPrice.price < csfloatPrice) {
          bestBuy = { market: 'Steam', price: steamPrice.price };
          bestSell = csfloatPriceAfterFee > steamPriceAfterFee
            ? { market: 'CSFloat', price: csfloatPriceAfterFee }
            : { market: 'Steam', price: steamPriceAfterFee };
        } else {
          bestBuy = { market: 'CSFloat', price: csfloatPrice };
          bestSell = steamPriceAfterFee > csfloatPriceAfterFee
            ? { market: 'Steam', price: steamPriceAfterFee }
            : { market: 'CSFloat', price: csfloatPriceAfterFee };
        }
      } else if (steamPrice !== null) {
        bestBuy = { market: 'Steam', price: steamPrice.price };
        bestSell = { market: 'Steam', price: steamPriceAfterFee };
      } else if (csfloatPrice !== null) {
        bestBuy = { market: 'CSFloat', price: csfloatPrice };
        bestSell = { market: 'CSFloat', price: csfloatPriceAfterFee };
      }

      const prices = [steamPrice?.price, csfloatPrice].filter(p => p !== null);
      const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

      return {
        steamPrice: steamPrice?.price || null,
        steamVolume: steamPrice?.volume || 0,
        csfloatPrice,
        bestBuy,
        bestSell,
        avgPrice,
      };
    }

    // ======================================================================
    // LISTING ANALYSIS
    // ======================================================================

    /**
     * Analyze a single listing from any provider.
     * Calculates:
     *  - Real value (skin + charms + stickers) using cross-market prices
     *  - Cross-market comparison (where to buy, where to sell)
     *  - Opportunity Score + Confidence Score
     *  - Best strategy (sell whole vs separate components)
     */
    async analyzeListing(listing, options = {}) {
      const {
        minProfit = 2,
        minDiscount = 10,
        minCharmValue = 0.50,
        minStickerValue = 0.30,
        minAccessoryPct = 0, // 0 = disabled; e.g. 30 = charms+stickers must be ≥30% of total
      } = options;

      if (!listing || !listing.marketName) return null;

      const { marketName, listedPrice, charms, regularStickers, market, csfloatUrl, steamUrl } = listing;

      // Get cross-market prices for the skin
      const crossPrice = await this.getCrossMarketPrice(marketName);
      if (!crossPrice.steamPrice && !crossPrice.csfloatPrice) return null;

      // Use the average market price as base skin value (more conservative)
      const skinBasePrice = crossPrice.avgPrice || 0;

      // Get charm and sticker values
      let charmValues = [];
      let stickerValues = [];
      let totalCharmValue = 0;
      let totalStickerValue = 0;
      let uncertainItems = [];

      for (const charm of charms) {
        const price = await this.steamProvider.fetchPrice(charm.fullName);
        if (price && price.price >= minCharmValue) {
          charmValues.push({ name: charm.name, price: price.price, confidence: price.volume > 0 ? 'high' : 'low' });
          totalCharmValue += price.price;
        } else if (price) {
          charmValues.push({ name: charm.name, price: price.price, confidence: 'low' });
          totalCharmValue += price.price;
        } else {
          charmValues.push({ name: charm.name, price: null, confidence: 'uncertain' });
          uncertainItems.push(charm.name);
        }
      }

      for (const sticker of regularStickers) {
        const price = await this.steamProvider.fetchPrice(sticker.fullName);
        if (price && price.price >= minStickerValue) {
          stickerValues.push({ name: sticker.name, price: price.price, confidence: price.volume > 0 ? 'high' : 'low' });
          totalStickerValue += price.price;
        } else if (price) {
          stickerValues.push({ name: sticker.name, price: price.price, confidence: 'low' });
          totalStickerValue += price.price;
        } else {
          stickerValues.push({ name: sticker.name, price: null, confidence: 'uncertain' });
          uncertainItems.push(sticker.name);
        }
      }

      // Real value
      const realValue = skinBasePrice + totalCharmValue + totalStickerValue;
      if (realValue <= 0) return null;

      const accessoryTotal = totalCharmValue + totalStickerValue;
      const accessoryPct = realValue > 0 ? (accessoryTotal / realValue) * 100 : 0;

      // Filter: accessory percentage
      if (minAccessoryPct > 0 && accessoryPct < minAccessoryPct) return null;

      // Net profit after fees (2 scenarios)
      // Scenario A: Sell the whole item
      const sellFee = market === 'Steam' ? 0.15 : 0.02;
      const netProfitWhole = (realValue * (1 - sellFee)) - listedPrice;
      const profitPctWhole = listedPrice > 0 ? (netProfitWhole / listedPrice) * 100 : 0;

      // Scenario B: Sell components separately (remove charms/stickers)
      const skinSellFee = 0.15; // Selling skin on Steam
      const charmSellFee = 0.15; // Selling charms on Steam
      const stickerSellFee = 0.15; // Selling stickers on Steam
      const netSkin = skinBasePrice * (1 - skinSellFee);
      const netCharms = totalCharmValue * (1 - charmSellFee);
      const netStickers = totalStickerValue * (1 - stickerSellFee);
      const netProfitSeparate = (netSkin + netCharms + netStickers) - listedPrice;

      // Discount percentage
      const discountPct = realValue > 0 ? ((realValue - listedPrice) / realValue) * 100 : 0;

      // Cross-market recommendation
      let buyRecommendation = 'CSFloat';
      let sellRecommendation = 'Steam';
      if (crossPrice.bestBuy) buyRecommendation = crossPrice.bestBuy.market;
      if (crossPrice.bestSell) sellRecommendation = crossPrice.bestSell.market;

      // Cross-market profit if buying on best market and selling on best market
      const crossProfit = crossPrice.bestBuy && crossPrice.bestSell
        ? crossPrice.bestSell.price - crossPrice.bestBuy.price
        : null;

      // Filter: minimum profit and discount
      const bestNetProfit = Math.max(netProfitWhole, netProfitSeparate, crossProfit || 0);
      if (bestNetProfit < minProfit && discountPct < minDiscount) return null;

      // Metrics
      const steamVolume = crossPrice.steamVolume || 0;
      const skinLiquidity = _calcLiquidity(steamVolume);
      const isCharmOpportunity = totalCharmValue > 0;
      const isStickerOpportunity = totalStickerValue > 0;

      // ===== IMPROVED MISPRICE DETECTION =====
      // Three types of mispricing:
      // 1. Direct misprice: the skin itself (without charms/stickers) is below its market value
      // 2. Cross-market misprice: the item is cheaper on one market vs the other
      // 3. Combo misprice: skin includes valuable charms/stickers that the seller didn't price in

      // Direct misprice: listed price < skin's base value (with a minimum discount threshold)
      const skinOnlyDiscount = skinBasePrice > 0 ? ((skinBasePrice - listedPrice) / skinBasePrice) * 100 : 0;
      const isDirectMispriced = skinOnlyDiscount >= minDiscount && !isCharmOpportunity && !isStickerOpportunity;

      // Cross-market misprice: one market has a significantly better price than the other
      const crossPriceDiff = crossPrice.bestBuy && crossPrice.bestSell
        ? ((crossPrice.bestSell.price - crossPrice.bestBuy.price) / crossPrice.bestBuy.price) * 100
        : 0;
      const isCrossMispriced = crossProfit !== null && crossProfit > minProfit && crossPriceDiff >= minDiscount;

      // Overall isMispriced = any simple misprice (not charm/sticker based)
      const isMispriced = isDirectMispriced || isCrossMispriced;

      // Confidence Score (0-100)
      const confidence = this._calcConfidence(steamVolume, totalCharmValue, totalStickerValue, uncertainItems.length);

      // Opportunity Score (0-100)
      const opportunityScore = this._calcOpportunityScore({
        discountPct,
        netProfit: Math.max(netProfitWhole, netProfitSeparate),
        profitPct: profitPctWhole,
        skinLiquidity,
        totalCharmValue,
        totalStickerValue,
        accessoryPct,
        hasCharms: isCharmOpportunity,
        hasStickers: isStickerOpportunity,
        skinVolume: steamVolume,
        isMispriced,
        isDirectMispriced,
        isCrossMispriced,
        crossProfit,
        confidence,
        skinOnlyDiscount,
      });

      // Best strategy
      const bestStrategy = isCharmOpportunity || isStickerOpportunity
        ? (netProfitSeparate >= netProfitWhole ? 'separate' : 'whole')
        : isCrossMispriced
          ? 'cross-market'
          : 'whole';

      return {
        id: listing.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        market,
        marketName,
        listedPrice,
        realValue,
        skinValue: skinBasePrice,
        charmValue: totalCharmValue,
        stickerValue: totalStickerValue,
        accessoryPct: Math.round(accessoryPct * 10) / 10,
        charms: charmValues,
        stickers: stickerValues,
        discountPct: Math.round(discountPct * 10) / 10,
        skinOnlyDiscount: Math.round(skinOnlyDiscount * 10) / 10,
        netProfit: Math.round(bestNetProfit * 100) / 100,
        netProfitWhole: Math.round(netProfitWhole * 100) / 100,
        netProfitSeparate: Math.round(netProfitSeparate * 100) / 100,
        profitPct: Math.round(profitPctWhole * 10) / 10,
        opportunityScore: Math.round(opportunityScore),
        confidence: Math.round(confidence),
        bestStrategy,
        skinLiquidity,
        skinVolume: steamVolume,
        isCharmOpportunity,
        isStickerOpportunity,
        isMispriced,
        isDirectMispriced,
        isCrossMispriced,
        crossMarket: {
          steamPrice: crossPrice.steamPrice,
          csfloatPrice: crossPrice.csfloatPrice,
          avgPrice: crossPrice.avgPrice,
          bestBuy: crossPrice.bestBuy,
          bestSell: crossPrice.bestSell,
          crossProfit: crossProfit ? Math.round(crossProfit * 100) / 100 : null,
          buyRecommendation,
          sellRecommendation,
        },
        uncertainItems: uncertainItems.length > 0 ? uncertainItems : null,
        timeDetected: Date.now(),
        csfloatUrl,
        steamUrl,
        float: listing.float,
      };
    }

    // ======================================================================
    // SCORING
    // ======================================================================

    _calcConfidence(volume, charmValue, stickerValue, uncertainCount) {
      let score = 0;
      score += Math.min(50, (volume || 0) / 20);
      score += charmValue > 0 ? 20 : 0;
      score += stickerValue > 0 ? 15 : 0;
      score += volume > 100 ? 15 : volume > 10 ? 10 : 5;
      // Penalty for uncertain items
      score -= uncertainCount * 10;
      return Math.max(0, Math.min(100, score));
    }

    _calcOpportunityScore(params) {
      const {
        discountPct, netProfit, profitPct, skinLiquidity,
        totalCharmValue, totalStickerValue, accessoryPct,
        hasCharms, hasStickers, skinVolume, isMispriced,
        isDirectMispriced, isCrossMispriced,
        crossProfit, confidence,
        skinOnlyDiscount,
      } = params;

      const discountScore = Math.min(30, discountPct * 0.8);
      const profitScore = Math.min(25, netProfit * 3);
      const liqScore = skinLiquidity * 0.15;
      const charmBonus = hasCharms ? Math.min(15, totalCharmValue * 5) : 0;
      const stickerBonus = hasStickers ? Math.min(10, totalStickerValue * 4) : 0;
      const volumeScore = Math.min(5, (skinVolume || 0) / 200);
      // Increased misprice bonus: 15pts for direct misprice, 10pts for cross-market misprice
      const directMispriceBonus = isDirectMispriced ? 15 : 0;
      const crossMispriceBonus = isCrossMispriced ? 10 : 0;
      const mispriceBonus = isMispriced ? Math.max(directMispriceBonus, crossMispriceBonus) : 0;
      const accessoryBonus = accessoryPct >= 30 ? 8 : accessoryPct >= 20 ? 5 : accessoryPct >= 10 ? 2 : 0;
      const crossBonus = crossProfit && crossProfit > 0 ? 5 : 0;

      let score = discountScore + profitScore + liqScore + charmBonus + stickerBonus
                + volumeScore + mispriceBonus + accessoryBonus + crossBonus;

      // Non-linear penalties (REMOVED the unfair penalty on simple mispriced listings)
      if (netProfit < 1) score *= 0.5;
      if (discountPct > 70) score *= 0.6;
      if (confidence < 30) score *= 0.5;

      return Math.round(Math.max(0, Math.min(100, score)));
    }

    // ======================================================================
    // FULL SCAN
    // ======================================================================

    async runFullScan(options = {}) {
      if (this.scanning) return [];
      this.scanning = true;

      const {
        maxListings = 100,
        minProfit = 2,
        minDiscount = 10,
        minCharmValue = 0.50,
        minStickerValue = 0.30,
        minAccessoryPct = 0,
      } = options;

      this.opportunities = [];
      this._historyLabel = null; // Clear history badge on fresh scan

      try {
        // Phase 1: Fetch CSFloat listings
        this._emit(0, maxListings, '🔍 Obteniendo listings de CSFloat...', 'csfloat');
        const csfloatListings = await this.csfloatProvider.fetchListings({ maxListings });
        const parsed = csfloatListings
          .map(l => this.csfloatProvider.parseListing(l))
          .filter(Boolean);

        this._emit(0, parsed.length, `📦 ${parsed.length} listings de CSFloat. Analizando...`, 'analyze');

        // Phase 2: Get CSFloat price list for cross-market comparison
        this._csfloatPriceList = null;

        // Phase 3: Analyze each listing
        const total = parsed.length;
        const BATCH = 5;
        for (let i = 0; i < total && this.scanning; i += BATCH) {
          const batch = parsed.slice(i, i + BATCH);
          const batchNum = Math.floor(i / BATCH) + 1;
          const totalBatches = Math.ceil(total / BATCH);

          this._emit(
            i + batch.length, total,
            `🔎 Analizando lote ${batchNum}/${totalBatches} | ${this.opportunities.length} oportunidades`,
            'analyze'
          );

          const results = await Promise.all(
            batch.map(l => this.analyzeListing(l, {
              minProfit, minDiscount, minCharmValue, minStickerValue, minAccessoryPct,
            }))
          );

          for (const opp of results) {
            if (opp) {
              this.opportunities.push(opp);
              // Real-time alert callback
              if (this.onOpportunity && opp.opportunityScore >= 70) {
                this.onOpportunity(opp);
              }
            }
          }

          if (i + BATCH < total && this.scanning) {
            await new Promise(r => setTimeout(r, 1200));
          }
        }

        this.opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);
        this.saveToHistory();

        this._emit(this.opportunities.length, this.opportunities.length,
          `✅ ${this.opportunities.length} oportunidades encontradas`, 'done');

        return this.opportunities;
      } catch (e) {
        this._emit(0, 0, `❌ Error: ${e.message}`, 'error');
        throw e;
      } finally {
        this.scanning = false;
      }
    }

    stopScan() { this.scanning = false; }

    // ======================================================================
    // REAL-TIME POLLING
    // ======================================================================

    startPolling(options = {}) {
      this.stopPolling();
      this._pollTimer = setInterval(async () => {
        if (this.scanning) return;
        try {
          await this.runFullScan(options);
        } catch (e) {
          console.warn('Poll error:', e.message);
        }
      }, POLL_INTERVAL_MS);
    }

    stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    }

    // ======================================================================
    // HISTORY
    // ======================================================================

    saveToHistory() {
      if (this.opportunities.length === 0) return;
      const entry = {
        id: 'opp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date: Date.now(),
        label: new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        count: this.opportunities.length,
        // Store ALL opportunities (up to 30) with enough data to re-render cards later
        results: this.opportunities.slice(0, 30).map(o => ({
          id: o.id,
          market: o.market,
          marketName: o.marketName,
          listedPrice: o.listedPrice,
          realValue: o.realValue,
          skinValue: o.skinValue,
          charmValue: o.charmValue,
          stickerValue: o.stickerValue,
          accessoryPct: o.accessoryPct,
          netProfit: o.netProfit,
          netProfitWhole: o.netProfitWhole,
          netProfitSeparate: o.netProfitSeparate,
          profitPct: o.profitPct,
          discountPct: o.discountPct,
          opportunityScore: o.opportunityScore,
          confidence: o.confidence,
          bestStrategy: o.bestStrategy,
          skinLiquidity: o.skinLiquidity,
          skinVolume: o.skinVolume,
          isCharmOpportunity: o.isCharmOpportunity,
          isStickerOpportunity: o.isStickerOpportunity,
          isMispriced: o.isMispriced,
          isDirectMispriced: o.isDirectMispriced,
          isCrossMispriced: o.isCrossMispriced,
          skinOnlyDiscount: o.skinOnlyDiscount,
          csfloatUrl: o.csfloatUrl,
          steamUrl: o.steamUrl,
          uncertainItems: o.uncertainItems,
          crossMarket: o.crossMarket,
          charms: o.charms,
          stickers: o.stickers,
        })),
        // Also keep the legacy topOpportunities for the history list view
        topOpportunities: this.opportunities.slice(0, 7).map(o => ({
          marketName: o.marketName,
          market: o.market,
          listedPrice: o.listedPrice,
          realValue: o.realValue,
          netProfit: o.netProfit,
          discountPct: o.discountPct,
          opportunityScore: o.opportunityScore,
          hasCharms: o.isCharmOpportunity,
          hasStickers: o.isStickerOpportunity,
          bestStrategy: o.bestStrategy,
        })),
      };
      this.history.unshift(entry);
      if (this.history.length > 20) this.history = this.history.slice(0, 20);
      this._saveHistory();
    }

    _saveHistory() {
      try { StorageHelper.setItem('saintprofit_opportunity_history', JSON.stringify(this.history)); } catch (e) {}
    }

    _loadHistory() {
      try {
        const raw = StorageHelper.getItem('saintprofit_opportunity_history');
        this.history = raw ? JSON.parse(raw) : [];
      } catch (e) { this.history = []; }
    }

    clearHistory() { this.history = []; this._saveHistory(); }
  }

  window.CrossMarketEngine = CrossMarketEngine;
})();

// ======================================================================
// ===== UI INTEGRATION v2 =====
// ======================================================================
(function() {
  'use strict';

  let engine = null;
  let scanTimerInterval = null;
  let scanStartTime = null;
  let alertsEnabled = false;

  function formatTimer(ms) {
    const totalSec = Math.floor(ms / 1000);
    return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
  }

  // ===== KNIFE / GLOVE STEAM SNIPER =====
  const STEAM_SEARCH_API = 'https://steamcommunity.com/market/search/render/';

  /** Detect if an item is a knife or glove based on its market hash name */
  function _isKnifeOrGlove(name) {
    if (!name) return null;
    // All CS2 knives and gloves start with "★"
    // Known knife and glove patterns
    const KNIFE_KEYWORDS = [
      'Knife', 'Knives', 'Bayonet', 'Flip', 'Gut', 'Karambit', 'M9',
      'Butterfly', 'Falchion', 'Shadow Daggers', 'Bowie', 'Huntsman',
      'Classic', 'Paracord', 'Survival', 'Nomad', 'Talon', 'Ursus',
      'Stiletto', 'Navaja', 'Skeleton', 'Kukri'
    ];
    const GLOVE_KEYWORDS = [
      'Gloves', 'Wraps', 'Hand Wraps', 'Sport Gloves', 'Driver Gloves',
      'Moto Gloves', 'Specialist Gloves', 'Bloodhound Gloves',
      'Hydra Gloves', 'Broken Fang Gloves'
    ];

    // Must start with ★ to be a knife or glove
    if (!name.startsWith('★') && !name.startsWith('\u2605')) return null;

    const lower = name.toLowerCase();

    // Check for gloves first
    for (const kw of GLOVE_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) return 'glove';
    }

    // Check for knives
    for (const kw of KNIFE_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) return 'knife';
    }

    // If it starts with ★ and isn't a glove, it's most likely a knife
    return 'knife';
  }

  /**
   * Search Steam Market for cheap knives and gloves under maxPrice USD.
   * Returns the cheapest matching item, or null if none found.
   */
  async function scanSteamForKnivesGloves(maxPrice) {
    maxPrice = maxPrice || 20;
    const maxCents = maxPrice * 100;

    // Search for items starting with ★ (knives and gloves)
    // The ★ symbol is the universal prefix for these items in CS2
    const queries = ['\u2605', 'Gloves', 'Knife'];

    let found = null;
    for (const query of queries) {
      if (found) break;
      try {
        const url = `${STEAM_SEARCH_API}?query=${encodeURIComponent(query)}&start=0&count=50&sort_column=price&sort_dir=asc&appid=730&norender=1`;
        const resp = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://steamcommunity.com/market/',
            'Origin': 'https://steamcommunity.com',
          }
        });
        if (!resp.ok) continue;

        const data = await resp.json();
        if (!data.success || !data.results) continue;

        for (const result of data.results) {
          const name = result.name || result.hash_name || '';
          const priceCents = result.sell_price;
          if (!priceCents || priceCents <= 0) continue;

          const type = _isKnifeOrGlove(name);
          if (!type) continue;

          const priceUsd = priceCents / 100;
          if (priceUsd > maxPrice) continue;

          // Found a knife/glove under maxPrice!
          const steamUrl = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(result.hash_name || name)}`;

          if (!found || priceUsd < found.price) {
            found = {
              name,
              hashName: result.hash_name || name,
              price: priceUsd,
              type,
              listings: result.sell_listings || 0,
              steamUrl,
            };
          }
        }
      } catch (e) {
        // Ignore errors, try next query
      }

      // Brief delay between queries
      await new Promise(r => setTimeout(r, 500));
    }

    return found;
  }

  function showKnifeGloveAlert(item) {
    const overlay = document.getElementById('steamSniperOverlay');
    if (!overlay) return;

    const typeEl = document.getElementById('sniperAlertType');
    const nameEl = document.getElementById('sniperAlertName');
    const priceEl = document.getElementById('sniperAlertPrice');
    const limitEl = document.getElementById('sniperAlertLimit');
    const btnEl = document.getElementById('sniperAlertBuyBtn');

    if (typeEl) {
      typeEl.textContent = item.type === 'glove' ? '🧤 Guante' : '🔪 Cuchillo';
    }
    if (nameEl) nameEl.textContent = item.name;
    if (priceEl) {
      priceEl.textContent = `$${item.price.toFixed(2)}`;
      // Flash animation on price
      priceEl.style.animation = 'none';
      setTimeout(() => { priceEl.style.animation = 'stat-pulse 0.5s ease-out'; }, 10);
    }
    if (limitEl) limitEl.textContent = `$${(document.getElementById('snipKnifeMaxPrice')?.value || '20')}`;
    if (btnEl) btnEl.href = item.steamUrl;

    // Show the overlay (covers everything)
    overlay.classList.add('show');

    // Browser notification (if available in extension context)
    try {
      if (typeof chrome !== 'undefined' && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '🔪 Steam Sniper',
          message: `${item.name} — $${item.price.toFixed(2)} en Steam!`,
          priority: 2,
        });
      }
    } catch (e) {}
  }

  function hideKnifeGloveAlert() {
    const overlay = document.getElementById('steamSniperOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  /** Run the knife/glove scan and show alert if found */
  async function runKnifeGloveScan(scanningFn) {
    const maxPrice = parseFloat(document.getElementById('snipKnifeMaxPrice')?.value || '20');
    if (scanningFn) scanningFn('🔍 Buscando cuchillos/guantes baratos en Steam...');

    const found = await scanSteamForKnivesGloves(maxPrice);
    if (!found) {
      showToast('😕 Sin cuchillos/guantes bajo $' + maxPrice.toFixed(2) + ' en Steam', 'info');
      return null;
    }

    showKnifeGloveAlert(found);
    showToast(`🔪 ¡SNIPER! ${found.name} — $${found.price.toFixed(2)} en Steam`, 'success');
    return found;
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

  function getLiquidityStars(liq) {
    const stars = liq >= 80 ? 5 : liq >= 60 ? 4 : liq >= 40 ? 3 : liq >= 20 ? 2 : 1;
    if (stars <= 0) return '';
    return `<span class="inv-liquidity"><span class="star-filled">${'★'.repeat(stars)}</span><span class="star-empty">${'☆'.repeat(5 - stars)}</span></span>`;
  }

  function renderResults() {
    const container = $('snipResultsContainer');
    const oppCount = $('snipOppCount');
    const bestScore = $('snipBestScore');
    const bestProfit = $('snipBestProfit');
    const totalListings = $('snipTotalListings');
    if (!container || !engine) return;

    const opps = engine.opportunities || [];
    if (totalListings) totalListings.textContent = opps.length;
    if (oppCount) oppCount.textContent = opps.length;
    if (bestScore && opps.length > 0) bestScore.textContent = opps[0].opportunityScore;
    if (bestProfit && opps.length > 0) bestProfit.textContent = `$${(opps[0].netProfit || 0).toFixed(2)}`;

    // Show history badge if results were loaded from history
    const histBadge = engine._historyLabel
      ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.6rem;font-weight:600;color:var(--accent-2);margin-left:8px;padding:1px 6px;border:1px solid var(--accent-2);border-radius:4px;background:rgba(255,140,66,0.08)">📂 Historial: ${engine._historyLabel}</span>`
      : '';

    if (opps.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:20px 12px">
        <span class="empty-icon" style="font-size:2rem">🔍</span>
        <h3 style="margin-bottom:6px;font-size:0.9rem">Cross-Market Opportunities</h3>
        <div style="text-align:left;font-size:0.68rem;line-height:1.5;color:var(--text-secondary);max-width:300px;margin:6px auto 0">
          <p style="margin-bottom:6px"><strong style="color:var(--text-primary)">1️⃣ Apretá "Escanear"</strong> — busca los últimos listings de CSFloat.</p>
          <p style="margin-bottom:6px"><strong style="color:var(--text-primary)">2️⃣ Calculamos el valor real</strong> — precio skin + charms + stickers.</p>
          <p style="margin-bottom:6px"><strong style="color:var(--text-primary)">3️⃣ Detectamos oportunidades</strong> — si el precio publicado es menor al valor real, hay ganancia.</p>
          <p style="margin-bottom:6px"><strong style="color:var(--text-primary)">4️⃣ Comparamos mercados</strong> — recomendamos dónde comprar y dónde vender.</p>
          <p><strong style="color:var(--text-primary)">5️⃣ Elegí estrategia</strong> — completo, separar componentes o cross-market.</p>
        </div>
      </div>`;
      return;
    }

    let html = `
      <div class="inv-recommendation-banner" style="border-color:var(--profit-red);background:linear-gradient(135deg,rgba(255,51,102,0.08),rgba(255,107,53,0.05))">
        <div class="banner-title" style="color:var(--profit-red);display:flex;align-items:center;gap:4px">🔍 ${opps.length} oportunidades${histBadge}</div>
        <div class="banner-text">
          Mejor: <strong style="color:var(--text-primary)">${opps[0].marketName}</strong>
          · ${opps[0].market === 'Steam' ? '🟦' : '🟠'} ${opps[0].market}
          · Descuento: <strong style="color:var(--profit-green)">${opps[0].discountPct}%</strong>
          · Profit: <strong style="color:var(--profit-green)">+$${opps[0].netProfit.toFixed(2)}</strong>
          · Score: <strong style="color:var(--accent-1)">${opps[0].opportunityScore}</strong>
        </div>
      </div>
    `;

    opps.slice(0, 25).forEach((opp, idx) => {
      const scoreClass = getScoreClass(opp.opportunityScore);
      const badge = opp.opportunityScore >= 80 ? '🔥' : opp.opportunityScore >= 60 ? '⚡' : opp.opportunityScore >= 40 ? '📌' : '🔍';
      const marketIcon = opp.market === 'Steam' ? '🟦' : '🟠';

      // Opportunity type badge (always shown)
      let typeBadge = '';
      if (opp.isCharmOpportunity && opp.isStickerOpportunity) {
        typeBadge = '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:0.5rem;font-weight:700;background:rgba(0,212,170,0.12);color:var(--profit-green);margin-left:4px">🧩 Charm+Sticker</span>';
      } else if (opp.isCharmOpportunity) {
        typeBadge = '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:0.5rem;font-weight:700;background:rgba(0,212,170,0.12);color:var(--profit-green);margin-left:4px">🔑 Charm</span>';
      } else if (opp.isStickerOpportunity) {
        typeBadge = '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:0.5rem;font-weight:700;background:rgba(0,212,170,0.12);color:var(--profit-green);margin-left:4px">🏷️ Sticker</span>';
      } else if (opp.isCrossMispriced) {
        typeBadge = '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:0.5rem;font-weight:700;background:rgba(255,107,53,0.12);color:var(--accent-1);margin-left:4px">🔄 Cross-market</span>';
      } else if (opp.isDirectMispriced) {
        typeBadge = '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:0.5rem;font-weight:700;background:rgba(255,51,102,0.12);color:var(--profit-red);margin-left:4px">📉 Mispriced</span>';
      }

      // Cross-market recommendation tag
      let crossTag = '';
      if (opp.crossMarket && opp.crossMarket.bestBuy && opp.crossMarket.bestSell) {
        crossTag = `<span style="font-size:0.55rem;color:var(--accent-3);margin-left:4px">(Comprar: ${opp.crossMarket.bestBuy.market} → Vender: ${opp.crossMarket.bestSell.market})</span>`;
      }

      html += `
        <div class="inv-combo-card ${idx === 0 ? 'best' : ''}">
          <div class="inv-combo-header">
            <span class="inv-combo-rank">${badge} #${idx + 1} ${marketIcon} ${opp.market}${crossTag}${typeBadge}</span>
            <div class="inv-combo-score">
              <span class="score-label">Score</span>
              <span class="inv-score-circle ${scoreClass}">${opp.opportunityScore}</span>
            </div>
          </div>
          <div style="font-size:0.7rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${opp.marketName}</div>
          <div class="inv-combo-metrics" style="grid-template-columns:1fr 1fr 1fr">
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:var(--accent-1)">$${opp.listedPrice.toFixed(2)}</span>
              <span class="metric-label">Publicado</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value gold">$${opp.realValue.toFixed(2)}</span>
              <span class="metric-label">Valor real</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value green">${opp.discountPct}%</span>
              <span class="metric-label">Descuento</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value green">+$${opp.netProfit.toFixed(2)}</span>
              <span class="metric-label">Profit</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:${opp.confidence >= 70 ? 'var(--profit-green)' : opp.confidence >= 40 ? 'var(--profit-yellow)' : 'var(--profit-red)'}">${opp.confidence}%</span>
              <span class="metric-label">Confianza</span>
            </div>
            <div class="inv-combo-metric">
              <span class="metric-value" style="color:var(--text-secondary)">${getLiquidityStars(opp.skinLiquidity)}</span>
              <span class="metric-label">Liquidez</span>
            </div>
          </div>
          <!-- Investment Breakdown: shown for ALL opportunities now -->
          <div style="margin-top:3px;padding:5px 8px;background:rgba(0,212,170,0.05);border-radius:6px;border:1px solid rgba(0,212,170,0.08)">
            <div style="font-size:0.58rem;color:var(--profit-green);font-weight:700;margin-bottom:2px;display:flex;justify-content:space-between">
              <span>${opp.isCharmOpportunity || opp.isStickerOpportunity ? '🧩 Investment Breakdown' : opp.isCrossMispriced ? '🔄 Cross-Market' : opp.isDirectMispriced ? '📉 Mispriced Skin' : '📊 Value Breakdown'}</span>
              ${opp.accessoryPct > 0 ? `<span style="color:var(--accent-2)">Acc: ${opp.accessoryPct}%</span>` : `<span style="color:var(--text-muted)">Skin: $${opp.skinValue.toFixed(2)}</span>`}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;font-size:0.58rem;color:var(--text-muted)">
              <span>Skin: <strong style="color:var(--text-primary)">$${opp.skinValue.toFixed(2)}</strong></span>
              ${opp.isCharmOpportunity ? `<span>Charms: <strong style="color:var(--accent-2)">$${opp.charmValue.toFixed(2)}</strong></span>` : ''}
              ${opp.isStickerOpportunity ? `<span>Stickers: <strong style="color:var(--accent-2)">$${opp.stickerValue.toFixed(2)}</strong></span>` : ''}
              ${opp.isDirectMispriced ? `<span style="color:var(--profit-red)">⚠️ Skin infravalorada: ${opp.skinOnlyDiscount ?? opp.discountPct}%</span>` : ''}
              <span>Estrategia: <strong style="color:${opp.bestStrategy === 'separate' ? 'var(--profit-green)' : opp.bestStrategy === 'cross-market' ? 'var(--accent-1)' : 'var(--text-primary)'}">${opp.bestStrategy === 'separate' ? 'Separar' : opp.bestStrategy === 'cross-market' ? 'Cross-market' : 'Completo'}</strong></span>
              <span>Confianza: <strong>${opp.confidence}%</strong></span>
            </div>
          </div>
          ${opp.crossMarket && opp.crossMarket.steamPrice ? `
          <div style="margin-top:2px;display:flex;gap:4px;font-size:0.55rem;color:var(--text-muted);flex-wrap:wrap">
            <span>Steam: <strong>$${opp.crossMarket.steamPrice.toFixed(2)}</strong></span>
            ${opp.crossMarket.csfloatPrice ? `<span>· CSFloat: <strong>$${opp.crossMarket.csfloatPrice.toFixed(2)}</strong></span>` : ''}
            ${opp.crossMarket.bestBuy ? `<span>· Comprar: <strong style="color:var(--profit-green)">${opp.crossMarket.bestBuy.market}</strong></span>` : ''}
            ${opp.crossMarket.bestSell ? `<span>· Vender: <strong style="color:var(--accent-1)">${opp.crossMarket.bestSell.market}</strong></span>` : ''}
          </div>` : ''}
          ${opp.charms && opp.charms.length > 0 ? `
          <div style="margin-top:2px;padding:3px 6px;font-size:0.52rem;color:var(--text-muted)">
            ${opp.charms.filter(c => c.price).map(c => `🔑 ${c.name}: <strong style="color:var(--accent-2)">$${c.price.toFixed(2)}</strong>`).join(' · ')}
            ${opp.charms.filter(c => !c.price).map(c => `🔑 ${c.name}: <em style="color:var(--profit-yellow)">incierto</em>`).join(' · ')}
          </div>` : ''}
          ${opp.stickers && opp.stickers.length > 0 ? `
          <div style="margin-top:1px;padding:3px 6px;font-size:0.52rem;color:var(--text-muted)">
            ${opp.stickers.filter(s => s.price).map(s => `🏷️ ${s.name}: <strong style="color:var(--accent-2)">$${s.price.toFixed(2)}</strong>`).join(' · ')}
            ${opp.stickers.filter(s => !s.price).map(s => `🏷️ ${s.name}: <em style="color:var(--profit-yellow)">incierto</em>`).join(' · ')}
          </div>` : ''}
          ${opp.uncertainItems ? `<div style="margin-top:2px;padding:2px 6px;font-size:0.5rem;color:var(--profit-yellow)">⚠️ Valor incierto: ${opp.uncertainItems.join(', ')}</div>` : ''}
          <!-- Links -->
          <div class="inv-links-row" style="margin-top:3px;display:flex;gap:4px;padding:3px 0 0">
            <a class="inv-link csfloat" href="${opp.csfloatUrl}" target="_blank" title="Ver en CSFloat">
              🟠 CSFloat
            </a>
            <a class="inv-link steam" href="${opp.steamUrl}" target="_blank" title="Ver en Steam Market">
              🟦 Steam
            </a>
          </div>
        </div>`;
    });

    container.innerHTML = html;
  }

  async function startScan() {
    if (!engine) return;
    if (engine.scanning) { stopScan(); return; }

    const scanBtn = $('snipScanBtn');
    const progress = $('snipProgress');
    const statusEl = $('snipStatus');
    const progressFill = $('snipProgressFill');
    const scanCounter = $('snipScanCounter');
    const scanTotal = $('snipScanTotal');
    const scanTimer = $('snipScanTimer');
    const container = $('snipResultsContainer');

    // Clear history badge when starting a fresh scan
    if (engine) engine._historyLabel = null;

    if (scanBtn) { scanBtn.textContent = '⏹ Detener'; scanBtn.classList.add('scanning'); }
    if (progress) progress.classList.add('show');
    if (container) container.innerHTML = '<div class="empty-state"><span class="empty-icon" style="font-size:2.2rem">📡</span><h3>Cargando...</h3><p>Obteniendo listings de CSFloat</p></div>';

    const maxListings = parseInt($('snipMaxListings')?.value || '100');
    const minProfit = parseFloat($('snipMinProfit')?.value || '2');
    const minDiscount = parseInt($('snipMinDiscount')?.value || '10');
    const minCharmValue = parseFloat($('snipMinCharmValue')?.value || '0.50');
    const minStickerValue = parseFloat($('snipMinStickerValue')?.value || '0.30');
    const minAccessoryPct = parseInt($('snipAccessoryPct')?.value || '0');
    const snipKnifeScan = $('snipKnifeScan')?.checked || false;

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
      await engine.runFullScan({ maxListings, minProfit, minDiscount, minCharmValue, minStickerValue, minAccessoryPct });
      renderResults();

      // After regular scan, also check Steam for cheap knives/gloves
      if (snipKnifeScan && statusEl) {
        statusEl.textContent = '🔪 Buscando cuchillos/guantes baratos en Steam...';
        await runKnifeGloveScan((msg) => {
          if (statusEl) statusEl.textContent = msg;
        });
      }

      if (statusEl) statusEl.textContent = `✅ ${engine.opportunities.length} oportunidades`;
      if (progressFill) progressFill.style.width = '100%';

      if (engine.opportunities.length === 0) {
        if (container) container.innerHTML = '<div class="empty-state"><span class="empty-icon" style="font-size:2.2rem">😕</span><h3>Sin oportunidades</h3><p>No se encontraron en este lote. Probá con más listings o ajustá los filtros.</p></div>';
        showToast('😕 Sin oportunidades', 'info');
      } else {
        showToast(`🔍 ${engine.opportunities.length} oportunidades encontradas`, 'success');
      }
      if (typeof window.renderHistoricalTop5 === 'function') window.renderHistoricalTop5();
    } catch (e) {
      if (statusEl) statusEl.textContent = `❌ Error: ${e.message}`;
      if (container) container.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.2rem">❌</span><h3>Error</h3><p>${e.message}</p></div>`;
      showToast(`❌ Error: ${e.message}`, 'error');
    }

    if (scanTimerInterval) { clearInterval(scanTimerInterval); scanTimerInterval = null; }
    if (scanBtn) { scanBtn.textContent = '🔍 Escanear'; scanBtn.classList.remove('scanning'); }
  }

  function stopScan() { if (engine) { engine.stopScan(); showToast('⏹️ Deteniendo...', 'warning'); } }

  function toggleAlerts() {
    alertsEnabled = !alertsEnabled;
    const btn = $('snipAlertsBtn');
    if (btn) {
      btn.style.borderColor = alertsEnabled ? 'var(--profit-red)' : 'var(--border)';
      btn.style.background = alertsEnabled ? 'rgba(255,51,102,0.1)' : 'transparent';
    }
    if (alertsEnabled) {
      engine.startPolling();
      showToast('🔔 Alertas activadas (cada 45s)', 'success');
    } else {
      engine.stopPolling();
      showToast('🔕 Alertas desactivadas', 'info');
    }
  }

  function renderHistory() {
    const list = $('snipHistoryList');
    const badge = $('snipHistoryBadge');
    if (!list || !engine) return;
    const history = engine.history || [];
    if (badge) { badge.style.display = history.length > 0 ? 'inline' : 'none'; badge.textContent = history.length; }
    if (history.length === 0) { list.innerHTML = '<div class="history-empty">Sin búsquedas guardadas</div>'; return; }
    list.innerHTML = history.map(h => {
      const top = h.topOpportunities || [];
      return `<div class="history-item">
        <div class="history-item-main">
          <div class="history-item-info">
            <div class="history-item-title">${h.label || ''} · ${h.count || 0} oportunidades</div>
          </div>
          <div class="history-item-right">
            <span class="history-item-count">${h.count || 0}</span>
          </div>
        </div>
        ${top.length > 0 ? `<div class="history-top"><div class="history-top-header">🔍 Top ${top.length}</div>${top.map((t, i) => `<div class="history-top-item"><span class="ht-rank">#${i+1}</span><span class="ht-name">${t.marketName}</span><span class="ht-pct green">${t.discountPct}%</span><span class="ht-usd">+$${t.netProfit.toFixed(2)}</span></div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ===== INIT =====
  function initOpportunityEngine() {
    engine = new CrossMarketEngine();
    engine._loadHistory();

    // Set up real-time opportunity alerts
    engine.setOpportunityCallback((opp) => {
      showToast(`🔥 ${opp.marketName}: +$${opp.netProfit.toFixed(2)} (Score: ${opp.opportunityScore})`, 'success');
    });

    renderResults();
  }

  // Event delegation
  document.addEventListener('click', (e) => {
    if (e.target.closest('#snipScanBtn')) { startScan(); return; }
    if (e.target.closest('#snipAlertsBtn')) { toggleAlerts(); return; }

    if (e.target.closest('#snipHistoryBtn')) {
      const panel = $('snipHistoryPanel');
      if (panel) panel.classList.toggle('open');
      renderHistory();
      return;
    }

    if (e.target.closest('#closeSnipHistoryBtn')) {
      $('snipHistoryPanel')?.classList.remove('open');
      return;
    }

    const clearBtn = e.target.closest('#clearSnipHistoryBtn');
    if (clearBtn && engine) {
      engine.clearHistory();
      renderHistory();
      showToast('🗑️ Historial eliminado', 'info');
      return;
    }

    // Click on a history item → load those results back into the table
    const histItem = e.target.closest('#snipHistoryList .history-item');
    if (histItem && engine) {
      const idx = Array.from(histItem.parentElement?.querySelectorAll('.history-item') || []).indexOf(histItem);
      const entry = engine.history[idx];
      if (!entry || !entry.topOpportunities || entry.topOpportunities.length === 0) return;

      let loadedOpps;
      if (entry.results && entry.results.length > 0) {
        // NEW format: full results data
        loadedOpps = entry.results.map(r => ({
          ...r,
          netProfitWhole: r.netProfitWhole ?? r.netProfit,
          netProfitSeparate: r.netProfitSeparate ?? r.netProfit,
          profitPct: r.profitPct ?? 0,
          skinLiquidity: r.skinLiquidity ?? 0,
          skinVolume: r.skinVolume ?? 0,
          uncertainItems: r.uncertainItems || null,
          crossMarket: r.crossMarket || null,
          charms: r.charms || [],
          stickers: r.stickers || [],
          timeDetected: Date.now(),
        }));
      } else {
        // OLD format (v3.0.x): reconstruct from topOpportunities
        loadedOpps = entry.topOpportunities.map(t => ({
          id: 'hist_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          market: t.market || 'CSFloat',
          marketName: t.marketName || '',
          listedPrice: t.listedPrice || 0,
          realValue: t.realValue || 0,
          skinValue: t.realValue || 0,
          charmValue: 0,
          stickerValue: 0,
          accessoryPct: 0,
          netProfit: t.netProfit || 0,
          netProfitWhole: t.netProfit || 0,
          netProfitSeparate: t.netProfit || 0,
          profitPct: t.listedPrice && t.netProfit ? Math.round((t.netProfit / t.listedPrice) * 1000) / 10 : 0,
          discountPct: t.discountPct || 0,
          opportunityScore: t.opportunityScore || 0,
          confidence: 0,
          bestStrategy: t.bestStrategy || 'whole',
          skinLiquidity: 0,
          skinVolume: 0,
          isCharmOpportunity: t.hasCharms || false,
          isStickerOpportunity: t.hasStickers || false,
          isMispriced: false,
          csfloatUrl: t.marketName ? `https://csfloat.com/search?q=${encodeURIComponent(t.marketName)}` : 'https://csfloat.com/',
          steamUrl: t.marketName ? `https://steamcommunity.com/market/listings/730/${encodeURIComponent(t.marketName)}` : 'https://steamcommunity.com/market/',
          uncertainItems: null,
          crossMarket: null,
          charms: [],
          stickers: [],
          timeDetected: Date.now(),
        }));
      }

      // Track that these results came from history (for the badge in renderResults)
      engine._historyLabel = entry.label || 'historial';
      engine.opportunities = loadedOpps.sort((a, b) => b.opportunityScore - a.opportunityScore);
      $('snipHistoryPanel')?.classList.remove('open');
      renderResults();
      showToast(`📂 Cargados ${entry.count || loadedOpps.length} resultados del ${engine._historyLabel}`, 'info');
      return;
    }

    // Steam Sniper overlay dismiss
    if (e.target.closest('#sniperAlertDismiss') || e.target.closest('#steamSniperOverlay') && e.target.id === 'steamSniperOverlay') {
      hideKnifeGloveAlert();
      return;
    }

    // Open listing on card click (navega a CSFloat como destino principal)
    const card = e.target.closest('.inv-combo-card');
    if (card && engine && !e.target.closest('a')) {
      const idx = Array.from(card.parentElement?.querySelectorAll('.inv-combo-card') || []).indexOf(card);
      const opp = engine.opportunities[idx];
      if (opp && opp.csfloatUrl) {
        window.open(opp.csfloatUrl, '_blank');
      }
      return;
    }
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (engine) engine.stopPolling();
  });

  // Expose for init.js
  window.initOpportunityEngine = initOpportunityEngine;
  window.renderOpportunityResults = renderResults;
  window.renderOpportunityHistory = renderHistory;
})();
