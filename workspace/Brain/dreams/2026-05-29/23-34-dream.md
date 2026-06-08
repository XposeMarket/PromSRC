---
# Dream - 2026-05-29
_Generated: 2026-05-29 23:34 local / completed after compaction_
_Thoughts synthesized: 4_

## Day Summary
2026-05-29 was the day Prometheus felt faster and immediately got held to a higher standard. Raul noticed the prompt-caching / model-routing / Opus 4.8 work in the only way that matters: chat felt almost instant, roughly under 20 seconds, and he immediately started asking for tangible things — model upgrades, HyperFrames video, quick files, desktop handoffs, and mobile voice fixes.

The big positive product signal is momentum. Prometheus was updated toward Claude Opus 4.8, the gateway was restarted, and the active model reportedly switched over. Raul’s reaction was genuinely excited. But the day also exposed the difference between “the workflow completed” and “the result is trustworthy.” Codex-reported source changes are useful evidence, not proof. A rendered MP4 with lint/inspect/render success can still freeze in real playback. A desktop screenshot target can look clickable and still be the wrong control. The next quality bar is verification that matches the user-visible outcome.

HyperFrames was the loudest miss. Prometheus created `hyperframes-opus-4-8-prometheus/` and reported successful checks, but Raul immediately saw the Opus 4.8 video freeze after the first frame/transition. That should stay marked as an unfinished asset until the actual exported MP4 is frame/motion verified. I added a no-ship HyperFrames CLI guardrail so future video work does not confuse static CLI success with playback success.

Desktop automation also crossed a threshold. The new canonical `window_id` model feels like a real safety upgrade: list windows, get exact state/screenshot/text, then act window-scoped. Raul’s live test exposed rough edges — Windows Terminal metadata bounds at `0x0`, cold OCR cache, WGC helper missing — but the direction is right. The older failure mode is still dangerous: Claude/Codex terminal tab strips and numbered overlays must be treated as labels to inspect, not permission to click. Existing desktop skill resources now capture the terminal input-line and close-tab guardrails.

Mobile voice had concrete progress late in the day. Two fixes landed in `web-ui/src/mobile/mobile-pages.js`: opening/restoring the mobile voice page should no longer request mic permission automatically, and closing the inline chat voice panel with X should release Always Listening/warm mic resources immediately. The self-doc update for those fixes was blocked by fast-edit scope, so that is a documentation debt to pay the next time mobile source docs are touched.

## Memory Updates Applied
| Item | File/Skill | Recall Trigger | Future Behavior | Staleness Risk | Change Made | Evidence |
|------|------------|----------------|-----------------|----------------|-------------|----------|
| Desktop automation v4.4.0 evaluation | `MEMORY.md` / `project_memory` | Debugging/evaluating desktop automation, window model, screenshots, OCR, WGC | Prefer canonical `window_id` flow and screenshot/capture truth when metadata conflicts; remember Terminal `0x0` bounds/OCR/WGC rough edges. | Medium; tool implementation may fix these rough edges. | Added durable project memory. | `audit/chats/transcripts/mobile_mprdadv3_x1xvqs.md:1-29`; `memory/2026-05-29-intraday-notes.md:32-34` |
| HyperFrames Opus 4.8 promo status | `MEMORY.md` / `project_memory` | Referencing/reusing `hyperframes-opus-4-8-prometheus/` or Opus 4.8 promo assets | Do not present/use as finished until actual MP4 motion/playback QA verifies transitions; original export froze. | Medium; stale after verified repair/export. | Added durable project memory. | `audit/chats/transcripts/mobile_mpr4mp2m_qat6y4.md:30-61`; `Brain/skill-episodes/2026-05-29/episodes.jsonl:4-5` |
| Mobile voice fixes + doc debt | `MEMORY.md` / `project_memory` | Future mobile voice debugging or mobile doc/source edits | Remember mic permission is explicit-action only; inline voice X should release warm mic. Update `self/16-mobile-app.md` when edit scope permits. | Low unless later mobile voice behavior changes. | Added durable project memory. | `Brain/skill-episodes/2026-05-29/episodes.jsonl:15-16` |
| Exported MP4 playback QA | `hyperframes-cli` skill resource `references/known-issues/exported-mp4-playback-freeze-2026-05-29.md` | HyperFrames render/export/preview/final video delivery | No success claim from lint/validate/inspect/render alone; sample actual exported MP4 frames and verify motion across scene boundaries. | Low; remains useful until automated frozen-frame QA exists. | Added focused guardrail resource. | `audit/chats/transcripts/mobile_mpr4mp2m_qat6y4.md:30-61`; `Brain/skill-episodes/2026-05-29/episodes.jsonl:4-5` |
| Claude terminal targeting/close-tab guardrails | Existing `desktop-automation-playbook` resources from same-day Thoughts | Desktop Claude/Codex terminal focus/Enter/approval work | Target prompt/input line, avoid tab/header/Close controls, treat numbered overlays as labels to inspect. | Low; UI can change, principle remains. | Accepted Thought-applied skill updates; no duplicate write. | `Brain/thoughts/2026-05-29/00-19-thought.md:48-53`; `Brain/thoughts/2026-05-29/06-34-thought.md:54-60` |
| HyperFrames CLI trigger expansion | Existing `hyperframes-cli` manifest overlay from Thought | `npx hyperframes`, ffmpeg/ffprobe/render/inspect failures, exported frame verification | Retrieval for CLI troubleshooting is broader and more accurate. | Low. | Accepted Thought-applied overlay; added separate playback guardrail. | `Brain/thoughts/2026-05-29/12-51-thought.md:78-80` |

