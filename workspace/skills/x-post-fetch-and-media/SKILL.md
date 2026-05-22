---
name: X Post Fetch
description: Use this skill when the user gives an X/Twitter status URL and wants the post or thread fetched. For X URLs, `web_fetch` is the default and complete path — use it directly and answer from the returned X-aware payload. Triggers on requests like: webfetch this X URL, fetch this tweet, read this X post, pull this thread, get this tweet, or inspect this X status link. Best for X URL retrieval, thread parsing, and direct reporting from the `web_fetch` result without extra retrieval steps.
emoji: "🧩"
version: 2.0.0
triggers: webfetch this x url, web fetch this x url, fetch this x post, fetch this tweet, read this tweet, read this x post, pull this x thread, get this tweet, get this x post, inspect this x link, x status url, x url fetch, tweet fetch
---

# X Post Fetch

Use this skill when the job starts with an **X status URL** and the user wants the content fetched.

The rule is simple:

> For X URLs, use **`web_fetch`** first and treat its returned X-aware payload as the primary result.

If `web_fetch` returns the post/thread cleanly, that is the job. Do not add extra retrieval steps unless the user explicitly asks for something beyond the fetched content.

---

## What This Skill Is For

Use this skill when the user wants to:
- fetch an X post from its URL
- read a tweet without opening the browser
- pull a thread from an X status link
- inspect what an X URL contains
- get the text, author, timestamp, metrics, and any media summary already present in the `web_fetch` response

Do **not** use this skill for:
- posting on X
- replying, liking, reposting, or quote-tweeting
- feed interaction or search workflows on X.com

Those belong to **`x-browser-automation-playbook`**.

---

## Core Rule

For an X/Twitter status URL, do this:

```json
web_fetch({ "url": "https://x.com/<handle>/status/<id>" })
```

Then answer directly from what comes back.

No browser first.
No extra media/download flow by default.
No unnecessary handoff.

If the user says **"webfetch this"** for an X URL, this skill should be enough on its own.

---

## Standard Workflow

### Flow A — Normal case

1. Run `web_fetch` on the X URL
2. Inspect the returned payload
3. If it includes `tweets`, treat that as the canonical extracted result
4. Report the useful fields clearly
5. Stop unless the user asked for more

### What to report

Usually report:
- author
- handle
- timestamp
- post text
- whether it looks like a single post or thread
- count of returned tweets if present
- metrics if present
- whether media is present if the payload already indicates it

### Default posture

If `web_fetch` already returned the content, do **not** escalate to:
- browser tools
- `download_media`
- `download_url`
- analysis tools

unless the user explicitly asks for those next.

---

## Interpreting `web_fetch` Results

A typical X-aware payload may include fields like:
- `success`
- `url`
- `tweets`
- `count`
- `message`

And per tweet:
- `id`
- `link`
- `author`
- `handle`
- `timestamp`
- `text`
- `metrics`
- media hints such as `hasImage` or similar fields

### What matters most

| Field | Meaning |
|------|---------|
| `tweets` | Canonical extracted post/thread items |
| `count` | Fast single-post vs thread signal |
| `text` | Main user-facing content |
| `author` / `handle` | Attribution |
| `timestamp` | When it was posted |
| `metrics` | Engagement snapshot when available |
| media hints | Mention only if already present in payload |

---

## Response Pattern

### If it is one post
Return the core content cleanly.

Example:
- Author + handle
- timestamp
- full post text
- metrics if present
- note if media is attached according to the payload

### If it is a thread
Return:
- thread count
- anchor author/handle
- ordered post texts
- any useful metadata

Condense when possible, but do not lose the actual text if the user asked to fetch/read it.

---

## When To Escalate Beyond `web_fetch`

Only escalate if the user explicitly asks for something else, such as:
- download the video
- pull the images
- analyze the clip
- transcribe the video
- open X and interact with it

At that point:
- media/file requests can hand off to the relevant download or analysis tools
- interaction requests belong to `x-browser-automation-playbook`

But that is **not** the default behavior of this skill anymore.

---

## Anti-Patterns

Do **not**:
- open the browser first for a simple X URL fetch
- assume extra download/analysis work is needed when the user only said to fetch/read the URL
- turn a one-step `web_fetch` job into a multi-tool flow by default
- claim anything not present in the returned payload

---

## Good Outputs

Good:
- "`web_fetch` returned a single post from Nebula (@NebulaAI)."
- "`web_fetch` returned 8 posts from the thread."
- "Here’s the post text, timestamp, and captured metrics."
- "The payload indicates attached media."

Bad:
- "I need to open the browser for this."
- "I should probably download the media too" when the user did not ask for that
- "The tweet likely says..."

---

## Minimal Reference

### Fetch an X post
```json
{ "url": "https://x.com/<handle>/status/<id>" }
```

---

## Scope Test Examples

### Clear match
- "webfetch this https://x.com/.../status/..."
- "fetch this tweet"
- "read this X post"
- "pull this thread"

### False positive
- "post this on X"
- "reply to this tweet"
- "like these posts"

Those belong to `x-browser-automation-playbook`.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-22 | v2.0.0: Simplified the skill so X status URLs default to a straight `web_fetch` flow with no extra download/analysis steps unless explicitly requested. Repositioned the skill as a pure fetch/read playbook. |
| 2026-04-22 | v1.1.0: Expanded the skill so X video/media requests now explicitly hand off into the new `video-analysis-and-transcription` workflow for watch/transcribe/summarize tasks. Added stronger trigger phrases for X clip analysis/transcription requests. |
| 2026-04-21 | v1.0.0: Initial skill covering X-aware `web_fetch`, thread/text retrieval, media extraction decision rules, and download/analyze handoff patterns. |
