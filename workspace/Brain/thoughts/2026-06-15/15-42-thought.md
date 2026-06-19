---
# Thought 1 - 2026-06-15 | Window: 2026-06-14 19:42 UTC-2026-06-15 07:42 UTC
_Generated: 2026-06-15 03:42 local_

## Summary
This window was highly active and mostly centered on Prometheus self-work from mobile: config/workspace soul cleanup, hot-restart/dev-edit reliability, and a cluster of mobile canvas/file-viewer fixes. The workspace SOUL refactor really did land: `SOUL.md` is now 61 lines, while current `src/config/soul.md` carries the new Ask-vs-Decide tool-card rule and current `prompt-context.ts` injects `[PROMETHEUS_SOUL]` into background and team subagent contexts. That closes the major “make config soul the real standard” thread, at least at source level.

The mobile canvas work also materially advanced. Current source now has a dev-only canvas path allowlist for Prometheus project-root files, `/api/canvas/diff-ranges`, scrollable text/Markdown rendering, a self-contained code tokenizer, edited-region Preview, and an `openMode:'diff'` path so end-of-turn diff cards can default to collapsed edited regions. The last tweak still needs one real mobile smoke confirmation and self-doc sync, but the artifact state matches the intended direction.

The important unresolved bug is the dev-edit completion-note restart loop. The current `boot.ts` wording is stronger, but the observed transcript and session audit prove that prompt wording still allowed `write_note({...})` to be emitted as assistant text rather than a real tool call. I wonder if this should be promoted from “prompt polish” to a deterministic runtime bookkeeping fix: after `prom_apply_dev_changes` succeeds, the runtime should write the completion note itself instead of depending on the restarted model’s first action.

I also wonder if the Brain skill/business classifiers are getting too eager around generic words like “proposal,” “tool,” and “provider.” Tonight’s mobile canvas/frontend episodes were mislabeled as outreach/vendor-style business workflows, which repeats the earlier X/social false-positive pattern. That is exactly the kind of quiet classification drift that can pollute skill recommendations if it is not tightened.

## Pulse Cards
```json
[
  {
    "title": "Mobile Canvas Smoke Test",
    "body": "The diff viewer landed fast. A real phone pass would catch the last rough edges.",
    "prompt": "Please verify the recent mobile canvas changes against the current source and, if possible, run a focused smoke test: markdown scroll, source file open, end-of-turn diff opens to edited regions, Preview toggles full file, and normal file pills still open full file."
  },
  {
    "title": "Reliable Restart Notes",
    "body": "The completion note issue still looks structural, not just wording.",
    "prompt": "Investigate the recent dev-edit restart completion-note issue. Verify current source and audit evidence, then propose the smallest deterministic fix so completion notes are written by runtime instead of relying on the model to call write_note after restart."
  },
  {
    "title": "Question Cards Rule Check",
    "body": "The tappable-choice rule is now in the soul. It is worth checking whether every path sees it.",
    "prompt": "Review the new Prometheus question-card rule in the current config and runtime context injection. Verify which agent modes receive it, then identify any remaining paths where Prometheus might still ask plain prose choices instead of using tappable options."
  }
]
```

