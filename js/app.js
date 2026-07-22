(async function() {
  'use strict';

  const STORAGE_KEY = 'csmuza_history';
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
  const progressContainer = $('#progressContainer');
  const statusText = $('#statusText');
  const progressFill = $('#progressFill');
  const resultsContainer = $('#resultsContainer');
  const historyBtn = $('#historyBtn');
  const historyPanel = $('#historyPanel');
  const historyList = $('#historyList');
  const historyBadge = $('#historyBadge');
  const closeHistoryBtn = $('#closeHistoryBtn');
  const clearHistoryBtn = $('#clearHistoryBtn');

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
    const map = { skins:'🎯', knives:'🔪', gloves:'🧤', stickers:'🏷️', containers:'📦', agents:'👤', keychains:'🔑', patches:'🪡', 'music-kits':'🎵', collectibles:'🎖️', graffiti:'🎨' };
    return map[cat] || '📦';
  }

  // ===== CSFLOAT API =====
  async function fetchCSFloatPriceList() {
    const resp = await fetch('https://csfloat.com/api/v1/listings/price-list');
    if (!resp.ok) throw new Error(`CSFloat error: ${resp.status}`);
    return await resp.json();
  }

  // ===== STEAM API =====
  async function fetchSteamPrice(name) {
    if (steamCache[name] && Date.now() - steamCache[name].time < 1800000) {
      return steamCache[name].price;
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
      let price = null;
      if (data.lowest_price) {
        price = parseFloat(data.lowest_price.replace('$', '').replace(',', ''));
      } else if (data.median_price) {
        price = parseFloat(data.median_price.replace('$', '').replace(',', ''));
      }
      if (price) steamCache[name] = { price, time: Date.now() };
      return price;
    } catch (e) {
      return null;
    }
  }

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
                  <span class="ht-pct ${t.pct >= 50 ? 'green' : t.pct >= 20 ? 'yellow' : ''}">${t.pct.toFixed(0)}%</span>
                  <span class="ht-usd">+$${t.usd.toFixed(2)}</span>
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
        resultsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">🔍</span><h3>Sin resultados</h3><p>No hay items que cumplan los filtros actuales. Probá con un rango de precio más amplio.</p></div>`;
        showToast('🔍 Sin items con los filtros actuales', 'warning');
        scanBtn.disabled = false;
        scanBtn.textContent = '🚀 Escanear';
        scanning = false;
        return;
      }

      candidates.sort((a, b) => b.score - a.score);
      const toScan = candidates.slice(0, maxItems);
      const totalToScan = toScan.length;

      statusText.textContent = `🔄 Consultando Steam para ${totalToScan} items (lotes de 10)...`;
      progressFill.style.width = '25%';
      allResults = [];

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
          const steamPriceRaw = await fetchSteamPrice(item.name);
          if (steamPriceRaw && steamPriceRaw > item.priceCs) {
            const steamAfterFee = steamPriceRaw * 0.85;
            const profit = steamAfterFee - item.priceCs;
            const profitPercent = ((steamAfterFee - item.priceCs) / item.priceCs) * 100;
            return {
              market_name: item.name,
              csfloat_price: item.priceCs,
              steam_price: steamAfterFee,
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
        progressFill.style.width = `${Math.min(100, 25 + (allResults.length / Math.max(totalToScan, 1)) * 70)}%`;
        statusText.textContent = `⏹️ Detenido: ${allResults.length} oportunidades encontradas antes de detener`;
        if (allResults.length > 0) {
          renderResults();
          showToast(`⏹️ ${allResults.length} oportunidades encontradas (escaneo detenido)`, 'warning');
        } else {
          showToast('⏹️ Escaneo detenido sin resultados', 'warning');
        }
      } else {
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
      resultsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon" style="font-size:2.5rem">❌</span><h3>Error</h3><p>${e.message}</p></div>`;
      statusText.textContent = '❌ Error durante el escaneo';
      showToast(`❌ Error: ${e.message}`, 'error');
    }

    scanBtn.disabled = false;
    scanBtn.textContent = '🚀 Escanear';
    scanBtn.classList.remove('scanning');
    scanning = false;
  }

  // ===== RENDER =====
  function renderResults() {
    const minProfit = parseInt(profitFilter?.value || '0');
    const minPriceVal = parseFloat(minPrice?.value || '0');
    const maxPriceVal = parseFloat(maxPrice?.value || '99999');

    const filtered = allResults.filter(r =>
      r.profit_percent >= minProfit &&
      r.csfloat_price >= minPriceVal &&
      r.csfloat_price <= maxPriceVal
    );

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
            <span class="empty-icon" style="font-size:2.5rem">🎯</span>
            <h3>Preparado para escanear</h3>
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

    $('#avgProfit').textContent = `$${avg.toFixed(2)}`;
    $('#maxProfit').textContent = `$${max.toFixed(2)}`;

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
          <td class="price-csfloat">$${r.csfloat_price.toFixed(2)}</td>
          <td class="price-steam">$${r.steam_price.toFixed(2)}</td>
          <td class="${pClass}">+$${r.profit_usd.toFixed(2)}</td>
          <td class="${pClass}">${r.profit_percent.toFixed(0)}%</td>
          <td class="qty">${r.quantity}</td>
          <td class="cell-actions">
            <a href="https://csfloat.com/search?market_hash_name=${encodeURIComponent(r.market_name)}"
               target="_blank" class="action-link" title="Ver en CSFloat">CSF</a>
            <a href="https://steamcommunity.com/market/listings/730/${encodeURIComponent(r.market_name)}"
               target="_blank" class="action-link steam" title="Ver en Steam Market">STM</a>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    resultsContainer.innerHTML = html;
  }

  // ===== EVENT DELEGATION (reemplaza los inline onclick) =====
  // Ordenar tabla por click en headers
  resultsContainer.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const key = th.dataset.sort;
      allResults.sort((a, b) => {
        if (typeof a[key] === 'string') return a[key].localeCompare(b[key]);
        return b[key] - a[key];
      });
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
  [profitFilter, minPrice, maxPrice, categoryFilter].forEach(el => {
    if (el) el.addEventListener('change', () => {
      if (allResults.length > 0) renderResults();
    });
  });

  // ===== LOCAL STORAGE =====
  ['profitFilter', 'minPrice', 'maxPrice', 'categoryFilter', 'maxItemsFilter'].forEach(id => {
    const el = $(id);
    const saved = localStorage.getItem(id);
    if (el && saved) el.value = saved;
    if (el) el.addEventListener('change', () => localStorage.setItem(id, el.value));
  });

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
})();
