# 23 — Rich output, cards, and artifacts

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/rich-artifacts.ts`, `src/gateway/tools/defs/`, `web-ui/src/cards/`, `web-ui/src/utils.js`
> **Read this when:** Adding or debugging a native card, `show_ui_card`, inline visual, model-authored card fence, HTML visualization, or workspace image/video embed.

## TL;DR
- Rich output has several distinct paths: live structured cards, model-authored fenced cards, inline visual/artifact references, sandboxed HTML/chart/mermaid/SVG, and workspace image/video embeds.
- `show_ui_card` is for live/keyless, numeric, geographic, visual or comparative data. It returns a reference; the reply places it with `{{card:REF}}` on its own line.
- Quiz/flashcards/poll/writing/followups/reminder (also calculator and convert in the UI renderer) are authored as fenced native-card JSON, not `show_ui_card` data.
- `src/gateway/rich-artifacts.ts` defines/collects structured artifacts; frontend rendering and persistence/stream wiring must preserve artifact metadata across desktop and mobile.
- `web-ui/src/cards/` parses and renders native card fences; `web-ui/src/utils.js` inserts inline refs and wraps visual HTML in a sandboxed iframe.
- The Viz Kit is preloaded as `window.ui` / `window.PV` in supported HTML visuals. It provides cards/charts/components; keep the kit version cache-busted when changing it.
- The visual iframe sandbox is restricted (`allow-scripts allow-downloads`); don't enable same-origin, top-navigation, credentials, or arbitrary network access for generated HTML.
- Theme tokens must come from the host/mobile theme. Hardcoded white/light canvases break dark and branded skins.
- Images/videos from workspace paths render inline with controls/save affordances; video-project and game-project fences hydrate into richer project cards.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Artifact model/collector | `src/gateway/rich-artifacts.ts` → `RichArtifact`, `collectRichArtifacts()` | Structured typed payloads attached to messages. |
| Tool schema | `src/gateway/tools/defs/cis-system.ts` → `show_ui_card` | Live data card shapes and ref contract. |
| Chat message transport | `src/gateway/routes/chat.router.ts` and `src/gateway/session.ts` → message artifact fields | Stream, final and persisted message paths must agree. |
| Desktop renderer | `web-ui/src/pages/ChatPage.js` → message/artifact render dispatcher | Ingest SSE final/done and render by type. |
| Mobile renderer | `web-ui/src/mobile/mobile-pages.js`, `mobile-chat-message-renderer.js` | Normalize, merge and render persisted/live artifacts on phone. |
| Fence parser/index | `web-ui/src/cards/index.js`, `cards-data.js`, `cards-interactive.js` | Extract card fences, native HTML and controls. |
| Card runtime/state | `web-ui/src/cards/card-runtime.js` | Delegated events, interactive state and follow-up actions. |
| Card styling | `web-ui/src/cards/cards-styles.js`, `web-ui/src/styles/components.css`, mobile styles | Use theme variables; shared rendering needs mobile-aware tokens. |
| Markdown/rendering | `web-ui/src/utils.js` → `renderMarkdown()` | Card placeholders, safe HTML rendering and inline embeds. |
| Viz Kit | generated public vendor `vendor/prom-viz/prom-viz.js` | `window.ui`/`window.PV`; cache version constant lives in `utils.js`. |
| Sandboxed HTML | `web-ui/src/utils.js` → visual iframe builder | `sandbox="allow-scripts allow-downloads"`; preserve isolation. |
| Workspace media | `web-ui/src/utils.js` → inline media parsing/render | Image/video URLs and optional workspace save/share paths. |
| Generated inventories | [generated tools](generated/tools.md), [tests](generated/tests.md) | Don't copy the long live card/tool/test list here. |

## How it works

### Structured live data card path
The model calls `show_ui_card` with a card type and structured payload. The gateway fetches or assembles the supported card result and exposes an artifact reference. The assistant text inserts `{{card:REF}}` exactly where the card should render. Frontend extractors resolve only known artifact refs and replace them with hydrated markup; missing refs disappear instead of leaking raw placeholders. Treat this as the live card path, not arbitrary HTML returned from a tool.

`rich-artifacts.ts` provides typed artifacts and a collector over tool results. Chat finalization attaches artifact metadata to messages. The metadata must make it through stream events, persistence, session hydration, message merging, visual-content accounting and frontend dispatch. A renderer existing in one client is insufficient if its normalizer or history merge strips the field.

### Fenced native interactive cards
Assistant replies may contain fenced JSON for model-authored widgets. The parser recognizes the native card types (quiz, flashcards, poll, writing/draft, followups, reminder, calculator, convert) and dispatches to their card renderers. Stateful interactions are delegated by the card runtime: answer/flip/select/unit changes are local; reminder or follow-up actions may send text back to the chat composer. Preserve card state on rerender/reconnect instead of rebuilding at the initial empty state.

Do not route model-authored cards through the live data tool. The schema text for `show_ui_card` explicitly sends quiz/flashcards/poll/writing/followups/reminder as fences; calculator/convert also belong to the interactive fence UI. Validate JSON and escape model-controlled labels/content before creating HTML.

### HTML/chart/visual artifacts
`renderMarkdown()` extracts supported code fences such as HTML, chart, SVG and Mermaid into isolated visual blocks. HTML visuals can use the preloaded Viz Kit, which is versioned in `utils.js` to bust stale client caches when the library updates. Charts and tables should inherit host theme data/tokens. A generated document executes in a sandboxed iframe; keep its parent message/resize/theme bridge narrow and validate origins/commands if changing it. No iframe should get credentials, cookies, unrestricted network, browser permissions or Electron/Node access.

### Media and project embeds
Workspace media URLs in replies render as image figures or `<video controls playsinline>` with optional download/save behavior; adjacent media can form a gallery. Mobile uses the shared renderer but needs mobile-compatible controls and theme tokens. Special project fences (e.g. video/game project) are placeholders hydrated by the owning reusable component after Markdown rendering. Preserve workspace-path escaping and do not let a model-authored URL bypass media-serving permissions.

## Config & knobs
- Live card payload/type schema: `show_ui_card` definition in `src/gateway/tools/defs/cis-system.ts`; use [generated tools](generated/tools.md) for the complete current schema.
- Fenced card identifiers/renderers live in `web-ui/src/cards/`; card state may be retained in message/runtime state.
- Viz Kit version is explicitly set in `web-ui/src/utils.js` and inserted into the vendor script URL to avoid a stale 24-hour client cache.
- Sandbox flags are declared by the visual iframe builder; keep permissions least-privileged.
- Theme: use host/mobile tokens such as `--prom-bg`, `--prom-surface`, `--prom-text`, `--prom-accent`, and status tokens, or the current `--pm-*` mobile mapping. Never hardcode outer canvas/panel background.

## Gotchas / sharp edges
- **Unknown `{{card:REF}}`:** missing artifact refs should not leak as text. Verify live and restored messages.
- **Artifact dropped in one path:** update message types, stream `done`/`final`, persistence, history normalization/merge and both renderers together.
- **Double carousel:** legacy product carousel and a new `products` artifact can coexist; suppress duplicate rendering when the structured artifact already exists.
- **Card state resets:** keyed message rerenders can reset quiz/flashcard/poll progress unless the runtime owns or restores state.
- **Mobile theme mismatch:** an inline visual may inherit desktop tokens poorly; use the mobile skin mapping and test several skins, not only default dark.
- **Stale Viz Kit:** changing `prom-viz.js` without bumping its constant can leave users executing an older library and crash new `ui.*` APIs.
- **Sandbox widening:** `allow-scripts` is not a reason to add `allow-same-origin`, top navigation or broader capabilities. Keep generated visuals local and isolated.
- **HTML injection:** validate card data and escape into DOM; do not concatenate untrusted HTML into the application page.
- **Workspace media path:** preserve gateway-served paths/authorization and encode attributes. Do not promote arbitrary local filesystem paths into a browser URL.

## How to change it safely
1. Decide which output lane is intended (live typed artifact, native fence, visual fence, or media) and edit that owner, not a parallel ad-hoc card.
2. When adding a structured type, define/validate its gateway shape, persist and stream it, then implement desktop and mobile dispatch/render.
3. Add focused extraction/render/persistence tests and inspect [generated tests](generated/tests.md) for artifact/card/Viz Kit contracts.
4. Run the card runtime and visual-sandbox tests; test malformed JSON, unknown refs, rerender/history, restored mobile message and narrow viewport.
5. Change Viz Kit only with a cache-version bump and contract update; test a current visual and a theme switch.
6. Check escaping, iframe flags, download/save handlers and external-origin policy before claiming security compatibility.

## Related
- [17 Desktop web UI](17-desktop-web-ui.md) · [18 Mobile app](18-mobile-app.md)
- [21 Security, approvals, permissions](21-security-approvals-permissions.md) · [24 Release, packaging, update](24-release-packaging-update.md)
- [generated tools](generated/tools.md) · [generated routes](generated/routes.md) · [generated tests](generated/tests.md)
- Historical guide hint: source-checkout `workspace/self/20-rich-artifacts.md`; verify current union/render paths before use.


## Output-lane selection

| Need | Preferred lane | Why |
|---|---|---|
| Live weather, time, news, sports, prices, places or map | `show_ui_card` typed live card | Gateway fetches/current data and stable UI presentation. |
| Product search/comparison | Product or comparison card | Structured items/links and predictable layout beat a prose list. |
| A quiz, flashcard deck, poll or writing draft | Fenced native card | Model-authored content plus local interactive state. |
| A reminder offer or short follow-up choices | Fenced reminder/followups | Action controls can return a concise response to chat. |
| A user-facing quick conversion/calculation | Fenced convert/calculator | Inputs can be adjusted in place without external data lookup. |
| Bespoke chart, diagram or contained simulator | HTML/visual fence using Viz Kit | Rich composition, local interaction and sandbox isolation. |
| Existing workspace image/video deliverable | Inline workspace media | Native viewer controls and save/share path. |
| Editable video/game project state | Dedicated project fence/card | Owner component hydrates project-specific actions. |

This is a routing aid, not a claim that every possible card subtype is enabled in every client. Check the current `show_ui_card` schema, `RichArtifact` union, fence renderer, and mobile dispatcher before adding a new type.

## Viz Kit and HTML contract
- The host supplies Viz Kit in the visual document; generated code should use `window.ui` components rather than reimplementing standard charts/tables as raw markup.
- A meaningful visual should start with the finding/insight, then context/KPIs, then related views—not a decorative chart without data.
- Use inherited Prometheus theme tokens; the visual root remains transparent unless an intentional internal surface is needed.
- Local interaction state stays inside the visual; do not ask the iframe to read Prometheus credentials or browser storage.
- User actions that require an external tool must route through a registered Prometheus action bridge, not arbitrary fetch/iframe navigation.
- Export controls should use allowed local download paths; they must not send data to an unapproved endpoint.
- Form/tap-to-ask interactions should emit a clear, compact message through the registered bridge; test it reaches the correct chat.
- Use responsive sizing and support narrow widths. Let the iframe host resize within the configured bounds.
- If the Viz Kit version changes, update `PROM_VIZ_VERSION`, corresponding version contract test and cache URL.
- Test with a fresh iframe and after history restoration; old content may retain a cached library URL.

## Accessibility and card lifecycle
- Native controls must have labels and visible focus/selected states.
- A quiz answer should not be lost when a message list re-renders or the user scrolls away and back.
- Flashcard flip actions need both pointer and keyboard activation.
- Poll state must distinguish a selected local choice from a submitted follow-up.
- Writing drafts should remain copyable text and not auto-post/send.
- Reminder actions should express what will be scheduled before submitting; gateway authorization still applies.
- Convert/calculator invalid input should show a bounded error without destroying the user's input.
- Media requires useful alt text/captions where supplied, native video controls and a fallback for unsupported formats.
- A missing remote image/video should show an understandable failure rather than an empty, clickable block.


## Regression matrix

### Typed artifacts
- Tool returns one valid artifact and final message contains its ref.
- Tool returns multiple artifacts of distinct and repeated types.
- Unknown/malformed artifact type is rejected or ignored safely.
- Streamed response carries artifact metadata on the terminal event.
- A persisted history load restores artifacts without rerunning the data fetch.
- A mobile message normalization/merge retains artifacts when tool trace arrives separately.
- Product carousel migration does not render the same products twice.
- Empty artifact arrays do not alter text-only message rendering.

### Native card fences
- Correct JSON for every supported card type.
- Missing required fields, invalid option indexes and malformed JSON.
- HTML-sensitive labels and text are escaped.
- Local state survives scroll, streamed updates and keyed message rerender.
- Follow-up action uses the correct session/composer.
- Draft/copy affordance does not accidentally publish or send.
- Unknown card fence remains safe and does not execute as code.

### Visual and media outputs
- HTML visual loads correct Viz Kit version after cache bust.
- `window.ui` forms/charts render in desktop and mobile theme.
- Iframe cannot access parent DOM, credentials or top navigation.
- Parent sizing/theme event does not accept untrusted message origins.
- Failed media URL yields a fallback state and does not leak an arbitrary local path.
- Video controls and save/share affordance work on a touch browser.
- Narrow width and long labels do not overflow the visual container.

When source changes are mirrored, run `npm run sync:web-ui` in a clean owned workspace and the focused card/visual tests listed in generated test inventory.


## Security boundary checklist

- No model-controlled URL may navigate the top-level Prometheus window without explicit user action.
- No generated visual receives bearer tokens, provider secrets, device tokens or account session objects.
- Do not expose `window.api` inside a generated iframe; iframe content must not gain a gateway credential bridge.
- Keep `postMessage` listeners scoped to the specific iframe and validate `event.source` plus expected message shape.
- Escape attributes and text in native card output; sanitize Markdown separately from card JSON parsing.
- Treat remote image/video embeds as untrusted content; restrict rendering to supported media URL forms.
- Download/save handlers must use a registered/local gateway action and must not accept arbitrary filesystem paths from the model.
- Follow-up buttons should submit plain intent text, then let ordinary tools/approval policy decide the next action.
- A visually rendered approval card is not itself authorization; the backend remains the enforcement authority.
- Report and test unsafe payload rejection rather than hiding it behind a blank card.


## Authoring guidance for model output

- Choose cards only when interaction or structured live data makes the result materially easier to use.
- Keep surrounding prose concise: explain the key result and let the card carry structured details.
- For `{{card:REF}}`, place the reference on its own line at the intended insertion point.
- For a fenced card, emit one valid JSON object in the named fence, with no trailing commentary inside the JSON.
- Keep poll/quiz option counts small enough to tap comfortably on a phone.
- Include a short hint/explanation only when it helps the learner act or understand a correction.
- Follow-up controls should be a few meaningful choices, not a giant branching form.
- A `writing` card is a copyable draft, not an external publishing action.
- A `reminder` card should distinguish a suggested reminder from a reminder actually set.
- Use calculator/convert for deterministic local numeric interactions; do not invent live exchange/price data in a static card.
- Use live data cards for claims that depend on current external sources and let the gateway fetch those values.
- Provide a text summary alongside visuals when essential meaning would otherwise be inaccessible.
