# Session hygiene — browser_close

Migrated from workspace SOUL.md (2026-07-07 soul slim-down).

## Rule

After finishing a browser task, call `browser_close` immediately to avoid CDP port conflicts and wedged Chrome profiles.

## Exception

Keep the browser open when the user asks for follow-up work in the same session.

## Where else

- **self/04-browser.md** — §9 session records and routing
- **MEMORY.md** — `operational_rules` (browser_close)