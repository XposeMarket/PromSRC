---
# Dream - 2026-05-28
_Generated: 2026-05-28 23:39 local / completed after compaction_
_Thoughts synthesized: 2_

## Day Summary
2026-05-28 was a product-shaping day. Raul pushed Prometheus in three connected directions: make mobile reliable enough to trust from the phone, turn repeated agent/tool workflows into composable infrastructure, and raise Creative/HyperFrames output quality into readable, marketable demos instead of frantic technical proof-of-work.

The strongest product thesis was composite tools. The first real composite, `codex_dev_debug_handoff`, proved the value immediately: a repeated Codex handoff workflow can collapse into a single reusable action with proof screenshot, note, and timer. It also proved why saved tool sequences are not enough. Real composites need typed step schema, waits, assertions, fallback branches, output binding, structured results, telemetry, exact-window diagnostics, safe prompt typing, and recursion/name guards. Raul’s “memory that executes” framing should guide the implementation and docs.

Creative work moved forward too. The 18s Ash & Archive HyperFrames Composite Tools explainer became a tangible product artifact, but Raul’s correction was the important lesson: the style was exciting, yet scenes cut too fast for viewers to read. Future Prometheus promo/explainer work should default to slower holds, fewer rapid cuts, voiceover-first timing, short transcript-derived captions, and frame/export QA that checks reading time — not just lint/render success.

Mobile remains the trust bottleneck. Codex created `workspace/self/16-mobile-app.md` and Raul explicitly wants it read before future mobile edits. That gives Prometheus a better source map, but the mobile new-chat/session-history bug and the not-fully-closed mobile repair/proposal queue mean mobile needs a status sweep before more feature expansion. Voice is also still unresolved: Claude’s realtime voice handoff appeared to reach a fix recap, but the approval loop stalled and no gateway restart/test happened.

## Memory Updates Applied
| Item | File/Skill | Recall Trigger | Future Behavior | Staleness Risk | Change Made | Evidence |
|------|------------|----------------|-----------------|----------------|-------------|----------|
| Prometheus promo/explainer pacing | `prometheus-creative-mode` skill resource `references/known-issues/promo-pacing-readability-2026-05-28.md` | Future Prometheus/Xpose/HyperFrames/Creative promo or explainer clips | Use fewer rapid cuts, longer readable holds, voiceover-first timing when possible, 2–6 word caption groups, and QA for actual reading time. | Low; only override when Raul explicitly asks for frantic/trailer pacing. | Added focused reusable skill resource. | `audit/chats/transcripts/f94f6eef-f3e6-4894-9425-72c42b7a0249.md:26-33`; `Brain/thoughts/2026-05-28/21-42-thought.md:47-50` |
| Mobile app self-doc prerequisite | Existing `MEMORY.md` / project memory | Mobile app edit/debug/review/proposal | Read `workspace/self/16-mobile-app.md` before touching mobile source. | Low unless doc path changes. | Accepted existing memory; no duplicate write. | `audit/chats/transcripts/mobile_mpowqdq4_2kirmu.md:25-30`; `memory/2026-05-28-intraday-notes.md:6-13` |
| HyperFrames audio/captions/avatar routing | Existing `hyperframes-media` overlay from Thought | HyperFrames audio, captions, avatar, TTS, transcription, or background removal tasks | Route to `hyperframes-media`; compose avatar/provider footage as media, separate audio/captions in HyperFrames. | Medium; depends on future avatar-provider integrations. | Accepted Thought-applied skill update. | `Brain/thoughts/2026-05-28/21-42-thought.md:64-67` |
| Claude terminal approval-loop example | Existing `desktop-automation-playbook` example from Thought | Desktop automation against Claude/Codex terminal approval prompts | Verify exact terminal/window, use bounded distinct attempts, stop/report when approval-like keystrokes become chat input. | Medium; UI may evolve. | Accepted Thought-applied skill update. | `Brain/thoughts/2026-05-28/09-55-thought.md:49-55` |

