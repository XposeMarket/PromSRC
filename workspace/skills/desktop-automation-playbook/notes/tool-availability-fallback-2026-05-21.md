# Tool availability fallback for desktop text/UIA helpers (2026-05-21)

Observed during a mobile Codex status-check workflow: the playbook recommended `desktop_get_window_text` and `desktop_get_accessibility_tree`, but the active tool surface returned `Unknown tool` for both. The workflow still succeeded by grounding in `desktop_find_window` + `desktop_window_screenshot` and reporting only visible evidence.

Guardrail for future desktop runs:

1. Treat UI Automation/text helpers as preferred when available, not guaranteed.
2. If `desktop_get_window_text` or `desktop_get_accessibility_tree` returns `Unknown tool`, do not loop or fail the task just because the helper is missing.
3. Fall back immediately to fresh `desktop_window_screenshot` or `desktop_screenshot`, visually read the current UI, and state that the answer is based on visible screenshot evidence.
4. If the screenshot is ambiguous, use another available grounding path such as `desktop_find_window`, `desktop_get_process_list` if available, browser/CLI logs when appropriate, or ask only if no safe evidence path remains.
5. When final screenshot and tool-reported focus disagree, trust the fresh screenshot and report the inconsistency rather than claiming focus succeeded.

Evidence: `Brain/skill-episodes/2026-05-21/episodes.jsonl:9-10`, `Brain/skill-gardener/2026-05-21/workflow-episodes.jsonl:7`, and `audit/chats/transcripts/mobile_mpfp04v9_iyewyz.md:1-18`.