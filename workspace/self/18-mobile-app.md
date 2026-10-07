# 18 — Mobile app

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `web-ui/src/mobile/`, `web-ui/src/mobile-v2/`, `web-ui/mobile.html`, `src/gateway/pairing/`
> **Read this when:** Changing Prometheus Mobile, its PWA entry, pairing, mobile route chunks, chat recovery, or phone-specific styling. Desktop specifics are in [17 Desktop web UI](17-desktop-web-ui.md).

## TL;DR
- Mobile is a first-class web/PWA surface, not an Electron view; `web-ui/mobile.html` loads `/src/mobile/mobile-entry.js`.
- Mobile source is mainly `web-ui/src/mobile/`; `mobile-v2/` is a separate evolving implementation. Inspect the current entry/router before assuming v2 owns a live page.
- Routes are loaded by owner chunk from `mobile-router.js`; secondary screens are lazy-loaded to keep the initial mobile chat path lean.
- `manifest.webmanifest`, the mobile service worker, and `/mobile/*` gateway document routing are part of the install/offline contract.
- Pairing is a security handshake with a desktop approval step; a QR/deep link alone is not the trust grant. Backend state/auth lives in `src/gateway/pairing/` and pairing routes.
- Raul's phone is **not on the tailnet**. Its live access is via the public Tailscale Funnel URL `https://desktop-sc61io5.tailca7310.ts.net`; do not tell him to use a private tailnet IP/name.
- Mobile chat has explicit restart/stream recovery and merges restored trace state. A reconnect must not create duplicate tool streams or revive a finished assistant response.
- Mobile question/approval cards need their own visible, tappable controls and must preserve gateway-owned pending state; question cards are not the same thing as final-action approvals.
- The liquid-glass hamburger treatment is settled/accepted product styling; `mobile-hamburger-liquid-glass.js` and its CSS are live source, not dead CSS.
- Test narrow touch/keyboard/browser behavior and the generated public mirror; don't assume a desktop pass covers iOS/PWA behavior.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Mobile document | `web-ui/mobile.html` → mobile boot repair; `web-ui/manifest.webmanifest` | Manifest link and initial repair UI. |
| Mobile entry | `web-ui/src/mobile/mobile-entry.js` | Adds mobile document classes, starts router and lazy markdown libraries. |
| Router and chunks | `web-ui/src/mobile/mobile-router.js` → `MOBILE_ROUTE_OWNER_LOADERS` | Pair, gateways, chat/voice, schedule, teams, tasks, settings, hub/more, proposals, creative, subagents. |
| Shell/navigation | `web-ui/src/mobile/mobile-shell.js` | Main shell, drawer and navigation semantics. |
| API/WebSocket | `web-ui/src/mobile/mobile-api.js`, `web-ui/src/ws.js`, `web-ui/src/api.js` | Paired token handling is shared with API/WS wrappers. |
| Session gateway catalog | `web-ui/src/mobile/mobile-gateway-catalog.js` | Gateway and target namespacing; paired or remote gateway selection. |
| Chat page/render | `web-ui/src/mobile/mobile-pages.js`, `mobile-chat-page-runtime.js`, `mobile-chat-message-renderer.js` | Chat and voice still share some page/runtime state. |
| Recovery | `web-ui/src/mobile/mobile-chat-recovery-state.js`, `mobile-restart-continuity.js`, `mobile-background-trace-merge.js` | Reconcile live streams after restarts/reconnects. |
| Pairing UI | `web-ui/src/mobile/mobile-pairing-page.js` | QR/manual challenge and claim flow. |
| Pairing persistence/auth | `src/gateway/pairing/pairing-store.ts`, `pairing-admin-auth.ts`; `src/gateway/routes/pairing.router.ts` | Persistent paired-device store, challenge claims, desktop authority. |
| PWA/cache | `web-ui/src/mobile/mobile-pwa.js`, `web-ui/manifest.webmanifest`, `web-ui/service-worker.js` | Check generated mirror/cache behavior after web changes. |
| Liquid glass | `web-ui/src/mobile/mobile-hamburger-liquid-glass.js`, `web-ui/src/styles/mobile-hamburger-liquid-glass.css`, `web-ui/src/vendor/liquid-glass.js` | Intentional, accepted canvas/compositor treatment. |
| v2 implementation | `web-ui/src/mobile-v2/{app,core,features,ui}/` | Keep its ownership and shipping status explicit; entry is `mobile-v2-entry.js`. |
| Public mirror | `generated/public-web-ui/mobile.html` and generated assets | Built output; regenerate via `npm run sync:web-ui` in a safe tree. |

