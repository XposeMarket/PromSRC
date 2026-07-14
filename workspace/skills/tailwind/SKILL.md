---
name: "tailwind"
description: "Tailwind CSS v4 browser-runtime patterns for HyperFrames compositions. Use only for HyperFrames Tailwind scaffolds, utility classes, CSS-first theme tokens, v3-to-v4 issues, and deterministic render styling."
---

# Tailwind CSS for HyperFrames

Use this specialist skill after HyperFrames routing. `hyperframes init --tailwind` uses the pinned Tailwind v4 browser runtime; do not treat it like a v3 PostCSS project or the Studio app.

## Contract

- Keep the CLI-injected runtime and `window.__tailwindReady` readiness contract intact.
- Tailwind v4 is CSS-first. Put tokens in `@theme` and custom utilities in `@utility` inside `type="text/tailwindcss"`.
- Do not add v3 `@tailwind` directives or a JavaScript config merely to define normal tokens.
- Use Tailwind for static layout/style and a seekable animation adapter for render timing.
- Keep render-critical class names complete and visible before capture; do not assemble them dynamically only at seek time.
- Use stable dimensions, transforms, opacity, explicit border colors, and deterministic variants. Avoid hover, scroll, focus, and pointer state for required video content.
- For offline or production-stable renders, compile CSS and include it locally instead of relying on a browser runtime fetch.

Read [the detailed guide](references/detailed-guide.md) for v4 examples, class-safety patterns, composition markup, migration notes, and debugging.

Validate the composition with current HyperFrames lint/check commands, inspect frame zero for missing-style flashes, capture representative snapshots, and render a short proof when styles affect delivery.
