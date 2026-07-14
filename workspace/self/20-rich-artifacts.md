# 36) Rich Chat Artifacts (cards), Data Tools, and Voice Integration

Last verified against `src/gateway/rich-artifacts.ts`, `src/tools/{web,market,stocks,weather,polymarket,mapcard}.ts`, `src/gateway/tools/defs/cis-system.ts`, `src/gateway/agents-runtime/subagent-executor.ts`, `src/gateway/routes/chat.router.ts`, `src/gateway/scheduling/schedule-admin-tools.ts`, `src/runtime/build-status.ts`, `web-ui/src/pages/ChatPage.js`, `web-ui/src/mobile/mobile-pages.js`, and `web-ui/src/styles/{components,mobile}.css` on: 2026-07-10

This section covers the **Rich Chat Artifacts** lane: a parallel, additive layer that renders structured result *cards* in the main chat (desktop + mobile + realtime voice). It is intentionally separate from approvals, file changes, Canvas/workspace, and generated media — those keep their own render paths. Do not entangle them.

## Architecture: the `richArtifacts[]` lane

Single source of truth: **`src/gateway/rich-artifacts.ts`** defines the `RichArtifact` discriminated union, the `collectRichArtifacts(toolResults)` collector, and `productCarouselToArtifact()`. Every card type flows through one message field — `message.richArtifacts?: RichArtifact[]` — threaded once, then fanned out by `type` in two render dispatchers.

Type declarations carry `richArtifacts?`:
- `src/gateway/session.ts` `ChatMessage`
- `src/gateway/chat/chat-helpers.ts` `HandleChatResult`

Backend threading (mirror of the legacy `productCarousel` field — grep `richArtifacts` in `chat.router.ts`): the turn-finalize collector (`collectRichArtifacts` + folding the legacy `productCarousel` into a `products` artifact), `completeLocalMainChatStream`, the persisted `addMessage` payload, token accounting, and both the `done` and `final` SSE emits.

Desktop ingest/render (`web-ui/src/pages/ChatPage.js`):
- SSE `done`/`final` capture → `finalRichArtifacts` → `appendAssistantTurnForUser` → `message.richArtifacts`.
- `mergeChatMessageMetadata` + the visual-content count both branch on `richArtifacts`.
- Dispatcher `renderRichArtifacts(msg)` (switch on `type`) is wired into the message template alongside `renderProductCarousel(msg)`; the legacy carousel is suppressed when a `products` artifact is present (avoids double-render).

Mobile ingest/render (`web-ui/src/mobile/mobile-pages.js`):
- The message **normalize** (server → mobile) and **merge** functions both carry `richArtifacts`, and all SSE handlers copy `evt.richArtifacts` onto the turn. **This wiring is required** — without it the mobile renderers exist but never receive data (the original mobile-blank bug).
- Dispatcher `_renderMobileRichArtifacts(message)` (switch on `type`) is wired into `_renderChatMessageHtml`, legacy carousel suppressed the same way.

CSS: desktop in `web-ui/src/styles/components.css`, mobile in `web-ui/src/styles/mobile.css`. After any web-ui edit, run `npm run sync:web-ui` so `generated/public-web-ui/` matches and `check-public-web-ui-sync` passes.

## Artifact types, tools, and data sources

All tools are defined in `cis-system.ts` and executed in `subagent-executor.ts` (worker path) and `chat.router.ts` (voice path). All data sources are **keyless / no-signup**.

| Type | Tool | Data source (keyless) | Module |
|---|---|---|---|
| `products` | `show_product_carousel` | model-curated / `shopping_search_products` | (legacy carousel, migrated) |
| `agent_work` | `show_agent_work` | model-assembled from `automation_dashboard` | (interactive — see below) |
| `sources` | `show_sources` | model-curated from `web_search`/browser | inline |
| `stocks` (crypto) | `show_market` | **CoinGecko** `/coins/markets` + `/search` | `src/tools/market.ts` |
| `stocks` (equities) | `show_stocks` | **Yahoo Finance** chart API, **Stooq** CSV fallback | `src/tools/stocks.ts` |
| `weather` | `show_weather` | **Open-Meteo** geocoding + forecast (WMO codes) | `src/tools/weather.ts` |
| `comparison` | `show_comparison` | model-assembled table | inline |
| `chart` | `show_chart` | model-assembled series (SVG) | inline |
| `run_result` | `show_run_result` | model-assembled finished-task card | inline |
| `map` | `show_map` | **OpenStreetMap** embed iframe + **Nominatim** geocoding | `src/tools/mapcard.ts` |
| `prediction_market` | `show_prediction_market` | **Polymarket** Gamma API (read-only) | `src/tools/polymarket.ts` |

