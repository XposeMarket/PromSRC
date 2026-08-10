# Local UI URLs — self-edit and browser QA

Migrated from **MEMORY.md** `operational_rules` / `project_memory` (2026-06-16, 2026-07-05) on 2026-07-07.

## Default gateway (dev)

Assume port **18789** unless `gateway.port` in config differs.

| Surface | URL | When to use |
|--------|-----|-------------|
| Desktop web UI | `http://127.0.0.1:18789/?desktop=1` or `?mode=desktop` | Full desktop shell in browser automation; repro/fix desktop UI bugs |
| Mobile PWA shell | `http://127.0.0.1:18789/#mobile/chat` | Mobile layout, pairing, mobile chat/stream bugs |
| Bare root | `http://127.0.0.1:18789/` | Often routes to **mobile** on dev machine |

## Mobile routing gotcha (2026-07-05)

On Raul's dev machine, plain `http://127.0.0.1:18789/` frequently opens the mobile shell (`#mobile/chat`, `body.pm-mobile-active`) because `localStorage` `pm_force_mobile=1` and/or `pm_device_token` make the router treat wide desktop Chrome as a paired mobile session.

- Clearing `pm_force_mobile` alone may not stick if device token + mobile hash re-assert mobile routing.
- For desktop QA in browser tools, **always** use `?desktop=1` (or `?mode=desktop`).

## Self-edit rule

Whenever Raul asks for Prometheus self edits, fixes, or internal UI investigation: open the relevant URL above with **browser_** / **desktop_** tools, reproduce live, and verify the fix in the running UI — do not reason about UI behavior only from code.

## Related self docs

- [16-mobile-app.md](16-mobile-app.md) — mobile source and verification
- [17-desktop-web-ui.md](17-desktop-web-ui.md) — desktop web UI maintenance
- [02-startup-runtime.md](02-startup-runtime.md) — gateway host, pairing, Tailscale funnel on 18789

## P1-7 desktop link QA — 2026-08-09

| Link case | Expected route |
|---|---|
| Same-origin Prometheus route | Normal app/router navigation |
| `127.0.0.1`/`localhost` gateway route on port 18789 | Local gateway UI; never an external destination |
| External HTTP/HTTPS, ordinary click | Prometheus Browser surface/lane |
| External HTTP/HTTPS, context menu or Shift+F10 | Accessible Browser or Open externally action |
| `Ctrl`/`Meta`/`Shift`/`Alt` click | Native modifier/target behavior retained |
| Download/file path/`mailto:`/`tel:` | Existing non-Browser flow |
| OAuth/system-auth control | Explicit external flow |
| `javascript:`/`data:`/credential URL | Blocked, except the trusted `javascript:void(0)` placeholder with its existing action |

Run `npm run test:link-routing`, `npm run test:electron-security-boundary`, `npm run check:web-ui`, and reload `http://127.0.0.1:18789/?desktop=1` after source/generated sync. Do not restart the terminal gateway or user Chrome for this check.
