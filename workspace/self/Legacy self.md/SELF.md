# SELF.md - Prometheus Self-Reference (Current)

> **Split copy available:** A per-section split of this document lives at [`self/`](self/index.md) relative to the active workspace/root view — start at `self/index.md` for the section→file map. Some older notes may refer to this as `workspace/self/` or `workspace/SELF.md`; in this runtime those resolve to the same workspace-root material. Use the split files when you only need to read or edit a single area; this monolithic file remains intact as the historical source-of-truth and sync target.

Last verified against `src/`, `web-ui/`, route/tool definitions, config defaults, current package metadata, Brain runner skill-curator behavior, and Hub curator UI on: 2026-05-20
Workspace: `D:\Prometheus\workspace`
Project root: `D:\Prometheus`

This file is the current source-verified architecture reference for Prometheus.
It is meant to replace older notes that assumed a smaller tool surface, proposal-only editing, or pre-browser-mode behavior.

## 1) Core Identity

- Name: Prometheus
- Package version: `1.0.4`
- Runtime stack: Node.js + TypeScript
- Dev entry path: `tsx src/cli/index.ts`
- Gateway entry: `src/gateway/server-v2.ts`
- Main chat runtime: `src/gateway/routes/chat.router.ts`
- Default local gateway endpoint: `http://127.0.0.1:18789`
- Canonical code truth: `src/` for backend/runtime, `web-ui/` for frontend
- `dist/` may exist, but architecture and behavior should always be verified from source, not build output

Current package build facts:

- `npm run build` runs `npm run build:backend && npm run build:web`
- `npm run build:backend` runs `tsc && node scripts/copy-creative-renderers.js`
- `npm run build:web` currently delegates to `npm run check:web-ui`
- backend TypeScript targets ES2022/CommonJS with source maps, declarations, and `src/` as the root

## 2) Startup, Config Root, and Workspace Resolution

- Config/workspace resolution is centralized in `src/config/config.ts`
- Config dir precedence:
  - `PROMETHEUS_DATA_DIR/.prometheus`
  - project-local `.prometheus/`
  - `~/.prometheus/`
- Default workspace path is sibling to the config dir unless `PROMETHEUS_WORKSPACE_DIR` overrides it
- Legacy `.localclaw` data is migrated forward into `.prometheus`
- Default config version in source is `1.0.2`

## 3) Canonical Runtime Surfaces

- `src/gateway/core/startup.ts` owns startup boot orchestration
- `src/gateway/routes/chat.router.ts` owns `/api/chat`, tool loop execution, plan discipline, SSE streaming, browser/vision nudges, and mode-specific prompting
- `src/gateway/session.ts` owns session history, rolling compaction, rolling summaries, workspace binding, and persisted `creativeMode`
- `src/gateway/prompt-context.ts` builds the dynamic tool/memory/project prompt blocks
- `src/gateway/tool-builder.ts` assembles the tool surface from core tools, category tools, connector tools, composites, and MCP tools
- `src/gateway/browser-tools.ts` is the browser automation/runtime state system
- `src/gateway/routes/canvas.router.ts` owns canvas files, Creative mode state, Creative assets, HTML Motion, render jobs, scene save/export, and creative project publishing
- `src/gateway/tasks/background-task-runner.ts` is the autonomous task executor
- `src/gateway/mcp-manager.ts` is the MCP client/config manager
- `src/gateway/comms/telegram-channel.ts` is the canonical Telegram bridge and command handler
- `src/gateway/routes/account.router.ts` owns Supabase account login, encrypted persisted sessions, subscription checks, and account access gating
- `src/gateway/routes/hub.router.ts` powers the Hub usage page for skill usage, tool heatmaps, skill content previews, and achievement stubs
- `src/gateway/routes/obsidian.router.ts` owns the local Obsidian bridge API
- `src/gateway/routes/migration.router.ts` owns legacy workspace/data migration previews and execution
- `src/gateway/routes/processes.router.ts` exposes the managed process supervisor API
- `src/gateway/routes/coding.router.ts` exposes coding workspace/session, diff, branch, stage, and commit operations
- `src/gateway/routes/onboarding.router.ts` owns account-scoped onboarding/tutorial/model/memory-seed state

## 3A) Account/Auth Gate and Router Mounting

The gateway now mounts almost all application routes behind both gateway auth and account entitlement checks in `src/gateway/server-v2.ts`.

Account facts from `src/gateway/routes/account.router.ts`:

- Supabase sessions are kept in memory and persisted encrypted through the vault key `account.supabase.session`
- legacy `auth-session.json` is migrated into the vault and removed
- access requires either `subscriptionActive` or `isAdmin`
- subscription checks look for Supabase subscription statuses `active` or `trialing`
- cached subscription state has a five-minute refresh TTL
- `/api/account/status?strict=1` performs a blocking verification/refresh path
- expired sessions with refresh tokens are refreshed optimistically in normal status checks

Account routes currently include:

- `GET /api/account/config`
- `GET /api/account/status`
- `POST /api/account/login`
- `POST /api/account/login/password`
- `POST /api/account/logout`
- `POST /api/account/refresh`

WebSocket connections are also closed with policy code `1008` when the account is not logged in or lacks an active subscription/admin entitlement.

Account-entitled router mounts currently include:

- skills, tasks, channels, teams, settings, goals, proposals, audit log, connections, extensions
- canvas, projects, memory, Obsidian, Hub, migration, processes, coding, chat, onboarding

## 3B) Mobile Pairing, QR Codes, HTTPS, and Tailscale Remote Access

Mobile pairing is implemented as a desktop-approved device enrollment flow, not as a shared browser login.

Canonical source files:

- backend store: `src/gateway/pairing/pairing-store.ts`
- backend REST routes: `src/gateway/routes/pairing.router.ts`
- gateway auth gate: `src/gateway/gateway-auth.ts`
- router mount order and HTTP/HTTPS listener setup: `src/gateway/server-v2.ts`
- HTTP/HTTPS server behavior and redirect handling: `src/gateway/core/server.ts`
- desktop Pairing settings UI: `web-ui/src/pages/SettingsPage.js`
- mobile PWA pairing UI: `web-ui/src/mobile/mobile-pages.js`
- generated public UI mirrors: `generated/public-web-ui/static/pages/SettingsPage.js` and `generated/public-web-ui/static/mobile/mobile-pages.js`

Current pairing model:

- `POST /api/pairing/qr` creates a short-lived pairing challenge, returns an SVG QR, a `pairUrl`, and a human `pairCode`.
- The QR URL encodes the long random challenge code as `/?pair=<code>#mobile/pair`.
- The desktop UI also displays a human code such as `PAIR-Q4SD-4HZ2`.
- `getChallengeByCode(...)` accepts the long QR code, `PAIR-XXXX-XXXX`, `PAIRXXXXXXXX`, or just `XXXXXXXX`.
- Mobile claims the challenge through `POST /api/pairing/claim`.
- The claim creates a pending desktop approval request and broadcasts `pairing_pending`.
- Desktop approval calls `POST /api/pairing/approve`.
- Mobile polls `GET /api/pairing/poll/:requestId` until approval returns a one-time plaintext `deviceToken`.
- The phone stores the token in localStorage as `pm_device_token`; later mobile API calls send it as `X-Pairing-Token`.
- Paired devices are persisted in `.prometheus/paired-devices.json` with token hashes only, not plaintext tokens.
- Pairing challenges and pending requests are in-memory only; they intentionally expire and do not survive gateway restarts.
- Challenge TTL is five minutes; pending request TTL is ten minutes.
- Device revocation/removal happens through `PATCH/DELETE /api/pairing/devices/:id`.

Important auth/mounting behavior:

- `pairingRouter` must be mounted before any `app.use('/', requireGatewayAuth, ...)` router group in `src/gateway/server-v2.ts`.
- Express middleware attached as `app.use('/', requireGatewayAuth, accountRouter)` runs before route matching inside `accountRouter`; placing it before pairing will block `/api/pairing/claim` with `Unauthorized: configure gateway.auth.token to enable remote access`.
- `src/gateway/gateway-auth.ts` intentionally lets these account bootstrap routes through without a gateway token: `GET /api/account/config`, `GET /api/account/status`, `POST /api/account/login`, and `POST /api/account/login/password`.
- `gateway-auth.ts` verifies `X-Pairing-Token` and `?pt=` before checking the configured gateway token. This lets approved mobile devices work over LAN or Tailscale even when `gateway.auth.token` is absent.
- Non-loopback, unpaired API access is still blocked when no gateway auth token is configured.
- `POST /api/pairing/claim` also checks the server-side Prometheus account session via `getSessionStatus()` and requires `authenticated && (subscriptionActive || isAdmin)`. Pairing is therefore "phone logs into Prometheus account, then desktop approves the device."

iOS/Safari/PWA behavior that drove the dual route:

- iOS Safari and an Add-to-Home-Screen PWA do not reliably share the same browser storage container.
- A user can be logged in and paired in Safari, add the app to the Home Screen, and then find the Home Screen app starts with fresh storage.
- Scanning a QR with the iPhone Camera app opens Safari, not the already-installed Home Screen PWA.
- For that reason pairing must support both QR scanning and manual pair-code entry inside the Home Screen app.
- The mobile pair page with no `?pair=` code shows a pair-code input and internally redirects to `/?pair=<typedCode>#mobile/pair` so the normal claim/login/approval path is reused.
- If the phone already has a valid token, `/api/pairing/me` skips the pairing dance and navigates to mobile chat.
- On approval, mobile writes `pm_force_mobile=1` as a sticky mobile-mode hint so refresh/restart recovery does not dump the phone into the desktop UI.

LAN, HTTPS, and camera constraints:

- Plain LAN pairing requires `gateway.host` to be `0.0.0.0` or `::`; `127.0.0.1` only works from the desktop itself.
- Current local config has `gateway.host: "0.0.0.0"`.
- Safari browser camera/microphone APIs require a secure context. Plain `http://<LAN-IP>:18789` can load the app, but in-browser camera scanning and reliable mobile microphone capture need HTTPS.
- Gateway HTTPS is configured under `gateway.https` and served by a second listener from `server-v2.ts` when a PFX or key/cert exists.
- Current local config has HTTPS enabled on port `18790` with `certs/gateway-mobile.pfx` and passphrase `prometheus-local-dev`.
- `GET /api/pairing/certificate` serves the configured `.cer` file for installing/trusting the local gateway certificate on mobile devices.
- When HTTPS is enabled, `_resolvePairingOrigin(...)` prefers `https://<LAN-IP>:<httpsPort>` for generated QR URLs unless remote access overrides it.
- The plain HTTP listener redirects non-API/static GETs to HTTPS when an HTTPS listener exists.
- `core/server.ts` must not redirect requests that arrived through an HTTPS-terminating proxy. It checks `x-forwarded-proto: https` so Tailscale Funnel public HTTPS requests are not redirected to an unreachable local `:18790` URL.

Tailscale / remote access model:

- Remote access is an optional layer on top of local pairing, not a replacement for device approval.
- Config lives at `gateway.remoteAccess`.
- Defaults in `src/config/config.ts`: `{ enabled: false, mode: "tailscale-funnel", publicUrl: "" }`.
- Current local config has remote access enabled with mode `tailscale-funnel` and public URL `https://fonso-pc.tailca7310.ts.net`.
- When remote access is enabled with a valid `https://` origin, `/api/pairing/qr` encodes that public URL in the QR instead of the LAN IP.
- The response still includes `lanOrigins` for visibility and fallback.
- `GET /api/pairing/remote-access` reports current remote access config.
- `PUT /api/pairing/remote-access` saves `{ enabled, mode, publicUrl }` after validating that enabled remote access uses a full HTTPS origin.
- `GET /api/pairing/tailscale/status` shells out to the local `tailscale` CLI, checks `tailscale version`, parses `tailscale status --json`, suggests `https://<Self.DNSName>`, and inspects `tailscale funnel status` for active localhost ports.
- The Settings Pairing UI has a Detect Tailscale action, a "Use this URL" helper, and tells the user to run a command like `tailscale funnel <port>` when Funnel is not active.
- If remote access is on, the Pairing UI shows a "Remote access ON" badge and generates a new QR against the public URL.

Security sharp edge to preserve:

- `pairingRouter` is currently mounted before gateway auth so unpaired phones can claim challenges.
- That also means remote-access configuration/device-management endpoints in the pairing router are not individually protected by `requireGatewayAuth` at the router mount layer.
- Do not casually expose a Funnel/public URL without understanding this. A hardening pass should make desktop management endpoints loopback/account-gated while keeping only `qr`, `claim`, `poll`, certificate download, and `me` available as needed for pairing.
- A leaked QR/human code is not a credential by itself because desktop approval is still required, but it can create pending approval prompts.

Self-edit verification checklist for pairing/remote access:

- After changing `src/gateway/*` TypeScript, run `npm run build:backend` or `npm run build`; the live gateway often serves `dist/gateway/server-v2.js`, so source edits alone are not live.
- After changing `web-ui/src/*`, run `npm run sync:web-ui` and `npm run check:web-ui` or `npm run build`.
- If the running gateway is serving generated web files on Windows, stop it before `npm run sync:web-ui` if generation fails with `EBUSY`.
- Restart the gateway after backend changes.
- Smoke-test QR creation: `POST http://127.0.0.1:18789/api/pairing/qr` should return `pairUrl`, `pairCode`, `lanOrigins`, `remoteAccess`, and `qrSvg`.
- Smoke-test manual code claim from the phone/LAN origin by posting `{ code: pairCode, deviceName, deviceFingerprint }` to `/api/pairing/claim`; it should return `{ success: true, requestId, expiresAt }`.
- Clean up smoke-test pending requests with `/api/pairing/deny`.
- Verify protected LAN APIs still return 401 without `X-Pairing-Token`.
- Verify an approved mobile token reaches protected APIs through `X-Pairing-Token`.
- Verify old QR pages are not reused after challenge expiration or gateway restart.

## 4) Execution Modes

`chat.router.ts` currently recognizes these execution modes:

- `interactive`
- `background_task`
- `proposal_execution`
- `background_agent`
- `heartbeat`
- `cron`
- `team_manager`
- `team_subagent`

Important behavior:

- `interactive` is the only mode that reads the persisted session `creativeMode`
- Non-interactive modes use the scoped session workspace when present
- `background_agent` uses `bg_plan_declare` / `bg_plan_advance`
- `proposal_execution` gets stricter edit instructions and mutation scoping
- `team_manager` and `team_subagent` are separate runtime identities, not just labels
- `heartbeat` is intentionally terse and continuation-oriented

## 5) Prompt Assembly and Runtime Overlays

Prometheus currently builds the live prompt from these layers:

- execution-mode system block
- core system policy block
- recent tool log block, except in creative mode
- caller context
- active browser/session context when relevant
- personality context from `buildPersonalityContext(...)`
- project context when the session is project-bound
- skills runtime directives

Context profiles currently include:

- `default`
- `switch_model`
- `local_llm`
- `creative_design`
- `creative_image`
- `creative_canvas`
- `creative_video`
- `teach_mode`

Teach mode is not a separate execution mode. It is activated when caller context contains `[TEACH_SESSION]`, which switches prompt profile behavior to `teach_mode`.

## 6) Creative Modes

Creative mode is a persisted per-session field in `session.ts`.
Current supported values:

- `design`
- `image`
- `canvas`
- `video`

How it behaves now:

- entered with `enter_creative_mode` / `switch_creative_mode`
- exited with `exit_creative_mode`
- inspected with `get_creative_mode`
- stored on the session as `creativeMode`
- broadcast to the UI when changed
- shortens the history window for API calls; isolated Creative Runtime uses a compact creative handoff instead of normal chat history
- suppresses recent tool-log injection
- keeps a separate recent creative tool-log/reference image context for image/canvas/video work
- suppresses normal plan-first behavior unless the user explicitly asks for a plan
- makes canvas/creative output the primary workspace in the system prompt

This is real session state, not just UI chrome.

Creative prompt profiles exist in `src/gateway/prompt-context.ts` for:

- `creative_design`
- `creative_image`
- `creative_canvas`
- `creative_video`

Creative Runtime isolated mode in `chat.router.ts` is active for `image`, `canvas`, and `video`. `canvas` is treated as a legacy alias for the image/canvas lane. The runtime exposes a narrowed allowlist of creative tools plus skill tools so creative turns stay focused on scene creation, visual QA, asset handling, and export rather than general tool noise.

## 6A) Creative Runtime and Scene Graph

The editable Creative scene graph is shared across image/canvas/video workflows.
Source areas:

- backend contracts: `src/gateway/creative/contracts.ts`
- backend creative routes and tool handlers: `src/gateway/routes/canvas.router.ts`
- frontend scene graph/rendering: `web-ui/src/components/creative/sceneGraph.js`
- frontend motion template client: `web-ui/src/components/creative/motionTemplates.js`
- frontend audio engine: `web-ui/src/components/creative/audioEngine.js`
- frontend export engine: `web-ui/src/components/creative/exportEngine.js`
- render jobs: `web-ui/src/components/creative/renderJobs.js`

Core scene document fields include:

- `id`
- `version`
- `width`
- `height`
- `background`
- `durationMs`
- `frameRate`
- `audioTrack`
- `elements`
- `motionTemplates`
- `captions`
- `brandKit`
- `selectedId`

Editable element types currently exposed to the agent include:

- `text`
- `shape`
- `icon`
- `image`
- `video`
- `hyperframes`
- `group`
- `caption`

Common element/layer properties include:

- `id`
- `type`
- `x`, `y`, `width`, `height`
- `rotation`
- `opacity`
- `locked`
- `visible`
- `zIndex`
- `meta`
- `timelineStartMs`
- `timelineDurationMs`
- `keyframes`
- effects, masks, blend modes, clip metadata, and brand binding where relevant

Shape kinds advertised through the creative libraries include:

- `rect`
- `circle`
- `triangle`
- `polygon`
- `line`
- `arrow`

The runtime accepts arbitrary Iconify names for icon layers through `meta.iconName`.
Known useful namespaces:

- `lucide:*`
- `solar:*`
- `mdi:*`
- `tabler:*`
- `ph:*`
- `heroicons:*`
- `simple-icons:*`
- `logos:*`

Creative layer/timeline/edit tools include:

- `creative_list_references`
- `creative_get_state`
- `creative_reset_scene`
- `creative_purge_scene`
- `creative_element_inventory`
- `creative_frame_trace`
- `creative_frame_diff`
- `creative_history_status`
- `creative_undo`
- `creative_redo`
- `creative_checkpoint`
- `creative_export_trace`
- `creative_apply_ops`
- `creative_select_element`
- `creative_set_canvas`
- `creative_add_element`
- `creative_update_element`
- `creative_delete_element`
- `creative_arrange`
- `creative_apply_style`
- `creative_apply_animation`
- `creative_search_icons`
- `creative_search_animations`
- `creative_add_effect`
- `creative_set_blend_mode`
- `creative_add_mask`
- `creative_trim_clip`
- `creative_apply_brand_kit`
- `creative_fit_asset`
- `creative_apply_template`
- `creative_validate_layout`
- `creative_quality_report`
- `creative_render_snapshot`
- `creative_export`
- `creative_save_scene`
- `creative_timeline`
- `creative_measure_text`
- `creative_text_fit_report`
- `creative_list_templates`
- `creative_create_from_template`
- `creative_list_motion_templates`
- `creative_preview_motion_template`
- `creative_apply_motion_template`
- `creative_generate_motion_variants`
- `creative_save_html_motion_template`
- `creative_save_html_motion_block`
- `creative_promote_scene_to_template`
- `creative_list_library_packs`
- `creative_create_library_pack`
- `creative_toggle_library_pack`

