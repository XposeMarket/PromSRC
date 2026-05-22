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
