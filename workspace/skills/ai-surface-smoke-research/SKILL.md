---
name: "ai-surface-smoke-research"
description: "Run the shared browser, desktop, and optional voice-agent smoke workflow across ChatGPT, Claude, Reddit, X, and other requested AI surfaces. Use for voice-triggered or typed end-to-end tool tests, AI chatter collection, browser scrolling, desktop focus, visible-action proof, and concise tool-grounded summaries."
---

# AI Surface Browser and Desktop Smoke Test

Run a quick end-to-end Prometheus test that proves desktop focus, browser navigation, social/search collection, and summary generation all work in one flow.

---

## When to Use This

Use this when Raul wants a lightweight test workflow, not a deep research project. The point is to exercise the system: focus native apps, use the browser, collect current AI chatter from Reddit and/or X, and summarize what was found.

Good topics include `Claude`, `OpenClaw`, `Hermes`, `Codex`, `AI agents`, or any AI tool names Raul gives.

## Default Workflow

1. **Focus desktop AI apps**
   - Find/focus ChatGPT with `desktop_find_window({ name:"ChatGPT" })` then `desktop_focus_window({ name:"ChatGPT" })`.
   - Find/focus Claude with `desktop_find_window({ name:"Claude" })` then prefer exact returned handle when needed, because Chrome/X titles may include the word Claude.
   - If a name collision happens, use `desktop_find_window` results and `desktop_window_screenshot({ handle })` to verify the real Claude app.

2. **Exercise the browser**
   - Open the user-requested search or AI surface. For a lightweight execution-only test, open X live search and perform one ordinary scroll.
   - For a collection/research test, use `browser_scroll_collect` rather than manual scroll loops.

3. **Search Reddit when research is requested**
   - Use browser automation, not plain web search, when the test goal is browser execution.
   - Default URL:
     `https://www.reddit.com/search/?q=<encoded query>&type=link`
   - Use `browser_scroll_collect` for 3-5 scrolls.
   - Capture post titles, subreddits, rough votes/comments, and repeated themes.

4. **Search X when research is requested**
   - Default URL:
     `https://x.com/search?q=<encoded query>&f=live`
   - Use `browser_scroll_collect` for 3-5 scrolls.
   - Capture authors, handles, timestamps, text, links, and visible metrics when available.
   - Do not like, reply, repost, bookmark, follow, or post.

5. **Fallback web research only when browser/social collection is blocked**
   - If the point of the run is browser execution, do not replace the browser steps preemptively.
   - If Reddit/X cannot be collected because browser or auth is blocked, use `web_search({ fetch_top_k: 2-4 })` for Reddit/web mentions or `web_fetch_batch` for selected URLs.
   - Clearly label this as fallback research, separate from the browser/desktop smoke-test result.

6. **Summarize or prove completion**
   - Report after the actual tool sequence completes.
   - Keep it concise unless Raul asks for depth.
   - For execution-only or voice-triggered tests, keep the reply to one short completion sentence and send fresh screenshot proof to the origin surface when requested.
   - For research tests, include surfaces tested, app focus result, source highlights, and a short read on the AI chatter.

## Default Query

If Raul does not provide a query, use:

```text
Claude OpenClaw Hermes AI
```

## Output Template

```markdown
Done — focused ChatGPT and Claude, searched Reddit + X for `<query>`, and collected live results.

Quick read:
- Reddit: <2-4 bullets about repeated themes>
- X: <2-4 bullets about repeated themes>
- Overall: <one-sentence synthesis>

Tool check: browser collection worked; desktop focus worked/partially worked with <note if any blocker>.
```

## Rules

- This is a test flow, so skip `declare_plan` unless Raul explicitly asks for a plan.
- Do not take external social actions. Read-only only.
- Do not read or alter ChatGPT/Claude chat content unless Raul explicitly asks.
- Prefer exact window handles when desktop window names collide with browser page titles.
- If Reddit is logged out, continue; logged-out search results are still usable.
- If X auth/search fails, report the exact blocker and continue with Reddit or web fallback.
- Use fresh visual evidence for ambiguous desktop focus.

## Non-Triggers

Do not use this for:

- Deep competitive intelligence reports.
- Posting, liking, replying, or outreach.
- ChatGPT coding handoffs.
- Voice-model latency, interruption, or audio-quality benchmarking that does not exercise browser/desktop tools.

## Quality Check

A successful run has evidence that:

- ChatGPT was focused or explicitly found missing.
- Claude was focused or explicitly found missing.
- Reddit and/or X was opened in browser automation.
- At least one collection pass returned real content.
- Final summary is grounded in collected text, not vibes.
