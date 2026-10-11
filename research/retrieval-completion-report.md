# Retrieval completion report

Status: DONE_WITH_CONCERNS
BASE: cb2ca5dbd1abccc51dd93947174d39f69c86cb71
Branch: feat/retrieval-provenance-complete
SHA: see final commit returned by worker; this report is part of that commit.

## Paths
`src/runtime/{context-receipt,prompt-manifest,retrieval-provenance,retrieval-provenance.regression}.ts`; `src/gateway/memory-index/{memory-atoms,memory-atoms-hybrid,recall-index,sqlite-store,index,recall-index.regression,automatic-memory-search.regression}.ts`; `src/gateway/chat/{chat-helpers,context-build-worker-client}.ts`; `src/gateway/{prompt-context,audit/audit-ops,routes/audit-log.router,routes/chat.router,tools/defs/agent-team-schedule}.ts`; `research/retrieval-api-contract.md`.

## Checks
PASS: retrieval-provenance regression (real atomic/hybrid producers, original/provider request, section hashes, turn/session joining for completed/cancelled/failed, reviews, redaction/bounds, reversible disabling).
PASS: context-receipt regression; memory-atoms regression; memory-atoms-hybrid regression (10 semantic,5 deterministic,12 negative,250 fuzz queries); recall-index regression (incl actual trace assertions); automatic-memory-search regression (real worker serialization trace assertion); audit-ops regression; context-build-worker equivalence regression.
PASS: TypeScript `npx tsc --noEmit -p tsconfig.json`; `git diff --check`.
No frontend changed: sync:web-ui not applicable. No live restart/deployment/device validation. Initial provenance regression fixture failed because atom compiler requires a ## section; fixture corrected, regression then passed. Production-before-test portions were not test-first.

## Findings (12)
1. Actual atomic scoring records candidates, scores, matches, floors, related gating and budget rejection.
2. Hybrid atomic records actual deterministic/semantic gates, MMR pool, final selection and semantic timeout/error; replaced lexical candidates explicitly superseded.
3. Recall FTS records ranked candidate decisions, duplicate/per-session filters; auto recall records confidence/rarity/canonical-memory/diversity/budget suppression.
4. SQLite automatic search records actual pre-floor/rerank candidates; prompt auto gate records final injection/suppression independently.
5. JSON fallback records actual pre-scoring source/project/date/durability rejection plus scored/operational candidates and merge suppression.
6. Chat carries request-local traces through snapshot capture into promptManifest context; no global current-trace state or tool timing log spill.
7. Normal turn finally joins session+gatewayTurnId completed/cancelled/failed; completion never claims efficacy.
8. HTTP detail/review contract and native audit review/reversible settings implemented; skills routing endpoints/feedback untouched.
9. Receipt captures original vs provider request, all system/developer message hashes and every named section/unlabelled prefix hash; memory text retains existing bounds.
10. Privacy scrubs trace strings before truncation; unsafe source IDs hashed. 96 candidates/6000 chars per trace,8 traces; explicit truncation. Capture reserves12KB join headroom, fails open.
11. Direct receipt reads avoid directory scans; outcome uses one bounded directory enumeration with direct per-ID read, not quadratic rescans. Review failures explicit; workspace roots shared with authenticated audit paths.
12. Concerns: authenticated HTTP/live normal-chat route behavior not exercised end-to-end; callback path covered by typecheck/worker equivalence rather than full provider-driven chat regression. Non-producer turns explicitly unavailable. Bounded history can omit old attempts; no claim of exhaustive lifetime history or measured efficacy.
