# Brain Dream - 2026-06-13
_Generated: 2026-06-14 01:01 local_

## Executive synthesis
June 13 was mostly a Prometheus-product day, with three strong currents:

1. **Mara/@raulinvests X operations became reliable enough to treat as an active growth lane, not a rescue lane.** Scheduled posts/replies succeeded across the day, browser sessions were closed, memory was logged, and the stale schedule-memory path debt was repaired in the X workflow skills.
2. **Mobile + image generation UX moved forward, but productization is only halfway done.** Two approved dev edits shipped count/batch image generation plus desktop/mobile loading-card and thumbnail-preview polish. The remaining gap is a first-class Generate Image v2 surface: direct route, progress, gallery/history, presets, provider status, and explicit actions like use-as-chat-background.
3. **Dream surfaced two infrastructure debts that now matter because the product is getting more autonomous:** self-doc writes can be blocked inside approved dev-edit scope, and skill-gardener business classification is tagging X/social workflows as quote/invoice workflows.

## What changed today

### X / social operations
- @raulinvests scheduled workflows posted successfully throughout the 01:40-21:25 UTC windows.
- Original posts and replies were verified through browser evidence and logged to both Mara schedule memory and shared X posting memory.
- The transient 13:03 OpenAI Codex API 400 recovered with a successful 13:09 reply run.
- Prometheus broadened the X posting/reply skills for topic rotation and relevancy-first replies, reducing repeated agent-memory framing.
- The old hardcoded schedule-memory path `.prometheus/subagents/schedule_prometheus-x-posts_yfkm6/...` is no longer the live workflow path; current skills point to `.prometheus/subagents/x_account_operator_raulinvests_v1/memory/schedule-memory.md` and explicitly forbid `memory_read` for that file.

### Generate Image / mobile product work
- The old mobile image-generation delivery bug remains resolved: generated-image progress/final payloads are forwarded and mobile collects generated images.
- Approved dev edit `dev_edit_mqcjkshl` advanced image generation count/batch behavior and Codex fallback handling.
- Approved dev edit `dev_edit_mqcozffx` added desktop/mobile loading-card polish and thumbnail preview/eager load behavior.
- Still missing: direct `/api/media/generate-image` or equivalent route, Generate Image v2 mobile surface, partial-recovery handling, persistent gallery/history, and explicit actions such as “Use as chat background.”

### Mobile tab bar lens
- The mobile bottom tab bar magnifying lens was rebuilt around an inverse-mask approach: hide real tab content under the lens and show a cloned magnified icon+label layer.
- Current final state from June 13 used `--pm-lens-mag: 1.45` in `web-ui/src/styles/mobile.css`.
- Latest Raul request asks for slightly less magnification, target likely `1.25`; the attempted source edit was blocked because web-ui source writes are only available inside an approved internal-code edit session.

### Competitive positioning / Hermes + OpenClaw
- A background agent created `generated/landing-pages/hermes-openclaw-prometheus-landing.html`, a 437-line self-contained competitive landing page with editorial/industrial styling aligned with Raul’s no-purple-blue-AI-SaaS preference.
- Research captured Hermes signals around v0.16.0 / v2026.6.5 and OpenClaw signals around 2026.5.31-beta.3, including self-improvement loops, Curator, Tool Gateway, MCP, runtime recovery, Skill Workshop, Workboard, Tailscale Serve, iOS push/realtime.
- The page is not publication-ready. Version numbers and feature claims need direct primary-source verification before outbound/public use.

### xAI / Grok blocker
- xAI/Grok remained blocked by `personal-team-blocked:spending-limit`.
- Pending proposal `prop_1781322308947_26bdc8` remains the correct implementation container for read-only billing/credit status and blocked-provider preflight.
- Do not duplicate that proposal; review/approve/harden the existing one.

## Active-work ledger interpretation

### Resolved / close-out candidates
- `x-posting-schedule-memory-path-and-browser-reliability` is resolved. Current skill evidence shows the live path is correct and runs succeeded.
- `x-research-replies-skill-id-drift` remains resolved.
- `dev-source-batch-tools-dispatch-gap` remains resolved at the handler level; exact-replace drift is still an executor behavior concern, not the original missing-handler bug.
- `fleet-skill-metadata-cleanup` remains resolved after the audit returned 123 scanned, 0 flagged, avgScore 100.
- `mobile-image-generation-progress-delivery` remains resolved; current Generate Image work is product UX, not delivery-bug repair.

