# Live X navigation + composite maintenance — 2026-06-01

## Context
the user asked Prometheus to freely navigate X.com, interact with posts, verify major surfaces, then update X-related skills/resources and create composites.

## Confirmed live surfaces
- `https://x.com/home` loads the authenticated home feed and inline composer.
- Inline composer exposes stable selectors:
  - `[data-testid='tweetTextarea_0']` for the contenteditable post textbox
  - `[data-testid='tweetButtonInline']` for submit
  - `[data-testid='fileInput']` for media upload
- `https://x.com/explore` loads Explore with tabs: For You, Trending, News, Sports, Entertainment.
- Search flow works by filling the Explore/Search combobox and pressing Enter; direct URLs like `https://x.com/search?q=AI%20tools&src=typed_query&f=live` work too.
- `browser_scroll_collect` on X search reliably extracts structured tweet items: tweet id, author, handle, timestamp, text, link, media hints, and metrics.
- `https://x.com/notifications` loads notifications and shows reply/like/follow events with tweet action buttons.
- `https://x.com/i/bookmarks` works for authenticated bookmark review; the page can display an empty-state hero and still show bookmarked posts below it.
- `https://x.com/raulinvests` loads the logged-in profile with Posts/Replies/Highlights/Articles/Media/Likes tabs.
- `https://x.com/i/grok` loads Grok inside X with an Ask anything input and Create Images/Edit Image/Latest News buttons.
- `https://x.com/i/premium` loads Premium quick access/benefit links.
- Direct Messages route redirects to `https://x.com/i/chat` and can be blocked by an Enter Passcode screen for encrypted message recovery. Treat this as a real blocker unless the user provides the passcode.
- Attempted direct URL `https://x.com/i/creator-studio` returned Page not found. Prefer the visible nav link or Premium quick-access link rather than guessing creator-studio route paths.

## Confirmed interactions
- Like buttons by DOM ref work.
- X keyboard shortcuts are surfaced by the browser tool and include useful action shortcuts:
  - `j` / `k` focus next/previous post
  - `l` like focused post
  - `b` bookmark focused post
  - `r` reply to focused post
  - `t` repost focused post
  - `n` new post modal
  - `Control+Enter` submit composer
  - `g h`, `g e`, `g n`, `g b`, `g p`, `g g`, etc. navigation sequences
- For keyboard actions, confirm the focused post with `browser_get_focused_item()` before liking/bookmarking/replying/reposting unless the user explicitly asked for broad free-form interaction.

## Composite tools created/updated from this run
- `x_post_text(post_text)` — opens home, focuses inline composer via `[data-testid='tweetTextarea_0']`, types text, clicks `[data-testid='tweetButtonInline']`. Publishes immediately.
- `x_search_collect(query, scrolls)` — opens X search and runs `browser_scroll_collect` with structured extraction enabled.
- `x_open_bookmarks()` — opens `/i/bookmarks`.
- `x_open_notifications()` — opens `/notifications`.
- `x_open_profile()` — opens `/raulinvests`.
- `x_open_grok()` — opens `/i/grok`.
- `x_like_focused_post()` — presses `l`, then tries `browser_get_focused_item()`.
- `x_bookmark_focused_post()` — presses `b`, then tries `browser_get_focused_item()`.

## Guardrails learned
- Do not guess internal X routes beyond known working URLs; use visible nav links or known shortcuts.
- Direct Messages may require a passcode and should not be treated as accessible just because the nav link loads.
- If creating follow/repost/reply composites later, bind them to focused-post flows and include a confirmation/read step before the action; reply/post final submits should still use the high-impact approval flow unless the user explicitly authorizes a live posting/replying session.
