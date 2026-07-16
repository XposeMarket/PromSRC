# Prompting patterns

## New assets

Describe the scene before secondary detail. State the intended asset role so framing follows the destination. Reserve negative space only when copy or UI will actually occupy it. Name a medium rather than stacking many style adjectives.

For exact in-image copy, quote it verbatim, specify placement and hierarchy, and ask for no other text. Generated text can still be unreliable; use deterministic compositing when correctness matters.

## Edits and references

Assign a role to each input:

- Image 1: edit target; preserve identity, geometry, and unaffected regions.
- Image 2: style reference only; borrow palette and material treatment, not composition.
- Image 3: supporting insert; place it with matched perspective and lighting.

Phrase edits as a delta: “Change only X. Keep Y and Z unchanged.” Avoid requesting several unrelated edits in one generation.

## Useful recipes

### Product image

```text
Use case: product mockup
Asset role: landing-page hero
Primary request: studio product image of <product>
Composition: <framing>; usable negative space on <side>
Lighting: controlled studio light with realistic material response
Preserve: exact product silhouette and supplied reference details
Avoid: invented logos, extra objects, text, watermark
```

### Transparent game or UI asset

```text
Use case: sprite
Asset role: isolated reusable game asset
Primary request: <subject>
Composition: one complete subject, centered, fully inside frame, generous padding
Preserve: clean readable silhouette at small size
Avoid: floor, cast shadow, reflection, scenery, text, watermark
```

Call `generate_image` with OpenAI, `background="transparent"`, and PNG. Verify `hasAlpha` afterward.

### Background replacement

```text
Use case: edit
References: Image 1 is the edit target
Primary request: replace only the background with <new setting>
Preserve: subject identity, pose, clothing, proportions, crop, and edge detail
Avoid: changes to the subject, added text, watermark
```

## Iteration

Compare the output with the prompt and reference roles. Correct one failure at a time: composition, fidelity, text, lighting, or unwanted content. Repeating the entire prompt with many new adjectives usually makes drift worse.
