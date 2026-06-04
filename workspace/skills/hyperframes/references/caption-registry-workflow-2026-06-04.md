# Caption Registry Workflow — HyperFrames / Prometheus

Use this before custom-building captions for HyperFrames projects.

## Catalog-first rule

Current HyperFrames docs list ready-made caption components. Before writing a bespoke caption system, run or consult:

```bash
npx hyperframes catalog --tag caption-style
```

Install with:

```bash
npx hyperframes add <caption-component>
```

Then wire according to the CLI output and `hyperframes-registry` skill.

## Known caption components

| Style | Component | Best for |
|---|---|---|
| TikTok-style highlight | `caption-highlight` | Social, high-energy |
| Karaoke pill | `caption-pill-karaoke` | Music, lyric videos |
| Cinematic editorial | `caption-editorial-emphasis` | Documentary, storytelling |
| Glitch / cyber | `caption-glitch-rgb` | Tech, gaming |
| Full-screen slam | `caption-kinetic-slam` | Hype, announcements |
| Neon glow | `caption-neon-glow` | Night/neon aesthetics |
| Neon accent | `caption-neon-accent` | Colorful/playful |
| Wipe reveal | `caption-clip-wipe` | Clean, modern |
| Gradient fill | `caption-gradient-fill` | Vibrant/eye-catching |
| Matrix decode | `caption-matrix-decode` | Sci-fi/tech reveals |
| Emoji pop | `caption-emoji-pop` | Social/casual |
| Parallax layers | `caption-parallax-layers` | Depth/cinematic |
| Particle burst | `caption-particle-burst` | Celebration/impact keywords |
| Lava texture | `caption-texture` | Bold/dramatic |
| Weight shift | `caption-weight-shift` | Elegant/typographic |
| Difference blend | `caption-blend-difference` | Editorial over varied footage |

## Prometheus style routing

Raul generally dislikes generic AI visual tells. Default away from neon/purple/glass unless the piece explicitly calls for it.

- Old-school/editorial/print → `caption-editorial-emphasis`, `caption-weight-shift`, possibly `caption-texture`.
- Product/promo/launch → `caption-highlight`, `caption-clip-wipe`, or custom editorial lower captions depending on tone.
- Developer/tooling → `caption-weight-shift`, `caption-matrix-decode`, or clean mono custom captions.
- Social/hype → `caption-highlight`, `caption-pill-karaoke`, `caption-kinetic-slam`.

## Non-negotiables even with catalog components

- Transcript timestamps drive timing.
- One caption group visible at a time.
- Deterministic hard kill at group end: `tl.set(... visibility: "hidden")`.
- Use `fitTextFontSize()` or component equivalent for safe width.
- Do not cover faces or key subject areas.
- Add host-level contrast layer when footage/background is bright or busy.
- Never use `.en` Whisper models unless Raul explicitly says the audio is English.

## Custom caption fallback

Only custom-build when:

- no registry style fits;
- the project needs exact brand/type behavior;
- component wiring fails and the deadline favors a deterministic local caption implementation;
- Raul asks for a custom style.

When custom-building, still follow `references/captions.md` for grouping, overflow safety, and hard-kill checks.
