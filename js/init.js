// Mode switching — now only toggles column width, filters are always visible
function switchMode(mode) {
  const profitCol = document.querySelector('.profit-col');
  const capCol = document.querySelector('.cap-col');
  const dashboard = document.querySelector('.dashboard');

  if (mode === 'profit') {
    profitCol.classList.remove('inactive');
    profitCol.classList.add('active');
    capCol.classList.remove('active');
    capCol.classList.add('inactive');
    dashboard.classList.remove('mode-capitallet');
    dashboard.classList.add('mode-profit');
  } else {
    capCol.classList.remove('inactive');
    capCol.classList.add('active');
    profitCol.classList.remove('active');
    profitCol.classList.add('inactive');
    dashboard.classList.remove('mode-profit');
    dashboard.classList.add('mode-capitallet');
  }
}

// Event delegation for mode switching (no inline onclick to avoid CSP)
document.addEventListener('click', (e) => {
  const modeTitle = e.target.closest('.mode-title[data-mode]');
  if (modeTitle) {
    switchMode(modeTitle.dataset.mode);
  }
});

// ===== HISTORICAL TOP 5 =====
function renderHistoricalTop5() {
  // Load profit history
  let profitHistory = [];
  try {
    const raw = localStorage.getItem('saintprofit_history');
    if (raw) profitHistory = JSON.parse(raw);
  } catch(e) {}

  // Load capitallet history
  let capHistory = [];
  try {
    const raw = localStorage.getItem('saintprofit_cap_history');
    if (raw) capHistory = JSON.parse(raw);
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

  // Capitallet Top 5: aggregate by smallest difference
  const allCapItems = [];
  const seenCap = new Set();
  for (const entry of capHistory) {
    const top = entry.topResults || [];
    for (const item of top) {
      if (!seenCap.has(item.name)) {
        seenCap.add(item.name);
        allCapItems.push({ ...item });
      }
    }
  }
  allCapItems.sort((a, b) => Math.abs(a.diffPct || 0) - Math.abs(b.diffPct || 0));
  const capTop5 = allCapItems.slice(0, 7);

  const capList = document.getElementById('capHt5List');
  if (capList) {
    if (capTop5.length === 0) {
      capList.innerHTML = '<div class="ht5-empty">Sin datos históricos</div>';
    } else {
      capList.innerHTML = capTop5.map((item, i) => {
        const valClass = Math.abs(item.diffPct || 0) <= 1 ? 'green' : 'orange';
        const rank = rankClass(i);
        const diff = (item.diff || 0);
        return `<div class="ht5-item" data-name="${item.name.replace(/"/g, '&quot;')}">
          <div class="ht5-item-top">
            <span class="ht5-rank ${rank}">#${i + 1}</span>
            <span class="ht5-name">${item.name}</span>
          </div>
          <div class="ht5-item-bottom">
            <span class="ht5-usd ${diff >= 0 ? 'green' : ''}">${diff >= 0 ? '+' : ''}$${Math.abs(diff).toFixed(2)}</span>
            <span class="ht5-value ${valClass}">${item.diffPct >= 0 ? '+' : ''}${(item.diffPct || 0).toFixed(1)}%</span>
          </div>
        </div>`;
      }).join('');
    }
  }
}

// Event delegation: click on Top 7 item → open CSFloat
function openItemCSFloat(e) {
  const item = e.target.closest('.ht5-item');
  if (!item) return;
  const name = item.dataset.name;
  if (!name) return;
  const url = `https://csfloat.com/search?market_hash_name=${encodeURIComponent(name)}`;
  window.open(url, '_blank');
}

document.addEventListener('click', openItemCSFloat);

// Start with profit mode active by default
switchMode('profit');

// Render Top 5 from historical data (script runs at bottom of body, DOM is ready)
renderHistoricalTop5();

// Expose function globally so app.js can call it after saving new scans
window.renderHistoricalTop5 = renderHistoricalTop5;
