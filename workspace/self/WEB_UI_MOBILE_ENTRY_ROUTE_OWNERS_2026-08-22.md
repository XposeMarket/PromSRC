# Web UI performance program — PR 2 mobile entry and route owners

Date: 2026-08-22
Source baseline: `f19b299b82dfc2feb10ea1b6a4a7a02f81a46da9`
Stack base: PR #184 / `f8e7f2cbab6ca8bf05a87635c5ba7eaaedffbd81`
Branch: `perf/mobile-route-chunks`

## Outcome and evidence

`/mobile/*`, legacy `?source=pwa`, and pairing-query navigation now receive
`mobile.html` from the gateway fast path. The document is 1,363 raw bytes / 683
gzip bytes and references only the mobile stylesheet and mobile entry. It does
not contain the desktop app tree, ember canvas, desktop settings modal, jsQR,
or desktop styles. The source `index.html` is 564,532 canonical bytes / 109,543
gzip bytes, so this removes that parse/DOM burden from the normal mobile path.

The browser request-ledger test uses the generated public tree with service
workers disabled and real Chromium module loading. Results on the reference
Windows environment:

| Cold route | JS raw | JS gzip | Modules | CSS raw | CSS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pair | 583,197 | 148,678 | 22 | 624,149 | 104,697 |
| Schedule | 570,188 | 145,119 | 22 | 624,149 | 104,697 |
| Chat | 2,670,122 | 636,362 | 39 | 624,149 | 104,697 |

The CSS request total includes the focused mobile stylesheet's small imported
layers; `mobile.css` itself is 98,862 gzip bytes after canonical LF
normalization. Pair and Schedule are already below the initial 250 KB JS target.
Chat is deliberately recorded as a staged miss: its remaining Chat+Voice owner
and optional feature imports are work for PRs 4 and 6, not hidden by changing a
budget.

The same browser run proves:

- Chat requests `mobile-pages.js` but no Schedule, Teams, Tasks, Hub,
  Proposals, Creative, or Subagents route owner.
- Chat issues no `/api/bg-tasks`, `/api/schedules`, `/api/teams`, or
  `/api/subagents` request. The recurring idle prefetch and its API helper are
  removed.
- Pair requests only the pairing owner; Schedule requests its schedule owner
  without Chat or another secondary route owner.
- Mobile requests `mobile.css` and no desktop `base.css`, `components.css`,
  settings CSS, or multi-chat CSS.

## Entry and ownership map

| Concern/route | Owner | Load rule |
| --- | --- | --- |
| document boot | `mobile.html`, `mobile-entry.js` | mobile navigation only |
| install/update/cache lifecycle | `mobile-pwa.js`, `service-worker.js` | mobile entry only |
| shell/router/session drawer | `mobile-shell.js`, `mobile-router.js` | mobile entry |
| pairing | `mobile-pairing-page.js` | Pair route/auth gate |
| gateway catalog | `mobile-gateways-page.js` | Gateways route |
| Chat + inline Voice | `mobile-pages.js` | Chat or Voice route |
| Schedule/editor | `mobile-schedule-pages.js` | Schedule route |
| Teams/detail | `mobile-teams-pages.js` | Teams route |
| Tasks/detail | `mobile-tasks-pages.js` | Tasks route |
| native mobile settings | `mobile-settings.js` | Settings route |
| Hub/More | `mobile-hub-pages.js` | Hub or More route |
| proposal list/review | `mobile-proposals-pages.js` | Proposals route |
| Creative | `mobile-creative-pages.js` | Creative route |
| Subagents/detail/chat | `mobile-subagent-pages.js` | Subagents route |
| shared toast/time formatting | `mobile-feedback.js`, `mobile-format.js` | importing owner only |

Chat and inline Voice intentionally remain one owner in this PR. Inspection
found 38 lexical bindings across live-call state, handoff, and transcript
behavior; splitting those before the shared keyed runtime would duplicate or
silently fork state. Teams, Tasks, and Subagents also still consume some shared
agent-chat primitives exported by Chat, and Proposals consumes Hub presentation
primitives. Their route code is independently owned now, but those dependency
edges are explicitly deferred to the runtime/render ownership moves in PRs 4
and 5. The important forward invariant is hard-gated here: ordinary Chat has no
edge to any secondary route owner.

## Build, service worker, compatibility, and rollback

The public sync pipeline transforms and verifies both `index.html` and
`mobile.html`, including root-relative `/src/` to `/static/` references. The
gateway selects `mobile.html` for `/mobile/*`, pairing queries, and legacy PWA
queries, with `index.html` as a missing-file rollback fallback. Hash routing,
pairing/auth gates, namespaced gateway routes, deep links, history navigation,
and device sticky mode remain accepted.

The manifest now uses canonical `/mobile/...` launch and shortcut URLs. Service
worker version `pm-v304-2026-08-22-mobile-entry-routes` precaches one canonical
mobile document plus entry/shell assets. It no longer downloads Chat or any
secondary route owner during install. Requested chunks remain network-first and
become runtime-cache entries. Existing skip-waiting, controller-change reload,
page-show update, install prompt, notification, badge, and purge behavior is
preserved in the mobile PWA owner.

Rollback is a branch/deploy rollback: the gateway's `index.html` fallback keeps
mixed-version public trees bootable, while the SW version bump removes old
Prometheus caches on activation. No persistent data schema changes are made.

## Validation matrix

- `npm run test:mobile-route-chunks` — real Chromium document/module/API ledger.
- all `scripts/test-mobile-*.mjs` — mobile contracts and generated/source parity.
- route-owner migrations for P6, Sources, Voice Rooms, foreground Voice, team,
  subagent, composer-stack, drawer, and status-edge contracts.
- `npm run sync:web-ui` and `npm run check:web-ui` — dual document/public mirror.
- `npm run build:backend` and `npx tsc --noEmit` — gateway document selection.
- `node scripts/test-web-ui-architecture-guardrails.mjs` — canonical-byte
  cross-platform ratchet; `mobile-pages.js` drops from 2,012,055 to 1,738,241
  canonical bytes, and its code-owned ceiling drops with it.
- PR 1 performance gates remain required on the stacked result.

## Risks and deliberate deferrals

- Chat remains 636 KB gzip on the browser ledger. PR 3 supplies production
  hashing/minification and PRs 4/6 remove runtime and optional-feature weight.
- Total requested mobile CSS is 104.7 KB gzip, 4.7 KB above the initial target.
  PR 3 owns safe production minification; stylesheet decomposition remains
  behind runtime ownership so it cannot become line-count theater.
- Chat/Voice and agent-chat shared state are not cloned to manufacture smaller
  files. PR 4 moves that state to the keyed runtime first.
- Route intent prefetch is not added without navigation evidence. Zero unrelated
  calls is preferable to speculative network and wakeups.
