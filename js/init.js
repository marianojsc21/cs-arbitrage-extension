// Mode switching — now shows columns (1 active, rest minimized)
function switchMode(mode) {
  const profitCol = document.querySelector('.profit-col');
  const invCol = document.querySelector('.invest-col');
  const sniperCol = document.querySelector('.sniper-col');
  const dashboard = document.querySelector('.dashboard');

  // Remove all mode-specific classes
  dashboard.classList.remove('mode-profit', 'mode-invest', 'mode-sniper');

  // Reset ALL columns: visible + inactive
  [profitCol, invCol, sniperCol].forEach(col => {
    if (col) {
      col.classList.remove('active');
      col.classList.add('inactive');
      col.style.display = '';
    }
  });

  if (mode === 'profit') {
    if (profitCol) { profitCol.classList.remove('inactive'); profitCol.classList.add('active'); }
    dashboard.classList.add('mode-profit');
    // Stop Steam Sniper auto-poll when leaving sniper mode
    if (typeof window.stopSteamSniperAutoScan === 'function') window.stopSteamSniperAutoScan();
  } else if (mode === 'invest') {
    if (invCol) { invCol.classList.remove('inactive'); invCol.classList.add('active'); }
    dashboard.classList.add('mode-invest');
    // Stop Steam Sniper auto-poll when leaving sniper mode
    if (typeof window.stopSteamSniperAutoScan === 'function') window.stopSteamSniperAutoScan();
  } else if (mode === 'sniper') {
    if (sniperCol) { sniperCol.classList.remove('inactive'); sniperCol.classList.add('active'); }
    dashboard.classList.add('mode-sniper');
    // Restart Steam Sniper auto-poll when entering sniper mode
    if (typeof window.startSteamSniperAutoScan === 'function') window.startSteamSniperAutoScan();
  }
  // Highlight the corresponding filter card
  updateFilterCardHighlight(mode);
}

function updateFilterCardHighlight(mode) {
  document.querySelectorAll('.filters-col .filter-card').forEach(card => {
    if (card.dataset.mode === mode) {
      card.classList.add('filter-card-active');
      card.classList.remove('filter-card-inactive');
    } else {
      card.classList.remove('filter-card-active');
      card.classList.add('filter-card-inactive');
    }
  });
}

// Event delegation for mode switching and logo click (no inline onclick to avoid CSP)
document.addEventListener('click', (e) => {
  // Logo/brand click → SteamFarm mode
  const brandImage = e.target.closest('.brand-col img, .brand-col .brand-image');
  if (brandImage) {
    switchMode('profit');
    return;
  }
  // Mode title click → switch to that mode
  const modeTitle = e.target.closest('.mode-title[data-mode]');
  if (modeTitle) {
    switchMode(modeTitle.dataset.mode);
    return;
  }

  // Filter card header click → switch to that mode (for inactive/minimized filters)
  const filterCard = e.target.closest('.filter-card[data-mode]');
  if (filterCard) {
    const mode = filterCard.dataset.mode;
    // Only switch if clicking an inactive card (active card click does nothing)
    if (filterCard.classList.contains('filter-card-inactive')) {
      switchMode(mode);
    }
  }
});

