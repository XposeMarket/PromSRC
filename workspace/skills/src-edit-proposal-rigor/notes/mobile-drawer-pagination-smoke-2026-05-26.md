# Mobile drawer pagination/source-edit smoke guardrail — 2026-05-26

## Evidence
- Raul asked for mobile/channel session lists to load only the latest 20 sessions and lazy-load the next 20 on scroll (`audit/chats/transcripts/mobile_mpn3elz8_z4zeqd.md:19-83`).
- The initial implementation reported success after source edits and build/apply, but Raul immediately reported: “none of my sessions are loading.”
- Follow-up source evidence showed fragile drawer callback/helper threading in `web-ui/src/mobile/mobile-shell.js`: render/rerender paths must carry callbacks like `onNewChat`, and pagination helpers must exist before the drawer catch block hides the real error as “Could not load sessions.” Later diagnosis found `_currentDrawerSessionChannel()` was called before being defined/available in the shipped state (`Brain/skill-episodes/2026-05-26/episodes.jsonl:5-6`).

## Guardrail for future mobile shell/session edits
When editing `web-ui/src/mobile/mobile-shell.js`, `web-ui/src/mobile/mobile-api.js`, session routes, or mobile drawer/channel/session pagination:
1. Read every render/rerender/callback path, not just the first visible handler.
2. Grep/read all call sites for helpers like `_renderDrawerSessions`, `_wireDrawerSessionControls`, `_wireDrawerInfiniteScroll`, `_loadNextDrawerSessionPage`, and any newly introduced helper.
3. Ensure every callback used in a nested helper (`onNewChat`, `onOpenSession`, `loadSessions`, `searchSessions`) is threaded through every rerender path.
4. Verify the drawer does not catch and mask a thrown `ReferenceError` into a generic “Could not load sessions.”
5. After `sync:web-ui`/build/apply, perform or explicitly request a real mobile drawer smoke: open drawer, confirm first 20 sessions render, open Channels, confirm a non-mobile channel renders, click/scroll Load more, click a session, and tap New Chat.

## Reporting requirement
Do not report a mobile drawer/session pagination edit as complete based only on source sync/build. For behavior-bearing drawer/session changes, completion requires source-readback plus a mobile drawer smoke or a clearly stated live-smoke blocker.