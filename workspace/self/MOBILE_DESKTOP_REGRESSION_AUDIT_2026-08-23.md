# Mobile and desktop regression audit — 2026-08-23

## Baseline and scope

The audit and implementation are based directly on `origin/main` at
`1a3abc2287e9a81436b9c7cb70ce896e350cdcab`, `fix(mobile): reconcile live
timeline identities after send (#210)`, committed 2026-08-23T16:12:48-04:00.

The review covered the post-performance merges #198, #192, #197, #201, #202,
#203, #207, #206, #208, and #210, plus the still-open follow-ups #209, #211,
and #212. The performance sequence #184, #191, #193, #194, #195, and #196 was
also checked at its integration seams because the reported failures involve
the shared chat runtime, keyed timeline, production module output, optional
ownership, and mobile route shell introduced by that sequence.

## Findings and corrections

| Reported behavior | Root cause | Correction |
| --- | --- | --- |
| A newly sent mobile user message disappears while the assistant/work row duplicates | The optimistic user and speculative assistant deliberately share one `clientRequestId`, but the shared runtime treated that request identity as one transcript-row identity. #210 fixed a separate stale positional-key race, so both fixes are required. | Give request-owned rows role-scoped runtime IDs (`mobile-request:<request>:user` and `:assistant`) and explicitly bind stream begin/deltas to the assistant row. A behavioral runtime test proves two rows remain and no third assistant row is allocated. |
| User bubbles wrap normal prose into an unnecessarily narrow column | Circular `fit-content` sizing plus percentage descendants and `overflow-wrap:anywhere` allowed min-content sizing to win. | Use intrinsic `max-content` sizing bounded by the viewport, normal word breaking for prose, and emergency anywhere wrapping only for links/code. A real 390px Playwright layout test covers prose, a short bubble, and an unbroken token. |
| Reasoning summaries appear but operational thoughts do not | The UI conflated private provider thinking, user-safe reasoning summaries, and explicit `agent_thought` progress. Some paths dropped safe thoughts; other desktop/team/voice paths could expose legacy raw thinking. | Centralize trace visibility. `agent_thought` and reasoning summaries render on mobile and desktop; raw `thinking_delta` and legacy provider `thinking` remain private unless explicitly curated. Replay, background chat, Team, Subagent, and Voice paths use the same policy. Gateway legacy provider-thought packets are now explicitly tagged private. |
| Codex Voice reports a session/model error | The gateway log is `Field session.model is not allowed for this Codex realtime session`. Prometheus does not add that field; the local Codex app-server/realtime path receives the upstream protocol rejection. This matches upstream Codex issue [#40140](https://github.com/openai/codex/issues/40140). | Classify the exact upstream error, mark it non-retryable, preserve structured metadata through mobile fetch/desktop bridge code, and show a truthful recovery message instead of silently retrying or swallowing the rejected PTT promise. This improves diagnosis and UX; it does not claim to repair the upstream service. |
| Canonical Settings has no reliable mobile exit | The lightweight mobile route handed off to the desktop document without a return route. Closing the modal only hid it, leaving the user in the full desktop app. | Carry a validated mobile-only return route and PWA marker, install an early close bridge, return loaded Settings through the same helper, and make the visible back control safe-area aware with a 44px tap target. Arbitrary/external return URLs are rejected. |
| The first spoken turn leaves New Chat/selector chrome visible | #212 dispatched a custom first-turn event with no listener. The existing durable-session notification already reaches the mounted chat, but the Voice chrome was not recomputed after adopting the new session. | Recompute active Voice chrome after durable-session adoption and keep the seam-removal CSS. A contract test rejects the unconsumed event path. |
| #210 source fix is absent from the public runtime | #210 merged without regenerating the complete tracked production output. #211 copied one raw mirror but fails the repository's full production regeneration contract. | Regenerate the entire production shell and add generated chat parity coverage. This audit supersedes the narrow #211 copy. |

## Compatibility and safety

- No persisted chat, gateway, or settings schema changes are introduced.
- Request-scoped runtime IDs exist only at the mobile compatibility boundary;
  canonical message/turn IDs still take precedence.
- Settings return navigation accepts only `#mobile/...` or `/mobile/...` routes.
- Raw model chain-of-thought is intentionally not exposed. Short tasks may emit
  only a reasoning summary and no separate user-safe `agent_thought` packet.
- The Codex Voice classification has a generic fallback for other failures and
  preserves retries unless the backend explicitly says `retryable: false`.
- Rollback is a single PR revert; no data migration is needed.

## Verification

The final production build contains 110 assets with build ID
`67c85cceb9c10ac9`.

| Initial surface | Raw total | Gzip total | JS gzip | CSS gzip |
| --- | ---: | ---: | ---: | ---: |
| Desktop | 813,655 B | 146,632 B | 50,082 B | 96,550 B |
| Mobile | 769,389 B | 168,990 B | 92,582 B | 76,408 B |

The following gates passed locally on the final source shape:

- TypeScript (`npx tsc --noEmit`)
- the complete pull-request regression workflow, including proposal, memory,
  connector/plugin, routing, desktop chat, mobile chat/gateway/Voice, Electron,
  Plugins, Hub, design preview, and reasoning-summary checks
- the new mobile/desktop regression audit suite (request identity, Settings
  return, trace visibility, Voice error classification, real bubble layout,
  first-Voice-turn transition, and generated parity)
- mobile route chunks, including authenticated Settings handoff, visible 44px
  back control, and return to the lightweight `/mobile/more` route
- architecture byte ratchets (`index.html` remains exactly 557,079 bytes)
- deterministic full production regeneration and source/generated sync
- strict current-tree plus full-history privacy audit (known historical findings
  remain allowlisted; this change introduces no new finding)
- storage layout regression
- `git diff --check`

Physical iPhone/PWA verification remains a useful final confidence check for
safe-area appearance, installed-service-worker update timing, and the exact
New Chat → send once → receive → leave/reopen gesture sequence. The automated
tests reproduce the underlying identity and layout failures without sending a
live user message.

## Open-PR disposition

- #209 identified the correct request/row collision but is based on older
  ancestry and includes a noisy stack. Its focused fix and intent are included
  here with current-main integration and full production generation.
- #211 is superseded by the complete production regeneration and parity gate.
- #212's visual seam fix is retained, while its unconsumed custom-event path is
  replaced with the existing mounted-chat notification bridge.
- #204 is unrelated retired file-operation cleanup and is deliberately not
  folded into this audit.