## A. Activity Summary
- Today's intraday notes recorded five meaningful entries in-window: a dev-edit completion-note prompt fix that was later proven insufficient, workspace `SOUL.md` slim-down, and three mobile canvas/code-preview fixes. | evidence: `memory/2026-06-15-intraday-notes.md:2-24`
- Session `mobile_mqekusla_4wa17k` covered SOUL cleanup: Raul asked to trim workspace SOUL, corrected Prometheus for asking plain prose instead of using the question tool, approved the rewrite, and Prometheus reported `SOUL.md` 203 -> 61 lines plus migrated runbooks to MEMORY. | evidence: `audit/chats/transcripts/mobile_mqekusla_4wa17k.md:1-50`, `audit/chats/transcripts/mobile_mqekusla_4wa17k.md:138-150`, `SOUL.md:1-61`
- Session `mobile_mqeoyhea_vkjbe9` covered mobile canvas fixes: markdown/text scroll, source-file diff blocking, `sheetEl` regression, syntax highlighting, edited-region Preview, and diff-open default behavior. | evidence: `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:21-229`, `memory/2026-06-15-intraday-notes.md:10-24`
- Current source confirms the mobile canvas/diff artifacts exist: dev-root canvas allowlist, `/api/canvas/diff-ranges`, `openMode:'diff'`, `canvasTextDocHtml`, and `renderCanvasCodePreview`. | evidence: `src/gateway/routes/canvas.router.ts:128-141`, `src/gateway/routes/canvas.router.ts:4309-4376`, `web-ui/src/mobile/mobile-pages.js:4258-4311`, `web-ui/src/mobile/mobile-shell.js:1339-1343`, `web-ui/src/mobile/mobile-shell.js:1633-1763`
- Current source confirms config soul now contains the hard `ask_prometheus_questions` rule and prompt-context now injects `[PROMETHEUS_SOUL]` into background and team subagent modes. | evidence: `src/config/soul.md:56-60`, `src/gateway/prompt-context.ts:1207-1215`, `src/gateway/prompt-context.ts:1266-1275`
- The dev-edit completion-note bug is not closed: current `boot.ts` only tells the model to call `write_note`, and current `subagent-executor.ts` still reports that after restart `write_note` will complete the edit. Transcript evidence says this already failed by echoing text. | evidence: `src/gateway/boot.ts:185-206`, `src/gateway/agents-runtime/subagent-executor.ts:14875-14923`, `audit/chats/transcripts/mobile_mqe3lysx_1mel8s.md:1539-1555`, `memory/2026-06-15-intraday-notes.md:2-4`
- `audit/cron/runs` had no matched run entries for the requested UTC window using timestamp/epoch-pattern scans. | evidence: grep over `audit/cron/runs/*.jsonl` for `2026-06-15`, `2026-06-14T19..23`, and `17814`: no matches
- `Brain/skill-episodes/2026-06-15/episodes.jsonl` did not exist, but `Brain/skill-gardener/2026-06-15` contained seven live/workflow candidates from the mobile canvas session. | evidence: `Brain/skill-gardener/2026-06-15/live-candidates.jsonl:1-6`, `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:1-6`
- Active Work Ledger was read and updated from 22 to 27 rows, adding/updating entries for config/SOUL refactor, dev-edit completion-note determinism, mobile canvas file/diff viewer, question-card rule, skill metadata maintenance, and classifier false positives. | evidence: `Brain/active-work.jsonl`

## B. Behavior Quality
**Went well:**
- Prometheus kept momentum through several real mobile UI fixes and used current source/build/live-apply paths rather than leaving design talk abstract. | evidence: `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:12-20`, `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:198-229`
- The SOUL refactor was grounded in an explicit disposition map, then verified by current file state. | evidence: `audit/chats/transcripts/mobile_mqekusla_4wa17k.md:8-36`, `SOUL.md:1-61`
- The canvas source-file blocking fix preserved public-build safety by using `isPublicDistributionBuild()` and a dev-only project-root allowlist. | evidence: `src/gateway/routes/canvas.router.ts:31`, `src/gateway/routes/canvas.router.ts:128-141`
- Prometheus accepted user correction on the question-card rule and got the rule into current config soul. | evidence: `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:121-131`, `src/config/soul.md:56-60`

**Stalled or struggled:**
- The hot-restart completion-note fix was incorrectly treated as solved by prompt wording, then audit evidence showed the same failure mode: the write_note call could still render as text. | evidence: `memory/2026-06-15-intraday-notes.md:2-4`, `audit/chats/transcripts/mobile_mqe3lysx_1mel8s.md:1539-1555`
- Mobile canvas work hit several small rework loops: `sheetEl` closure bug, tokenizer markup corruption, full-file default misunderstanding, and needing `openMode` to distinguish diff-card opens from normal file opens. | evidence: `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:75-87`, `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:187-204`, `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:205-229`
- The assistant asked an A/B choice in prose right after the user had a tappable question feature, triggering explicit frustration. | evidence: `audit/chats/transcripts/mobile_mqekusla_4wa17k.md:38-50`, `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:121-131`
- Some mobile canvas investigation used wrong source/web-ui paths or brittle regex patterns before recovering. | evidence: `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:1`, `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:3`

**Tool usage patterns:**
- Dev-source apply/restart was used heavily and successfully, but the completion-note after restart remains structurally unreliable when it depends on the model emitting a tool call. | evidence: `src/gateway/agents-runtime/subagent-executor.ts:14875-14923`, `memory/2026-06-15-intraday-notes.md:2-4`
- Skill discipline was weak during the frontend/mobile UI work: gardener episodes show `skillsRead: []` and `skillsListed:false` despite multi-tool source/UI workflows. | evidence: `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:1-6`
- The business workflow detector fired on non-business dev/frontend work because it scans broad terms like `proposal`, `tool`, and `provider` across request/final/tool text. | evidence: `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:3-4`, `src/gateway/brain/skill-episodes.ts:205-221`

