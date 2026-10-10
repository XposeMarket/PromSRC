# Testing and verification

How Prometheus behaviour is verified, what CI enforces on every pull request,
and how to reproduce it locally. Paths and scripts named here are checked by
`npm run test:docs-evidence`, so this file cannot silently drift from the code.

## What CI enforces

Every pull request and every push to `main` runs
`.github/workflows/pr-regression.yml` (about 60 steps, ~5 minutes on
`ubuntu-latest`, Node 22). `main` is branch-protected: the **`verify`** job and
the **`audit`** job (privacy and secret scan,
`.github/workflows/privacy-secret-scan.yml`) are *required status checks*, and
admins are not exempt. Nothing merges red.

The `verify` job runs, in order:

1. `npx tsc --noEmit` over the whole backend.
2. Contract regressions for each subsystem (provider evidence, Brain, memory,
   connectors, tool categories, composites, web UI architecture and size
   budgets, mobile and desktop chat recovery, restart continuity, context
   window, Electron security boundary, and more).
3. **Turn-loop replay scenarios** (`npm run test:replay`) and the **tool
   dispatch policy** unit (`npm run test:tool-dispatch-policy`).
4. **Security controls** (`npm run test:security-controls`) and the
   **docs-evidence** check (`npm run test:docs-evidence`).

`storage-layout-contract.yml` additionally pins the on-disk data layout.

## The replay harness: testing the real agent loop headless

`src/testing/replay/` boots the **real** `handleChat` turn loop with no
gateway, no Electron, no network and no real model. Only the model and
side-effecting tools are fakes; context assembly, the tool surface, dispatch
policy, the approval queue, `executeTool`, the loop detector, stop handling and
stream events are production code. Any side-effecting tool without a stub
(desktop, browser, shell, connectors) is blocked, so a scenario cannot touch the
machine. Boot is ~3 s; the suite runs in ~20 s.

A scenario is a scripted model plus assertions on what the runtime did
(see `src/testing/replay/README.md`). Current contracts:

| Contract | What it proves |
|---|---|
| `text-answer` | A plain answer streams once and finalises once. |
| `tool-round-trip` | A tool result is returned to the model under the right call id. |
| `parallel-tool-results-paired` | Parallel calls each get their own result. |
| `tool-crash-is-reported` | A throwing tool becomes an error the model can see. |
| `approval-granted-executes` / `approval-denied-blocks` | Approval gates the call in both directions. |
| `abort-during-generation` / `abort-during-tool-stops-loop` | Stop ends the turn promptly in either phase. |
| `abort-releases-pending-approval` | Stop rejects the turn's pending approvals; nothing hangs. |
| `provider-error-is-not-success` | A provider failure is never reported as success. |
| `loop-detector-blocks-repeats` | Identical repeated calls are stopped. |
| `runaway-turn-has-a-ceiling` | Rounds where nothing may run end the turn. |
| `failing-tools-are-not-idle-rounds` | Real failures do not count toward that ceiling. |
| `harness-blocks-unstubbed-side-effects` | Tests cannot reach the real machine. |
| `unknown-tool-needs-no-approval` | Unknown tools are refused without an approval card. |
| `tool-outside-surface-is-refused` | Tools the model was not offered do not run. |
| `category-request-unlocks-tool-same-turn` | Activating a category makes its tools runnable in the same turn. |
| `malformed-tool-args-are-reported` | Invalid argument JSON is refused and reported. |

Scenarios can also be `known_gap`: the intended behaviour for a bug not yet
fixed. They report as expected failures; when a fix makes one pass, the runner
fails until the PR promotes it to a contract.

## Security coverage

Each control in [SECURITY.md](SECURITY.md) maps to a test:

| Control | Test |
|---|---|
| Offered-surface authority, allowlists, malformed calls | `src/gateway/chat/tool-dispatch-policy.regression.ts`, replay scenarios |
| Approvals bind to the action; stop releases them | replay scenarios, `src/gateway/tasks/task-approval-control.regression.ts`, `src/gateway/proposals/proposal-approval-flow.regression.ts` |
| Final-action one-shot grants | `src/security/security-controls.regression.ts` |
| Shell deny patterns | `src/gateway/tool-deny-policy-quoted.regression.ts` |
| Path boundary, symlink/junction escapes | `src/gateway/path-permissions.regression.ts`, `scripts/test-tool-security-boundaries.mjs` |
| Elevated commands need fresh approval | `scripts/test-elevated-command-approval.mjs` |
| Secret scrubbing of logs | `src/security/security-controls.regression.ts` |
| Public-build hiding of self-dev tools | `src/security/security-controls.regression.ts` |
| Electron renderer boundary | `scripts/test-electron-security-boundary.mjs` |
| Secrets in the tree and Git history | `scripts/audit-repo-privacy.mjs` (required `audit` check) |

## Running tests locally

```bash
npm install
npx tsc --noEmit             # type-check
npm run test:replay          # agent-loop contracts, headless
npm run test:tool-dispatch-policy
npm run test:security-controls
npm run test:docs-evidence
npm run test:unwired         # every regression not wired into CI (slow, informational)
npm run check:dist           # no compiled output without source
```

Most subsystem suites are single files: `npx tsx path/to/thing.regression.ts`
or `node scripts/test-*.mjs`. `self/generated/tests.md` in the runtime
workspace indexes them by area.

## What is not covered yet

Stated so reviewers do not have to infer it:

- **Live-model task evaluations** (coding success rate, small-model
  reliability) are not yet published; CI is deterministic and never calls a
  real provider.
- **End-to-end UI** is covered by contract tests plus manual device checks,
  not by full browser automation of every flow.
- **Crash fault-injection** exists for restart continuity and goal recovery,
  not yet for every tool mid-execution.
