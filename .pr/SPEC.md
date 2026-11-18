# SPEC: Claude Fable 5.2 and Mythos 5.2
Surface: both
Parity: fixed both: shared backend contract plus desktop/mobile/agent picker fallbacks; channels use same provider.
Test: npx tsx src/providers/claude-52.regression.ts
Size justification: Model addition spans existing duplicated picker catalogs; no picker redesign.

## Problem
Officially released 2026-11-09 models absent from local catalogs. Mythos5.2 misses context metadata. New contract needs verified reasoning and pricing.
## Existing code
AnthropicAdapter ANTHROPIC_MODELS and request builder; shared reasoning-capabilities; model-context; model-pricing; agent model aliases; desktop/mobile fallback arrays.
## Options
1. Picker strings only: smallest but missing Mythos metadata and pricing.
2. Minimal complete contract + catalogs + tests: selected.
3. Provider discovery/catalog redesign: unnecessary and deferred.
## Chosen approach
Add exact official IDs; preserve every default/old model. Share existing request policy. Exact5.2 always-on adaptive and pricing; context, vision, aliases. Mythos remains provider access-controlled. No auth/enrollment changes.
## Acceptance
Both catalogs selectable on desktop/mobile and agents; five efforts; 1M/128K; $8/$40/$0.20/$10 cache-write. Requests omit invalid sampling/forced tools/manual or disabled thinking. Mocked tool continuation and native access-error tests. Older models unchanged. Focused tests, typecheck, build/sync, hard gates and real surface proof. No live model or defaults switched.
## Out of scope
Default upgrades, provider credentials, access enrollment, paid inference, signed-reasoning history redesign, auto-merge.
## Files
- `src/providers/anthropic-adapter.ts` - catalog, metadata and request compatibility
- `src/providers/reasoning-capabilities.ts` - explicit always-on contract if required
- `src/providers/model-pricing.ts` - exact new prices
- `src/gateway/context/model-context.ts` - Mythos5.2 capacity
- `src/agents/model-routing.ts` - explicit aliases
- `web-ui/src/reasoning-capabilities.js` - browser parity if required
- `web-ui/src/components/agent-model-picker.js` - fallback list
- `web-ui/src/legacy-desktop-bootstrap.js` - fallback list
- `web-ui/src/pages/SettingsPage.js` - fallback lists
- `web-ui/src/mobile/mobile-settings.js` - fallback list
- `web-ui/src/mobile/mobile-model-badge.js` - fallback list
- `src/providers/claude-52.regression.ts` - regression
- `docs/CLAUDE-52.md` - contract, access limits and evidence
- `generated/public-web-ui/` - generated synchronized assets
## Scope notes
- `web-ui/src/model-display.js` - verified-organization hint in existing model selects.
- `scripts/test-claude-52-ui.mjs` - browser capability parity and actual component desktop/mobile proof.
User explicitly authorized Astra contract check then building both via question fa285797. Tier2 scoped check; no source edited before findings settle. Exact-head fresh check required. self/04 read and update in same turn.
## Risks
Mythos requires verified organization; catalog is not entitlement. Both require30-day retention, never changed here. API estimates differ from subscription usage. Prefix-bound thinking unsupported history replay must be checked. Rollback revert PR or select prior model. PR853 overlaps generated bundle and distant legacy bootstrap hunk; regenerate if merged first.

Additional scoped files: `web-ui/src/model-display.js` adds Mythos verified-org hint to existing select relabeling; `scripts/test-claude-52-ui.mjs` verifies browser capability/label parity. Official migration docs confirm Messages fast mode for both5.2, so shared backend/browser speed policy now recognizes exact5.2; no fast mode selected automatically.
