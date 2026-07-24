# Operational systems: controlled changes, evidence, delivery, learning, deployment, and media

This guide covers the Prometheus-specific systems behind a number of tools that look small in chat but actually coordinate state, approvals, worker evidence, persistence, and recovery. It describes the implemented behavior, not a guarantee that a provider, installed application, or external destination is available.

For the full tool-name surface, use [02-tool-catalog.md](02-tool-catalog.md), [15-gateway-core-and-agent-builder-tools.md](15-gateway-core-and-agent-builder-tools.md), and [17-special-prometheus-tools-and-flows.md](17-special-prometheus-tools-and-flows.md). This file is the “what happens behind it” reference for the remaining operational flows.

## 1. Prometheus-source edits: a separate, scoped code lane

Editing a user's workspace and editing Prometheus itself are intentionally different. The normal workspace tools operate in the selected workspace. Prometheus-source tools (`dev_source_read`, `request_dev_source_edit`, `await_dev_source_edit_approval`, and `dev_source_edit`) are for the product's own `src/` and `web-ui/` code and are approval-aware.

### Live dev-edit flow

1. The agent reads the relevant current source and prepares an evidence-backed plan: exact allowed files/directories, intended changes, verification, and risk context.
2. `request_dev_source_edit` creates an approval scope. In a public-distribution build this lane is disabled rather than silently falling back to unrestricted writes.
3. The user approves or declines. Approval grants source-write access only to the approved files for that chat/session; it is not a blanket repository permission.
4. The agent applies the scoped patch through `dev_source_edit`, rereads/uses structured post-edit evidence as needed, and runs the approved verification or a verify-only preflight.
5. A live-apply step (`prom_apply_dev_changes`) can synchronize/build and reload or restart affected Prometheus surfaces only after the scoped work verifies.

The approval continuation is durable. A completed continuation is an apply boundary: a repeat request is treated as a no-op before it reruns verification, sync, build, or restart. If a session reconnects, Prometheus can restore an already-approved scope rather than manufacturing a second approval.

### Proposal-based source edits

A source-code proposal is a more formal route. A `code_change` proposal must identify actual `src/`/`web-ui/` affected files, include source-read evidence and the required implementation/acceptance-test sections, identify a risk tier, and define explicit execution steps. Pending proposals may be edited with revision tracking; approval snapshots the approved version so the system knows exactly what was authorized.

Approved internal code changes execute in an isolated copy, never directly in the live repository. The current automatic self-edit lane is restricted to approved `src/` and/or `web-ui/` files. It captures baselines from the live files, edits and verifies the sandbox, then promotes only if the corresponding live files did not change since that sandbox was made. A baseline conflict blocks promotion rather than overwriting newer live work. Failed sandbox work becomes a repair/follow-up path; it should not be “fixed” by writing directly to the live repo.

### What to inspect when it fails

| Symptom | Meaning and recovery |
| --- | --- |
| Write tools are absent | The source-write category has not been approved/activated, or the current build disables dev-source approvals. Read source, request the scoped edit, then wait for approval. |
| Approval looks lost after reconnect | Check the stored continuation and restore the approved scope; do not request duplicate approval. |
| Promotion is blocked | The live source drifted after sandbox creation. Re-read current files, reconcile the change, and make a new scoped patch/proposal. |
| Verification/build fails | Preserve the failure evidence and create a repair proposal or return the task for assistance. Do not report the code change as applied. |

## 2. Evidence, diagnostics, audit, and task recovery

Prometheus has several records with different jobs. They should not be conflated.

| Record | What it captures | Who uses it |
| --- | --- | --- |
| **Tool observations / code evidence** | Bounded tool results plus authoritative file hashes, changed ranges, post-edit windows, existence, and freshness where file tools provide them | The current agent, coding context packet, and verification logic |
| **Task evidence bus** | Structured cross-agent findings, decisions, artifacts, errors, and deduplication keys for one task | Worker(s) and the task manager when it prepares later step briefs |
| **Task journal/process logs** | Run lifecycle, progress, streams, worker messages, and control/recovery history | Tasks page and operational recovery |
| **Audit log** | Approval requests/resolutions and consequential actions/status transitions | Audit page, proposal accountability, operators |