First-class HyperFrames tools now include:

- `hyperframes_browse_catalog`
- `hyperframes_insert_clip`
- `hyperframes_apply_patch`
- `hyperframes_set_text`
- `hyperframes_set_color`
- `hyperframes_set_timing`
- `hyperframes_set_variable`
- `hyperframes_set_asset`
- `hyperframes_add_animation`
- `hyperframes_lint`
- `hyperframes_qa`
- `hyperframes_materialize`
- `hyperframes_export`

Legacy HyperFrames compatibility tools remain:

- `creative_list_hyperframes_components`
- `creative_import_hyperframes_component`
- `creative_sync_hyperframes_catalog`
- `creative_apply_hyperframes_component`

Video-specific debug/QA aliases include:

- `video_render_frame`
- `video_render_contact_sheet`
- `video_analyze_frame`
- `video_analyze_timeline`
- `video_check_keyframes`
- `video_check_caption_timing`
- `video_check_audio_sync`
- `video_extract_clip_frames`
- `video_analyze_imported_video`

Image/canvas QA aliases include:

- `image_get_element_at_point`
- `image_get_overlaps`
- `image_get_bounds_summary`
- `image_check_text_overflow`
- `image_check_contrast`
- `image_detect_empty_regions`

Current animation preset IDs visible through the Creative runtime include:

- `fade_in`
- `slide_up`
- `fade_slide_up`
- `scale_pop`
- `blur_in`
- `typewriter`
- `slide_down`
- `slide_left`
- `slide_right`
- `bounce_in`
- `zoom_in`
- `spin_in`
- `elastic_pop`
- `drop_in`
- `rise_float`
- `fade_out`
- `slide_out_*`
- `scale_out`
- `blur_out`
- `pulse`
- `shake`
- `float_up`
- `glitch_in`
- `soft_blur_in`
- `rise_fade`
- `cascade_in`
- `stamp_in`
- `wipe_reveal`
- `punch_zoom`
- `parallax_drift`
- `light_sweep`

Current Creative library packs in `canvas.router.ts` include:

- `core-foundation`
- `iconify-essentials`
- `motion-core`
- `components-core`
- `shapes-extended`
- `motion-expressive`
- `iconify-ui-pack`
- `iconify-brand-pack`
- `components-story-pack`

## 6B) Creative Assets, Uploads, and Media Intake

Creative asset handling is implemented in:

- `src/gateway/creative/assets.ts`
- `src/gateway/routes/canvas.router.ts`

Asset tools include:

- `creative_import_asset`
- `creative_analyze_asset`
- `creative_search_assets`
- `creative_generate_asset`
- `creative_add_asset`
- `creative_attach_audio_from_url`
- `creative_attach_audio_from_file`
- `creative_extract_layers`
- `creative_render_ascii_asset`

Additional creative asset/model routes now expose:

- `GET /api/canvas/creative-assets`
- `GET /api/canvas/creative-asset-index`
- `POST /api/canvas/creative-assets/import`
- `POST /api/canvas/creative-assets/analyze`
- `POST /api/canvas/creative-assets/generate`
- `POST /api/canvas/creative-extract-layers`
- `POST /api/canvas/creative-layer-assets`
- `POST /api/canvas/creative-refine-mask`
- `GET /api/canvas/creative-model-status`
- `GET /api/canvas/creative-audio-analysis`

Asset records may contain:

- `id`
- `kind`
- `name`
- `ext`
- `source`
- `sourceType`
- `path`
- `relativePath`
- `absPath`
- `mimeType`
- `size`
- `width`
- `height`
- `durationMs`
- `frameRate`
- `codec`
- `hasAlpha`
- `hash`
- `thumbnailPath`
- `thumbnailAbsPath`
- `tags`
- `brandId`
- `license`
- `metadata`

Layer asset extraction/export facts from 2026-05-13:

- Image mode now supports saving individual visible scene layers as transparent PNG assets.
- The Web UI exposes this as `Save layer PNGs` and `Save selected` in the Image canvas layer/export surfaces.
- Browser-side layer rasterization lives in `web-ui/src/pages/ChatPage.js` and mirrored public UI output under `generated/public-web-ui/static/pages/ChatPage.js`.
- The backend save/index route is `POST /api/canvas/creative-layer-assets` in `src/gateway/routes/canvas.router.ts`.
- Layer PNGs are written under the current Creative asset library at `prometheus-creative/assets/layers/<batch>/`.
- Saved layer records are indexed by `src/gateway/creative/assets.ts` with tags including `layer-asset` and `extracted-layer`.
- Layer asset metadata includes `metadata.layerAsset` with source element id/type, source scene id, source mode, dimensions, and export timestamp.
- In the UI, saved layer PNGs appear under `Saved assets -> Layer assets`; image layer assets can be placed back onto the Image canvas as editable `image` elements.
- This complements `creative_extract_layers`: extraction turns flat/source images into editable scene layers, while layer asset saving turns those scene layers into reusable PNG assets for later apps, websites, videos, or other Creative scenes.

Upload routes in `canvas.router.ts` save files into `workspace/uploads/`.
Telegram and Web UI attachment issues should be debugged against this shared upload path first, not per-channel assumptions.

Important asset-path truth from 2026-04-29:

- HTML motion manifests can carry assets under `source`, `path`, `absPath`, `url`, or `dataUrl`.
- Manifest assets are normalized on create and, after the 2026-04-29 fix, after patch operations too.
- The HTML motion asset route now falls back to `asset.source` if older manifests lack `asset.path`/`asset.absPath`.
- HTML clips must reference assets with `{{asset.id}}` placeholders, never raw absolute Windows paths.
- Broken image boxes in HTML motion usually mean the manifest asset did not normalize or the placeholder did not resolve through `/api/canvas/html-motion-clip/asset`.

Media-aware creative rule:

- If a user attaches an image or video, Prometheus should import/analyze it before placing it.
- Images should be inspected for subject, text, crop-safe regions, busy regions, brand elements, transparency, and contrast needs.
- Videos should be inspected for duration, orientation, key moments, dead air, visible text, transcript/audio quality, and candidate in/out points.
- For long-video clipping, Prometheus should build an edit decision list before composing the final video.

## 6C) Creative Video and Editing Capabilities

Video creative mode is first-class.
It supports:

- editable scene graph video timelines
- multi-clip composition timelines with video/audio/caption tracks
- Remotion motion templates
- HTML Motion clips
- source-backed HyperFrames clips
- HTML Motion deterministic frame sequence MP4 export
- browser MediaRecorder-style export path for scene graph output
- audio track config and analysis
- frame snapshots and contact sheets
- QA reports

Video/audio structures exist in:

- `src/gateway/creative/audio.ts`
- `src/gateway/creative/composition.ts`
- `src/gateway/creative/renderers/composition_renderer.ts`
- `web-ui/src/components/creative/audioEngine.js`
- `web-ui/src/components/creative/exportEngine.js`

Audio track config supports:

- `source`
- `label`
- `startMs`
- `durationMs`
- `trimStartMs`
- `trimEndMs`
- `volume`
- `muted`
- `fadeInMs`
- `fadeOutMs`
- analysis/waveform metadata

Clip trimming and speed metadata are exposed through `creative_trim_clip`, which maps to `apply_ops` with `set-clip` and supports:

- `startMs`
- `endMs`
- `durationMs`
- `trimStartMs`
- `trimEndMs`
- `speed`
- `loop`

The multi-clip composition model is separate from the scene-graph element timeline.
Source-backed composition clips currently use lanes:

- `html-motion`
- `remotion`

Composition track kinds currently include:

- `video`
- `audio`
- `caption`

Composition tools currently include:

- `creative_composition_get`
- `creative_composition_add_track`
- `creative_composition_add_clip`
- `creative_composition_move_clip`
- `creative_composition_trim_clip`
- `creative_composition_split_at`
- `creative_composition_delete_clip`
- `creative_composition_set_transition`
- `creative_composition_select_clip`
- `creative_composition_lint`
- `creative_composition_render`
- `creative_composition_save`

Composition routes in `canvas.router.ts` currently include:

- `GET /api/canvas/composition`
- `POST /api/canvas/composition`
- `POST /api/canvas/composition/render`
- `POST /api/canvas/composition/lint`

For CapCut-like workflows, current Prometheus pieces are:

- `analyze_video` for source analysis/transcript/frame sampling
- `video_extract_clip_frames` and `video_render_contact_sheet` for visual review
- `creative_import_asset` / `creative_analyze_asset` for asset registration
- `creative_add_asset` for scene graph placement
- `creative_trim_clip` for source range/speed/loop metadata
- HTML Motion `video` elements with `data-start`, `data-duration`, `data-trim-start`, and `data-offset`
- frame QA before export

Current limitation:

- HTML Motion MP4 export is strongest for visual composition and deterministic frame output.
- If preserving, mixing, or ducking source audio matters, verify audio sync and use the broader audio/video path or add an explicit muxing step.
- Scene-graph video render jobs are now tracked under `prometheus-creative/render-jobs`, but the agent still needs to inspect rendered frames directly before declaring video work finished.

## 6D) HTML Motion and HyperFrames

HTML Motion is the strongest current path for polished promo/ad/product-demo clips.
Source areas:

- `src/gateway/creative/html-motion-templates.ts`
- `src/gateway/creative/html-motion-blocks.ts`
- `src/gateway/creative/html-motion-spec.ts`
- `src/gateway/creative/html-motion-adapters.ts`
- `src/gateway/creative/ascii-html-motion.ts`
- `src/gateway/creative/ascii-render-runtime.ts`
- `src/gateway/creative/three-html-motion.ts`
- `src/gateway/creative/hyperframes-bridge.ts`
- `src/gateway/creative/hyperframes-catalog.ts`
- `src/gateway/creative/hyperframes-export-adapter.ts`
- `src/gateway/creative/hyperframes-producer.ts`
- `src/gateway/creative/hyperframes-qa.ts`
- `src/gateway/creative/renderers/ascii_renderer.py`
- `src/gateway/routes/canvas.router.ts`

HTML Motion tools include:

- `creative_list_html_motion_templates`
- `creative_apply_html_motion_template`
- `creative_create_html_motion_clip`
- `creative_save_html_motion_template`
- `creative_save_html_motion_block`
- `creative_promote_scene_to_template`
- `creative_read_html_motion_clip`
- `creative_patch_html_motion_clip`
- `creative_restore_html_motion_revision`
- `creative_lint_html_motion_clip`
- `creative_list_html_motion_blocks`
- `creative_render_html_motion_block`
- `creative_render_html_motion_snapshot`
- `creative_export_html_motion_clip`

HTML Motion route surface also includes `/api/canvas/html-motion-clip/export-folder` when a folder export is needed.

HTML Motion files are saved under:

- `workspace/creative-projects/<session>/prometheus-creative/html-motion/*.html`
- sibling manifest: `*.json`
- revisions: `html-motion/revisions/<clip-id>/`
- exports: `prometheus-creative/exports/*.mp4`

HTML Motion clips are self-contained HTML/CSS/JS documents with fixed dimensions and metadata.
Supported deterministic timing attributes:

- `data-start`
- `data-duration`
- `data-end`
- `data-trim-start`
- `data-offset`

Timing values:

- bare numeric values are milliseconds
- values suffixed with `s` are seconds
- values suffixed with `ms` are milliseconds

Deterministic seek hooks:

- `window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__`
- `window.__PROMETHEUS_HTML_MOTION_TIME_MS__`
- `prometheus-html-motion-seek` browser event

HTML Motion linting:

- validates dimensions, duration, timing, asset placeholders, and composition metadata
- `creative_read_html_motion_clip` returns lint/composition metadata
- after the 2026-04-29 fix, `creative_lint_html_motion_clip` can ask the active clip for lint data instead of requiring raw HTML

HTML Motion snapshot/export path:

- preview route renders the HTML with placeholders resolved to served asset URLs
- snapshot route opens the preview in Playwright and captures selected frames
- MP4 export renders a deterministic frame sequence and encodes with FFmpeg
- normal HTML Motion export should use about 30fps and a practical `maxFrames` budget
- `forceHighFps` should be reserved for deliberate high-fps renders

HTML Motion export hardening added on 2026-04-29:

- default practical frame-rate behavior
- `maxFrames` budget
- per-frame seek/screenshot timeouts
- FFmpeg timeout protection
- progress broadcasts via `creative_html_motion_export_progress`
- consistent millisecond timing parsing
- asset fallback to `source` for older manifests

ASCII/adapter lane added by current source:

- HTML Motion can now use ASCII source canvases and source-backed ASCII render assets.
- The Python ASCII renderer lives under `src/gateway/creative/renderers/ascii_renderer.py`.
- `creative_render_ascii_asset` renders/registers ASCII-style assets for use in Creative/HTML Motion work.
- New HTML Motion templates and blocks below should be preferred for ASCII cinema, cyber poster, and source-backed glyph-video requests.

Three.js HTML Motion blocks are implemented in `src/gateway/creative/three-html-motion.ts`.
Current built-ins include:

- `three-particle-field`
- `three-logo-reveal`
- `three-device-stack`
- `three-gltf-turntable`

These use local vendor routes under `/api/canvas/vendor/three/...` and are intended for deterministic frame seeking through the HTML Motion seek bridge.

HyperFrames integration:

- External HyperFrames skills are installed as bundled skills/resources, but Prometheus now also has first-class in-app HyperFrames tools.
- The local front-door skill is `prometheus-creative-mode`. Use `hyperframes`, `hyperframes-cli`, `hyperframes-registry`, `gsap`, `animejs`, `css-animations`, `lottie`, `three`, `waapi`, `tailwind`, and related adapter skills only when their exact domain is needed.
- HyperFrames is now a first-class Creative Video source model, not only an HTML Motion compatibility import.
- `CreativeClipLane` includes `hyperframes` in `src/gateway/creative/contracts.ts`.
- `CreativeClipSource` includes `{ kind:"hyperframes", html?, projectPath?, entryFile?, compositionId?, variables? }`.
- `src/gateway/creative/composition.ts` accepts native `hyperframes` clips in add/lint paths and validates that they have either inline source HTML or project metadata.
- `src/gateway/creative/renderers/composition_renderer.ts` can render `lane:"hyperframes"` clips directly by loading inline HTML or `projectPath/entryFile`, wrapping with `wrapForIframePreview`, seeking `window.__hf.seek(...)`, dispatching `hf-seek` and `prometheus-html-motion-seek`, and screenshotting frames.
- `hyperframes_browse_catalog` should be preferred before creating HyperFrames videos so agents choose validated catalog blocks/components.
- `hyperframes_insert_clip` creates a source-backed editable clip in active Video mode and persists normalized source at `.prometheus/creative/hyperframes-projects/<composition-id>/index.html` under the current creative storage root.
- `hyperframes_apply_patch` and the `hyperframes_set_*` helpers mutate extracted inner layers/slots/variables.
- `hyperframes_lint`, `hyperframes_qa`, `hyperframes_materialize`, and `hyperframes_export` keep the lint/QA/export path attached to the source-backed clip.
- `hyperframes_export` prefers `@hyperframes/producer`; use `engine:"html-motion"`, `renderer:"html-motion"`, or `producer:false` only for explicit legacy fallback.
- `src/gateway/creative/hyperframes-export-adapter.ts` now builds native `lane:"hyperframes"` clips for render/composition paths while retaining materialized HTML Motion metadata only as fallback data.
- `src/gateway/creative/hyperframes-producer.ts` writes an iframe/producer-bridge wrapper around normalized source and must pass `fps` as a HyperFrames rational object such as `{ num: 30, den: 1 }`, not a plain number. This is required by `@hyperframes/producer@0.6.20`.
- `src/gateway/creative/hyperframes-bridge.ts` mirrors width/height onto both `data-composition-width` / `data-composition-height` and `data-width` / `data-height`; the current HyperFrames compiler reads `data-width` and `data-height` for authored dimensions.
- `scripts/patch-hyperframes-esm.mjs` is still needed after install because the installed HyperFrames ESM bundles have extensionless imports in some dist files. `scripts/postinstall.js` runs it best-effort; run `npm run patch:hyperframes-esm` if producer imports fail with `ERR_MODULE_NOT_FOUND`.
- Legacy `creative_*_hyperframes_component` tools still import catalog entries into HTML Motion templates/blocks for compatibility.
- Do not assume external HyperFrames CLI is installed unless the user explicitly asks for a standalone HyperFrames project.

HyperFrames canvas/editor behavior added in May 2026:

- `web-ui/src/components/creative/hyperframesController.js` mounts source-backed HyperFrames clips into iframe previews via `createHyperframesPreview`.
- If `element.meta.html` is missing, the controller now hydrates source HTML from `element.meta.projectPath + element.meta.entryFile` through `/api/canvas/file`; do not overwrite a project-backed clip with empty `html`.
- `web-ui/src/pages/ChatPage.js` passes both `post` and `get` API helpers into HyperFrames controllers so the preview can recover source-backed clips after session rehydrate.
- HyperFrames refresh/lint/QA/export/snapshot code paths should call the same source resolver (`ensureHyperframesElementSourceHtml`) so project-backed clips work even when the scene snapshot only stores `projectPath` and `entryFile`.
- A restored canvas showing only the small composition id text usually means the iframe did not get source HTML; inspect `meta.html`, `meta.projectPath`, and `meta.entryFile` before changing the clip.
- A blank Video scene with `elementCount:0`, `selectedId:null`, and `durationMs:12000` after HyperFrames export is a stale scene-sync signature. Current UI guards refuse that default blank overwrite while the same active Video scene has a source-backed HyperFrames clip, except for explicit reset/clear paths.
- Export should not replace or clear the active Creative scene. Producer writes an MP4 externally and updates `lastProducerExport`; the live scene should keep the HyperFrames element selected and visible.

HyperFrames verification checklist after self-editing this area:

- `npm run sync:web-ui`
- `npx tsc --noEmit --pretty false --incremental false`
- `node --check web-ui/src/pages/ChatPage.js`
- `node --check web-ui/src/components/creative/hyperframesController.js`
- `npm run build`
- Smoke the native composition renderer with a `lane:"hyperframes"` clip.
- Smoke `renderHyperframesWithProducer` and confirm logs show authored dimensions, e.g. `320x180` or project dimensions, and `fps:{num,den}`.

Relevant skills:

- `prometheus-hyperframes-bridge`
- `html-motion-video`
- `creative-director-video`
- `hyperframes`
- `gsap`
- `hyperframes-cli`
- `hyperframes-registry`
- `website-to-hyperframes`
- `remotion-to-hyperframes`
- `remotion-best-practices`
- `html-motion-preset-author`
- `holographic-globe-hyperframes-preset`

## 6D-1) Creative Generative Video Pipeline and 2026-05-20 Self-Edit Notes

The current Creative Video stack is not only scene-graph HTML Motion. It also has a Creative Generative Pipeline in `src/gateway/creative/generative-pipeline.ts`.

Use this pipeline when Raul asks for a complete generated video, promo, ad, avatar/voiceover clip, AI footage sequence, generated app/product shot, scene chaining, captions, HUD overlays, music/SFX, or a finished social video.

Primary source files:

- `src/gateway/creative/generative-pipeline.ts`
- `src/gateway/creative/assets.ts`
- `src/gateway/creative/audio.ts`
- `src/gateway/creative/composition.ts`
- `src/gateway/creative/contracts.ts`
- `src/gateway/creative/renderers/composition_renderer.ts`
- `src/gateway/tools/defs/creative-tools.ts`
- `src/gateway/agents-runtime/subagent-executor.ts`
- `src/gateway/routes/canvas.router.ts`

