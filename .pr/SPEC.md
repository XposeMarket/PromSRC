# Dead-code sweep, pass 2
Tier: 1; owner-approved deletion of proven-unused code, stacked on #871 (chore/dead-code-sweep).
Surface: backend
Parity: no runtime behavior change on desktop, web, mobile PWA or channels; deleted modules had no runtime importer.
Size justification: deletions only (17 files) plus doc lines that described the deleted modules as live.
## Problem
Pass 1 audit (diagnostics/audit/codebase-2026-11-10) left modules that only their own tests import, an unconsumed apps/mobile native-app core, and one-off scripts nothing calls.
## Chosen approach
Delete only candidates with zero imports, zero path-string/dynamic/glob/npm/CI/builder references, no docs describing them as current, and added more than 30 days ago. Delete their tests with them and fix docs that described them as live. Everything else is kept and listed in .pr/FIXER-REPORT.md.
## Files
- apps/mobile/src/core/auth/index.ts
- apps/mobile/src/core/auth/pairing-client.ts
- apps/mobile/src/core/gateway/gateway-client.ts
- apps/mobile/src/core/gateway/index.ts
- apps/mobile/src/core/gateway/types.ts
- apps/mobile/src/core/index.ts
- apps/mobile/src/core/storage/gateway-credentials.ts
- apps/mobile/src/core/storage/index.ts
- apps/mobile/src/core/storage/storage.ts
- apps/mobile/src/core/transport/http-client.ts
- apps/mobile/src/core/transport/index.ts
- apps/mobile/src/core/transport/sse.ts
- apps/mobile/tests/gateway-client.test.ts
- src/gateway/runtime/execution-controller.ts
- src/gateway/runtime/execution-controller.regression.ts
- src/gateway/recommendations/recommendation-service.ts
- src/gateway/recommendations/recommendation-service.regression.ts
- docs/RECOMMENDATIONS.md
- scripts/redact-private-skill-content.mjs
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

## Scope notes
Stacked on PR #871 (chore/dead-code-sweep, 10371a1f3), which is not yet on origin/main. Every other file in the diff against origin/main (ARCHITECTURE_ANALYSIS.md, package.json, package-lock.json, runtime-dependencies.public.json, tsconfig.json, three.min.js, the ten skill-migration scripts (scripts/apply-hyperframes-skill-routing.mjs, scripts/apply-skill-health-phase1.mjs, scripts/apply-skill-phase2c-2d.mjs, scripts/consolidate-dated-skill-resources.mjs, scripts/copy-skill-body-reference.mjs, scripts/normalize-skill-frontmatter.mjs, scripts/normalize-skill-manifests.mjs, scripts/preserve-skill-details.mjs, scripts/set-skill-lifecycle.mjs, scripts/write-final-skill-classification.mjs), scripts/prune-dist.js, scripts/test-prune-dist.mjs, scripts/stateful-dynamic-imports.baseline.json, src/connections/discovery-service.ts, src/gateway/llm-primary.ts, src/security/index.ts, the three web-ui deletions and their generated twins) belongs to #871 and is unchanged here. This branch adds only the files listed above.
