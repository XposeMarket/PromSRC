# 32A. Mobile Liquid Glass Reference

Last updated: 2026-06-12

Prometheus Mobile liquid glass is CSS-variable driven. The current production spec is baked into `web-ui/src/styles/mobile.css` under the `:root` `--pm-lg-*` variables and mirrored into `generated/public-web-ui/static/styles/mobile.css`.

2026-06-12 note: the outside-only composer rim and tabbar sibling halo were disabled because they produced a visible/invisible outer ring around the composer and footer. Keep refraction clipped inside the rounded panel unless deliberately reintroducing a temporary dev experiment.

2026-06-13 note: the normal chat composer is intentionally borderless. Do not add `.pm-composer::after` back to the shared inner-border selector, and keep `.pm-composer` / `.pm-composer.is-voice-active` at `border: 0` with no inset top/bottom highlight shadows. The glass should read from its background/lens, not from a visible top/bottom/side outline.

## Surfaces

The shared liquid glass system currently covers:

- Header icon buttons: `.pm-header .pm-icon-btn`
- Header model/status pill: `.pm-header .pm-online`
- Footer tab bar: `.pm-tabbar`
- Footer tab slider: `.pm-tab-indicator`
- Chat composer and voice-active composer: `.pm-composer`
- Side chat composer: `.pm-mobile-side-composer.pm-composer`
- Creative composer: `.pm-creative-composer`
- Shared refraction lens layer: `.pm-glass-lens`
- Border overlays: `.pm-glass-border`, `.pm-composer::after`

The markup for tab bar/composer glass uses real child layers, not only background paint. The lens layer intentionally uses `backdrop-filter`, a slightly enlarged `transform: scale(...)`, and a radial mask so content behind the panel appears refracted instead of simply blurred.

## Current Baked Spec

```json
{
  "--pm-lg-header-blur": "1.5px",
  "--pm-lg-header-saturate": "1.7",
  "--pm-lg-header-brightness": "1.04",
  "--pm-lg-header-border-alpha": "0.22",
  "--pm-lg-pill-blur": "2.5px",
  "--pm-lg-pill-saturate": "2.1",
  "--pm-lg-pill-brightness": "1.02",
  "--pm-lg-pill-border-alpha": "0.18",
  "--pm-lg-panel-blur": "2px",
  "--pm-lg-panel-saturate": "0.95",
  "--pm-lg-panel-brightness": "0.8",
  "--pm-lg-tabbar-border-alpha": "0.1",
  "--pm-lg-composer-border-alpha": "0.06",
  "--pm-lg-indicator-border-alpha": "0.08",
  "--pm-lg-border-width": "1px",
  "--pm-lg-border-alpha": "0.11",
  "--pm-lg-border-opacity": "0.25",
  "--pm-lg-radius": "22px",
  "--pm-lg-inset-highlight-alpha": "0.02",
  "--pm-lg-inset-floor-alpha": "0.025",
  "--pm-lg-shadow-y": "8px",
  "--pm-lg-shadow-blur": "56px",
  "--pm-lg-shadow-alpha": "0.11",
  "--pm-lg-lens-inset": "-5px",
  "--pm-lg-lens-opacity": "0.56",
  "--pm-lg-lens-scale": "1.054",
  "--pm-lg-lens-blur": "1.7px",
  "--pm-lg-lens-saturate": "2.7",
  "--pm-lg-lens-contrast": "0.7",
  "--pm-lg-lens-brightness": "1.075",
  "--pm-lg-lens-hotspot-alpha": "0.095",
  "--pm-lg-lens-field-alpha": "0.035",
  "--pm-lg-lens-core-stop": "78%",
  "--pm-lg-lens-edge-stop": "90%",
  "--pm-lg-lens-edge-alpha": "0.7",
  "--pm-lg-rim-outset": "0px",
  "--pm-lg-rim-width": "9px",
  "--pm-lg-rim-blur": "0px",
  "--pm-lg-rim-saturate": "2.6",
  "--pm-lg-rim-brightness": "1.04",
  "--pm-lg-halo-width": "0px"
}
```