Project/planning tools in this lane:

- `creative_create_project`
- `creative_create_storyboard`
- `creative_write_shot_prompt`
- `creative_generate_sequence`
- `creative_generation_history`
- `creative_register_generation`
- `creative_select_best_take`
- `creative_compare_shots`

Generated image/video tools:

- `creative_generate_image_shot`
- `creative_generate_video_shot`
- `creative_refine_video_shot`
- `creative_retry_shot_until_pass`
- `creative_chain_scene`
- `creative_extract_video_frame`
- `creative_extract_video_frames`
- `creative_pick_continuity_frame`
- `creative_extract_layers_for_generation`
- `creative_analyze_generated_video`

Assembly/composition tools:

- `creative_stitch_clips`
- `creative_auto_assemble_rough_cut`
- `creative_render_generated_sequence`
- `creative_generate_motion_graphics_layer`
- `creative_overlay_hyperframes_on_video`
- `creative_composite_video_layers`
- `creative_validate_composition_layers`
- `creative_preflight_overlay`
- `creative_sample_composite_frames`

Audio/caption tools:

- `creative_import_audio`
- `creative_download_audio`
- `creative_extract_audio_from_video`
- `creative_generate_voiceover`
- `creative_transcribe_audio`
- `creative_sync_captions_to_audio`
- `creative_add_audio_track`
- `creative_mix_audio_tracks`
- `creative_add_music_bed`
- `creative_add_sound_effects`

Provider facts verified on 2026-05-20:

- OpenAI image generation works as a keyframe/source-image path when configured.
- xAI video generation works as the generated footage path through `generate_video` and Creative wrappers.
- xAI voiceover works through the xAI OAuth bridge or `XAI_API_KEY`; the implementation uses `getValidXAIToken(...)` when connected.
- OpenAI voiceover uses auth candidates from direct API keys, OpenAI OAuth `api_key`, and OpenAI OAuth `access_token` through `openAiVoiceAuthCandidates()`.
- OpenAI transcription should use the same auth-candidate bridge; do not route around it with shell commands or one-off API calls.
- Creative TTS must follow the same OAuth-bridge principle as Realtime voice, xAI dictation/search, and mobile/desktop voice flows: if the user connected OpenAI or xAI/Grok through OAuth, Creative voiceover should be able to use that connection without requiring a separate env var.
- A voice provider error like `OpenAI voice is not configured` is a product/auth-bridge bug when the corresponding OAuth connection is active elsewhere. Fix auth candidate resolution before asking Raul for keys.
- A voice error like `Voice 'alloy' not found`, `Voice 'cedar' not found`, or `Voice 'male' not found` means the tool guessed unsupported provider voice names. Creative voice tools need a provider voice discovery/status path or a provider-specific default list; agents should not brute-force voice names in user-facing workflows.
- If OpenAI TTS fails with a scope error such as missing `api.model.audio.request`, try xAI voiceover before declaring audio impossible.

Correct full-video production order:

1. Create or reuse a Creative project with `creative_create_project`.
2. Create a storyboard with `creative_create_storyboard` or derive one from the user brief.
3. Generate keyframes/opening frames when visual continuity matters.
4. Generate video shots.
5. Analyze generated shots before accepting them.
6. Retry/refine weak shots rather than accepting a broken first pass.
7. For continuation, extract multiple candidate frames and use `creative_pick_continuity_frame` instead of blindly using the last frame.
8. Select best takes and record lineage.
9. Assemble the base sequence with `creative_stitch_clips` or `creative_auto_assemble_rough_cut`.
10. Add voiceover, music, SFX, captions, HUD overlays, CTA cards, or lower thirds as separate Creative audio/layer assets.
11. Composite or mux final media through Creative tools.
12. QA with `video_analyze_imported_video`, sampled frames/contact sheets, audio stream metadata, and visible-scene checks before presenting.

Important 2026-05-20 test result:

- A four-scene Prometheus calorie-tracking app promo was successfully generated and presented.
- The reliable final visual file was `creative-projects/mobile_mpea7jgt_0a0nab/prometheus-creative/exports/prometheus-calorie-promo-stitch-clean.mp4`.
- QA verified four visible scenes: narrator/product intro, meal scan, mobile dashboard, CTA/outro.
- OpenAI-generated keyframes and xAI-generated video clips worked.
- xAI-generated voiceover existed, but the earlier overlay/composite path froze the visual base when muxing overlays/audio, so the broken overlay/audio composite was not presented.

PulseFit app test result from this same date/context:

- Creative project root: `creative-projects/9fe81950-4861-45fe-a2d3-6ae1524e8ea3/prometheus-creative/`.
- Source generated scene clips were the four xAI MP4 files in `prometheus-creative/assets/library/` with timestamps around `2026-05-20T01-34`, `01-36`, `01-37`, and `01-39`.
- The direct concat artifact that finally contained all four scenes was `prometheus-creative/exports/prometheus-pulsefit-all-4-clips-concat-copy.mp4`.
- Earlier or partial/bad outputs in the same exports folder included `prometheus-pulsefit-full-24s-composite-fixed.mp4`, `prometheus-pulsefit-full-promo-hyperframes.mp4`, `prometheus-pulsefit-rough-cut.mp4`, `prometheus-pulsefit-all-generated-scenes-combined.mp4`, and `prometheus-pulsefit-all-scenes-full-length.mp4`.
- `prometheus-pulsefit-full-24s-composite-fixed.mp4` sampled as a frozen/still final PulseFit hero image across the duration, so it should be treated as a failed composite even though a file existed.
- `prometheus-pulsefit-all-4-clips-concat-copy.mp4` sampled as a 24.17s, 720x1280, 24fps, roughly 19.4MB file with all four generated scenes and hard cuts. This was the verified visual truth for the PulseFit test.
- The visible Video canvas/editor showed generated media in the Assets panel but the timeline stayed blank. That is a separate editor-placement/state issue from asset generation and final media assembly; future fixes must ensure generated rough cuts or assembled clips are inserted as timeline clips, not merely registered as assets.

Failure pattern and fix from 2026-05-20:

- `creative_stitch_clips` and `creative_auto_assemble_rough_cut` are the reliable base assembly path for generated multi-shot footage.
- The old composite path built a preview HTML page containing `<video>` layers, then rendered that page through Playwright screenshots. This made base footage dependent on browser video seeking and could freeze the visual base on one scene.
- `creative_composite_video_layers` now has a fast path for a single full-frame video layer plus audio layers: it stream-copies the existing MP4 video and muxes audio internally with bundled FFmpeg. This preserves verified visuals and avoids browser re-rendering.
- Composite preview video seeking now waits for `requestVideoFrameCallback` when available before screenshots, so the captured frame is more likely to reflect the requested media time.
- Overlay iframes now receive local layer time (`timeline time - layer start + media start`) instead of raw global timeline time.
- Generated caption HTML now exposes standard seek hooks: `window.__promSeek`, `window.__hf.seek`, and `prometheus-html-motion-seek`.
- `creative_stitch_clips` now treats `transition:"cut"` as a real zero-duration cut in metadata instead of reporting a misleading fallback 500ms transition.

Operational rule for FFmpeg:

- Do not use `run_command` FFmpeg as the normal Creative media path.
- Prefer Creative tools that resolve workspace paths and use bundled FFmpeg internally.
- If a shell FFmpeg command seems necessary, first ask whether a Creative tool should exist or should be fixed.
- The 2026-05-20 failure showed shell FFmpeg/ffprobe returning `Invalid argument` on files that Creative's own analyzer could read, likely due shell/path/runtime context rather than missing files.
- Native tools should own these operations: stitching, audio extraction, audio import, audio mix, stream-copy mux, frame extraction, contact sheets, and final asset registration.

Generated-media QA rule:

- A final video is not done because export returned a file.
- Always sample across the timeline and confirm the intended scenes are actually visible.
- For multi-scene generated videos, explicitly verify that sampled frames are not blank, not static, and not stuck on one generated frame/scene.
- For audio claims, verify the output has an audio stream or extracted audio file. Visual frame QA alone cannot prove voiceover exists.
- Do not present a visually frozen overlay/audio composite just because it has captions or audio; present the best verified artifact and report what was intentionally withheld.

Overlay/caption rule:

- HTML Motion/HyperFrames overlays are polish layers over generated footage, not the source of truth for the generated footage itself.
- If an overlay render freezes the base video, fall back to the verified stitched visual cut and fix the compositor rather than shipping the frozen composite.
- Caption layers must expose deterministic seek hooks. A custom setter alone is not enough if the compositor dispatches standard `prometheus-html-motion-seek` events.

Video canvas/editor distinction:

- Creative Video has at least three related but different timelines:
  - the scene-graph/editor timeline in the Video canvas
  - HTML Motion/HyperFrames deterministic composition timing
  - generated-footage rough-cut/composite timing in the Creative Generative Pipeline
- Do not assume a successful generated sequence automatically appears correctly on the visible canvas timeline. If assets exist but timeline is blank, debug editor placement/state separately from media generation.
- Do not conflate scene-graph `creative_apply_ops` style editing with generated-footage assembly. Video mode intentionally rejects many image/canvas scene-graph edit tools.

Self-edit lessons from this patch:

- When Creative tools expose a gap that forces shell FFmpeg, patch the Creative tool path, not the user workflow.
- Small, safe fixes should be made directly in the source with focused verification:
  - read the actual source path first
  - patch only the failing surface
  - preserve unrelated dirty worktree changes
  - run `npx tsc --noEmit --pretty false`
  - update this file after source verification
- The 2026-05-20 patch touched `src/gateway/creative/generative-pipeline.ts` and `src/gateway/routes/chat.router.ts`.
- `npx tsc --noEmit --pretty false` passed after the patch.
- `npm run build:backend` may exceed a short two-minute shell timeout even when TypeScript is clean; prefer a longer timeout or the narrower TypeScript check when only TS validity is needed.

Model/tool-surface note from 2026-05-20:

- xAI has a 200-tool payload limit.
- `chat.router.ts` must cap tools using the configured active provider as well as explicit provider/model overrides.
- A model-switch or low-tier note-writing turn can otherwise leak the full activated tool surface and fail with an error like `228 tools have been provided but the maximum is 200`.

Reusable HTML Motion preset capture:

- Prometheus now has native reusable-capture tools: `creative_save_html_motion_template`, `creative_save_html_motion_block`, and `creative_promote_scene_to_template`.
- Use native tools when the user wants the current Creative project to gain a reusable template/block.
- Use `html-motion-preset-author` when the user wants a portable bundled skill/preset package with template resources, examples, and QA notes.
- The preset-author workflow reads the active HTML motion clip, lints it, renders QA frames, extracts reusable HTML into `templates/*.html`, writes a bundled skill, and registers/syncs it.
- `holographic-globe-hyperframes-preset` is the first captured visual preset from the 2026-04-29 holographic globe test. It includes `templates/holographic-rotating-globe-light.html` and should be used for future holographic globe / orbital scan / wireframe earth requests.

## 6E) HTML Motion Templates

Current HTML Motion template IDs in `html-motion-templates.ts`:

- `startup-product-promo`
- `bold-tiktok-caption`
- `saas-feature-launch`
- `app-demo-card`
- `testimonial-social-proof`
- `event-or-offer-ad`
- `minimal-editorial-quote`
- `before-after-reveal`
- `step-by-step-tutorial`
- `stat-bomb-reel`
- `podcast-episode-promo`
- `recipe-card-vertical`
- `coming-soon-teaser`
- `news-headline-flash`
- `feature-comparison-vs`
- `glitch-cyber-promo`
- `square-feed-announcement`
- `youtube-intro-promo`
- `ugc-review-card`
- `ai-workflow-demo`
- `local-business-spotlight`
- `course-lesson-promo`
- `ai-design-studio-launch`
- `ascii-logo-reveal`
- `ascii-cyber-poster`
- `python-ascii-render-showcase`

Important template families:

- vertical social/product ads: `startup-product-promo`, `bold-tiktok-caption`, `saas-feature-launch`, `ai-workflow-demo`
- editorial/social proof: `testimonial-social-proof`, `minimal-editorial-quote`, `ugc-review-card`
- offer/news/comparison: `event-or-offer-ad`, `news-headline-flash`, `feature-comparison-vs`
- educational/content: `step-by-step-tutorial`, `course-lesson-promo`, `podcast-episode-promo`, `recipe-card-vertical`
- brand/launch/teaser: `coming-soon-teaser`, `glitch-cyber-promo`, `youtube-intro-promo`, `square-feed-announcement`
- product demo film: `ai-design-studio-launch`
- ASCII/source-backed motion: `ascii-logo-reveal`, `ascii-cyber-poster`, `python-ascii-render-showcase`

`ai-design-studio-launch` is the current flagship product-demo film template.
It includes:

- workspace UI
- preview canvas
- tweak/knob panel
- cursor choreography
- artifact gallery
- export-to-agent modal
- parameter knobs for `accent`, `glow`, `density`, and `speed`

ASCII template facts:

- `ascii-logo-reveal` and `ascii-cyber-poster` expect a source asset id, defaulting to `source`.
- `python-ascii-render-showcase` expects a rendered asset id, defaulting to `ascii_render`.
- ASCII template controls include glyph set, palette, reveal mode, density, glitch, bloom, and accent where relevant.

## 6F) HTML Motion Blocks

Current HTML Motion block IDs in `html-motion-blocks.ts`:

- `timed-caption`
- `lower-third`
- `seekable-canvas`
- `ascii-source-canvas`
- `punch-caption`
- `karaoke-caption`
- `subtitle-bar`
- `app-frame`
- `phone-mockup`
- `dashboard-panel`
- `count-up-stat`
- `bar-race`
- `sparkline-reveal`
- `flash-transition`
- `wipe-transition`
- `blur-push-transition`
- `shader-canvas-transition`
- `end-card`
- `button-pulse`
- `logo-lockup`
- `feature-checklist`
- `notification-stack`
- `icon-burst`
- `price-offer-card`
- `timeline-steps`
- `gradient-wipe-transition`
- `browser-workspace-frame`
- `chat-build-panel`
- `tweak-panel`
- `cursor-path`
- `artifact-gallery`
- `export-agent-modal`

Block families:

- captions: `timed-caption`, `punch-caption`, `karaoke-caption`, `subtitle-bar`, `lower-third`
- product proof/UI: `app-frame`, `phone-mockup`, `dashboard-panel`, `feature-checklist`, `notification-stack`
- charts/data: `count-up-stat`, `bar-race`, `sparkline-reveal`
- transitions: `flash-transition`, `wipe-transition`, `blur-push-transition`, `shader-canvas-transition`, `gradient-wipe-transition`
- CTA/brand: `end-card`, `button-pulse`, `logo-lockup`, `price-offer-card`
- product-demo film: `browser-workspace-frame`, `chat-build-panel`, `tweak-panel`, `cursor-path`, `artifact-gallery`, `export-agent-modal`
- misc/motion: `seekable-canvas`, `ascii-source-canvas`, `icon-burst`, `timeline-steps`

Use blocks to enrich or patch existing HTML clips rather than inventing fragile one-off markup.

Creative render job routes now exist for async render/export tracking:

- `GET /api/canvas/creative-render-jobs`
- `POST /api/canvas/creative-render-jobs`
- `POST /api/canvas/creative-render-jobs/:jobId/start`
- `GET /api/canvas/creative-render-jobs/:jobId`
- `POST /api/canvas/creative-render-jobs/:jobId/progress`
- `POST /api/canvas/creative-render-jobs/:jobId/cancel`
- `POST /api/canvas/creative-render-jobs/:jobId/complete`

## 6G) Remotion Motion Templates

Remotion integration source:

- `src/remotion/Root.tsx`
- `src/remotion/index.tsx`
- `src/remotion/runtime/templateRegistry.ts`
- `src/remotion/runtime/resolveTemplateInput.ts`
- `src/remotion/runtime/socialPresets.ts`
- `src/remotion/templates/CaptionReel/CaptionReel.tsx`
- `src/remotion/templates/CaptionReelV2/CaptionReelV2.tsx`
- `src/remotion/templates/ProductPromo/ProductPromo.tsx`
- `src/remotion/templates/AudioVisualizer/AudioVisualizer.tsx`
- `src/gateway/creative/motion-runtime.ts`

Remotion template tools include:

- `creative_list_motion_templates`
- `creative_preview_motion_template`
- `creative_apply_motion_template`
- `creative_generate_motion_variants`

Current Remotion templates:

- `caption-reel-v2`
  - composition: `CaptionReelV2`
  - default duration: `15000ms`
  - formats: `reel`, `short`, `story`, `square`, `feed45`
  - presets: `bold-tiktok-v2`, `startup-launch-v2`, `editorial-v2`, `professional-v2`
- `caption-reel`
  - composition: `CaptionReel`
  - default duration: `15000ms`
  - formats: `reel`, `short`, `story`, `square`, `feed45`
  - presets: `clean-creator`, `bold-tiktok`, `minimal-linkedin`
- `audio-visualizer`
  - composition: `AudioVisualizer`
  - default duration: `30000ms`
  - formats: `reel`, `short`, `story`, `square`, `feed45`, `youtube`
  - presets: `podcast-audiogram`, `music-pulse`
- `product-promo`
  - composition: `ProductPromo`
  - default duration: `15000ms`
  - formats: `reel`, `short`, `story`, `square`, `feed45`, `youtube`
  - presets: `saas-launch`, `feature-drop`

Current Remotion/social formats:

- `reel`: 1080x1920
- `short`: 1080x1920
- `story`: 1080x1920
- `square`: 1080x1080
- `feed45`: 1080x1350
- `youtube`: 1920x1080

Known Remotion/template caveats:

- Do not stack multiple caption-reel template instances unless the user explicitly wants multiple template layers.
- If a stronger revision is needed after export, prefer a fresh rebuild over repeatedly reapplying templates onto an edited/corrupted scene.
- Prior bugs included ghost/stale caption layers, static middle/end frames, and bland/basic generated frames; use frame QA aggressively.
- For polished social/product promos, HTML Motion is currently often more reliable and higher-fidelity than primitive canvas layers or underdeveloped Remotion templates.

## 6H) Premium Editable Creative Templates

Separate from Remotion and HTML Motion, editable premium templates live in:

- `src/gateway/creative/templates.ts`

Current premium editable template IDs:

- `saas-hero-reveal`
- `ai-dashboard-flythrough`
- `podcast-audiogram-premium`

These materialize into normal editable Creative scene layers and are useful when the user wants Canva/CapCut-like layer editing instead of a self-contained HTML clip.

Inputs currently include text fields, image/audio assets, metrics, and brand kit bindings depending on template.

## 6I) Creative QA Rules

Creative video output should pass both structural and visual checks.

Common QA tools:

- `creative_render_snapshot`
- `creative_render_html_motion_snapshot`
- `video_render_frame`
- `video_render_contact_sheet`
- `video_analyze_frame`
- `creative_validate_layout`
- `creative_quality_report`
- `creative_frame_trace`
- `creative_frame_diff`
- `creative_export_trace`
- `image_check_text_overflow`
- `image_check_contrast`
- `image_get_overlaps`
- `image_detect_empty_regions`

Required pre-export checks for serious video:

- render at least early, midpoint, and near-end frames
- verify text does not overlap, clip, or wrap badly
- verify safe-area placement
- verify contrast/readability
- verify start/mid/end frames differ meaningfully
- verify CTA is visible in the final act
- verify attached media actually appears
- verify no editor UI, selection boxes, handles, guide lines, or broken image icons render