// ===== HISTORICAL TOP 5 =====
function renderHistoricalTop5() {
  // Load profit history
  let profitHistory = [];
  try {
    const raw = StorageHelper.getItem('saintprofit_history');
    if (raw) profitHistory = JSON.parse(raw);
  } catch(e) {}

  // Profit Top 5: aggregate all topResults sorted by profit% desc
  const allProfitItems = [];
  const seenProfit = new Set();
  for (const entry of profitHistory) {
    const top = entry.topResults || [];
    for (const item of top) {
      if (!seenProfit.has(item.name)) {
        seenProfit.add(item.name);
        allProfitItems.push({ ...item });
      }
    }
  }
  allProfitItems.sort((a, b) => (b.pct || 0) - (a.pct || 0));
  const profitTop5 = allProfitItems.slice(0, 7);

  function rankClass(i) {
    if (i === 0) return 'gold';
    if (i === 1) return 'silver';
    if (i === 2) return 'bronze';
    return '';
  }

  const profitList = document.getElementById('ht5List');
  if (profitList) {
    if (profitTop5.length === 0) {
      profitList.innerHTML = '<div class="ht5-empty">Sin datos históricos</div>';
    } else {
      profitList.innerHTML = profitTop5.map((item, i) => {
        const valClass = item.pct >= 50 ? 'green' : 'orange';
        const rank = rankClass(i);
        return `<div class="ht5-item" data-name="${item.name.replace(/"/g, '&quot;')}">
          <div class="ht5-item-top">
            <span class="ht5-rank ${rank}">#${i + 1}</span>
            <span class="ht5-name">${item.name}</span>
          </div>
          <div class="ht5-item-bottom">
            <span class="ht5-usd">+$${(item.usd || 0).toFixed(2)}</span>
            <span class="ht5-value ${valClass}">${(item.pct || 0).toFixed(0)}%</span>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Smart Invest Top 7: aggregate by highest score from history
  let invHistory = [];
  try {
    const raw = StorageHelper.getItem('saintprofit_invest_history');
    if (raw) invHistory = JSON.parse(raw);
  } catch(e) {}

  const allInvItems = [];
  const seenInv = new Set();
  for (const entry of invHistory) {
    const top = entry.topCombinations || [];
    for (const item of top) {
      const key = item.items ? item.items.join('|') : item.score + '_' + item.cost;
      if (!seenInv.has(key)) {
        seenInv.add(key);
        allInvItems.push({ ...item });
      }
    }
  }
  allInvItems.sort((a, b) => (b.score || 0) - (a.score || 0));
  const invTop7 = allInvItems.slice(0, 7);

  const invList = document.getElementById('invHt5List');
  if (invList) {
    if (invTop7.length === 0) {
      invList.innerHTML = '<div class="ht5-empty">Sin datos históricos</div>';
    } else {
      invList.innerHTML = invTop7.map((item, i) => {
        const rank = rankClass(i);
        const name = item.items ? item.items[0] : ('Combo #' + (i + 1));
        const itemsCount = item.itemCount || (item.items ? item.items.length : 1);
        return `<div class="ht5-item" data-name="${name.replace(/"/g, '&quot;')}">
          <div class="ht5-item-top">
            <span class="ht5-rank ${rank}">#${i + 1}</span>
            <span class="ht5-name">${itemsCount > 1 ? '📦 ' : ''}${name}${itemsCount > 1 ? ' +' + (itemsCount - 1) : ''}</span>
          </div>
          <div class="ht5-item-bottom">
            <span class="ht5-usd">$${(item.profitUsd || 0).toFixed(2)}</span>
            <span class="ht5-value green">${(item.profitPct || 0).toFixed(1)}%</span>
            <span class="ht5-value" style="color:var(--accent-1);font-weight:700;font-size:0.55rem">${(item.score || 0)}pts</span>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Cross-Market Opportunities Top 7: aggregate by highest opportunity score
  let sniperHistory = [];
  try {
    const raw = StorageHelper.getItem('saintprofit_opportunity_history');
    if (raw) sniperHistory = JSON.parse(raw);
  } catch(e) {}

  const allSnipItems = [];
  const seenSnip = new Set();
  for (const entry of sniperHistory) {
    const top = entry.topOpportunities || [];
    for (const item of top) {
      const key = item.marketName || (item.opportunityScore + '_' + item.netProfit);
      if (!seenSnip.has(key)) {
        seenSnip.add(key);
        allSnipItems.push({ ...item });
      }
    }
  }
  allSnipItems.sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0));
  const snipTop7 = allSnipItems.slice(0, 7);

  const snipList = document.getElementById('snipHt5List');
  if (snipList) {
    if (snipTop7.length === 0) {
      snipList.innerHTML = '<div class="ht5-empty">Sin datos históricos</div>';
    } else {
      snipList.innerHTML = snipTop7.map((item, i) => {
        const rank = rankClass(i);
        const name = item.marketName || ('Oportunidad #' + (i + 1));
        const icon = item.hasCharms || item.hasStickers ? '🧩 ' : '🔥 ';
        return `<div class="ht5-item" data-name="${name.replace(/"/g, '&quot;')}">
          <div class="ht5-item-top">
            <span class="ht5-rank ${rank}">#${i + 1}</span>
            <span class="ht5-name">${icon}${name}</span>
          </div>
          <div class="ht5-item-bottom">
            <span class="ht5-usd">+$${(item.netProfit || 0).toFixed(2)}</span>
            <span class="ht5-value green">${(item.discountPct || 0).toFixed(0)}%</span>
            <span class="ht5-value" style="color:var(--accent-1);font-weight:700;font-size:0.55rem">${(item.opportunityScore || 0)}pts</span>
          </div>
        </div>`;
      }).join('');
    }
  }
}

