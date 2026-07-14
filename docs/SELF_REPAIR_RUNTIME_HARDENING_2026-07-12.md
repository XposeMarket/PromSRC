# Self-Repair Runtime Hardening

Date: 2026-07-12

## Implemented

- Existing regular `src/**` text-file modifications only; create, delete, rename, copy, binary, traversal, absolute-path, and symlink escapes are rejected.
- Limits for patch bytes, file count, hunk count, and changed lines.
- Declared affected-file equality with the parsed diff target.
- Target-specific dirty-worktree rejection and SHA-256 source preconditions.
- Fifteen-minute proposal expiry and single-use `pending → applying` transition.
- Immutable binding to configured Telegram approvers; apply and reject record and enforce the actor identity.
- Byte-exact preimage restoration after failed builds, guarded against overwriting concurrent target edits.
- Restart results distinguish launcher acceptance from health confirmation or launch failure.
- Test-only runtime seams permit disposable repositories without touching the real source tree.

## Verification

- Backend TypeScript build passed.
- `scripts/test-self-repair-hardening.mjs` passed using temporary Git repositories.
- Batch 3 skill contracts, 148-entry catalog validation, and routing regressions passed.

## Remaining limitation

Restart acceptance is not proof that the replacement gateway became healthy. Self Repair remains partial and explicit-only until boot-time health confirmation updates the repair record and notifies the bound channel.