For HTML Motion clips:

- run lint
- render 3+ frames
- patch layout/assets/timing if needed
- export MP4 only after QA passes

For media-based clips:

- inspect source media before placing it
- build/select an edit decision list for long footage
- sample every selected segment, not only the final CTA frame

## 7) Browser Interaction Modes and Browser State

Prometheus now has a real browser interaction mode system in `browser-tools.ts`.
Current backend modes:

- `agent`
- `copilot`
- `teach`

Important distinctions:

- These are browser interaction modes, not chat execution modes
- They live in browser interaction state, not in session JSON like `creativeMode`
- `copilot` and `teach` can capture browser control for the user
- Agent browser actions wait for control release in `copilot` and `teach`
- `agent` releases captured control immediately back to Prometheus logic
- current backend normalization maps unknown values, including legacy `review`, back to `agent`
- Browser interaction context is injected into prompt assembly through `[BROWSER CONTROL]`

Tracked browser state includes:

- current interaction mode
- whether control is captured
- control owner (`agent` or `user`)
- recent user browser actions
- last actor summary
- live stream status

## 8) Browser Teach/Copilot UI State

The frontend also has an explicit browser interaction UI surface in `web-ui/src/pages/ChatPage.js`.
Current interaction labels in UI are:

- Agent
- Co-pilot
- Teach

The UI also normalizes legacy `review` back to `agent`.

Teach-specific UI state currently tracks:

- `idle`
- `recording`
- `approval_pending`
- `verifying`
- `verified`

Meaning:

- `copilot` is a shared-control/handoff lane
- `teach` is where guided browser learning, staged step approval, and reusable action capture are being implemented
- Teach verification is backed by `browser_teach_verify` and can run `full`, `safe`, or single-step verification

This means "copilot mode" is real, but it belongs to browser interaction control, not to the main execution-mode enum.

## 9) Browser Observation, Vision, and Fetching

Prometheus now has separate browser observation modes in `browser-tools.ts`:

- `none`
- `compact`
- `delta`
- `snapshot`
- `screenshot`

Important runtime facts:

- tool-specific defaults choose the observe mode after each browser action
- vision screenshots are injected when DOM quality drops or vision mode is active
- browser live stream status tracks transport and focus
- live stream transport is `cdp` or `snapshot`
- live stream focus is `passive` or `interactive`
- `browser_send_to_telegram` exists and is treated as a core browser-adjacent tool
- persistent browser session records are stored at `<configDir>/browser-sessions.json`
- restorable sessions exclude internal preview sessions, task sessions, and compound session IDs

Current browser tool surface also includes:

- `browser_type`
- `browser_scroll_collect_v2`
- `browser_intercept_network`
- `browser_element_watch`
- `browser_snapshot_delta`
- `browser_extract_structured`
- `browser_teach_verify`

Browser site knowledge now includes named elements, item roots, and extraction schemas via `src/gateway/browser-site-knowledge.ts`. `browser_extract_structured` can use an inline schema or a saved schema name.

## 10) Tool Architecture

The chat/runtime tool system is now "core tools + activated categories + dynamic injections + capability executors".

Runtime categories:

- `browser_automation`
- `desktop_automation`
- `agents_and_teams`
- `prometheus_source_read`
- `prometheus_source_write`
- `workspace_write`
- `advanced_memory`
- `media_assets`
- `media_quality`
- `automations`
- `external_apps`
- `integration_admin`
- `social_intelligence`
- `proposal_admin`
- `mcp_server_tools`
- `composite_tools`
- `creative_mode`

Legacy aliases still map onto the current category IDs, including `browser`, `desktop`, `team_ops`, `source_read`, `source_write`, `file_ops`, `memory`, `media`, `integrations`, `connectors`, `mcp`, and `composites`.

Key rules:

- categories are activated per session through `request_tool_category`
- some tools are always core and never category-gated
- MCP tools are injected dynamically as `mcp__<serverId>__<toolName>`
- saved composite tools are injected dynamically too
- `connector_list` is always available
- `ask_team_coordinator` is always available
- `deploy_analysis_team` is always available
- `run_command` is always core
- `start_process`, `process_status`, `process_log`, `process_wait`, `process_kill`, and `process_submit` are core supervised-process tools
- `get_creative_mode` and `switch_creative_mode` are core
- `enter_creative_mode` and `exit_creative_mode` live under the `creative_mode` category

Tool definition sources:

- `src/gateway/tools/defs/file-web-memory.ts`
- `src/gateway/tools/defs/agent-team-schedule.ts`
- `src/gateway/tools/defs/cis-system.ts`
- `src/gateway/tools/defs/creative-tools.ts`
- browser tool definitions from `src/gateway/browser-tools.ts`
- desktop tool definitions from `src/gateway/desktop-tools.ts`
- extension runtime definitions from `src/extensions/runtime-registry.ts`
- MCP definitions from `src/gateway/mcp-manager.ts`
- composite definitions from `src/gateway/tools/composite-tools.ts`

Extension-runtime facts:

- Prometheus now has a first-pass OpenClaw-style extension substrate under `src/extensions/`
- `src/extensions/runtime-api.ts` defines the typed runtime API: tools, connectors, providers, MCP presets, routes, hooks, memory sources, and context providers
- `src/extensions/runtime-registry.ts` is the central runtime registry for extension manifests, registered tools, connector records, provider records, MCP presets, and connector status
- `src/extensions/runtime-loader.ts` loads manifest-owned native runtime modules when `prometheus.extension.json` declares `runtime.entrypoint`
- `src/extensions/activation-planner.ts` plans extension activation from startup hints, tool contracts, tool patterns, capability contracts, capability hints, and connected connector state
- `src/extensions/schema.ts` and `src/extensions/types.ts` now allow extension manifests to declare `trustLevel`, `activation`, `contracts`, and `runtime.entrypoint`
- `src/extensions/legacy-connector-adapter.ts` bridges the old hard-wired connector system into the new extension registry; this keeps current Gmail/GitHub/Slack/etc. tools working while native extension modules are migrated one by one
- connector schemas exposed to chat now come from `getExtensionRuntimeRegistry().listToolDefinitions()` in `src/gateway/tool-builder.ts`
- connector execution now routes through `getExtensionRuntimeRegistry().executeTool(...)` in `src/gateway/agents-runtime/subagent-executor.ts`
- the standalone `src/tools/registry.ts` also registers extension tools from `getExtensionRuntimeRegistry().listTools()`
- the old `CONNECTOR_TOOL_MAP`, `getConnectorToolDefs`, and `handleConnectorTool` are still compatibility inputs to the adapter, not the desired long-term source of truth

Executor routing facts from `src/gateway/agents-runtime/subagent-executor.ts`:

- despite the filename, this is the main injected tool executor used by chat, background tasks, team agents, and subagents
- proposal/source write gates run before normal policy execution
- every tool call is evaluated by `getPolicyEngine().evaluateAction(...)` and audit-logged through `appendAuditEntry(...)`
- `commit`-tier `run_command` calls validate native file-tool bypasses, blocked shell patterns, allowed command policy, cwd, absolute path scope, and command permission grants before queuing approval
- other `commit`-tier tools can use scoped browser-page or desktop-window permission grants for repeat approvals
- approval requests flow through `ApprovalQueue`, WebSocket events, task `needs_assistance` state, task journal entries, and Telegram command approval when configured
- after policy/approval, `executeRegisteredCapabilityTool(...)` gets first chance to handle registered capability families
- unhandled tools fall back to the direct switch handlers in `subagent-executor.ts`

Registered capability executors currently live under `src/gateway/agents-runtime/capabilities/`:

- `skillsCapabilityExecutor`
- `automationCapabilityExecutor`
- `teamAgentCapabilityExecutor`
- `memoryCapabilityExecutor`
- `platformCapabilityExecutor`
- `webMediaCapabilityExecutor`

Capability-handled families currently include:

- skills: `skill_list`, `skill_read`, `skill_resource_*`, `skill_create*`, `skill_import_bundle`, `skill_export_bundle`, `skill_update_from_source`
- automations/tasks: `background_*`, `task_control`, `timer`, `internal_watch`, `schedule_job`, `schedule_job_*`, `automation_dashboard`
- teams/agents: `agent_*`, `spawn_subagent`, `message_subagent`, `dispatch_team_agent`, `team_manage`, `ask_team_coordinator`, `set_agent_model`, `get_agent_models`, team chat/status/artifact tools
- memory: `business_context_mode`, `memory_*`, `write_note`
- platform: `mcp__*`, `mcp_server_manage`, `connector_*`, `connector_list`, composite management and saved composites
- web/media: `web_search*`, `web_fetch`, `download_url`, `download_media`, `generate_image`, `generate_video`, `analyze_image`, `analyze_video`, `video_analyze_imported_video`, `save_site_shortcut`

Direct executor switch handlers still own lower-level or specialized families:

- file and workspace surgery tools
- Prometheus source read/write tools
- git/test/lint/format helpers
- supervised process tools
- browser and desktop automation tools
- Creative, HTML Motion, HyperFrames, and composition tools
- proposal/admin fallback tools and legacy compatibility names

Video-mode tool guard to preserve:

- in Video mode, `creative_apply_ops`, scene element tools, scene asset placement, scene-graph animations/effects/masks, and `creative_trim_clip` are intentionally rejected by the executor
- Video mode should use HTML Motion, HyperFrames, Remotion motion templates, composition tools, and Pretext/text-fit QA instead

Composite tools are a real first-class tool layer, not just an informal pattern.
Current composite-tool facts from `src/gateway/tools/composite-tools.ts`, `tool-builder.ts`, `prompt-context.ts`, and the runtime dispatch path:

- composite management is its own category lane: `composite_tools` (`composites` remains an alias)
- composite management tools are not core; the prompt context explicitly says to activate the `composites` category when the user wants to create, inspect, edit, delete, list, or run saved multi-step tools
- saved composites are loaded from `.prometheus/composites/` under either `PROMETHEUS_DATA_DIR` or the current working directory
- each saved composite is a JSON definition with:
  - `name`
  - `description`
  - `parameters`
  - `steps`
- each step is a `{ tool, args }` pair
- step args support runtime placeholder substitution with `{{param_name}}`
- parameter schemas can be partially auto-inferred from placeholders discovered inside the step payloads

Current built-in composite management tools:

- `create_composite`
- `get_composite`
- `edit_composite`
- `delete_composite`
- `list_composites`

Execution behavior:

- saved composite definitions are injected back into the live tool surface as callable dynamic tools
- runtime execution is sequential, step-by-step, not parallel fanout
- missing required params can be resolved from recent session history through an LLM-assisted pass before execution
- unresolved placeholders get one more targeted resolution attempt before the run continues
- each executed step emits synthetic tool-call and tool-result events tagged with composite metadata and step numbering
- the composite stops immediately on the first step failure

Operational rule to preserve:

- composite creation is intentionally conservative
- `create_composite` tells the model to manually run every step first, verify refs/selectors/arguments in a successful live run, and only then save the composite
- chat runtime guidance also says not to create composites automatically unless the user explicitly asks
- in other words, composites are treated as saved, verified tool playbooks rather than speculative generated automation

## 11) Web, Media, Image, and Video Tools

Current web/media tool surface includes:

- `web_search`
- `web_search_single`
- `web_search_multi`
- `web_fetch`
- `download_url`
- `download_media`
- `generate_image`
- `generate_video`
- `analyze_image`
- `analyze_video`
- `video_analyze_imported_video`

Current behavior:

- `web_fetch` reads full page content after `web_search`
- `web_fetch` has special handling for X/Twitter status URLs and attempts attached-media download plus analysis automatically
- `download_url` is for direct file/image/PDF links
- `download_media` is for media-page extraction via `yt-dlp`
- `generate_image` supports provider override `auto | openai | openai_codex | xai`
- `generate_video` supports the configured video generation provider/model path, currently xAI-backed by default
- `analyze_video` samples frames and can extract audio/transcripts when local tools are available
- web/media execution is now handled by `webMediaCapabilityExecutor` before the fallback switch path
- Image/video provider selection must not be tied to the current chat LLM provider. If the user is chatting with Grok, Claude, or another model, `generate_image` and `generate_video` should still be able to use any configured media endpoint whose credentials exist in config/vault/OAuth.

## 12) OpenAI Image Generation and Creative Media Config

Image generation is now a first-class config area in `config.ts`.
Default source values:

- provider: `auto`
- model: `gpt-image-2-medium`
- save to workspace: `true`
- default output dir: `generated/images`

Configured image provider slots currently exist for:

- `openai`
- `openai_codex`
- `xai`

The bundled provider/config system now carries image/video media defaults for OpenAI-family and xAI providers.

Media-provider routing rule from 2026-05-20:

- `src/image-generation/registry.ts` is the canonical image-provider selection point.
- Auto image selection should prioritize an explicit/configured image provider, configured image model inference, active LLM model inference, then usable fallback providers.
- OpenAI-family image generation must treat `openai` and `openai_codex` as compatible credential slots. A saved OpenAI Codex OAuth token in the vault should allow OpenAI image generation even when the active chat model is xAI/Grok, Claude, or another provider.
- `gpt-image-*` model inference should prefer OpenAI-family providers, not the active chat provider.
- Tool descriptions in `src/tools/generate-image.ts` and `src/gateway/tools/defs/file-web-memory.ts` should make it clear that provider override supports `auto | openai | openai_codex | xai`.

Video generation is now also a first-class config area in `config.ts`.
Default source values:

- provider: `auto`
- model: `grok-imagine-video`
- save to workspace: `true`
- default output dir: `generated/videos`

Configured video provider slots currently exist for:

- `xai`

Current xAI media defaults:

- LLM model: `grok-4.20-reasoning`
- image model: `grok-imagine-image-quality`
- video model: `grok-imagine-video`

xAI/Grok Imagine OAuth rule from 2026-05-20:

- `src/auth/xai-oauth.ts` owns runtime xAI credentials for media providers. It should expose a credential resolver that can refresh OAuth, derive usable bearer/API-key credentials, resolve the xAI base URL, and fall back safely when token expiry metadata is missing.
- `src/image-generation/providers/xai.ts` and `src/video-generation/providers/xai.ts` must use the shared xAI runtime credential resolver instead of assuming only static API keys.
- `src/video-generation/registry.ts` should surface xAI OAuth as a valid credential path when explaining missing video credentials.
- xAI/Grok OAuth should cover Grok Imagine image and video generation the same way API-key config does. The media provider should not require the user to make xAI the main chat provider before calling image/video generation.

Creative/video-adjacent facts:

- `video` is a first-class creative mode
- creative contracts explicitly enforce video-only flows for work that requires video mode
- generated media jobs and creative scenes are tracked through the canvas/creative runtime, not just chat text

## 12A) Voice Dictation and OpenAI Realtime Voice

Prometheus now has two separate chat voice paths in the web UI. They are intentionally not the same feature.

Canonical frontend files:

- `web-ui/index.html`
- `web-ui/src/pages/ChatPage.js`
- `web-ui/src/styles/pages.css`
- generated/public copies under `generated/public-web-ui/` must be kept in sync with `node scripts/prepare-public-build.js --web-only`

Canonical gateway files:

- `src/gateway/routes/voice.router.ts`
- `src/gateway/routes/realtime.router.ts`
- `src/gateway/server-v2.ts`
- `src/auth/openai-oauth.ts`
- `src/security/vault.ts`

Left mic button behavior:

- Element id: `chat-voice-btn`
- Handler: `toggleVoiceDictation()`
- Purpose: regular dictation into the chat text box
- STT providers are loaded from `/api/voice/status`
- Browser SpeechRecognition is the default free/local dictation path when available
- backend STT provider paths use `/api/voice/stt`
- normal spoken replies use `speakAssistantReply(...)` with browser speech synthesis or `/api/voice/tts`
- the Mic/Speak provider controls under the chat input are hidden by default and should appear only after the left mic is clicked
- left-mic mode enables `voiceRepliesEnabled = true` and disables OpenAI Realtime mode
- voice command submit phrases are recognized at the end of dictated text, including variants of `send it`, `send message`, and `submit`

Right soundwave button behavior:

- Element id: `chat-realtime-voice-btn`
- Handler: `toggleRealtimeVoiceReplies()`
- Purpose: full OpenAI Realtime voice loop
- This path should not show the regular Mic/Speak provider controls
- Realtime mode disables regular TTS and hides the regular voice provider controls
- It uses OpenAI Realtime transcription to write the user's speech into `#chat-input`
- After transcript completion, or after speech-stop/delta fallback timers, the UI calls `sendChat()`
- Prometheus remains the worker/runtime that receives the submitted text, runs tools, controls the computer, and produces the normal chat response
- OpenAI Realtime is used for speech I/O around that worker loop, not as the main tool-running brain

Realtime submission details in `ChatPage.js`:

- transcript text is tracked through `realtimeDictationBaseText`, `realtimeDictationFinalText`, and `realtimeDictationDeltas`
- duplicate sends are guarded by `realtimeDictationLastSubmittedText`
- `scheduleRealtimeDictationSubmit(...)` exists because realtime text may appear in the box even when final transcription event timing is delayed or inconsistent
- submit triggers currently include:
  - `conversation.item.input_audio_transcription.completed` immediately
  - `input_audio_buffer.speech_stopped` after a short delay
  - transcription delta fallback after a short delay

Realtime audio-output details:

- `ensureRealtimeVoiceConnection()` creates a WebRTC receive-only audio connection plus data channel
- `speakWithRealtimeVoice(text)` sends a `conversation.item.create` with the Prometheus final response text, then sends `response.create`
- current response creation uses `output_modalities: ['audio']`
- realtime voice errors from the data channel should surface as UI toasts instead of failing silently
- the hidden audio element is `#realtime-voice-audio`

Gateway Realtime behavior:

- `/api/realtime/status` reports whether Realtime is configured and whether auth is API-key or OpenAI Codex OAuth backed
- `/api/realtime/client-secret` mints ephemeral Realtime client secrets for both normal realtime sessions and transcription sessions
- default realtime model: `gpt-realtime`
- default realtime voice: `marin`
- default realtime transcription model: `gpt-realtime-whisper`
- Realtime auth candidates are tried in this order:
  - `OPENAI_REALTIME_API_KEY`, `OPENAI_API_KEY`, or `VOICE_TOOLS_OPENAI_KEY`
  - connected OpenAI Codex OAuth token from `openai.oauth_tokens`
- OAuth-backed Realtime has been verified to mint client secrets for both `transcription` and `realtime` session modes when OpenAI Codex OAuth is connected

Important router/auth note:

- `realtimeRouter` and `voiceRouter` must be mounted before the stricter `requireAccountAccess` catch-all route group in `src/gateway/server-v2.ts`
- they still use gateway auth, but must remain reachable for status/client-secret checks during account/model UI flows

Important vault note:

- OpenAI Codex OAuth tokens live under vault key `openai.oauth_tokens`
- The vault was hardened so writes merge current encrypted disk entries and vault instances are keyed by config dir
- This prevents stale singleton/config startup writes from wiping unrelated OAuth secrets
- If `/api/realtime/status` says `configured:false`, first check whether OpenAI Codex OAuth is still connected or whether a Realtime/API key env var is present

Operational debugging facts:

- If realtime transcription writes into the text box, the browser microphone/WebRTC transcription session is alive
- If it does not auto-send, inspect realtime transcription event handling and `scheduleRealtimeDictationSubmit(...)`
- If it sends but no response arrives, verify `/api/health` and `/api/chat` first; Prometheus/gateway response is still required before realtime audio can speak anything
- If Prometheus responds but no realtime audio is heard, inspect `speakWithRealtimeVoice(...)`, `response.create`, `output_modalities`, data-channel errors, and browser autoplay/audio device behavior
- `/api/realtime/status` and `/api/realtime/client-secret` can validate OAuth/API-key configuration without exposing client secrets

