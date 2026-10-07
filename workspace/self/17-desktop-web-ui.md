# 17 — Desktop Web UI

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `web-ui/src/`, `web-ui/`, `src/gateway/`, `scripts/`
> **Read this when:** Changing desktop pages, shared browser UI, styles/themes, chat tool activity, or the generated public-web bundle. This is desktop-focused; see [18 Mobile app](18-mobile-app.md).

## TL;DR
- `web-ui/` is the editable UI source; the gateway serves `generated/public-web-ui/`. Never edit generated copies to implement a feature.
- Desktop entry is `web-ui/index.html` + `web-ui/src/desktop-entry.js` and `app.js`; feature pages live in `web-ui/src/pages/`.
- The large app is organized as ES modules with lazy page/feature chunks and compatibility bridges. Follow the established owner module; don't add another global/bootstrap layer.
- Page routing/sidebar is orchestrated by `setMode()` in `web-ui/src/app.js`; per-page modules own their own rendering and API interaction.
- Prometheus One (P1) black + gold is the brand/default, not the old orange/ember styling. A skin named `light` historically maps to P1; it is not a light canvas. See `web-ui/src/styles/themes.css` and `WEB_UI_THEMES.md` in the source checkout.
- Chat tool activity has its own detailed renderer/state in `web-ui/src/tool-activity.js`; preserve live vs historical data and disclosure state.
- After source edits run `npm run sync:web-ui`, then `npm run check:web-ui`; sync generates public files and verifies parity.
- The source checkout may contain unrelated edits in `generated/public-web-ui/`. Inspect status first; don't clean or overwrite another operator's working tree.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Document and desktop entry | `web-ui/index.html` → document shell; `web-ui/src/desktop-entry.js` → entry imports | Shared frame, sidebar/page roots, modal roots, stylesheet and module order. |
| App shell, navigation, appearance | `web-ui/src/app.js` → `setMode()`, theme helpers, shell handlers | Sidebar navigation, routing, theme persistence, shell-level controls. |
| Shared state/API/events | `web-ui/src/state.js`; `web-ui/src/api.js` → `api()`; `web-ui/src/ws.js` → event bus | REST and websocket conventions are shared with the mobile app. |
| Chat workspace | `web-ui/src/pages/ChatPage.js` | Session list, stream/render, composer, approvals, voice, canvas, generated media. |
| Tasks | `web-ui/src/pages/TasksPage.js` | Task board, detail/chat, approvals, coding panels. |
| Teams | `web-ui/src/pages/TeamsPage.js` | Team rooms, manager/runs, files, context, memory and websocket updates. |
| Schedule | `web-ui/src/pages/SchedulePage.js` | Jobs, run/enable/edit, Brain schedule cards. |
| Subagents | `web-ui/src/pages/SubagentsPage.js` | Standalone agent detail/home/runs/recovery, memory and configuration. |
| Proposals | `web-ui/src/pages/ProposalsPage.js` | Review/approval management. |
| Hub | `web-ui/src/pages/HubPage.js` | Hub and tool/skill activity surfaces. |
| Audit and memory | `web-ui/src/pages/AuditPage.js`, `MemoryPage.js` | Separate activity/audit vs memory browsing. |
| Settings/config | `web-ui/src/pages/SettingsPage.js`; `web-ui/src/auth/account.js` | Settings modal panels and account UI; backend policy is separate. |
| Projects | `web-ui/src/pages/ProjectsPage.js` | Project dashboard; generated card components also live under `components/`. |
| Tool activity | `web-ui/src/tool-activity.js` → `renderToolActivityEntry()`, `toolActivitySummary()` | Readable detail, status, diffs, provider/tool icons and expansion persistence. |
| Cards and response rendering | `web-ui/src/cards/`, `web-ui/src/utils.js` → `renderMarkdown()` | Rich outputs and visual sandboxing; see [23 Rich output](23-rich-output-cards-artifacts.md). |
| Feature-owned modules | `web-ui/src/features/{chat,connectors,usage}/` | Move changes with the owning feature; avoid growing monolithic page modules. |
| Styles and themes | `web-ui/src/styles/`, especially `themes.css`, `base.css`, `pages.css` | Desktop entry CSS imports shared tokens and page styling. |
| Public output | `generated/public-web-ui/` | Build product, not source. `scripts/check-public-web-ui-sync.js` enforces sync. |

## How it works

