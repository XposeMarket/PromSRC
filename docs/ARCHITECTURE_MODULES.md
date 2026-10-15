# Architecture modules — Wave 5b

Behavior-preserving mechanical split from origin/main. Existing import sites retain their facades and exact public export names. Canvas is unchanged.

## Before/after source inventory

Counts use non-empty lines, matching PowerShell `Get-Content | Measure-Object -Line`; the initial audit thresholds refer to this measure (physical-line counts differ). Files originally over 3,000 lines:

| Source | Before | After |
| --- | ---: | ---: |
| `src/gateway/browser-tools.ts` | 11331 | 4466 |
| `src/gateway/routes/canvas.router.ts` | 8087 | 8087 |
| `src/gateway/desktop-tools.ts` | 7790 | 14 |
| `src/gateway/comms/telegram-channel.ts` | 6885 | 6885 |
| `src/gateway/routes/chat/pipeline/handle-chat.ts` | 6048 | 6048 |
| `src/gateway/session.ts` | 4065 | 4065 |
| `src/gateway/agents-runtime/subagent-executor.ts` | 3511 | 3511 |
| `src/gateway/tools/defs/creative-tools.ts` | 3500 | 3500 |
| `src/gateway/terminal-ui.ts` | 3407 | 3407 |
| `src/gateway/creative/generative-pipeline.ts` | 3400 | 3400 |
| `src/gateway/agents-runtime/handlers/default-tools.ts` | 3289 | 3289 |
| `src/tools/web.ts` | 3274 | 3274 |
| `src/gateway/agents-runtime/handlers/creative.ts` | 3222 | 3222 |
| `src/gateway/tasks/background-task-runner.ts` | 3220 | 3220 |
| `src/gateway/teams/managed-teams.ts` | 3049 | 3049 |

## New module map

| Module | Lines | Responsibility |
| --- | ---: | --- |
| `src/gateway/browser/chrome.ts` | 272 | Playwright loading, Chromium discovery and CDP process recovery. |
| `src/gateway/browser/definitions.ts` | 852 | Original browser tool schemas and metadata. |
| `src/gateway/browser/diagnostics.ts` | 389 | JavaScript envelopes, console/network inspection and smoke-step helpers. |
| `src/gateway/browser/downloads.ts` | 85 | Workspace-safe output paths and download persistence. |
| `src/gateway/browser/extraction.ts` | 526 | Structured page extraction, selector packs and advisor packet hashing. |
| `src/gateway/browser/history.ts` | 32 | Browser visit resource-history recording. |
| `src/gateway/browser/inhouse-actions.ts` | 454 | Electron actions, key validation and login/cookie handoff. |
| `src/gateway/browser/inhouse-sessions.ts` | 230 | Electron session synchronization, target/profile routing and status payloads. |
| `src/gateway/browser/inhouse.ts` | 108 | Electron browser RPC transport and availability helpers. |
| `src/gateway/browser/observation.ts` | 372 | Observation modes, compact acknowledgements and snapshot metadata. |
| `src/gateway/browser/preview.ts` | 117 | Screenshot-preview and chunk formatting. |
| `src/gateway/browser/profiles.ts` | 466 | Persistent Chrome identity, profile directories and session attachment. |
| `src/gateway/browser/relay-observers.ts` | 48 | User Chrome relay event observation. |
| `src/gateway/browser/selection-bounds.ts` | 40 | Live selected-element viewport bounds. |
| `src/gateway/browser/selection.ts` | 250 | Selection tracker actions, interactable map and ephemeral cleanup. |
| `src/gateway/browser/sessions.ts` | 273 | Session owner metadata, console collection and origin labels. |
| `src/gateway/browser/snapshot-format.ts` | 49 | Bounded snapshots, workspace root and tab labels. |
| `src/gateway/browser/snapshot.ts` | 689 | DOM snapshots and stable-ref locator actions. |
| `src/gateway/browser/state.ts` | 109 | Singleton browser maps, screenshot/download caches and interceptor logs. |
| `src/gateway/browser/stream-control.ts` | 314 | Live-stream start orchestration and browser doctor. |
| `src/gateway/browser/streaming.ts` | 948 | Stream frames, geometry, control ownership, teaching state and persistent registry. |
| `src/gateway/browser/tabs.ts` | 257 | Profile target switching and browser tab list/select/open/close. |
| `src/gateway/browser/target.ts` | 23 | Default browser target selection. |
| `src/gateway/browser/types.ts` | 297 | Shared browser types and small performance/error helpers. |
| `src/gateway/browser/watch.ts` | 168 | Element watch and snapshot delta operations. |
| `src/gateway/desktop/accessibility.ts` | 720 | Accessibility trees/actions, macros listing and pixel watch. |
| `src/gateway/desktop/apps.ts` | 1103 | App launch/discovery, screenshot history, diffs and window captures. |
| `src/gateway/desktop/interaction-actions.ts` | 2008 | Screen input, coordinate validation, verification, clipboard and recording. |
| `src/gateway/desktop/interaction-context.ts` | 1443 | Monitor enumeration, captures, focus/context gathering and OCR. |
| `src/gateway/desktop/state.ts` | 762 | Desktop singleton state, common types, platform imports and shared helpers. |
| `src/gateway/desktop/window-actions.ts` | 1191 | Window keyboard/scroll/drag dispatch and desktop tool definitions. |
| `src/gateway/desktop/window-core.ts` | 384 | Window identities, canonical selectors, failures and capture backend. |
| `src/gateway/desktop/window-mid.ts` | 666 | Canonical app/window listing, focus and click dispatch. |

## State and compatibility

Browser session/screenshot/network/selection/stream/geometry maps are owned by `browser/state.ts`; the Playwright loader is owned by `browser/chrome.ts`, and the assignable lazy registry cache stays with its writer in `browser/streaming.ts`. Desktop shared maps are owned by `desktop/state.ts`; assignable recording bindings and the context cache remain with their writers in `interaction-actions.ts` and `interaction-context.ts`, re-exported from state. This preserves the original function bodies rather than introducing setters. Each original mutable binding has exactly one owner. Browser sibling runtime dependencies are acyclic (type-only edges excluded); desktop retains cross-feature orchestration dependencies, verified through import and regression checks. No call-site imports change and no helper exports leak through either facade.

## Verification

Exact runtime export-name parity, TypeScript no-emit compilation, gateway bundle build and final-action-gate/auth-proxy/operation-ledger plus all browser-tools/desktop-tools importing regression fixtures are checked in the isolated worktree. Desktop background fixture live-device checks are opt-in and skipped; no live gateway restart or canvas split is performed.
