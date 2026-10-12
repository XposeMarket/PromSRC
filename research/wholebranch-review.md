# Whole-branch integration review

Status: **DONE_WITH_CONCERNS** — needs changes for the two confirmed code-path defects below.

Reviewed branch `feat/context-routing-observability`, initially `47dcf372a486042f7c95c9f55e066d7208dab97b`, then canonical voice integration `17443e7f1fb33802842ea83a5216250b225a2e9c`, with final integration delta checked through `09d4f86bc3a0b1009dc6a0e719cb5ee4d22f5ca7`. Compared BASE `cb2ca5dbd1abccc51dd93947174d39f69c86cb71` and `origin/main`; reviewed acceptance at the main workspace `research/voice-context-audit/acceptance.md`. Read-only source review; only this requested report written. No source edits, push, merge, or spawned workers.

## Standards — confirmed defects

- **Important — `src/gateway/skills-runtime/skill-curator.ts:73,88-89,1170,1193` (confidence 95): a tested routing proposal stores the entire current skill manifest, but stale-apply checks compare only `triggers` and `promptSignals`.** Any non-trigger manifest edit after proposal creation (description, tools, requirements, other routing/security metadata) passes the guard and the old full overlay is supplied to `writeManifestOverlay`. Rollback at lines 1153-1155 has the same guard/snapshot mismatch. This can restore unrelated obsolete metadata although this lane promises trigger-only mutation. Minimal fix: persist/apply/rollback only the allowed trigger fields, or bind the full manifest snapshot to a canonical hash and reject any stale full-manifest apply/rollback. Regression: create proposal, mutate a non-trigger manifest field, apply and roll back; require the new field to survive or the operation to refuse.

## Spec — confirmed defects

- **Important — `web-ui/src/pages/ChatPage.js:23304-23330,23253-23275` (confidence 95): backend microphone capture binds its session/epoch only when transcription begins, not when recording starts.** Record in A, navigate to B before stopping, and `transcribeBackendRecording` snapshots B at line 23254; its post-request stale-session guard consequently succeeds and submits A's audio transcript via B's normal composer. Session navigation at lines 9041-9045 only disables a session-bound legacy realtime connection, not this recorder. Violates acceptance line 7: “stale transcription can't submit after thread navigation.” Minimal fix: bind session and epoch before microphone acquisition/recording; carry them through the onstop callback and validate before upload and submit. Invalidate/stop capture on navigation. Add an executable recording-in-A/navigation-to-B/stop regression, not just navigation during an already pending transcription.

## Positive evidence / limitations

Observed privacy scrubbing before receipt text persistence, bounded per-record byte budgets and fail-open receipt outcome capture, explicit unknown efficacy, same-turn terminal outcome matching, textContent-only evidence rendering, pending trigger proposals with positive and distinct negative original-request checks, and stale trigger-field apply/rollback guards. Latest chat finalizer delta preserves both unfinished learning capture and receipt outcome capture.

Executed successfully against the integrated checkout:

- `node scripts/test-canonical-voice.mjs` — PASS canonical desktop/mobile transport, attachments/request IDs, approval/final/cancellation, audio-only OpenAI/xAI speech synthesis and unsupported-provider rejection.
- `node scripts/test-context-review-dashboard.mjs` — PASS desktop/mobile pagination, literal XSS handling, retrieval detail, reviews, reset confirmation, empty/error and 320px overflow.

These synthetic suites do not prove physical microphone/audio behavior, live restart/build SHA, real-device screenshots, or actual provider authentication on Raul's devices. Main owns full foundation/typecheck/build/live deployment and acceptance evidence. Review was bounded to source-path inspection and focused integration checks rather than exhaustive execution of every changed hunk; do not treat absence of additional findings as proof of all acceptance clauses.