### Bootstrap and page ownership
`web-ui/index.html` defines the entry DOM and loads the desktop module. Bootstrap code in `app.js` establishes shared app state, appearance, shell/sidebar behavior, event handlers, and mode routing. Page modules expose functions consumed by the app/bootstrap rather than owning an independent router. Read the active page module and its page stylesheet before moving code: template IDs, shell state, and dynamic imports are often part of the contract.

The major page responsibilities are in the Map. In particular, chat includes cross-cutting runtime surfaces (streaming, approvals, voice, and artifacts); tasks and teams have their own task/team lifecycle APIs and websocket event handling. Keep long-lived task/team state in the matching page or shared runtime instead of duplicating it in Chat.

Shared browser modules cover API calls, websocket subscription, state, formatting/markdown, keyboard shortcuts, command palette and performance. `web-ui/src/components/` holds reusable visual components, while `features/` holds feature-owned groups. Check for an existing owner before adding a module.

### Chat and tool activity
`ChatPage.js` receives gateway stream events, reconciles the active session, and renders messages plus process/tool activity. `tool-activity.js` converts activity records into a compact summary and expandable detail. It supports stateful disclosure, per-tool icons/status, readable tool details, and file-diff presentation. Do not collapse distinct running/completed/error/approval states into one generic spinner, or discard activity when switching between an active chat and persisted history. Recent desktop fixes make stream traces survive returning to a running chat and focus changes; consult the generated changelog before changing reconnect logic.

### Visual language and themes
`themes.css` defines the built-in skins, theme identity and CSS variables. P1 black + gold is the default brand; its legacy ID is `light`. Presets share the dark P1 shell and can adjust colors within that system. Brand surfaces that intentionally ignore theme selection must still follow current brand guidance; do not revive orange/ember by copying old screenshots or CSS. Prefer theme tokens over hardcoded surfaces/colors. Mobile adapts shared theme selections with mobile-specific tokens; see [18](18-mobile-app.md).

### Build and public mirror
There are two important build products:

1. Source authoring lives under `web-ui/`.
2. `scripts/prepare-public-build.js --web-only` prepares the generated public mirror under `generated/public-web-ui/` (including static assets and entries). `check-public-web-ui-sync.js` checks source and generated copies; `check-web-ui-module-globals.mjs` checks module/global contracts.

`npm run sync:web-ui` first builds the thinking orb, prepares the public web output, then runs `npm run check:web-ui`. `npm run build:web` is validation (`check:web-ui`); it is not the source-edit sync step. `npm run build:web-production` generates the hashed production module/chunk output. For full public desktop packaging, see [24 Release, packaging, update](24-release-packaging-update.md).


### Plugins page
`plugins` → `#plugins-view` opens from **More → Plugins**. `#plugins-view` owns the lightweight catalog shell and search. `web-ui/src/pages/ConnectionsPage.js` is lazy-loaded on first entry, fetches `GET /api/extensions/catalog?kind=connector` plus connection attempts and configured MCP state, and owns the `#connector-view` detail overlay. Managed detail views use the canonical connection-v2 `registeredTools` / `availableTools` / `exposedTools` surface, which is the canonical tool allowlist. See [12](12-connectors-mcp-integrations.md) for the connector contract. `scripts/test-plugins-page-contract.mjs` asserts these phrases.

## Config & knobs
- UI preference persistence is primarily browser storage in `web-ui/src/app.js` and `state.js`; inspect the relevant key rather than assuming server-backed config.
- The active theme is expressed using theme/skin attributes and CSS variables. See `web-ui/src/styles/themes.css` and the live theme helpers in `app.js` for current identifiers and defaults.
- Gateway origin/API auth details are centralized in `web-ui/src/api.js` and `ws.js`; don't bypass wrappers for a page-specific request.
- Build commands: `npm run sync:web-ui`, `npm run check:web-ui`, `npm run build:web-production`, `npm run test:web-ui-architecture`.

## Gotchas / sharp edges
- **Source vs generated:** editing only `generated/public-web-ui/` is lost on the next sync. Edit `web-ui/`, then sync.
- **Dirty generated output:** the live `PromSRC` checkout has unrelated dirty generated UI files. Do not reset, clean, or sync without checking ownership; this documentation task deliberately does not build or change it.
- **“light” means P1:** old IDs and docs are misleading. Validate the rendered tokens and theme implementation before changing a named skin.
- **Shared page runtime:** globals and page exports are compatibility seams. Check the desktop bootstrap and module-global guard before renaming/removing symbols.
- **Tool trace replay:** activity details may arrive incrementally, then be persisted/replayed. Preserve dedupe, status, timestamps, expansion, and final state.
- **Window writes / Windows sharing:** if a legitimate sync reports `EBUSY`, identify and stop the process holding generated output, then retry; do not delete files blindly.
- **Browser-only QA is not enough:** inspect both source parity/checks and real rendered UI when changing layout, keyboard flow, dynamic import, or responsive behavior. For local UI workflow, see [25 Sharp edges](25-sharp-edges.md) and `scripts/test-web-ui-architecture-guardrails.mjs`.

