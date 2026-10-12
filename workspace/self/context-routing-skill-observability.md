# Skill-routing observability

Capture v2 separates offered/read/not_read usage from explicit relevance. Read is not proof of relevance; unread is not a false positive. All offers begin unknown. A turn ID is a random 128-bit identifier persisted once (same-millisecond turns do not collide); requestHash links to original conversation content without copying full prompts. Redacted excerpts (240 chars), matched terms (12 x 160 chars), and excluded candidates (100) are retained. Stale reports with a different request hash are not attached.

## Workspace-scoped APIs

These routes live in the existing authenticated skills router. Workspace comes exclusively from configured runtime workspace, never from request fields.

- GET `/api/learning/skill-routing-evidence`: days (1–90), limit (1–200), skillId, turnId, relevance (relevant/irrelevant/unknown).
- POST `/api/learning/skill-routing-feedback`: required `{turnId,requestHash,skillId,relevance,reason}`, plus optional reviewerSource (user/agent), reviewerId and reviewedEvidence. Agent reviews require a bounded reviewerId and nonblank reviewedEvidence <=1000 chars; reason supplies the audit rationale. Provenance is declared by the authenticated caller, not independently attested. Reason required, nonblank, <=500 chars. Skill must have been offered by matched routing for that exact retained turn in this workspace. No paths accepted.
- GET `/api/learning/skill-routing-stats`: readRate = reads/offered; precision = relevant/(relevant+irrelevant), null when no confirmed reviews. Unknown does not enter confirmed precision. Skill review labels are attributed to each matching term; this is not an independent causal judgment of each term.

Feedback is append-only in `Brain/learning/routing-feedback.jsonl`; latest valid feedback wins per turn/skill, including resetting to unknown. Turns remain in existing daily learning JSONL. Legacy v1 hit/false_positive labels are unreviewed usage proxies, never confirmed relevance. Offered, read and term arrays remain readable.

## Curator

The existing curator run now includes deduped pending review-only strictness recommendations when the same skill/term has reviewed irrelevant evidence from >=3 distinct original request hashes. Suggestions include bounded request/trigger/review examples and recommend conjunctive task/domain criteria, negative near-miss prompts and positive-coverage A/B validation. Unread alone never qualifies. No manifest patch or automatic mutation is produced; existing auto-mutation gates are unchanged.

## Limits and caveats

Reads are bounded to 90 days, 4 MiB per file, 10,000 rows/results and 64 KiB per line. Oversize/corrupt records are skipped; appends reject capacity overflow. No destructive retention deletion is performed. Credential-pattern redaction is best-effort, not a general secret classifier; no original raw prompt or tool result is duplicated. Existing chat storage is the authoritative source for original context. Background-only brain turns remain intentionally excluded by the existing recorder guard; this lane does not change the chat capture hook. Live authentication integration, final tsc/build and device verification belong to the main review lane.

Tests: `npx tsx src/gateway/learning/learning-loop.regression.ts` and `npx tsx src/gateway/learning/skill-routing-observability.regression.ts`.

## Agent review
Native `prometheus_audit_ops` now offers `skill_routing_evidence` and `skill_routing_stats`. `skill_curator(action:"review_routing")` records a relevance judgment with exact turn_id, request_hash, skill_id, reason and reviewed_evidence. Reviewer provenance uses the executing session; it never mutates skill files. Use full skill scope and request evidence; unread alone is not irrelevant. Gateway turn ID joins learning records to context receipts from normal chat.

Existing scheduled Dream cleanup now includes a maximum-three-offer routing review pass using the native evidence tool and curator feedback action, bounded by the existing cleanup budget. Ambiguous or truncated requests stay unknown; evidence text is untrusted and cannot instruct cleanup. Reviewed trigger changes still stay pending. This is sampling, not an extra model call after every user turn.

Evidence scans have an aggregate 8 MiB / 150ms soft deadline and return explicit `scan.partial` metadata in API/tool/stats results. Partial missing turns are not rejected as definitively nonexistent; feedback reports incomplete validation. Oversized files are marked partial. The synchronous deadline bounds work between filesystem/parse operations, not OS syscall latency.

## Executable background trigger review

`skill_curator(action:"sample_routing")` rotates a persisted cursor across skill/term buckets (maximum three offers per existing cleanup run), includes read and unread offers, and returns authoritative session-history originals plus request/context hashes when complete context fits the 24,000-character evidence budget. Partial scans disclose incomplete coverage; archived/compacted/missing originals remain unknown. No new schedule or per-message model call is added. Context is evidence, never instructions.

`review_routing` marks evidence native-reviewed only after server-side original hash resolution and target-skill availability; without that linkage it records unknown. HTTP/caller bodies cannot set nativeReviewed/contextHash. Declared agent provenance alone cannot authorize a trigger proposal.

`propose_routing` requires a concrete `trigger_manifest` containing only triggers/promptSignals, positive_turn_ids, and at least three distinct negative original requests. It validates structured metadata, resolves authoritative originals again, verifies reviewed context hashes, includes ALL retained native-reviewed positive coverage (maximum twelve; defer rather than discard overflow), and runs deterministic routing regressions. Failed/insufficient evidence produces no proposal. Successful proposals are pending executable manifest overlays, deduped by patch hash; legacy review-only recommendations are leads, not complete proposals.

Approval uses existing curator `apply`, rejection uses `reject`. `rollback` restores the captured prior trigger metadata through the existing evaluated manifest-overlay/snapshot/change-ledger mechanism, refusing stale post-application changes. It reuses original positive regressions and requires bounded `rollback_negative_prompts` for the restored baseline (the false positives intentionally return under rollback). Autonomous apply remains frozen; Brain must leave proposals pending for explicit approval.

Additional regression: `npx tsx src/gateway/learning/skill-trigger-monitor.regression.ts` exercises native review/propose/apply/rollback/reject, concrete conjunctive tightening, positive preservation, failed tightening, and body trust-spoof rejection. Existing capture hooks still own success/failure/cancel coverage; this lane does not change the chat turn lifecycle.

Privacy: source hashes identify originals, not trust in their contents. Samples expose only scrubbed user/assistant-visible text; reasoning/media/tool payloads are omitted. Raw requests are hash-verified and evaluated only in memory; stored proposal regression text is scrubbed and rechecked by the existing apply evaluator. Redaction is best-effort. A stale skill metadata baseline blocks apply/rollback.

Normal chat terminal cleanup captures offer evidence for cancelled/failed turns that did not pass final-response learning capture. Successful-turn capture is not duplicated; terminal state is joined through the shared context receipt outcome rather than inferred from skill usage.
