document.getElementById('start').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Снимаем скриншот видимой области
  let screenshot;
  try {
    screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (e) {
    alert('Не удалось снять скриншот. Открой обычную веб-страницу (не chrome://).');
    return;
  }

  // Инжектим content script
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });

  // Передаём ему скриншот
  await chrome.tabs.sendMessage(tab.id, { type: 'START_PACMAN', screenshot });

  window.close();
});
