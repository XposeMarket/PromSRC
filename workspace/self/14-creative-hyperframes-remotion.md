# 14 — Creative, HyperFrames & Remotion

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/creative/`, `src/gateway/tools/defs/creative-tools.ts`, `src/remotion/`
> **Read this when:** Building or debugging Creative Mode projects, scene graphs, template-driven motion, HyperFrames clips/catalog, creative QA, or Remotion renders.

## TL;DR
- The gateway Creative subsystem is a project/scene tool surface with persisted modes: `design`, `image`, `canvas`, and `video`. `creative_project` manages project/history/state; `creative_scene` mutates scene content.
- Asset, video, HyperFrames, and QA operations are separate tool wrappers in `src/gateway/tools/defs/creative-tools.ts`. Use the current tool schema rather than assuming all creative actions share one API.
- Scene edits should be incremental, inspectable operations on the project/scene graph. Preserve undo/redo/history and prefer templates/brand kits to repeated hand-authored styling.
- HyperFrames is HTML-based motion composition: bridge/catalog/producer/exporter/QA modules connect catalog components and clip operations to the creative/project layer.
- HyperFrames catalog actions include browse/insert/apply, `sync_catalog`, template/block operations, lint, QA, snapshots and export. `sync_catalog` imports components into the current Creative project; it is not the inventory generator. The source-backed CLI helper is `scripts/sync-hyperframes-catalog.js` (requires `npm run build:backend`); default uses the bundled catalog, `--live` fetches official catalog entries. Do not invent catalog entries.
- Remotion runtime/templates live separately under `src/remotion/`; it is not the same renderer/composition contract as HyperFrames. Use the dedicated Remotion integration/runtime when a task specifically requires Remotion.
- Validate generated output visually and over time. Passing source lint or a “3D” flag is not proof that a visible, moving 3D scene rendered correctly.
- Motion work should include frame-to-frame change, proper scene layout and readable text, and should not leave duplicate CSS/DOM placeholders over a rendered layer.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Tool definitions | `src/gateway/tools/defs/creative-tools.ts` → `getCreativeToolDefs()` | Project, scene, image, video, HyperFrames, QA and mode wrappers. |
| Creative mode enum | `src/gateway/tools/defs/creative-tools.ts` → `CREATIVE_MODE_ENUM` | `design`, `image`, `canvas`, `video`. |
| Project operation orchestration | `src/gateway/creative/command-bus.ts` | Routes creative requests/actions into owning subsystems. |
| Composition state | `src/gateway/creative/composition.ts` | Composition data, scene elements, project save/export boundaries. |
| Project contracts | `src/gateway/creative/contracts.ts` | Shared structured types for creative state and operations. |
| Scene/elements/template support | `creative_scene` in `creative-tools.ts`; `composition.ts`, `assets.ts` | Apply ops; canvas/elements/styles/effects/templates and asset references. |
| Image/asset operations | `creative_image_ops` in `creative-tools.ts`; `src/gateway/creative/assets.ts` | Import, search, generate, analyze, fit and asset history. |
| Video project wrapper | `creative_video_ops` in `creative-tools.ts` | Creative motion/video actions; distinct from media-engine `video_project`. |
| HyperFrames action schema | `creative_hyperframes_ops` in `creative-tools.ts` | Catalog, clip, component, template, snapshot, lint/QA and export actions. |
| HyperFrames catalog | `src/gateway/creative/hyperframes-catalog.ts` | Registry reads, catalog asset resolution and insertion. |
| HyperFrames bridge/producer | `src/gateway/creative/hyperframes-bridge.ts`, `hyperframes-producer.ts` | Component/clip integration and render generation. |
| HyperFrames import/export | `hyperframes-asset-ingest.ts`, `hyperframes-export-adapter.ts` | Catalog asset intake and export translation. |
| HyperFrames validation | `hyperframes-qa.ts`, `sequence-qa.ts` | Visual/timing and composition-oriented checks. |
| HTML motion system | `html-motion-spec.ts`, `html-motion-templates.ts`, `html-motion-blocks.ts`, `html-motion-adapters.ts` | Structured HTML motion blocks and template adapters. |
| Creative QA wrapper | `creative_quality_ops` in `creative-tools.ts` | Frame/text/contrast/timing/overlap and clip-level QA actions. |
| Creative mode control | `get_creative_mode`, `switch_creative_mode` in `creative-tools.ts` | Reads and changes the active creative workflow mode. |
| Remotion application | `src/remotion/index.tsx`, `src/remotion/Root.tsx` | Separate React composition root/runtime/templates. |
| Visual regression support | `src/gateway/creative/playwright-runtime.ts` | Browser-backed preview/snapshot path for creative output. |
| Current action inventory | [`generated/tools.md`](generated/tools.md) | Generated list/schema ownership; use it for exact names. |

## How it works

### Mode and project state
- Creative project actions establish/inspect project state, references, project/storyboard history, scene snapshots, checkpoints, undo/redo, export and reusable library packs. `creative_project` is the cohesive entry point.
- `get_creative_mode` reports the current mode; `switch_creative_mode` changes it. Modes guide the creative workflow/tool surface, but do not automatically grant permissions for external publishing or paid generation.
- Projects and scenes are structured state. Use `creative_scene` for `apply_ops`, element inventory, canvas changes, element edits, style, animation, layout/effects, templates and scene chaining.
- Small operation batches are easier to validate and undo than rewriting a full composition. Read current state before applying broad updates; use history/checkpoint/undo when needed.
- Asset identity and scene references matter: import/register assets through creative asset operations and pass the resulting references rather than relying on an untracked file path.

### Templates and scene graph
- Templates encode reusable layout/style/animation choices; apply a known template and then tune the composition. Use custom registries/library packs when the component is intended for reuse.
- A scene graph separates scene/canvas state from the objects placed on it. Keep element identity stable for edits, update targeted properties, and delete only explicitly identified elements.
- `chain_scene`/sequence support composes steps into a multi-scene sequence. Treat each scene's assets, duration/timing and transitions as part of the sequence rather than a decorative list.
- Creative image operations handle asset import, generation, search, analysis, layer extraction, fit and history. Check the tool's generation/provider inputs and cost contract before an image generation call.
- `creative_video_ops` supplies the creative editor video side; the server-owned generation/job/cost workflow is `video_project` in `src/media-engine/` (see [15 Media engine & video](15-media-engine-video.md)). Do not mix their project IDs or assume identical storage.

### HyperFrames catalog and rendering
- `creative_hyperframes_ops` is the model-facing control surface. Its `browse_catalog`/`list_components` actions inspect registry-backed components; `insert_clip`/`apply_component`/`import_component` add selected material to the composition; `sync_catalog` refreshes catalog state from its source.
- The catalog/registry owns real component definitions, metadata and assets. Search/browse first, then insert a real catalog component. Catalog sync is how newer upstream/local entries enter the runtime; do not fabricate component names or manually patch generated catalog output.
- Clips are structured and can be linted, snapshotted, QA-checked, patched, versioned/restored, materialized and exported. Apply small targeted clip patches and inspect the rendered snapshot, not just the serialized HTML.
- Catalog, bridge, producer and export adapter divide responsibilities: catalog resolves entries; bridge translates/coordinates; producer composes the clip; adapter handles export; QA checks the result.
- `sync_catalog` and source-backed catalog access should be checked against the current local HyperFrames source/registry. The exact script/CLI command depends on the installed pinned integration; inspect the source/skill runbook before attempting an upstream network sync.
- `creative_quality_ops` provides focused checks for text fit, contrast, overlap, timing and rendered frame/layout quality. Use it before export and after substantial changes.

### Remotion
- `src/remotion/index.tsx` and `Root.tsx` define a React-based composition/runtime path. Keep Remotion-only code within that runtime and its configured templates; do not infer that a working HyperFrames clip is a Remotion composition or vice versa.
- If the user explicitly requests a Remotion migration into HyperFrames, preserve the intent/assets/layout while translating the composition; do not keep two competing render pipelines unless explicitly needed.
- Test the actual render path for the composition being changed. A static React preview, a HyperFrames snapshot, or a source lint result alone does not establish that a final video exported correctly.

## Config & knobs
- Active creative mode is stored as session/project state and changed through `switch_creative_mode`; do not hardcode a mode globally to solve a single project issue.
- The gateway exposes wrappers only when the relevant creative category is active. Tool/action enum and parameter schema in `getCreativeToolDefs()` is the authoritative runtime contract.
- HyperFrames catalog/registry location and component install settings belong to its local integration/runtime configuration. UNVERIFIED: no single stable config key is documented here; inspect current HyperFrames registry/catalog source before changing paths.
- Render dimensions, aspect, frame rate, text, colors and timing belong to composition/clip/project inputs. Reuse shared template defaults, but make deliverable-specific target choices explicit.
- Paid image/video generation follows provider-specific model inputs and approval/cost policy; see [15](15-media-engine-video.md) and [06 Image & voice](06-image-voice.md).
- Template and component IDs are catalog data, not free-form aliases. Browse/list before referencing them.

## Gotchas / sharp edges
- **Source lint is not a visual contract:** a `usesThreeJs`/`WebGLRenderer`/`CanvasTexture` marker does not prove a visible 3D object. Inspect the rendered snapshot/export; reject blank/dark output or duplicate CSS/DOM “device” placeholders over the actual object.
- **No motion is still no animation:** check multiple frames/timestamps, not only the opening still. Verify expected state changes and transitions in the actual sequence.
- **Catalog staleness:** a missing component may be an outdated catalog/registry, not a nonexistent component. Browse and sync the real catalog, then recheck exact entry names.
- **Generated component guesses:** do not invent a template/component based on a similar name. Resolve IDs from `browse_catalog`/registry and inspect compatibility/requirements.
- **HyperFrames vs Remotion:** their inputs, runtime and export lifecycle differ. Use the requested pipeline and test its actual export.
- **Creative video vs media-engine video:** the editor wrapper may manage a composition while `video_project` owns generation jobs, characters, quotes and server-side media. Cross-link by verified file/reference, not assumed shared ID.
- **Template mutation scope:** applying a template can touch multiple scene elements. Inspect composition state first; checkpoint/history is safer than bulk overwrite.
- **Font and text fit:** check at final target dimensions and at rendered frame size; a design-canvas preview can hide crop/overflow.
- **Generated output timing:** a successful “render” or queue call can still yield delayed jobs or stale output. Inspect completion state and actual snapshot/export before presenting.
- **Keep paid runs gated:** a mode switch or “quick” action does not authorize spend. Inspect provider/model inputs and quote cost first.

## How to change it safely
- Search [`generated/tests.md`](generated/tests.md) for creative tools, project state, HyperFrames, catalog, render/snapshot, and QA regressions before editing.
- Add focused tests for mode persistence, operation validation, stable element IDs, undo/redo, catalog sync/parity, bad/missing components, and export-adapter behavior.
- For a catalog/component change, refresh from the pinned/local catalog integration, inspect the exact entry and its assets, then run catalog/registry parity checks. Do not hand-edit generated lists.
- For a scene change, test a narrow operation on a disposable project: read state, apply operation, inspect updated state, undo/redo, render at final size, and check all relevant frames.
- For HyperFrames, run lint plus QA, render a fresh snapshot, inspect visually, verify frame-to-frame motion, and then export. Source-level flags do not replace this review.
- For Remotion, test the configured render composition and output with the actual Remotion runtime path in the isolated PR worktree.
- Use only an isolated PR worktree for source/build/test changes. Leave the dirty live checkout and generated user output untouched.

## Related
[06 Image & voice](06-image-voice.md) · [12 Connectors & MCP](12-connectors-mcp-integrations.md) · [15 Media engine & video](15-media-engine-video.md) · [23 Rich output](23-rich-output-cards-artifacts.md) · [`generated/tools.md`](generated/tools.md) · [`generated/tests.md`](generated/tests.md)


## Creative acceptance checks

### Build sequence
1. Read the project/mode state and references before starting. Confirm whether the requested output is a still scene, an editable video composition, a HyperFrames clip, or a Remotion composition.
2. Browse existing templates and catalog components before authoring custom layout or animation. Reuse source-backed components when they meet the need.
3. Create or checkpoint the project, then add assets and scene elements in small targeted operations. Keep IDs, asset refs, canvas size and timing explicit.
4. Read the updated state after each group of operations. Confirm that the visual objects/assets appear in the intended scene, layer/order and duration.
5. Run the mode-appropriate lint and creative QA actions; fix flagged text overflow, contrast, overlaps, unsupported assets, missing frames or timing errors.
6. Render fresh snapshots at the intended size and inspect beginning, middle, transition, and end. For animation, compare multiple frames to confirm real motion.
7. Export through the selected pipeline and inspect the final artifact metadata and visual output before presenting it.

### Artifact contract table
| Deliverable | Minimum proof |
|---|---|
| Static image/canvas | Correct canvas dimensions, intended assets loaded, no clipping/overlap, readable copy. |
| HTML motion / HyperFrames clip | Source-backed clip, lint passes, fresh visual snapshots, timing and all animation states inspected. |
| True 3D/WebGL scene | Rendered screenshots visibly contain the 3D object and show frame-to-frame motion; no duplicate 2D/DOM stand-in. |
| Multi-scene sequence | Each scene exists with expected assets/duration, transition order works, final render reflects the full sequence. |
| Remotion output | Composition renders through the Remotion runtime, output duration/resolution are correct, final frames inspected. |

### HyperFrames catalog/component lifecycle
- Start with `creative_hyperframes_ops(browse_catalog)` for categories/search and `list_components` for installed definitions. Inspect returned name, ID, requirements and compatible settings.
- Use `insert_clip`/`apply_component` to add a known catalog asset. If it must be copied into a project library, use the import action and preserve provenance/requirements.
- Run `sync_catalog` only after checking which verified upstream/local catalog it targets. Confirm the catalog changed and that the selected component resolves after refresh.
- When saving a clip/template/block, use stable IDs and include reusable inputs as variables rather than hardcoding every instance's text, color and asset.
- Run `lint` early for structural issues; use `qa` and rendered snapshots for visual issues. A lint pass cannot confirm that the source image/video, 3D object or motion is visible.
- For `overlay_on_video`, inspect the source clip and rendered overlay on representative frames; ensure overlays remain in safe areas and do not cover important source content.
- Version/restore tools are safer than broad text replacement. Read the existing clip and scope patches to the relevant nodes/properties.

### Remotion and migration boundary
- Inspect `src/remotion/Root.tsx`, `index.tsx`, runtime and templates before changing composition behavior. Keep provider assets and props explicit so outputs are reproducible.
- A reference to Remotion is not enough to choose a migration: use the Remotion porting workflow only when the task explicitly asks to port existing Remotion source. Similar-looking requests for a fresh animation remain on the creative/HyperFrames path.
- When translating source, compare scene timing, easing, fonts, image crops, transparent backgrounds, audio and export dimensions—not just the opening frame.
- Avoid adding a second composition/runtime layer as a workaround for an unverified component or a catalog sync issue. Locate the actual source of truth first.

### Verification checklist
- [ ] Project and active mode match the requested output type.
- [ ] Each image/video/reference asset is loaded and linked from its intended source path.
- [ ] Layout/text/contrast are checked at the final output dimensions.
- [ ] Timeline duration/frame rate/aspect ratio are consistent with the target deliverable.
- [ ] Intermediate frames and transitions render correctly; motion is not only a static DOM effect.
- [ ] Three.js/WebGL content is genuinely rendered, and no duplicate substitute remains.
- [ ] Lint/QA results are reviewed, not merely invoked.
- [ ] Final export opens and matches the preview and requested format.


## Troubleshooting by layer
| Where it fails | Inspect first | Safe response |
|---|---|---|
| Mode/project is wrong | `get_creative_mode`, `creative_project(get_state)` | Switch explicitly, then inspect the intended project before editing. |
| Scene operation rejected | Current element inventory and `creative_scene` action schema | Check IDs/types/properties; submit a minimal valid op. |
| Asset missing in preview | Asset library/import result and scene references | Re-import/register through image asset tools; do not hardcode an ephemeral URL. |
| Template/component not found | `browse_catalog` / `list_components` source | Sync catalog from verified source and re-check; do not guess a similarly named entry. |
| Clip lint fails | Clip source and structured lint output | Patch only the invalid node/property; rerun lint and preview. |
| QA reports text/layout issue | Rendered frame + final output dimensions | Adjust text/size/safe area; rerender at delivery resolution. |
| Snapshot is empty/dark | Browser renderer errors, assets, WebGL context, scene background | Inspect fresh snapshot/console and the actual component; block export until visible. |
| Export differs from preview | Export adapter, fonts/assets and renderer settings | Compare fresh exported frames, not an old in-editor image. |
| Animation looks static | Timestamps/frame-to-frame output and animation state | Seek/render multiple times and inspect the actual animated property. |
| Remotion template is not selected | `src/remotion/Root.tsx` registry/composition name | Confirm the requested composition is registered and render through the configured runtime. |

## Source-backed change practices
- Follow the owner module's data model. If an action updates composition JSON, use the command bus/operation handler rather than mutating storage from a new route.
- Preserve previous clip revisions when patch/restore behavior exists. A “helpful” normalization can rewrite unrelated CSS/HTML and make the user's project difficult to review.
- Keep imports/exports explicit and workspace-contained; resolve user paths through existing storage/asset helpers rather than accepting arbitrary filesystem paths from scene props.
- Do not place secrets in asset metadata, animation variables, clip text or saved templates. Treat exported assets and screenshots as user content.
- Keep catalogs reproducible: use the pinned or checked-out HyperFrames catalog source; note which source revision is being synchronized and test deterministic local/live entry parity.
- Avoid a live source checkout build just to preview a documentation claim. Use an isolated worktree and disposable project for implementation changes.

- CLI catalog sync explicitly requires a built backend module; the script writes imported template/block assets beneath a generated session-scoped `creative-projects/<session>/prometheus-creative/` root, so inspect the chosen session/workspace before bulk import.