## How to change it safely
1. Read the owning page/feature, shared callers, and stylesheet; search all callers before changing exported/global names.
2. Keep page-specific state and rendering with its owner. Keep shared cross-page APIs in the existing shared modules.
3. Run focused contract tests from `package.json` and the test index in [generated tests](generated/tests.md); for structural UI changes run `npm run test:web-ui-architecture`.
4. In an owned clean build workspace, run `npm run sync:web-ui` and confirm `npm run check:web-ui` passes. Do not build over unknown generated changes.
5. Launch the local UI against a development gateway/browser session and verify page navigation, theme, stream/tool activity, keyboard/scroll behavior, and browser console/network failures that match the change. Test a narrow viewport when shared shell/responsive code is touched.
6. For complex frontend changes read the current local UI verification procedure in the source checkout's `workspace/self/17-local-ui-verification.md`; it is guidance, not source of truth.

## Related
- [18 Mobile app](18-mobile-app.md)
- [19 Onboarding, accounts, auth](19-onboarding-accounts-auth.md)
- [21 Security, approvals, permissions](21-security-approvals-permissions.md)
- [23 Rich output, cards, artifacts](23-rich-output-cards-artifacts.md)
- [24 Release, packaging, update](24-release-packaging-update.md)
- [tools inventory](generated/tools.md) · [routes inventory](generated/routes.md) · [tests inventory](generated/tests.md)
- Source-checkout architecture hints: `workspace/self/WEB_UI_ARCHITECTURE.md`, `WEB_UI_THEMES.md`, `17-local-ui-verification.md` (verify these against source before relying on them).


## Operational boundaries

### Keep data ownership clear
Page modules own page-specific fetching/render state, while the shared `api.js` and `ws.js` wrappers own transport conventions. When a page needs to refresh because of a websocket event, use the page's event subscription and cleanup lifecycle rather than installing another document-global listener on every render. If an API response is consumed in desktop and mobile, keep shared normalization in the shared transport or common model layer; do not make a desktop DOM object the source of truth.

Preferences stored in browser storage are per origin/profile. This matters for local/dev/public hosts: the same account can have different collapsed sidebar, appearance and navigation preferences on each origin. Do not “fix” an apparent missing preference by copying local-storage values across profiles.

### Page change review checklist
- Find the page entry point, its exported functions and app-shell callers.
- Find the page's matching stylesheet under `web-ui/src/styles/` and check load order/import ownership.
- Find REST endpoints in the module and matching gateway routes; use generated route inventory for route names.
- Find websocket event names and check whether reconnect/history hydration uses the same state shape.
- Check for similar mobile feature behavior before changing any cross-client API contract.
- Check keyboard shortcuts, command palette and sidebar links if adding or renaming a top-level page.
- Verify the default P1 skin and at least one alternate skin; inspect focus/disabled/error states.
- If a page exports functions through `window`, search all imports/callers and module-global checks before renaming.

### Local UI verification sequence
1. Confirm the code under test is `web-ui/`, not an old public output copy.
2. Inspect `git status --short` before any command that writes generated files.
3. For source-only static checks run `npm run check:web-ui` and `npm run test:web-ui-architecture`.
4. For generated output in an owned clean tree run `npm run sync:web-ui`; this builds thinking-orb and invokes the public preparation/sync check.
5. Start the local gateway/UI using the project's development procedure; do not assume the browser is serving `web-ui/` directly (the normal runtime uses generated public output).
6. Verify initial load, console errors, failed script/chunk requests, and the page's direct/deep-link navigation.
7. Exercise the changed interaction with mouse and keyboard, and capture one screenshot or equivalent evidence for layout changes.
8. Test narrow width and a high zoom factor when layout/overflow is in scope.
9. Return to a second active chat/page if state retention or websocket subscriptions changed.
10. Recheck generated/source parity and git status; report if any build output remains untracked or modified.