## 13) Source Editing and Proposal Execution

Prometheus has three distinct code-editing surfaces:

- direct workspace file tools
- proposal-execution source-edit tools
- dev-only fast source-edit approvals through `request_dev_source_edit`

Proposal execution exposes dedicated internal code tools for:

- `src/`
- `web-ui/`
- selected allowlisted project-root files and directories

The dev-only fast source-edit lane is not the same as proposal execution:

- `request_dev_source_edit` is for immediate local/dev source fixes after the user asks Prometheus to patch its own `src/` or `web-ui/` code.
- It is disabled in public distribution builds.
- It grants only the listed `src/` / `web-ui/` files for the current session, never global source-write access.
- After approval it activates source read/write categories for the session and installs a mutation scope so writes outside the approved files are blocked.
- It should be used only after inspecting the relevant source files and knowing the exact affected files.

Current proposal tool families include:

- `read_source`, `grep_source`, `source_stats`, `write_source`, `find_replace_source`, etc.
- `read_webui_source`, `grep_webui_source`, `webui_source_stats`, `write_webui_source`, etc.
- `list_prom`, `read_prom_file`, `grep_prom`, `write_prom_file`, etc.

The current auto-execution boundary is more nuanced than the tool list:

- the proposal router recognizes internal-code proposals when they touch `src/`, `web-ui/`, or a small prom-root allowlist
- public distribution builds reject internal-code proposals entirely
- private builds only auto-dispatch internal-code proposals that qualify for `dev_src_self_edit` or `dev_src_self_edit_repair`
- dev self-edit eligibility now accepts affected files under `src/` and/or `web-ui/`
- allowlisted prom-root files are recognized as internal code, but they do not qualify for the dev self-edit sandbox

Proposal sandboxing is also now tied to explicit mutation scope:

- proposal execution builds a `mutationScope` from approved `affectedFiles`
- that scope is stored on `task.proposalExecution`
- background execution installs that mutation scope onto both the task session and the originating proposal session
- writes outside the approved files/dirs are blocked with an explicit "outside approved proposal scope" error
- paths ending in `/` become approved directories; other affected paths become exact approved files

Current sharp edge:

- `dev-src-self-edit.ts` prepares, baselines, and promotes both `src/` and `web-ui/` paths
- the executor's dev self-edit write gate still rejects non-`src` write targets with "Only approved src/ files may be written"
- until that executor guard is reconciled, treat `web-ui/` dev self-edit support as partially wired: the sandbox/promotion layer is ready, but write-tool permission is still `src/`-only in the active execution lane

## 13A) Coding Workspace API

`src/gateway/routes/coding.router.ts` and `src/gateway/coding/workspace-session.ts` expose a lightweight coding workspace API for the UI.

Current coding routes:

- `GET /api/coding/session`
- `GET /api/coding/status`
- `GET /api/coding/diff`
- `POST /api/coding/branch`
- `POST /api/coding/stage`
- `POST /api/coding/commit`

Coding workspace session facts:

- root defaults to `getConfig().getWorkspacePath()`
- package manager detection supports `npm`, `pnpm`, `yarn`, `bun`, `pip`, `uv`, `cargo`, `go`, and `dotnet`
- command detection reads package scripts or conventional project files to infer test/build/dev commands
- git status/diff/stage/commit/branch operations are shell-out wrappers around `git`
- `web-ui/src/components/CodingWorkspacePanel.js` is the current frontend panel for this API

## 14) Proposal System

Proposals are stored under `workspace/proposals/` in:

- `pending/`
- `approved/`
- `denied/`
- `archive/`

Current proposal types:

- `feature_addition`
- `src_edit`
- `config_change`
- `task_trigger`
- `memory_update`
- `skill_evolution`
- `prompt_mutation`
- `general`

Current proposal statuses:

- `pending`
- `approved`
- `denied`
- `executing`
- `repairing`
- `executed`
- `failed`
- `expired`

`repairing` proposals are stored in the approved bucket, not a separate top-level folder.

Current proposal routes:

- `GET /api/proposals`
- `GET /api/proposals/:id`
- `PATCH /api/proposals/:id`
- `POST /api/proposals/:id/approve`
- `POST /api/proposals/:id/deny`

Current proposal records can carry:

- `affectedFiles`, each with `path`, `action`, and `description`
- `executionSteps`, with optional kinds such as `inspect`, `edit`, `write_artifact`, `trigger`, `verify`, `build`, and `complete`
- `riskTier: low | high`
- optional `executorProviderId` and `executorModel`
- optional `teamExecution` metadata for managed-team proposal execution
- `revisionHistory` for pending proposal edits
- `approvalSnapshot`, which captures the exact approved proposal version/content
- optional `repairContext` for build-failure repair proposals

Pending proposals can be edited with `PATCH`; non-pending proposals cannot. A successful pending edit increments `version` and records a revision.

Special rules for `src/` proposals:

- if a proposal touches `src/`, it must be an approval-ready implementation plan
- its type must be `src_edit`
- `riskTier` must be `low` or `high`
- `executorPrompt` must be present
- its `details` must contain these exact sections:
  - `Why this change`
  - `Exact source edits`
  - `Deterministic behavior after patch`
  - `Acceptance tests`
  - `Risks and compatibility`
- normal src proposals must show source-read evidence through details or executor prompt
- each affected `src/` path must be named in details or executor prompt
- proposals created by the build-failure repair pipeline can bypass fresh source-read evidence through `sourcePipeline: proposal_build_failure`

Approved proposals that carry an executor prompt, or affected files plus details, dispatch into background execution using session IDs of the form `proposal_<proposalId>`.
Approval records an `approvalSnapshot` before dispatch, so execution has a durable approved version even if later UI state changes.

Execution dispatch modes:

- `dev_src_self_edit` for qualifying internal source proposals
- `dev_src_self_edit_repair` for repair-only follow-ups
- `standard` for general proposal execution
- `task_trigger`, `verification`, and `artifact_run` for bounded operational proposals inferred from proposal type/text

Operational proposal prompts are intentionally constrained: they are told not to implement source-code changes, not to run builds unless approved, to perform the approved action exactly once, and to finish through the normal step-completion path.

Risk tier affects executor routing:

- explicit `executorProviderId` plus `executorModel` wins
- otherwise `riskTier` maps through `agent_model_defaults.proposal_executor_low_risk` or `agent_model_defaults.proposal_executor_high_risk` when configured

Team proposal execution:

- stores `teamId`, `managerSessionId`, `executorAgentId`, optional `executorAgentName`, and return metadata
- dispatches the approved prompt as a team subagent task
- suppresses normal origin delivery and returns updates/results into team chat
- cannot execute Prometheus internal source-code changes

Proposal list filters currently include useful UI buckets:

- `in_progress` / `executing` for active execution
- `paused` for paused, stalled, needs-assistance, or awaiting-user-input work
- `executed`, which includes executed, failed, and expired records

## 15) Dev Source Self-Edit Sandbox

`dev_src_self_edit` is a real sandbox mode in `src/gateway/proposals/dev-src-self-edit.ts`.
`dev_src_self_edit_repair` is also real and uses the same source file for repair handoff semantics.

Eligibility and setup:

- disabled in public distribution builds
- applies when every affected file is under `src/` or `web-ui/`
- creates an isolated workspace under `.prometheus/proposal-workspaces/<proposalId>/repo`
- copies:
  - `package.json`
  - `package-lock.json`
  - `.npmrc`
  - `src/`
  - `web-ui/`
  - `generated/`
  - `scripts/`
  - `tsconfig*.json`
- links live `node_modules` into the sandbox when present
- writes `.prometheus/proposal-workspaces/<proposalId>/manifest.json`

Baselines and promotion:

- normal self-edit work captures live baselines before editing
- repair workspaces are copied from the failed sandbox and do not capture fresh live baselines
- allowed files are expanded before baseline/promotion
- `web-ui/index.html` maps to `generated/public-web-ui/index.html`
- `web-ui/src/...` maps to `generated/public-web-ui/static/...`
- promotion copies or deletes only approved expanded paths
- promotion refuses to overwrite a live file that changed after sandbox creation unless the sandbox already matches live
- incomplete promotion metadata pauses the task for assistance

The execution mode constants are `DEV_SRC_SELF_EDIT_MODE` and `DEV_SRC_SELF_EDIT_REPAIR_MODE`.
The default verification command for these sandboxed edits is:

- `npm run build:backend` for `src/`-only work
- `npm run sync:web-ui && npm run build:backend` when `web-ui/` affected files are present

Repair proposals inherit the canonical build command from the failed task.

Current task metadata for sandboxed proposal execution includes:

- `proposalId`
- `mode`
- `projectRoot`
- `liveProjectRoot`
- `buildRequired`
- `buildVerifiedAt`
- `buildVerifiedCommand`
- `liveFileBaselines`
- `promotion`
- `mutationScope`
- `buildFailure`
- repair lineage and blocked-task handoff state when running in repair mode

Current write restrictions inside `dev_src_self_edit`:

- generic workspace mutation tools are blocked
- only proposal source-write tools are supposed to mutate internal code
- mutation scope still blocks unapproved paths even when a source-write tool is available
- current executor code still only enables `src/` write targets in this lane
- `web-ui/` is represented in sandbox/baseline/promotion logic, but write permission still needs executor-side follow-through
- prom-root writes are explicitly blocked in this lane
- if a build failure has already occurred, source edits are frozen

## 15A) Fast Dev Source Edit Approvals

`request_dev_source_edit` is the fast dev-only alternative to a full source proposal when the user explicitly wants Prometheus to patch itself now.
It should feel like a compact proposal plus a live execution lane, not a raw file unlock.

Canonical files for this lane:

- `src/gateway/tools/defs/cis-system.ts` defines `request_dev_source_edit` and `prom_apply_dev_changes`
- `src/gateway/dev-source-approvals.ts` normalizes the dev edit plan, creates the scoped grant, computes the plan hash, and persists dev-edit continuations under `.prometheus/dev-edit-continuations.json`
- `src/gateway/agents-runtime/subagent-executor.ts` creates/resolves the approval, grants source tools, applies dev changes, persists continuation state, and marks completion notes
- `src/gateway/routes/chat.router.ts` seeds the declared plan from the approved dev-edit plan and closes it when the completion note lands
- `src/gateway/lifecycle.ts` carries `devEditContinuation` in restart context
- `src/gateway/boot.ts` detects post-restart dev-edit continuation and instructs Prometheus to write the completion note before final summary
- `src/gateway/verification-flow.ts` serializes dev edit plan data to clients
- `web-ui/src/pages/ChatPage.js` renders dev-edit plan/evidence in desktop approval cards
- `web-ui/src/mobile/mobile-pages.js` renders dev-edit plan/evidence in mobile approval cards
- `src/gateway/comms/telegram-channel.ts` renders dev-edit plan/evidence in Telegram approval messages
- generated public mirrors under `generated/public-web-ui/static/...` must stay in sync after web/mobile UI edits

Required approval contract:

- `request_dev_source_edit` must include `files`, `reason`, and `plan`.
- `files` must be project-relative paths under `src/` or `web-ui/`.
- `plan` should include:
  - `user_request`: what the user asked for
  - `reasoning`: why these files/approach are appropriate
  - `evidence`: file/line findings from inspected source, e.g. `{ file, lines, finding }`
  - `current_state`: what the code currently does
  - `fix`: what will change
  - `steps`: the concise execution plan to declare and follow
  - `verification`: checks/commands to run
  - `completion_note_tag`: usually `dev_edit_complete`
- The approved plan receives a stable `planHash` and `dev_edit_id`. Treat that approved plan as the execution contract.
- If Prometheus discovers it needs files outside the approved scope or a materially different fix, it should request a new dev source edit approval instead of silently expanding scope.

Execution behavior after approval:

- The chat runtime seeds a declared manual plan from the approved `plan.steps`, then appends verification, `prom_apply_dev_changes`, and completion-note steps.
- Source-write tools may edit only approved files.
- Prefer surgical source-write tools such as `find_replace_source`, `replace_lines_source`, `insert_after_source`, and their `*_webui_source` variants.
- Do not use generic workspace mutation tools for internal Prometheus source changes in this lane.
- Run the relevant verification from the approved plan before applying live changes.
- For `web-ui/` or mobile web UI edits, run or let `prom_apply_dev_changes` run `npm run sync:web-ui`.
- For backend/runtime edits, `prom_apply_dev_changes` should build and restart the gateway.
- For mixed backend plus web/mobile changes, `prom_apply_dev_changes` should sync web UI first, build backend, restart, then request a desktop reload.

Post-restart/reload completion rule:

- `prom_apply_dev_changes` should carry the active `dev_edit_id` and approved completion note tag. It can infer the active pending dev edit for the session, but explicit `dev_edit_id` is better.
- Before restart/reload, it persists a `devEditContinuation` with the approved plan, files, changed surfaces, verification, and summary.
- Hot restart context carries that continuation through `lifecycle.ts` into `boot.ts`.
- After restart, Prometheus should not redo the patch. It should write:
  - `write_note({ tag: "dev_edit_complete", dev_edit_id: "<id>", content: "<what changed, verification, live status>" })`
- That note marks the continuation complete and lets the declared plan close before the final user response.
- Only after the completion note succeeds should Prometheus tell the user the edits are in.

Approval UI behavior:

- Desktop, mobile web, and Telegram approval cards should show the reason, evidence, current state/fix, plan steps, files, and verification in compact form.
- The approval should be readable as a mini proposal. Avoid dumping only raw JSON or only a file list.
- Source edit approvals should appear inline with the chat/tool stream and preserve the surrounding thinking/tool context.

Safety rules for this lane:

- Never use this in public distribution builds.
- Never weaken approval gates, filesystem scope, shell/desktop/browser approval policy, auth, credential handling, or audit logging without explicit user intent.
- Never broaden source-write access silently.
- Never store secrets in source files or notes.
- Never log credentials, tokens, cookies, OAuth codes, or API keys.
- For core runtime/tool execution/scheduler/memory/auth edits, keep the plan especially explicit and verification-heavy.

Verification checklist for fast dev source edits:

- Backend/runtime change: `npm run build:backend`
- Web/mobile UI change: `npm run sync:web-ui`
- Mixed backend plus web/mobile change: run both, or use `prom_apply_dev_changes` with the correct surfaces
- UI JS syntax check when practical: `node --check web-ui/src/pages/ChatPage.js`, `node --check generated/public-web-ui/static/pages/ChatPage.js`, and corresponding mobile files when touched
- After backend restart/reload, confirm the completion note was written with `tag: dev_edit_complete` and the declared plan closed
- Do not claim "fixed" unless verification completed, or clearly say what was not verified

## 15B) Dev-Live Self-Edits, Hot Restart, and Parallel Chat Recovery

Prometheus can now safely self-edit live gateway/web UI behavior only when the edit preserves parallel session identity and restart recovery.
The important source areas are:

- `src/gateway/routes/chat.router.ts` for `/api/chat`, live main-chat runtimes, SSE frames, mobile chat dedupe, and retained stream frames
- `src/gateway/live-runtime-registry.ts` for durable in-flight runtime records and restart checkpoints
- `src/gateway/runtime-recovery.ts` for preparing interrupted runtime summaries and per-session checkpoint messages
- `src/gateway/boot.ts` for hot-restart follow-up targeting and per-session recovery prompts
- `src/gateway/session.ts` for persisted chat messages, tool logs, process entries, and channel/session metadata
- `src/gateway/routes/settings.router.ts` plus `web-ui/src/mobile/*` for mobile-origin restart/session id propagation
- `web-ui/src/pages/ChatPage.js` for desktop session hydration, process-log rendering, websocket stream handling, creative canvas focus behavior, and restart notifications
- `web-ui/index.html` for the desktop Channels sidebar hub/drilldown rendering and channel classification helpers
- `generated/public-web-ui/static/pages/ChatPage.js`, which must be regenerated from `web-ui/src/pages/ChatPage.js`
- `generated/public-web-ui/index.html`, which must be regenerated from `web-ui/index.html`

Current live-runtime and hot-restart rules:

- Every main chat, mobile chat, Telegram chat, background task, subagent/team run, scheduled task, heartbeat, brain thought, or dispatch run must be modeled as its own runtime/session when it can run independently.
- Do not use a single global busy flag to reject independent user channels. A mobile or Telegram chat should not say "busy with another task" merely because a different web chat is running.
- Hot restart recovery must be scoped by `sessionId`. Never borrow user request text, tool names, last progress, or checkpoint details from another chat.
- A restart triggered from mobile or Telegram must carry the origin session id/channel into the restart context so the restart message returns to the correct chat.
- Hot-restart notifications should mark the target chat unread and append into the target session, not create a random restart chat unless there is truly no target session.
- If several chats are active during restart, each gets its own restart follow-up and context. Other sessions may be counted, but their private details must not bleed across chats.

Current frontend process-log/restart behavior:

- Desktop keeps per-session `processLog` arrays and attaches turn-specific `processEntries` to assistant messages.
- Server hydration through `/api/sessions/:id` must merge with local history/process logs instead of replacing richer local state. This protects live process streams that existed only in the browser before a restart.
- If a restart happens before the SSE stream emits final `done`, the desktop UI should create a short `Restart Context Packet` assistant bubble and place the full preserved process/tool packet behind the normal `Process` button.
- User-visible restart context should be short. Full tool dumps belong in `processEntries` or `toolLog`, not as giant text in the chat bubble.
- The right process panel should show the active session's `processLog`; individual message bubbles use `processEntries` for historical packet inspection.

Current parallel desktop/mobile stream behavior:

- `/api/mobile/chat/stream/:sessionId` exposes retained main-chat stream frames for a session, including whether the run is still active.
- Desktop must catch up from this endpoint when opening/loading an active mobile-origin session. Canvas state can hydrate separately, so a visible Creative canvas does not prove the process stream has been replayed.
- `main_chat_stream_event` websocket frames and catch-up frames must be deduped by session/stream/sequence before adding process entries.
- `tool_call`, `tool_result`, `tool_progress`, `ui_preflight`, `info`, `thinking`, `thinking_delta`, `progress_state`, `token`, `done`, and `error` frames are all relevant to the desktop process/chat stream.
- Creative mode commonly emits canvas/project state through separate events while the chat/tool stream is carried by main-chat stream frames. Debug both paths when mobile Creative work appears visually active but has no process log.

Cross-channel live chat/session consistency rule from 2026-05-20:

- Desktop, mobile, Telegram, CLI, Discord, and WhatsApp must all treat `src/gateway/session.ts` summaries and `/api/sessions` as the canonical session index, not browser `localStorage`.
- Channel classification must never rely only on a transient frontend `source` field. Backend summaries should normalize missing/stale channels by session id prefix: `telegram_` -> `telegram`, `mobile_` -> `mobile`, `cli_` -> `terminal`, `discord_` -> `discord`, `whatsapp_` -> `whatsapp`, task/brain/auto ids -> `system`.
- `normalizeSessionSummary(...)`, `buildSessionSummary(...)`, and `buildSessionSummaryFromFile(...)` in `src/gateway/session.ts` should preserve valid channel values and infer from `sessionId` instead of falling back blindly to `web`.
- The desktop Channels sidebar must load all channel summaries, not only mobile and CLI. `web-ui/src/pages/ChatPage.js` should fetch/merge `terminal`, `mobile`, `telegram`, `discord`, and `whatsapp` summaries, maintain `window.channelSessionsByChannel`, and keep `window.terminalSessions`, `window.mobileSessions`, `window.telegramSessions`, `window.discordSessions`, and `window.whatsappSessions` in sync for older rendering helpers.
- `web-ui/index.html` channel hub/drilldown counting must include server-only Telegram/Discord/WhatsApp sessions as well as mobile/CLI. `_getSessionChannel(...)` should consider `channel`, `source`, and known id prefixes.
- When opening a chat on desktop, force-refresh the full session from `/api/sessions/:id` so stale local browser state cannot disagree with mobile/Telegram. Local history/process logs may still need careful merge behavior for in-flight streams, but old `localStorage` must not be allowed to hide newer server messages.
- `openTerminalSession(...)` is historically named, but it is the generic server-backed channel opener. It should use the returned session's real `s.channel` instead of assuming `terminal`.
- `deleteChatSession(...)` must remove the session from all channel summary arrays and `window.channelSessionsByChannel`, not only `terminalSessions` and `mobileSessions`.
- `runInteractiveTurn(...)` in `src/gateway/routes/chat.router.ts` must bridge non-desktop channel turns into retained main-chat stream/websocket events. If a channel turn is not already owned by a local `/api/chat` SSE stream, it should call `beginMainChatStream(...)`, append `user_message`, `token`, `thinking_delta`, `tool_call`, `tool_result`, `progress_state`, `done`, and `error` frames through `appendMainChatStreamEvent(...)`, and finish with `finishMainChatStream(...)`.
- Desktop's `main_chat_stream_event` handler in `web-ui/src/pages/ChatPage.js` is for observing other surfaces live. It must avoid double-applying events for locally-owned desktop `/api/chat` turns, but it must create/update the relevant channel session, append live tokens/thinking/tool/progress state, mark unread when not active, save local state, and refresh the visible channel list.
- Telegram/mobile live bugs are usually two-path bugs: one path is the live stream bridge (`main_chat_stream_event` and retained stream catch-up), and the other is canonical session indexing/hydration (`/api/sessions`, `/api/sessions/:id`, local cache merge). Check both before blaming the model loop or websocket transport.
- After backend channel-normalization changes, the running gateway must be rebuilt and restarted if it is serving `dist/gateway/server-v2.js`; changing TypeScript source alone is not enough for the live app.

Current focus/canvas rules for parallel chats:

- Background chat/tool events must not steal the user's active desktop chat. If a background session emits a stream frame, restore the previously active session after processing it.
- Creative-mode websocket commands from a background session must not auto-open that chat or canvas. Suppress creative auto-open for background handling, then restore the prior active session.
- Closing the right panel should reset its selected view back to the main panel/process/connectors surface. Existing canvas files/state remain attached to the session, but the panel should not reopen directly into canvas unless the user clicks the canvas view again.
- `canvas_present` should remember the canvas file/path without forcing the panel open for background sessions.

Current chat media-presentation rule from 2026-05-20:

- When Prometheus presents already-created media files in chat, PNG/JPG/JPEG/MP4 should render like generated image/video review previews inside the chat bubble, not as compact file pills that open Canvas.
- For generated/exported MP4 previews, chat UIs should use `/api/canvas/inline?path=...` as the `<video src>` instead of `/api/canvas/download?path=...`. The inline route supports browser playback behavior, including range requests; download-style URLs can show a black video with a canceled play button on mobile/browser surfaces.
- Desktop implementation lives in `web-ui/src/pages/ChatPage.js`:
  - `renderFilePills(...)` now partitions media paths out of generic file pills.
  - `normalizePresentedMediaFile(...)`, `getPresentedMediaKind(...)`, and `renderPresentedMediaCards(...)` detect and render presented media.
  - `renderArtifacts(...)` also routes media artifacts through the same preview-card path.
  - `normalizeGeneratedVideoEntry(...)`, generated-video URL helpers, and `renderAssistantGeneratedVideos(...)` render `generated_video` / `generated_videos` tool results as playable in-bubble videos.
  - SSE `tool_result` events from `generate_video` should be collected into the active assistant turn as `generatedVideos`, and persisted on success, no-response, error, and abort paths.
- Desktop styling lives in `web-ui/src/styles/pages.css`:
  - `.assistant-image-preview--static` is the non-click-to-canvas image preview.
  - `.assistant-generated-video` provides the bounded in-bubble MP4 player frame.
- The public UI mirror must stay in sync under `generated/public-web-ui/static/pages/ChatPage.js` and `generated/public-web-ui/static/styles/pages.css`.
- Gateway route rule: `src/gateway/routes/canvas.router.ts` must keep `/api/canvas/inline` capable of serving video/audio with `Accept-Ranges`, `206 Partial Content`, and `416` for invalid ranges. Browsers often require range support before MP4 controls behave correctly.
- Subagent/tool bridge rule: `src/gateway/agents-runtime/subagent-executor.ts` should include a `generated_videos` array in generate-video tool extras, not only text/file references, so frontends can render previews without guessing.
- Main mobile web UI uses `_collectMessageMedia(...)` plus `_renderMobileMediaGallery(...)` in `web-ui/src/mobile/mobile-pages.js`; when files are normalized as image/video media, mobile renders `.pm-media-card` previews rather than `.pm-generated-file`. Video/audio card sources must use `/api/canvas/inline`.
- Separate workspace mobile app rule: `workspace/Prometheus Mobile App/source/mobile/mobile-api.js` must forward `tool_result` SSE events via `onToolResult`; `workspace/Prometheus Mobile App/source/mobile/mobile-pages.js` should collect `generate_video` `extra.generated_video(s)` into `body.generatedVideos` and render `<video controls playsinline preload="metadata">` cards using `/api/canvas/inline`; styling lives in `workspace/Prometheus Mobile App/source/styles/mobile.css` under `.pm-generated-video-*`.
- The intended user experience: generated media and presented local media look consistent, with inline preview/player controls and copy/download actions. Opening Canvas is reserved for explicit canvas/edit actions, not the default presentation of finished PNG/JPG/MP4 outputs.
- Verification used for this UI rule: `node --check web-ui/src/pages/ChatPage.js`, `node --check generated/public-web-ui/static/pages/ChatPage.js`, `npm run check:web-ui`, plus Playwright render checks for desktop and mobile-sized chat surfaces.

Verification rule for these edits:

- For `web-ui/` changes, run `npm run sync:web-ui`.
- For gateway/runtime changes, run `npm run build:backend`.
- For mixed gateway plus web UI changes, run both, and expect `prom_apply_dev_changes` to sync web UI, build backend when needed, restart the gateway, and then rely on hot-restart/session recovery instead of losing the live turn.
- When debugging a lost stream, inspect both `web-ui/src/pages/ChatPage.js` and the backend retained stream/runtime paths before assuming the model/tool loop failed.
- For channel/chat UI edits, also syntax-check the touched generated/source browser files when practical: `node --check web-ui/src/pages/ChatPage.js`, `node --check generated/public-web-ui/static/pages/ChatPage.js`, and an inline-script parse check for `web-ui/index.html` when the Channels sidebar script changes.
- To confirm the running app sees a channel fix, call local APIs such as `http://127.0.0.1:18789/api/sessions?channel=telegram`, `?channel=mobile`, and `/api/sessions`, and verify `id`, `channel`, `title`, `lastActiveAt`, and `messageCount` match the expected surface.

## 16) Tasks, Background Agents, and Autonomous Runs

Current task statuses in `task-store.ts`:

- `queued`
- `running`
- `paused`
- `stalled`
- `needs_assistance`
- `awaiting_user_input`
- `complete`
- `failed`
- `waiting_subagent`

Important pause reasons include:

- `awaiting_user_input`
- `awaiting_command_approval`
- `recovering_from_build_error`
- `preempted_by_chat`
- `heartbeat_cycle`
- `blocked_on_repair`

Other current task facts:

- proposal execution state records `standard`, `task_trigger`, `verification`, `artifact_run`, `dev_src_self_edit`, and `dev_src_self_edit_repair`
- tasks can carry mutation scope, build verification state, live baselines, promotion status, repair context, and team execution state
- background task runner uses `step_complete` progression, stall nudges, and task-scoped workspace binding
- proposal tasks are run with a proposal-specific runtime mode and session ID
- task delivery knows how to report team proposal results back into team chat

Proposal sandbox lifecycle details that are now implemented:

- a sandboxed proposal must complete a successful build before promotion back into the live repo
- successful build verification is currently recorded after a successful `run_command` of `npm run build`, `npm run tsc`, or canonicalized `npm run build:backend` for dev-src sandboxes
- if a later mutating tool runs, previous build verification is cleared and must be re-earned
- promotion status is tracked as `pending`, `promoted`, or `failed`
- promotion copies only the approved scoped files back into the live repo
- if promotion metadata is incomplete, the task pauses for assistance instead of guessing

Build-failure handling for proposal execution is now more structured:

- build failures are detected during proposal execution
- the failure is stored in `proposalExecution.buildFailure`
- the runner tries to auto-create a scoped repair proposal using:
  - original affected files
  - files referenced directly in the build output
- when a repair proposal is created, the original task pauses with `blocked_on_repair`
- a repair task can inherit the repaired sandbox, resolve the blocked failure, and auto-complete the previously failed build step
- once a build failure is recorded, direct source edits are frozen
- if an automatic repair proposal already exists, further repair writing is blocked
- if auto-repair proposal creation fails, the system allows exactly one manual `write_proposal` repair follow-up from inside that failed proposal context
- after a manual repair proposal is created, that escape hatch is closed and the task remains frozen pending review
- repair proposals are intentionally narrow: they should fix the captured build failure, not continue the original implementation
- if another file is required, the repair task must stop and create another scoped repair proposal instead of silently expanding scope
- environment-level sandbox failures are treated separately from scoped source repair failures and pause for assistance rather than creating a misleading code repair

## 17) Standalone Subagents, Team Subagents, Managers, and Coordinator

Prometheus now has multiple agent layers, not one generic "subagent" concept.

Standalone subagents:

- created or ensured with `spawn_subagent`
- can be persisted and reused by ID
- can be hydrated from role templates:
  - `planner`
  - `orchestrator`
  - `researcher`
  - `analyst`
  - `builder`
  - `operator`
  - `verifier`
- are messaged directly with `message_subagent`

Managed teams:

- main-chat entry point is `ask_team_coordinator`
- main chat is explicitly told not to call `team_manage` directly for managed team work
- runtime execution modes include `team_manager` and `team_subagent`
- shared tools include:
  - `dispatch_team_agent`
  - `request_team_member_turn`
  - `get_agent_result`
  - `post_to_team_chat`
  - `message_main_agent`
  - `reply_to_team`
  - `manage_team_goal`

Team lifecycle management:

- `team_manage` supports `list`, `create`, `start`, `update`, `delete`, `trigger_review`, `dispatch`, `pause`, `resume`

There are two separate tool-profile systems to keep straight.

`ToolProfile` from `src/tools/registry.ts` is used by the standalone tool registry schema/filtering layer and currently includes:

- `minimal`
- `coding`
- `web`
- `desktop`
- `full`

Subagent allowlist profiles from `SUBAGENT_PROFILES` in `src/tools/registry.ts` currently include:

- `file_editor`
- `researcher`
- `shell_runner`
- `reader_only`
- `code_writer`
- `analyst`
- `web_agent`
- `scraper`

Subagent profile facts:

- `getSubagentToolFilter(profile)` returns an explicit allowlist for known profiles
- unknown or missing profiles return `undefined`, which means no filter/full access
- profile allowlists now include supervised process tools where appropriate: `run_command_supervised`, `start_process`, `process_status`, `process_log`, `process_wait`, `process_kill`, and `process_submit`
- `code_writer`, `web_agent`, and `scraper` include `generate_video` as well as `generate_image`
- the `subagent_spawn` schema in `tool-builder.ts` still advertises only `file_editor`, `researcher`, `shell_runner`, and `reader_only`, even though the registry has broader profile names for other runtime paths

## 18) Manager vs Subagent Spawn Strategy

There are two different parallel-work strategies in the runtime:

- when `orchestration.subagent_mode = false`, the runtime exposes `delegate_to_specialist`
- when `orchestration.subagent_mode = true`, it exposes `subagent_spawn`

So "standalone subagents" and "team subagents" are real separate concepts, and the runtime can also expose a lighter specialist-delegation mode instead of full child spawning.

## 19) Deploy Analysis Tool

`deploy_analysis_team` is a real core tool, not a category-gated extra.

Current intended behavior from tool definitions:

- one-shot GTM/site analysis for a URL
- deploys background specialists for:
  - business profiling
  - SEO discovery
  - social reputation
  - browser funnel testing
  - CRO/messaging critique
  - technical auditing
  - competitive positioning

Important note:

- current tool descriptions are slightly inconsistent
- `deploy_analysis_team` says the final experience should be inline and says not to call `present_file`
- `present_file` still mentions `deploy_analysis_team` as a common follow-up
- treat the current product intent as inline-first until those descriptions are reconciled

## 20) Providers and Provider Registry

Provider selection is now extension-descriptor driven through `src/providers/provider-registry.ts`, not just a small hardcoded factory list.

Registry helpers now expose:

- provider descriptors
- known provider IDs
- secret field lists
- provider static model lists

Bundled provider extension directories currently include:

- `anthropic`
- `arcee`
- `deepseek`
- `gemini`
- `huggingface`
- `kilocode`
- `llama_cpp`
- `lm_studio`
- `minimax`
- `moonshot`
- `nvidia`
- `ollama`
- `openai`
- `openai_codex`
- `opencode`
- `opencode-go`
- `openrouter`
- `perplexity`
- `qwen`
- `vercel-ai-gateway`
- `xai`
- `xiaomi`
- `zai`

The config schema explicitly validates provider-specific structures for:

- `ollama`
- `llama_cpp`
- `lm_studio`
- `openai`
- `openai_codex`
- `anthropic`
- `perplexity`
- `gemini`

## 21) Model Configuration and Presets

Current default LLM config in source:

- active provider default: `ollama`
- default Ollama model: `qwen3:4b`
- default OpenAI Codex model: `gpt-5.4`
- default OpenAI model: `gpt-4o`
- default Anthropic model: `claude-sonnet-4-6`
- legacy `models.primary`: `qwen3:4b`
- legacy role defaults (`manager`, `executor`, `verifier`): all `qwen3:4b`

Provider/model settings surfaces:

- `GET/POST /api/settings/provider`
- `GET/POST /api/settings/model`
- `GET/POST /api/settings/agent-model-defaults`
- `POST /api/models/test`

Agent/model default keys currently supported:

- `main_chat`
- `proposal_executor_high_risk`
- `proposal_executor_low_risk`
- `manager`
- `team_manager`
- `subagent`
- `team_subagent`
- `background_task`
- `subagent_planner`
- `subagent_orchestrator`
- `subagent_researcher`
- `subagent_analyst`
- `subagent_builder`
- `subagent_operator`
- `subagent_verifier`
- `switch_model_low`
- `switch_model_medium`
- `coordinator`
- `background_agent`

Other current model facts:

- `switch_model` is turn-scoped, not a global config save
- its exposed tiers are `low` and `medium`
- OpenAI, OpenAI Codex, and Perplexity provider config support `reasoning_effort`
- validated reasoning efforts include `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`
- Anthropic provider config supports `extended_thinking` and `thinking_budget`

## 22) MCP System

Prometheus has a real MCP client manager in `src/gateway/mcp-manager.ts`.

Current MCP features:

- transport support:
  - `stdio`
  - `sse`
  - `http` (streamable HTTP alias accepted)
- config file path: `<configDir>/mcp-servers.json`
- imports object configs in `{ mcpServers: { ... } }` form
- resolves `vault:` secrets in env vars and headers
- sanitizes dangerous env vars
- validates stdio executables against an allowlist
- rejects shell metacharacters in stdio command strings
- injects connected tools as `mcp__<serverId>__<toolName>`

Quick-setup MCP presets currently include:

- `supabase`
- `github`
- `windows`
- `brave`
- `postgres`
- `sqlite`
- `filesystem`
- `memory`

## 23) Connections and Connectors

Prometheus now has both connector registry logic and a wider bundled connector extension set.

Current connector/plugin architecture facts:

- connector/plugin metadata begins in bundled `prometheus.extension.json` descriptors
- extension manifests can now declare explicit `contracts`, activation hints, and trust level
- active connector tools are surfaced through the extension runtime registry, not directly from `connector-tools.ts`
- active connector tool calls execute through the extension runtime registry, which currently delegates legacy tools to `handleConnectorTool(...)`
- `connector_list` is still core/always available, but its status text is built through `getExtensionRuntimeRegistry().buildConnectorStatus()`
- the migration target is to convert each connector from the legacy adapter into a native `definePrometheusExtension(...)` module with `runtime.entrypoint`, then remove the duplicate old connector maps/handlers
- validation command for this layer: `npx tsc --noEmit --pretty false`
- full backend validation command: `npm run build:backend`

OAuth/API-key connector registry currently instantiates:

- Gmail
- Slack
- GitHub
- Notion
- Reddit
- Google Drive
- HubSpot
- Salesforce
- Stripe
- Google Analytics

Bundled connector extension folders currently include:

- `ga4`
- `github`
- `gmail`
- `google_drive`
- `hubspot`
- `instagram`
- `linkedin`
- `notion`
- `obsidian`
- `reddit`
- `salesforce`
- `slack`
- `stripe`
- `tiktok`
- `x`
- `vercel`

Connections routes currently include:

- `GET /api/connections`
- `POST /api/connections/credentials`
- `POST /api/connections/save`
- `POST /api/connections/disconnect`
- `POST /api/connections/oauth/start`
- `GET /api/connections/oauth/poll`
- `POST /api/connections/browser-open`
- `POST /api/connections/browser-verify`
- `GET /api/connections/activity`

Browser-session verification is currently implemented for:

- Instagram
- TikTok
- X
- LinkedIn

### X Connector, xAI/Grok OAuth, and X API Tools

As of 2026-05-20, Prometheus treats the bundled `x` connector as the Social-category owner for official X API/xurl-style tools authorized through an X Developer app plus OAuth 2.0 User Context. This is separate from xAI/Grok OAuth.

Canonical files for this surface:

- `src/auth/x-api-oauth.ts` resolves X API bearer credentials. X API tools must use X API OAuth user-context tokens; do not fall back to xAI OAuth, xAI API keys, or app-only bearer tokens for user-context endpoints.
- `src/auth/xai-oauth.ts` owns xAI/Grok OAuth token storage, refresh, and runtime credential generation.
- `src/gateway/routes/settings.router.ts` owns xAI/Grok model auth and the separate Settings-side X API OAuth controls.
- `src/gateway/routes/connections.router.ts` owns the right-side Connections panel `x` connector credential save, OAuth start/poll, and disconnect flow.
- `src/extensions/catalog-service.ts` reports X connected only when X API OAuth user-context tokens exist. Saved app credentials mean "ready to authorize", not connected.
- `src/extensions/xai-extension-adapter.ts` registers xAI-backed tools; `x_search` and `xai_live_search` remain connector/provider id `xai`, while tool names beginning with `x_api_` are connector id `x`.
- `src/extensions/legacy-connector-adapter.ts` registers runtime connector records for both `x` and `xai`; without these records `connector_list` and connected-connector tool filtering will not expose the X API or xAI search tools even if the Connections UI card shows connected.
- `src/gateway/tools/defs/xai-tools.ts` defines both xAI search tools and official X API tool schemas.
- `src/gateway/tools/handlers/xai-handlers.ts` executes `x_search`, `xai_live_search`, and all `x_api_*` tools.
- `src/extensions/bundled/connectors/x/prometheus.extension.json` declares X connector metadata, Social category, ownership tools, OAuth/API-key setup, and browser-session fallback.
- `web-ui/src/pages/SettingsPage.js` and `web-ui/src/pages/ConnectionsPage.js` plus generated public copies must stay in sync when the auth UX changes.

