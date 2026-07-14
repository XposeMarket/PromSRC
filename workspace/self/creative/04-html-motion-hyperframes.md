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
- HyperFrames and HTML-motion preview iframes are opaque-origin (`allow-scripts` without `allow-same-origin`). Playback/seek state crosses the boundary through validated `postMessage` contracts; direct parent access to untrusted preview DOM is not an acceptable shortcut.
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
- `website-to-video`
- `remotion-to-hyperframes`
- `remotion-best-practices`
- `html-motion-preset-author`
- `holographic-globe-hyperframes-preset`
