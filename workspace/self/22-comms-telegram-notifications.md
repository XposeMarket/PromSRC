# 22 — Comms, Telegram, and notifications

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/comms/`, `src/gateway/routes/channels.router.ts`, delivery tools and mobile PWA
> **Read this when:** Changing Telegram/Discord/WhatsApp messaging, inbound channel events, origin-channel context, team/task notifications, or outbound chat delivery.

## TL;DR
- Gateway channel runtime code is in `src/gateway/comms/`; it currently has Telegram-specific adapters/bridges plus shared coalescing, chunking, fanout and webhook modules.
- Channel configuration/types also name Discord and WhatsApp, but do not assume every channel has the same built-in runtime path; use the connector/routes inventory for exact support.
- Telegram updates can flow into chat/tasks/teams; preserve channel/account/peer/topic identity and originating conversation context through handoffs.
- Inbound webhook security and message normalization are separate from outbound delivery. Verify permissions/allowlists before enabling a route.
- The core `delivery_send` tool provides Prometheus reply/delivery by origin channel; it is not interchangeable with direct Telegram bot API code or an arbitrary connector send.
- Phone chat is a PWA/websocket client. No browser `PushManager`/web-push service registration was found in the inspected mobile source; do not promise background push on iOS/Android as implemented without locating a live subscription/sender path.
- Task/team notices may be sent through explicit bridges (for example Telegram); a status update alone is not guaranteed to notify the origin channel.
- Don't copy credentials into URLs, logs, or generated docs. Respect channel allowlists and user/room/topic routing.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Channel configuration/types | `src/types.ts` → channel/target types | Channel names, IDs and config structures. |
| Channel router | `src/gateway/routes/channels.router.ts` | Status, config/test, agents and channel operations. |
| Telegram transport | `src/gateway/comms/telegram-channel.ts` → `TelegramChannel` | Bot transport/send, allowlisted peers, incoming updates. |
| Telegram persona bots | `src/gateway/comms/telegram-persona-bots.ts` → `TelegramPersonaBotManager` | Agent/account-specific bot routing. |
| Team room bridge | `src/gateway/comms/telegram-team-room-bridge.ts` | Team event mirror and room/topic integration. |
| Telegram streaming | `src/gateway/comms/telegram-streaming-message.ts` | Edit/stream reply transport. |
| Telegram tool log | `src/gateway/comms/telegram-tool-log.ts` | Tool/runtime activity presentation. |
| Shared coalescing | `src/gateway/comms/message-coalescer.ts` | Channel-safe update aggregation. |
| Shared reply handling | `src/gateway/comms/reply-processor.ts` | Normalize/handle inbound reply content. |
| Webhook dispatch/security | `src/gateway/comms/webhook-handler.ts`, `webhook-security.ts` | Provider webhook ingress and verification. |
| Gateway bridge wiring | `src/gateway/server-v2.ts` | Constructs Telegram channel/managers and connects bridges. |
| Origin delivery | `delivery_send` in the core tool surface | Follow [05 Tools](05-tools-and-categories.md) and generated inventory for current args/targets. |
| Team notification bridge | `src/gateway/teams/notify-bridge.ts` | Team-notice callback binding into channel/runtime code. |
| Browser delivery | `delivery_send` core tool; `delivery_send` Prometheus runtime tool | Delivers replies to the current/origin conversation where supported. |
| Mobile/PWA | `web-ui/src/mobile/`, `web-ui/src/ws.js` | Foreground session delivery; not evidence of background push. |
| Generated channel/tool lists | [generated connectors](generated/connectors.md), [tools](generated/tools.md), [routes](generated/routes.md) | Current names/support, not a prose-owned list. |

## How it works

### Inbound to chat context
A channel adapter receives and normalizes a message, associates it with the correct account/peer/chat/topic, and routes a gateway event into the conversation/task flow. Message coalescing and chunking protect providers with rate, size or formatting constraints. Preserve origin metadata when a reply continues through a main-chat turn, scheduled task, team manager/member or agent handoff: the model should not lose which conversation to answer, and outbound routing should not guess from a display name.

Telegram is the clearly present built-in gateway surface in `src/gateway/comms/`: `TelegramChannel` is constructed in `server-v2.ts`, then injected into worker/scheduler flows and connected to persona/team-room bridges. Channel types/router schemas may also mention Discord/WhatsApp; the detailed channel implementation may instead be a connector/webhook. Check current source/inventories before assuming a Telegram-specific method works for another provider.

### Outbound delivery and tool choice
Use the explicit origin-aware delivery operation when the desired action is “reply on the channel this conversation came from.” It is different from channel admin/config tests, sending a direct bot message to a known Telegram peer, a connector action (e.g. Slack/GitHub), and mobile WebSocket chat rendering. Keep the sender, peer, account and thread/topic address explicit when the API requires it. Apply provider formatting/size splitting once, through the channel's shared chunker/adapter; avoid double splitting or manually truncating a model reply.

The user-visible `delivery_send` Prometheus tool may be surfaced by runtime tool wrappers rather than being an exported function named in `src/gateway/comms/`. Generated tool inventory is the authoritative tool name/schema. Follow its eligibility, origin fallback and confirmation rules instead of inferring behavior from Telegram transport code.

### Telegram personas and team rooms
`TelegramPersonaBotManager` selects bot identity by agent/account. `TelegramTeamRoomBridge` mirrors team events and routes team-room messages, while `server-v2.ts` connects team event hooks and the main Telegram send callback. Preserve distinction among main bot, persona bot and team room. Do not send a main-chat answer to a team topic (or vice versa) just because the same peer ID exists.

### Notifications vs push
“Notification” can mean a channel message, a task/team event mirrored to Telegram, a desktop/web UI notice, or a native/browser push notification; these are separate paths. Main source evidence here shows Telegram send/bridges and foreground web/mobile chat, but the inspected mobile source did not expose a `PushManager`, subscription persistence, or `web-push` send route. The dependency list contains `@types/web-push`, which alone does not prove the feature exists. Mark background mobile push **UNVERIFIED / not found in the inspected main paths** until a full producer→subscription→delivery path is verified.

## Config & knobs
- Channel configuration lives in config types/runtime resolution (`src/types.ts`, `src/config/`); secrets are credentials, not ordinary public client preferences.
- Telegram adapter allowlist/bot settings are consumed by `TelegramChannel` and resolved during `server-v2.ts` construction. Inspect current code/config schema for exact key names; don't duplicate them here.
- Channel routes and tool targets are generated: [routes](generated/routes.md), [tools](generated/tools.md), [connectors](generated/connectors.md).
- Mobile device auth uses the paired token on API/WS, not Telegram auth. See [18 Mobile app](18-mobile-app.md).

## Gotchas / sharp edges
- **Lost origin:** a forwarded task/agent turn can reply in the wrong channel if origin/account/thread metadata is dropped. Check the original session's channel and peer/topic fields.
- **Wrong sender:** persona and main Telegram bots can share one manager; resolve agent/account identity before sending.
- **Telegram-only assumptions:** a type union including Discord/WhatsApp does not prove they use the same adapter, delivery helper, or semantics.
- **Long messages:** use channel chunking and preserve code blocks/formatting at split boundaries. Test the target provider's maximum length.
- **Webhook spoofing:** use `webhook-security.ts` validation/signature checks; do not add public unauthenticated inbound routes for convenience.
- **Duplicate notices:** task/team event retries and reconnects can mirror a status more than once. Use stable event/idempotency semantics where the owning bridge provides them.
- **Push promise:** foreground websocket updates are not OS push. Do not say a closed phone browser receives background notifications unless a real push subscription/sender path is present and tested.
- **Secret leakage:** never paste bot tokens or peer auth into URLs, telemetry, or example configs committed to docs.

## How to change it safely
1. Trace inbound payload from provider adapter/webhook through origin/session routing, then trace outbound reply from the originating turn to the selected sender.
2. Use generated inventories for current tool/route/connector names and exact schemas; don't hand-maintain them here.
3. Run focused comms/channel tests from `generated/tests.md`, especially adapter streaming/chunking, webhook security, Telegram bridges and event fanout.
4. Test allowed and denied peers, main vs persona sender, direct vs topic/thread routing, chunk edges, reconnect/retry dedupe, and missing origin fallback.
5. Verify any new notification path end-to-end on a real channel; for mobile push specifically require subscription permission/registration, server persistence, sender and cleanup/revocation tests.
6. Keep gateway auth, account requirements and device pairing independent from provider tokens.

## Related
- [05 Tools and categories](05-tools-and-categories.md) · [09 Teams](09-teams.md) · [10 Scheduling](10-scheduling-automations-triggers.md)
- [18 Mobile app](18-mobile-app.md) · [21 Security, approvals, permissions](21-security-approvals-permissions.md)
- [generated tools](generated/tools.md) · [generated routes](generated/routes.md) · [generated connectors](generated/connectors.md) · [generated tests](generated/tests.md)


## Delivery decision guide

Before selecting a sender, answer these questions:
1. Is the goal to answer the current user in the same conversation, or to send a new outbound notification?
2. Which origin produced the request: desktop/mobile web, Telegram bot, team room, scheduled run, webhook, or connector?
3. Is there a channel account/persona identity attached to that origin?
4. Does the target support a topic/thread and is that ID present?
5. Is the recipient allowed by configuration and by current gateway policy?
6. Is the intended action a normal reply, a task completion notice, or a high-impact external send requiring a distinct approval?
7. If the origin is missing, is fallback explicitly allowed by the tool contract or should the action fail closed?

A current web/mobile session can display a reply through its stream without involving Telegram. Conversely, a scheduled job that has no foreground browser cannot rely on a UI toast. Use the runtime's explicit delivery operation and inspect its origin resolution rules.

## Telegram adapter lifecycle
- `server-v2.ts` resolves Telegram config and creates one main `TelegramChannel` instance.
- The gateway wires the Telegram send callback into background task execution so tasks can deliver notices.
- Separate persona-bot manager handles per-agent/per-account sender selection.
- Team room bridge subscribes to mirrored team events and forwards messages to the configured room/topic.
- Streaming helper handles partial/final message updates; avoid creating a new message for each token when edit-in-place is available.
- Human delay and coalescing helpers should not be bypassed by a new hot path without considering rate limits.
- On gateway warm handoff/restart, prevent duplicate polling/bridges; only one runtime should own active delivery.

## Failure handling and observability
- Distinguish provider rejection, permission/allowlist denial, bad target ID, rate limit, transport timeout and malformed payload.
- Do not mark a task notice as delivered merely because the enqueue operation returned; use the bridge's completion/error semantics.
- Keep retry behavior bounded and idempotent. Retrying a send after an ambiguous timeout can duplicate a real notification.
- Log message IDs and safe status metadata, not token values or full private message bodies by default.
- For webhook ingress, verify signature/timestamp/replay rules before parsing untrusted body fields.
- For account/agent route changes, verify both a configured channel and an unconfigured-channel response.
- Avoid generic “notification sent” UI until the transport confirms delivery or clearly label it as queued/attempted.


## Channel identity fields

A cross-channel session may include several distinct IDs:
- **Channel:** which transport produced the event (e.g. Telegram).
- **Account/bot identity:** which configured bot or persona is speaking.
- **Peer/chat ID:** destination/source conversation.
- **Topic/thread ID:** sub-conversation inside a group or threaded transport.
- **Session ID:** Prometheus conversation identity; not necessarily equal to a provider ID.
- **Agent/team identity:** which assistant or team context owns the reply.
- **Origin URL/device identity:** for browser/mobile sessions, the client origin and paired device can matter separately.

Do not substitute one ID kind for another or trust a display label where the stable numeric/string identifier is required. Cross-channel delivery adapters should preserve these fields in a typed structure; avoid flattening them into a single unvalidated `target` string.

## Comms regression checklist
- Direct main-bot reply to an allowed user.
- Attempted reply to a non-allowlisted user.
- Persona-bot reply with expected agent identity.
- Group/topic reply with topic ID retained.
- Long message split at safe markup/code-block boundaries.
- Partial stream update followed by exactly one final message.
- Inbound webhook with valid signature, invalid signature and stale replay timestamp.
- Duplicate inbound update/event delivery.
- Provider timeout after a send was accepted but before response was received.
- No-origin invocation and explicit fallback policy.
- Telegram channel disconnected while a task completes.
- Gateway warm handoff while the Telegram polling/bridge runtime is active.
- Foreground mobile websocket reconnect vs app fully closed (must not infer OS push).
- Notification targeting a team room vs a main user chat.


## Safe test strategy

Use fake credentials and a mocked transport for unit/contract tests; reserve a real bot/room for an explicitly authorized smoke test. A safe live test should target a private test chat, use a clearly labeled message, and delete or stop the bot afterward if appropriate. Never run a messaging test against a customer/group room just because its identifier is available in local config.

For outbound events, assert the selected destination and payload before calling the provider. For notification text, avoid sensitive memory, account data or tool arguments unless the user explicitly requested that information be sent. A task failure notification should summarize the status and link/identify the task; it should not dump a full private transcript.

For external channel delivery, treat a retry as potentially duplicative when the provider accepted the request but the local process timed out before receiving a response. Use a stable operation ID if available, store delivery state with its owning job/session, and prefer “delivery uncertain” over an unqualified success claim. Keep test logs sanitized, especially when webhook signatures and bot tokens are involved.


## Notification category boundaries

- **Chat reply:** content is attached to the current session and rendered by its client/transport.
- **Channel send:** a provider API delivers a message to a known external peer or room.
- **Runtime notice:** a task/team/schedule subsystem emits a lifecycle event; a separate bridge may forward it.
- **Desktop notification:** a local UI/system notification needs app focus/permission behavior and is not the same as channel delivery.
- **Mobile foreground notice:** a websocket or active-page event updates the open PWA.
- **Mobile background push:** requires a browser push subscription, server-side endpoint storage, push sender, permission state and unsubscribe lifecycle. The inspected main mobile paths did not show this complete implementation.
- **Connector notification:** an installed external connector may send/update another service; use that connector's tool/approval semantics.
- **Timer/reminder:** a scheduled gateway job and a visible reminder card can be different operations; ensure the user requested actual scheduling before creating one.

Keep the user-facing explanation precise about which layer completed. A card displayed in chat is not proof that an external message or OS notification was delivered.


### Origin channel contract
The current conversation may carry an origin channel distinct from the client that is rendering its answer. Keep the origin channel/account/peer context attached when turns are resumed by a schedule, task worker or subagent; otherwise the final response can be rendered to the browser but never delivered to its initiating external channel. Conversely, a desktop user inspecting a Telegram-origin session should not cause a duplicate send to Telegram unless the delivery tool/action explicitly requests it. For ambiguous origin, inspect session metadata and the runtime tool schema instead of assuming the most recently connected channel.

When adding a provider, map both inbound and outbound capabilities explicitly. Record how webhook or polling is authenticated, which peer/account identifiers are stable, how message edits/replies are represented, whether threads/topics are supported, how payloads are chunked, and what delivery result/error states the runtime returns. Add only the routes/tools that are actually exposed and tested; a provider library dependency or a shared type entry is not a supported channel by itself. Keep the connector inventory authoritative for connector-backed surfaces.

For local UI notifications, inspect the actual event and rendering lifecycle separately from channel dispatch. A visible toast in desktop does not prove the corresponding Telegram or phone delivery succeeded; conversely, a provider send can succeed while the current browser is disconnected. Surface separate status when both paths matter.

If a channel adapter is deliberately disabled or unconfigured, expose that state rather than silently routing to another account or origin. Cross-account fallbacks can leak a private response into a different person's chat.

When adding channel support, prefer a typed adapter/bridge contract and focused tests over scattering provider-specific `if` branches across chat, scheduler, team and task code. Keep transport-specific formatting and retries at the adapter boundary; shared origin selection and policy should stay inspectable at the gateway/tool layer.

## Operator invariants

- A delivery target must resolve to exactly one intended channel/account/peer tuple.
- A missing origin must not be replaced with a guessed peer.
- A send attempt and a confirmed delivery are different states.
- A retry after timeout can duplicate an accepted send.
- A foreground mobile websocket is not OS background push.
- An enabled channel still enforces its allowlist and gateway policy.
- The provider adapter owns formatting, chunking and transport errors.
- Session metadata owns the destination; display names are not stable identifiers.
- Secrets remain in protected configuration/vault paths, never in logs or docs.
- Keep cross-channel tests synthetic unless a real smoke test was explicitly authorized.


When the same event is visible on several surfaces, define which surface is authoritative for delivery status and use consistent correlation IDs so the operator can tell a queued notice from a delivered one.