## Business Reconciliation
| Candidate | Destination | Change Made | Evidence |
|-----------|-------------|-------------|----------|
| HyperFrames Composite Tools explainer + pacing correction | `entities/projects/prometheus.md` | appended event | `Brain/business-candidates/2026-05-28/candidates.jsonl:1-2`; `memory/2026-05-28-intraday-notes.md:36-42` |
| HyperFrames audio/captions/avatar workflow for Prometheus marketing | `entities/projects/prometheus.md` | appended event | `Brain/business-candidates/2026-05-28/candidates.jsonl:3`; `audit/chats/transcripts/f94f6eef-f3e6-4894-9425-72c42b7a0249.md:39-80,257-290` |
| First composite tool `codex_dev_debug_handoff` created/tested | `entities/projects/prometheus.md` | appended event | `Brain/business-candidates/2026-05-28/candidates.jsonl:4`; `memory/2026-05-28-intraday-notes.md:15-29` |
| Mobile self-documentation created; read before future mobile edits | `entities/projects/prometheus-mobile-app.md` | appended event | `Brain/business-candidates/2026-05-28/candidates.jsonl:5`; `memory/2026-05-28-intraday-notes.md:6-13` |
| Mobile new-chat/session-history bug surfaced | `entities/projects/prometheus-mobile-app.md` | appended event | `Brain/business-candidates/2026-05-28/candidates.jsonl:6`; `audit/chats/transcripts/mobile_mpospgxq_h0ufra.md:7-18` |
| Heartbeat feature test succeeded once | `entities/projects/prometheus.md` | appended event | `Brain/business-candidates/2026-05-28/candidates.jsonl:7`; `memory/2026-05-28-intraday-notes.md:44-54` |
| Realtime voice Claude terminal fix loop blocked before restart/test | `entities/projects/prometheus.md` | appended event | `Brain/thoughts/2026-05-28/09-55-thought.md:57-60`; `memory/2026-05-28-intraday-notes.md:56-59` |
| Late spillover Codex-reported Claude Opus 4.8 model support | `entities/projects/prometheus.md` | appended event, medium confidence pending source verification | `Brain/skill-episodes/2026-05-28/episodes.jsonl:16-17` |

**Business report:** `Brain/business-reconciliation/2026-05-28/report.md` written.

## Business Updates Needing Review
| Candidate | Reason Review Is Needed | Suggested Destination | Evidence |
|-----------|-------------------------|-----------------------|----------|
| Composite-tools runtime source upgrade | Codex/transcript text suggests implementation may exist, but Dream did not verify source/build/docs; do not claim complete until read/verified. | `entities/projects/prometheus.md`, self docs, or source-change completion note after verification | `Brain/thoughts/2026-05-28/21-42-thought.md:18-19,97-99,108-109` |
| Claude Opus 4.8 support | Codex reported implementation and backend build, but Dream only had screenshot/timer summary, not source diff verification. | project entity/source docs after verification | `Brain/skill-episodes/2026-05-28/episodes.jsonl:16-17` |
| Realtime voice fix | Claude appeared to fix route/session shape but restart/test never ran. Needs direct source/runtime verification before marking fixed. | project/mobile/voice event after verified behavior | `memory/2026-05-28-intraday-notes.md:56-59`; `Brain/thoughts/2026-05-28/09-55-thought.md:71-85` |
| Mobile new-chat/session-history bug final status | Handoff started but no verified final fix appears in the inspected evidence. | `entities/projects/prometheus-mobile-app.md` after verified fix | `audit/chats/transcripts/mobile_mpospgxq_h0ufra.md:7-18`; `Brain/business-candidates/2026-05-28/candidates.jsonl:6` |

## Proposals Generated
| # | Type | Title | Priority | ID |
|---|------|-------|----------|----|
| - | - | - | - | None — this scheduled Dream was constrained not to create proposals or external side effects unless explicitly instructed, and the proposal queue already contains relevant pending items. |

## Existing Proposal / Task Queue Watch
| Item | Status | Dream Read |
|------|--------|------------|
| `prop_1779856741971_7e89fa` — Unblock paused mobile drawer repair by fixing proposal executor model routing | pending / critical action | Still relevant if the old repair task remains unresolved, but some mobile fixes were later manually/Codex applied; verify current status before running. |
| `prop_1779856851809_c04fe4` — Fix Telegram command/dev-source approval callbacks returning approval-not-found | pending / high code_change | Still relevant. Raul hit approval-not-found during urgent mobile repair; approval reliability remains a trust issue. |
| `prop_1779856931521_7ba473` — Build source-grounded mobile Settings parity matrix | pending / high review | Still relevant. Mobile Settings parity remains an active product gap. |
| `prop_1779597962515_d0a9a9` — Add agent-facing visual fallback to browser_scroll_collect | pending / high code_change | Still relevant to visual-first automation, lower priority than mobile/approval/voice reliability. |
| `prop_1779598003074_116857` — Unify screenshot preview contracts across voice, delivery, and mobile | pending / high code_change | Still relevant to voice/mobile media trust. |
| `prop_1779601869403_9769fb` — Scout Prometheus Locked Work Mode for Windows | pending / high review | Product-differentiator review remains valuable but less urgent than active regressions. |
| `prop_1779601939373_5a50fa` — Verify mobile voice always-listening and wake-phrase fixes | pending / high review | Now reinforced by realtime/mobile voice concerns. |
| `prop_1779603130481_2c9fa3` — Fix duplicated final assistant text in Prometheus CLI output | pending / high code_change | Isolated CLI quality bug; lower urgency than mobile/proposal/voice. |

