

## 2026-09-21 — PR #380 CI failure + restart continuity investigation

### Prometheus/tooling issues

- **Gateway restart continuity is still broken in the running build.** Raul's
  screenshots show the mobile stream vanishing on restart and a raw
  `{"error":"Prometheus gateway is restarting...","code":"GATEWAY_RESTARTING"}`
  JSON page. Root cause: PR #380 is **not merged and not running**. The live
  gateway (Electron PID 28468, started 19:57) predates the fix; `dist/` was
  rebuilt at 21:20 but the process was never restarted onto it. So every
  restart test so far has exercised the OLD code. Nothing was actually verified.
- **The restart tool reports success before the client contract is satisfied.**
  `gateway_restart` returned "Gateway restart successful" both times while the
  UI froze. Success should require the `restart_continuity: resumed` event to
  reach an attached client, not just that the process came back.
- **CI step-skipping hides staleness.** The guardrail step failed at step 33,
  which skipped steps 34-58 — including every mobile suite. Two assertions in
  `test-mobile-chat-recovery.mjs` had been stale since the earlier #380 commit
  (they asserted `checkpoint.messageKind = 'restart_status'` and a standalone
  restart bubble, both deliberately removed). Nobody could see it because the
  job never got that far. Consider `continue-on-error` or a separate job so a
  guardrail failure doesn't mask unrelated regressions.
- **`gh` CLI is not installed**, so `gh run view --log-failed` fails. Had to
  fall back to the GitHub REST API to find which step failed. Worth installing.
- **GOAL REMINDER is still appended to every tool result**, including inside
  PowerShell output mid-stream. In this session the reminder quoted an
  `[UPLOADED FILES]` header as "your task", which is actively misleading —
  the real task was the PR work, not the screenshot.
- **`$LASTEXITCODE` is unreliable through a pipeline.** `node script.mjs | Select-Object`
  returned `GUARD=-1` even on success, and `Add-Content` left it empty. Prefer
  checking the run's own exit code rather than the PowerShell variable.
- **`search_files` default-excludes `dist/`,** so searching the built output
  silently returns zero matches with no indication the directory was skipped.
  Had to verify built artifacts via a PowerShell `-match` instead.

### Work completed this session

- Diagnosed PR #380 CI failure: `mobile-chat-page-runtime.js` at 457417 LF
  bytes vs the 453747 code-owned ceiling. The guardrail explicitly forbids
  raising the ceiling as a fix, so extracted instead.
- New `web-ui/src/mobile/mobile-restart-continuity.js` owns the restart
  contract: suspended/resumed handler, reconnect-banner controller with its own
  ws bind/unbind, and the recovery policy helpers.
- **Found and fixed a latent bug while extracting:** the disconnect branch
  referenced `plannedRestart` after it had been inlined away, so the fast 250ms
  restart recovery path would have thrown.
- Fixed 4 stale assertions in `test-mobile-chat-recovery.mjs`.
- Verified: guardrails pass, `tsc --noEmit` clean, `check:web-ui` in sync,
  both gateway regressions pass, all 8 mobile suites pass.
- Pushed `7b8d4ba2a`. **Still unmerged and unverified on real hardware.**
