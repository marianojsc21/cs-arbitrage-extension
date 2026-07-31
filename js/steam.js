/**
 * Steam Client v1.0 — Cliente centralizado de Steam Market (priceoverview)
 * ========================================================================
 * Mismo tratamiento anti-bloqueo que el cliente de CSFloat, aplicado a
 * Steam Market. Steam devuelve HTTP 429 cuando se hacen demasiadas
 * consultas de precios en poco tiempo.
 *
 *  1. CACHÉ COMPARTIDA — la caché de precios (TTL 30 min) es única y se
 *     comparte entre los 3 modos (SteamFarm, Smart Invest, Sniper).
 *     Antes cada modo tenía su propia caché: al escanear 500 items en
 *     un modo y repetir en otro, se re-consultaba todo a Steam.
 *
 *  2. COLA GLOBAL — todas las consultas a priceoverview pasan por una
 *     cola FIFO con un gap mínimo (2.5s ≈ 24 req/min, bajo el límite
 *     de ~20 req/min sostenidos de Steam), evitando ráfagas
 *     simultáneas cuando se escanea de un modo a otro.
 *
 *  3. BACKOFF 429 — retry con espera exponencial (10s → 20s → 40s → 60s).
 *
 *  Además: fallback de variantes de stickers (Holo/Foil/Gold/Glitter/
 *  Crystal) para Market Sniper.
 *
 *  CSP-compliant. Cargar ANTES que app.js / smart-invest.js /
 *  market-sniper.js.
 */
(function() {
  'use strict';

  const STEAM_API = 'https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=';
  const CACHE_TTL = 30 * 60 * 1000;   // 30 min
  const MIN_GAP_MS = 2500;             // gap mínimo entre requests a Steam (~24 req/min, Steam limita ~20/min)
  const STICKER_QUALITY = [' (Holo)', ' (Foil)', ' (Gold)', ' (Glitter)', ' (Crystal)'];

  // ---- Persistencia (chrome.storage.local) ----
  const STORAGE_KEY = 'saintprofit_steam_cache';
  const MAX_PERSISTED_ITEMS = 3000;    // tope de items guardados (evita exceder la cuota de storage)
  const SAVE_DEBOUNCE_MS = 2000;       // guarda como máximo 1 vez cada 2s mientras se escriben precios

  // ---- Caché compartida (todos los modos) ----
  const cache = {};
  let readyPromise = null;             // promise única de carga de la caché persistida
  let saveTimer = null;

  /** Carga la caché persistida de chrome.storage.local (solo entradas frescas) */
  function loadPersistedCache() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (r) => {
          try {
            const saved = r && r[STORAGE_KEY];
            if (saved && typeof saved === 'object') {
              const now = Date.now();
              for (const k of Object.keys(saved)) {
                const v = saved[k];
                if (v && v.price && v.time && now - v.time < CACHE_TTL) {
                  cache[k] = v;
                }
              }
            }
          } catch (e) { /* storage corrupto */ }
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  /** Garantiza que la caché persistida se cargue UNA sola vez (dedup de llamadas concurrentes) */
  function ensureReady() {
    if (!readyPromise) readyPromise = loadPersistedCache();
    return readyPromise;
  }

  /** Escribe la caché a chrome.storage.local (filtra vencidos + top MAX_PERSISTED_ITEMS).
   *  También recorta la caché en memoria con la misma política, para que no
   *  crezca sin límite durante la sesión. */
  function persistNow() {
    try {
      const now = Date.now();
      const entries = Object.entries(cache)
        .filter(([, v]) => v && v.price && now - v.time < CACHE_TTL)
        .sort((a, b) => (b[1].time || 0) - (a[1].time || 0))
        .slice(0, MAX_PERSISTED_ITEMS);
      const toSave = {};
      for (const [k, v] of entries) toSave[k] = v;
      chrome.storage.local.set({ [STORAGE_KEY]: toSave }).catch(() => {});
      // Evicción en memoria: solo quedan los que se guardaron
      const keep = new Set(entries.map(([k]) => k));
      for (const k of Object.keys(cache)) {
        if (!keep.has(k)) delete cache[k];
      }
    } catch (e) { /* noop */ }
  }

  /** Guarda con debounce (máx. 1 escritura cada SAVE_DEBOUNCE_MS) */
  function persistCache() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistNow();
    }, SAVE_DEBOUNCE_MS);
  }

  // Flush al cerrar/recargar la página: no perder la escritura que estaba
  // dentro de la ventana de debounce (justo el caso que motivó la persistencia).
  try {
    window.addEventListener('beforeunload', () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        persistNow();
      }
    });
  } catch (e) { /* noop */ }

  // ---- Cola global ----
  let queue = Promise.resolve();
  let lastRequestTime = 0;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** Ejecuta una función respetando el gap mínimo global entre requests */
  function rateLimited(fn) {
    const run = async () => {
      const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestTime));
      if (wait > 0) await sleep(wait);
      lastRequestTime = Date.now();
      return await fn();
    };
    const p = queue.then(run, run);
    queue = p.then(() => {}, () => {}); // la cola nunca se rompe
    return p;
  }

  /** Fetch a priceoverview con headers + backoff en 429 */
  async function steamFetch(url) {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://steamcommunity.com/market/',
      'Origin': 'https://steamcommunity.com',
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(url, { headers });
      if (resp.status === 429) {
        const waitMs = Math.min(10000 * Math.pow(2, attempt), 60000);
        await sleep(waitMs);
        continue;
      }
      return resp;
    }
    return null; // se agotaron los reintentos
  }

  /** Consulta UN nombre (sin caché) y devuelve { price, volume, time } o null */
  async function fetchOne(name) {
    if (!name) return null;
    const resp = await steamFetch(STEAM_API + encodeURIComponent(name));
    if (!resp || !resp.ok) return null;
    const data = await resp.json();
    if (!data.success || !data.lowest_price) return null;
    const price = parseFloat(data.lowest_price.replace('$', '').replace(',', ''));
    let volume = 0;
    if (data.volume) volume = parseInt(data.volume.replace(/,/g, ''), 10) || 0;
    if (price && price > 0) return { price, volume, time: Date.now() };
    return null;
  }

  /**
   * Obtiene el precio de un item con caché compartida, cola global y
   * persistencia en chrome.storage (los precios sobreviven a recargas).
   * @param {string} name  market_hash_name
   * @param {object} opts  { variants: true } → probar calidades de stickers
   * @returns {object|null} { price, volume, time }
   */
  async function getPrice(name, opts) {
    if (!name) return null;
    // Esperar a que la caché persistida se cargue (una sola vez al arrancar)
    await ensureReady();
    const useVariants = !!(opts && opts.variants);

    const cached = cache[name];
    if (cached && Date.now() - cached.time < CACHE_TTL) return cached;

    return rateLimited(async () => {
      // doble-check bajo la cola (otro modo pudo haberlo cargado)
      const cached2 = cache[name];
      if (cached2 && Date.now() - cached2.time < CACHE_TTL) return cached2;

      let result = await fetchOne(name);

      // Fallback de stickers: si el nombre base no tiene precio y es un
      // sticker sin calidad, probar variantes (Holo/Foil/Gold...).
      if (!result && useVariants && name.includes('Sticker |') && !name.includes('(')) {
        for (const q of STICKER_QUALITY) {
          const alt = await fetchOne(name + q);
          if (alt) { result = alt; break; }
        }
      }

      if (result) {
        cache[name] = result;
        persistCache(); // guarda con debounce para sobrevivir a recargas
      }
      return result;
    });
  }

  window.SteamClient = { getPrice };
})();