**User corrections:**
- Raul explicitly said plain A/B choices should use the Prometheus question card. | evidence: `audit/chats/transcripts/mobile_mqekusla_4wa17k.md:46-50`, `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:121-131`
- Raul corrected the mobile canvas desired default: end-of-turn diff opens should show edited regions first, while regular file/present opens should show full file. | evidence: `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:205-217`
- Raul signaled surprise/friction during the build/restart boundary with “What happened there...”; the restart explanation was then given. | evidence: `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:135-186`

## C. Skill And Workflow Signals
| Skill/Workflow | Signal | Possible Action | Confidence | Evidence |
|----------------|--------|-----------------|-----------|---------|
| `codex-frontend-engineer` | Mobile canvas/file-viewer fixes were frontend/mobile UI repair workflows, but gardener episodes showed no skill read/list and some path/tool mistakes. | update existing skill metadata so mobile canvas/front-end repair triggers surface it earlier | high | `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:1-6`; `skill_audit_all` flagged `description_missing_usage_guidance` |
| Dev-edit hot restart completion notes | Existing workflow relies on model calling `write_note` after restart; observed failure persisted after prompt wording. | Dream should scout deterministic runtime completion-note emission rather than a skill-only fix | high | `memory/2026-06-15-intraday-notes.md:2-4`; `src/gateway/boot.ts:185-206`; `src/gateway/agents-runtime/subagent-executor.ts:14875-14923` |
| Prometheus question-card usage | Two user corrections showed plain prose choice prompts are a recurring bad behavior. Current config soul now has the rule. | no skill update needed tonight; verify runtime/tool availability across modes | high | `audit/chats/transcripts/mobile_mqekusla_4wa17k.md:46-50`; `src/config/soul.md:56-60` |
| Mobile canvas diff viewer | Repeatable workflow emerged: inspect web-ui/mobile + canvas route, patch mobile source, sync/apply live, verify on phone. | possible future skill/resource for Prometheus mobile UI/dev-edit playbook, but defer until one more clean run | medium | `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:21-229`; `Brain/skill-gardener/2026-06-15/live-candidates.jsonl:6` |
| Skill/business classifier | Non-business frontend/source work was misclassified as outreach/vendor research. | propose classifier source/test improvement, not skill metadata | high | `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:3-4`; `src/gateway/brain/skill-episodes.ts:207-219` |

## C2. Existing Skill Maintenance
**Applied during this Thought:**
- `codex-frontend-engineer` | Updated discovery metadata via `skill_update_metadata`: description now explicitly covers web/mobile UI repair, responsive layouts, canvas/file viewers, visual UX polish, and repo/source verification; triggers now include `mobile UI fix`, `canvas UI`, `code preview UI`, `syntax highlighting UI`, `mobile canvas`, and similar frontend-repair terms. | why: 2026-06-15 mobile canvas work repeatedly matched frontend engineering but skill episodes showed no skill read/list, and `skill_audit_all(scope="codex-frontend-engineer")` flagged `description_missing_usage_guidance`. | evidence: `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:1-6`; `skill_audit_all codex-frontend-engineer: score 90, issue description_missing_usage_guidance` | verification: `skill_update_metadata` returned quality score 100; `skill_read codex-frontend-engineer` showed the updated description/required tools.

**Deferred for Dream review:**
- Mobile canvas/dev-edit UI playbook | Deferred because an existing frontend skill now covers discovery, and a new Prometheus-mobile-specific skill would be premature until the next smoke pass confirms the full workflow. | evidence: `Brain/skill-gardener/2026-06-15/live-candidates.jsonl:6`
- Skill/business classifier tightening | Deferred because it is source behavior, not low-risk skill metadata. Needs source-grounded tests and probably a proposal/code-change lane. | evidence: `src/gateway/brain/skill-episodes.ts:205-221`; `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:3-4`

## D. Business Candidates
| Candidate | Destination | Action | Confidence | Evidence |
|-----------|-------------|--------|-----------|---------|
| - | - | - | - | No high/medium-confidence company/entity facts appeared. The “businessContext” hits in gardener files were false positives from dev/frontend wording, not real business events. |

**Business candidate JSONL:** Brain\business-candidates\2026-06-15\candidates.jsonl not needed

## E. Memory Candidates
| Item | Target | Recall Trigger | Future Behavior | Staleness Risk | Confidence | Evidence |
|------|--------|----------------|-----------------|----------------|-----------|---------|
| - | - | - | - | - | - | No new durable memory candidate is needed from Thought. The question-card rule is already present in USER context and current `src/config/soul.md`; the SOUL refactor is already logged in intraday notes and verified by file state. |