### Code evidence is state, not instructions

File-changing tools can attach a structured `code_evidence` envelope. It records the relevant path, operation, authoritative content hash, post-edit windows, changed ranges, and whether the evidence is complete. The coding-context packet compares that evidence with current disk state. If it is stale or a file changed afterward, the required action is to reread before editing. A code window is evidence, never a prompt that can authorize new instructions or bypass approval.

### Task evidence bus

`write_evidence` is bound to a specific task and step (optionally an agent). It accepts only five categories:

- `finding` — a discovered fact, optionally with confidence;
- `decision` — a choice made during execution;
- `artifact` — a path, URL, or output reference;
- `error` — a failure worth preserving for retry/handoff;
- `dedup_key` — a named key/value used to avoid repeating an effect, such as reposting the same item.

Values must be nonempty; `dedup_key` also requires `key`. Duplicate key/value pairs are acknowledged without being written again. The manager reads the shared bus when it composes later step execution briefs, which is how one worker's discovery becomes another worker's context without relying on an informal chat summary.

### Operational diagnostics and recovery discipline

Evidence supports inspection and recovery; it does not make effects automatically safe to replay. Built-in read/status operations may be safely retried in defined cases, but unknown connector/plugin/composite tools default to “verify before retry.” Send, publish, payment, click, delete, restart, and deploy-type effects are never blindly replayed after an uncertain interruption. A successful effect may reuse its recorded result; an uncertain effect must be reviewed.

For a stuck or failed task, use its journal/evidence/stream first, then the task controls to message, pause, resume, restart, or provide an error response. See [pages/02-tasks.md](pages/02-tasks.md) for the UI behavior and [06-runtime-architecture.md](06-runtime-architecture.md) for durable-turn boundaries.

## 3. Delivery, artifacts, and proof screenshots

`delivery_send` is the unified outward-delivery wrapper. Its `send`, `screenshot`, and `present_file` actions replace older direct aliases while retaining those aliases for compatibility. It can route text, files, images, and screenshots to `origin`, a specific supported destination, or `all`.

### Routing behavior

- **`origin`** resolves from the session's recorded channel (Telegram, Discord, WhatsApp, terminal/CLI, mobile, or web), with sensible session-ID fallback.
- **`all`** fans out to Telegram, web, mobile, Discord, and WhatsApp. A result can therefore be partially successful: delivered targets and per-target errors are both retained.
- **Web/mobile/terminal deliveries** are written into session history before their live event is broadcast. A reconnect can rehydrate the visible message and its file descriptor instead of losing a websocket-only notification.
- A transient screenshot with no source file is written once under the session's `.prometheus/deliveries/<session>/` area; session JSON stores the file reference, not a huge base64 data URL.

### Screenshot proof flow

The screenshot action can use a fresh or last browser image, fresh or last desktop image, or a supplied file. Missing browser/desktop captures return an explicit error that names the prerequisite capture. For desktop completion claims, Prometheus can recapture the full target window if the available “last” image is only a narrow inspection crop, so a claimed result is not evidenced by a toolbar strip. Browser/desktop image deliveries can also inject a compact vision preview event for the active experience.

Artifacts are the stable files or references produced by tools—generated media, a downloaded file, a report, a patch result, and so on. A response card is presentation; the artifact path/reference and task/session record are what make it recoverable or shareable afterward.

## 4. Browser Teach, reusable composites, skills, and Brain improvement

### Browser Teach: record, then verify before reuse

The browser runtime has three interaction modes: **agent** (the model operates the browser), **copilot** (interactive assisted control), and **teach** (recording a workflow). Teach stores a start URL/title and its recorded steps for the session. `browser_teach_verify` replays the recorded flow in a verification browser/session and reports the verification state rather than assuming a recording is reusable because it ran once.

