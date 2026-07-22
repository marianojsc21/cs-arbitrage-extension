async function loadLatestFile(fileName) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getUpdatedFile', fileName }, (response) => {
      if (response && response.content) {
        resolve(response.content);
      } else {
        resolve(null);
      }
    });
  });
}

async function executeLatestScript(fileName) {
  const content = await loadLatestFile(fileName);
  if (content) {
    const script = document.createElement('script');
    script.textContent = content;
    document.head.appendChild(script);
    script.remove();
  }
}

window.CSMuzaLoader = { loadLatestFile, executeLatestScript };
