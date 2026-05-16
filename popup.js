document.querySelectorAll('button[data-mode]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    let screenshot;
    try {
      screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (e) {
      alert('Не удалось снять скриншот. Открой обычную веб-страницу (не chrome://).');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    await chrome.tabs.sendMessage(tab.id, { type: 'START_PACMAN', screenshot, mode });
    window.close();
  });
});
