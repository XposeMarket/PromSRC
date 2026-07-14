---
name: "x-post-fetch-and-media"
description: "Use when the user supplies an X/Twitter status URL and wants its post or thread fetched, read, inspected, or summarized without interaction. Do not use for posting, liking, replying, feed browsing, or generic web research."
---

# X Post Fetch

Fetch an exact X status URL with `web_fetch` and report only content actually extracted. For several exact status URLs, use `web_fetch_batch` and evaluate every result independently.

## Workflow

1. Confirm the URL is an `x.com` or `twitter.com` status URL.
2. Call `web_fetch` on that exact URL. Leave `include_media` and `include_thread` false for a simple exact-post read; this uses X's official oEmbed endpoint without opening a browser.
3. Require at least one extracted tweet/post. A success flag with `tweets: []`, a zero count, placeholder text, or an extraction message is failure—not a captured post.
4. Report author/handle, timestamp, text, thread order/count, metrics, and media hints only when present.
5. Clearly label deleted, unavailable, login-gated, rate-limited, or extraction-blocked results. Do not guess the post text.
6. Stop when the fetch satisfies the request.

For an explicitly requested thread, set `include_thread: true` and require more than the target status only when the URL actually belongs to a thread. Browser extraction can be login-gated or rate-limited, so report an incomplete thread instead of treating the exact post as the whole thread.

## Media

Do not turn a read request into a download workflow. If the user explicitly asks to download, transcribe, or analyze attached media, capture the post first and then call `web_fetch` with `include_media: true` or hand the confirmed media to the appropriate media workflow.

Before claiming a media operation succeeded, verify the output file exists, has non-zero bytes, and has the expected media type. A URL, attempted download, or tool success flag alone is not proof.

## Browser escalation

Use the X browser automation skill only when the user asks for interaction or when they explicitly want a browser fallback. Browser visibility is not proof of programmatic extraction; report any login wall or inaccessible content honestly.

## Failure contract

Return a failure/caveat when:

- no posts were extracted;
- the status is deleted or unavailable;
- X requires authentication the current path does not have;
- extraction times out or is blocked;
- requested media cannot be validated.

The fail-closed payload validation is covered by `scripts/test-phase3-fail-closed.mjs`. The live smoke test in `scripts/test-x-live-smoke.mjs` has also captured a known public NASA status through Prometheus's real `web_fetch` path, including its target ID, author, handle, timestamp, text, and non-zero count without starting a media workflow. A later login wall, deletion, rate limit, or empty result is still a request-level failure; never reuse the fixture text as a fallback.
