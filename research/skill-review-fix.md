# Skill trigger overlay review fix

- **DONE** in integration checkout `C:\Users\rafel\promsrc-pr\context-routing-observability`, based on HEAD `09d4f86bc`; read `fast-coding-loop` and `research/wholebranch-review.md`.
- New routing-tested proposals persist only `triggers`/`promptSignals` for proposed and rollback snapshots; candidate evaluation still uses current nontrigger manifest metadata.
- Apply and rollback extract only those allowed trigger fields from snapshots, including already-persisted legacy full manifests, and merge them into the current manifest before the overlay-replacing writer runs.
- Existing stale trigger guards remain unchanged; absent prior prompt signals are explicitly cleared on rollback rather than retaining newly introduced signals.
- Real `skillsCapabilityExecutor` dispatcher regression runs both new and simulated legacy persisted proposals: propose → description/requiredTools edit → apply → another metadata edit → rollback; both edits survive at the corresponding stages.
- Regression checks stale trigger apply and stale prompt-signal rollback refusal, restored baseline routing fields, two valid positives, three distinct negatives, and failure of a patch that loses valid positive coverage.
- **PASS** `npx tsx src/gateway/learning/skill-trigger-monitor.regression.ts` (both scenarios print `skill-trigger-monitor regression: ok`; final run exit 0).
- **PASS** scoped `git diff --check`; source edits limited to `src/gateway/skills-runtime/skill-curator.ts` and `src/gateway/learning/skill-trigger-monitor.regression.ts`, plus this requested report.
- **Concerns/limits:** no full build/typecheck/live deployment performed; main coordinator owns integration verification. No spawns, commits, pushes, frontend, or generated-file edits performed.