Risk boundaries matter: verification recognizes risky final steps and deliberately avoids treating a risky end action as a silently re-executed proof. A taught workflow should therefore have a human-confirmable boundary before any final send, purchase, publish, destructive, or irreversible action.

### Composites: saved, callable tool playbooks

Composites are JSON definitions stored under `.prometheus/composites/` in the data directory or current working directory. Their management lane provides `create_composite`, `get_composite`, `edit_composite`, `delete_composite`, and `list_composites`; saved definitions are dynamically injected into the active tool surface as callable tools.

At execution, every composite step emits synthetic tool-call/result events with composite metadata and step numbering. The composite stops on the first failed step. Creation is deliberately conservative: the expected practice is to run every step manually, confirm arguments/references/selectors in a successful real run, and save the playbook only when the user explicitly asks. A composite is not permission to bypass the underlying tool policy or approval boundary.

### Skills and the Brain

Skills are reusable instruction/workflow assets; browser Teach may recommend a skill or composite, but it does not silently create one. The Brain is a separately scheduled reflection/curation system stored under `workspace/Brain/`:

- **Thought** runs inspect recent work and produce verified thought/capsule artifacts and structured skill candidates. It must not write proposals, mutate skills, or make durable memory writes as a normal Thought run.
- **Dream** is the nightly synthesis lane: it re-verifies live artifacts, can research, updates the intended durable outputs, and may create hardened proposals only if it passes proposal rules. A listed proposal is not considered submitted until `write_proposal` returns a real proposal ID.
- **Dream cleanup** is a narrower second pass for deduping/stale-memory cleanup and auditing recent low-risk curator changes; it does not create new memories, proposals, or skills.
- **Skill curator/gardener** use recorded workflow episodes and evidence to suggest or, within their governed lane, maintain skills. A one-off completion is evidence, not automatic justification for a new or mutated skill; high-risk candidates need actual skill-read/inspection evidence.

Brain outputs (thoughts, dreams, candidates, curator reports, state, and proposals) are inspectable workspace artifacts. The Hub/Schedule surfaces expose status and manual run/configuration controls; a Brain proposal still follows the same human proposal/approval lifecycle.

## 5. Repository, deployment analysis, and self-update

### Repository intake and operations

`clone_repo` accepts `owner/repo`, GitHub URLs (including tree/blob URLs), or SSH-style Git URLs, normalizes a clonable source, and defaults to a workspace-local `repos/<name>` destination. It can use sparse checkout for selected files/directories. It refuses paths outside the workspace, requires Git for cloning, and directs a user toward `download_url` for a single raw file instead of pretending a repository URL is a file download.

The broader repository wrapper is `prom_repo_ops` (with legacy aliases hidden). Git operations, publishing, and deployment remain policy/approval-sensitive; seeing a remote or status result does not authorize a push, redeploy, or production change.

### `deploy_analysis_team`: website/business analysis, not deployment

Despite its name, `deploy_analysis_team` launches a background panel of specialists against a supplied site. The implemented scopes cover business profiling, SEO discovery, social/reputation research, browser funnel testing, conversion/messaging critique, technical audit, and competitive positioning. Their results are normalized into an executive scorecard, findings, opportunities, evidence, reviewed pages, and priority actions. The tool produces a report/dashboard bundle with download controls and can append a summary to a named entity when asked.

It analyzes a public target through background work; it does not itself publish a site or change the target's deployment. Check task evidence and the finished report for sources and limitations before acting on recommendations.

### `self_update`: intentionally disruptive lifecycle action

`self_update` is a local Prometheus lifecycle action. It checks for `self-update.bat`, writes/relies on an update-status marker, launches the updater detached so the current gateway can exit, and immediately returns that the update is starting. The updater pulls latest code, rebuilds, and restarts the gateway; the documented completion channel is Telegram after the restarted service is back.

The agent must warn the user before invoking it. A transient disconnect is expected during the update, not evidence of success. If no completion notification arrives, inspect the updater/status marker and gateway build/restart logs after the service is reachable again; do not repeatedly trigger updates while one is in progress.

