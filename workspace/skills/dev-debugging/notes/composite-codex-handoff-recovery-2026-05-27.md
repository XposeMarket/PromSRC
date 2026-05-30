# Composite Codex handoff recovery — 2026-05-27

Evidence:
- `audit/chats/transcripts/mobile_mpoxdcrd_etqf0a.md:40-67` — adding a wait after `Ctrl+N` made the `codex_dev_debug_handoff` composite succeed.
- `audit/chats/transcripts/mobile_mpoxdcrd_etqf0a.md:109-153` — rerun failed cleanly when no Codex window was visible; `desktop_find_window("Codex")` was identified as a useful diagnostic first step, but not a true launch fallback.
- `audit/chats/transcripts/mobile_mpoxdcrd_etqf0a.md:156-249` — Raul and Prom framed composites as Prometheus-native “memory that executes,” saving repeated agent/tool-call/token overhead rather than only user clicks.

Operational guardrails for future Codex handoff composites:
1. Keep `desktop_wait(1000)` immediately after `Ctrl+N` before typing/pasting the prompt.
2. Add a diagnostic window check before focusing when the composite engine supports non-fatal/optional steps: `desktop_find_window("Codex")` should improve failure messages, but must not be treated as a complete recovery path.
3. If no Codex window exists, the robust flow needs a fallback branch: launch/open Codex, wait for the new-chat UI, then focus and continue. A literal sequential composite cannot safely express this without native `required:false`, `continueOnError`, `fallback`, `retry`, or `assert` semantics.
4. Keep prompts quote-safe when possible; one test surfaced a `desktop_type`/PowerShell quoting failure on apostrophes/curly apostrophes.
5. Final follow-up checks should not create infinite timers: first blank/working check may schedule one final follow-up; second/final blank check should send status/proof and stop.

Reusable product direction:
Composite tools should become typed, inspectable runbooks with telemetry, not just saved tool arrays. High-leverage runtime features include `required`, `continueOnError`, `retry`, `timeoutMs`, `saveAs`, `when`, `fallback`, `assert`, output binding like `{{steps.capture.result.screenshot_id}}`, strict OpenAI-tool-safe names, recursion protection, centralized management handling, and structured composite results where inner failures propagate as `error: true`.
