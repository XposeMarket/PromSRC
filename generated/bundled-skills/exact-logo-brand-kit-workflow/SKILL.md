---
name: "exact-logo-brand-kit-workflow"
description: "Create brand-kit boards and mockups that preserve an exact supplied logo asset without AI redrawing or altering it. Use when logo fidelity is mandatory and generated layouts must reserve space for deterministic compositing; do not use for inventing a new logo."
---

# Exact-logo brand kits

Image generation may design the surrounding composition, but it must not recreate an exact logo. Composite the source asset deterministically after layout generation.

## Workflow

1. **Locate the authoritative logo.** Prefer the user-provided SVG or highest-resolution transparent raster. Record its source path.
2. **Inspect it.** Check dimensions, alpha, visible bounds, color/contrast, padding, and whether dark/light variants are needed.
3. **Prepare a preview when necessary.** Flatten transparency against a contrasting background for inspection, without replacing the authoritative source.
4. **Design reserved zones.** Generate or build the board/mockup with clearly empty logo areas. Do not ask the image model to reproduce the mark.
5. **Composite deterministically.** Place the exact source pixels/vector into each reserved zone with correct aspect ratio, padding, contrast, and resolution.
6. **Verify fidelity.** Compare the final mark with the source. Inspect letterforms, symbol geometry, colors, transparency, clipping, stretching, and visibility at output size.
7. **Record outputs.** Report the source logo, generated base, composited deliverables, dimensions, and any variant used.

## Hard rules

- Never accept an AI-drawn approximation as an exact logo.
- Never stretch, recolor, crop, trace, or “improve” the logo unless the user authorizes that transformation.
- Do not place a dark logo on a dark background or a light logo on a light background without an intentional treatment.
- Preserve a non-destructive source asset and create derivatives separately.
- If the supplied asset is too low quality for the requested size, stop and request a better source or clearly state the limitation.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for inspection techniques, compositing examples, case-study failures, output templates, and extended QA.
- Read [fidelity-checklist.md](resources/fidelity-checklist.md) during final visual QA.

Success means the surrounding design looks polished and the logo remains demonstrably identical to the authoritative asset.
