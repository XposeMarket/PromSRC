# Dream - 2026-05-23
_Generated: 2026-05-24 00:41 local_
_Thoughts synthesized: 4_

## Day Summary
2026-05-23 was a product shakedown day. Raul was not just using Prometheus; he was pressing on the places where it should feel real: CLI streaming rhythm, mobile voice latency, screenshot previews, desktop control, browser collection, restart recovery, skill routing, and whether Prometheus can keep working when the computer is locked. The day felt like a lab bench: lots of tools open, several rough edges exposed, and a surprising amount of actual product direction hiding inside the tests.

The strongest completed momentum was in reusable workflow and mobile/voice reliability. Product carousel output became a real skill-backed pattern. Interactive visual skills got discoverability overlays. Desktop automation got a hard stress-test resource. Mobile voice received late Codex fixes for xAI/Grok idle autosend, wake-phrase runtime tool exposure, and duplicate transcript collapse. The system is clearly becoming more capable, but the day also showed that its recovery and preview contracts need to be cleaner.

The clearest unfinished technical threads are browser visual fallback and screenshot wrapper parity. Raul’s correction on browser screenshots was sharp: fallback screenshots should go into Prom’s own vision context, not to the user by default. Likewise, screenshot tools should behave like wrappers, not three subtly different products depending on whether the worker, voice, or mobile path fired. I wonder if these two threads are actually the same instinct from Raul: visual evidence should be available to Prometheus as a working sense, while user-facing previews should be deliberate and consistent.

The most strategic idea was Locked Work Mode for Windows. The important part is not unlocking the personal desktop; it is giving Prometheus a separate, safe workbench while Raul’s real machine is locked or unavailable. I wonder if this becomes one of the clearest Prometheus differentiators: not another terminal agent, but a Windows-native operating layer that can keep moving work forward while respecting approvals and security.

## Memory Updates Applied
| Item | File | Recall Trigger | Future Behavior | Staleness Risk | Change Made | Evidence |
|------|------|----------------|-----------------|----------------|-------------|---------|
| None | - | - | - | - | None - no new items passed the memory gate tonight. The main durable voice-agent rule was already present in `MEMORY.md:48`. | `MEMORY.md:48`; `Brain/thoughts/2026-05-23/14-03-thought.md:70-74` |

## Business Reconciliation
| Candidate | Destination | Change Made | Evidence |
|-----------|-------------|-------------|---------|
| Windows command lane / self docs / browser visual fallback / visual skill overlays / product carousel / Locked Work Mode | `entities/projects/prometheus.md` | skipped as already present before Dream write | `entities/projects/prometheus.md`; `Brain/business-candidates/2026-05-23/candidates.jsonl:1-2,5,8-9,11` |
| Mobile/PWA gateway-restart recovery | `entities/projects/prometheus-mobile-app.md` | skipped as already present before Dream write | `entities/projects/prometheus-mobile-app.md`; `Brain/business-candidates/2026-05-23/candidates.jsonl:3` |
| Mobile xAI/Grok always-listening autosend idle fallback | `entities/projects/prometheus-mobile-app.md` | appended event | `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:17-18` |
| Mobile voice wake-phrase runtime tool exposure | `entities/projects/prometheus-mobile-app.md` | appended event | `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:19-21` |
| Duplicate mobile always-listening transcript collapse | `entities/projects/prometheus-mobile-app.md` | appended event | `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:22-23` |
| Medium-confidence xAI/Grok trace leak, Background Desktop details, queued-prompt interruptions | deferred | skipped pending source-backed review | `Brain/business-candidates/2026-05-23/candidates.jsonl:6-7,12-13` |

**Business report:** Brain\business-reconciliation\2026-05-23\report.md written

## Business Updates Needing Review
| Candidate | Reason Review Is Needed | Suggested Destination | Evidence |
|-----------|-------------------------|-----------------------|---------|
| Grok/xAI reasoning/tool trace leak | medium confidence; likely real but root could be provider config, stream parser, or mobile renderer | `entities/vendors/xai.md` or source proposal after verification | `Brain/business-candidates/2026-05-23/candidates.jsonl:6` |
| Prom Background Desktop / unlock helper details | architecture-sensitive and partly speculative; should become a review artifact before durable memory | Prometheus project proposal/review | `Brain/business-candidates/2026-05-23/candidates.jsonl:7,13` |
| Queued prompts/restart reliability interruptions | medium confidence and mixed with deliberate Raul testing | runtime reliability review/source scout | `Brain/business-candidates/2026-05-23/candidates.jsonl:12` |

