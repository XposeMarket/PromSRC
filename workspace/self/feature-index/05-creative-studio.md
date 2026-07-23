# Creative Studio Reference

Last source verification: 2026-07-22. Creative source/reference owners: `src/gateway/creative/`, `src/image-generation/`, `src/video-generation/`, `web-ui/src/components/creative/`, and `../creative/`.

## What Creative Studio is

Creative Studio is Prometheus’s asset-to-delivery production system. It combines conversation-driven requests with project state, a scene graph/editor, media intake, generation, timeline/composition operations, reusable motion systems, render/export, and visual QA. It can be shown inside the desktop Chat workspace and has a focused Mobile Creative surface.

## Creative capability map

| Area | Capabilities |
|---|---|
| Projects and scene graph | Create projects/scenes, choose canvas, inspect/edit state and elements, arrange/select/update/delete elements, checkpoint, undo/redo, save/reset/purge scene, project/storyboard history |
| Assets and uploads | Upload/import images, video, audio and files; attach media from a file or URL; search assets/icons/animations/references; inspect/analyze assets; create library packs and use brand kits |
| Image production | Generate assets and image shots, retrieve/extract layers, apply style, masks, blend modes, layout/fit and motion-graphics layers; keep generated assets in project state |
| Video production | Generate/refine shots and sequences, write shot prompts, choose continuity frames, generate variations, choose the best take, retry until QA passes, chain scenes, rough-cut, trim/stitch clips, extract frames/audio, composite video layers |
| Audio and voice | Import/download/extract audio, add/mix tracks, music beds and sound effects, generate voiceover, transcribe audio, synchronize captions, analyze imported video/audio behavior |
| Timeline/compositions | Create/save/read a composition, add tracks/clips, select/move/trim/split/delete clips, transitions, render and export; compose generated clips into a timeline |
| Templates and reusable systems | Search/apply/save motion templates; HTML motion templates/blocks; reusable library packs; Remotion template knowledge; premium editable templates where installed |
| HTML motion and HyperFrames | Create/read/patch/render/restore/export HTML motion clips; browse/import/apply HyperFrames components; catalog sync, clip insertion, text/color/timing/variable/asset edits, animation, lint, QA, materialization, export, overlays on video |
| Editor experience | Canvas viewport with pan/zoom, selection handles, drag/drop asset preview, inline text editing, context menus, effects and asset browsers, keyframe/timeline controls, subtitle overlay, render status/progress, preview/export controls |
| QA and delivery | Contrast, overflow, empty-region, bounds and overlap checks; composition/layer/layout/preflight validation; frame trace/diff; rendered-frame/contact-sheet/timeline/caption/audio/keyframe checks; shot comparison/retry; export and presentable output |

## Creative modes in plain language

1. **Project/scene editing** creates the durable source of a visual composition.
2. **Image mode** creates, imports, positions, styles, masks, and evaluates still assets.
3. **Video mode** plans shots and sequences, produces/edit clips and audio, then composes/export them.
4. **HTML motion / HyperFrames** creates code-backed, seek-safe motion compositions and reusable components.
5. **Template/block systems** make approved visual patterns reusable instead of rebuilding every project from scratch.
6. **QA** evaluates the exported visual result rather than assuming generation succeeded because a tool returned.

## Supported document claims

- “Prometheus can take a creative brief from storyboard through generated or imported media, composition, rendering, and quality checks.”
- “Its creative system supports images, video, sound, voiceover, captions, timelines, reusable templates, HTML motion, and HyperFrames components.”
- “The desktop editor keeps project and scene state available while work is performed through chat and tools.”

## Boundaries to preserve

- Generation model/provider, render backend, codec, external asset rights, and installed templates determine exactly which output path is usable.
- A template or premium pack is only available when installed/authorized; do not market the catalog as universally bundled.
- Generated media is not automatically production-approved. The QA tools are an explicit stage and can produce retries or selection decisions.
- Mobile has a focused Creative generation/gallery workflow. Full detailed scene/timeline/HTML-motion authoring is a desktop-led surface.
- Remotion and HyperFrames are related creative paths but are not interchangeable; current source treats HyperFrames as the HTML-motion authoring path and retains Remotion template support.

## Source references

`../creative/00-overview.md` through `10-qa-rules.md`, `../06-image-voice.md`, `../20-rich-artifacts.md`, `docs/PROMETHEUS_HTML_MOTION_SPEC.md`, `src/gateway/creative/`, and `web-ui/src/components/creative/`.