Important behavior:

- Connecting xAI/Grok OAuth or xAI API key in Settings must not mark the `x` connector connected. Those credentials are for Grok models, xAI search, TTS, and STT.
- Connecting the `x` connector in Connections must save X Developer app credentials, then complete X OAuth 2.0 User Context. It must not write into `llm.providers.xai`.
- The X OAuth `client_id` must be the OAuth 2.0 Client ID from X Developer app Keys and tokens, not the API Key / Consumer Key. The default callback URL mirrors xurl: `http://localhost:8080/callback`. The callback URL must exactly match an X app Callback URL.
- The recommended X connector setup path is button-driven xurl CLI auth, not model/tool freeform shell: `xurl auth apps add/update prometheus`, `xurl auth apps redirect-uri set prometheus ...`, `xurl auth oauth2 --app prometheus`, `xurl auth default prometheus`, then `xurl whoami`. Prometheus may install/repair xurl with `npm install -g @xdevplatform/xurl` from that setup button.
- `src/auth/x-api-oauth.ts` treats the `prometheus` app entry in `~/.xurl` as a valid X API user-context token source, so `x_api_*` tools can use xurl-authenticated OAuth tokens when Prometheus vault tokens are absent.
- Disconnecting `x` should clear X API OAuth tokens/credentials and refresh registered xAI/X tools without clearing xAI/Grok model credentials.
- `x_api_*` tools are not core tools. They belong to the `x` connector in the Social category, even though they are registered by the xAI extension adapter.
- `src/gateway/tool-builder.ts` must classify `x_api_*` as `external_apps`; otherwise category filtering can accidentally expose or hide them incorrectly.
- `x_search` and `xai_live_search` are xAI/Grok search tools registered under `xai`; `x_api_*` tools call `https://api.x.com/2` and register under `x` only after X API user-context OAuth is connected.
- Write tools such as post, delete, like, repost, follow, block, mute, list mutation, and DM send should be used only when the user explicitly asks.
- Many X endpoints are scope/tier gated. Prometheus should surface real X API 401/403/429 errors rather than hiding them or falling back to browser automation silently.
- `x_api_request` is the generic authenticated X API v2 escape hatch for endpoints that X adds before Prometheus gets a dedicated schema.

Current dedicated `x_api_*` tool coverage:

- identity/generic: `x_api_me`, `x_api_request`
- posts/search: `x_api_get_post`, `x_api_get_posts`, `x_api_search_recent`, `x_api_search_all`, `x_api_create_post`, `x_api_delete_post`
- bookmarks: `x_api_get_bookmarks`, `x_api_create_bookmark`, `x_api_delete_bookmark`
- likes: `x_api_like_post`, `x_api_unlike_post`, `x_api_get_liked_posts`, `x_api_get_liking_users`
- reposts: `x_api_repost`, `x_api_unrepost`, `x_api_get_reposted_by`, `x_api_get_reposts_of_me`
- users/social graph: `x_api_get_user`, `x_api_get_user_by_username`, `x_api_get_user_posts`, `x_api_get_user_mentions`, `x_api_get_followers`, `x_api_get_following`, `x_api_follow_user`, `x_api_unfollow_user`, `x_api_mute_user`, `x_api_unmute_user`, `x_api_block_user`, `x_api_unblock_user`
- lists: `x_api_get_list`, `x_api_get_owned_lists`, `x_api_get_list_posts`, `x_api_create_list`, `x_api_update_list`, `x_api_delete_list`, `x_api_add_list_member`, `x_api_remove_list_member`, `x_api_follow_list`, `x_api_unfollow_list`, `x_api_pin_list`, `x_api_unpin_list`
- Spaces/trends/DMs/usage: `x_api_search_spaces`, `x_api_get_space`, `x_api_get_trends`, `x_api_get_personalized_trends`, `x_api_get_dm_events`, `x_api_send_dm`, `x_api_get_usage`

When self-editing this area:

- Keep `XAI_TOOL_NAMES`, `getXAIToolDefs()`, handler dispatch in `handleXAISearchTool(...)`, and `ownership.tools` in the `x` connector manifest consistent.
- Verify consistency by comparing `export const X_API_*_TOOL_NAME = 'x_api_*'` in `xai-tools.ts` against `ownership.tools` in `src/extensions/bundled/connectors/x/prometheus.extension.json`.
- Run `npx tsc --noEmit --pretty false` after changing auth, handlers, tool defs, connector manifests, or Settings/Connections auth UI.
- Do not edit `workspace/oss-agents/hermes-agent` when working on this Prometheus X/xAI integration unless the user explicitly asks for Hermes changes.

Obsidian is implemented as a local bridge rather than OAuth.
Current Obsidian routes:

- `GET /api/obsidian/status`
- `POST /api/obsidian/vaults`
- `PATCH /api/obsidian/vaults/:vaultId`
- `DELETE /api/obsidian/vaults/:vaultId`
- `POST /api/obsidian/sync`
- `POST /api/obsidian/writeback`

Obsidian connector tools currently include:

- `connector_obsidian_status`
- `connector_obsidian_connect_vault`
- `connector_obsidian_sync`
- `connector_obsidian_writeback`

Note:

- `connector_list` text still names the original core connector set
- the actual bundled connector surface is now broader than that description

## 24) Terminal Command and Approval System

Terminal execution depends on the active runtime surface. In current Codex desktop sessions, the canonical terminal tool is `shell_command`; older Prometheus gateway/chat runtimes still expose `run_command`, which sits under policy, approval, and path-scope gates.

Current Codex desktop terminal behavior:

- `shell_command` runs PowerShell commands and returns captured output inline
- set `workdir` explicitly when project or workspace context matters
- use `read_thread_terminal` to inspect an already-open app terminal for the current desktop thread
- use `load_workspace_dependencies` when scripts need bundled Node.js, Python, or document/PDF helper paths
- use short, non-interactive commands for builds, tests, git/status, diagnostics, and local inspection
- do not use shell commands for manual file edits when native edit tools are available; use `apply_patch` for manual code edits

Legacy Prometheus `run_command` behavior:

- dev CLI commands run captured by default
- `visible: true` opens a terminal window only when needed
- GUI apps open visibly
- Chrome/Edge should not be launched through `run_command`; use `browser_open`
- `run_command` should be used for tests, builds, git/status, package installs, diagnostics, and transformations that native file tools cannot do
- ad hoc shell/Python/Node/PowerShell file edits are blocked as native-file-tool bypasses; use read/grep/stats plus file edit tools instead
- cwd resolution defaults to the project root when the active workspace is the primary workspace and the project root has `package.json`
- absolute paths referenced in commands are checked against allowed roots and blocked roots

Command safety/runtime details:

- `chat-helpers.ts` maintains `SAFE_COMMANDS`
- `chat-helpers.ts` maintains `BLOCKED_PATTERNS`
- `isAllowedShellCommand(...)` checks whether a shell command is allowed
- `subagent-executor.ts` blocks bad patterns before approval logic
- `findCommandPermissionGrant(...)` can auto-allow repeated approved command/browser/desktop actions scoped to cwd, browser page, or desktop window
- approvals are created through `getApprovalQueue()` and can be delivered to Telegram when `telegramChannel.sendCommandApproval` exists

Policy engine tiers from `src/tools/registry.ts`:

- `read` = execute immediately
- `propose` = create/stage proposal instead of executing
- `commit` = require explicit approval before executing

Important split:

- `src/tools/registry.ts` has its own policy-gated `ToolRegistry.execute(...)` / `executeBypass(...)` path for registry tools and standalone Reactor-style agents
- chat/background/team/subagent tool calls generally flow through `src/gateway/agents-runtime/subagent-executor.ts`, which performs its own policy/audit/approval pass before capability dispatch and fallback switch handling
- `run_command_supervised` exists in the standalone tool registry/process-tools layer, while chat-facing tool definitions use `start_process` and `process_*` for supervised process control

Approval system facts:

- approvals are stored in-memory via `ApprovalQueue`
- approval resolutions are audit-logged
- web approval APIs are gateway-auth protected
- tasks can pause with `awaiting_command_approval`
- background task status is pushed to `needs_assistance` while awaiting approval
- Telegram can receive and resolve command approvals too

Current approval routes:

- `GET /api/approvals`
- `POST /api/approvals/:id`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/deny`

## 24A) Managed Process Supervisor

Prometheus now has a persisted process supervisor in `src/gateway/process/`.
The singleton is exposed by `getProcessSupervisor()` and stores records/logs under `<configDir>/processes`.

Current process routes:

- `GET /api/processes`
- `POST /api/processes`
- `GET /api/processes/:runId`
- `GET /api/processes/:runId/log`
- `POST /api/processes/:runId/kill`
- `POST /api/processes/:runId/write`
- `POST /api/processes/:runId/submit`
- `POST /api/processes/:runId/close`

Process supervisor facts:

- supports foreground and background runs
- captures stdout/stderr into persisted log files
- broadcasts `process_run_started`, `process_run_update`, `process_run_output`, and `process_run_exited` WebSocket events
- supports overall timeout and no-output timeout termination
- supports stdin pipe/write/submit/close for interactive commands
- marks stale starting/running/exiting records as exited on supervisor startup

## 25) Telegram, Channels, and Command Surface

Current channel config blocks exist for:

- Telegram
- Discord
- WhatsApp

Telegram channel config now also supports:

- persona bot configs under `personas`
- team room bridge configs under `teamRooms`

Telegram currently supports:

- interactive chat sessions
- session resume
- file browser and file download
- live task browsing/control
- team browser/control
- schedule browser/control
- model switching
- reasoning controls
- proposal browsing/approval buttons
- repair browsing/apply/reject
- integrations and MCP status
- command approvals
- persona-specific bots that can route group/direct messages to configured agent IDs
- team room mirroring for team chat, dispatch, completion, proposed changes, and manager review events

Current Telegram command surface in code includes:

- `/status`
- `/clear`
- `/new`
- `/resume`
- `/cancel`
- `/stop_now`
- `/stop`
- `/browse`
- `/download`
- `/screenshot`
- `/restart`
- `/update`
- `/teams`
- `/agents`
- `/tasks`
- `/schedule`
- `/models`
- `/model`
- `/reasoning`
- `/proposals`
- `/approvals`
- `/repairs`
- `/approve`
- `/reject`
- `/integrations`
- `/mcp-status`
- `/setup`

Current doc/handler mismatches inside Telegram code:

- `/approvals` is implemented but omitted from `buildTelegramCommandsMessage(...)`
- the help text says `/approve` and `/reject` act on proposals, but the handlers currently use them for self-repair approvals/rejections
- proposal approval is currently driven from `/proposals` details/buttons, not `/approve <proposalId>`

Telegram also exposes provider-specific reasoning controls, including Anthropic thinking budget options.

Telegram persona and team-room implementation files:

- `src/gateway/comms/telegram-persona-bots.ts`
- `src/gateway/comms/telegram-team-room-bridge.ts`

Persona bot facts:

- each persona config binds a bot token to an `agentId`
- group handling can require mentions via `requireMentionInGroups`
- allowed users and group chat IDs are enforced per persona config

Team room facts:

- each team room config binds a `teamId` to a Telegram `chatId` and optional `topicId`
- room bridge can post team chat messages, dispatch starts/completions, proposed changes, and manager review summaries
- `usePersonaIdentities` is present in config and should be considered when mapping team agents to Telegram-facing identities

## 25A) Brain Runner and Prompt Mutation

The current self-improvement loop is split between the brain runner and prompt mutation, not the older removed self-improvement API files.

Current source facts:

- `src/gateway/brain/brain-runner.ts` schedules thought cycles about every six hours
- dream cycles are scheduled nightly around 23:30 local time, with cleanup about thirty minutes later
- a fifteen-minute checker handles catch-up and retry behavior
- brain state, thought, dream, and cleanup artifacts live under `workspace/Brain/`
- thoughts are observation, seed capture, and low-risk existing-skill maintenance; they write dated thought markdown and may update existing skills only through `skill_manifest_write` or `skill_resource_write`
- thoughts must not mutate memory, prompts, proposals, configs, cron jobs, team state, or create new skills
- thought-applied skill updates must be small, evidence-backed, ledgered with `appliedBy="brain_thought"`, verified with `skill_read` or `skill_inspect`, and explained in the Thought file for Dream review
- thoughts scan chats, sessions, transcripts, tasks, cron/team/proposal evidence, memory notes, `Brain/skill-episodes/`, and `Brain/skill-gardener/`
- dreams read the thought queue, memory roots, proposals, pending proposals, skill episodes, and live skill/workflow candidates before acting
- dreams run a Skill Gardener Review phase that compares actual session behavior against current skill docs
- dreams audit Thought-applied skill updates and may accept, modify, remove/supersede, or defer them to prevent skill bloat
- dreams may automatically evolve an existing skill when the change is low-risk, evidence-backed, and scoped to an existing skill
- dreams must automatically file `skill_evolution` proposals for new skills when the proposal quality gate passes; they should not directly create brand-new skills
- procedural workflow and tool-order learnings should route into existing skill updates or new-skill proposals, not into `USER.md`, `SOUL.md`, or `MEMORY.md`
- dream output artifact handling is resilient: if a model-backed Dream returns usable text but misses/stales the dream markdown or `Brain/proposals.md`, the runner writes fallback recovery artifacts instead of failing only because an expected file was missing
- dream cleanup is now both memory solidifier and Skill Curator Critic; it should not create new memories, proposals, new skills, archives, merges, broad rewrites, or high-risk skill changes
- Dream cleanup may inspect the skill curator queue and recent auto-applied skill resources; it can accept, reject, revert, refine, or mark skill-curator items as needs_review
- Dream cleanup can reject weak pending curator items, delete/revert clearly bad auto-applied curator resources with `skill_resource_delete`, or refine an applied resource in place with `skill_resource_write` only when the correction is obvious and low-risk
- prompt mutations still flow through `src/gateway/scheduling/prompt-mutation.ts`
- the main chat prompt includes a skill recovery policy: if a skill-guided path fails, recover through another viable route, and after confirming the alternate route works, offer to update the skill with the corrected steps or guardrail
- the older `src/gateway/proposals/self-improvement-api.ts` and `src/gateway/scheduling/self-improvement-engine.ts` files are no longer present in the working source

## 25B) Brain Skill Gardener

Skill learning evidence is captured by `src/gateway/brain/skill-episodes.ts`.

Current artifact paths:

- `workspace/Brain/skill-episodes/<date>/episodes.jsonl`
- `workspace/Brain/skill-gardener/<date>/workflow-episodes.jsonl`
- `workspace/Brain/skill-gardener/<date>/live-candidates.jsonl`
- `workspace/Brain/skill-curator/suggestions.json`
- `workspace/Brain/skill-curator/reports/<runId>.md`

Current candidate classes:

- `update_existing_skill`
- `add_resource_or_template`
- `add_trigger`
- `create_new_skill_candidate`
- `no_action_but_record_episode`

Important signals:

- a skill was read and followed, then a tool/error path forced a correction
- a skill was listed but not read, suggesting a missing trigger or routing gap
- a multi-tool workflow succeeded without a skill, suggesting a possible new skill candidate
- a workflow involved durable browser, desktop, coding, creative, migration, or external-system steps
- user correction, repeated recurrence, or positive feedback increases confidence

Current Skill Curator behavior is implemented in `src/gateway/skills-runtime/skill-curator.ts` and is lesson-first, not transcript-first.

Curator lesson types currently include:

- `recovery`
- `style_pattern`
- `component_recipe`
- `workflow_recipe`
- `trigger_patch`
- `instruction_patch`

Curator quality rules:

- a valid curator suggestion must say what Prometheus should do differently next time
- it must include a future trigger, learned behavior, why it helps, target skill, evidence, risk, quality score, and apply preview when possible
- raw request/outcome excerpts, long tool lists, and generic "workflow completed" notes are not enough
- completed workflow alone should usually become `no_action` unless a reusable lesson exists
- deterministic gates should reject or ignore weak legacy workflow/troubleshooting dumps before they pollute skills
- low-risk, additive typed lessons can auto-apply in `auto-safe` mode
- high-risk edits, broad instruction rewrites, archives, merges, skill deletion, and new skill creation require review/proposal flow

Current auto-safe examples:

- Creative/HyperFrames export says `Failed to fetch` but MP4 exists: add a recovery resource to `prometheus-creative-mode` that tells future runs to verify artifact path, nonzero file size, snapshots, and QA before treating the export as failed
- file edit/patch context drift or exact-text-not-found: route the recovery lesson to `file-surgery`, not whichever skill happened to be active

Skill Curator routing principle:

- route the lesson to the skill that owns future behavior, not merely the skill that happened to be read
- creative/export lessons belong in creative/video skills
- file edit and patch drift lessons belong in `file-surgery`
- browser/X navigation/auth lessons belong in browser automation skills
- scheduling/background-job lessons belong in scheduler operations skills

The Skill Gardener is meant to reduce memory bloat. Durable procedural recipes belong in skill docs, skill resources, or skill proposals. Memory should keep user facts, preferences, decisions, and durable project facts, not ad hoc "do these steps next time" instructions when a skill is the better home.

## 26) Memory Files, Search, and Indexing

Prometheus now has both classic memory files and an indexed layered memory system.

Classic memory roots:

- `USER.md`
- `SOUL.md`
- `MEMORY.md`
- daily notes
- intraday notes

Current memory tools:

- `memory_write`
- `memory_read`
- `memory_browse`
- `memory_search`
- `memory_read_record`
- `memory_search_project`
- `memory_search_timeline`
- `memory_get_related`
- `memory_graph_snapshot`
- `memory_index_refresh`
- `write_note`

Current `memory_search` behavior:

- exact ID/key lookup first
- operational memory layer second
- evidence-layer fallback third

Returned hits can identify:

- `layer = operational | evidence`
- `recordType`
- `canonicalKey`
- `whyMatched`

`memory_read_record` resolves full records from either layer.

## 27) Memory Index Layers

Evidence index:

- stored under `workspace/audit/_index/memory/`
- source types currently include:
  - `chat_session`
  - `chat_transcript`
  - `chat_compaction`
  - `task_state`
  - `proposal_state`
  - `cron_run`
  - `cron_job`
  - `schedule_state`
  - `team_state`
  - `project_state`
  - `memory_root`
  - `memory_note`
  - `audit_misc`

Operational index:

- stored under `workspace/audit/_index/memory/operational/`
- canonical record types currently include:
  - `decision`
  - `preference`
  - `project_fact`
  - `task_outcome`
  - `proposal`
  - `workflow_rule`
  - `entity_fact`
  - `conversation_summary`

Refresh mechanisms:

- `scheduleMemoryIndexRefresh(...)`
- `scheduleOperationalIndexRefresh(...)`
- manual tool trigger via `memory_index_refresh`

Memory defaults in config source:

- provider: `chromadb`
- embedding model: `nomic-embed-text`

Agent retrieval policy settings are configurable via `GET/POST /api/settings/agent`.

## 28) Bundled Skills

Prometheus supports two skill shapes through the shared package-aware runtime in `src/gateway/skills-runtime/`:

- simple skills: `<skillsDir>/<id>/SKILL.md` or `skill.md`
- bundled skills: `<skillsDir>/<id>/skill.json` plus an entrypoint markdown file and optional static resources

The normalized runtime model is loaded by `src/gateway/skills-runtime/skill-package.ts` and exposed through `SkillsManager` in `src/gateway/skills-runtime/skills-manager.ts`.

Bundled skill manifests use `skill.json`. V1 supported fields include:

- `schemaVersion`
- `id`
- `name`
- `version`
- `description`
- `emoji`
- `entrypoint`
- `prompt`
- `triggers`
- `categories`
- `requiredTools`
- `permissions`
- `resources`
- `status`
- `lifecycle`
- `ownership`
- `execution_enabled`
- `risk`

Current lifecycle values are:

- `draft`
- `active`
- `experimental`
- `deprecated`
- `archived`

Current ownership values are:

- `local`
- `imported`
- `upstream-managed`
- `prometheus-owned-overlay`

`status` still represents operational readiness such as ready, needs setup, or blocked. `lifecycle` represents whether the skill should be used, trialed, retired, or hidden from normal routing. `ownership` represents how Prometheus should treat edits, especially for imported and upstream-managed skills.

The main skill tools are core tools:

- `skill_list`
- `skill_read`
- `skill_resource_list`
- `skill_resource_read`
- `skill_create`
- `skill_import_bundle`
- `skill_inspect`
- `skill_manifest_write`
- `skill_create_bundle`
- `skill_resource_write`
- `skill_resource_delete`
- `skill_export_bundle`
- `skill_update_from_source`

Skill metadata layers are resolved in this order:

- native manifest: `<skillDir>/skill.json`
- Prometheus overlay manifest: `<skillsDir>/.manifests/<skillId>.skill.json`
- frontmatter in `SKILL.md`
- synthesized fallback from the folder name

Native manifests win over overlays. Overlays let Prometheus or the user enrich third-party downloaded skills without modifying the upstream skill folder. Import provenance is stored beside overlays as `<skillsDir>/.manifests/<skillId>.source.json`.

Skill write safety is built into `SkillsManager`:

- before skill manifest/resource writes and resource deletes, Prometheus snapshots the current skill into `workspace/skills/.history/<skillId>/<timestamp>-<reason>/`
- every automatic or tool-driven skill write appends `workspace/skills/.history/skill-change-ledger.jsonl`
- ledger entries include `skillId`, `changeType`, `evidence`, `beforeHash`, `afterHash`, `appliedBy`, `status`, `snapshotDir`, `changedPaths`, and `reason`
- `skill_manifest_write`, `skill_resource_write`, and `skill_resource_delete` accept ledger metadata including `changeType`, `evidence`, `appliedBy`, and `reason`

Brain Dream skill evolution rules:

- existing skills can be updated automatically by Brain Thought or Brain Dream only when the change is low-risk, bounded, and backed by session evidence
- automatic existing-skill updates should prefer additive triggers, clarified guardrails, corrected tool order, or scoped resource/template additions
- Brain Thought may apply existing-skill maintenance immediately but must explain the change and evidence in its thought artifact for Dream audit
- Brain Dream audits Thought-applied skill changes and may keep, refine, remove/supersede, or defer them if they add noise or duplicate guidance
- the dedicated Brain Skill Curator runs after Dream in `auto-safe` mode and applies only low-risk typed lessons that pass deterministic quality gates
- the Skill Curator auto-rejects weak legacy suggestions that are only raw workflow examples, generic troubleshooting notes, request/outcome dumps, or tool-sequence receipts
- Dream cleanup acts as the model-backed Skill Curator Critic about thirty minutes later; it reviews curator state and can accept, reject, revert, refine, or mark items `needs_review`
- cleanup critic may delete/revert an auto-applied curator resource when it clearly fails the quality gate, but must not rewrite skills broadly, archive/merge/delete skills, or create new skills
- new skills are Dream-only and proposal-based: Dream automatically files `skill_evolution` proposals when the quality gate passes, but does not directly create the skill
- imported or upstream-managed skills should usually receive Prometheus overlays or additive resources instead of broad upstream file rewrites

Important V1 boundaries:

- bundled skills are declarative/instructional packages, not executable plugins
- `skill_resource_read` only reads text-like resources such as markdown, JSON, YAML, CSV, HTML, CSS, SVG, XML, and text
- resource paths are scoped to the skill folder; absolute paths and `../` traversal are rejected
- bundled scripts may be present as inert files, but Prometheus does not execute them as skill actions
- `skill_import_bundle` installs from a local directory, local `.zip`, HTTPS URL to a `.zip`, or GitHub tree URL such as `https://github.com/owner/repo/tree/main/skills`
- if the source contains multiple skill folders, `skill_import_bundle` imports the collection

