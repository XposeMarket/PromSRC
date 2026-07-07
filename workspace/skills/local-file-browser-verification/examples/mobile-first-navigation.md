# Mobile-first navigation (when user evidence is iPhone/Safari)

Use when the user attached a phone screenshot, reported Safari runtime errors, or asked for mobile-friendly layout verification.

## Rule
Set a **narrow viewport (≤390px width) before the first `browser` navigation** to the local URL — not only after load via resize.

Post-hoc `resize` without reload often leaves desktop React branches mounted (e.g. chart iframe still present).

## Checklist
1. Start HTTP server in project root (record port + LAN URL).
2. If automation supports it: set viewport to 390×844 (or similar) **then** open `http://127.0.0.1:<PORT>/...`.
3. Hard-reload once after viewport is set.
4. Screenshot + console before interaction.
5. In final report, state explicitly whether narrow first paint was used vs desktop-then-resize.

## Evidence
NebulaX 2026-07-05: desktop automation at ~3440px + JS resize to 390px still showed DexScreener iframe; real iPhone hard refresh required. See `repos/nebulax-test/reports/local-browser-verification-2026-07-05.md` §Mobile-specific.