// Event delegation: click on Top 7 item → open link según modo activo
function openTopItem(e) {
  const item = e.target.closest('.ht5-item');
  if (!item) return;
  const name = item.dataset.name;
  if (!name) return;

  // Determinar el modo activo
  const invCol = document.querySelector('.invest-col');
  const sniperCol = document.querySelector('.sniper-col');
  const isInvest = invCol && invCol.classList.contains('active');
  const isSniper = sniperCol && sniperCol.classList.contains('active');

  if (isInvest) {
    // En Smart Invest → abrir CSFloat (es donde se compra)
    const url = `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}`;
    window.open(url, '_blank');
  } else if (isSniper) {
    // En Market Sniper → abrir CSFloat search
    const url = `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}`;
    window.open(url, '_blank');
  } else {
    // En SteamFarm → abrir CSFloat
    const url = `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}`;
    window.open(url, '_blank');
  }
}

document.addEventListener('click', openTopItem);

// Read ?mode= from URL and switch to that mode, defaulting to profit
function initModeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode === 'invest' || mode === 'profit' || mode === 'sniper') {
    switchMode(mode);
  } else {
    switchMode('profit');
  }
}
initModeFromUrl();

// Trigger entrance animation: double rAF guarantees one paint at opacity 0 first
// then removing the class triggers the CSS transition (0 → target opacity)
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.body.classList.remove('page-loading');
  });
});

// Render Top 5 from historical data — esperar a que StorageHelper termine migración
function initHistoricalTop5() {
  renderHistoricalTop5();

  // Initialize Cross-Market Opportunity engine
  if (document.querySelector('.sniper-col') && typeof window.initOpportunityEngine === 'function') {
    window.initOpportunityEngine();
  }
}

if (window.StorageHelper && !window.StorageHelper._ready) {
  window.addEventListener('storage-ready', initHistoricalTop5);
} else {
  initHistoricalTop5();
}

// Expose function globally so app.js can call it after saving new scans
window.renderHistoricalTop5 = renderHistoricalTop5;

// ===== THEME SYSTEM =====
const THEME_STORAGE_KEY = 'saintprofit_theme';
const THEMES = ['amber', 'white', 'night'];
const THEME_NAMES = { amber: 'Amber', white: 'Blanco', night: 'Night' };

function setTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'amber'; // Amber es el tema principal
  document.documentElement.setAttribute('data-theme', theme);
  StorageHelper.setItem(THEME_STORAGE_KEY, theme);

  // Update popup items
  document.querySelectorAll('.theme-popup-item').forEach(el => {
    const isActive = el.dataset.themeVal === theme;
    el.classList.toggle('active', isActive);
  });

  // Update toggle button dot + label
  const dot = document.getElementById('themeDot');
  const label = document.getElementById('themeLabel');
  if (dot) {
    dot.className = 'theme-dot ' + theme;
  }
  if (label) {
    label.textContent = THEME_NAMES[theme] || 'Tema';
  }
}

