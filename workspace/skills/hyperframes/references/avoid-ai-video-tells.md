# Avoid AI Video Tells

Use this guardrail when making polished HyperFrames promos, launch videos, product explainers, or any piece that should feel designed by a human rather than generated from default AI-video taste.

## The problem

A video can be technically polished and still scream "AI" if it leans on the current generator-default visual language:

- purple, blue, or cyan neon gradients everywhere;
- glossy radial glows with no brand reason;
- generic dark SaaS canvas;
- over-rounded glass panels;
- pill overload;
- abstract orbs, particle dust, holographic grids, scanning lines, and meaningless HUD labels;
- every scene looking like a generic AI SaaS splash screen.

Do not treat these as harmless decoration. Raul specifically called out that purple/blue hue plus gradients are visible AI tells and **cannot happen** unless explicitly brand-justified. Rounded panels are also a soft AI tell when overused, though they can work if the product, brand, or composition genuinely calls for them.

## Default replacement philosophy

Before writing CSS, choose a human art direction that could have existed outside the AI-image era:

- editorial print layout;
- Swiss/International grid;
- industrial product manual;
- annotated desktop UI capture;
- film title card;
- newspaper or magazine feature layout;
- command-center terminal with restrained materials;
- physical brand collateral: labels, stamps, paper, metal, ink, tape, glass, vellum.

Ask: "Would a human designer have chosen this because of the concept, or did I choose it because generator tools make it easy?" If it is the latter, replace it.

## Banned-by-default palette behavior

Do not default to:

- purple plus blue gradients;
- cyan/magenta neon duotones;
- aurora blobs;
- rainbow shader washes;
- blue SaaS glow on dark navy;
- generic `linear-gradient(135deg, #3b82f6, #8b5cf6)` style accents.

Acceptable exceptions:

1. The user's brand palette explicitly requires these colors.
2. The subject matter is literally about neon, cyberpunk, synthwave, RGB lighting, or generator aesthetics.
3. A single small accent uses one of these colors in a controlled way, not as the whole scene language.

If using blue/purple under an exception, counterbalance it with a non-generic material direction: paper grain, stark typography, real UI screenshots, editorial negative space, black-and-white photography, or restrained data/diagram structure.

## Better palettes to reach for

Pick one deliberate palette family instead of generator-neon:

- Ink + paper: `#0f1115`, `#f1eadf`, `#d8c7aa`, `#8f2d2d`
- Black + warm white + safety orange: `#080808`, `#f4efe6`, `#ff5a1f`, `#6e6a62`
- Charcoal + acid green: `#101214`, `#ece7db`, `#b7ff2a`, `#3a3d35`
- Bone + oxblood + graphite: `#eee6d6`, `#141414`, `#7b1e2b`, `#9c917f`
- Deep green + ivory + brass: `#0b1a13`, `#f5efd9`, `#c6a15b`, `#1f2e24`
- Monochrome with one red stamp: `#050505`, `#f2f2ee`, `#b8b8b0`, `#e22d2d`
- Industrial gray + yellow tag: `#151515`, `#d4d0c8`, `#f2c230`, `#4a4a46`

These are examples, not mandatory tokens. The key is fewer colors and more intention.

## Shape and material guardrails

Rounded panels are not banned, but avoid generator-default cards:

- Avoid huge `border-radius: 28px-48px` on every panel.
- Avoid glassmorphism panels unless the concept needs glass.
- Prefer sharper editorial blocks, clipped corners, paper slabs, table rows, device frames, annotation callouts, or physical labels.
- If using rounded cards, make them purposeful: one hero surface, not every object.
- Vary geometry: square blocks plus one circular seal; hard grid plus torn tape; sharp table plus soft waveform.

## Background guardrails

Never use decoration as a substitute for concept.

Avoid by default:

- random orbs;
- generic radial glow corners;
- meaningless grid overlays;
- floating particles;
- scanlines unless the piece is about scanning, video, surveillance, or terminals;
- fake HUD metadata that does not communicate anything.

Prefer:

- real interface captures or reconstructed product UI;
- typographic background texture from meaningful words;
- editorial rules and dividers;
- map, table, code, or document fragments;
- physical texture: paper grain, printer marks, stickers, tape, crop marks;
- one strong graphic metaphor tied to the message.

## Motion guardrails

AI-looking videos often overuse smooth float, scale, and fade. Replace with authored motion vocabulary:

- editorial slide/reveal;
- mechanical shutters;
- typewriter or terminal cursor when relevant;
- paper/card pulls;
- stamped labels;
- document highlight sweeps;
- measured camera pans over real UI;
- abrupt confident cuts with deliberate transition design.

Avoid making every element float, pulse, glow, and drift. Motion should reveal structure, not decorate emptiness.

## Pre-authoring checklist

Before writing `index.html`, state a one-sentence anti-AI art direction:

> "This will feel like [human design reference/material language], not like [generator default to avoid]."

Examples:

- "This will feel like an annotated industrial field manual for a desktop AI command center, not a purple-blue SaaS gradient promo."
- "This will feel like a sharp editorial launch film with black ink, paper, and red proof marks, not a neon orb AI reel."
- "This will feel like a restrained OS product demo with real UI surfaces and document annotations, not a glassmorphism dashboard montage."

## QA checklist

Before final render, scan the source and snapshots for these tells:

- [ ] Is the dominant palette purple, blue, or cyan? If yes, is it explicitly brand-required?
- [ ] Are there multiple radial gradients, glows, or orbs? Remove or justify each.
- [ ] Are panels all heavily rounded or glassy? Sharpen, flatten, or give them a physical/product reason.
- [ ] Do labels and HUD elements communicate real information? Delete decorative nonsense.
- [ ] Could the frame be mistaken for a generic generated SaaS ad? If yes, re-art-direct before exporting.

If any answer is uncomfortable, fix the design instead of hoping motion will save it.
