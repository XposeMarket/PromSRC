# Current-chat Creative export debugging handoff guardrail — 2026-05-20

Observed during a PulseFit Creative Video export/stitch debugging handoff where Raul explicitly asked Prometheus to use the existing Codex chat, show Codex the latest exported video path, explain the bad/static export, and investigate why Creative tools failed instead of relying on an FFmpeg workaround.

## Guidance

- If Raul explicitly says "same chat", "current chat", or "do not Ctrl+N", obey that instruction and use the existing Codex chat. The default Ctrl+N path does not apply.
- For Creative/video export bugs, include both the failing product artifact path and any known-good comparison artifact path in the Codex prompt. State the observed visual symptom, not just "it failed" (for example: static/still-frame export, truncated duration, missing audio, or clips not stitched).
- Before handoff, prefer Prometheus-native media/Creative diagnostics when available (for example `video_analyze_imported_video`, frame/hash analysis, Creative export trace, or file stats) instead of ad-hoc shell probes. If a shell media probe is blocked or outside scope, recover with native media tools and continue the handoff.
- After the prompt is submitted, send proof with the desktop screenshot delivery path the playbook expects: capture/maximize the Codex window and call `desktop_send_to_telegram`. Do not try to send transient screenshot IDs through generic delivery tools unless that tool explicitly supports the screenshot handle.
- If typing a long debugging prompt fails because of PowerShell/SendKeys quoting, recover once with `desktop_type_raw` and continue; do not restart the handoff unless the prompt visibly failed to submit.

## Evidence

- `audit/chats/transcripts/telegram_1799053599_1779292190154.md:4-17` — Raul requested current-chat Codex handoff for PulseFit Creative export/stitch errors; Prometheus completed the handoff with bad/static and working concat paths.
- `Brain/skill-gardener/2026-05-20/workflow-episodes.jsonl:4` — run captured tool errors: blocked `ffprobe`, failed `desktop_focus_window({name:"Codex"})`, and failed `delivery_send_screenshot` with an attachment id; workflow still completed via recovery.
- `audit/chats/transcripts/telegram_1799053599_1779292190154.md:45-67` — follow-up confirmed Codex found/fixed the Creative renderer seek/wait issue and build checks passed.