## Proposals Generated
| # | Type | Title | Priority | ID |
|---|------|-------|----------|----|
| 1 | src_edit | Add agent-facing visual fallback to browser_scroll_collect | high | prop_1779597962515_d0a9a9 |
| 2 | src_edit | Unify screenshot preview contracts across voice, delivery, and mobile | high | prop_1779598003074_116857 |
| 3 | task_trigger | Verify mobile voice parity after Codex fixes | high | prop_1779598057722_c9f95c |
| 4 | feature_addition | Scout Locked Work Mode for Windows as a product track | medium | prop_1779598079761_88cb36 |

## Skill Gardener Review
| Skill/Workflow | Evidence | Current Skill Inspected | Outcome |
|----------------|----------|-------------------------|---------|
| `ai-surface-smoke-research` | `Brain/skill-episodes/2026-05-23/episodes.jsonl:12-15,19-22`; `Brain/thoughts/2026-05-23/07-54-thought.md:54-57`; `Brain/thoughts/2026-05-23/14-03-thought.md:54-57` | yes | Thought updates accepted: target-closed recovery example and exact “do/run the AI smoke test” triggers are useful and scoped. No extra Dream write. |
| `desktop-automation-playbook` | `Brain/skill-episodes/2026-05-23/episodes.jsonl:23`; `Brain/skill-gardener/2026-05-23/live-candidates.jsonl:34-36` | yes | Thought/live update accepted: v4.4.0 overlay/resource captures real desktop stress-test findings. |
| `product-carousel-builder` | `Brain/skill-episodes/2026-05-23/episodes.jsonl:7-9` | yes | Accepted: new skill is discoverable, active, and has an Amazon example. |
| `dev-debugging` | `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:17-23`; `live-candidates.jsonl:25-33` | yes | auto-updated manifest triggers for “pass it onto Codex,” “tell Codex,” “same/current Codex chat,” and related handoff phrases. |
| Runtime prompt visual template | `Brain/thoughts/2026-05-23/01-38-thought.md:43,78` | yes (`interactive-visuals`, `html-interactive`) | deferred; two asks are promising but not enough to add a template tonight. |
| Voice/mobile latency workflow skill | `Brain/thoughts/2026-05-23/14-03-thought.md:47-52,58-61` | no dedicated skill found | deferred; better handled as source verification/proposals first. |

## Thought Skill Updates Audited
| Skill | Thought Change | Dream Decision | Evidence |
|-------|----------------|----------------|---------|
| `ai-surface-smoke-research` | Added interrupted browser target-closed recovery example | accepted | `Brain/thoughts/2026-05-23/07-54-thought.md:54-57`; `skill_inspect(ai-surface-smoke-research)` |
| `ai-surface-smoke-research` | Added exact triggers `do the ai smoke test` and `run the ai smoke test` | accepted | `Brain/thoughts/2026-05-23/14-03-thought.md:54-57`; `skill_inspect(ai-surface-smoke-research)` |
| `desktop-automation-playbook` | Added real desktop stress-test example/resource and manifest trigger/description refinements | accepted | `Brain/skill-episodes/2026-05-23/episodes.jsonl:23`; `skill_inspect(desktop-automation-playbook)` |
| `product-carousel-builder` and related skills | Created product carousel skill and added routing notes/resources to web/browser/Browse.sh skills | accepted | `Brain/skill-episodes/2026-05-23/episodes.jsonl:7-9`; `skill_inspect(product-carousel-builder)` |
| `dev-debugging` | No Thought update; Dream detected missing trigger activation during repeated Codex handoffs | modified/applied by Dream | `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:17-23`; `skill_inspect(dev-debugging)` |