## Business Reconciliation
| Candidate | Destination | Change Made | Evidence |
|-----------|-------------|-------------|----------|
| Codex-reported Claude Opus 4.8 support | `entities/projects/prometheus.md` | appended medium-confidence event | `Brain/business-candidates/2026-05-29/candidates.jsonl:1`; `memory/2026-05-29-intraday-notes.md:2-8` |
| Gateway restarted and current primary model switched to Opus 4.8 | `entities/projects/prometheus.md` | appended high-confidence event | `Brain/business-candidates/2026-05-29/candidates.jsonl:2`; `audit/chats/transcripts/mobile_mpqas09c_gk2x5l.md:37-77` |
| HyperFrames Opus 4.8 showcase request/project remains unresolved due playback freeze | `entities/projects/prometheus.md` | appended high-confidence event | `Brain/business-candidates/2026-05-29/candidates.jsonl:3,6`; `audit/chats/transcripts/mobile_mpr4mp2m_qat6y4.md:30-61` |
| Haiku 4.5 `set_current_model` alias failure | `entities/projects/prometheus.md` | appended high-confidence event | `Brain/business-candidates/2026-05-29/candidates.jsonl:4`; `memory/2026-05-29-intraday-notes.md:15-25` |
| Perceived latency/prompt-cache win | `entities/projects/prometheus.md` | appended medium-confidence event | `Brain/business-candidates/2026-05-29/candidates.jsonl:5`; `audit/chats/transcripts/mobile_mpr4mp2m_qat6y4.md:7-29` |
| Quick landing-page/file-edit smoke tests | `entities/projects/prometheus.md` | appended medium-confidence event | `Brain/business-candidates/2026-05-29/candidates.jsonl:7`; `audit/chats/transcripts/mobile_mpr9zb3l_lkbsyi.md:7-139` |
| Desktop automation v4.4.0 live evaluation | `entities/projects/prometheus.md` | appended high-confidence event | `Brain/business-candidates/2026-05-29/candidates.jsonl:8`; `memory/2026-05-29-intraday-notes.md:32-34` |
| Mobile keyboard/composer Codex plan + stalled Claude handoff | `entities/projects/prometheus-mobile-app.md` | appended high-confidence event | `Brain/business-candidates/2026-05-29/candidates.jsonl:9`; `audit/chats/transcripts/mobile_mprdadv3_x1xvqs.md:30-120` |
| Mobile voice permission-on-open fix | `entities/projects/prometheus-mobile-app.md` | appended high-confidence event | `Brain/skill-episodes/2026-05-29/episodes.jsonl:15` |
| Mobile inline voice X releases mic fix | `entities/projects/prometheus-mobile-app.md` | appended high-confidence event | `Brain/skill-episodes/2026-05-29/episodes.jsonl:16` |

