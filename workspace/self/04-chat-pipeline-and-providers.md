# 04 — Chat pipeline and model providers

> Last verified: 2026-10-07 against PromSRC a48712ccc · **Owner area:** `src/gateway/routes/chat.router.ts`, `src/gateway/chat/`, `src/providers/`, `src/gateway/threads/`
> **Read this when:** following a user chat turn, changing streaming/tool execution, adding provider behavior, routing models, or debugging usage/rate limits.

## TL;DR
- The HTTP route is mounted by `src/gateway/server-v2.ts`; `/api/chat` and `/api/status` behavior is primarily in `src/gateway/routes/chat.router.ts`. `handleChat()` is a very large function (~22k lines in this checkout): grep symbols/read focused windows, never dump the file wholesale.
- Chat orchestration stays in the gateway. It admits/co-ordinates a session turn, loads history and caller context, selects provider/model capabilities, constructs tool schemas and prompt, streams provider output, executes tool calls, and persists/broadcasts results.
- Provider abstraction is `LLMProvider` in `src/providers/LLMProvider.ts`; `getProvider()` in `factory.ts` chooses an adapter from configured `llm.provider`. Registry/defaults and UI metadata are in `provider-registry.ts`.
- Adapters include Anthropic native Messages, OpenAI-compatible/API-key variants, OpenAI Codex OAuth, Gemini, xAI, Perplexity, Ollama/local and ChatGPT web transport. Exact current adapter set: use source and generated route/test maps.
- Tool loop is not merely “one request then one answer”: model tool calls become assistant tool-call history, runtime checks/executes them (some parallel-safe batches via `src/tools/parallel-tool-calls.ts`), results return to the model, and the cycle continues under budgets/safety/recovery rules.
- Streaming is normalized by provider callbacks/events and chat SSE/WebSocket status events. The visible answer stream is distinct from reasoning/thinking summaries and tool lifecycle updates.
- `switch_model` is a tool-side in-turn routing change; `set_current_model` updates the live primary route/config. `src/config/main-chat-route.ts` centralizes the main route invariant and mirror patch.
- HTTP 429 may mean provider capacity, ordinary throttling, or subscription/quota exhaustion. Distinguish provider-native errors; usage-awareness and settings meters are helpful snapshots, not the chat route itself.
- Threads/session history are gateway-owned; consult `src/gateway/threads/`, `session.ts`, live runtime and recovery modules before changing replay/idempotency semantics.
- Generated inventory: [routes](generated/routes.md), [tests](generated/tests.md), [source map](generated/source-map.md), [changelog](generated/changelog.md). Do not hand-copy tool/route/test enumerations.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Chat endpoint/router | `src/gateway/routes/chat.router.ts` → router registration, `handleChat()` | Main turn orchestration; very large file, use grep and bounded reads. |
| Route mounting | `src/gateway/server-v2.ts` | Connects extracted router to Express/app and runtime callbacks. |
| Provider contract | `src/providers/LLMProvider.ts` → `LLMProvider`, `ChatOptions`, `ChatResult`, stream events | Common interface, abort/stream/usage/capability metadata. |
| Provider registry | `src/providers/provider-registry.ts` | Descriptors, defaults, runtime options and provider secret/model metadata. |
| Provider selection | `src/providers/factory.ts` → `getProvider()`, `resetProvider()` | Uses live config, account pool and auth/vault readers. |
| Main chat route | `src/config/main-chat-route.ts` → `readLiveMainChatRoute()`, `mainChatRoutePatch()` | `llm.provider` + provider's model is live; mirrored legacy default repaired from it. |
| Anthropic | `src/providers/anthropic-adapter.ts` | Native API format, OAuth/API-key handling, usage/rate headers and overload retries. |
| OpenAI Codex | `src/providers/openai-codex-adapter.ts`, `src/providers/chatgpt-web/` | OAuth-backed Codex and web-backed ChatGPT paths are distinct. |
| OpenAI-compatible/local | `src/providers/openai-compat-adapter.ts`, `ollama-adapter.ts`, `opencode-adapter.ts` | API-compatible hosted/custom endpoints and local runtime paths. |
| xAI/Gemini/Perplexity | matching adapters under `src/providers/` | Provider-native request/stream behavior and usage metadata. |
| Tool dispatch/parallel safety | `src/tools/parallel-tool-calls.ts`, `src/tools/` and chat router | Parallelizes eligible independent calls only; ordering, approval and stateful tools remain constrained. |
| Context/prompt | `src/gateway/prompt-context.ts`, `src/gateway/context/model-context.ts` | Prompt profile, memory, model capabilities and context budget. |
| Session/history | `src/gateway/session.ts`, `src/gateway/threads/` | Conversation persistence, thread lookup/search and compaction. |
| Runtime ownership/recovery | `src/gateway/live-runtime-registry.ts`, `runtime-recovery.ts`, `src/gateway/runtime/` | Stop/abort, state reconstruction and safe continuation. |
| Usage/limits | `src/providers/usage-awareness.ts`, `provider-usage-limits.ts`, `model-usage.ts` | Response-header/usage API/internal token accounting are different sources. |