## How it works

### Document, route and chunks
Gateway/browser navigation can select `mobile.html` for `/mobile/*`, pairing queries and legacy PWA entry URLs. `mobile-entry.js` applies the mobile boot classes and starts `mobile-router.js`. The router activates only for mobile path/hash forms, so merely loading the shared bootstrap must not hijack desktop navigation. Route owners are imported on demand; chat/voice share `mobile-pages.js`, while settings, schedule, proposals, teams, tasks and other sections have their own chunks. Preserve route ownership and deep-link behavior when adding a screen.

Markdown vendor code is deliberately not needed by pairing and secondary routes. The mobile entry exposes a deferred ensure-libraries hook; chat starts it alongside its owner chunk and can rerender when ready. Keep startup costs and route boundaries in mind when changing imports.

### Gateway pairing and reachability
The pairing page requests/uses a challenge; a phone claim is pending until a trusted desktop pairing authority approves it. `pairing-store.ts` persists the device registry, short-lived challenges, and pending claims (documented store name: `paired-devices.json`). The plaintext device token is handed to the phone after approval, then sent by the mobile API/WebSocket wrappers. Pairing authority checks live in `pairing-admin-auth.ts`; don't loosen those checks while debugging a UI failure.

Tailscale Serve and Funnel serve different audiences. Serve is tailnet-private: it works only for devices signed into that tailnet. Funnel is publicly reachable via HTTPS. Raul's phone is not on the tailnet, and the expected endpoint is `https://desktop-sc61io5.tailca7310.ts.net` (Funnel); a private tailnet hostname/IP is not a valid substitute. A gateway may also expose an alternate HTTPS port for dev, but keep its PWA origin separate from the live installation.