### Triage guide
| Symptom | First checks | Likely owner |
|---|---|---|
| Blank page after a deploy/build | Entry chunk path, generated manifest, console import error | `desktop-entry.js`, production build script, generated web tree |
| Source appears correct but UI unchanged | Was `sync:web-ui` run? Which static root does gateway serve? | `scripts/prepare-public-build.js`, public output |
| Old theme color persists | Skin/theme attribute, storage key, CSS cascade order, cache | `app.js`, `themes.css`, browser storage |
| Page works until navigation | Duplicate event handlers, stale page lifecycle, unremoved subscriptions | Page module and app `setMode()` caller |
| Tool row duplicates after focus return | Stream catch-up ID/dedupe and persisted history merge | `ChatPage.js`, websocket/session runtime |
| Long detail is hard to inspect | Summary/detail split, disclosure persistence and overflow | `tool-activity.js` and component styles |
| Test fails only on module globals | Static global/export contract and script load order | `check-web-ui-module-globals.mjs`, entry HTML |

Use this checklist as a starting point, not a substitute for the current source/test definitions. A local UI build can write to `generated/public-web-ui/`; never run it over another operator's dirty generated tree.


## Page-level orientation

### Chat
- Session timeline, server hydration and streaming are owned by `ChatPage.js`.
- Before changing send/stop behavior, trace compose → request → SSE events → message/session update.
- Before changing thread switching, verify active stream catch-up and persisted history reconciliation.
- Approvals and questions can suspend a turn; keep their visual state separate from ordinary tool progress.
- Canvas/browser/creative right-panel state is not the same as the main chat timeline.
- Workspace media and project-card hydration are covered in [23](23-rich-output-cards-artifacts.md).

### Tasks and teams
- `TasksPage.js` and `TeamsPage.js` are long-lived workflow surfaces, not passive lists.
- Task state transitions can include queued/planning/executing/verifying/completed/failed/needs-approval.
- Preserve status, evidence, task chat and approval affordances during list refreshes.
- Teams have manager, member, run, context and shared-workspace state; a team event may arrive independently of a page refresh.
- When changing event payloads, inspect the backend emitter and frontend consumer together.
- Use the source-changelog entries for the specific team/scheduler PR if updating behavior after a recent refactor.

### Schedule and subagents
- Schedule UI has create/edit/run-now/enable/delete paths; destructive controls should remain explicit.
- Subagent Home chat and Runs/recovery views differ from the main desktop chat and may use shared composer styles.
- Agent identity, model and memory indicators should not be inferred from the current main-chat state.
- A subagent that is paused for manager input has different recovery semantics from a completed or failed run.
- If a panel hosts a shared composer, keep its CSS scoped so it does not leak into the main thread.

### Audit, memory, hub, proposals and projects
- Audit is an event/history surface; Memory is an inspect/edit/search surface. Avoid conflating their APIs.
- Hub may aggregate tool/skill activity, but it does not own the runtime's canonical skill catalog.
- Proposals are pending proposed changes/actions; keep proposal state distinct from completed task evidence.
- Projects and project cards can include generated media and workspace files. Respect asset routing/authorization.
- Check each page's empty, loading, error and stale states; these are materially different from a zero-result success.

## Stylesheet and asset ownership
- `desktop-entry.css` establishes the import root; inspect the cascade before adding another global rule.
- `base.css` and `components.css` provide shared primitives; `styles/pages/` owns page-specific layout.
- `themes.css` is the source of theme/skin tokens; use semantic tokens rather than copying hex colors into a page.
- A page can be mounted in an overlay, drawer or narrow panel even if its default desktop route is wide.
- Avoid broad selectors for page controls; scope selectors under the page/modal root.
- Prefer existing `components/` before writing a new parallel markup pattern.
- Local fonts and vendor payloads are part of the public build; the sync checker checks expected assets.
- Image or font changes can affect public image/font budgets; consult generated tests and package scripts.

## Performance and lazy loading
- The production build emits hashed chunks; runtime references are generated, not hand-maintained.
- Dynamic imports should remain behind the interaction/page that needs them.
- Avoid importing a large creative/editor dependency in the desktop shell if it can load on demand.
- Keep live chat updates incremental; avoid rebuilding unrelated page trees per token/event.
- Use keyed lists where identity matters so message/tool activity doesn't lose local expansion state.
- Check both active and unfocused client behavior; websocket fanout may throttle background sessions.
- Don't add sync disk reads, huge DOM serialization, or repeated page-wide scans to event callbacks.
- Use existing performance telemetry and test budgets for structural/performance changes.