## What The Variables Mean

- `header*` tunes the floating header icon buttons.
- `pill*` tunes the model/status pill in the mobile header.
- `panel*` tunes the main glass material used by the tab bar and composers.
- `tabbar/composer/indicator border alpha` controls each major panel border independently.
- `border alpha/opacity/width` controls the inner overlay border that uses `mix-blend-mode: soft-light` to match whatever is behind the glass.
- `highlight/floor/shadow*` controls specular edge light and the soft shadow below the glass.
- `lens*` controls the center glass refraction layer. `lens-scale` is the fisheye-style magnification. `lens-blur`, `lens-contrast`, and `lens-saturate` change how aggressively background content bends and diffuses.
- `lens-core-stop`, `lens-edge-stop`, and `lens-edge-alpha` control where the center stays readable versus where the edge starts fading/refraction masking.
- `rim*` remains as historical/dev-tuning vocabulary, but the production composer outside rim is disabled with `.pm-composer::before { content: none; }`.
- `halo-width` remains as historical/dev-tuning vocabulary, but the production tabbar sibling halo is not appended and `.pm-glass-halo/.pm-tabbar-halo` are hidden.

## How To Re-Add The Dev Sliders

The sliders were intentionally removed after the spec above was locked in. To temporarily restore them:

1. In `web-ui/src/mobile/mobile-pages.js`, add a temporary `PM_LIQUID_GLASS_TUNER_CONTROLS` array near the mobile chat constants. Each control should include `group`, `id`, `label`, `css`, `min`, `max`, `step`, `value`, and optional `unit`.
2. Add helper functions that read/write `localStorage` key `pm_liquid_glass_tuner_v1`, apply values to `document.documentElement.style.setProperty(control.css, valueWithUnit)`, export `{ version, values, css }`, and expose `window.pmLiquidGlassTuner.get()`.
3. Add `_renderMobileLiquidGlassTuner()` returning a `<section id="pm-liquid-glass-tuner">` with range inputs and Copy/Reset/Hide buttons.
4. Add `_wireMobileLiquidGlassTuner(page)` after `wireMobileContextWindow(...)` in the mobile chat render function.
5. Insert `${_renderMobileLiquidGlassTuner()}` immediately above `<form class="pm-composer" id="pm-composer">`.
6. Re-add the temporary `.pm-liquid-glass-tuner*` CSS block above the composer CSS in `web-ui/src/styles/mobile.css`.
7. Bump the mobile cache key in `web-ui/index.html`, `web-ui/src/mobile/mobile-pages.js`, `web-ui/src/mobile/mobile-router.js`, and `web-ui/src/mobile/mobile-settings.js`.
8. Mirror the edited source files into `generated/public-web-ui/...` if the generated bundle is the served path.
9. Run:

```powershell
node --check C:\Users\rafel\PromSRC\web-ui\src\mobile\mobile-pages.js
node --check C:\Users\rafel\PromSRC\generated\public-web-ui\static\mobile\mobile-pages.js
```

After tuning, copy the JSON from the tuner, update the `--pm-lg-*` defaults in both CSS files, remove the temporary JS/CSS tuner code again, and bump the mobile cache key.

## Sharp Edges

- Do not make the rim/border white by default. The border should be a soft-light overlay so it reacts to chat bubbles, previews, messages, and whatever else scrolls behind it.
- Do not re-enable the outside-only composer rim or tabbar sibling halo for production. They create an outer ring around the glass even when visually subtle.
- Do not re-enable the chat composer inner border overlay. `.pm-composer::after` was removed from the shared border selector because it left a visible outline on the top, bottom, and sides.
- Avoid adding painted glare blobs or pseudo-element smears over the composer. The current approach is variable-driven `backdrop-filter`, masked lens layers, and subtle inner light.
- Keep the composer shadow soft. Hard shadows under the composer make the bottom edge look like a dark strip and break the liquid-glass illusion.
- If the lens looks like it zooms out, adjust `--pm-lg-lens-scale` upward. Values just above `1` magnify; values below `1` visually shrink the background.