### Chat state recovery
Mobile chat does more than refresh messages: the active turn may have a stream row, tool events, agent/plan UI, and websocket events that need merging. Recovery utilities reconcile restart snapshots and background traces. Preserve a single live trace and do not overwrite a finished reply with a stale in-flight checkpoint. Recent merged changes explicitly fixed a finished-reply wipe, frozen-row duplication, tool-stream recovery and steer continuity; see `generated/changelog.md` for exact merged PRs (#554, #527, #519 and adjacent fixes).

Phone attachment uploads can downscale large images before transfer. The mobile composer, plan/agent docks, and popovers must remain above the soft keyboard. Verify after CSS/keyboard changes on a narrow viewport and, where possible, a real mobile browser.

### Question and approval cards
Questions suspend an interactive turn pending a user's choice or text; approval records represent a separate authorization decision. Render the current pending item visibly, submit the exact decision/answer once, and allow the server state to settle before removing it. Questions can be shared across gateway processes; they must not be replayed as if the suspended model turn had already completed. Approval state is enforced by gateway routes, not trusted because a mobile button was tapped. Consult [21 Security](21-security-approvals-permissions.md) before changing any approval semantics.

### Styling
Mobile styles are spread across `styles/mobile*.css`, component/page files and mobile owner modules. Shared appearance is adapted into mobile surface tokens. The hamburger uses a dedicated liquid-glass canvas/compositor that overlays its CSS treatment once ready; keep fallback/ready states and pointer/accessibility behavior. The glass CSS is part of the shipped look and is intentionally retained.

## Config & knobs
- PWA install identity and launch URLs: `web-ui/manifest.webmanifest`; verify `start_url`, scope and icon refs together.
- Per-device authorization: token storage uses `pm_device_token` in the shared browser API/WebSocket wrappers; don't log or copy token values into URLs/docs.
- Route activation and route owner imports: `web-ui/src/mobile/mobile-router.js`.
- Pairing store is beneath the gateway's config/state root; use the `getPrometheusLayout()` runtime path rules rather than hardcoding a profile path.
- Mobile user reachability for Raul: public Funnel domain listed in TL;DR, not tailnet-only Serve.

## Gotchas / sharp edges
- **Public Funnel is internet reachable:** pairing/admin authority and gateway auth still matter. Funnel is transport/reachability, not authentication.
- **Install origin is sticky:** switching live/dev host/port creates a different PWA origin and separate local storage. Don't expect a token/install from one origin to transfer automatically.
- **Route chunks are owners:** eager-importing all mobile pages increases startup work and defeats routing boundaries.
- **Boot repair/cache busting:** mobile document contains a repair path for boot failures. Check manifest/service-worker/generated entry together when changing public asset paths.
- **Restart race:** stale checkpoint replay can erase a completed reply, duplicate a live tool stream or show outdated plan state. Test stop/restart and reconnect, not only clean send.
- **Question vs approval:** a user's answer to a question is not implicit approval for a protected action; don't merge or auto-resolve these concepts.
- **Touch and keyboard:** drawers, $/slash menus, composer, sticky docks and viewport resize interact; desktop responsive emulation is only a partial check.
- **Glass fallback:** don't delete the ready-state CSS because its visual effect is compositor-generated. Test both canvas-ready and fallback states.

## How to change it safely
1. Locate route owner and related API/state code before editing; search both `/mobile` URL variants and pairing/deep-link callers.
2. Preserve gateway challenge/claim/approval/token boundaries; never embed device secrets in generated files or logs.
3. Check `generated/tests.md` for pairing decoder, mobile render, recovery and architecture contracts. Relevant current tests are named in `package.json` and generated test inventory; avoid hand-maintaining a test list here.
4. In a clean, owned workspace run focused tests, then `npm run sync:web-ui` and `npm run check:web-ui`.
5. Verify deep link + direct `/mobile/` route, normal mobile chat, paired API/WS auth, route chunk loads, question/approval presentation, recovery, keyboard/drawer interactions, theme and manifest/service worker.
6. Confirm public Funnel origin separately from any private Serve/dev origin. Do not call Raul's phone a tailnet peer.

## Related
- [17 Desktop web UI](17-desktop-web-ui.md) · [19 Onboarding/accounts/auth](19-onboarding-accounts-auth.md)
- [21 Security, approvals, permissions](21-security-approvals-permissions.md) · [23 Rich output/cards/artifacts](23-rich-output-cards-artifacts.md)
- [24 Release, packaging, update](24-release-packaging-update.md) · [tests inventory](generated/tests.md) · [routes inventory](generated/routes.md)
- Source hints (verify before relying): `workspace/self/WEB_UI_MOBILE_ENTRY_ROUTE_OWNERS_2026-08-22.md`, `MOBILE_DESKTOP_REGRESSION_AUDIT_2026-08-23.md`, and `WEB_UI_THEMES.md`.


## Route-owner reference

The router's route owner map is the starting point for feature ownership. Current route keys include:
- `pair` → `mobile-pairing-page.js`.
- `gateways` → `mobile-gateways-page.js`.
- `chat` and `voice` → `mobile-pages.js` shared runtime.
- `schedule` → `mobile-schedule-pages.js`.
- `teams` → `mobile-teams-pages.js`.
- `tasks` → `mobile-tasks-pages.js`.
- `settings` → `mobile-settings.js`.
- `hub` and `more` → `mobile-hub-pages.js`.
- `proposals` → `mobile-proposals-pages.js`.
- `creative` → `mobile-creative-pages.js`.
- `subagents` → `mobile-subagent-pages.js`.

The router stores owner promises/ready state so revisiting a route can reuse loaded code. Don't duplicate that registry inside a page. When adding a route, verify both pathname/hash activation and browser history behavior; a route that renders on a tap may still fail when opened directly from a QR/deep link.

## Pairing sequence checklist
1. Open the pairing page on the phone at the correct public Funnel origin.
2. Let the phone fetch/create a short-lived challenge or parse an intended pairing URI.
3. Submit the claim with the right challenge and client metadata.
4. Keep the UI pending while the desktop approval authority decides.
5. After approval, securely receive the device token and store it in the intended local origin profile.
6. Confirm authenticated API request and WebSocket connection.
7. Verify revoke/re-pair behavior and expired challenge handling.
8. Never copy a live token into a screenshot, support log, issue, or query string.

If step 5 succeeds but step 6 fails, inspect host/origin and the shared `getDeviceToken()` path before issuing another pairing claim. Duplicate claims can make troubleshooting harder and do not repair a server auth mismatch.

## PWA and service worker checks
- Verify the manifest resolves from the public origin with the expected content type.
- Confirm install identity (name/short name/icons/theme) matches the current branded UI.
- Test start URL and scope on the live mobile origin, not a desktop dev port by assumption.
- Validate service worker scope and cache version against the entry and route chunk URLs.
- Avoid caching private API responses or pairing challenges in a static asset cache.
- Ensure an update/repair flow can recover from stale hashed chunks and a changed manifest.
- Test first install with no cache and an upgrade with an older cache; both are relevant.
- Check network failure behavior: pairing should explain the issue rather than remain a blank root.
- `mobile.html` has boot repair logic that can force a cache-busted retry; preserve its one-retry guard.

## Mobile chat verification cases
- Send a short text turn and wait for a final response; ensure only one message is persisted.
- Start a tool-heavy turn and observe progress, completion, error and approval/question states.
- Switch away while running, then return; confirm live progress is recovered without duplicate rows.
- Stop/abort a turn, reload, and confirm the terminal state remains terminal.
- Reload during a streaming turn; verify a stale checkpoint cannot wipe a final answer.
- Continue a steer or follow-up on a running thread and check stream continuity.
- Open a historical turn containing rich cards/media; ensure normalizer/merge retains all fields.
- Upload a large phone photo and confirm client downscaling does not lose orientation or fail silently.
- Open $/slash popovers and type while the on-screen keyboard is visible.
- Test voice page/chat handoff because they share live-call runtime state.

## Styling, accessibility and interaction details
- Use safe-area insets for top/bottom controls and account for status-bar theme.
- The composer has an explicit keyboard band/stack owner; avoid a second `position:fixed` keyboard workaround.
- Check scroll anchoring at the bottom of chat and when older history is prepended.
- Dialog and drawer controls must be keyboard-accessible where the platform exposes a hardware keyboard.
- Keep touch targets large enough and avoid hover-only affordances.
- Verify focus outlines in both P1 and alternate theme skins.
- The hamburger glass effect has a canvas-ready state and a fallback state; both should preserve contrast and navigation visibility.
- The accepted liquid-glass visual is intentionally sourced by JS/canvas plus CSS state; unused-looking CSS is not proof it is dead.


## Route verification matrix

| Entry URL | Expected owner | Validate |
|---|---|---|
| `/mobile/` | Router → default mobile screen | Fresh install, normal chat and gateway selection. |
| `/mobile/pair` or pairing deep-link form | Pairing owner | Challenge parse, expired/malformed code and claim status. |
| `/mobile/settings` | Settings owner | Return URL back to the intended route. |
| `/mobile/tasks`, `/mobile/teams` | Route-specific chunk | Direct load and navigation without eager-loading unrelated pages. |
| Legacy PWA/hash route | Mobile router compatibility | History/back behavior and no accidental desktop boot. |
| Unknown mobile path | Router fallback | Useful not-found/default route; no blank screen or chunk loop. |

Always validate the URL format against the current router and gateway document selection rather than relying only on this table. Route aliases can change while owner modules remain the same.

## Recovery invariants
- A final assistant message is immutable under later restart snapshots.
- A live tool trace is reconciled by stable IDs, not concatenated on every reconnect.
- A stopped/aborted turn remains stopped; recovery must not silently restart execution.
- A question-suspended turn remains pending until the user answers or the server explicitly expires/cancels it.
- A plan/agent runtime dock is associated with its chat/session, not a global last-seen turn.
- Replayed history is authoritative for settled messages; live deltas fill in only unfinished activity.
- Client recovery code should not fabricate a successful tool result when the server has no terminal event.
- Multiple gateway processes can share pending question/approval state; don't assume one process owns every event.
- Test during warm handoff and ordinary process restart separately; their timing differs.
- Keep any recovery payload bounded; do not replay an entire transcript as a tool event.


## Mobile debugging first-response notes

- Pairing page opens but claim is rejected: compare the exact host/origin, challenge expiry and desktop authority state; do not reuse an old QR screenshot.
- Pairing succeeds but sessions are empty: verify `pm_device_token` exists in this origin's storage and that the gateway session API adds it through the shared wrapper.
- Chat works until switching routes: inspect route owner load promise and whether the page's cleanup handler detached a shared websocket listener.
- App shows a white screen after update: inspect mobile entry repair UI, service-worker cache/version and hashed owner chunk availability.
- Composer jumps under keyboard: inspect keyboard-band/viewport owner and safe-area offsets before changing generic shell positioning.
- Old finished reply disappears after reload: check restart checkpoint/terminal state reconciliation; never work around it by forcing all recovered rows to live.
- Only tool activity duplicates: compare stable activity IDs and the background trace merge path, then test reconnect twice.
- Glass menu is invisible: inspect canvas readiness event and fallback contrast before deleting CSS or compositor initialization.
- Appearance differs between desktop and phone: inspect theme-to-mobile token mapping and cache state before hardcoding colors.
- Funnel URL fails from phone: first verify the Funnel is active on the expected public hostname/port; tailnet Serve is inaccessible from Raul's phone.
