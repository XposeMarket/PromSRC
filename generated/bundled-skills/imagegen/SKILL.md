---
name: "imagegen"
description: "Generate or edit raster images in Prometheus with native image providers and asset-aware output handling. Use for AI photos, illustrations, textures, sprites, mockups, hero images, transparent cutouts, background replacement, concept art, and image variants. Prefer repo-native SVG, HTML/CSS, canvas, or direct compositing when exact geometry, text, icons, or logos must remain deterministic."
---

# Image generation

Use Prometheus's native image tools. Do not invoke an external CLI merely to generate an ordinary image.

## Route the request

1. Use `generate_image` for a one-shot raster asset or a simple edit.
2. Treat any supplied image that must remain recognizable as an edit target. Put it first in `reference_images` and state invariants explicitly.
3. Use `creative_generate_image_shot` when the output belongs to a Creative project, needs reusable asset registration, or needs prompt/provider/parent lineage.
4. Use Creative asset import/analysis after `generate_image` when dimensions, alpha, metadata, or later reuse must be verified.
5. Use deterministic SVG, HTML/CSS, canvas, or compositing for exact logos, small icon-system extensions, exact typography, diagrams, and pixel-locked brand marks.

## Build the prompt

Structure only the useful fields:

```text
Use case: <photo | product mockup | UI mockup | marketing | sprite | illustration | concept | edit>
Asset role: <where it will be used>
Primary request: <main intent>
References: <image 1 role; image 2 role>
Scene and subject: <essential content>
Style and medium: <visual treatment>
Composition: <framing, placement, negative space>
Lighting and palette: <only when relevant>
Text (verbatim): "<exact copy>"
Preserve: <edit invariants>
Avoid: <artifacts, unwanted content, watermark>
```

Keep specific user prompts specific. Add composition or production detail only when it materially improves the requested asset. Read [references/prompting.md](references/prompting.md) for difficult prompts and edits.

## Generate

- Let `provider="auto"` choose the configured provider unless a capability requires a specific provider.
- Choose `landscape`, `square`, or `portrait` from the intended placement.
- Use `count` from 2 to 4 only for variations of one prompt. Make separate calls for distinct assets with different prompts.
- Use `quality="low"` for drafts and `quality="high"` for final OpenAI assets. Provider support varies.
- Set `save_to_workspace=true` for anything the project will consume. Use a project-specific `output_dir` when known.
- For transparent output, use `provider="openai"`, `background="transparent"`, and `output_format="png"`. Do not rely on prompt wording or `auto` routing for alpha.
- Do not force a GPT Image 2 model for transparency; Prometheus must select a transparency-capable OpenAI image model.

## Edit

- Pass edit targets and supporting references through `reference_images`.
- Label every reference's role in the prompt.
- Repeat invariants: change only the requested property; preserve identity, pose, proportions, layout, and unaffected pixels as applicable.
- Save non-destructively. Prometheus creates a new run folder; never replace the source unless the user explicitly asks.
- For distinct edits, make one targeted change per iteration.

## Validate and deliver

Inspect the generated result when vision is available. Check subject, composition, text, reference fidelity, edit invariants, and avoid-list violations. For transparent or project-bound assets, import/analyze the selected output in Creative and verify dimensions and `hasAlpha`; do not infer alpha from a `.png` extension.

If a result misses one requirement, retry with one targeted correction. Keep all requested deliverables, discard accidental variants unless requested, and report the saved paths, provider/model, and final prompt. Read [references/asset-workflows.md](references/asset-workflows.md) when the result will become a reusable product, game, web, or brand asset.
