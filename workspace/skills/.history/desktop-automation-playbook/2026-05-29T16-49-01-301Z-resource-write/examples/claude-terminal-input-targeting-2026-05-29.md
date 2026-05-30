# Claude Terminal Input Targeting Correction — 2026-05-29

Observed workflow: Raul asked Prometheus to click into a Claude terminal on the top-left of the desktop and press Enter. The first run appeared to complete, the repeated run clicked the next Claude terminal tab instead of the active terminal input area, and Raul corrected the mistake.

Low-risk guardrail:

- When a user asks to focus a Claude terminal and press Enter, do not target the tab strip just because the Claude window is visible.
- Re-ground with a fresh screenshot and identify the actual terminal prompt/input line, usually around the `>` prompt near the lower-left of the active terminal pane.
- Use a plain left click for the input area unless the user explicitly asks for Ctrl/Shift/Alt-click. Modifier-clicks in terminal/tabbed apps can switch tabs or select the wrong surface.
- After pressing Enter, verify with a screenshot if the user asked for proof or if the action may affect an active coding-agent run.

Evidence:

- `audit/chats/transcripts/mobile_mpqerzz3_7e0f41.md:13-20`
- `Brain/skill-gardener/2026-05-29/workflow-episodes.jsonl:3`
