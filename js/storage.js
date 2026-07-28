/**
 * Storage Helper — Persistencia dual
 * =====================================
 * Escribe en localStorage (rápido, síncrono) Y en chrome.storage.local (persistente).
 * Al iniciar, si localStorage está vacío, restaura desde chrome.storage.
 *
 * Así el historial sobrevive a reinstalaciones de la extensión.
 */
(function() {
  'use strict';

  const STORAGE_KEYS = [
    'saintprofit_history',
    'saintprofit_invest_history',
    'saintprofit_opportunity_history',
    'saintprofit_invest_fees',
    'saintprofit_price_history',
    'saintprofit_invest_favorites',
    'saintprofit_theme',
    'profitMostSold',
    'profitFilter',
    'minPrice',
    'maxPrice',
    'categoryFilter',
    'maxItemsFilter',
    'profitSort',
  ];

  const StorageHelper = {
    _ready: false,
    _readyCallbacks: [],

    /**
     * Inicializa: restaura desde chrome.storage si localStorage está vacío.
     *
     * OPTIMIZACIÓN:
     * - Si localStorage ya tiene datos (caso normal): _ready = true inmediato, SIN async.
     * - Si localStorage está vacío (reinstall): migración async + dispatch storage-ready.
     */
    async _init() {
      // Primero verificar si localStorage ya tiene datos (caso normal)
      const hasLocalData = STORAGE_KEYS.some(key => {
        try { return localStorage.getItem(key) !== null; } catch(e) { return false; }
      });

      if (hasLocalData) {
        // Ya tenemos datos en localStorage — listo inmediatamente (sin esperar async)
        this._ready = true;
        this._readyCallbacks.forEach(cb => { try { cb(); } catch(e) {} });
        this._readyCallbacks = [];
        // Igual sincronizamos a chrome.storage en background (no blocking)
        this._syncToChrome();
        return;
      }

      // localStorage vacío → migrar desde chrome.storage (async, solo pasa en reinstall)
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const result = await chrome.storage.local.get(STORAGE_KEYS);
          let restored = 0;
          for (const key of STORAGE_KEYS) {
            if (result[key] !== undefined) {
              const val = typeof result[key] === 'string' ? result[key] : JSON.stringify(result[key]);
              try { localStorage.setItem(key, val); restored++; } catch(e) {}
            }
          }
          if (restored > 0) {
            console.log(`[StorageHelper] Restaurados ${restored} items desde chrome.storage.local`);
          }
        }
      } catch(e) {
        // chrome.storage no disponible (ej: contexto no-extension)
      }

      this._ready = true;
      this._readyCallbacks.forEach(cb => { try { cb(); } catch(e) {} });
      this._readyCallbacks = [];

      // Notificar a scripts que esperaban datos (app.js/init.js)
      try { window.dispatchEvent(new CustomEvent('storage-ready')); } catch(e) {}
    },

    /**
     * (Interno) Sincroniza datos de localStorage a chrome.storage en background.
     * Útil para migrar datos de usuarios que ya tenían localStorage antes de este cambio.
     */
    async _syncToChrome() {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const payload = {};
          for (const key of STORAGE_KEYS) {
            try {
              const val = localStorage.getItem(key);
              if (val !== null) payload[key] = val;
            } catch(e) {}
          }
          if (Object.keys(payload).length > 0) {
            await chrome.storage.local.set(payload);
          }
        }
      } catch(e) {}
    },

    /**
     * Ejecuta callback cuando el helper está listo (migración completa).
     */
    onReady(cb) {
      if (this._ready) { try { cb(); } catch(e) {} }
      else { this._readyCallbacks.push(cb); }
    },

    /**
     * Lee un item (desde localStorage, que es síncrono).
     */
    getItem(key) {
      try { return localStorage.getItem(key); } catch(e) { return null; }
    },

    /**
     * Escribe un item en localStorage Y chrome.storage.local.
     */
    setItem(key, value) {
      // localStorage (síncrono, siempre disponible)
      try { localStorage.setItem(key, value); } catch(e) {}

      // chrome.storage.local (asíncrono, fire-and-forget)
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [key]: value }).catch(() => {});
        }
      } catch(e) {}
    },

    /**
     * Elimina un item de localStorage Y chrome.storage.local.
     */
    removeItem(key) {
      try { localStorage.removeItem(key); } catch(e) {}
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.remove(key).catch(() => {});
        }
      } catch(e) {}
    },

    /**
     * Obtiene TODOS los items de las keys especificadas desde chrome.storage.local.
     * Útil para migración forzada.
     */
    async getAllFromChromeStorage(keys) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          return await chrome.storage.local.get(keys || STORAGE_KEYS);
        }
      } catch(e) {}
      return {};
    },
  };

  // Iniciar migración inmediatamente
  StorageHelper._init();

  // Exponer globalmente
  window.StorageHelper = StorageHelper;
})();
