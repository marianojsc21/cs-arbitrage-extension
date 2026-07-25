document.addEventListener('DOMContentLoaded', () => {
  const versionTag = document.getElementById('versionTag');
  const btnProfit = document.getElementById('btnProfit');
  const btnCapitallet = document.getElementById('btnCapitallet');

  // Mostrar versión actual
  versionTag.textContent = 'v' + chrome.runtime.getManifest().version;

  // Abrir Profit Finder
  btnProfit.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html?mode=profit') });
  });

  // Abrir Capitallet
  btnCapitallet.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html?mode=capitallet') });
  });
});