## How it works

### Request to turn

1. The router authenticates/authorizes the request and resolves session/thread state, incoming message, attachments and request options. Route validation, deduplication/replay and account access are in gateway router/middleware; do not change these from assumptions.
2. `handleChat()` enters the runtime admission/coordination lane for its `ExecutionMode`, loads session history and workspace binding, applies caller/agent/team context, and determines whether this is an interactive, background, proposal, heartbeat, cron or team path.
3. It resolves the current provider/model override and capability snapshot before initial prompt assembly. It builds the provider-visible tool surface (including category activation/filter/cap behavior) and mode-appropriate system prompt/personality context.
4. It invokes the active `LLMProvider` with system/history/tools/options and stream callbacks. The provider maps common chat messages/tools to its wire API and normalizes result, stop reason, usage and stream events.
5. Text/reasoning/tool deltas are separately processed. Visible response tokens stream to the client; thinking, reasoning summary and tool lifecycle information use their own events/state. `abortSignal` ties stopping the owning turn to provider request cancellation where supported.
6. A response with no tool calls is finalized/persisted/broadcast. With tool calls, the router validates/parses them, records assistant tool-call messages, applies runtime policy/approval, dispatches eligible calls, serializes results, appends tool-result messages and calls the model again. Tool loops are bounded by runtime/model/turn policy; not every turn takes the same number of provider round trips.
7. Completion/abort/failure updates session and live-runtime state, usage/turn accounting, tool observations and safe continuity packets where applicable. Recovery relies on current session/process/runtime evidence rather than a retired turn-journal design.

### Tool calls and concurrency

`src/tools/parallel-tool-calls.ts` defines which calls can execute concurrently and how outcomes are associated to request IDs. “Parallel tool calls” means safe, independent calls in one model response may run as a batch; it does not mean unrestricted parallel mutation or out-of-order conversation state. The chat router owns permission checks, category/approval gates, event emission, result persistence and model continuation. Stateful or order-dependent operations must remain serial or have explicit coordination. Inspect classifier and callsite before adding a tool to the parallel-safe set.

Provider tool schemas are rebuilt when relevant category activation/model overrides change. Tool prompt policy text in `prompt-context.ts` is not the tool registry. A response can mention a tool in text without a valid call; conversely, malformed/unterminated provider tool-call streams are handled as incomplete output rather than success.

### Streaming contract

`LLMProvider.chat()` accepts normalized messages, optional tools/options, `onToken`, `onThinking`, `onReasoningSummary`, `onModelEvent`, `abortSignal` and other context controls. Provider implementations can support these at different levels. `ChatResult` carries normalized message, usage, stop reason and incomplete-stream cause when known. The router emits client stream events (SSE and runtime broadcasts) and may post UI preflight progress while model and tools are prepared.

Do not merge private chain-of-thought/thinking with visible content or use raw thinking as durable continuity. `onReasoningSummary` is a distinct provider surface; safe summaries may be used for bounded continuity/compaction. Providers that cannot stream visible tokens may return a complete response later, so a quiet stream is not proof that generation failed.

### Route changes and model switching

The live main route is `llm.provider` plus `llm.providers[provider].model` (falling back to `models.primary` for resolution where needed). `agent_model_defaults.main_chat` is a durable mirror for templates/legacy callers, not a second authority. `mainChatRoutePatch()` updates the provider/model/account/reasoning and related model defaults together.