**Business report:** `Brain/business-reconciliation/2026-05-29/report.md` written.

## Business Updates Needing Review
| Candidate | Reason Review Is Needed | Suggested Destination | Evidence |
|-----------|-------------------------|-----------------------|----------|
| Opus 4.8 implementation details | Codex reported implementation/build, but Dream did not inspect source diff or run live model-route verification. | project entity/source docs after verification | `memory/2026-05-29-intraday-notes.md:2-8`; `Brain/thoughts/2026-05-29/16-07-thought.md:81-86` |
| Haiku 4.5 alias fix | Codex investigated but no source patch/live verification was confirmed in Dream. | source-review/code-change lane | `audit/chats/transcripts/mobile_mpqzys1p_iobapk.md:1-55`; `Brain/thoughts/2026-05-29/06-34-thought.md:82,91` |
| HyperFrames Opus 4.8 video repair | Asset may include `final-fixed.mp4`, but Dream did not verify actual MP4 motion; original user-visible export failed. | project entity after verified repair/export | `hyperframes-opus-4-8-prometheus/`; `audit/chats/transcripts/mobile_mpr4mp2m_qat6y4.md:51-61` |
| Mobile self docs | Mobile voice fixes could not update `self/16-mobile-app.md` due dev-edit scope. | self docs during next approved mobile source/doc edit | `Brain/skill-episodes/2026-05-29/episodes.jsonl:15` |

## Proposals Generated
| # | Type | Title | Priority | ID |
|---|------|-------|----------|----|
| - | - | - | - | None — scheduled Dream constraints explicitly say not to create proposals or external side effects unless instructed. |

## Existing Proposal / Task Queue Watch
| Item | Status / Why It Still Matters |
|------|-------------------------------|
| Mobile source/doc hygiene | Voice fixes landed, but self docs remain behind; future mobile edits should update `self/16-mobile-app.md`. |
| Haiku/model alias mapping | Live `set_current_model` failed for Haiku 4.5; source fix should be verified or implemented. |
| HyperFrames video QA/repair | User-visible frozen video is a direct quality miss and should be repaired before reuse. |
| Desktop AI-app handoff composite | Repeated Claude/Codex handoffs remain useful but fragile around file dialogs, Customize/search overlays, and exact chat/app state. |
| Pending older mobile/proposal reliability queue | Prior Dream’s mobile drawer, approval callback, Settings parity, voice verification, and proposal-executor reliability items are still worth status checking before piling on new proposals. |

## Skill Gardener Review
| Skill/Workflow | Evidence | Current Skill Inspected | Outcome |
|----------------|----------|-------------------------|---------|
| `desktop-automation-playbook` | Claude terminal tab-strip and Close Tab misclick corrections | yes via Thoughts/skill episodes | Accepted existing input-targeting/close-tab resource updates; no duplicate edit. |
| `hyperframes-cli` | Opus 4.8 render hit FFmpeg/inspect/policy issues and user-visible frozen playback | yes | Kept Thought trigger expansion; added focused exported-MP4 playback freeze guardrail. |
| `hyperframes` / creative video QA | Static checks missed real playback freeze | partially | Deferred source/tooling proposal; skill guardrail is enough for scheduled Dream. |
| `landing-page-blueprint` / quick file workflow | Quick landing-page request returned inline HTML once when Raul wanted a file | no direct mutation | Deferred; likely add a small “actual file when testing components” note later. |
| `desktop AI handoff` composite | Claude handoff stalled on file picker/Customize/search overlay | no mutation | Deferred design seed; needs modal-aware workflow, not just prose. |
| `dev-debugging` provider model update example | Opus 4.8 release update workflow worked well | no mutation | Deferred until source/model route is independently verified. |

## Skill Updates Applied
| Skill | Resource/Manifest | Change Made | Evidence |
|-------|-------------------|-------------|----------|
| `hyperframes-cli` | `references/known-issues/exported-mp4-playback-freeze-2026-05-29.md` | Added no-ship guardrail requiring actual exported MP4 frame/motion playback QA after render and before success claims. | `audit/chats/transcripts/mobile_mpr4mp2m_qat6y4.md:30-61`; `Brain/skill-episodes/2026-05-29/episodes.jsonl:4-5`; `Brain/thoughts/2026-05-29/06-34-thought.md:18-19` |

