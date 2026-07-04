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
- `creative_image_ops(action: "model_status")`
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
- 2026-07-01 update: `creative_extract_layers` now accepts `saveLayerAssets: true` (or `autoSaveLayerAssets: true`) plus optional `layerAssetBatchName`. In that mode, extraction automatically copies each extracted image/cutout layer into `prometheus-creative/assets/layers/<batch>/`, indexes the PNGs as `extracted-layer`, `layer-asset`, `sprite-asset`, and returns `savedLayerAssets` with `count`, `directory`, and `assets`. This is the agent/tool path for turning a flat image into separate sprite-ready assets without manually pressing the Image Studio `Save layer PNGs` button.

Creative model weight facts from 2026-07-02:

- The canonical writable model cache is `<PromSRC>/.prometheus/models/`, matching `getConfig().getConfigDir()/models`.
- `scripts/download-creative-models.mjs` resolves the PromSRC project root from the script location, not from the shell current working directory, so running it from `workspace/` still writes to the canonical cache unless `PROMETHEUS_DATA_DIR` is set or the script-only `PROMETHEUS_CONFIG_DIR` override is used.
- The runtime resolver checks env overrides, packaged `resources/creative-models/`, canonical config-dir models, then compatibility fallbacks under `workspace/.prometheus/models/`.
- `creative_image_ops(action: "model_status")` and `GET /api/canvas/creative-model-status` return each model's selected path plus all checked candidates, availability, and file sizes. Use this before layer extraction if model placement is unclear.
- 2026-07-02 MobileSAM fix: the bundled/downloaded `mobile_sam_encoder.onnx` may expose `input_image` as rank-3 HWC (`[image_height, image_width, 3]`), while other exports use rank-4 NCHW/NHWC. `src/gateway/creative/onnx/sam.ts` now reads encoder input metadata and builds HWC/CHW/NHWC/NCHW tensors accordingly. If `Invalid rank for input: input_image Got: 4 Expected: 3` returns, check this path first.

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