## Skill Gardener Review
| Skill/Workflow | Evidence | Current Skill Inspected | Outcome |
|----------------|----------|-------------------------|---------|
| `prometheus-creative-mode` / Prometheus promo pacing | Raul correction after Composite Tools clip | yes | Added pacing/readability known-issue guardrail resource. |
| `hyperframes-media` | HyperFrames audio/captions/avatar research | Thought already updated | Accepted existing trigger/metadata update; no duplicate edit. |
| `desktop-automation-playbook` | Claude terminal wrong-window/approval-loop failure | Thought already updated | Accepted existing example resource; no duplicate edit. |
| Composite tools runtime / `codex_dev_debug_handoff` | Real composite test + Raul runtime-design request | not source-verified in Dream | Deferred to source verification; no proposal created due scheduled-run constraint. |
| HyperFrames export verification recovery | FFmpeg/policy/Creative `__name` blockers | not edited | Deferred; likely needs broader tooling/source review, not just skill prose. |

## Skill Updates Applied
| Skill | Resource/Manifest | Change Made | Evidence |
|-------|-------------------|-------------|----------|
| `prometheus-creative-mode` | `references/known-issues/promo-pacing-readability-2026-05-28.md` | Added reusable guardrail: slower readable holds, voiceover-first timing, 2–6 word caption groups, fewer rapid cuts, and QA for reading time. | `audit/chats/transcripts/f94f6eef-f3e6-4894-9425-72c42b7a0249.md:26-33`; `Brain/thoughts/2026-05-28/21-42-thought.md:47-50` |

## Thought Skill Updates Audited
| Skill | Thought Change | Dream Decision | Evidence |
|-------|----------------|----------------|----------|
| `hyperframes-media` | Thought 1 added overlay triggers/metadata for HyperFrames audio/captions/avatar/TTS/transcription/background-removal routing. | accepted | `Brain/thoughts/2026-05-28/21-42-thought.md:64-67` |
| `desktop-automation-playbook` | Thought 2 added example resource for Claude terminal approval-loop recovery. | accepted | `Brain/thoughts/2026-05-28/09-55-thought.md:49-55` |

## Opportunity Incubation
| Seed | Surfaces Inspected | What The Dream Learned | Outcome |
|------|--------------------|------------------------|---------|
| Composite tools as first-class runtime | `Brain/thoughts/2026-05-28/21-42-thought.md`; `memory/2026-05-28-intraday-notes.md`; composite test transcript summary | The product direction is strong and uniquely Prometheus-native, but current proof shows saved sequences must evolve into typed, observable, fallback-capable workflows. | Watch item; source verification next. |
| Mobile reliability/status sweep | Mobile thought/candidates, entity history, pending proposals | Mobile docs now exist, but new-chat/history, Settings parity, drawer task state, and voice reliability are interdependent. | Watch item; read `self/16-mobile-app.md` before any mobile action. |
| Voice/realtime repair verification | Claude terminal thought + intraday notes | UI approval loops are now less useful than direct source/runtime verification. | Watch item; verify current source/gateway/audio behavior. |
| HyperFrames promo production lane | Composite clip + audio/avatar research | Future explainers should be voiceover-first, readable, captioned, and source-backed, not just visually dense. | Skill resource added. |
| Coding-assistant terminal watch workflow | Desktop thought + skill episodes | Timer/key-loop approvals are brittle; a dedicated bounded watch/handoff workflow or composite could reduce frustration. | Deferred design seed. |

## Deferred Ideas
| Idea | Reason Deferred | Confidence | From |
|------|-----------------|------------|------|
| Create a source-edit/review proposal for composite runtime verification/completion | Scheduled Dream constraint; source verification not performed here and Codex may already have changed code. | high | Thought 1 |
| Create a realtime voice fix proposal | Needs current source/diff/runtime inspection first; Claude may have partial edits. | high | Thought 2 |
| HyperFrames export verification recovery skill/source fix | Failures span policy, Creative QA, and CLI environment; requires dedicated review. | medium | Thought 1 / skill episodes |
| Proposal queue cleanup/status reconciliation | Valuable but Dream should not mutate proposals; pending queue is already tracked. | medium | Thought 1 |
| Dedicated coding-assistant terminal watch composite | Useful, but should be designed after composite runtime capabilities are verified. | high | Thought 2 |

## Tomorrow's Watch Items
- Verify composite-tools runtime source state after Raul’s “let’s do this”/Codex implementation block; update self docs/entity memory only after source/build evidence.
- Before any mobile edit, read `workspace/self/16-mobile-app.md`; then verify mobile new-chat/session-history, drawer task status, and mobile Settings parity proposal state.
- Verify realtime voice route/session behavior directly: does realtime mode say the right status and transcribe, and did Claude’s claimed fix ever land/build/restart?
- Treat further Claude/Codex terminal approval loops as bounded: exact-window verification, one or two distinct safe attempts, then stop/report instead of repeating keypresses.
- For Prometheus promos/explainers, use the new Creative pacing guardrail and prefer voiceover-first/captioned HyperFrames workflow.
- Watch pending proposals `prop_1779856741971_7e89fa`, `prop_1779856851809_c04fe4`, and `prop_1779856931521_7ba473` first; they map to current mobile/approval trust issues.
---
