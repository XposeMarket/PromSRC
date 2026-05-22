# Competitor Feature Scan on X Example

Use this example when Raul asks to go to X and look for the latest features from a named AI/product competitor such as Claude, Anthropic, Hermes, OpenClaw, Cursor, Codex, or similar, especially when he asks what could help Prometheus.

## Evidence

Observed successful run on 2026-05-14: Raul asked, “go to x and then look for the latest features from claude.” Prometheus read `x-browser-automation-playbook`, opened X, used `browser_scroll_collect`, wrote a continuity note, and returned feature signals: Claude Code Agent View, Claude Platform on AWS, financial-services agent templates, Blender connector, and research/behavior updates. The final synthesis tied the findings to Prometheus product implications: agent visibility, enterprise/API distribution, vertical agent templates, and tool connectors. Evidence: `Brain/skill-episodes/2026-05-14/episodes.jsonl:1`; `Brain/skill-gardener/2026-05-14/live-candidates.jsonl:2`; `audit/chats/transcripts/59878553-26ae-4a5b-bf52-feb14caaf13b.md:15-46`.

A related interrupted run on 2026-05-14 hit an X search snapshot error (`ReferenceError: __name is not defined`) after web-search preparation. If X search page snapshots fail, fall back to web search/X URL fetching or home/search text collection instead of ending the workflow. Evidence: `Brain/skill-episodes/2026-05-14/episodes.jsonl:2`; `audit/chats/transcripts/12da984a-c46c-4511-a480-463f007fa476.md:20-24`.

## Default Behavior

- Treat the request as **read-only competitor/product intelligence** unless Raul explicitly asks to post, reply, like, quote, follow, bookmark, or DM.
- Search for **recent feature/update posts**, not generic discourse.
- Prefer current X evidence, but use web search as a fallback for specific X posts or when browser snapshot/search is unstable.
- Convert raw posts into **Prometheus implications**, not a passive news list.
- Separate validation/positioning signals from real product gaps; Raul has repeatedly clarified that competitor signals do not automatically mean Prometheus lacks the core primitive.

## Fast Workflow

1. Read `x-browser-automation-playbook`.
2. If the competitor has a likely official X handle, start with that profile/search; otherwise use web search for `site:x.com <competitor> feature update` and official/product keywords.
3. Use one bounded X collection pass:
   - `browser_open("https://x.com/search?q=<encoded competitor feature query>&f=live")` or the official profile URL.
   - `browser_scroll_collect` instead of repeated manual scrolling.
4. If `browser_open` or snapshot fails with a page-evaluate/snapshot error:
   - use the web-search results already gathered,
   - fetch concrete X status URLs with `web_fetch` when available,
   - or open X home/profile and collect text there.
   - Do not loop on the same failing browser search URL.
5. Extract 3-7 feature signals with date/source/link when available.
6. For each signal, add why it matters for Prometheus:
   - product/UX implication,
   - launch/positioning implication,
   - workflow/skill implication,
   - connector/API implication,
   - or “watch only / no action.”
7. Write a short note only when the scan produced durable product signal, a repeatable workflow, or a blocker worth remembering.

## Output Shape

```markdown
Yep — I checked X for the latest [competitor] feature/update signals.

Most useful things I found:
1. **[Feature]** — [date/source]
   [one-line description]
   Link: [url if available]
   Prometheus read: [why this matters / whether it is validation or a gap]

Big takeaway: [one sharp product/positioning thesis].
```

## Guardrails

- No social actions from competitor scans unless explicitly requested.
- Do not overclaim freshness if the source date is unclear.
- Do not claim “Prometheus needs this” when the finding is only market validation.
- If a scan is interrupted, preserve the checkpoint and resume from gathered sources instead of restarting from scratch.
