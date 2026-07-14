# Desktop automation benchmark baseline

Measured on 2026-07-10 with `npm run benchmark:desktop -- --live` after building
and activating the Windows.Graphics.Capture helper. These are local read-only
measurements, not a direct timing comparison with Codex Computer Use.

| Operation | Median | Notes |
|---|---:|---|
| Wrapper normalization | 0.001 ms | 25,000 in-process samples |
| List windows | 1,131 ms | Three PowerShell/Win32 samples |
| UIA tree, active window, 100 nodes | 898 ms | Two PowerShell UIA samples |
| Primary screenshot, OCR skipped | 2,686 ms | Two CopyFromScreen + normalization samples |
| Native window capture | 479 ms | Three WGC helper samples; 360 ms minimum |

The benchmark reported `graphics_capture`; direct JSON-RPC ping, native PNG
capture, and the full `desktopWindowScreenshot` integration path also passed.
The WGC helper improves per-window capture correctness and startup overhead, but
does not yet eliminate PowerShell startup for enumeration, UIA, and fallback
input primitives.

## Architecture scorecard

Subjective engineering score based on inspected contracts and implementation,
not vendor claims:

| Area | Prometheus runtime now | Codex Computer Use reference |
|---|---:|---:|
| Model-facing contract | 9.5/10 | 9.5/10 |
| Exact window identity | 9/10 | 9/10 |
| Window capture | 9/10 | 9.5/10 |
| Accessibility/action model | 8.5/10 | 9/10 |
| Interruption plumbing | 8.5/10 | 9.5/10 |
| Runtime latency/transport | 7/10 | 9/10 |
| Isolated background desktop | 9/10 | 4/10 in the inspected public API |
| Overall | 8.6/10 | 9.2/10 |

Prometheus is broader because it includes screen utilities, macros, and an
isolated sandbox worker. Codex remains ahead in the inspected runtime because a
privileged persistent native pipe owns capture, input, UIA, interruption, and
app approvals as one system. Prometheus's next performance step is to move
window enumeration, focus/input, and structured UIA from per-call PowerShell
into the persistent helper after the WGC helper is compiled and stabilized.

## 2026-07-11 compact/state-freshness pass

The follow-up pass keeps the six-wrapper architecture and adds:

- target-window visual/accessibility/geometry generations, so unrelated desktop
  changes no longer invalidate an exact-window state;
- hard wall-clock enforcement and capture timing for `wait_for_change`;
- rejection of ambiguous composite key strings;
- compact, paged app and accessibility output, with running apps as the default;
- confidence filtering and exact mode for installed-app search;
- structured launch metadata including `reused_existing_instance` and an
  explicit statement that clean state is not guaranteed;
- partial structured-UIA results and automatic legacy-tree fallback;
- atomic semantic `find_and_act` capture/lookup/action;
- real OCR runtime probing in doctor output;
- a single background readiness state plus stale bridge-queue cleanup;
- benchmark aggregation for failures, success rate, result bytes/tokens, and
  latency percentiles.

Read-only live measurements after this pass:

| Operation | Median | Result payload |
|---|---:|---:|
| List windows | 791 ms | ~462 estimated tokens |
| UIA tree, active window, 100 nodes | 1,092 ms | ~328 estimated tokens |
| Primary screenshot, OCR skipped | 2,230 ms | ~305 estimated tokens |
| Native window capture | 263 ms | ~7 estimated tokens |

All desktop contract tests passed. The updated engineering estimate is
**Prometheus 9.0/10 vs. the inspected Codex reference 9.2/10**. The remaining
material gap is per-call PowerShell startup for enumeration, UIA, clipboard,
and input; moving those primitives into the persistent native helper is the
next latency pass. Safety-policy enforcement was intentionally not changed in
this pass, per project scope.

## Stabilization fixes after the second external benchmark

- Window `find` and app `close_app` normalize `name`, `title`, `app`, and
  `query` consistently.
- Atomic `find_and_act` carries an explicit routing marker through the
  compatibility schema and does not require a preexisting `state_id`.
- Compact accessibility nodes contain only element id, role, non-empty
  name/automation id, and supported patterns. Full diagnostics remain
  available with `compact=false` and inside the action snapshot.
- UIA rectangle conversion handles invalid or out-of-range values per field,
  retains the remaining node, and deduplicates diagnostics.
- Invalid composite keys are rejected before platform initialization.

A live compact accessibility probe returned 16 nodes in 2,861 bytes, with no
diagnostic fields or conversion errors, in 1.69 seconds.

## OCR runtime repair

The OCR worker launched through `node -e` was reading `process.argv[2]`, but the
first supplied argument is `process.argv[1]`; recognition therefore received an
undefined image path and returned an empty object. The argument contract is now
correct and worker failures expose module, worker/recognition, top-level, or
spawn/timeout stages. A live doctor probe passed with 1,687 recognized
characters at 72% confidence.
