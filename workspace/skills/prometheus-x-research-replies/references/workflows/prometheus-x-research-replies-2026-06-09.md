# Workflow Recipe: X Research & Replies — 2026-06-09 Browser-First Successful Run

**Date:** 2026-06-09
**Session:** subagent_chat_schedule_prometheus-x-research-replies_gf6xn (later runs)
**Outcome:** Full success — research + 2 replies + 1 original post via browser; no API blockers hit

## What Worked

### Browser-First Research (No API Needed)
```
browser_open("https://x.com/home")
browser_snapshot / browser_scroll / browser_get_page_text
```
- Captures trending topics directly from the timeline (Fable 5, on-device inference, agent persistence)
- Zero dependency on xAI Grok credits or X API token
- Works reliably when @raulinvests is already logged in on the desktop browser

### Posting via Browser Shortcuts
```
browser_press_key("n")          # open new post composer
browser_type("<tweet text>")
browser_press_key("Control+Enter")  # submit post

# For replies:
browser_press_key("r")          # reply shortcut on a thread
browser_type("<reply text>")
browser_press_key("Control+Enter")
```
- No numeric @ref required; keyboard shortcuts are stable
- Vision screenshot confirms composition before submission
- browser_close() immediately after all posting

### Hook Library Integration
- After 2026-06-09, the scheduled job prompt includes: read hook-library skill and apply hook patterns to reply openers and original post leads
- Triggers on the content prep step — improves scroll-stopping potential of first lines

## Tool Sequence (Successful)
```
skill_read → read_file (memory check) → browser_open(x.com/home) → browser_snapshot
→ browser_scroll → browser_get_page_text → [compose content]
→ browser_press_key("n") → browser_type → browser_press_key("Control+Enter")
→ browser_press_key("r") × 2 → browser_close → write_note
```

## When This Fails
- x.com/home lands on login page: @raulinvests session not active on desktop browser — manual login required first, or use separate cron that logs in
- Keyboard shortcuts don't fire: focus not on correct element — use browser_snapshot to verify composer is open, then re-focus

## Em-Dash Rule (Added 2026-06-09)
NEVER use em dashes (—) in any tweet or reply. Use periods, commas, colons, or hyphens instead.
This is a hard rule enforced in the skill SKILL.md and scheduled job prompt.

## Notes
- changeType: add_workflow_recipe
- evidence: Brain/skill-episodes/2026-06-09/episodes.jsonl (lines 8-15), Brain/skill-gardener/2026-06-09/workflow-episodes.jsonl
- appliedBy: brain_dream
- reason: Capture first browser-first fully successful research+replies run pattern for reuse
