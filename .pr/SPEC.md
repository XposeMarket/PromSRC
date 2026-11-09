# Native browser upload repair
Surface: backend
Parity: Shared upload tool used by desktop/mobile/channel and agents; requires Electron for in-house sessions, Playwright fallback unchanged.
Test: node scripts/test-inhouse-upload.cjs

## Problem
Active in-house browser uploads incorrectly report no session because upload only checks Playwright.
## Chosen approach
Tier 1 restore. Route existing native session to authenticated Electron RPC and select local files using CDP against the exact session webContents. No publication, new permission, or persisted state. Extra WIP explicitly approved by Raul card31f5e507. Read/update self/13-browser-desktop.md. Electron relaunch required after separately approved merge.
## Acceptance
Hidden input and nested snapshot ref accept files in real Chromium; invalid paths/targets fail; debugger ownership preserved; native routing precedes Playwright. No TikTok post or schedule. Live proof pending deployed Electron.
## Files
- src/gateway/browser-tools.ts
- electron/main.js
- electron/browser-upload.cjs
- scripts/test-inhouse-upload.cjs
- workspace/self/13-browser-desktop.md
- .pr/SPEC.md
