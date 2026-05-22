---
name: Voice Browser Desktop Smoke Test
description: Repeat Raul's quick voice-driven Prometheus smoke test: open X search for an AI-related topic, scroll it, focus Codex, then focus Claude, and only report after the tool-backed sequence completes.
version: 1.0.0
---

---
name: Voice Browser Desktop Smoke Test
description: >
  Runs Raul's quick end-to-end voice/control smoke test across browser and desktop surfaces. Use this when Raul says phrases like "do the test again," "voice test again," "open X search then focus Codex and Claude," "test browser and desktop focus," or asks Prometheus to verify that voice-triggered tool execution can open X, scroll, switch to Codex, and switch to Claude. This is for execution testing, not for researching AI news deeply or posting on X.
version: 1.0.0
triggers: do the test again, voice test again, open X search and focus Codex, open X search then focus Claude, test browser and desktop focus, X search AI scroll Codex Claude, Prometheus voice tool test, browser desktop smoke test, test X Codex Claude, repeat the X search test
---

# Voice Browser Desktop Smoke Test

Use this when Raul wants the quick voice-driven tool execution test that crosses **browser automation** and **desktop focus**.

## Goal

Prove that Prometheus can hear Raul's voice command, execute real tools, and move through the expected surfaces without narrating fake progress:

1. Open X search for an AI-related query.
2. Scroll down a little.
3. Focus the Codex desktop app/window.
4. Focus the Claude desktop app/window.
5. Report briefly after the sequence is actually done.

## Default Workflow

1. Read relevant skills first if not already loaded:
   - `x-browser-automation-playbook`
   - `desktop-automation-playbook`
2. Open X search:
   - Use `browser_open("https://x.com/search?q=AI&f=live", observe:"screenshot")`.
   - If Raul gave a specific topic, URL-encode that query instead of `AI`.
3. Scroll X once:
   - Use `browser_scroll({ direction:"down", multiplier:1, observe:"screenshot" })`.
   - Do not collect/analyze tweets unless Raul asks.
4. Focus Codex:
   - Use `desktop_find_window({ name:"Codex" })` if needed.
   - Use `desktop_focus_window({ name:"Codex" })`.
   - Trust the auto/fresh screenshot or capture one if focus is ambiguous.
5. Focus Claude:
   - Use `desktop_find_window({ name:"Claude" })` if needed.
   - Use `desktop_focus_window({ name:"Claude" })`.
   - Verify visually when possible.
6. Final reply should be short and concrete, e.g.:
   - `Done — opened X AI search, scrolled it, focused Codex, then focused Claude.`

## Rules

- This is a **test flow**, so skip `declare_plan` unless Raul explicitly asks for a plan.
- Do not say generic filler like "checking available skills" or "working in the browser."
- Do not post, like, reply, or interact socially on X.
- Do not read or alter Codex/Claude chat contents unless Raul explicitly asks.
- If Codex or Claude is not open, report the exact missing window and continue with any remaining available step.
- Prefer action first, then one brief completion message.

## Non-Triggers

Do not use this skill for:

- General X research or tweet collection.
- Posting/replying/liking on X.
- Codex dev handoff prompts.
- Claude message drafting.
- Browser-only website automation unrelated to Raul's smoke test.

## Quality Check

A successful run has visible/tool evidence that:

- X search opened to an AI-related query.
- The X page moved after a scroll.
- Codex was focused at least once.
- Claude was focused last.
- The final user-facing message happens only after the actual tool sequence completes.