## F. Opportunity Seeds
| Seed | Why It Matters | Suggested Scouting Surface | Confidence | Evidence |
|------|----------------|----------------------------|-----------|---------|
| Deterministic dev-edit completion-note emission | Current hot-restart prompt wording is not reliable; completion bookkeeping should not depend on model behavior after restart. | `src/gateway/agents-runtime/subagent-executor.ts`, `src/gateway/lifecycle`, `src/gateway/boot.ts`, intraday note writer path | high | `memory/2026-06-15-intraday-notes.md:2-4`; `audit/chats/transcripts/mobile_mqe3lysx_1mel8s.md:1539-1555`; `src/gateway/boot.ts:185-206` |
| Mobile canvas smoke + self-doc sync | The user-facing feature is mostly implemented, but the last `openMode` fix has no observed user confirmation and `self/16-mobile-app.md` is stale since 2026-06-05. | `web-ui/src/mobile/mobile-shell.js`, `web-ui/src/mobile/mobile-pages.js`, `src/gateway/routes/canvas.router.ts`, `self/16-mobile-app.md` | high | `audit/chats/transcripts/mobile_mqeoyhea_vkjbe9.md:218-229`; `self/16-mobile-app.md:3`; `src/gateway/routes/canvas.router.ts:4309-4376` |
| Skill/business workflow classifier false positives | Mislabeling dev/frontend work as outreach/vendor research can create noisy skill/business candidates and pollute Dream review. | `src/gateway/brain/skill-episodes.ts`, `Brain/skill-gardener/*/workflow-episodes.jsonl` | high | `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:3-4`; `src/gateway/brain/skill-episodes.ts:205-221` |
| Hermes/OpenClaw competitive landing fill-in | The artifact exists but still explicitly contains placeholders; this could become a real positioning asset if current research is verified and inserted. | `generated/landing-pages/hermes-openclaw-prometheus-landing.html`, web/current release sources | medium | `generated/landing-pages/hermes-openclaw-prometheus-landing.html:362-381`; `generated/landing-pages/hermes-openclaw-prometheus-landing.html:414-422` |
| Generate Image v2 surface | Prior active work remains open and could pair naturally with the mobile canvas/media improvements, but no new current-window change advanced it. | `src/tools/generate-image.ts`, `web-ui/src/mobile/mobile-pages.js`, `web-ui/src/pages/ChatPage.js` | medium | `Brain/active-work.jsonl:17` |
| Mobile background_spawn tray | Still a drafted UI/product idea; current window’s mobile UI polish momentum makes it a natural follow-up, but it was not reopened tonight. | `web-ui/src/mobile/mobile-pages.js`, `web-ui/src/styles/mobile.css`, prior mockups | medium | `Brain/active-work.jsonl:18` |

## G. Improvement Candidates
| Issue | Proposal Type | Suggested Execution Mode | Confidence | Evidence |
|-------|---------------|--------------------------|------------|---------|
| Runtime should write dev-edit completion notes deterministically after successful apply/restart, instead of prompting restarted model to call `write_note`. | src_edit | code_change | high | `memory/2026-06-15-intraday-notes.md:2-4`; `src/gateway/agents-runtime/subagent-executor.ts:14875-14923`; `src/gateway/boot.ts:185-206` |
| Skill episode business classifier uses broad regex over generic words and misclassifies dev/frontend work. | src_edit | code_change | high | `src/gateway/brain/skill-episodes.ts:207-219`; `Brain/skill-gardener/2026-06-15/workflow-episodes.jsonl:3-4` |
| Mobile canvas/diff viewer should get one focused phone smoke test plus self-doc update after the last openMode fix. | general | action | high | `web-ui/src/mobile/mobile-shell.js:1339-1343`; `web-ui/src/mobile/mobile-pages.js:4258-4311`; `self/16-mobile-app.md:3` |
| `self/16-mobile-app.md` and possibly `self/06-image-voice.md` are stale after several mobile/voice/media changes, and prior active work says self-doc writes were blocked in dev-edit scope. | src_edit | code_change | medium | `Brain/active-work.jsonl`; `self/16-mobile-app.md:3`; `self/06-image-voice.md file_stats: last_modified 2026-06-05T20:14:37.664Z` |
| Hermes/OpenClaw landing page has outbound-safe shell but unresolved research placeholders. | general | action | medium | `generated/landing-pages/hermes-openclaw-prometheus-landing.html:379-381`; `generated/landing-pages/hermes-openclaw-prometheus-landing.html:422` |

## H. Window Verdict
**Active:** yes
**Signal quality:** high
**Summary:** The window advanced Prometheus itself: SOUL/config soul cleanup, stricter question-card behavior, and a significant mobile canvas/code-preview pass. The biggest live gap is no longer “what should the prompt say,” but deterministic runtime behavior around dev-edit completion notes and a cleaner classifier so Brain/skill-gardener does not mistake frontend/dev workflows for business workflows.
---