## Skill Updates Applied
| Skill | Resource/Manifest | Change Made | Evidence |
|-------|-------------------|-------------|---------|
| `dev-debugging` | `skill.json` overlay | Added handoff triggers: `pass it onto codex`, `tell codex`, `let codex know`, `same codex chat`, `current codex chat`, `codex follow-up`, `send this to codex`, `hand off to codex`; set overlay ownership/toolBinding metadata. | `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:17-23`; `skill_inspect(dev-debugging)` |
| `ai-surface-smoke-research` | existing resource/manifest | Accepted earlier Thought-applied recovery example and trigger additions; no new Dream write. | `Brain/thoughts/2026-05-23/07-54-thought.md:54-57`; `Brain/thoughts/2026-05-23/14-03-thought.md:54-57` |
| `desktop-automation-playbook` | existing resource/manifest | Accepted earlier stress-test example/resource; no new Dream write. | `Brain/skill-episodes/2026-05-23/episodes.jsonl:23` |
| `product-carousel-builder` | existing skill/resources | Accepted new product-carousel skill and Amazon example; no new Dream write. | `Brain/skill-episodes/2026-05-23/episodes.jsonl:7-9` |

## Opportunity Incubation
| Seed | Surfaces Inspected | What The Dream Learned | Outcome |
|------|--------------------|------------------------|---------|
| Browser visual fallback into Prom vision context | `src/gateway/browser-tools.ts:5350-5453,5918-5948`; `src/gateway/agents-runtime/subagent-executor.ts:11437-11463`; `src/gateway/routes/chat.router.ts:2680-2885` | Current tools already have screenshot cache/injection primitives, but `browser_scroll_collect` lacks explicit fallback controls and executor forwarding. | proposed: `prop_1779597962515_d0a9a9` |
| Screenshot preview wrapper parity | `src/gateway/delivery-router.ts`; `src/gateway/delivery-screenshot.ts`; `src/gateway/routes/chat.router.ts`; `web-ui/src/mobile/mobile-pages.js`; `web-ui/src/pages/ChatPage.js` | The system now emits both delivery and vision events, but contracts/UI dedupe need intentional unification so wrapper paths feel identical. | proposed: `prop_1779598003074_116857` |
| Mobile voice fixes from Codex | `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:17-23`; source grep/read around voice tools | Evidence says Codex fixed xAI idle autosend, wake phrase tool exposure, and duplicate collapse; needs a focused verification pass. | proposed: `prop_1779598057722_c9f95c` |
| Locked Work Mode for Windows | `Brain/thoughts/2026-05-23/07-54-thought.md:77-90`; `entities/projects/prometheus.md` | Strong product seed but architecture-sensitive; best next step is a review artifact, not code. | proposed: `prop_1779598079761_88cb36` |
| CLI duplicate assistant final text | `Brain/thoughts/2026-05-23/01-38-thought.md:48,76,84` | Verified as user-reported, but no current CLI source surface was confidently identified before proposal quality gate. | deferred: needs source scouting |
| xAI/Grok reasoning/tool trace leak | `Brain/thoughts/2026-05-23/19-25-thought.md:54,93-104`; `grep_source` for xAI/reasoning/tool_choice | Likely real provider/mobile issue, but exact source root needs deeper adapter/renderer inspection. | deferred |

## Deferred Ideas
| Idea | Reason Deferred | Confidence | From |
|------|-----------------|-----------|------|
| Runtime prompt transparency HTML template | Useful but only two asks; no urgent skill gap after visual metadata overlays. | medium | Thought 2 |
| Matching-skills observability UX | Plausible UX improvement, but not source-scouted enough for execution-ready proposal. | medium | Thought 2 |
| Queued prompts/restart continuation reliability audit | Real signal, but mixed with deliberate testing and needs broader source scouting. | medium | Thought 3 |
| CLI stream QA checklist | Repeated CLI feel testing, but not enough to create a new skill/proposal tonight. | medium | Thought 4 |
| xAI/Grok reasoning/tool trace hardening | Needs exact source-root verification beyond broad grep. | high signal / deferred | Thought 1 |
| Blank pending proposal cleanup | Workspace `proposals/pending` had no real pending proposal file; audit stale blank proposal was outside current pending surface. | medium | Thoughts 1-3 |

## Tomorrow's Watch Items
- Watch whether Raul tests mobile voice again after the Codex fixes; verify xAI/Grok autosend, wake phrase changes, and duplicate collapse with real phone behavior.
- Watch whether screenshot previews still feel inconsistent after voice_send_screenshot or delivery sends.
- Watch for another browser_scroll_collect failure or weak extraction case; if approved, implement agent-facing visual fallback.
- Watch whether Locked Work Mode becomes a strategic product track or stays an exploratory idea.
- Watch CLI duplicate output / Claude Code-like stream polish if Raul keeps testing the CLI feel.
