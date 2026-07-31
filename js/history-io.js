/**
 * History IO — Exportar / Importar historial de los 3 modos como JSON
 * =====================================================================
 * Permite respaldar o mover entre dispositivos el historial de:
 *   - SteamFarm        → saintprofit_history
 *   - Smart Invest     → saintprofit_invest_history
 *   - Market Sniper    → saintprofit_opportunity_history
 *
 * Export: descarga un archivo JSON con todas las entradas del modo.
 * Import: lee un archivo JSON (el nuestro o uno de otra instalación)
 *         y reemplaza el historial del modo correspondiente.
 *
 * CSP-compliant: sin inline handlers, todo via addEventListener.
 */
(function() {
  'use strict';

  const HISTORY_MODES = [
    { id: 'profit',     key: 'saintprofit_history',               label: 'SteamFarm',     emoji: '💵', file: 'saintprofit-steamfarm-history' },
    { id: 'invest',     key: 'saintprofit_invest_history',        label: 'Smart Invest',  emoji: '🧠', file: 'saintprofit-smartinvest-history' },
    { id: 'sniper',     key: 'saintprofit_opportunity_history',   label: 'Market Sniper', emoji: '🎯', file: 'saintprofit-sniper-history' },
  ];

  function toast(msg, type) {
    if (typeof window._spToast === 'function') window._spToast(msg, type);
  }

  function getHistory(mode) {
    try {
      const raw = StorageHelper.getItem(mode.key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function setHistory(mode, history) {
    StorageHelper.setItem(mode.key, JSON.stringify(history));
  }

  function dateStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
  }

  /** Descarga el historial de un modo como archivo JSON */
  function exportMode(mode) {
    const history = getHistory(mode);
    const payload = {
      app: 'SaintProfit',
      type: 'saintprofit-history-backup',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      mode: mode.id,
      modeLabel: mode.label,
      count: history.length,
      history: history,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mode.file}-${dateStamp()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    toast(`${mode.emoji} ${mode.label}: ${history.length} entradas exportadas`, 'success');
  }

  /** Importa un archivo JSON (permite array plano o formato de backup con .history) */
  function importMode(mode, text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      toast(`❌ ${mode.label}: el archivo no es JSON válido`, 'error');
      return;
    }

    // Aceptar: { ... , history: [...] } (backup) o [...] (array plano)
    let history = Array.isArray(data) ? data : (data && Array.isArray(data.history) ? data.history : null);
    if (!history) {
      toast(`❌ ${mode.label}: formato no reconocido (falta 'history')`, 'error');
      return;
    }

    // Sanitizar: solo objetos con id (los renders/restore dependen de él)
    history = history.filter(h => h && typeof h === 'object' && h.id);

    // Respetar el mismo límite que usan los modos al guardar (20 entradas)
    const MAX = 20;
    if (history.length > MAX) {
      history = history.slice(0, MAX);
      toast(`⚠️ ${mode.label}: el archivo tenía más de ${MAX} entradas, se importaron las primeras ${MAX}`, 'warning');
    }

    setHistory(mode, history);
    toast(`${mode.emoji} ${mode.label}: ${history.length} entradas importadas`, 'success');

    // Refrescar UI de cada modo
    refreshModeUI(mode);
  }

  /** Recarga las vistas que dependen del historial de cada modo */
  function refreshModeUI(mode) {
    try {
      // Top 7 histórico global (init.js)
      if (typeof window.renderHistoricalTop5 === 'function') {
        setTimeout(window.renderHistoricalTop5, 300);
      }
      // SteamFarm (app.js)
      if (mode.id === 'profit' && typeof window.refreshSteamFarmHistory === 'function') {
        window.refreshSteamFarmHistory();
      }
      // Smart Invest (smart-invest.js)
      if (mode.id === 'invest' && typeof window.refreshInvestHistory === 'function') {
        window.refreshInvestHistory();
      }
      // Market Sniper (market-sniper.js)
      if (mode.id === 'sniper' && typeof window.refreshSniperHistory === 'function') {
        window.refreshSniperHistory();
      }
    } catch (e) {}
  }

  // ======================================================================
  // UI WIRING (CSP-compliant)
  // ======================================================================

  let pendingImportMode = null;

  function wire() {
    // Botones de exportación
    document.querySelectorAll('.history-export-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = HISTORY_MODES.find(m => m.id === btn.dataset.mode);
        if (mode) exportMode(mode);
      });
    });

    // Botones de importación → abren el file picker
    document.querySelectorAll('.history-import-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = HISTORY_MODES.find(m => m.id === btn.dataset.mode);
        if (!mode) return;
        pendingImportMode = mode;
        const input = document.getElementById('historyImportFile');
        if (input) input.click();
      });
    });

    // File input compartido (oculto)
    const input = document.getElementById('historyImportFile');
    if (input) {
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        // 🔴 Capturar el modo ANTES del readAsText: onload es asíncrono y
        // pendingImportMode ya sería null cuando se ejecute.
        const targetMode = pendingImportMode;
        if (!file || !targetMode) return;
        const reader = new FileReader();
        reader.onload = () => importMode(targetMode, String(reader.result || ''));
        reader.onerror = () => toast('❌ No se pudo leer el archivo', 'error');
        reader.readAsText(file);
        input.value = ''; // permitir re-importar el mismo archivo
        pendingImportMode = null;
      });
    }
  }

  if (document.readyState !== 'loading') {
    wire();
  } else {
    document.addEventListener('DOMContentLoaded', wire);
  }

  // Exportar helpers por si otros scripts los necesitan
  window.HistoryIO = { exportMode, importMode, getHistory, setHistory };
})();
