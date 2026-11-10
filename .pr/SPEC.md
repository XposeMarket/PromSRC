# Dead-code sweep, pass 2
Tier: 1; owner-approved deletion of proven-unused code, stacked on #871 (chore/dead-code-sweep).
Surface: none
Parity: no runtime behavior change on desktop, web, mobile PWA or channels; deleted modules had no runtime importer.
Size justification: deletions only (17 files) plus doc lines that described the deleted modules as live.
## Problem
Pass 1 audit (diagnostics/audit/codebase-2026-11-10) left modules that only their own tests import, an unconsumed apps/mobile native-app core, and one-off scripts nothing calls.
## Chosen approach
Delete only candidates with zero imports, zero path-string/dynamic/glob/npm/CI/builder references, no docs describing them as current, and added more than 30 days ago. Delete their tests with them and fix docs that described them as live. Everything else is kept and listed in .pr/FIXER-REPORT.md.
## Files
- apps/mobile/** (13 files, deleted)
- src/gateway/runtime/execution-controller.ts, execution-controller.regression.ts (deleted)
- src/gateway/recommendations/recommendation-service.ts, recommendation-service.regression.ts (deleted)
- docs/RECOMMENDATIONS.md (deleted)
- scripts/redact-private-skill-content.mjs (deleted)
- docs/universal-execution-runtime.md
- ARCHITECTURE.md
- scripts/run-unwired-tests.mjs
- workspace/self/02-startup-gateway-runtime.md
- .pr/SPEC.md
## Acceptance
Test: npx tsc --noEmit -p . && npm run test:docs-evidence && npm run test:crash-recovery
No remaining reference to any deleted path outside generated inventories and dated investigation notes.
## Risks
A path-string loader missed by search would fail at runtime; mitigated by repo-wide rg on basenames including the live workspace skills catalog. Rollback: revert this one commit.
