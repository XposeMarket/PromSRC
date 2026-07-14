# On-Demand X Vibe Check Example

Use this example when the user asks loosely for something like “go on X/Twitter and tell me what's happening” without asking to post, reply, like, or take social actions.

## Evidence

Observed successful run on 2026-05-13: the user asked, “go on X… I don't know, tell me what's happening.” Prometheus used `skill_list` → `skill_read(x-browser-automation-playbook)` → `browser_open("https://x.com/home")` → `browser_scroll_collect`, then returned a strategic read of the feed: computer-use agents, Hermes, Codex/Claude discourse, security noise, creative AI/video, Krea, local LLM chatter, Xpose-style outreach, and crypto noise. Evidence: `Brain/skill-episodes/2026-05-13/episodes.jsonl:1`; `audit/chats/transcripts/40d72556-e532-4c72-9226-6a8daee832d8.md:16-41`.

## Default Behavior

- Treat the request as **read-only X collection** unless the user explicitly asks to post/reply/like/quote/follow/bookmark/DM.
- Do not ask unnecessary clarifying questions if the intent is clearly “tell me what’s happening.” A short initial clarification is acceptable only when the request is incomplete before the user finishes dictating.
- Prefer the home feed first, then optional bounded searches only if the user asks for a deeper scan or the feed is too sparse.
- Use `browser_scroll_collect` for bulk reading instead of repeated manual scroll/snapshot loops.
- Do not use screenshots/vision unless text/DOM evidence is insufficient and the task is not a scheduled text-first collector.

## Fast Workflow

1. Read this X skill first.
2. `browser_open("https://x.com/home")`.
3. Use `browser_scroll_collect` with a bounded pass on the home timeline.
4. Synthesize into categories the user actually cares about:
   - Prometheus/product signals
   - competitor/agent ecosystem signals
   - Creative/HyperFrames/video signals
   - Xpose/local-business/money signals
   - trading/mental-game signals
   - noise/downranked topics
5. Give a concise “my read” that connects the feed to Prometheus/Xpose/trading priorities.
6. Only save a file or note if the user asked, the signal is important, or the run should feed Daily X Signal Radar.

## Output Shape

```markdown
Yeah — I checked your X home feed. The vibe right now is [one-line thesis].

Big stuff I saw:
- **[Category]** — [concrete observation + why it matters]
- **[Category]** — [concrete observation + why it matters]

My read: [strategic interpretation tied to Prometheus/Xpose/trading].
```

## Guardrails

- Never take social actions from a loose “what’s happening” request.
- Do not over-index on crypto/gambling/engagement bait unless the user asks.
- Separate useful market signal from noise.
- If X auth fails or the feed is unavailable, report the exact blocker and suggest the closest viable read-only fallback.
