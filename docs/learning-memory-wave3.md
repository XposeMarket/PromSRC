# Learning and memory Wave 3

## Skill learning

`brain.skillLearning.autoReview` is opt-in and defaults to `false`. Brain must also be enabled. Post-task review creates candidates, not skill files; existing Curator approval remains the control point. The hook lives in the shared `handle-chat.ts` completion finalizer so interactive, channel, task and background callers use the same queue without duplicate per-surface hooks. Review conservatively submits only substantial repeated failure signals, not every successful tool sequence.

Every mutating Curator application passes through `promoteSkillCandidate` (`src/gateway/skills-runtime/skill-curator.ts`). Promotion re-runs positive/negative trigger examples against the current catalog and a separate sample of real requests with native relevance reviews. Holdout originals and review context hashes must match authoritative session history. At most 32 distinct holdout requests from the past 90 days are replayed. Partial scans, missing originals, absent independent holdouts, or degraded relevant routing reject the candidate as `rejected_by_replay`. Restoring a rejection reopens it for review, not bypasses the gate.

Gate decisions and hashed replay evidence are appended to `Brain/skill-curator/promotion-ledger.jsonl`; failed decisions are persisted with the suggestion. Successful mutations also retain the existing SkillsManager change ledger. `review_only` suggestions do not mutate skill files and do not require promotion replay.

This is routing-regression protection, not proof that a changed instruction improves downstream task success. Resource/instruction candidates without positive and negative trigger examples cannot yet be promoted. Native routing reviews and retained original histories are required; fresh installs deliberately fail closed until evidence exists. The gate does not replace existing skill safety checks or authorize autonomous mutations.

## Memory lifecycle

Memory facts remain data, never executable instructions. Contradiction detection is deterministic rather than an LLM claim of semantic equivalence: overlapping subjects with changed numeric/date/negation facts supersede the older bullet while retaining annotated history. Same-subject overlap uses normalized token Jaccard at least 0.6 or an explicit `Subject: value` key. Superseded facts at least 90 days older receive a stale marker. The implementation excludes superseded/stale and instruction-poisoned bullets from recall/index and memory atom injection (stronger than down-ranking); explicit reads still retain the source history. Writes, updates and deletes await index refresh; deletion removes the durable bullet and its index entries. See `src/gateway/memory-recall.regression.ts` for executable retrieval, contradiction, freshness, deletion, and instruction-poisoning examples.

## Verification

Run `npx tsc --noEmit -p .`, `npm run test:memory-recall`, and `npm run test:skill-promotion`. The two benchmarks also run in `.github/workflows/pr-regression.yml`. No UI bundling or live gateway restart is needed for this backend-only source branch; deploying it requires the normal build/restart workflow.
