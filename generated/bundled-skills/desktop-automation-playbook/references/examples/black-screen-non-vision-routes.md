# Black-screen / display-off desktop automation notes (2026-05-26)

Evidence from `audit/chats/transcripts/mobile_mpm49cb4_07eqw3.md:97-123` and `:125-296`: after Windows display/capture went visually black, Prometheus could still infer that the desktop session was alive with open windows, but vision-based reading was unreliable. the user then asked what could improve automation without vision.

Use this as a recovery/route-selection note when a desktop screenshot is black, blank, or display-off affected:

1. **Do not assume the app/session is gone just because vision is black.** First inspect structured state: window/process list, target window title, browser session/URL, process logs, or app-specific state where available.
2. **Prefer non-vision control planes before blind coordinate work:**
   - Browser/web app: use browser/CDP/DOM tools if the page is controllable.
   - Native Windows app: use available accessibility/window-text tools for visible text, names, values, roles, and bounds. If a documented desktop tool such as `desktop_get_window_text` is unavailable in the current runtime, do not loop on it; fall back to `desktop_get_accessibility_tree`, window/process metadata, keyboard shortcuts, app-specific APIs, or report the exact capability gap.
   - Windows Settings / system config: prefer registry/PowerShell/`powercfg`/documented config commands over clicking toggles.
   - Terminal/build/dev work: use process logs and command output rather than OCR.
3. **Treat Electron/canvas-heavy apps as mixed capability.** Codex/Claude-style apps may expose little useful accessibility text; use keyboard-shortcut playbooks plus state probes, and reserve screenshots for proof when vision works.
4. **If screenshots remain black but state probes work, report the split honestly:** “desktop session alive, visual capture black; non-vision probes show X.” Avoid pretending to read rendered content.
5. **For repeated important apps, maintain capability profiles/adapters** (e.g. screenshot reliability, accessibility text quality, keyboard shortcuts, DOM/API availability, best route, fallback route). This lets Prom choose API/DOM/accessibility/keyboard/shell paths before pixel-clicking.
6. **Longer-term product direction:** reduce dependence on the physical display by using virtual/background desktop workers, hidden browser contexts, app APIs/CLIs, and Prometheus internal tool/API routes for UI-equivalent actions.
