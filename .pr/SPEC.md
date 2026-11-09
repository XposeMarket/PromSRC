# Native browser upload repair
Surface: backend
Parity: Shared desktop/mobile/channel/agent tool. Electron native session routing repaired; Playwright unchanged.
Test: node scripts/test-inhouse-upload.cjs
## Problem
Active native browser upload incorrectly reports no session.
## Chosen approach
Tier 1 restore: native-first routing, authenticated Electron session-owned CDP file selection. Extra WIP approved card31f5e507. No publishing or permission changes.
## Acceptance
Real Chromium hidden input and ref upload, bad path/target failures and debugger cleanup pass. Typecheck and hard gates. Live TikTok test after merge and Electron relaunch.
## Files
- src/gateway/browser-tools.ts
- electron/main.js
- electron/browser-upload.cjs
- scripts/test-inhouse-upload.cjs
- workspace/self/13-browser-desktop.md
- .pr/SPEC.md
## Risks
Electron must relaunch or new route unavailable; errors fail closed. File selection is not successful remote processing. Revert commit to roll back. No permission or saved-state changes.
