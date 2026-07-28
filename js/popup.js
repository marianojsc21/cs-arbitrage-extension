document.addEventListener('DOMContentLoaded', () => {
  const versionTag = document.getElementById('versionTag');
  const btnProfit = document.getElementById('btnProfit');
  const btnInvest = document.getElementById('btnInvest');
  const btnSniper = document.getElementById('btnSniper');

  // Mostrar versión actual
  versionTag.textContent = 'v' + chrome.runtime.getManifest().version;

  // Abrir Profit Finder
  btnProfit.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html?mode=profit') });
  });

  // Abrir Smart Invest
  btnInvest?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html?mode=invest') });
  });

  // Abrir Market Sniper
  btnSniper?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html?mode=sniper') });
  });
});
