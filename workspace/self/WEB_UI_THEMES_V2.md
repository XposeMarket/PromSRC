# Prometheus Theme System v2

## Purpose

Theme System v2 separates **Prometheus UI structure** from **theme color data**. Typography, spacing, component geometry, liquid-glass behavior, motion, and desktop/mobile layout stay owned by Prometheus. A theme supplies colors.

The migration is compatibility-first. The five shipping themes still use their existing CSS paint paths, so this refactor does not silently restyle them.

## Shipping themes

`light` Prometheus One · `gray` Ash & Ember · `dark` Default Dark · `blue` Olympian Blue · `purple` Aether Violet.

Their canonical metadata and audited palettes now live in `web-ui/src/theme-manifest.js`. The small `window.PROM_THEMES` registry in `index.html` remains only for first paint; the contract regression fails if its IDs drift from the manifest.

## Semantic tokens

New component work should prefer `--prom-color-*`: background, background-soft, surface, surface-strong, text, text-muted, border, border-strong, accent, accent-strong, success, warning, danger, plus mobile background/surface/text/accent aliases.

Legacy variables (`--bg`, `--panel`, `--brand`, `--pm-bg`, `--pm-orange`, etc.) remain supported during migration.

## Identity vs compatibility profile

Theme v2 adds `data-theme-id`, `data-theme-profile`, and `data-theme-engine="v2"`.

Shipping themes keep their current `data-skin`. Future/imported themes use `data-skin="custom"` as the compatibility profile while retaining their actual identity in `data-theme-id`. This is intentional: current shared desktop rules enumerate the shipping skins plus `custom`, so a new palette can inherit the complete Prometheus shell without adding another selector forest.

## Runtime adapter contract

`window.PROM_THEME_V2` exposes the schema version, presets, `normalize`, `toLegacyVariables`, `applyDefinition`, and `syncTokens`.

A future VS Code/Codex adapter should translate its source palette into the semantic definition and call `applyDefinition`. It should never import external typography, layout, spacing, or component CSS.

## Appearance settings

The existing Appearance controls remain authoritative for Accent, Background, Foreground, UI font, translucent sidebar, Contrast, background images/embers, and background opacity.

Theme v2 adds **Advanced palette** controls for Custom theme only: Surface, Elevated surface, Muted text, and Border. These persist under `prometheus_appearance_v2` and are disabled for official presets.

Theme v2 also bridges Custom theme values into mobile `--pm-*` surface/accent tokens. Previously the custom editor generated desktop variables but did not establish a complete mobile custom palette.

## Rules for future work

1. Do not rewrite shipping theme CSS without visual-regression baselines.
2. New components should consume semantic `--prom-color-*` tokens.
3. New themes should be data definitions, not new `data-skin` selector forests.
4. External adapters map colors only; Prometheus typography/UI stays Prometheus.
5. Keep source and `generated/public-web-ui` mirrors in sync.

## Validation

Run `node scripts/test-theme-system-contract.mjs` and `npm run check:web-ui`.
