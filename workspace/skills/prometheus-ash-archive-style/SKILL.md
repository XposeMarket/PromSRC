---
name: "prometheus-ash-archive-style"
description: "Prometheus house style. Default brand is Prometheus One (black + restrained metallic gold, bone type, P1 ring mark) for Prometheus UI, promos, release videos, motion graphics, and HyperFrames work. The legacy Ash & Archive ember/orange direction is opt-in only when Raul explicitly asks for it."
---

# Prometheus House Style: Prometheus One

Use this for anything that represents Prometheus itself: product UI mocks, release clips, motion graphics, X promo visuals, website sections, HyperFrames. Never impose it on unrelated creative work for other brands.

## Default: Prometheus One (since 2026-07-19)

A luxury coding agent: sovereign, celestial, finished. Not a furnace, not a SaaS gradient.

- **Palette:** use [Prometheus One palette](palettes/prometheus-one.md). Black/near-black covers 80-90% of the frame (`#050505`, `#0A0A0A`, `#12110F`). Bone text `#F2EBDD`. Bronze `#6D5A2B` and muted gold `#A98A3B` for structure. Bright gold `#D6B75E` / `#F0D98B` only for small, meaningful moments: the mark, the selected state, the key word, the primary action.
- **Type:** editorial serif (Georgia-class) for headlines, with the key word in gold italic; widely tracked monospace for kickers, labels and machine traces; a clean sans for UI copy.
- **Detail:** gold hairlines and rules, thin gold borders on device frames, soft gold glow used sparingly, vignette to black. Orbital/constellation geometry and the P1 ring/star mark (`web-ui/src/assets/prometheus-one/p1-mark-ring.png`, never redrawn or distorted).
- **Product proof:** show real Prometheus surfaces rendered in the Prometheus One skin (`data-skin="light"` on desktop; P1 is the mobile default dark skin). Never capture screenshots in the old orange skins for brand work.
- **Motion:** structural and calm: rises, rule draws, slow pushes, decisive cuts, a gold strike or underline as the accent. Hold text long enough to read. Finish on the P1 mark lockup.
- **Avoid:** ember/orange as a primary color, purple/blue/cyan AI gradients, glassy SaaS dashboards, gold on everything, fake HUD labels.

Use the [Prometheus One brief](templates/prometheus-one-brief.md) before authoring.

## Legacy: Ash & Archive (explicit request only)

The 2026 pre-rebrand direction (obsidian, charcoal, ember orange, oxblood, archival field-manual textures) is historical. Use it only when Raul explicitly asks for Ash & Archive / the old ember look. References: [palette](palettes/ash-archive.md), [detailed guide](references/detailed-guide.md), [HyperFrames brief](templates/hyperframes-brief.md), [mythic launch visuals](references/mythic-editorial-launch-visuals.md).

## QA before delivery

Render/export, inspect frames from every scene, and confirm: black-first hierarchy, gold used selectively, P1 mark exact, all product captures are in the P1 skin, text readable at the target size.