## Thought Skill Updates Audited
| Skill | Thought Change | Dream Decision | Evidence |
|-------|----------------|----------------|----------|
| `desktop-automation-playbook` | Added Claude terminal input targeting example. | accepted | `Brain/thoughts/2026-05-29/00-19-thought.md:48-53` |
| `desktop-automation-playbook` | Added numbered-overlay / Close Tab guardrail. | accepted | `Brain/thoughts/2026-05-29/06-34-thought.md:54-56` |
| `hyperframes-cli` | Expanded manifest triggers/categories around `npx hyperframes`, render/inspect, FFmpeg/ffprobe, and exported frame verification. | accepted and supplemented with known-issue resource | `Brain/thoughts/2026-05-29/12-51-thought.md:78-80` |

## Opportunity Incubation
| Seed | Surfaces Inspected | What The Dream Learned | Outcome |
|------|--------------------|------------------------|---------|
| Repair `hyperframes-opus-4-8-prometheus/` | Thoughts, skill episodes, project directory listing | The asset exists but original export failed user-visible playback; `final-fixed.mp4` may exist but is unverified. | High-priority watch item; no action under scheduled constraint. |
| Source-verify Opus 4.8 support | Thoughts, intraday notes, business candidates | Codex report is promising but should not be treated as source truth until diff/live route/build are inspected. | Watch item. |
| Fix/verify Haiku 4.5 alias mapping | Thought 3 + intraday notes | Manual Settings and `set_current_model` differ; likely alias normalization bug. | Watch item for source review. |
| Mobile keyboard/composer implementation | Thought 4 + Codex plan | A concrete plan exists, but handoff stalled before implementation. | Future mobile source proposal/work item; read `self/16-mobile-app.md` first. |
| Desktop AI-app handoff composite | Desktop transcripts + skill episodes | New window tools make this feasible, but modal/start-state handling is the hard part. | Incubate; not ready for scheduled mutation. |
| Quick static demo file workflow | Landing page transcripts | Raul uses quick files as UI/file-edit smoke tests; default should be actual workspace file when phrased as “create a quick landing page” in testing context. | Future skill/workflow note. |

## Deferred Ideas
| Idea | Reason Deferred | Confidence | From |
|------|-----------------|------------|------|
| Create a code_change proposal for automatic frozen-frame/video playback QA | Scheduled Dream constraint and source/tooling scope need inspection first. | high | Thoughts 3/4 |
| Create a code_change proposal for Haiku 4.5 alias mapping | Needs source verification/current diff inspection first. | high | Thought 3 |
| Repair the Opus 4.8 HyperFrames video | Action would require video QA/render side effects; defer to explicit user/task lane. | high | Thoughts 1/3/4 |
| Update `self/16-mobile-app.md` with mobile voice fixes | Requires approved source/doc edit scope. | high | skill episodes 15-16 |
| Create a desktop AI-app handoff composite | Needs product design around modal recovery and proof semantics. | high | Thought 4 |
| Add quick static demo file workflow/skill resource | Useful but lower priority than video/mobile/model reliability. | medium | Thought 4 |
| Provider-model-update dev-debugging example | Better after Opus 4.8 source route is verified. | medium | Thought 1 |

## Tomorrow's Watch Items
- Verify `hyperframes-opus-4-8-prometheus/final-fixed.mp4` or repair/export a new MP4, then sample actual frames across transitions before presenting it.
- Source-verify Claude Opus 4.8 support and current live route before relying on the exact Codex-reported implementation details.
- Inspect/fix Haiku 4.5 model alias mapping so `set_current_model` uses the correct dated model ID path instead of `claude-haiku-4.5`.
- Before any mobile source work, read `self/16-mobile-app.md`; update it with the two mobile voice fixes when scope allows.
- If implementing the mobile keyboard/composer plan, ground it in current mobile source and preserve the new voice-mic cleanup behavior.
- Treat desktop Claude/Codex app handoffs as modal-sensitive: exact `window_id` state, text/screenshot proof, and stop on Customize/file-picker/search overlays unless a safe recovery path is visible.
- For quick landing-page/file-edit smoke tests, create an actual workspace file first unless Raul explicitly asks for inline code.
---
