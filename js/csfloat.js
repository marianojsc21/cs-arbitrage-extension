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

  // ---- Persistencia (chrome.storage.local) ----
  const STORAGE_KEY = 'saintprofit_csfloat_pricelist';
  const SAVE_DEBOUNCE_MS = 2000;       // guarda como máximo 1 vez cada 2s
  let readyPromise = null;              // promise única de carga de la caché persistida
  let saveTimer = null;

  /** Carga la caché persistida de chrome.storage.local (solo si está fresca) */
  function loadPersistedPriceList() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (r) => {
          try {
            const saved = r && r[STORAGE_KEY];
            if (saved && saved.cache && saved.time && Date.now() - saved.time < PRICE_LIST_TTL) {
              priceListCache = saved.cache;
              priceListTime = saved.time;
            }
          } catch (e) { /* storage corrupto */ }
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  /** Garantiza que la caché persistida se cargue UNA sola vez (dedup de llamadas concurrentes) */
  function ensureReady() {
    if (!readyPromise) readyPromise = loadPersistedPriceList();
    return readyPromise;
  }

  /** Escribe la caché a chrome.storage.local (array + timestamp) */
  function persistNow() {
    try {
      if (priceListCache && priceListTime > 0) {
        chrome.storage.local.set({ [STORAGE_KEY]: { cache: priceListCache, time: priceListTime } }).catch(() => {});
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
  // dentro de la ventana de debounce.
  try {
    window.addEventListener('beforeunload', () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        persistNow();
      }
    });
  } catch (e) { /* noop */ }

  // Eager load: cargar la caché persistida apenas arranca el módulo, para que
  // getCacheInfo() (el indicador de caché de la UI) sea correcto desde el
  // primer paint tras una recarga, sin esperar al primer escaneo.
  ensureReady().catch(() => {});

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

    let lastBody = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(url, { headers });
      if (resp.status === 429) {
        try { lastBody = await resp.text(); } catch (e) { lastBody = ''; }
        // Bloqueo LARGO: "too many requests from too many IPs" significa que la
        // IP ya está marcada — reintentar 2.4 min no sirve y empeora el bloqueo.
        // Cortamos de inmediato y dejamos que el cooldown de 5 min haga efecto.
        if (/too many requests from too many IPs/i.test(lastBody)) break;
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
    // Se agotaron los reintentos (o bloqueo largo detectado)
    throw new Error(`CSFloat rate limit: ${lastBody.slice(0, 200)}`);
  }

  /** Obtiene el price-list con caché compartida (15 min).
   *  Sin parámetro force: la caché protege de rate limits y se comparte
   *  entre los 3 modos. Si se necesita un refresh forzado puntual, usar
   *  CSFloatClient.getPriceList(true) — NO llamarlo en cada escaneo. */
  async function getPriceList(force) {
    // Esperar a que la caché persistida se cargue (una sola vez al arrancar)
    await ensureReady();
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
      persistCache(); // guarda con debounce para sobrevivir a recargas
      return data;
    });
  }

  // ---- Sesión de csfloat.com (puente por content script) ----
  let sessionTabId = null;   // pestaña que abrimos/cacheamos para la sesión
  let sessionTabPromise = null; // dedup: evita abrir 2 pestañas si hay llamadas concurrentes

  /** Emite un evento de aviso a la UI (la pestaña se va a abrir) */
  function emitAutoOpenNotice(kind) {
    try {
      window.dispatchEvent(new CustomEvent('csfloat-session-' + kind));
    } catch (e) { /* sin UI disponible */ }
  }

  /**
   * Asegura que exista una pestaña de csfloat.com con el content script
   * listo para el puente de sesión. Si no hay ninguna abierta, la abre en
   * segundo plano (active:false) y espera a que el content script responda
   * al ping. Devuelve el tabId o null si no se pudo.
   *
   *  - Evita el 403 "you need to be logged in" abriendo csfloat.com solo.
   *  - Abre con active:false para no robar el foco al usuario.
   *  - Cachea el tabId para reutilizarlo en llamadas siguientes.
   *  - Dedup: llamadas concurrentes comparten la misma operación en curso
   *    (evita abrir 2 pestañas si dos scans piden la sesión a la vez).
   */
  async function ensureSessionTab() {
    if (sessionTabPromise) return sessionTabPromise;
    sessionTabPromise = doEnsureSessionTab();
    try {
      return await sessionTabPromise;
    } finally {
      sessionTabPromise = null;
    }
  }

  async function doEnsureSessionTab() {
    try {
      // 1) Reutilizar la pestaña que ya validamos
      if (sessionTabId) {
        try {
          const t = await chrome.tabs.get(sessionTabId);
          if (t && t.id) {
            // Verificar que el content script sigue respondiendo
            try {
              await chrome.tabs.sendMessage(sessionTabId, { action: 'ping' });
              return sessionTabId;
            } catch (e) { /* content script caído → seguir a reutilizar otra */ }
          }
        } catch (e) { /* pestaña cerrada */ }
        sessionTabId = null;
      }

      // 2) Buscar una pestaña de csfloat.com ya abierta por el usuario.
      //    Solo sirve si su content script responde al ping (si no, pudo
      //    cargarse antes de recargar la extensión o estar descartada).
      const tabs = await chrome.tabs.query({ url: 'https://csfloat.com/*' });
      for (const t of tabs || []) {
        try {
          await chrome.tabs.sendMessage(t.id, { action: 'ping' });
          sessionTabId = t.id;
          return sessionTabId;
        } catch (e) { /* tab sin content script → probar la siguiente */ }
      }

      // 3) No hay ninguna: avisar a la UI y abrir en segundo plano
      emitAutoOpenNotice('opening');
      const tab = await chrome.tabs.create({ url: 'https://csfloat.com/search', active: false });
      if (!tab || !tab.id) return null;
      sessionTabId = tab.id;

      // 4) Esperar a que cargue y el content script responda al ping
      const deadline = Date.now() + 20000; // hasta 20s
      while (Date.now() < deadline) {
        try {
          const res = await chrome.tabs.sendMessage(sessionTabId, { action: 'ping' });
          if (res && res.ok) {
            emitAutoOpenNotice('ready');
            return sessionTabId;
          }
        } catch (e) { /* todavía cargando */ }
        await sleep(500);
      }
      // Si no respondió en 20s, devolvemos el tab igual; el caller reintentará
      return sessionTabId;
    } catch (e) {
      return null;
    }
  }

  /**
   * Puente por sesión: ejecuta el fetch DENTRO de una pestaña de csfloat.com
   * vía el content script. La API de listings exige estar logueado (cookie de
   * sesión del navegador) y devuelve 403 si no. Este puente usa la sesión que
   * ya está abierta en la pestaña. Si no hay pestaña de csfloat.com, la abre
   * automáticamente en segundo plano (ensureSessionTab). Si aún así no se
   * puede, devuelve null y el caller cae al fetch directo (que puede dar 403).
   */
  async function fetchViaSession(url) {
    try {
      const tabId = await ensureSessionTab();
      if (!tabId) return null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await chrome.tabs.sendMessage(tabId, { action: 'csfloatFetch', url });
          if (res && res.ok && res.body) {
            return JSON.parse(res.body);
          }
          if (res && res.error) return null;
        } catch (e) { /* content script todavía no listo */ }
        await sleep(700);
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
    // 50 es el límite MÁXIMO que acepta la API de CSFloat por página.
    // Antes usábamos 10 → 120 listings = 12 requests por escaneo.
    // Con 50 → 3 requests (4x menos) y mucho menos riesgo de rate limit.
    const BATCH_SIZE = 50;
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

  /** Información de la caché del price-list para la UI.
   *  Devuelve { cached, ageMs, ttlMs } — usado por el indicador
   *  "Precios de hace X min" en la página. */
  function getCacheInfo() {
    return {
      cached: !!(priceListCache && priceListTime > 0),
      ageMs: priceListTime > 0 ? Date.now() - priceListTime : 0,
      ttlMs: PRICE_LIST_TTL,
    };
  }

  window.CSFloatClient = { getPriceList, fetchListings, fetchViaSession, getCacheInfo, ensureSessionTab };
})();
