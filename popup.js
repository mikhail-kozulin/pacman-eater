document.querySelectorAll('button[data-mode]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Инжектим content script (содержит и игровой движок, и модуль фонового режима)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    if (mode === 'background') {
      // Фоновый режим: НЕ снимаем скриншот, не запускаем игру.
      // Котик появляется поверх живой страницы и жрёт реальные DOM-элементы
      // через 3 секунды простоя (мышь/клавиатура/скролл).
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_BACKGROUND' });
    } else {
      // Соло / Парный — обычная игра по скриншоту
      let screenshot;
      try {
        screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      } catch (e) {
        alert('Не удалось снять скриншот. Открой обычную веб-страницу (не chrome://).');
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'START_PACMAN', screenshot, mode });
    }

    window.close();
  });
});