Notes:
- `products` and `sources` are URL-backed enrichment cards. `rich-artifacts.ts` first normalizes common provider/browser/connector aliases (`link`/`href`, snake_case fields, `thumbnail`, `images`, `review_count`, etc.). `src/tools/web.ts` then fills missing title, publisher, description, date, price, rating, reviews, and image metadata from the destination page. The same enrichment runs in worker and realtime-voice execution.
- Preview extraction is order-independent for HTML meta attributes and checks JSON-LD, Open Graph, Twitter cards, `image_src`, lazy images, `srcset`, and merchant-specific large-image attributes such as Amazon's `data-a-dynamic-image`. Candidate images are scored to reject logos, pixels, sprites, and tiny placeholders.
- Discovered product/source images are downloaded best-effort under `downloads/product-carousel/` or `downloads/source-previews/`. Cards prefer the cached workspace asset, avoiding expired/hotlink-protected remote images. Source cards fall back to the site's icon only when no page hero/thumbnail exists. A failed image fetch never discards the source/product data.
- Search providers preserve thumbnail/publisher/date fields when offered. `web_search({fetch_top_k})` merges fetched page preview metadata back into `data.results`, and direct `web_fetch` returns a `data.preview` object plus flat preview fields.
- `show_market` resolves tickers/ids via an alias map + `/search` fallback (covers memecoins). `show_stocks` returns price + day change + 1-month sparkline in one Yahoo call; both render in the **same** `stocks` card (kind `equity`/`crypto`), source label reflects the real provider.
- `show_map` markers accept `lat/lng` directly or an address (geocoded best-effort; Nominatim is weak on bare business names — prefer coords). The map is an OSM `<iframe>` (needs network; won't fully render offline) plus a marker list with Directions/Website links.
- `show_prediction_market` is **event-centric**: it resolves Polymarket *events* (trending via `/events`, search via `/public-search`, specific via `/events?slug=`) so card URLs use `event.slug` (`https://polymarket.com/event/<slug>` — never the market slug, which 404s). Multi-candidate events render as one card with candidate-probability rows.

## Interactive `agent_work` card

The operator-snapshot card. Priority/activeWork rows that carry a `taskId` become **clickable** on desktop *and* mobile:
- Click/tap expands an inline detail drawer that lazy-fetches `GET /api/bg-tasks/:id`.
- Drawer shows status, `Step N/total`, blocker, summary, proposal summary, or prompt fallback, plus status-aware buttons: **Resume / Pause / Restart / Delete** (→ `/api/bg-tasks/:id/{resume,pause,restart}` + `DELETE`), and a **message box** (→ `/api/bg-tasks/:id/message`, which injects + auto-resumes a waiting task).
- Desktop handlers: `awToggleDetail` / `awLoadTaskDetail` / `awTaskAction` / `awSendTaskMessage`. Mobile mirror: `_awmToggle` / `_awmLoad` / `_awmAction` / `_awmSend`.
- **Sharp edge:** the detail drawer is `display:flex`, which overrides the HTML `hidden` attribute — there is an explicit `.aw-detail[hidden]{display:none}` (and `.pm-aw-detail[hidden]`) rule. Without it, every drawer renders empty-but-visible and toggling does nothing.

## `automation_dashboard` v2 (the data behind agent_work)

`automationDashboardTool` in `schedule-admin-tools.ts` returns ONE joined snapshot — the single internal-state read tool. It joins the **agent roster** with each agent's jobs, tasks, recent runs, and last produced output; plus **teams** (members + jobs + recent tasks), `scheduledJobs` (with health + last result), `tasks`, `internalWatches`, `eventQueue`, aggregate `counts`, and a **`build`** field.

Knobs: `depth: "full"` (untruncated output), `agent_id` (focus one agent), `include: [...]` (narrow sections). Use this FIRST for "what's going on / priorities / what has everyone done" instead of chaining `agent_list` + `task_control` + `schedule_job_*`. Drop to the granular tools only for control/mutation or deep single-entity inspection. (See the `task-lifecycle` skill, bumped to v4, for the routing guidance + the `show_agent_work` workflow.)

### `build` field — update status, NOT dev git (`src/runtime/build-status.ts`)
- **Public build** → `{ version, channel:'public', updateAvailable, latestVersion }`. Update check queries the public releases repo (`XposeMarket/prometheus-releases`, the same feed the electron autoUpdater uses), cached 1h, refreshed in the background.
- **Dev build only** → also includes `build.repo` (local git working-tree: branch/dirty/modified/untracked). This is for the developer and **must never** be surfaced in an operator snapshot or any user-facing card. The model is instructed (tool description + skill) to show the update signal, never repo/git state, and not to run `git status` to populate snapshots.

## Charts: native vs Chart.js

The `interactive-visuals` router sends data charts to the **`chart-visualizer`** skill (polished Chart.js fenced ` ```chart ` blocks — axes, gridlines, value labels, tooltips). The native `show_chart` artifact is a **minimal** SVG (no axes/gridlines) and is demoted in its own tool description — use it only for a deliberately minimal inline chart. Pie/scatter/radar/bubble stay on `chart-visualizer`.

## Realtime voice integration

All `show_*` card tools are exposed to the realtime voice agent (OpenAI + xAI), sourced from `buildVoiceToolDefinitions()` → `buildRealtimeVoiceAgentTools()` in `chat.router.ts`. Execution:
- `executeVoiceAgentTool` handles any `VOICE_SHOW_ARTIFACT_TOOLS` name via `buildVoiceShowArtifact(name, args)` — fetch tools hit the keyless APIs, the rest assemble from args — returning a short **spoken summary** + the artifact (`voiceToolResult(..., { richArtifacts:[artifact] })`).
- The artifact rides back on the `/api/voice-agent/realtime-tool` HTTP response. Both clients render it into the chat thread and send the model only a lean "card shown" confirmation:
  - Desktop: `executeVoiceAgentRealtimeFunctionCall` pushes an `ai` message with `richArtifacts` into `sess.history` and re-renders.
  - Mobile: `_executeMobileRealtimeAgentFunctionCall` pushes into `__pmChat.threads[sid]` and calls `_renderMobileChatSessionNow`.
- Realtime instructions list these card tools ("render a card while you speak the gist") so the agent calls them directly instead of dispatching the worker.

## Adding a new artifact type (checklist)
1. Add the type to `RichArtifactType` + an interface + the `RichArtifact` union in `rich-artifacts.ts`.
2. Tool def in `cis-system.ts`; executor case in `subagent-executor.ts` (emit `extra.richArtifacts`); data module in `src/tools/` if it fetches.
3. Desktop: dispatch case + renderer in `ChatPage.js`; CSS in `components.css`.
4. Mobile: dispatch case + renderer in `mobile-pages.js`; CSS in `mobile.css`.
5. Voice (optional): add to `buildVoiceToolDefinitions` + `VOICE_SHOW_ARTIFACT_TOOLS` + `buildVoiceShowArtifact` + a realtime instruction line.
6. `npx tsc --noEmit` then `npm run sync:web-ui`.

## Not yet built / boundaries
- `jobs`, `places`, `sports` types are declared for forward-compat but have no renderers.
- Equities need a key only if you want a provider beyond Yahoo/Stooq; sports would rely on ESPN's unofficial API (fragile).
- **Transacting** (buy/bet — Polymarket/Kalshi/Alpaca/Stripe etc.) is intentionally NOT built. The design intent is "Connected Actions": keyless read card → connector creds in the vault → a transact tool that ALWAYS routes through the approval gate. Read-only cards never move money.