// Load saved theme or default (Amber es el principal)
document.addEventListener('DOMContentLoaded', () => {
  const saved = StorageHelper.getItem(THEME_STORAGE_KEY);
  setTheme(saved || 'amber');
});
// Also run now if DOM already ready
if (document.readyState !== 'loading') {
  const saved = StorageHelper.getItem(THEME_STORAGE_KEY);
  setTheme(saved || 'amber');
}

// Theme toggle: click toggle button → show/hide popup, click item → set theme, click outside → close
const themeToggle = document.getElementById('themeToggle');
const themePopup = document.getElementById('themePopup');

if (themeToggle && themePopup) {
  themeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    themePopup.classList.toggle('show');
  });

  themePopup.addEventListener('click', (e) => {
    const item = e.target.closest('.theme-popup-item');
    if (item) {
      const theme = item.dataset.themeVal;
      setTheme(theme);
      themePopup.classList.remove('show');
      showToastTheme(`🎨 Tema cambiado a ${THEME_NAMES[theme] || theme}`, 'info');
    }
  });

  document.addEventListener('click', (e) => {
    if (!themeToggle.contains(e.target) && !themePopup.contains(e.target)) {
      themePopup.classList.remove('show');
    }
  });
}

function showToastTheme(msg, type) {
  if (typeof window._spToast === 'function') {
    window._spToast(msg, type);
  }
}

// ===== UPDATE BADGE =====
// Muestra "🆕 Nueva versión disponible" en el footer cuando el auto-update
// detecta una versión más nueva en GitHub. Clic → descarga la actualización.
function initUpdateBadge() {
  const badge = document.getElementById('updateBadge');
  const versionEl = document.getElementById('updateBadgeVersion');
  if (!badge || !versionEl) return;
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;

  function showBadge(remoteVersion) {
    if (remoteVersion) versionEl.textContent = remoteVersion;
    badge.style.display = 'inline-flex';
  }

  // 1) Lectura rápida del estado guardado por el service worker (sin red)
  chrome.runtime.sendMessage({ action: 'getConfig' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp && resp.updateAvailable) {
      showBadge(resp.remoteVersion);
      showToastTheme('🆕 Nueva versión disponible: v' + (resp.remoteVersion || ''), 'info');
    }
  });

  // 2) Check en vivo contra GitHub (el SW también lo hace cada hora).
  //    Si el check en vivo dice que ya NO hay update, ocultar el badge
  //    por si getConfig leyó un storage viejo (hasta 1h de desfase).
  chrome.runtime.sendMessage({ action: 'checkUpdate' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp && resp.available) {
      showBadge(resp.remote);
    } else if (resp && !resp.available && !badge.classList.contains('updating')) {
      badge.style.display = 'none';
    }
  });

  // 3) Clic → descargar e instalar la actualización
  badge.addEventListener('click', () => {
    if (badge.classList.contains('updating')) return;
    badge.classList.add('updating');
    badge.textContent = '⏳ Actualizando...';
    chrome.runtime.sendMessage({ action: 'performUpdate' }, (resp) => {
      badge.classList.remove('updating');
      if (resp && resp.success) {
        badge.textContent = '✅ Actualizado a v' + resp.version;
        showToastTheme('✅ Actualizado a v' + resp.version + '. Recargá la extensión (chrome://extensions) para aplicar los cambios.', 'success');
        setTimeout(() => { badge.style.display = 'none'; }, 5000);
      } else {
        badge.textContent = '❌ Error al actualizar';
        showToastTheme('❌ Error al actualizar: ' + ((resp && resp.error) || 'desconocido'), 'error');
        // Restaurar badge para reintentar
        const v = versionEl.textContent;
        badge.textContent = '';
        badge.appendChild(document.createTextNode('🆕 Nueva versión: v'));
        badge.appendChild(versionEl);
        versionEl.textContent = v || '';
      }
    });
  });
}

// Correr cuando el DOM esté listo (con retardo para no competir con el render inicial)
if (document.readyState !== 'loading') {
  setTimeout(initUpdateBadge, 1500);
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initUpdateBadge, 1500));
}
