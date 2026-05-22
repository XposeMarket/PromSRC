# Pretext Pattern Map for Prometheus Creative Video

| Upstream pattern | Prometheus adaptation | Notes |
|---|---|---|
| Flow around obstacle | Timeline-driven orb/logo/product reflow clip | Replace mouse movement with deterministic time-based motion for export. |
| Text-as-geometry game | Short game-like visual bumper | Use as visual metaphor, not interactive-only game, unless user asks for a playable demo. |
| Shatter typography | Hook/title reveal or transition | Cache glyph homes; trigger explode/reassemble by scene time. |
| ASCII mask as moving obstacle | Logo/shape/text collision field | Row spans must match visible silhouette. Good for AI/dev/terminal aesthetics. |
| Editorial multi-column | Product/founder/launch editorial clip | Add pull quote/card/screenshot obstacles and final CTA. |
| Multiline shrink-wrap | Quote/stat card auto-fit | Use for deterministic typography in cards and captions. |
| Kinetic typography | Social hook, quote, manifesto, launch title | Animate per line/glyph while preserving readability. |

## Best first Prometheus preset candidates

1. `pretext-orb-reflow-vertical` — vertical 9s clip, prose opens around glowing orb, hero + CTA overlay.
2. `pretext-glyph-shatter-hook` — title explodes into glyph particles and reforms into CTA.
3. `pretext-ascii-logo-reflow` — ASCII/object silhouette carves text flow in a terminal/editorial scene.
4. `pretext-editorial-pullquote` — magazine columns wrap around an animated quote or product card.
