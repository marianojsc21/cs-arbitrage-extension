let steamPrices = {};
let profitMin = 10;
let enabled = true;

const GITHUB_RAW = 'https://raw.githubusercontent.com/marianojsc21/cs-arbitrage-extension/main';
const GITHUB_MANIFEST = GITHUB_RAW + '/manifest.json';
const FILES_TO_UPDATE = [
  'js/app.js',
  'js/smart-invest.js',
  'js/market-sniper.js',
  'js/history-io.js',
  'js/init.js',
  'js/storage.js',
  'js/csfloat.js',
  'js/loader.js',
  'js/content.js',
  'js/popup.js',
  'css/styles.css',
  'popup.html',
  'app.html'
];
const CHECK_INTERVAL = 3600000;

chrome.storage.local.get(['profitMin', 'enabled', 'lastVersion'], (result) => {
  profitMin = result.profitMin || 10;
  enabled = result.enabled !== false;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSteamPrice') {
    fetchSteamPrice(request.marketName).then(price => {
      sendResponse({ price });
    });
    return true;
  }

  if (request.action === 'getConfig') {
    chrome.storage.local.get(['profitMin', 'enabled', 'lastVersion', 'updateAvailable', 'remoteVersion'], (result) => {
      sendResponse({
        profitMin: result.profitMin || 10,
        enabled: result.enabled !== false,
        lastVersion: result.lastVersion || chrome.runtime.getManifest().version,
        updateAvailable: result.updateAvailable || false,
        remoteVersion: result.remoteVersion || null
      });
    });
    return true;
  }

  if (request.action === 'setConfig') {
    profitMin = request.profitMin;
    enabled = request.enabled;
    chrome.storage.local.set({ profitMin, enabled });
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'checkUpdate') {
    checkForUpdate().then(result => sendResponse(result));
    return true;
  }

  if (request.action === 'getUpdatedFile') {
    chrome.storage.local.get(['updatedFiles'], (result) => {
      const files = result.updatedFiles || {};
      sendResponse({ content: files[request.fileName] || null });
    });
    return true;
  }

  if (request.action === 'performUpdate') {
    performAutoUpdate().then(result => sendResponse(result));
    return true;
  }
});

async function fetchSteamPrice(marketName) {
  if (steamPrices[marketName] && Date.now() - steamPrices[marketName].time < 300000) {
    return steamPrices[marketName].price;
  }

  try {
    const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(marketName)}`;
    const response = await fetch(url);
    const data = await response.json();

    let price = null;
    if (data.lowest_price) {
      price = parseFloat(data.lowest_price.replace('$', '').replace(',', '.'));
    } else if (data.median_price) {
      price = parseFloat(data.median_price.replace('$', '').replace(',', '.'));
    }

    if (price) {
      steamPrices[marketName] = { price, time: Date.now() };
    }
    return price;
  } catch (e) {
    return null;
  }
}

async function checkForUpdate() {
  try {
    const currentVersion = chrome.runtime.getManifest().version;
    const resp = await fetch(GITHUB_MANIFEST + '?t=' + Date.now());
    const remoteManifest = await resp.json();
    const remoteVersion = remoteManifest.version;

    const isNewer = compareVersions(remoteVersion, currentVersion);

    if (isNewer) {
      chrome.storage.local.set({ updateAvailable: true, remoteVersion });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
      return { available: true, current: currentVersion, remote: remoteVersion };
    }

    chrome.storage.local.set({ updateAvailable: false });
    chrome.action.setBadgeText({ text: '' });
    return { available: false, current: currentVersion, remote: remoteVersion };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

/**
 * Comparación semántica de versiones (major.minor.patch).
 * Retorna true si `remote` es estrictamente más nueva que `local`.
 *
 * Maneja correctamente casos como 3.10.0 vs 3.9.0 (que fallarían
 * con comparación de strings: "3.10.0" < "3.9.0" lexicográficamente).
 * También tolera partes faltantes ("3.7" == "3.7.0") y no numéricas.
 */
function compareVersions(remote, local) {
  const parse = (v) => String(v || '').trim().split('.').map(p => {
    // Ignorar sufijos tipo "1-beta": solo interesa la parte numérica
    const m = /^(\d+)/.exec(p);
    const n = m ? parseInt(m[1], 10) : NaN;
    return Number.isFinite(n) ? n : 0;
  });
  const r = parse(remote);
  const l = parse(local);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function performAutoUpdate() {
  try {
    const resp = await fetch(GITHUB_MANIFEST + '?t=' + Date.now());
    const remoteManifest = await resp.json();
    const remoteVersion = remoteManifest.version;

    const updatedFiles = {};

    for (const file of FILES_TO_UPDATE) {
      try {
        const fileResp = await fetch(GITHUB_RAW + '/' + file + '?t=' + Date.now());
        if (fileResp.ok) {
          updatedFiles[file] = await fileResp.text();
        }
      } catch (e) {
        console.error(`Error downloading ${file}:`, e);
      }
    }

    updatedFiles['manifest.json'] = JSON.stringify(remoteManifest);

    await chrome.storage.local.set({
      updatedFiles,
      lastVersion: remoteVersion,
      updateAvailable: false,
      updateTimestamp: Date.now()
    });

    chrome.action.setBadgeText({ text: '' });

    return { success: true, version: remoteVersion, filesUpdated: Object.keys(updatedFiles).length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

chrome.alarms.create('checkUpdate', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkUpdate') checkForUpdate();
});

checkForUpdate();
