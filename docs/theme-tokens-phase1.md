# Shared theme contract — phase 1

`theme-tokens.css` is additive: no existing desktop or mobile rendering variable
is rewritten. It loads before desktop CSS and is the first mobile shell-owned
stylesheet. Both standalone HTML entrypoints and production CSS entries load it
first; mobile keeps its existing layer-order declaration before the imports.
The 34 required `--t-*` properties read the existing effective
palette through `var()` rather than maintaining a second copy of its hex values.
Thus every registry preset and the custom builder's inline derived palette retain
their current colors. Type scale is exposed (12/13/14/16/20), not applied yet.
The ten `--prom-*` aliases supply the generated-visual/Viz Kit theme contract.

Mobile deliberately reads **its current** `--pm-*` palette. Root aliases support
root consumers; body aliases resolve route-local gold chrome on non-chat routes.
P1 remains `light` on desktop and `dark` on mobile. No preference is migrated in
this phase. The actual mobile skin and its existing palette, not the desktop
meaning of the ID, control these tokens. No legacy `--pm-*` aliases are inverted.

## Next phases

- Phase 2: replace raw accent literals with semantic tokens and delete only
  proven redundant recolor overrides. Migrate mobile IDs to the shared registry
  with a versioned, one-time, **surface-aware** preference migration; historical
  `dark` is ambiguous, so do not silently reinterpret desktop Default Dark.
- Phase 3: invert `--pm-*` into aliases of `--t-*`, remove copied mobile palettes,
  and model the current gold non-chat chrome as an explicit chrome-accent option.
  Apply themeable font families and the five-step scale, eliminating sub-12px
  mobile text after screenshot/accessibility verification.
- Phase 4: consolidate desktop, legacy bootstrap, mobile, custom builder, ember
  palettes, and status-bar metadata into one theme registry module.

`scripts/test-theme-tokens.mjs` enforces registry coverage and the visual bridge,
and ratchets the committed accent-literal counts. All changes are shared browser
CSS/JS, with no platform dependencies or account-specific runtime data.
