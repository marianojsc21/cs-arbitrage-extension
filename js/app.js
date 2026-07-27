(async function() {
  'use strict';

  const STORAGE_KEY = 'saintprofit_history';
  const MAX_HISTORY = 20;

  let allResults = [];
  let scanHistory = [];
  let steamCache = {};
  let scanning = false;
  let historyOpen = false;

  const $ = (sel) => document.querySelector(sel);
  const scanBtn = $('#scanBtn');
  const profitFilter = $('#profitFilter');
  const minPrice = $('#minPrice');
  const maxPrice = $('#maxPrice');
  const categoryFilter = $('#categoryFilter');
  const maxItemsFilter = $('#maxItemsFilter');
  const profitSort = $('#profitSort');
  const profitMostSold = $('#profitMostSold');
  const progressContainer = $('#progressContainer');
  const statusText = $('#statusText');
  const progressFill = $('#progressFill');
  const scanCounter = $('#scanCounter');
  const scanTotal = $('#scanTotal');
  const scanTimer = $('#scanTimer');
  let scanTimerInterval = null;
  let scanStartTime = null;

  // ===== HEADER CLICK SORT STATE =====
  let sortColumn = null;
  let sortDirection = 'desc';
  let capSortColumn = null;
  let capSortDirection = 'desc';

  function formatTimer(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }
  const resultsContainer = $('#resultsContainer');
  const historyBtn = $('#historyBtn');
  const historyPanel = $('#historyPanel');
  const historyList = $('#historyList');
  const historyBadge = $('#historyBadge');
  const closeHistoryBtn = $('#closeHistoryBtn');
  const clearHistoryBtn = $('#clearHistoryBtn');

  // ===== SORT FUNCTIONS =====
  const sortFns = {
    'profit-desc': (a, b) => b.profit_percent - a.profit_percent,
    'profit-asc': (a, b) => a.profit_percent - b.profit_percent,
    'profit-usd-desc': (a, b) => b.profit_usd - a.profit_usd,
    'profit-usd-asc': (a, b) => a.profit_usd - b.profit_usd,
    'csfloat-asc': (a, b) => a.csfloat_price - b.csfloat_price,
    'csfloat-desc': (a, b) => b.csfloat_price - a.csfloat_price,
    'stock-desc': (a, b) => (b.quantity || 0) - (a.quantity || 0),
    'stock-asc': (a, b) => (a.quantity || 0) - (b.quantity || 0),
    'volume-desc': (a, b) => (b.steam_volume || 0) - (a.steam_volume || 0),
  };

  // ===== EVENTOS =====
  scanBtn.addEventListener('click', () => {
    if (scanning) stopScan();
    else startScan();
  });
  if (historyBtn) historyBtn.addEventListener('click', toggleHistory);
  if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', closeHistory);
  if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearAllHistory);

  // ===== CATEGORY DETECTION =====
  function detectCategory(name) {
    if (!name) return 'unknown';
    const n = name.toLowerCase();
    if (n.includes('sticker')) return 'stickers';
    if (n.includes('keychain') || n.includes('charm')) return 'keychains';
    if (n.includes('patch')) return 'patches';
    if (n.includes('music kit')) return 'music-kits';
    if (n.includes(' case') || n.endsWith(' case') || n.includes('capsule') || n.includes('package')) return 'containers';
    if (n.includes('gloves') || n.includes('wrap')) return 'gloves';
    const knives = ['knife','bayonet','karambit','m9 ','gut ','falchion','navaja','stiletto','talon','ursus','classic','paracord','survival','nomad','skeleton','bowie','butterfly','shadow daggers','flip '];
    if (knives.some(p => n.includes(p)) || n.includes('\u2605')) return 'knives';
    if (n.includes('agent') || n.includes('operator')) return 'agents';
    if (n.includes('collectible') || n.includes('medal') || n.includes('coin')) return 'collectibles';
    if (n.includes('graffiti')) return 'graffiti';
    return 'skins';
  }

  function getCatEmoji(cat) {
    const map = { skins:'🔫', knives:'🔪', gloves:'🧤', stickers:'🏷️', containers:'📦', agents:'👤', keychains:'🔑', patches:'🪡', 'music-kits':'🎵', collectibles:'🎖️', graffiti:'🎨' };
    return map[cat] || '📦';
  }

  // ===== CSFLOAT API =====
  async function fetchCSFloatPriceList() {
    const resp = await fetch('https://csfloat.com/api/v1/listings/price-list');
    if (!resp.ok) throw new Error(`CSFloat error: ${resp.status}`);
    return await resp.json();
  }

  // ===== STEAM API =====
  // Returns { price, volume } or null
  async function fetchSteamPrice(name) {
    if (steamCache[name] && Date.now() - steamCache[name].time < 1800000) {
      return steamCache[name];
    }
    try {
      const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`;
      const resp = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://steamcommunity.com/market/',
          'Origin': 'https://steamcommunity.com',
        }
      });
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 5000));
        return null;
      }
      const data = await resp.json();
      if (!data.success) return null;
      // Solo usamos lowest_price (precio mínimo actual).
      // NO usamos median_price porque para items de bajo volumen
      // la mediana histórica puede diferir mucho del precio real.
      if (!data.lowest_price) return null;
      let price = parseFloat(data.lowest_price.replace('$', '').replace(',', ''));
      let volume = 0;
      if (data.volume) {
        volume = parseInt(data.volume.replace(/,/g, ''), 10) || 0;
      }
      if (price) {
        const result = { price, volume, time: Date.now() };
        steamCache[name] = result;
        return result;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // ===== MIGRACIÓN DESDE CSMuza (v1.x) =====
  (function migrateOldStorage() {
    const oldKey = 'csmuza_history';
    const oldCapKey = 'csmuza_cap_history';
    const newKey = 'saintprofit_history';
    const newCapKey = 'saintprofit_cap_history';
    const oldData = localStorage.getItem(oldKey);
    if (oldData && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, oldData);
      localStorage.removeItem(oldKey);
    }
    const oldCapData = localStorage.getItem(oldCapKey);
    if (oldCapData && !localStorage.getItem(newCapKey)) {
      localStorage.setItem(newCapKey, oldCapData);
      localStorage.removeItem(oldCapKey);
    }
  })();

  // ===== HISTORIAL =====
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      scanHistory = raw ? JSON.parse(raw) : [];
    } catch(e) { scanHistory = []; }
    renderHistory();
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scanHistory));
    } catch(e) { /* localStorage lleno */ }
    renderHistory();
  }

  function addHistoryEntry(results, filters) {
    const totalProfit = results.reduce((s, r) => s + r.profit_usd, 0);
    const bestProfit = results.length > 0 ? Math.max(...results.map(r => r.profit_percent)) : 0;
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: Date.now(),
      label: new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }),
      filters: {
        category: filters.category || 'all',
        minPrice: filters.minPrice || 0,
        maxPrice: filters.maxPrice || 99999,
        profit: filters.profit || 0,
        maxItems: filters.maxItems || 50,
      },
      stats: {
        total: results.length,
        scanned: filters.scanned || 0,
        avgProfit: results.length > 0 ? totalProfit / results.length : 0,
        bestProfit: bestProfit,
        totalProfit: totalProfit,
        categories: [...new Set(results.map(r => r.category).filter(Boolean))],
      },
      topResults: results.slice(0, 7).map(r => ({
        name: r.market_name,
        cs: r.csfloat_price,
        st: r.steam_price,
        pct: r.profit_percent,
        usd: r.profit_usd,
      })),
      results: results,
    };

    scanHistory.unshift(entry);
    if (scanHistory.length > MAX_HISTORY) {
      scanHistory = scanHistory.slice(0, MAX_HISTORY);
    }
    saveHistory();
  }

  function deleteHistoryEntry(id, e) {
    if (e) { e.stopPropagation(); }
    scanHistory = scanHistory.filter(h => h.id !== id);
    saveHistory();
    if (scanHistory.length === 0) closeHistory();
  }

  function clearAllHistory() {
    if (scanHistory.length === 0) return;
    if (!confirm('¿Borrar todo el historial de búsquedas?')) return;
    scanHistory = [];
    saveHistory();
    closeHistory();
    showToast('🗑️ Historial borrado', 'info');
  }

  function restoreScan(entry) {
    if (!entry || !entry.results || entry.results.length === 0) return;
    allResults = entry.results;
    renderResults();

    // Restaurar filtros de la búsqueda original
    if (entry.filters) {
      if (categoryFilter) categoryFilter.value = entry.filters.category || 'all';
      if (minPrice) minPrice.value = entry.filters.minPrice || 0;
      if (maxPrice) maxPrice.value = entry.filters.maxPrice || 99999;
      if (profitFilter) profitFilter.value = entry.filters.profit || 0;
      if (maxItemsFilter) maxItemsFilter.value = entry.filters.maxItems || 50;
    }

    // Resetear progreso
    progressContainer.style.display = 'none';
    statusText.textContent = '';
    progressFill.style.width = '0%';

    // Marcar como activo en el historial
    document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
    const itemEl = document.querySelector(`.history-item[data-id="${entry.id}"]`);
    if (itemEl) itemEl.classList.add('active');

    closeHistory();
    showToast(`📋 Restaurados ${entry.results.length} resultados`, 'success');
  }

  function renderHistory() {
    if (!historyList) return;
    const count = scanHistory.length;

    if (historyBadge) {
      historyBadge.style.display = count > 0 ? 'inline' : 'none';
      historyBadge.textContent = count;
    }

    if (count === 0) {
      historyList.innerHTML = '<div class="history-empty">Sin búsquedas guardadas</div>';
      return;
    }

    historyList.innerHTML = scanHistory.map(h => {
      const s = h.stats || {};
      const f = h.filters || {};
      const catLabel = f.category === 'all' ? 'Todas' : f.category;
      const top = h.topResults || [];
      const count = s.total || 0;
      return `
        <div class="history-item${allResults === h.results ? ' active' : ''}" data-id="${h.id}">
          <div class="history-item-main">
            <div class="history-item-info">
              <div class="history-item-title">${h.label || 'Sin fecha'} · ${getCatEmoji(f.category)} ${catLabel}</div>
              <div class="history-item-meta">
                <span>📊 ${s.scanned || 0} escaneados</span>
                <span>💰 ${s.bestProfit ? s.bestProfit.toFixed(0) + '%' : '-'} mejor</span>
                <span>💵 $${(s.totalProfit || 0).toFixed(2)} total</span>
              </div>
            </div>
            <div class="history-item-right">
              <span class="history-item-count${count === 0 ? ' zero' : ''}">${count}</span>
              <button class="btn-icon" data-action="delete" data-id="${h.id}" title="Eliminar">✕</button>
            </div>
          </div>
          ${top.length > 0 ? `
            <div class="history-top">
              <div class="history-top-header">🏆 Top ${top.length} por profit</div>
              ${top.map((t, i) => `
                <div class="history-top-item">
                  <span class="ht-rank">#${i + 1}</span>
                  <span class="ht-name">${t.name}</span>
                  <span class="ht-pct ${t.pct >= 50 ? 'green' : t.pct >= 20 ? 'yellow' : ''}">${(t.pct || 0).toFixed(0)}%</span>
                  <span class="ht-usd">+$${(t.usd || 0).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  // ===== HISTORY TOGGLE =====
  function toggleHistory() {
    if (historyOpen) closeHistory();
    else openHistory();
  }

  function openHistory() {
    historyOpen = true;
    if (historyPanel) historyPanel.classList.add('open');
    renderHistory();
  }

  function closeHistory() {
    historyOpen = false;
    if (historyPanel) historyPanel.classList.remove('open');
  }

  // ===== TOAST =====
  function showToast(msg, type) {
    const container = document.getElementById('toastContainer') || (() => {
      const c = document.createElement('div');
      c.className = 'toast-container';
      c.id = 'toastContainer';
      document.body.appendChild(c);
      return c;
    })();
    const t = document.createElement('div');
    t.className = `toast ${type || 'info'}`;
    t.innerHTML = `<span class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>${msg}`;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 250);
    }, 3000);
  }

  // ===== STOP SCAN =====
  function stopScan() {
    scanning = false;
    showToast('⏹️ Deteniendo escaneo...', 'warning');
    statusText.textContent = '⏹️ Deteniendo... (esperando lote actual)';
    scanBtn.disabled = true;
    scanBtn.textContent = 'Deteniendo...';
  }

  // ===== SCAN PRINCIPAL =====
  async function startScan() {
    if (scanning) return;
    scanning = true;

    scanBtn.disabled = false;
    scanBtn.textContent = '⏹ Detener';
    scanBtn.classList.add('scanning');
    progressContainer.style.display = 'block';
    resultsContainer.innerHTML = '<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">📡</span><h3>Cargando...</h3><p>Obteniendo lista de precios de CSFloat</p></div>';

    const filters = {
      minPrice: parseFloat(minPrice.value || '0'),
      maxPrice: parseFloat(maxPrice.value || '99999'),
      profit: parseInt(profitFilter.value || '0'),
      category: categoryFilter?.value || 'all',
      maxItems: parseInt(maxItemsFilter?.value || '50'),
    };

    try {
      // Start timer
      if (scanTimer) scanTimer.textContent = '0:00';
      if (scanTimerInterval) { clearInterval(scanTimerInterval); scanTimerInterval = null; }
      scanTimerInterval = setInterval(() => {
        if (scanTimer) scanTimer.textContent = formatTimer(Date.now() - scanStartTime);
      }, 1000);
      scanStartTime = Date.now();

      statusText.textContent = '📡 Obteniendo lista de precios de CSFloat...';
      progressFill.style.width = '5%';

      const priceList = await fetchCSFloatPriceList();
      const minPriceCents = filters.minPrice * 100;
      const maxPriceCents = filters.maxPrice * 100;
      const selectedCategory = filters.category;
      const maxItems = filters.maxItems;

      statusText.textContent = `📦 ${priceList.length} items obtenidos. Aplicando filtros...`;
      progressFill.style.width = '15%';

      let candidates = [];
      for (const item of priceList) {
        const cat = detectCategory(item.market_hash_name);
        if (item.min_price < minPriceCents || item.min_price > maxPriceCents) continue;
        if (!item.quantity || item.quantity < 1) continue;
        if (selectedCategory !== 'all' && cat !== selectedCategory) continue;
        candidates.push({
          name: item.market_hash_name,
          priceCs: item.min_price / 100,
          quantity: item.quantity,
          score: (item.quantity || 1) * (1 / (item.min_price || 1)),
          category: cat,
        });
      }

      const totalCandidates = candidates.length;
      statusText.textContent = `🔍 ${totalCandidates} items pasaron los filtros. Buscando los mejores...`;
      progressFill.style.width = '20%';

      if (totalCandidates === 0) {
        if (scanTimerInterval) { clearInterval(scanTimerInterval); scanTimerInterval = null; }
        resultsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">🔍</span><h3>Sin resultados</h3><p>No hay items que cumplan los filtros actuales. Probá con un rango de precio más amplio.</p></div>`;
        showToast('🔍 Sin items con los filtros actuales', 'warning');
        scanBtn.disabled = false;
        scanBtn.textContent = '🔍 Escanear';
        scanning = false;
        return;
      }

      candidates.sort((a, b) => b.score - a.score);
      const toScan = candidates.slice(0, maxItems);
      const totalToScan = toScan.length;

      statusText.textContent = `🔄 Consultando Steam para ${totalToScan} items (lotes de 10)...`;
      progressFill.style.width = '25%';
      allResults = [];
      if (scanCounter) scanCounter.textContent = '0';
      if (scanTotal) scanTotal.textContent = totalToScan;

      const BATCH_SIZE = 10;
      const STEAM_DELAY = 2000;
      const totalBatches = Math.ceil(totalToScan / BATCH_SIZE);

      for (let i = 0; i < totalToScan && scanning; i += BATCH_SIZE) {
        const batch = toScan.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const progress = 25 + (i / totalToScan) * 70;
        progressFill.style.width = `${progress}%`;
        statusText.textContent = `📊 Lote ${batchNum}/${totalBatches} | Verificando ${batch.length} items... (${allResults.length} con profit)`;

        const promises = batch.map(async (item) => {
          const steamResult = await fetchSteamPrice(item.name);
          const steamPriceRaw = steamResult ? steamResult.price : null;
          const steamVolume = steamResult ? steamResult.volume : 0;
          if (steamPriceRaw && steamPriceRaw > item.priceCs) {
            const steamAfterFee = steamPriceRaw * 0.85;
            const profit = steamAfterFee - item.priceCs;
            const profitPercent = ((steamAfterFee - item.priceCs) / item.priceCs) * 100;
            return {
              market_name: item.name,
              csfloat_price: item.priceCs,
              steam_price: steamAfterFee,
              steam_volume: steamVolume,
              profit_usd: profit,
              profit_percent: profitPercent,
              quantity: item.quantity,
              category: item.category,
            };
          }
          return null;
        });

        const batchResults = await Promise.all(promises);
        batchResults.filter(Boolean).forEach(r => allResults.push(r));
        renderResults();
        if (scanCounter) scanCounter.textContent = Math.min(i + BATCH_SIZE, totalToScan);

        if (i + BATCH_SIZE < totalToScan && scanning) {
          await new Promise(r => setTimeout(r, STEAM_DELAY));
        }
      }

      const wasStopped = !scanning;
      allResults.sort((a, b) => b.profit_usd - a.profit_usd);

      // Guardar en historial (siempre, incluso si se detuvo)
      if (allResults.length > 0 || totalToScan > 0) {
        addHistoryEntry(allResults, { ...filters, scanned: wasStopped ? Math.min(totalToScan, allResults.length * 2 + 10) : totalToScan });
      }

      if (wasStopped) {
        if (scanTimerInterval) { clearInterval(scanTimerInterval); scanTimerInterval = null; }
        progressFill.style.width = `${Math.min(100, 25 + (allResults.length / Math.max(totalToScan, 1)) * 70)}%`;
        statusText.textContent = `⏹️ Detenido: ${allResults.length} oportunidades encontradas antes de detener`;
        if (allResults.length > 0) {
          renderResults();
          showToast(`⏹️ ${allResults.length} oportunidades encontradas (escaneo detenido)`, 'warning');
        } else {
          showToast('⏹️ Escaneo detenido sin resultados', 'warning');
        }
      } else {
        if (scanTimerInterval) { clearInterval(scanTimerInterval); scanTimerInterval = null; }
      progressFill.style.width = '100%';
        statusText.textContent = `✅ Completado: ${allResults.length} oportunidades de ${totalToScan} items analizados`;

        if (allResults.length === 0) {
          resultsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">😕</span><h3>Sin oportunidades</h3><p>No se encontraron items con profit en Steam. Probá bajando el Profit Mínimo o ampliando el rango de precio.</p></div>`;
          showToast('😕 Sin oportunidades de profit', 'info');
        } else {
          renderResults();
          showToast(`✅ ${allResults.length} oportunidades encontradas`, 'success');
        }
      }

    } catch (e) {
      if (scanTimerInterval) { clearInterval(scanTimerInterval); scanTimerInterval = null; }
      resultsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">❌</span><h3>Error</h3><p>${e.message}</p></div>`;
      statusText.textContent = '❌ Error durante el escaneo';
      showToast(`❌ Error: ${e.message}`, 'error');
    }

    scanBtn.disabled = false;
    scanBtn.textContent = '🔍 Escanear';
    scanBtn.classList.remove('scanning');
    scanning = false;
  }

  // ===== RENDER =====
  function renderResults() {
    const minProfit = parseInt(profitFilter?.value || '0');
    const minPriceVal = parseFloat(minPrice?.value || '0');
    const maxPriceVal = parseFloat(maxPrice?.value || '99999');
    const sortBy = profitSort?.value || 'profit-desc';
    const mostSoldOnly = profitMostSold ? profitMostSold.checked : false;

    let filtered = allResults.filter(r =>
      r.profit_percent >= minProfit &&
      r.csfloat_price >= minPriceVal &&
      r.csfloat_price <= maxPriceVal &&
      (!mostSoldOnly || (r.steam_volume || 0) > 0)
    );

    // Sort by selected option
    const fn = sortFns[sortBy] || sortFns['profit-desc'];
    filtered.sort(fn);

    // Override with header click sort if active
    if (sortColumn) {
      filtered.sort((a, b) => {
        const va = a[sortColumn];
        const vb = b[sortColumn];
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'string') return sortDirection === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
        return sortDirection === 'desc' ? vb - va : va - vb;
      });
    }

    $('#totalCount').textContent = allResults.length;
    $('#profitCount').textContent = filtered.length;

    if (filtered.length === 0) {
      if (allResults.length > 0) {
        resultsContainer.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon" style="font-size:2.5rem">🔍</span>
            <h3>Sin resultados</h3>
            <p>Ningún item de los ${allResults.length} encontrados cumple con los filtros actuales. Probá ajustando el Profit Mínimo o el rango de precio.</p>
          </div>
        `;
      } else {
        resultsContainer.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon" style="font-size:2.5rem">⛪</span>
            <h3>SaintProfit</h3>
            <p>Hacé clic en "Escanear" para buscar oportunidades de profit entre CSFloat y Steam Market.</p>
          </div>
        `;
      }
      $('#avgProfit').textContent = '$0';
      $('#maxProfit').textContent = '$0';
      return;
    }

    const profits = filtered.map(r => r.profit_usd);
    const avg = profits.reduce((a, b) => a + b, 0) / profits.length;
    const max = Math.max(...profits);

    $('#avgProfit').textContent = `$${(avg || 0).toFixed(2)}`;
    $('#maxProfit').textContent = `$${(max || 0).toFixed(2)}`;

    let html = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-sort="market_name">Item <span class="sort-icon">↕</span></th>
              <th data-sort="csfloat_price">CSFloat <span class="sort-icon">↕</span></th>
              <th data-sort="steam_price">Steam (-15%) <span class="sort-icon">↕</span></th>
              <th data-sort="profit_usd">Profit $ <span class="sort-icon">↕</span></th>
              <th data-sort="profit_percent">Profit % <span class="sort-icon">↕</span></th>
              <th data-sort="steam_volume">Vol. Steam <span class="sort-icon">↕</span></th>
              <th data-sort="quantity">Stock <span class="sort-icon">↕</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
    `;

    filtered.forEach((r, idx) => {
      const pClass = r.profit_percent >= 50 ? 'profit-high' : r.profit_percent >= 20 ? 'profit-positive' : '';
      html += `
        <tr style="animation:rowIn 0.3s ease-out ${Math.min(idx * 0.05, 1.5)}s forwards; opacity:0">
          <td class="skin-name">${r.market_name}</td>
          <td class="price-csfloat">$${(r.csfloat_price || 0).toFixed(2)}</td>
          <td class="price-steam">$${(r.steam_price || 0).toFixed(2)}</td>
          <td class="${pClass}">+$${(r.profit_usd || 0).toFixed(2)}</td>
          <td class="${pClass}">${(r.profit_percent || 0).toFixed(0)}%</td>
          <td class="qty" style="color:${(r.steam_volume || 0) > 0 ? 'var(--accent-3)' : 'var(--text-muted)'}">${(r.steam_volume || 0) > 0 ? (r.steam_volume).toLocaleString() : '—'}</td>
          <td class="qty">${r.quantity}</td>
          <td class="cell-actions">
            <a href="https://csfloat.com/search?market_hash_name=${encodeURIComponent(r.market_name)}"
               target="_blank" class="action-link" title="Ver en CSFloat"><img src="icons/csfloat-link.png" class="action-icon" alt="CSF"></a>
            <a href="https://steamcommunity.com/market/listings/730/${encodeURIComponent(r.market_name)}"
               target="_blank" class="action-link steam" title="Ver en Steam Market"><img src="icons/steam-link.webp" class="action-icon" alt="STM"></a>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    resultsContainer.innerHTML = html;

    // Update header sort visual indicator
    if (sortColumn) {
      const activeTh = resultsContainer.querySelector(`th[data-sort="${CSS.escape(sortColumn)}"]`);
      if (activeTh) {
        activeTh.classList.add('sorted');
        const icon = activeTh.querySelector('.sort-icon');
        if (icon) icon.textContent = sortDirection === 'desc' ? '↓' : '↑';
      }
    }
  }

  // ===== HEADER CLICK SORT: SteamFarm =====
  // Ordenar tabla por click en headers (toggle asc/desc, indicador visual)
  resultsContainer.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const key = th.dataset.sort;
      if (sortColumn === key) {
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        sortColumn = key;
        sortDirection = 'desc';
      }
      renderResults();
    }
  });

  // Historial: clic en item o top section → restoreScan
  historyList.addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    const del = e.target.closest('[data-action="delete"]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.id;
      deleteHistoryEntry(id);
      return;
    }
    if (item) {
      const id = item.dataset.id;
      const entry = scanHistory.find(h => h.id === id);
      if (entry) restoreScan(entry);
    }
  });

  // ===== FILTROS EN TIEMPO REAL =====
  [profitFilter, minPrice, maxPrice, categoryFilter, profitSort, profitMostSold].forEach(el => {
    if (el) el.addEventListener('change', () => {
      if (allResults.length > 0) renderResults();
    });
  });
  // Checkbox: also listen for click to persist
  if (profitMostSold) {
    profitMostSold.addEventListener('click', () => {
      localStorage.setItem('profitMostSold', profitMostSold.checked ? 'true' : '');
      if (allResults.length > 0) renderResults();
    });
  }

  // ===== LOCAL STORAGE =====
  ['profitFilter', 'minPrice', 'maxPrice', 'categoryFilter', 'maxItemsFilter', 'profitSort'].forEach(id => {
    const el = $(id);
    const saved = localStorage.getItem(id);
    if (el && saved) el.value = saved;
    if (el) el.addEventListener('change', () => localStorage.setItem(id, el.value));
  });
  // Restore profitMostSold checkbox
  if (profitMostSold) {
    const savedMost = localStorage.getItem('profitMostSold');
    if (savedMost === 'true') profitMostSold.checked = true;
  }

  // ===== INIT =====
  loadHistory();

  // Auto-restaurar último escaneo (para no tener que recargar cada vez)
  if (allResults.length === 0 && scanHistory.length > 0) {
    const last = scanHistory[0];
    if (last && last.results && last.results.length > 0) {
      allResults = last.results;
      // Restaurar los filtros que se usaron
      if (last.filters) {
        if (categoryFilter) categoryFilter.value = last.filters.category || 'all';
        if (minPrice) minPrice.value = last.filters.minPrice || 0;
        if (maxPrice) maxPrice.value = last.filters.maxPrice || 99999;
        if (profitFilter) profitFilter.value = last.filters.profit || 0;
        if (maxItemsFilter) maxItemsFilter.value = last.filters.maxItems || 50;
      }
      renderResults();
    }
  }

  // ================================================================
  // ===== CAPITALLET MODE (COMPLETAMENTE SEPARADO) =====
  // ================================================================

  let capResults = [];
  let capScanning = false;

  const capMode = $('#capitalletMode');
  const capScanBtn = $('#capScanBtn');
  const capMaxDiff = $('#capMaxDiff');
  const capMinPrice = $('#capMinPrice');
  const capMaxPrice = $('#capMaxPrice');
  const capCategory = $('#capCategory');
  const capLimit = $('#capLimit');
  const capSort = $('#capSort');
  const capMostSold = $('#capMostSold');
  const capProgress = $('#capProgress');
  const capStatus = $('#capStatus');
  const capProgressFill = $('#capProgressFill');
  const capResultsContainer = $('#capResultsContainer');
  const capScanCounter = $('#capScanCounter');
  const capScanTotal = $('#capScanTotal');
  const capScanTimer = $('#capScanTimer');
  let capTimerInterval = null;
  let capStartTime = null;

  // (mode switching is handled by init.js via switchMode())

  // ===== CAPITALLET SCAN =====
  if (capScanBtn) {
    capScanBtn.addEventListener('click', () => {
      if (capScanning) stopCapScan();
      else startCapScan();
    });
  }

  function stopCapScan() {
    capScanning = false;
    showToast('⏹️ Deteniendo escaneo Capitallet...', 'warning');
    capStatus.textContent = '⏹️ Deteniendo... (esperando lote actual)';
    capScanBtn.disabled = true;
    capScanBtn.textContent = 'Deteniendo...';
  }

  function getCapDiffClass(diffPct) {
    if (diffPct <= 1) return 'match';
    if (diffPct <= 3) return 'close';
    return 'far';
  }

  function renderCapResults() {
    const maxDiff = parseFloat(capMaxDiff.value || '5');
    const minPriceVal = parseFloat(capMinPrice.value || '0');
    const maxPriceVal = parseFloat(capMaxPrice.value || '99999');
    const sortBy = capSort ? capSort.value : 'diff-asc';
    const mostSoldOnly = capMostSold ? capMostSold.checked : false;

    let filtered = capResults.filter(r =>
      Math.abs(r.diff_pct) <= maxDiff &&
      r.steam_price >= minPriceVal &&
      r.steam_price <= maxPriceVal &&
      (!mostSoldOnly || (r.steam_volume || 0) > 0)
    );

    // Sort
    const capSortFns = {
      'diff-asc': (a, b) => Math.abs(a.diff_pct) - Math.abs(b.diff_pct),
      'diff-desc': (a, b) => Math.abs(b.diff_pct) - Math.abs(a.diff_pct),
      'csfloat-asc': (a, b) => a.csfloat_price - b.csfloat_price,
      'csfloat-desc': (a, b) => b.csfloat_price - a.csfloat_price,
      'volume-desc': (a, b) => (b.steam_volume || 0) - (a.steam_volume || 0),
    };
    filtered.sort(capSortFns[sortBy] || capSortFns['diff-asc']);

    // Override with header click sort if active
    if (capSortColumn) {
      filtered.sort((a, b) => {
        const va = a[capSortColumn];
        const vb = b[capSortColumn];
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'string') return capSortDirection === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
        return capSortDirection === 'desc' ? vb - va : va - vb;
      });
    }

    // Stats
    document.getElementById('capTotalCount').textContent = capResults.length;
    document.getElementById('capMatchCount').textContent = filtered.length;

    if (filtered.length === 0) {
      if (capResults.length > 0) {
        capResultsContainer.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon" style="font-size:2.5rem">🔍</span>
            <h3>Sin coincidencias</h3>
            <p>Ningún item de los ${capResults.length} encontrados cumple con la diferencia máxima del ${maxDiff}%. Probá aumentando el límite.</p>
          </div>
        `;
      } else {
        capResultsContainer.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon" style="font-size:2.5rem">🔄</span>
            <h3>Modo Capitallet</h3>
            <p>Encuentra skins con <strong>precios similares</strong> entre CSFloat y Steam para convertir tu saldo.</p>
          </div>
        `;
      }
      document.getElementById('capAvgDiff').textContent = '$0';
      document.getElementById('capBestDiff').textContent = '$0';
      return;
    }

    const diffs = filtered.map(r => r.diff_usd);
    const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const minDiff = Math.min(...diffs.map(Math.abs));

    document.getElementById('capAvgDiff').textContent = `$${(Math.abs(avg) || 0).toFixed(2)}`;
    document.getElementById('capBestDiff').textContent = `$${(minDiff || 0).toFixed(2)}`;

    let html = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-cap-sort="market_name">Item <span class="sort-icon">↕</span></th>
              <th data-cap-sort="steam_price">Steam <span class="sort-icon">↕</span></th>
              <th data-cap-sort="csfloat_price">CSFloat (-2%) <span class="sort-icon">↕</span></th>
              <th data-cap-sort="diff_usd">Dif. $ <span class="sort-icon">↕</span></th>
              <th data-cap-sort="diff_pct">Dif. % <span class="sort-icon">↕</span></th>
              <th data-cap-sort="steam_volume">Vol. Steam <span class="sort-icon">↕</span></th>
              <th data-cap-sort="quantity">Stock <span class="sort-icon">↕</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
    `;

    filtered.forEach((r, idx) => {
      const absDiff = Math.abs(r.diff_pct);
      const isIdeal = absDiff < 0.5;
      const diffClass = isIdeal ? 'ideal' : getCapDiffClass(absDiff);
      const isGain = r.diff_usd >= 0;
      const diffSign = isGain ? '+' : '';
      const dirEmoji = isGain ? '🟢' : '🔴';
      const dirLabel = isGain ? 'GANANCIA' : 'PÉRDIDA';
      const diffColor = absDiff <= 1 ? 'cap-positive' : absDiff <= 3 ? 'cap-neutral' : 'cap-negative';
      const rowClass = isGain ? 'cap-row-gain' : 'cap-row-loss';
      html += `
        <tr class="${rowClass}" style="animation:rowIn 0.3s ease-out ${Math.min(idx * 0.05, 1.5)}s forwards; opacity:0">
          <td class="skin-name">${r.market_name || ''}</td>
          <td class="price-steam">$${(r.steam_price || 0).toFixed(2)}</td>
          <td class="price-csfloat">$${(r.csfloat_price || 0).toFixed(2)} <span style="color:var(--text-muted);font-size:0.6rem">(-2%)</span></td>
          <td class="${diffColor}">
            <span class="dir-indicator ${isGain ? 'gain' : 'loss'}" title="${dirLabel}">${dirEmoji}</span>
            ${diffSign}$${(r.diff_usd || 0).toFixed(2)}
          </td>
          <td><span class="diff-badge ${diffClass}">${Math.abs(r.diff_pct || 0) < 0.5 ? '⭐ ' : ''}${diffSign}${(r.diff_pct || 0).toFixed(1)}%</span></td>
          <td class="qty" style="color:${(r.steam_volume || 0) > 0 ? 'var(--accent-3)' : 'var(--text-muted)'}">${(r.steam_volume || 0) > 0 ? (r.steam_volume).toLocaleString() : '—'}</td>
          <td class="qty">${r.quantity || 0}</td>
          <td class="cell-actions">
            <a href="https://csfloat.com/search?market_hash_name=${encodeURIComponent(r.market_name)}"
               target="_blank" class="action-link" title="Ver en CSFloat"><img src="icons/csfloat-link.png" class="action-icon" alt="CSF"></a>
            <a href="https://steamcommunity.com/market/listings/730/${encodeURIComponent(r.market_name)}"
               target="_blank" class="action-link steam" title="Ver en Steam Market"><img src="icons/steam-link.webp" class="action-icon" alt="STM"></a>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    capResultsContainer.innerHTML = html;

    // Update header sort visual indicator
    if (capSortColumn) {
      const activeTh = capResultsContainer.querySelector(`th[data-cap-sort="${CSS.escape(capSortColumn)}"]`);
      if (activeTh) {
        activeTh.classList.add('sorted');
        const icon = activeTh.querySelector('.sort-icon');
        if (icon) icon.textContent = capSortDirection === 'desc' ? '↓' : '↑';
      }
    }
  }

  async function startCapScan() {
    if (capScanning) return;
    capScanning = true;

    capScanBtn.disabled = false;
    capScanBtn.textContent = '⏹ Detener';
    capScanBtn.classList.add('scanning');
    capProgress.classList.add('show');
    capResultsContainer.innerHTML = '<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">📡</span><h3>Cargando...</h3><p>Obteniendo lista de precios de CSFloat</p></div>';

    const maxDiff = parseFloat(capMaxDiff.value || '5');
    const minP = parseFloat(capMinPrice.value || '0');
    const maxP = parseFloat(capMaxPrice.value || '99999');
    const category = capCategory?.value || 'all';
    const limit = parseInt(capLimit?.value || '50');
    const sortBy = capSort?.value || 'diff-asc';

    try {
      // CSFloat seller fee (2% for items under $500)
      const CSFLOAT_FEE = 0.98;

      // Start capitallet timer
      if (capScanTimer) capScanTimer.textContent = '0:00';
      if (capTimerInterval) { clearInterval(capTimerInterval); capTimerInterval = null; }
      capTimerInterval = setInterval(() => {
        if (capScanTimer) capScanTimer.textContent = formatTimer(Date.now() - capStartTime);
      }, 1000);
      capStartTime = Date.now();

      capStatus.textContent = '📡 Obteniendo lista de precios de CSFloat...';
      capProgressFill.style.width = '5%';

      const priceList = await fetchCSFloatPriceList();
      // Buscamos candidatos con precio CSFloat de hasta $500
      // El filtro de precio REAL (min/max) se aplica DESPUÉS sobre Steam
      const CANDIDATE_CSFLOAT_MAX = 50000; // $500 en centavos

      capStatus.textContent = `📦 ${priceList.length} items obtenidos. Aplicando filtros...`;
      capProgressFill.style.width = '15%';

      let candidates = [];
      for (const item of priceList) {
        const cat = detectCategory(item.market_hash_name);
        if (item.min_price < 0 || item.min_price > CANDIDATE_CSFLOAT_MAX) continue;
        if (!item.quantity || item.quantity < 1) continue;
        if (category !== 'all' && cat !== category) continue;
        candidates.push({
          name: item.market_hash_name,
          priceCs: item.min_price / 100,
          quantity: item.quantity,
          category: cat,
        });
      }

      capStatus.textContent = `🔍 ${candidates.length} items pasaron los filtros. Buscando coincidencias...`;
      capProgressFill.style.width = '20%';

      if (candidates.length === 0) {
        if (capTimerInterval) { clearInterval(capTimerInterval); capTimerInterval = null; }
        capResultsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">🔍</span><h3>Sin resultados</h3><p>No hay items que cumplan los filtros actuales.</p></div>`;
        showToast('🔍 Sin items con los filtros actuales', 'warning');
        capScanBtn.disabled = false;
        capScanBtn.textContent = '🔍 Escanear Capitallet';
        capScanBtn.classList.remove('scanning');
        capScanning = false;
        return;
      }

      // Ordenar por score: items con más stock y menor precio tienen más chances en Steam
      candidates.sort((a, b) => {
        const scoreA = (a.quantity || 1) * (1 / Math.max(a.priceCs, 0.01));
        const scoreB = (b.quantity || 1) * (1 / Math.max(b.priceCs, 0.01));
        return scoreB - scoreA;
      });
      const toScan = candidates.slice(0, limit);
      const totalToScan = toScan.length;

      capStatus.textContent = `🔄 Consultando Steam para ${totalToScan} items...`;
      capProgressFill.style.width = '25%';
      capResults = [];
      if (capScanCounter) capScanCounter.textContent = '0';
      if (capScanTotal) capScanTotal.textContent = totalToScan;

      const BATCH_SIZE = 10;
      const STEAM_DELAY = 2000;
      const totalBatches = Math.ceil(totalToScan / BATCH_SIZE);

      for (let i = 0; i < totalToScan && capScanning; i += BATCH_SIZE) {
        const batch = toScan.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const progress = 25 + (i / totalToScan) * 70;
        capProgressFill.style.width = `${progress}%`;
        capStatus.textContent = `📊 Lote ${batchNum}/${totalBatches} | Verificando ${batch.length} items... (${capResults.length} coincidencias)`;

        const promises = batch.map(async (item) => {
          const steamResult = await fetchSteamPrice(item.name);
          const steamPriceRaw = steamResult ? steamResult.price : null;
          const steamVolume = steamResult ? steamResult.volume : 0;
          if (steamPriceRaw) {
            // Lo que recibís al vender en CSFloat: precio × 0.98 (-2% fee)
            const csfloatAfterFee = item.priceCs * CSFLOAT_FEE;
            const diff = csfloatAfterFee - steamPriceRaw;
            const diffPct = ((csfloatAfterFee - steamPriceRaw) / steamPriceRaw) * 100;
            return {
              market_name: item.name,
              csfloat_price: csfloatAfterFee, // ya incluye el -2%
              steam_price: steamPriceRaw,
              steam_volume: steamVolume,
              diff_usd: diff,
              diff_pct: diffPct,
              quantity: item.quantity,
              category: item.category,
            };
          }
          return null;
        });

        const batchResults = await Promise.all(promises);

        // Filter by Steam price range (the user's min/max applies to Steam)
        const steamFiltered = batchResults.filter(r => r !== null && r.steam_price >= minP && r.steam_price <= maxP);

        steamFiltered.forEach(r => capResults.push(r));
        renderCapResults();
        if (capScanCounter) capScanCounter.textContent = Math.min(i + BATCH_SIZE, totalToScan);

        if (i + BATCH_SIZE < totalToScan && capScanning) {
          await new Promise(r => setTimeout(r, STEAM_DELAY));
        }
      }

      const wasStopped = !capScanning;

      // Ordenar por menor diferencia antes de guardar en historial
      capResults.sort((a, b) => Math.abs(a.diff_pct) - Math.abs(b.diff_pct));

      // Guardar en historial Capitallet (siempre, incluso si se detuvo)
      if (capResults.length > 0 || totalToScan > 0) {
        addCapHistoryEntry(capResults, {
          maxDiff: maxDiff,
          minPrice: minP,
          maxPrice: maxP,
          category: category,
          limit: limit,
          scanned: wasStopped ? Math.min(totalToScan, capResults.length * 2 + 10) : totalToScan
        });
      }

      if (wasStopped) {
        if (capTimerInterval) { clearInterval(capTimerInterval); capTimerInterval = null; }
        capProgressFill.style.width = `${Math.min(100, 25 + (capResults.length / Math.max(totalToScan, 1)) * 70)}%`;
        capStatus.textContent = `⏹️ Detenido: ${capResults.length} coincidencias encontradas`;
        if (capResults.length > 0) {
          renderCapResults();
          showToast(`⏹️ ${capResults.length} coincidencias (escaneo detenido)`, 'warning');
        } else {
          showToast('⏹️ Escaneo detenido sin resultados', 'warning');
        }
      } else {
        if (capTimerInterval) { clearInterval(capTimerInterval); capTimerInterval = null; }
        capProgressFill.style.width = '100%';
        capStatus.textContent = `✅ Completado: ${capResults.length} coincidencias de ${totalToScan} items analizados`;

        if (capResults.length === 0) {
          capResultsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">😕</span><h3>Sin coincidencias</h3><p>No se encontraron items con precios similares. Probá aumentando la Diferencia Máxima o ampliando el rango de precio.</p></div>`;
          showToast('😕 Sin coincidencias de precio', 'info');
        } else {
          renderCapResults();
          showToast(`✅ ${capResults.length} coincidencias encontradas`, 'success');
        }
      }

    } catch (e) {
      if (capTimerInterval) { clearInterval(capTimerInterval); capTimerInterval = null; }
      capResultsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">❌</span><h3>Error</h3><p>${e.message}</p></div>`;
      capStatus.textContent = '❌ Error durante el escaneo';
      showToast(`❌ Error: ${e.message}`, 'error');
    }

    capScanBtn.disabled = false;
    capScanBtn.textContent = '🔍 Escanear Capitallet';
    capScanBtn.classList.remove('scanning');
    capScanning = false;
  }

  // ===== HEADER CLICK SORT + ROW CLICK → STEAM: Capitallet =====
  if (capResultsContainer) {
    capResultsContainer.addEventListener('click', (e) => {
      // Click en header → ordenar
      const th = e.target.closest('th[data-cap-sort]');
      if (th) {
        const key = th.dataset.capSort;
        if (capSortColumn === key) {
          capSortDirection = capSortDirection === 'desc' ? 'asc' : 'desc';
        } else {
          capSortColumn = key;
          capSortDirection = 'desc';
        }
        renderCapResults();
        return;
      }
      // Click en cualquier otra parte de la fila (tr) → abrir Steam
      // No interferir con los action-links (los iconos CSFloat/Steam)
      const actionLink = e.target.closest('.action-link');
      if (!actionLink) {
        const row = e.target.closest('tr');
        if (row) {
          const steamLink = row.querySelector('.action-link.steam');
          if (steamLink) {
            window.open(steamLink.href, '_blank');
          }
        }
      }
    });
  }

  // ===== CAPITALLET FILTROS EN TIEMPO REAL =====
  [capMaxDiff, capMinPrice, capMaxPrice, capCategory, capSort, capMostSold].forEach(el => {
    if (el) el.addEventListener('change', () => {
      if (capResults.length > 0) renderCapResults();
    });
  });
  // Checkbox fires 'change' but not always reliably, also listen for 'click'
  if (capMostSold) {
    capMostSold.addEventListener('click', () => {
      localStorage.setItem('capMostSold', capMostSold.checked ? 'true' : '');
      if (capResults.length > 0) renderCapResults();
    });
  }

  // ===== CAPITALLET LOCAL STORAGE =====
  ['capMaxDiff', 'capMinPrice', 'capMaxPrice', 'capCategory', 'capLimit', 'capSort'].forEach(id => {
    const el = $(id);
    const saved = localStorage.getItem(id);
    if (el && saved) el.value = saved;
    if (el) el.addEventListener('change', () => localStorage.setItem(id, el.value));
  });
  // Restore capMostSold checkbox
  if (capMostSold) {
    const savedMost = localStorage.getItem('capMostSold');
    if (savedMost === 'true') capMostSold.checked = true;
  }

  // ================================================================
  // ===== CAPITALLET HISTORIAL =====
  // ================================================================

  const CAP_STORAGE_KEY = 'saintprofit_cap_history';
  const CAP_MAX_HISTORY = 20;

  let capHistory = [];
  let capHistoryOpen = false;

  const capHistoryBtn = $('#capHistoryBtn');
  const capHistoryPanel = $('#capHistoryPanel');
  const capHistoryList = $('#capHistoryList');
  const capHistoryBadge = $('#capHistoryBadge');
  const closeCapHistoryBtn = $('#closeCapHistoryBtn');
  const clearCapHistoryBtn = $('#clearCapHistoryBtn');

  function loadCapHistory() {
    try {
      const raw = localStorage.getItem(CAP_STORAGE_KEY);
      capHistory = raw ? JSON.parse(raw) : [];
    } catch(e) { capHistory = []; }
    renderCapHistory();
  }

  function saveCapHistory() {
    try {
      localStorage.setItem(CAP_STORAGE_KEY, JSON.stringify(capHistory));
    } catch(e) { /* localStorage lleno */ }
    renderCapHistory();
  }

  function addCapHistoryEntry(results, filters) {
    const totalAbsDiff = results.reduce((s, r) => s + Math.abs(r.diff_usd), 0);
    const bestDiff = results.length > 0 ? Math.min(...results.map(r => Math.abs(r.diff_pct))) : 0;
    const entry = {
      id: 'cap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: Date.now(),
      label: new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }),
      filters: {
        maxDiff: filters.maxDiff || 5,
        minPrice: filters.minPrice || 0,
        maxPrice: filters.maxPrice || 99999,
        category: filters.category || 'all',
        limit: filters.limit || 50,
      },
      stats: {
        total: results.length,
        scanned: filters.scanned || 0,
        avgDiff: results.length > 0 ? totalAbsDiff / results.length : 0,
        bestDiff: bestDiff,
        categories: [...new Set(results.map(r => r.category).filter(Boolean))],
      },
      topResults: results.slice(0, 7).map(r => ({
        name: r.market_name,
        cs: r.csfloat_price,
        st: r.steam_price,
        diff: r.diff_usd,
        diffPct: r.diff_pct,
      })),
      results: results,
    };

    capHistory.unshift(entry);
    if (capHistory.length > CAP_MAX_HISTORY) {
      capHistory = capHistory.slice(0, CAP_MAX_HISTORY);
    }
    saveCapHistory();
  }

  function deleteCapHistoryEntry(id) {
    capHistory = capHistory.filter(h => h.id !== id);
    saveCapHistory();
    if (capHistory.length === 0) closeCapHistory();
  }

  function clearAllCapHistory() {
    if (capHistory.length === 0) return;
    if (!confirm('¿Borrar todo el historial de Capitallet?')) return;
    capHistory = [];
    saveCapHistory();
    closeCapHistory();
    showToast('🗑️ Historial Capitallet borrado', 'info');
  }

  function restoreCapScan(entry) {
    if (!entry || !entry.results || entry.results.length === 0) return;
    capResults = entry.results;
    renderCapResults();

    // Restaurar filtros de la búsqueda original
    if (entry.filters) {
      if (capMaxDiff) capMaxDiff.value = entry.filters.maxDiff || 5;
      if (capMinPrice) capMinPrice.value = entry.filters.minPrice || 0;
      if (capMaxPrice) capMaxPrice.value = entry.filters.maxPrice || 99999;
      if (capCategory) capCategory.value = entry.filters.category || 'all';
      if (capLimit) capLimit.value = entry.filters.limit || 50;
    }

    // Resetear progreso
    capProgress.classList.remove('show');
    capStatus.textContent = '';
    capProgressFill.style.width = '0%';

    // Marcar como activo en el historial
    document.querySelectorAll('#capHistoryList .history-item').forEach(el => el.classList.remove('active'));
    const itemEl = document.querySelector(`#capHistoryList .history-item[data-id="${entry.id}"]`);
    if (itemEl) itemEl.classList.add('active');

    closeCapHistory();
    showToast(`🔄 Restaurados ${entry.results.length} resultados Capitallet`, 'success');
  }

  function renderCapHistory() {
    if (!capHistoryList) return;
    const count = capHistory.length;

    if (capHistoryBadge) {
      capHistoryBadge.style.display = count > 0 ? 'inline' : 'none';
      capHistoryBadge.textContent = count;
    }

    if (count === 0) {
      capHistoryList.innerHTML = '<div class="history-empty">Sin búsquedas guardadas</div>';
      return;
    }

    capHistoryList.innerHTML = capHistory.map(h => {
      const s = h.stats || {};
      const f = h.filters || {};
      const catLabel = f.category === 'all' ? 'Todas' : f.category;
      const top = h.topResults || [];
      const count = s.total || 0;
      return `
        <div class="history-item${capResults === h.results ? ' active' : ''}" data-id="${h.id}">
          <div class="history-item-main">
            <div class="history-item-info">
              <div class="history-item-title">${h.label || 'Sin fecha'} · ${getCatEmoji(f.category)} ${catLabel}</div>
              <div class="history-item-meta">
                <span>📊 ${s.scanned || 0} escaneados</span>
                <span>🎯 ${s.bestDiff ? s.bestDiff.toFixed(1) + '%' : '-'} mejor dif.</span>
                <span>💵 $${(s.avgDiff || 0).toFixed(2)} dif. prom.</span>
              </div>
            </div>
            <div class="history-item-right">
              <span class="history-item-count${count === 0 ? ' zero' : ''}">${count}</span>
              <button class="btn-icon" data-cap-action="delete" data-id="${h.id}" title="Eliminar">✕</button>
            </div>
          </div>
          ${top.length > 0 ? `
            <div class="history-top">
              <div class="history-top-header">🏆 Top ${top.length} por menor diferencia</div>
              ${top.map((t, i) => `
                <div class="history-top-item">
                  <span class="ht-rank">#${i + 1}</span>
                  <span class="ht-name">${t.name}</span>
                  <span class="ht-pct ${Math.abs(t.diffPct || 0) <= 1 ? 'green' : Math.abs(t.diffPct || 0) <= 3 ? 'yellow' : ''}">${(t.diffPct || 0) >= 0 ? '+' : ''}${(t.diffPct || 0).toFixed(1)}%</span>
                  <span class="ht-usd">${(t.diff || 0) >= 0 ? '+' : ''}$${(t.diff || 0).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  // ===== CAPITALLET HISTORY EVENTS =====
  if (capHistoryBtn) {
    capHistoryBtn.addEventListener('click', () => {
      if (capHistoryOpen) closeCapHistory();
      else openCapHistory();
    });
  }

  if (closeCapHistoryBtn) {
    closeCapHistoryBtn.addEventListener('click', closeCapHistory);
  }

  if (clearCapHistoryBtn) {
    clearCapHistoryBtn.addEventListener('click', clearAllCapHistory);
  }

  function openCapHistory() {
    capHistoryOpen = true;
    if (capHistoryPanel) capHistoryPanel.classList.add('open');
    renderCapHistory();
  }

  function closeCapHistory() {
    capHistoryOpen = false;
    if (capHistoryPanel) capHistoryPanel.classList.remove('open');
  }

  // ===== CAPITALLET HISTORY EVENT DELEGATION =====
  if (capHistoryList) {
    capHistoryList.addEventListener('click', (e) => {
      const item = e.target.closest('.history-item');
      const del = e.target.closest('[data-cap-action="delete"]');
      if (del) {
        e.stopPropagation();
        const id = del.dataset.id;
        deleteCapHistoryEntry(id);
        return;
      }
      if (item) {
        const id = item.dataset.id;
        const entry = capHistory.find(h => h.id === id);
        if (entry) restoreCapScan(entry);
      }
    });
  }

  // ===== GUARDAR EN HISTORIAL AL FINALIZAR ESCANEO CAPITALLET =====
  // Modificar startCapScan para guardar en historial
  // Reemplazamos las secciones donde se completa el scan en startCapScan
  // (esto se hace modificando el código arriba - ya lo haremos)

  // ===== INIT CAPITALLET HISTORY =====
  loadCapHistory();

  // Auto-restaurar último escaneo Capitallet
  if (capResults.length === 0 && capHistory.length > 0) {
    const last = capHistory[0];
    if (last && last.results && last.results.length > 0) {
      capResults = last.results;
      if (last.filters) {
        if (capMaxDiff) capMaxDiff.value = last.filters.maxDiff || 5;
        if (capMinPrice) capMinPrice.value = last.filters.minPrice || 0;
        if (capMaxPrice) capMaxPrice.value = last.filters.maxPrice || 99999;
        if (capCategory) capCategory.value = last.filters.category || 'all';
        if (capLimit) capLimit.value = last.filters.limit || 50;
      }
      renderCapResults();
    }
  }

})();