- `switch_model` is an in-turn tool path that changes provider/model for the current runtime and rebuilds route-dependent capability/prompt/tool state; it can preserve the conversation and may omit high-cost intraday context on retry.
- `set_current_model` is a persistent live-main-chat route change. Route update emits a model-change event so the UI updates promptly.
- `set_agent_model` targets an agent role/default; it is not interchangeable with live main route mutation.
- Provider account selection may be explicit or resolved using account pools; do not assume one account per provider.

Inspect tool implementation/callsite plus `main-chat-route.ts` before changing model-route semantics. A settings-panel provider selection does not necessarily switch main chat; source intentionally preserves the live route when saving connection details.

### Provider adapters and model router

`factory.ts` uses config (`llm.provider`, provider settings, accounts and vault-backed tokens) to return an `LLMProvider`. `provider-registry.ts` supplies provider descriptors/defaults/runtime capabilities and is the extension point for provider metadata. `openai-compat-adapter.ts` handles compatible chat-completion style APIs; native adapters keep provider-specific wire differences. OpenAI Codex uses OAuth account selection and a separate request path; `chatgpt-web/` handles web-session integration. Local providers such as Ollama target local model hosts.

Provider request failures must retain their native evidence: HTTP status, structured error type/body/headers, account/model, retryability, stop/incomplete state, and any reset timing. Avoid blanket fallback or retry that hides which route actually answered. Adapter-specific recovery (such as Anthropic overload/capacity retry) is not the same as switching to another configured provider.

## Config & knobs

- `llm.provider`: active provider ID.
- `llm.providers.<provider>.model`: model for that provider; provider-specific endpoint/auth/reasoning/settings live nearby; schema/registry are authoritative.
- `llm.accountId` and provider `accounts`/`defaultAccountId`: optional account selection for multi-account OAuth pools.
- `models.primary`, `models.roles.*`, and `agent_model_defaults.main_chat`: default/role model fields; live main-chat route helper reconciles mirror and route.
- `gateway.port`, route auth, `session.*` compaction and `tools.permissions.*` affect the surrounding request/runtime, not provider wire-level behavior.
- Provider-specific generation controls are passed through `ChatOptions` and adapter/runtime options; add a knob to schema and provider registry when needed instead of ad hoc UI-only config.
- `provider-usage-limits.ts` supports cached live provider usage (where supported), internal `model-usage.jsonl` accounting for other providers, and optional budgets. `usage-awareness.ts` keeps best-effort snapshots; its prompt notice is inserted in the router's working-context packet only when the tightest known window is at or below 30% remaining.
- Port/config/data path/secret location: see [01 Identity and paths](01-identity-and-paths.md). Never put bearer tokens/API keys in docs, logs or regression fixtures.

## Gotchas / sharp edges

- **Chat router size:** `chat.router.ts` is enormous. Use `rg -n 'handleChat|switch_model|set_current_model|executeToolCallsInParallel|onToken'` plus bounded read windows; avoid loading the whole file.
- **Provider route vs `main_chat` mirror:** update both atomically with `mainChatRoutePatch()`; read the live route from `llm.provider` rather than trusting a stale template mirror.
- **429 ambiguity:** HTTP 429 can be usage exhaustion, temporary rate limit or provider-specific capacity signal. Inspect adapter's parsed response, `Retry-After`/reset headers and usage snapshot; don't report “out of credits” from status alone.
- **429 is not Anthropic 529:** Anthropic overload is a separate capacity condition with its own retry policy. Don't blanket-treat every 429/5xx identically.
- **OAuth/account pool:** credentials may belong to selected account IDs and live in secure vault storage. Do not log request auth headers or assume factory has one static token.
- **Partial stream is not complete answer:** inspect stop reason/incomplete cause and tool block termination. Avoid committing malformed tool args or treating missing message-stop as normal completion.
- **Provider differences matter:** OpenAI Codex, ChatGPT web, regular OpenAI API, local OpenAI-compatible endpoints and native Anthropic are not one identical adapter behind a URL string.
- **Parallelism:** do not parallelize side-effecting tools without reviewing the safety classifier/approval semantics. Preserve tool-call/result association and deterministic history order.
- **Provider fallback:** fallback changes cost/account/model and capability assumptions. Keep actual route and fallback reason visible in `ModelUsage`/logs, and rebuild prompt context if it changes.
- **Usage-awareness is not authoritative for every call:** live usage may be cached, unavailable or provider-account scoped; internal tokens are a different measure.
- **Thread semantics are easy to break:** inspect session, threads, idempotency and runtime-recovery paths before altering client retry/replay behavior.

