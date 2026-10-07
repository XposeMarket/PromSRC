# 15 — Media Engine & Video Projects

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/media-engine/`, `src/video-generation/`, `src/image-generation/`
> **Read this when:** Creating/editing video projects, quoting generation costs, configuring media providers, managing cast/characters/jobs, or diagnosing trend transfer/render output.

## TL;DR
- `video_project` is the media engine's single control surface. Projects are server-owned at `<workspace>/video-projects/<projectId>/project.json` with generated media beside the project; editor-open state is not required.
- A project models characters/products, styles, shots, provider manifests, generated takes, jobs, a layered timeline, audio/captions, QA and renders. Project changes go through operations (`apply_ops`) so undo/redo covers agent and UI edits.
- Build the plan and run `estimate` before every paid generation; inspect required model inputs and the quote per model/shot. User rule: never assume inputs or spend from a model label alone.
- `budget.capUsd` is a hard ceiling; `budget.autoApproveUsd` controls the amount that may proceed without a separate user confirmation. Above the auto-approve threshold, obtain user approval and retry with `approved:true`; do not bypass the hard cap.
- User rule: image generation for this work goes only through built-in OpenAI/xAI image-generation pathways. fal/Higgsfield are for video/transform/other model jobs, not a reason to route still image generation to arbitrary providers.
- Providers include OpenAI/xAI plus fal and Higgsfield. fal/Higgsfield use queue-style transports and API keys; xAI/OpenAI reuse existing generation registries/auth. Model manifests describe exact input schema, defaults and pricing.
- `trend_transfer` splits a source clip into parts, extracts first frames, prepares OpenAI-generated matched start images, creates source-linked shots, then queues motion generation. Trend assembly/phone finishing are separate post-processing actions.
- Current default trend model ID is `fal/kling-v3-pro-motion-control`. A previous synced model entry was mis-mapped, omitting the `image_url` mapping and `character_orientation` default; the curated manifest in current source maps `startImage` to `image_url` and sets the orientation default. Recheck actual inputs and pricing on future syncs.
- Generated trend files live under each project's `media/trend/<id>/...`. Windows `MAX_PATH` is a known sharp edge; short paths matter for long workspace paths and deeply nested generated frames.
- Old drain-host processes may keep ports across restarts/fixes. Check process/PID and ensure the current host owns the port before judging a deployed fix.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Main tool/actions | `src/media-engine/tool.ts` → `VIDEO_PROJECT_ACTIONS`, `getVideoProjectToolDef()` | Unified project, generation, studio, cast/brand and trend operations. |
| Tool execution | `src/media-engine/tool.ts` → execute dispatcher | Resolves action, validates IDs, computes estimates and approval state. |
| Project schema/storage | `src/media-engine/project.ts` → `VideoProject`, `projectDir()`, `mediaDir()` | Workspace-owned JSON plus media folder; serialized per-project writes. |
| Operation history | `src/media-engine/project.ts` → `applyOps()`, undo/redo | Shared edit history for tool/UI actions. |
| Cost/input preflight | `src/media-engine/engine.ts` → `estimate()` | Resolves required inputs, manifest schemas, synced-model warnings and costs. |
| Paid job execution | `src/media-engine/engine.ts` → `generateShots()`, job runner | Enforces hard budget cap and auto-approval threshold. |
| Job lifecycle | `src/media-engine/engine.ts` → `cancelJob()`, `waitForJobs()`, `resumeJobs()` | Jobs, polling, results and project spend. |
| Model manifests/catalog | `src/media-engine/catalog.ts` → `getModel()`, `importModelManifests()` | Model input contracts and price estimation. |
| fal model sync/schema | `src/media-engine/fal-catalog.ts` → `syncFalModels()`, `hydrateFalModelSchema()` | Synced fal entries can need curation; unmapped inputs matter. |
| Provider dispatch/auth | `src/media-engine/providers.ts` → provider/key and submit paths | fal/Higgsfield queue transport; xAI/OpenAI generation registry. |
| Video generation registry | `src/video-generation/registry.ts` → `listVideoGenerationProviders()` | Existing provider/auth contract reused by the media engine. |
| Image generation registry | `src/image-generation/registry.ts` | Built-in image provider path; do not route stills to arbitrary media service. |
| Studio/autopilot | `src/media-engine/studio.ts` | Templates, storyboards, voice, captions, music, QA, run and render variants. |
| Persistent cast/brand | `src/media-engine/library.ts` → cast/brand functions | Reusable identity/product and brand data across projects. |
| Trend pipeline | `src/media-engine/trend.ts` → `trendTransfer()`, `trendAssemble()`, `phoneFinish()` | Source clip → cut parts/frames/matched starts/shots → motion runs → assembly/finish. |
| Tool inventory | [`generated/tools.md`](generated/tools.md); changelog [`generated/changelog.md`](generated/changelog.md) | Use generated inventory for full schema; changelog lists merged changes. |

## How it works

### Project state and storage
- `video_project(create)` creates a server-owned project. The workspace contains `video-projects/<id>/project.json`; project media is stored under that project, usually relative workspace paths.
- The project is the source of truth, not an editor tab. UI and tool updates both use operations; this makes edits shared and gives a consistent history/undo boundary.
- A project includes target aspect/resolution/fps, defaults for image/video models, characters, styles, shot list, takes, jobs, timeline, assets and a budget ledger. Character records can refer to a reusable cast member and identity anchor stills.
- Build shots with explicit title/prompt/duration/character IDs/model/anchor behavior. Check the actual resulting shot inputs; a shot may depend on a prior take, source video, reference images or audio.
- `apply_ops` is the edit boundary for project plans/timeline/character changes. Keep operation batches targeted, read state after mutating, and use undo/redo for recovery.

### Quote before generation
1. Select/check the intended model. If the model is synced from fal, inspect its `needs`/input schema or call the models action; synced schemas can be guessed or omit provider-specific requirements.
2. Call `estimate` for the exact shot IDs, model, resolution/count and output settings. It checks whether required shot inputs can be resolved and reports per-shot problems/cost and the current budget.
3. If a model input is missing, do not interpret a zero/low quote as permission to run. Fix the shot or use a curated manifest first, then re-estimate.
4. Compare total estimate to remaining `capUsd` and `autoApproveUsd`; account for already spent money. The cap is a hard stop, not a user-confirmation threshold.
5. Present the cost breakdown and ask/obtain explicit user approval for spend above the auto-approve allowance. Retry the same pending action with `approved:true` only after approval.
6. After the run, wait/reconcile jobs and actual billed costs. Inspect outputs before assembling or rendering. Never imply an estimate is an exact invoice where provider billing can differ.

`estimate()` refreshes fal models when necessary, reconciles project spend, resolves each shot's input, calculates model cost, and flags unknown pricing, missing required inputs and unverified synced models. A synced model's guessed input schema must not be treated as a reviewed/curated manifest.

### Jobs, providers and model manifests
- `generateShots()` validates that the selected model can receive required fields, checks budget cap and auto-approval, then creates jobs. Job records carry status, model, shot and cost state; `wait`, `jobs`, `cancel_job`, and resume paths manage asynchronous results.
- fal and Higgsfield use queue-style REST transports. Provider keys are stored in the vault/config mechanism; do not print them or include them in prompts.
- xAI/OpenAI use the existing video/image generation registries so their auth behaves like the rest of the application. Provider manifests are not interchangeable just because their labels sound similar.
- Model manifests define provider, endpoint, media kind, input schema/neutral field mapping/defaults, allowed values, pricing and limits. Importing a model is not proof its schema is correct: compare each required provider field with model docs/input output and real regression coverage.
- Image-generation user rule: use only built-in OpenAI/xAI image generation. For stills, anchors, storyboards or trend-matched frames, check the `imageModel`, reference input requirements, size/aspect and output path before generating.
- Provider credential setup uses the media provider actions/settings. fal and Higgsfield credentials have dedicated vault keys/env conventions in `src/media-engine/providers.ts`; OpenAI/xAI keys/OAuth are managed through existing model settings/registries.

### Studio, cast and trend workflow
- Studio actions include template/quickstart, product or character imports, storyboards, voiceover, captions, music, QA, hooks, multi-aspect render variants, upgrade/route, and resumable `run`/`run_cost` flows.
- A project cast entry is not the same as a transient project character: persistent cast/brand records live in the media library and may be copied/referenced into multiple projects. Character anchor candidates require an explicit user-approved anchor before they drive identity.
- `trend_transfer` segments a reference clip (detected/provided cuts bounded by part count), writes each segment and a first-frame image to project media, creates a matched still where needed using the built-in image path, then creates a shot anchored on that first frame and requests motion generation.
- Its default is `fal/kling-v3-pro-motion-control`; successful use depends on the required model input names (including `image_url` and `character_orientation` for the previously mis-mapped synced entry), source/character media and quote approval. Inspect manifest `needs` and per-shot estimate before spending.
- When an approved cost retry is requested for the same shots, reuse the prepared IDs; do not recreate duplicate shots or rerun preparation unnecessarily.
- `trend_assemble` joins selected takes over the original clip audio. `phone_finish` is a local ffmpeg finishing pass; neither replaces reviewing the generated parts.
- Render combines the selected timeline/takes, audio, captions, aspect/resolution and output settings. Inspect the exported MP4 and representative frames/audio after completion.

## Config & knobs
- Project budget stores `capUsd`, `autoApproveUsd`, `spentUsd` and estimate/ledger data. Inspect the live project budget through `get`/`estimate`; do not infer settings from defaults if the project already exists.
- `capUsd` is a hard block when additional estimated work would exceed remaining cap. `autoApproveUsd` controls the amount allowed without an explicit `approved:true` retry after user confirmation; default auto-approval is conservative (tool description says $0 for video projects).
- Project target controls aspect, resolution, fps and optional duration. The per-shot estimate must match the intended count, duration, resolution and model, or the quote is not representative.
- Provider IDs include xAI, OpenAI, fal and Higgsfield. The media tool's model catalog can sync/import manifests; provider secrets are set through provider settings/vault, not raw project data.
- Project media path helper is `mediaDir(workspacePath, projectId)`. Trend subfiles currently use `media/trend/<generated-id>/partN...`; keep workspace root and project IDs short enough for Windows path limits.
- Generation methods accept an approval flag on paid actions. Never set it optimistically or from prior approval for a different quote/shot/model.
- As provider pricing/schema changes over time, run `models`/`syncModels` and `estimate` before each paid run rather than relying on remembered price or static catalog defaults.

## Gotchas / sharp edges
- **Model input mapping (Kling v3 motion-control):** a previous synced fal manifest was mis-mapped; the current curated `catalog.ts` entry maps `startImage` to `image_url` and defaults `character_orientation: 'video'`. Verify the live selected model's `needs` and estimate after sync/update; use a curated manifest rather than a guessed schema. `fal-catalog.ts` flags unmapped inputs.
- **Windows path length:** trend frame/media paths under nested workspace/project/generated-trend folders have reached the classic 260-character limit (278 chars reported in workspace notes). Errors surface during frame reads/writes or ffmpeg/provider submission. Use/arrange a shorter workspace path and short generated identifiers; do not hand-edit paths inside project JSON without migration validation.
- **Cost cap vs approval:** cap exhaustion is a stop even with `approved:true`. Check remaining cap and quote before retry; approval is not a budget override.
- **Input mismatch or unknown cost:** synced model schemas/prices may be estimates or unverified. `estimate()` reports schema problems and flags missing/unknown price; do not proceed with unresolved required fields.
- **Duplicate pending shots:** after cost approval, pass/reuse the prepared shot IDs returned by the prior action. Re-running preparation can create duplicate shots/frames.
- **Stale host/process:** old drain-host processes may keep listening on a port and serve stale code after a fix. Check process IDs/listeners and restart/verify the intended gateway/worker before attributing behavior to current source.
- **Source media URL rejected:** local files may need to be uploaded to the fal CDN; the Oct 6 changelog records this fix for invalid video URLs. Inspect provider-specific source resolution for local inputs.
- **Anchor candidates:** generated identity stills are candidates; explicitly approve the correct anchor before using it as the character identity frame.
- **Queue completion is not final review:** poll/wait can finish while outputs are blank, malformed, or visually off. Inspect each take, audio and final render before presenting.
- **Provider key confusion:** a subscription does not imply API credit/key availability. Verify the API provider is configured and paid balance/plan supports this call.
- **Image provider policy:** do not route image-generation tasks through arbitrary fal/Higgsfield image models; use the built-in OpenAI/xAI path, and verify requested model and reference-image inputs.

## How to change it safely
- Search [`generated/tests.md`](generated/tests.md) for media-engine, generation registry, fal manifest, pricing, cap, billing, job, trend, render and provider regression tests.
- Run focused tests for `src/media-engine/engine` and provider/fal catalog paths in the PR worktree. Cover missing fields, unknown prices, hard cap, approval threshold, approved retry, idempotent job reuse, billed-cost reconciliation, provider errors and cancellation.
- For a manifest change, inspect actual provider input docs, compare every required field with the neutral mapper/defaults, and exercise the same shot inputs passed by the engine. Add a focused regression for provider field names.
- For trend changes, use a short local clip and approved character anchor; inspect generated segment, extracted first frame, matched image path, shot linkage, quote/approval, final assembled output and total file path length.
- For path issues, test with the actual Windows workspace root length and enumerate generated files; do not validate only from a short temp directory.
- After code change, build and restart only the intended host. Check the listener PID and gateway/worker health so an old drain process cannot masquerade as the new code.
- Never run a paid smoke test without inspecting model inputs, computing a quote, comparing budget and obtaining the required user approval first.

## Related
[06 Image & voice](06-image-voice.md) · [14 Creative, HyperFrames & Remotion](14-creative-hyperframes-remotion.md) · [16 Games engine](16-games-engine.md) · [21 Security & approvals](21-security-approvals-permissions.md) · [`generated/tools.md`](generated/tools.md) · [`generated/changelog.md`](generated/changelog.md) · [`generated/tests.md`](generated/tests.md)


## Action-family field guide
| Intent | Tool action family | Preflight / result to inspect |
|---|---|---|
| Start a project | `create`, `get`, `list`, `apply_ops` | Project ID, defaults/target, character and shot state. |
| Explore models | `models`, `syncModels`, `import_models`, `add_model`, `remove_model` | Provider, pricing, media kind, input schema, missing/unmapped fields. |
| Configure providers | `providers`, `set_key` | Configured status and key hint only; never display secrets. |
| Generate anchors/stills | `generate_anchor`, `generate`, `storyboard` | Image model/input references, estimate, approval state, anchor candidates. |
| Generate jobs | `generate`, `run`, parity actions, `trend_transfer` | Exact quote, required inputs, cap remaining, approval, returned job/shot IDs. |
| Track jobs | `jobs`, `wait`, `cancel_job` | Current job status, provider errors, outputs and reported actual cost. |
| Edit/assemble | `apply_ops`, take selection/trim/assemble ops, `trend_assemble` | Selected takes, timing, track relationships, final audio/video. |
| Prepare studio assets | `import_asset`, `voiceover`, `captions`, `music`, `music_beds` | Imported path/format, voice/audio rights, timeline placement. |
| Review/upgrade | `qa`, `hooks`, `render_variants`, `upgrade`, `route` | QA feedback and quote for all re-generation, not just first take. |
| Reuse characters/brands | `cast_list/save/add/delete`, `brand_list/save/apply/delete` | Correct persistent record/project association; approve candidate identity still. |

## Quote and budget review card (internal checklist)
Before any paid call, capture the following from the *current* project/tool result:
- Project ID and target output settings (aspect, resolution, fps).
- Exact action, model ID, shot IDs, run count/variants, duration, image/video/audio references.
- Model required fields, enum constraints, defaults, maximums, and whether the manifest is curated or `fal-sync`.
- Per-shot estimate, estimate warnings, project `spentUsd`, `capUsd`, `autoApproveUsd`, and remaining cap.
- Whether user approval is required and what exact run will occur if approved.
- Whether the same prepared shot/job can be retried rather than cloned.

Do not reuse a quote after changing model, count, prompt-driven duration, references, resolution, output variants, or target aspect. Re-run estimate. If price is missing or a required provider field cannot be constructed, stop and fix the manifest/input before asking for money.

## Output-review checklist
- Wait until job state is terminal; verify each requested shot has an output path/take.
- Confirm output file exists, can be decoded, has expected duration/aspect/resolution, and is not an HTML error or unsupported media response.
- Inspect opening/middle/closing frames for identity consistency, motion, framing and visual artifacts; check source-video/audio sync when doing trend transfer.
- Review model audio/native speech, generated VO, music and captions as separate timeline tracks. Check that the render includes only intended tracks.
- Reconcile expected quote and actual billing from provider payload/project budget. Investigate missing/ambiguous actual cost rather than inventing a number.
- For multi-aspect or batch exports, inspect at least one final frame/output per requested variant; safe area and crop differ by aspect.
- Keep intermediate frames/segments and project paths within the supported host path length. If any generated relative path is unusually long, test its absolute workspace path early.

## Operations and storage notes
- Project JSON and media paths are workspace-relative where persisted; resolve files with project path helpers rather than rebuilding `video-projects/<id>` strings in unrelated tools.
- `projectDir()` and `mediaDir()` centralize the base path; job outputs and trend intermediates belong to the selected project. Do not copy project metadata between IDs by string substitution.
- `library.ts` owns persistent cast/brand records independently from per-project Character records. Use the `cast_*` and `brand_*` actions for reusable records; a project character is not automatically written back to the global library.
- `studio.run`/`watch` can orchestrate multiple substeps. Inspect its `run_cost`/step state before starting, and check `needs_approval` as part of the returned state.
- `resumeJobs()` is used for persisted jobs after restart. If a job is still pending, query/reconcile its server status instead of launching a duplicate.
- Workspace video projects are data, not a source-code tree. Clean-up/removal is destructive and should use explicit project deletion with the correct ID and user intent.


## Failure triage
| Symptom | Likely issue | Next safe check |
|---|---|---|
| Estimate reports missing input | Shot lacks a required image/video/audio/anchor or model mapping | Inspect the shot and model `needs`; add a correct input/default, then estimate again. |
| Synced model refuses to generate | Required provider field cannot be synthesized from neutral inputs | Hydrate/read schema; add a curated manifest with actual mapping/defaults. |
| “Video URL is invalid” | Provider expected a reachable URL, received a local path/base64 URL | Check local-input upload/host step; current source uploads local media to fal CDN. |
| Job remains pending | Provider queue/host/drain/poll state | Inspect job/request ID and provider status; don't duplicate the shot/job. |
| Actual spend differs from quote | Estimated price, output count, or provider billing payload differs | Reconcile project ledger and explicit provider billing fields; report quote vs actual separately. |
| Trend extraction/write fails on Windows | Absolute generated frame path exceeds classic MAX_PATH | Measure resolved full path; use shorter workspace and IDs. |
| Model list changed unexpectedly | fal sync/cache or user manifest import affected catalog | Inspect source/manifest status; confirm project model ID still resolves and inputs remain curated. |
| Retry created duplicate takes | New request used instead of original shot/job ID | Inspect project jobs/shots and reuse existing pending/failed target where supported. |
| Old behavior persists after a fix | Old draining gateway/worker still owns the port | Identify listener PID, stop only intended obsolete host under approved workflow, verify replacement. |
| Output is correct but render hangs | Timeline/export ffmpeg filter path or bounded export timeout | Reproduce with the same number of clips/audio tracks and inspect render logs. |

## Regression targets
- `src/media-engine/fal-catalog.regression.ts`: schema hydration/unmapped fields and catalog handling.
- `src/media-engine/fal-synced-models.regression.ts`: synced model inputs/pricing behavior.
- `src/media-engine/video-project-tool.regression.ts`: top-level tool/action contract and paid/read action separation.
- `src/media-engine/video-engine-9.regression.ts`: recent audit fixes and end-to-end engine behavior.
- `src/media-engine/library.regression.ts`: cast/brand persistence and library behavior.
- `src/media-engine/ratelimit.regression.ts`: provider request throttling/limits.
- `src/media-engine/video-cleanup.regression.ts`: project media/job cleanup behavior.
- Search [`generated/tests.md`](generated/tests.md) for current path/command references; do not infer an `npm test` script from a regression filename.
