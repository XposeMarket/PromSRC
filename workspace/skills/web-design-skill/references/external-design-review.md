# External Design Review

Use this pass before implementation and again after the first rendered view. The goal is a specific, audience-aware interface, not a generic polished surface.

## Before implementation

- Name the audience, context, and primary action in one sentence.
- Identify the product or subject that must be visible in the first viewport.
- Choose a visual direction with a reason: editorial, industrial, tactile, technical, quiet, playful, or another deliberate fit.
- Define type roles, color roles, spacing rhythm, surface treatment, interaction states, and motion behavior before styling details.
- Write or revise copy for hierarchy and truthfulness. Do not use placeholder copy whose length hides layout problems.

## Two-pass critique

**Pass one: structure.** Check whether the first viewport explains what this is, who it is for, and what to do next. Check hierarchy, reading order, responsive composition, and real content density.

**Pass two: craft.** Check typography, alignment, contrast, repetition, imagery, affordances, focus states, hover/active states, loading/empty/error states, and whether any decorative effect competes with the product.

For every weak area, name the observed problem and make one smallest targeted change. Do not add gradients, motion, cards, or decoration merely to signal polish.

## Accessibility and motion

Verify keyboard navigation, visible focus, semantic structure, contrast, target size, zoom/reflow, and a reduced-motion path. Animation must communicate state or hierarchy, remain interruptible, and never be the only carrier of meaning.

## Evidence

Capture representative desktop and mobile renders. Record the viewport, content/state, observed issue, change made, and remaining uncertainty. Treat visual approval as evidence about the sampled states, not proof of every route or breakpoint.