(async function() {
  'use strict';

  let config = { profitMin: 10, enabled: true };
  let processedListings = new Set();
  let observer = null;

  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getConfig' }, (response) => {
        if (response) {
          config = response;
        }
        resolve();
      });
    });
  }

  async function getSteamPrice(marketName) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getSteamPrice', marketName }, (response) => {
        resolve(response?.price || null);
      });
    });
  }

  function createProfitBadge(csfloatPrice, steamPrice) {
    const profit = steamPrice - csfloatPrice;
    const profitPercent = ((steamPrice - csfloatPrice) / csfloatPrice) * 100;

    if (profitPercent < config.profitMin) return null;

    const badge = document.createElement('div');
    badge.className = 'csmuza-profit-badge';

    const color = profitPercent >= 30 ? '#00ff88' :
                  profitPercent >= 20 ? '#88ff00' :
                  profitPercent >= 10 ? '#ffcc00' : '#ff8800';

    badge.innerHTML = `
      <div class="profit-header" style="border-left: 3px solid ${color}">
        <span class="profit-icon">💰</span>
        <span class="profit-text">PROFIT</span>
      </div>
      <div class="profit-details">
        <div class="profit-row">
          <span>CSFloat:</span>
          <span>$${csfloatPrice.toFixed(2)}</span>
        </div>
        <div class="profit-row">
          <span>Steam:</span>
          <span>$${steamPrice.toFixed(2)}</span>
        </div>
        <div class="profit-row profit-total" style="color: ${color}">
          <span>Ganancia:</span>
          <span>+$${profit.toFixed(2)} (${profitPercent.toFixed(0)}%)</span>
        </div>
      </div>
    `;

    return badge;
  }

  function findListingElements() {
    const selectors = [
      '[class*="listing"]',
      '[class*="item"]',
      '[data-listing-id]',
      'a[href*="/listing/"]',
      '.search-result',
      '.market-listing-item'
    ];

    let elements = [];
    for (const selector of selectors) {
      const found = document.querySelectorAll(selector);
      if (found.length > 0) {
        elements = [...elements, ...found];
      }
    }

    const allLinks = document.querySelectorAll('a[href*="/listing/"]');
    elements = [...elements, ...allLinks];

    return [...new Set(elements)];
  }

  function extractListingInfo(element) {
    const text = element.textContent || '';

    const nameEl = element.querySelector('[class*="name"], [class*="title"], h3, h4, .market_listing_item_name');
    let marketName = nameEl ? nameEl.textContent.trim() : null;

    if (!marketName) {
      const link = element.querySelector('a[href*="/listing/"]') || element.closest('a[href*="/listing/"]');
      if (link) {
        marketName = link.textContent.trim();
      }
    }

    if (!marketName) {
      const allText = text.split('\n').map(t => t.trim()).filter(t => t.length > 3);
      for (const t of allText) {
        if (t.includes('|') || t.includes('AK') || t.includes('M4') || t.includes('AWP')) {
          marketName = t;
          break;
        }
      }
    }

    const priceMatch = text.match(/\$[\d,.]+/);
    let price = null;
    if (priceMatch) {
      price = parseFloat(priceMatch[0].replace('$', '').replace(',', ''));
    }

    const floatMatch = text.match(/(\d+\.\d{4,})/);
    const floatValue = floatMatch ? parseFloat(floatMatch[1]) : null;

    return { marketName, price, floatValue, element };
  }

  async function processListings() {
    if (!config.enabled) return;

    const listings = findListingElements();

    for (const listing of listings) {
      const id = listing.dataset?.listingId ||
                 listing.querySelector('a[href*="/listing/"]')?.href ||
                 listing.textContent.substring(0, 50);

      if (processedListings.has(id)) continue;

      const info = extractListingInfo(listing);
      if (!info.marketName || !info.price || info.price <= 0) continue;

      processedListings.add(id);

      const steamPrice = await getSteamPrice(info.marketName);

      if (steamPrice && steamPrice > info.price) {
        const badge = createProfitBadge(info.price, steamPrice);
        if (badge) {
          const container = listing.querySelector('[class*="price"], [class*="info"]') || listing;
          container.style.position = 'relative';
          container.appendChild(badge);
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  }

  function addGlobalIndicator() {
    const existing = document.getElementById('csmuza-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.id = 'csmuza-indicator';
    indicator.innerHTML = `
      <div class="indicator-content">
        <span class="indicator-dot ${config.enabled ? 'active' : 'paused'}"></span>
        <span>CSMuza: ${config.enabled ? 'ON' : 'OFF'}</span>
        <span class="indicator-min">Min: ${config.profitMin}%</span>
      </div>
    `;
    document.body.appendChild(indicator);
  }

  async function init() {
    await loadConfig();
    addGlobalIndicator();
    await processListings();

    observer = new MutationObserver(() => {
      setTimeout(processListings, 1000);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setInterval(processListings, 10000);
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'configUpdated') {
      loadConfig().then(() => {
        addGlobalIndicator();
        document.querySelectorAll('.csmuza-profit-badge').forEach(b => b.remove());
        processedListings.clear();
        processListings();
      });
    }
  });

  init();
})();
