# Skill Phase 2C/2D completion — 2026-07-12

## Outcome

Phase 2C completed for Git, frontend quality, native web extraction, and the available database path. Phase 2D consolidated the redundant voice/browser workflow and verified the safe desktop portions without restarting or messaging through the active ChatGPT app.

## Promoted to ready

- `git-workflow`: disposable bare remote passed clone, upstream tracking, push, fetch, fast-forward pull, commits, tags, logs, diffs, and clean-worktree checks.
- `frontend-quality-guard`: renamed from `codex-frontend-engineer`; applies to every frontend change, including tiny HTML pages. Its Vite fixture installed and built, static audit passed, desktop/mobile layouts had no horizontal overflow, search/filter interactions worked, and browser console checks were clean. Visual QA caught excessive card framing in the bundled template; the template was corrected and rechecked.
- `web-scraper` / Web Research and Extraction: simplified to search/fetch first, browser full-page collection for JS pages, structured DOM extraction for repeated data, and clean source-grounded presentation. The real Prometheus browser tools extracted 30 JS-generated records, retained a missing field as `null`, collected the complete page, and stopped at the expected sentinel.
- `ai-surface-smoke-research`: now the shared typed/voice browser-and-desktop smoke workflow. Prometheus browser execution, ChatGPT discovery/focus, Claude discovery, and missing-Claude-window recovery were verified.

## Merged/deprecated

- `voice-browser-desktop-smoke-test` is a deprecated, triggerless compatibility redirect to `ai-surface-smoke-research`.
- `codex-frontend-engineer` was renamed to `frontend-quality-guard`; the stale overlay was removed.

## Still partial by design

- `database-query`: Python SQLite passed earlier. No `psql`, Docker, or `sqlite3.exe` executable is available for a disposable external-provider test; Postgres/Supabase remains setup-dependent.
- `dev-debugging`: explicit-only and intentionally deprioritized. No live ChatGPT message, Telegram delivery, or timer chain was created.
- `codex-desktop-restart`: explicit-only. The active ChatGPT app was not closed or restarted.

## Routing rules

- A prompt as small as “make a quick HTML page” routes to `frontend-quality-guard`.
- Voice and typed browser/desktop smoke prompts route to the merged AI-surface skill.
- Web extraction prompts route to `web-scraper`; unrelated coding prompts do not.
