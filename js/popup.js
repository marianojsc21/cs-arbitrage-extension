document.addEventListener('DOMContentLoaded', () => {
  const profitInput = document.getElementById('profitMin');
  const maxPriceInput = document.getElementById('maxPrice');
  const enabledToggle = document.getElementById('enabled');
  const saveBtn = document.getElementById('saveBtn');
  const savedMsg = document.getElementById('savedMsg');
  const openApp = document.getElementById('openApp');
  const updateBanner = document.getElementById('updateBanner');
  const updateText = document.getElementById('updateText');
  const btnUpdate = document.getElementById('btnUpdate');
  const currentVersionEl = document.getElementById('currentVersion');
  const checkUpdateBtn = document.getElementById('checkUpdateBtn');
  const pizzaLoading = document.getElementById('pizzaLoading');
  const mainContent = document.getElementById('mainContent');

  const currentVersion = chrome.runtime.getManifest().version;
  currentVersionEl.textContent = currentVersion;

  chrome.storage.local.get(['profitMin', 'maxPrice', 'enabled', 'updateAvailable', 'remoteVersion'], (result) => {
    if (result.profitMin) profitInput.value = result.profitMin;
    if (result.maxPrice) maxPriceInput.value = result.maxPrice;
    if (result.enabled !== undefined) enabledToggle.checked = result.enabled;

    if (result.updateAvailable && result.remoteVersion) {
      showUpdateBanner(result.remoteVersion);
    }
  });

  function showUpdateBanner(remoteVersion) {
    updateText.textContent = `v${currentVersion} → v${remoteVersion}`;
    updateBanner.classList.add('show');
  }

  function showPizzaLoading() {
    pizzaLoading.classList.add('show');
    mainContent.style.display = 'none';
  }

  function hidePizzaLoading() {
    pizzaLoading.classList.remove('show');
    mainContent.style.display = 'block';
  }

  openApp.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  });

  saveBtn.addEventListener('click', () => {
    const config = {
      profitMin: parseInt(profitInput.value) || 15,
      maxPrice: parseInt(maxPriceInput.value) || 50,
      enabled: enabledToggle.checked
    };

    chrome.storage.local.set(config, () => {
      savedMsg.classList.add('show');
      setTimeout(() => savedMsg.classList.remove('show'), 1500);

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'configUpdated' }).catch(() => {});
        }
      });
    });
  });

  checkUpdateBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    checkUpdateBtn.textContent = 'Buscando...';

    chrome.runtime.sendMessage({ action: 'checkUpdate' }, (response) => {
      if (response && response.available) {
        showUpdateBanner(response.remote);
      } else {
        updateBanner.classList.remove('show');
        chrome.storage.local.set({ updateAvailable: false });
        alert('Estas en la ultima version!');
      }
      checkUpdateBtn.textContent = 'Buscar actualizaciones';
    });
  });

  btnUpdate.addEventListener('click', () => {
    showPizzaLoading();

    const downloadUrl = 'https://github.com/nisutalineage2-tech/csmuza/archive/refs/heads/main.zip';

    setTimeout(() => {
      chrome.tabs.create({ url: downloadUrl });
    }, 500);

    setTimeout(() => {
      hidePizzaLoading();
      updateBanner.classList.remove('show');
      chrome.storage.local.set({ updateAvailable: false });
    }, 3000);
  });
});
