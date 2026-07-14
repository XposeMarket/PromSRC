# HyperFrames ↔ Creative Mode crosswalk

| Stage | HyperFrames operation | Prometheus operation |
|---|---|---|
| Discover reusable content | CLI/registry catalog | `hyperframes_browse_catalog`, `creative_list_hyperframes_components` |
| Import | composition/component source | `hyperframes_insert_clip`, `creative_import_hyperframes_component` |
| Edit | HTML/data attributes | `hyperframes_set_text`, `set_color`, `set_timing`, `set_variable`, `set_asset` |
| Animate | seek-safe timeline/keyframes | `hyperframes_add_animation`, `hyperframes_apply_patch` |
| Validate | CLI lint/check | `hyperframes_lint`, `hyperframes_qa` |
| Prepare runtime | CLI/project materialization | `hyperframes_materialize` |
| Standalone render | CLI render | `hyperframes_export` |
| Mixed edit | rendered scene/overlay | `creative_composition_add_clip`, `creative_overlay_hyperframes_on_video`, `creative_composite_video_layers` |
| Final QA | snapshots/compare | `video_render_contact_sheet`, `video_analyze_timeline`, caption/keyframe/audio checks |
| Delivery | rendered MP4 | `creative_composition_render` or `creative_export` |

## Failure boundaries

- A successful tool call is not a successful render; require a completed job and output file.
- Lint before materialization and export.
- If typed patches cannot express an edit, modify source HTML deliberately and lint again.
- If the project depends on footage, long-form audio, or many independent clips, keep final assembly in the native timeline.
- If the project is primarily deterministic designed motion, keep HyperFrames as the source of truth and use Creative Mode as the host/editor.
