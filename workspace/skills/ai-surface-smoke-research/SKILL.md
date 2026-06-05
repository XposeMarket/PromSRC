---
name: AI Surface Smoke Research
description: >
  Runs Raul's repeatable browser/desktop test workflow across native AI apps and live social surfaces. Use this when Raul asks to run an AI smoke research test, focus Codex and Claude, open Chrome/browser, search Reddit and/or X for AI topics like Claude/OpenClaw/Hermes, then summarize the current signals. Triggers on phrases like: run AI smoke research, test browser desktop research, focus Codex and Claude then search X, search Reddit and X for AI, Claude OpenClaw Hermes search, summarize AI chatter.
version: 1.0.0
triggers: run ai smoke research, ai surface test, codex claude reddit x test, search reddit and x for ai, focus codex and claude then search x, test browser desktop research, quick ai research workflow, claude openclaw hermes search, summarize ai chatter, browser desktop ai test
---

# AI Surface Smoke Research

Run a quick end-to-end Prometheus test that proves desktop focus, browser navigation, social/search collection, and summary generation all work in one flow.

---

## When to Use This

Use this when Raul wants a lightweight test workflow, not a deep research project. The point is to exercise the system: focus native apps, use the browser, collect current AI chatter from Reddit and/or X, and summarize what was found.

Good topics include `Claude`, `OpenClaw`, `Hermes`, `Codex`, `AI agents`, or any AI tool names Raul gives.

## Default Workflow

1. **Load supporting skills first**
   - `desktop-automation-playbook`
   - `browser-automation-playbook`
   - `x-browser-automation-playbook` when X is included

2. **Focus desktop AI apps**
   - Find/focus Codex with `desktop_find_window({ name:"Codex" })` then `desktop_focus_window({ name:"Codex" })`.
   - Find/focus Claude with `desktop_find_window({ name:"Claude" })` then prefer exact returned handle when needed, because Chrome/X titles may include the word Claude.
   - If a name collision happens, use `desktop_find_window` results and `desktop_window_screenshot({ handle })` to verify the real Claude app.

3. **Search Reddit**
   - Use browser automation, not plain web search, when the test goal is browser execution.
   - Default URL:
     `https://www.reddit.com/search/?q=<encoded query>&type=link`
   - Use `browser_scroll_collect` for 3-5 scrolls.
   - Capture post titles, subreddits, rough votes/comments, and repeated themes.

4. **Search X**
   - Default URL:
     `https://x.com/search?q=<encoded query>&f=live`
   - Use `browser_scroll_collect` for 3-5 scrolls.
   - Capture authors, handles, timestamps, text, links, and visible metrics when available.
   - Do not like, reply, repost, bookmark, follow, or post.

5. **Fallback web research only when browser/social collection is blocked**
   - If the point of the run is browser execution, do not replace the browser steps preemptively.
   - If Reddit/X cannot be collected because browser or auth is blocked, use `web_search({ fetch_top_k: 2-4 })` for Reddit/web mentions or `web_fetch_batch` for selected URLs.
   - Clearly label this as fallback research, separate from the browser/desktop smoke-test result.

6. **Summarize**
   - Report after the actual tool sequence completes.
   - Keep it concise unless Raul asks for depth.
   - Include: surfaces tested, app focus result, source highlights, and a short read on the AI chatter.

## Default Query

If Raul does not provide a query, use:

```text
Claude OpenClaw Hermes AI
```

## Output Template

```markdown
Done — focused Codex and Claude, searched Reddit + X for `<query>`, and collected live results.

Quick read:
- Reddit: <2-4 bullets about repeated themes>
- X: <2-4 bullets about repeated themes>
- Overall: <one-sentence synthesis>

Tool check: browser collection worked; desktop focus worked/partially worked with <note if any blocker>.
```

## Rules

- This is a test flow, so skip `declare_plan` unless Raul explicitly asks for a plan.
- Do not take external social actions. Read-only only.
- Do not read or alter Codex/Claude chat content unless Raul explicitly asks.
- Prefer exact window handles when desktop window names collide with browser page titles.
- If Reddit is logged out, continue; logged-out search results are still usable.
- If X auth/search fails, report the exact blocker and continue with Reddit or web fallback.
- Use fresh visual evidence for ambiguous desktop focus.

## Non-Triggers

Do not use this for:

- Deep competitive intelligence reports.
- Posting, liking, replying, or outreach.
- Codex dev handoffs.
- Voice-specific latency/interruption testing; Raul said that will get its own skill later.

## Quality Check

A successful run has evidence that:

- Codex was focused or explicitly found missing.
- Claude was focused or explicitly found missing.
- Reddit and/or X was opened in browser automation.
- At least one collection pass returned real content.
- Final summary is grounded in collected text, not vibes.