## How to change it safely

1. Identify the layer: route middleware, chat-turn orchestration, runtime admission/session, tool dispatch, common provider contract, adapter or provider registry.
2. Search all callers of any `LLMProvider` field/method before changing the contract. Update each adapter and regression/mock implementation.
3. For tool-loop/parallel changes, run focused `parallel-tool-calls`, router/tool-loop, permission/approval, session order and stream-incomplete regressions from [generated/tests](generated/tests.md).
4. For provider changes, run adapter-specific contract/regression tests, model capability/routing tests, OAuth/account-pool tests and usage parsing tests. Avoid real provider calls unless the test explicitly uses a controlled credential.
5. For route changes, test `readLiveMainChatRoute()`, `mainChatRoutePatch()`, settings-save preservation, switch-model continuation and UI event behavior.
6. For streaming, test token/reasoning/tool channels, cancellation, provider without token streaming, malformed/unterminated tool blocks, usage/stop reason and final persistence.
7. For 429/limit changes, test ordinary throttling vs exhausted quota and overload/capacity separately, including absent or stale reset headers.
8. Follow [07 Source editing and PR workflow](07-source-editing-and-pr-workflow.md) for source changes. Verify live gateway and relevant client surfaces after approved PR merge/deploy; this worker task only writes guidebook docs.

## Related
- [01 Identity and paths](01-identity-and-paths.md)
- [02 Startup, gateway and runtime](02-startup-gateway-runtime.md)
- [03 Prompt assembly and context](03-prompt-assembly-and-context.md)
- [05 Tools and categories](05-tools-and-categories.md)
- [08 Agents, tasks and background work](08-agents-tasks-background.md)
- [09 Teams](09-teams.md)
- [generated/routes](generated/routes.md) · [generated/tools](generated/tools.md) · [generated/tests](generated/tests.md) · [generated/source-map](generated/source-map.md) · [generated/changelog](generated/changelog.md)

## UNVERIFIED
- Exact route idempotency/replay windows and every SSE event name are deliberately omitted; confirm in current router before changing API contract or writing a client.
- Current complete adapter/provider inventory and whether a newly added provider is active must be checked against `provider-registry.ts`, `factory.ts` and generated inventories.
- A specific user-facing 429 message may be adapted by route/UI layers; only adapter/error parsing establishes the provider-side cause.

### Failure classification and limit awareness

- **Transport/connectivity failure:** DNS, TLS, timeout or socket close before a provider response. Inspect endpoint, cancellation and adapter logs; no usage-limit conclusion follows automatically.
- **Authentication/permission failure:** 401/403, expired OAuth, disconnected account or denied model. Confirm selected provider account and vault connectivity without exposing credential material.
- **Provider HTTP 429:** parse provider error body and response headers. `usage-awareness.ts` recognizes an explicit rate/usage-limit message, records an exhaustion backoff and can exclude that provider from helper selection until reset; do not classify every 429 as permanent quota exhaustion.
- **Anthropic capacity overload:** `anthropic-adapter.ts` separately recognizes HTTP 529 / `overloaded_error` and applies bounded exponential retry. This is service capacity, not evidence that a request consumed the user's full allowance.
- **Anthropic extra-usage/tool retry:** the adapter may retry a rejected oversized tool surface with a smaller safe set; it preserves the relevant existing tool calls and injects a notice so the model understands the retry surface. Check retry-specific regression before changing that filter.
- **Truncated stream or malformed tool call:** preserve incomplete-stream/stop reason, do not run unverified partial arguments, and allow the gateway's resume/recovery policy to decide whether to retry.

`formatUsageAwarenessForPrompt()` reads snapshots from provider response headers or the usage API. Header snapshots are more exact/fresh and must not be overwritten by older API polls; snapshots expire. `provider-usage-limits.ts` also reports internal token totals/budgets, which are not interchangeable with provider subscription windows. Use the source label, provider/account, window/reset timestamp and observation time when explaining a limit.

## Thread and handoff boundaries

