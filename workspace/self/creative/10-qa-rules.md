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