### Still active
- `mara-x-account-operator-raulinvests`: in progress as a growth/quality lane, not an auth rescue.
- `generate-image-v2-product-surface`: in progress, partially advanced by dev edits, needs a full product-surface proposal.
- `mobile-realtime-voice-photo-attachments-doc-gap`: still a self-doc debt.
- `mobile-tool-stream-vision-preview-twitch`: still active pending source/Codex verification.
- `mobile-live-screen-vision-native-companion`: still idea-stage.
- `skill-gardener-business-classifier-false-positives`: active source/model-review debt.
- `self-docs-write-blocked-in-dev-edit-scope`: active tooling/docs-scope debt.
- `hermes-openclaw-prometheus-competitive-landing`: active verification/fill-in task.

## Proposals to harden or file

### 1. Generate Image v2 Phase 1
**Lane:** code_change  
**Priority:** high  
**Status:** should be filed as a concrete proposal, not left as an idea.

Required scope:
- Backend direct generate-image route or action endpoint.
- Progress events surfaced directly to mobile/desktop image-generation UI.
- Mobile Generate Image v2 panel with prompt, model/provider, size/style/count controls.
- Result gallery with multi-image handling and thumbnail preview.
- Explicit actions: reuse prompt, send to chat, save/download, use as chat background where supported.
- Provider status/error copy that distinguishes queue/generation/provider-blocked cases.
- Self docs: `workspace/self/06-image-voice.md` and `workspace/self/16-mobile-app.md`.

### 2. Dev-edit self-doc scope/tooling fix
**Lane:** code_change  
**Priority:** medium-high  
**Status:** should be proposed after source inspection.

Problem:
- Approved dev-edit sessions can include self-doc paths, but generic workspace mutation tools were unavailable inside the dev-edit sandbox, preventing required `workspace/self` documentation updates.

Acceptance behavior:
- If a dev edit approves `workspace/self/**` or `self/**`, scoped workspace read/write tools are available to the executor.
- Source edits and self-doc edits remain separately scoped and auditable.
- Completion notes record whether docs were updated or explicitly skipped.

### 3. Skill-gardener business classifier false positives
**Lane:** code_change or review-first action  
**Priority:** medium  
**Status:** needs source investigation in `src/gateway/brain/skill-episodes.ts`.

Problem:
- X/social posting workflows were classified as quote/invoice business workflows despite touched paths and outputs being posts/replies/memory updates.

Acceptance behavior:
- Business classifier avoids writing/flagging social automation as quote/invoice unless evidence includes actual quote/invoice entities, files, connectors, or user intent.
- Dream/business candidates preserve social-account events separately from business financial events.

### 4. Mobile tab lens magnification follow-up
**Lane:** code_change/dev-edit  
**Priority:** low-medium but user-requested  
**Status:** blocked pending approved web-ui edit session.

Exact requested edit:
- `web-ui/src/styles/mobile.css`: change `--pm-lens-mag: 1.45;` to `--pm-lens-mag: 1.25;`.

Verification:
- Sync web UI, run build/static check, and visually verify the mobile tab bar lens remains aligned with less icon/label zoom.

### 5. Hermes/OpenClaw competitive page verification pass
**Lane:** action/review  
**Priority:** medium  
**Status:** should be a bounded verification/fill-in task, not a source-code proposal.

Required work:
- Verify Hermes and OpenClaw version/feature claims against primary docs/release pages.
- Replace placeholder update slots in `generated/landing-pages/hermes-openclaw-prometheus-landing.html`.
- Mark claims as “verified as of [date]” or remove unsupported specifics.

## Business/entity events to preserve

### @raulinvests X account
June 13 should be recorded as a high-confidence operational milestone: Mara-owned scheduled X workflows posted original posts and replies across the day, recovered from one transient provider error, verified browser success, closed browsers, and logged memory. Skills were broadened for topic rotation/relevancy-first posting.

### Prometheus project
June 13 should be recorded as a product-progress day: Generate Image v2 partially shipped via approved dev edits, mobile tab bar lens inverse-mask approach landed, a competitive landing-page artifact was created, xAI billing blocker stayed pending, and two tooling debts surfaced around self-doc scope and skill-gardener classification.

## Do not write as business facts
- Do not store skill-gardener quote/invoice classifications from June 13 X/social workflows as business quote/invoice activity.
- Do not treat Hermes/OpenClaw version claims as public-ready until directly reverified.
- Do not treat xAI/Grok as fixed; current state is still billing/spending-limit blocked.

## Next morning checklist
1. File or approve Generate Image v2 Phase 1 proposal.
2. Run an approved tiny mobile dev edit for `--pm-lens-mag: 1.25`.
3. Update `workspace/self/16-mobile-app.md` and `workspace/self/06-image-voice.md` for June 13 mobile/image-generation changes.
4. Review existing xAI billing proposal `prop_1781322308947_26bdc8` instead of creating a duplicate.
5. Investigate skill-gardener business classifier false positives before the next Dream writes noisy business memory.
6. Fill and verify the Hermes/OpenClaw competitive landing page update slots.