`src/gateway/threads/` contains thread-specific indexing/search/state support; it is not a second provider abstraction. `src/gateway/session.ts` owns the normalized session history and compaction flow used by chat. `live-runtime-registry.ts` identifies active generation ownership, while `runtime-recovery.ts` rebuilds safe continuation from current session/runtime/process evidence after disconnect or restart. Mobile reconnect, HTTP retry and provider stream retry are three different mechanisms; avoid merging their idempotency keys or replay rules.

Recent chat/runtime changes include mixed-batch tool parallelism, compact restart-checkpoint replay, ChatGPT-web session routing across concurrent chats, and stale-runtime/reply-recovery fixes. When modifying either provider or thread code, inspect the merged PR notes in [generated/changelog](generated/changelog.md) and the corresponding current regression in [generated/tests](generated/tests.md); do not infer semantics from the name of a recent performance fix alone.

### Smallest useful trace map

| Symptom | First place to inspect | Next evidence |
|---|---|---|
| User turn never starts | router auth/validation + runtime admission in `chat.router.ts` | `/api/status`, gateway logs, live runtime status |
| No visible tokens | provider `ChatOptions` callbacks + router SSE emitter | adapter event parsing, client reconnect snapshot |
| Tool call missing | tool builder/category filters + provider result normalization | manifest tool surface, raw-safe call metadata |
| Tool output is late/wrong order | `parallel-tool-calls.ts` eligibility and router result persistence | correlation IDs, completion order, session history |
| Model unexpectedly changed | `switch_model` scoped override, `set_current_model` config mutation | `main-chat-route.ts`, emitted route event, selected account |
| Rate-limit error | adapter error classifier + usage snapshot | HTTP status/body type, retry/reset headers, account label |

Never paste raw provider requests, OAuth tokens or private prompt contents into an issue when a sanitized provider/model, runtime ID, timestamp and error classification will locate the failure.

## Provider contract checklist

Before wiring a new adapter, compare with `LLMProvider` and the registry:

- It declares a stable provider ID/descriptor, model defaults/capability support, endpoint/auth/account configuration and secret resolution policy.
- It maps system/user/assistant/tool messages including tool-call IDs, tool result ordering, attachments and structured formats to the provider's wire format. Provider-specific unsupported tool/system constructs must be surfaced or safely adapted, not silently lost.
- It honors abort/timeout, normalizes text deltas, thinking/reasoning-summary events, tool-call deltas, finish reason, incomplete stream and usage/token reporting.
- It classifies provider errors with status/type/retry-after/reset timing and never logs auth, full private prompts or raw sensitive attachment payloads.
- It participates in `getProvider()` selection/account pools and route snapshot identity, `ModelCapabilities`, usage-awareness (if supported), `ModelUsage` attribution and relevant settings metadata.
- It has deterministic contract tests for normal completion, streaming, tool-use round trip, cancellation, malformed/partial response, HTTP throttling, authentication and account selection.

Keep provider selection, tool permissions and UI provider metadata in separate owner layers. A registry descriptor can tell the UI a provider is supported while an adapter bug still breaks runtime; tests need to exercise the factory-selected adapter, not only the descriptor.

## Operational model-state distinctions

| Question | Do not confuse it with | Source of truth |
|---|---|---|
| What model answers this turn? | The route saved in Settings after a concurrent config write | Turn admission/route snapshot, plus scoped `switch_model` override. |
| What model is configured for next main turn? | An agent role's default or a temporary retry route | `llm.provider` and that provider's model, mirrored by `main_chat` defaults. |
| Which provider account did the adapter use? | The provider ID itself | Captured route snapshot/account ID and provider factory account-pool resolution. |
| Which model capability was used in the prompt? | Static model-family guess in a skill note | Current `ModelCapabilities` snapshot; check source/reason and any fallback path. |
| How much plan allowance remains? | Internal token count for calls | Provider live usage windows (if available), with source and reset timestamp. |
| Which tool calls are safe concurrently? | The provider's `parallel_tool_calls` preference | `src/tools/parallel-tool-calls.ts` eligibility and runtime policy. |

Concurrent interactive sessions can be on different providers/accounts, especially ChatGPT-web. Provider clients that hold mutable session state must be keyed/scoped by the correct connection/chat context; do not share one global browser session because the adapter is a singleton.
