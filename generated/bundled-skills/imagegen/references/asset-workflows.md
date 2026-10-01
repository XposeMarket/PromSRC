# Asset workflows

## Project-bound outputs

Set `save_to_workspace=true` and choose a meaningful parent such as `assets/generated`, `assets/concepts`, or a feature-specific asset directory. Prometheus creates a unique child run folder, which prevents accidental overwrite. Report the returned workspace-relative paths.

## Creative reuse and provenance

Prefer `creative_generate_image_shot` when an image is part of a larger Creative composition. It registers generation records and can import outputs into the Creative asset index.

After ordinary `generate_image`, import or analyze the selected file through Creative before reuse when metadata matters. This records dimensions, hash, MIME type, and alpha detection. Keep the original prompt, provider, model, reference list, and revised prompt from the generation result alongside downstream decisions.

## Asset sets

Use one `count` call for visual variants of the same asset. Use separate calls for different objects, roles, or prompts. Keep shared style language stable across a set, but state each asset's silhouette, framing, and padding independently.

For character or location continuity, use Creative shot generation with explicit continuity, character, and location references instead of unrelated one-shot calls.

## Brand and text fidelity

Do not ask a generator to redraw an exact logo. Generate the surrounding scene or mockup, then composite the source logo deterministically. Apply the same rule to legal copy, prices, tiny UI text, QR codes, and identity-critical marks.

## Transparent assets

Use the OpenAI provider explicitly. Request real transparency through the `background` parameter and PNG output. After generation, analyze the asset and confirm `hasAlpha=true`, transparent corners, full subject coverage, and no fringe. A PNG file can still be fully opaque.

## Delivery checklist

- Correct subject and asset role
- Expected aspect ratio and usable composition
- Reference roles honored
- Edit invariants preserved
- Exact text checked or composited deterministically
- Alpha verified when required
- Workspace path retained
- Provider, model, prompt, and references recorded
