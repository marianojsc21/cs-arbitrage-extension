/**
 * CSFloat Client v1.0 — Cliente centralizado de la API de CSFloat
 * =================================================================
 * Soluciona los bloqueos de rate limit ("too many requests from too
 * many IPs") atacando las 3 causas raíz:
 *
 *  1. API KEY — CSFloat exige `Authorization: Bearer <key>` para tener
 *     límites razonables. Sin key, un IP público se bloquea rápido.
 *     La key se guarda una vez en chrome.storage.local (key: csfloatApiKey).
 *
 *  2. CACHÉ COMPARTIDA — el price-list (~27k items) se cachea 30 min y
 *     se comparte entre los 3 modos (SteamFarm, Smart Invest, Sniper).
 *
 *  3. COLA GLOBAL — todas las llamadas a CSFloat pasan por una cola
 *     FIFO con un gap mínimo entre requests (1.1s), evitando ráfagas
 *     simultáneas cuando se escanea de un modo a otro.
 *
 *  Además: retry con backoff exponencial en HTTP 429.
 *  CSP-compliant (sin inline handlers). Cargar ANTES que app.js /
 *  smart-invest.js / market-sniper.js.
 */
(function() {
  'use strict';

  const DEFAULT_API_KEY = '6gD-aXxbMkbuE_xtgcXaMEWUeWTQWd0P';
  const PRICE_LIST_URL = 'https://csfloat.com/api/v1/listings/price-list';
  const LISTINGS_URL = 'https://csfloat.com/api/v1/listings';

  const PRICE_LIST_TTL = 15 * 60 * 1000;   // 15 min (fresco para arbitraje, sin re-descargar en cada escaneo)
  const MIN_GAP_MS = 1100;                  // gap mínimo entre requests

  let apiKey = DEFAULT_API_KEY;

  // ---- Caché compartida ----
  let priceListCache = null;
  let priceListTime = 0;

  // ---- Cola global ----
  let queue = Promise.resolve();
  let lastRequestTime = 0;

  // Cargar la key guardada (si el usuario la cambió en storage)
  try {
    chrome.storage.local.get(['csfloatApiKey'], (r) => {
      if (r && r.csfloatApiKey) apiKey = String(r.csfloatApiKey).trim() || apiKey;
    });
  } catch (e) { /* storage no disponible */ }

  // Guardar la key por defecto la primera vez
  try {
    chrome.storage.local.get(['csfloatApiKey'], (r) => {
      if (!r || !r.csfloatApiKey) {
        chrome.storage.local.set({ csfloatApiKey: DEFAULT_API_KEY });
      }
    });
  } catch (e) { /* noop */ }

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

  /** Fetch a la API de CSFloat con la key + backoff en 429 */
  async function csfloatFetch(url) {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://csfloat.com/',
      'Origin': 'https://csfloat.com',
    };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    let lastResp = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(url, { headers });
      if (resp.status === 429) {
        lastResp = resp;
        const waitMs = Math.min(12000 * Math.pow(2, attempt), 60000);
        await sleep(waitMs);
        continue;
      }
      if (!resp.ok) {
        let body = '';
        try { body = await resp.text(); } catch (e) {}
        throw new Error(`CSFloat error: ${resp.status} - ${body.slice(0, 200)}`);
      }
      return resp;
    }
    // Se agotaron los reintentos
    let body = '';
    try { if (lastResp) body = await lastResp.text(); } catch (e) {}
    throw new Error(`CSFloat rate limit: ${body.slice(0, 200)}`);
  }

  /** Obtiene el price-list con caché compartida (15 min).
   *  Sin parámetro force: la caché protege de rate limits y se comparte
   *  entre los 3 modos. Si se necesita un refresh forzado puntual, usar
   *  CSFloatClient.getPriceList(true) — NO llamarlo en cada escaneo. */
  async function getPriceList(force) {
    if (!force && priceListCache && Date.now() - priceListTime < PRICE_LIST_TTL) {
      return priceListCache;
    }
    return rateLimited(async () => {
      // doble-check bajo la cola (otro modo pudo haberlo cargado)
      if (!force && priceListCache && Date.now() - priceListTime < PRICE_LIST_TTL) {
        return priceListCache;
      }
      const resp = await csfloatFetch(PRICE_LIST_URL);
      const data = await resp.json();
      priceListCache = data;
      priceListTime = Date.now();
      return data;
    });
  }

  /**
   * Puente por sesión: ejecuta el fetch DENTRO de una pestaña de csfloat.com
   * vía el content script. La API de listings exige estar logueado (cookie de
   * sesión del navegador) y devuelve 403 si no. Este puente usa la sesión que
   * ya está abierta en la pestaña. Si no hay pestaña de csfloat.com, devuelve
   * null y el caller cae al fetch directo (que puede dar 403).
   */
  async function fetchViaSession(url) {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://csfloat.com/*' });
      if (!tabs || !tabs.length) return null;
      for (const tab of tabs.slice(0, 3)) {
        try {
          const res = await chrome.tabs.sendMessage(tab.id, { action: 'csfloatFetch', url });
          if (res && res.ok && res.body) {
            return JSON.parse(res.body);
          }
        } catch (e) { /* tab sin content script o contexto invalidado */ }
      }
    } catch (e) {}
    return null;
  }

  /** Trae listings buy_now paginados (usado por Market Sniper).
   *  Prioridad: 1) puente por sesión de csfloat.com (evita el 403 de login),
   *  2) fetch directo con key + cola + backoff. */
  async function fetchListings(maxListings) {
    const limit = Math.max(1, Math.min(parseInt(maxListings, 10) || 100, 500));
    const listings = [];
    let cursor = null;
    const BATCH_SIZE = 10;
    let fetched = 0;

    while (fetched < limit) {
      let url = `${LISTINGS_URL}?limit=${BATCH_SIZE}&types=buy_now`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      const data = await rateLimited(async () => {
        // 1) Sesión del navegador (content script en csfloat.com)
        const viaSession = await fetchViaSession(url);
        if (viaSession) return viaSession;
        // 2) Directo con key
        const resp = await csfloatFetch(url);
        return resp.json();
      });

      const batch = data.data || data || [];
      if (!batch.length) break;
      for (const l of batch) {
        if (l.type && l.type !== 'purchase') continue;
        if (l.state && l.state !== 'published') continue;
        listings.push(l);
        fetched++;
        if (fetched >= limit) break;
      }
      cursor = data.cursor || data.next_cursor || null;
      if (!cursor && batch.length < BATCH_SIZE) break;
    }
    return listings;
  }

  window.CSFloatClient = { getPriceList, fetchListings, fetchViaSession };
})();