Packaged app seeding in `src/config/public-workspace.ts` now accepts either `SKILL.md`, `skill.md`, or `skill.json`, and still never overwrites an existing user skill.

Resource discovery includes common static skill folders: `templates`, `schemas`, `examples`, `assets`, `prompts`, `prompt-fragments`, `docs`, `references`, `palettes`, `rules`, `data`, `fixtures`, and `scripts`. Script files are readable as text resources only; they are not runnable skill actions.

The HyperFrames skill pack from `https://github.com/heygen-com/hyperframes/tree/main/skills` is the first curated external-pack test case. It imports as a multi-skill collection and is enriched with Prometheus overlay manifests for:

- `hyperframes`
- `gsap`
- `hyperframes-cli`
- `hyperframes-registry`
- `website-to-hyperframes`
- `remotion-to-hyperframes`

Prometheus also has a local bridge skill, `prometheus-hyperframes-bridge`, that maps HyperFrames resources into Prometheus Creative Video mode. It tells agents to prefer Prometheus Creative HTML Motion tools for in-app video creation and use HyperFrames/GSAP resources as guidance rather than assuming the external HyperFrames CLI is installed.

Skill authoring now supports first-class bundle creation:

- `skill_create` remains the simple one-file `SKILL.md` path
- `skill_create_bundle` creates `skill.json`, `SKILL.md`, resources, metadata, permissions, and provenance
- `skill_resource_write` and `skill_resource_delete` mutate scoped text resources inside a skill folder
- `skill_export_bundle` writes a shareable `.zip`, materializing overlay manifests as `skill.json` inside the export
- `skill_update_from_source` re-imports from recorded provenance while preserving local overlays

`skill_curator` is the tool surface for the dedicated Brain Skill Curator:

- `skill_curator action=status` returns current curator suggestions
- `skill_curator action=run mode=auto-safe` is the default run mode and can auto-apply safe typed lessons
- `skill_curator action=run mode=dry-run` previews without mutation
- `skill_curator action=apply id=<id>` manually applies a suggestion
- `skill_curator action=reject id=<id>` rejects a suggestion

Resource authoring is intentionally text-only and path-scoped. Absolute paths, `../` traversal, unsupported extensions, and oversized resources are rejected.

`src/config/soul-loader.ts` also uses the same package loader now, so subagent/bootstrap skill selection and chat/tool skill selection no longer parse incompatible skill formats.

## 28A) Hub and Frontend Views

The frontend mode router in `web-ui/src/app.js` includes `hub`, and the popover grouping now has audit, memory, and hub-oriented entries.

`web-ui/src/pages/HubPage.js` is a real usage surface, not just placeholder navigation. Current Hub facts:

- top skills and skill usage are read through the Hub API
- tool usage is shown as heatmap-style activity
- skill content can be previewed in a modal
- skill lifecycle and ownership are visible as badges
- recent skill changes are surfaced from the skill change ledger
- skill modals include lifecycle metadata and recent change history when available
- Skill Curator suggestions are visible on the Hub page and mobile Hub view
- curator cards should show typed lesson information first: what approval/apply changes, future trigger, learned behavior, why it helps, target path, quality, auto eligibility, risk, scan verdict, and raw evidence only behind details
- curator UI should avoid exposing raw plumbing as the main review surface; request excerpts, outcome excerpts, and tool lists are audit evidence, not the lesson
- achievements are scaffolded but still empty/stubbed in the current implementation

The matching backend surface is `src/gateway/routes/hub.router.ts`. The skills API in `src/gateway/routes/skills.router.ts` also exposes lifecycle, ownership, manifest source, and recent changes for skill views.

Current notable frontend surfaces also include:

- `web-ui/src/pages/ConnectionsPage.js`, including Obsidian vault connect/sync/remove UI
- `web-ui/src/components/CodingWorkspacePanel.js`, backed by `/api/coding/*`
- `web-ui/src/components/ProcessRunCard.js`, backed by `/api/processes/*`
- `web-ui/src/components/model-provider-credentials.js`, for provider credential status/setup
- Creative HyperFrames UI components under `web-ui/src/components/creative/`
- Onboarding UI under `web-ui/src/onboarding/`

## 28B) Onboarding and Migration

Onboarding is account-scoped through `src/gateway/routes/onboarding.router.ts` and `src/gateway/onboarding/`.

Current onboarding routes:

- `GET /api/onboarding/status`
- `POST /api/onboarding/tutorial-shown`
- `POST /api/onboarding/tutorial-complete`
- `POST /api/onboarding/migration-complete`
- `GET /api/onboarding/model/health`
- `POST /api/onboarding/model-connected`
- `POST /api/onboarding/meet/start`
- `POST /api/onboarding/meet/complete`
- `POST /api/onboarding/memory-seed`
- `POST /api/onboarding/reset`
- `POST /api/onboarding/replay-tutorial`
- `POST /api/onboarding/redo`

Important onboarding facts:

- routes require an account user ID from `account.router.ts`
- memory seed has a dry-run mode and writes only approved paths
- redo onboarding has a server-side confirmation phrase guard: `redo onboarding`
- model health checks flow through `src/gateway/onboarding/model-health.ts`

Migration is implemented in `src/gateway/routes/migration.router.ts` and `src/gateway/migration/migration-service.ts`.

Current migration routes:

- `GET /api/migration/sources`
- `POST /api/migration/preview`
- `POST /api/migration/execute`
- `GET /api/migration/reports`
- `GET /api/migration/reports/:id`

Migration options currently support:

- source kinds: `hermes`, `openclaw`, `localclaw`, `custom`
- modes: `user-data` and `full`
- categories filtering
- optional secret inclusion
- overwrite behavior
- skill conflict handling: `skip`, `overwrite`, or `rename`

## 29) Data Paths Worth Remembering

- Config: `.prometheus/config.json`
- Sessions: `.prometheus/sessions/*.json`
- Browser session registry: `<configDir>/browser-sessions.json`
- Encrypted account session vault entry: `account.supabase.session`
- Paired mobile devices: `.prometheus/paired-devices.json`
- Local mobile HTTPS certificate files when enabled: `.prometheus/certs/gateway-mobile.pfx` and `.prometheus/certs/gateway-mobile.cer`
- Audit log stream: `.prometheus/audit-log.jsonl`
- Tasks: `.prometheus/tasks/`
- Managed process records/logs: `<configDir>/processes/`
- MCP config: `.prometheus/mcp-servers.json`
- Onboarding state: `PROMETHEUS_DATA_DIR/onboarding.json` or `~/.prometheus/onboarding.json`, managed by `src/gateway/onboarding/onboarding-store.ts`
- Migration reports: `<configDir>/migrations/<sourceKind>/<runStamp>/report.json`
- Workspace proposals: `workspace/proposals/`
- Proposal sandboxes: `.prometheus/proposal-workspaces/<proposalId>/repo`
- Audit transcripts: `workspace/audit/chats/transcripts/`
- Audit compactions: `workspace/audit/chats/compactions/`
- Memory index: `workspace/audit/_index/memory/`
- Obsidian bridge config: `<configDir>/obsidian-bridge.json`
- Obsidian sync manifest: `<configDir>/obsidian-bridge-manifest.json`
- Obsidian indexed note mirrors: `workspace/audit/obsidian/vaults/<vaultId>/notes/`
- Daily memory notes: `workspace/memory/`
- Brain state/thought/dream artifacts: `workspace/Brain/`
- Brain skill episodes: `workspace/Brain/skill-episodes/<date>/episodes.jsonl`
- Brain skill gardener candidates/workflows: `workspace/Brain/skill-gardener/<date>/`
- Brain skill curator queue: `workspace/Brain/skill-curator/suggestions.json`
- Brain skill curator reports: `workspace/Brain/skill-curator/reports/`
- Prompt mutation state: `<configDir>/prompt-mutations/*.json`
- Connections activity log: `<configDir>/connections-activity.jsonl`
- User uploads: `workspace/uploads/`
- Generated images: `workspace/generated/images/`
- Generated videos: `workspace/generated/videos/`
- Creative project roots: `workspace/creative-projects/<sessionId>/`
- Creative scene snapshots: `workspace/creative-projects/<sessionId>/prometheus-creative/scenes/`
- Creative exports: `workspace/creative-projects/<sessionId>/prometheus-creative/exports/`
- Creative generated/imported audio: `workspace/creative-projects/<sessionId>/prometheus-creative/audio/`
- Creative generated-shot assets: `workspace/creative-projects/<sessionId>/prometheus-creative/assets/library/`
- Creative composite manifests: `workspace/creative-projects/<sessionId>/prometheus-creative/composites/manifests/`
- Creative composite preflight HTML: `workspace/creative-projects/<sessionId>/prometheus-creative/composites/preflight/`
- Creative composite sample/contact-sheet frames: `workspace/creative-projects/<sessionId>/prometheus-creative/composites/samples/`
- Creative generated-video QA frames/audio: `workspace/creative-projects/<sessionId>/prometheus-creative/qa/`
- Creative motion graphics layers: `workspace/creative-projects/<sessionId>/prometheus-creative/motion-graphics/`
- Creative HTML Motion clips: `workspace/creative-projects/<sessionId>/prometheus-creative/html-motion/`
- Creative HTML Motion revisions: `workspace/creative-projects/<sessionId>/prometheus-creative/html-motion/revisions/`
- Creative HTML Motion frame-export temp dirs: `workspace/creative-projects/<sessionId>/prometheus-creative/html-motion/exports/`
- Source-backed HyperFrames materialized clips: `workspace/.prometheus/creative/hyperframes-clips/`
- Source-backed HyperFrames active projects: `<creative-storage-root>/.prometheus/creative/hyperframes-projects/<composition-id>/index.html`
- HyperFrames producer temp/project outputs: `workspace/.prometheus/creative/hyperframes-producer/`
- Creative asset library/index: under the current creative storage root, managed by `src/gateway/creative/assets.ts`
- Creative render jobs: managed by the canvas router and creative render-job store under the creative project/storage area
- Bundled/user skills: `workspace/skills/`
- Generated bundled-skill mirror: `generated/bundled-skills/`
- Skill overlays/provenance: `workspace/skills/.manifests/`
- Skill snapshots/history: `workspace/skills/.history/<skillId>/`
- Skill change ledger: `workspace/skills/.history/skill-change-ledger.jsonl`

## 30) Current Sharp Edges / Truths To Preserve

- `copilot` is real, but it is a browser interaction mode, not a chat execution mode
- `teach_mode` prompt behavior is caller-context driven, not a top-level execution mode
- legacy browser `review` values normalize to `agent`; `review` is no longer a backend browser mode
- most app routes now require both gateway auth and account entitlement
- mobile pairing is the major exception: `pairingRouter` is intentionally mounted before gateway auth, while claim still requires a logged-in/subscribed/admin account and desktop approval
- a QR/manual pair code is only a challenge handle, not a credential; do not remove the desktop approval step
- iOS Home Screen PWA storage can be separate from Safari storage, and Camera QR scans open Safari rather than the installed PWA; preserve manual pair-code entry inside the mobile pair page
- if `Unauthorized: configure gateway.auth.token to enable remote access` appears during phone pairing, first check router mount order and whether pairing was accidentally placed behind `requireGatewayAuth`
- if remote access is through Tailscale Funnel or another HTTPS-terminating proxy, preserve the `x-forwarded-proto: https` redirect bypass so the gateway does not redirect public HTTPS traffic to an unreachable local HTTPS port
- automatic proposal execution for internal code is stricter than the broad source-edit tool surface suggests
- proposal sandboxing is now two-layered: isolated `dev_src_self_edit` workspace plus session-level mutation-scope enforcement
- sandboxed proposal promotion is build-gated and baseline-checked before live repo writes are allowed
- dev-src proposal repair is a first-class mode and pauses originals with `blocked_on_repair`
- Hub is implemented as a usage/skill surface, but achievements remain stubbed
- the old self-improvement API/engine files are gone; use Brain runner plus prompt mutation as the current mental model
- skill-guided failures should be recovered through an alternate route first; only after the alternate route works should Prometheus offer a skill update
- existing skill evolution is automatic only for low-risk, evidence-backed, scoped changes and is snapshotted plus ledgered; Thought and Dream can both apply it
- the dedicated Skill Curator is lesson-first and auto-safe; it should not preserve raw tool lists or workflow transcripts unless they become a concrete future behavior rule
- the curator should auto-apply only typed low-risk lessons and auto-reject weak legacy workflow/troubleshooting dumps
- Dream cleanup is the model-backed Skill Curator Critic and may revert/refine bad auto-applied curator resources while preserving high-risk work for review
- Thought-applied skill updates are provisional until Dream audits them for usefulness, scope, duplication, and skill-bloat risk
- new skill creation remains Dream-only and proposal-gated; Brain Dream should automatically file `skill_evolution` proposals when warranted, not directly create new skills
- procedural workflow/tool-order rules should become skill updates, skill resources, or skill proposals rather than memory pollution
- imported and upstream-managed skills need extra care; prefer overlays or additive Prometheus-owned resources for routine evolution
- Telegram help text is partially stale relative to implemented handlers
- connector descriptions in some tool copy lag the broader bundled connector roster
- Obsidian is a local bridge connector, not an OAuth connector
- HyperFrames now has first-class source-backed tools and a native `hyperframes` composition lane; older `creative_*_hyperframes_component` tools are compatibility imports into HTML Motion templates/blocks
- HyperFrames source-backed Creative elements may store source as `meta.html` or as `meta.projectPath + meta.entryFile`; self-edits must preserve both paths and never treat missing inline HTML as proof that the clip is empty
- HyperFrames producer export is external output only; it should not clear or replace the active Creative scene
- A same-session empty Video scene with `0` elements and `12000ms` duration after HyperFrames export is usually stale UI/session rehydrate, not a user-authored reset
- Creative Video has both a scene-graph timeline and a separate multi-clip composition timeline; do not conflate their clip/track models
- Creative Generative Pipeline media work has a third timing model: generated footage rough cuts/composites in `generative-pipeline.ts`; keep it distinct from both scene-graph clips and HTML Motion timing
- If generated-video overlay/composite export freezes on one scene, treat it as a compositor bug and preserve the verified stitched cut; do not ship a frozen base video merely because overlays/audio rendered
- Audio-only finishing for a verified MP4 should stream-copy video and mux audio inside Creative tools; shell FFmpeg is an emergency diagnostic path, not the product workflow
- managed processes are persisted and WebSocket-broadcast, so command UI state should be debugged through `src/gateway/process/` as well as shell tools
- onboarding reset/redo paths are account-scoped and guarded; memory seeding should use dry-run plus approved paths when the user needs review
- `deploy_analysis_team` and `present_file` descriptions are not fully aligned yet

## 31) Maintenance Rule

If Prometheus gains or loses modes, tools, providers, connectors, account gates, proposal repair behavior, approval behavior, or memory/index layers, update this file only after reading the exact source files that implement the change.
Do not refresh this file from memory, from UI copy alone, or from older workspace notes.