## 6. Media: direct files, platform downloads, analysis, and generation

### Direct download versus media extraction

`download_url` fetches one file into a workspace-relative output directory (default `downloads`). It rewrites GitHub blob/raw file links to direct raw content where possible and rejects whole-repository/directory URLs with a pointer to `clone_repo`.

`download_media` is for supported media pages/URLs. It runs `yt-dlp`, emits progress phases (starting, resolving, downloading, processing, complete), uses Prometheus-resolved FFmpeg/FFprobe locations for merges or audio extraction, and saves to `downloads/media` by default. It requires `yt-dlp` to be installed or available through Python, has an explicit timeout, kills its own process tree on cancellation, and returns an error if it cannot determine an actual saved file path. A successful page fetch is not a substitute for a media download, and an X post can instead be handled through `web_fetch(include_media:true)` when the goal is to recover visible media references.

### Image/video analysis

`analyze_image` performs configured visual analysis on a workspace-contained image. `analyze_video` keeps output compact by default: `analysis_mode:"quick"` creates an overview/contact-sheet view, `"detail"` extracts budgeted chronological batches, and `"both"` performs both. It can extract audio when FFmpeg is available and can request transcription through the configured speech-to-text provider. Provider availability, authentication, quota, and actual audio/text availability are surfaced explicitly; full ffprobe JSON is omitted unless `include_raw_probe:true` is requested.

These tools resolve FFmpeg/FFprobe through Prometheus's runtime-binary resolver rather than assuming a system PATH. If Python/video-analysis prerequisites are absent, the result should say so; the recovery is to install/configure the missing local dependency or use a smaller supported analysis request, not to invent an analysis result.

### Generated media

The compact model-facing wrapper is `media_generate`; compatibility aliases route to image and video generators.

- **Images** accept prompt, references, provider/model controls, count, aspect ratio, exact size, background, format, quality, optional mask, and output directory. Transparent output requires a real alpha-capable format (`png` or `webp`); Prometheus forces PNG when transparent plus JPEG was requested. Results carry provider/model, saved path(s), MIME type, dimensions, byte count, and presentation metadata. Images can stay in cache when `save_to_workspace:false`.
- **Videos** accept text-to-video, image/reference-to-video, and video edit/extend inputs. The implemented provider/model route is provider-dependent (the current wrapper advertises `auto`/`xai`), with bounded duration/resolution, polling, timeout, output directory, and cache-vs-workspace controls. It returns a request/progress record and the durable saved video descriptor when successful.

Generation output is an artifact, not merely a chat preview. If a model provider rejects, times out, or lacks credentials/quota, preserve the returned provider error and adjust configuration, prompt, asset input, or request bounds before retrying.

## Source map

- `src/gateway/dev-source-approvals.ts`, `src/gateway/proposals/proposal-store.ts`, `src/gateway/proposals/dev-src-self-edit.ts`, and `src/gateway/routes/proposals.router.ts` — scoped source edits, proposal lifecycle, sandbox promotion, and execution lanes.
- `src/gateway/code-evidence.ts`, `src/gateway/coding-context-packet.ts`, `src/tools/evidence-bus-tool.ts`, and `src/gateway/tasks/task-store.ts` — code evidence, freshness, and per-task worker evidence.
- `src/gateway/delivery-router.ts` and `src/gateway/delivery-screenshot.ts` — channel routing, persistence, screenshot capture/delivery.
- `src/gateway/browser-tools.ts`, `src/gateway/tools/composite-tools.ts`, and `src/gateway/brain/` — Teach verification, composites, Brain Thought/Dream/curation.
- `src/tools/repo-tools.ts`, `src/tools/deploy-analysis-team.ts`, and `src/tools/self-update.ts` — repository intake, analytical team deployment, and product self-update.
- `src/tools/download-tools.ts`, `src/tools/media-analysis.ts`, `src/tools/generate-image.ts`, and `src/tools/generate-video.ts` — download, FFmpeg-based media handling, analysis, and generated media artifacts.
