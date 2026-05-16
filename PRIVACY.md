# Privacy Policy — Pacman Eater

**Effective date:** 2026-05-16

## Summary

Pacman Eater is a browser game extension. **It does not collect, store, transmit, or share any user data.** Everything the extension does happens locally in your browser.

## What the extension does

- When you click the extension icon and choose a mode, the extension takes a screenshot of the currently visible tab (using `chrome.tabs.captureVisibleTab`) and uses it as the game arena drawn on a canvas overlay.
- It injects a local script (`content.js`, bundled in the extension package) into the active tab to render the game.
- All game logic, scoring, and visuals run locally in your browser. The captured screenshot is held in memory only for the duration of the game session and is discarded when you press Esc or close the tab.

## What data is collected

**None.**

- We do not collect personally identifiable information.
- We do not collect health data.
- We do not collect financial or payment information.
- We do not collect authentication credentials.
- We do not collect personal communications.
- We do not collect location data.
- We do not collect browsing or web history.
- We do not collect user activity (clicks, keystrokes, mouse position).
- We do not collect website content.

## What data is transmitted

**None.**

- The extension makes no network requests to any server.
- No analytics, telemetry, or tracking of any kind.
- No third-party SDKs are loaded.
- No remote code is executed — all scripts are bundled in the extension package.

## Permissions

- `activeTab` — required to capture a screenshot of the currently active tab as the game arena.
- `scripting` — required to inject the bundled game script (`content.js`) into the active tab when you start a game.

These permissions are used only for the gameplay described above.

## Children's privacy

The extension does not knowingly collect data from anyone, including children.

## Changes to this policy

If this policy changes, the updated version will be published at the same URL.

## Contact

For questions, open an issue at https://github.com/mikhail-kozulin/pacman-eater/issues or contact `kozyulin.mikhail@gmail.com`.
