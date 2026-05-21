---
name: html-motion-preset-author
description: Use when Prometheus should save, capture, convert, or promote a successful Creative HTML Motion / HyperFrames clip into a reusable preset skill, reusable template resource, or future custom motion library entry. Trigger on requests like save this as a preset, reuse this animation, make this a HyperFrames preset, turn this HTML motion clip into a template, capture this globe/effect/card/style, or add this to the creative library.
metadata:
  short-description: Save great HTML motion clips as reusable Prometheus presets
---

# HTML Motion Preset Author

## Mission

When a Creative HTML Motion clip, generated motion graphics layer, overlay treatment, or full composite pattern works well, preserve it as a reusable Prometheus preset instead of letting it live only as a one-off export. The reliable path today is a bundled skill with template resources; if native Creative library preset tooling is available later, use that as the registry layer too.

## Current Reality

Prometheus can list/apply/create/read/patch/lint/snapshot/export HTML motion clips, generate editable motion graphics layers, overlay them on video, and composite layered video/audio outputs. It can also create bundle skills and write skill resources. There is not yet a dedicated core tool named like `creative_save_html_motion_preset`, so do not claim a clip was saved as a native Creative template unless that tool exists.

Use this workflow:

1. Read the active clip with `creative_read_html_motion_clip({ "includeHtml": true })`.
2. For generated overlay layers, capture the `htmlPath`, `layer`, editable slots, and preflight/sample report returned by `creative_generate_motion_graphics_layer`.
3. For composites, capture the composition manifest returned by `creative_overlay_hyperframes_on_video` or `creative_composite_video_layers`.
4. Confirm lint/preflight is clean from the read result or run the appropriate lint/preflight/sample tool.
5. Render QA frames with `creative_render_html_motion_snapshot` or `creative_sample_composite_frames`.
6. Extract the reusable HTML/layer/composition pattern into a template resource.
7. Replace one-off copy/assets with clear placeholders and CSS variables where useful.
8. Create a bundle skill with `skill_create_bundle`.
9. Add the HTML/template/manifest resource with `skill_resource_write`.
10. Add an example brief or usage note only if it materially helps reuse.
11. Confirm the new skill appears in `skill_list` or the workspace skill registry.

## Preset Skill Shape

Use a focused skill id:

```text
<visual-name>-html-motion-preset
```

Examples:

- `holographic-globe-hyperframes-preset`
- `premium-logo-reveal-html-motion-preset`
- `saas-workspace-demo-html-motion-preset`

The skill should contain:

- `SKILL.md`: brief trigger/use instructions, default dimensions, pacing, QA rules, customization knobs.
- `templates/<preset-name>.html`: complete self-contained HTML motion template.
- `templates/<preset-name>.layer.json`: optional normalized layer spec for overlays/composites.
- `templates/<preset-name>.composition.json`: optional reusable composite manifest when the preset is a stack of footage, overlays, captions, and audio.
- Optional `examples/<preset-name>-brief.md`: one short prompt showing how to reuse it.

## What To Preserve

Keep the parts that made the clip good:

- scene grammar and act structure,
- CSS variables,
- animation timing,
- seek-safe JS or CSS animation patterns,
- asset placeholder usage,
- visual treatment,
- performance lessons,
- export settings that worked.
- layer/composite preflight constraints that prevented broken renders.
- caption/audio assumptions when the preset includes timed text or sound.

Strip or parameterize:

- user-specific CTA unless it is part of the requested preset,
- raw absolute paths,
- broken asset URLs,
- temporary debug overlays,
- huge frame-expensive canvas loops,
- one-off copy that should become placeholders.

## Template Requirements

Reusable HTML motion templates must:

- be complete HTML documents,
- include Prometheus metadata tags for width, height, duration, and frame rate,
- stay self-contained with inline CSS and optional inline JS,
- avoid external network assets unless explicitly required,
- use `{{asset.id}}` placeholders for reusable media,
- expose stable region markers for future patching,
- use `data-start`, `data-duration`, and related timing attributes when sections should be discoverable by lint/QA.

## Registration Guidance

After creating or updating the skill, make sure it is discoverable:

- add the skill id to `workspace/skills/_state.json` with `false` unless the registry expects another value,
- sync the skill folder to `generated/bundled-skills/<skill-id>` if bundled skills are used in this workspace,
- keep `skill.json` metadata aligned with `SKILL.md`.

## QA Gate

Before saying a preset is ready:

- lint the source clip or saved template,
- render early/mid/late frames,
- confirm the frames are visually distinct,
- confirm text is readable and inside safe areas,
- confirm no broken images or raw Windows paths,
- confirm export settings are realistic, usually 30fps for HTML motion unless the user explicitly asks otherwise.

## Honest Language

Say "saved as a reusable preset skill" when using this workflow. Say "native Creative HTML Motion template" only if the preset was added to the backend `creative_list_html_motion_templates` catalog or a dedicated native preset tool confirms it.
