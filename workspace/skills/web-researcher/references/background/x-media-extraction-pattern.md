# X/Twitter Media Extraction Pattern — 2026-06-07

## Issue
When fetching an X/Twitter status URL with `web_fetch`, media detection and download may not always capture or return all video/media assets, especially for longer or complex thread videos.

**Observed behavior:**
- `web_fetch(x.com/.../status/...)` can return `x_media_summary: "Detected media in N tweet(s); downloaded M file(s)"`
- However, `downloaded_files` may be empty or incomplete even though the tweet visually contains video
- The fetched page structure may not expose direct video download URLs to `web_fetch`'s internal downloader

## Solution: Escalate to `download_media`

For X/Twitter status URLs that show media but `web_fetch` does not fully capture video:

1. **Try `web_fetch` first** (standard X fetch pattern)
2. **If media was detected but video is not in `downloaded_files`**, OR **if you need explicit video extraction**:
   - Use `download_media(x_url, audio_only: false)` with the same X status URL
   - `download_media` uses yt-dlp, which has robust Twitter/X video extraction

**Pattern:**
```javascript
// Step 1: Fetch the thread/metadata
web_fetch({ "url": "https://x.com/handle/status/ID" })

// If x_media.downloaded_files is empty or missing the video:
// Step 2: Extract video directly
download_media({ "url": "https://x.com/handle/status/ID" })
```

## Example

**Yarchi thread on Obsidian Jarvis system (2026-06-07):**
- URL: `https://x.com/undefinedki/status/2063305573097951631`
- `web_fetch` result: captured tweet text and images, but `downloaded_files` was sparse
- `download_media` result: successfully extracted the full 152-second MP4 (30.5 MB) showing the Obsidian workflow UI and JARVIS pipeline

## When to use `download_media` for X

Use `download_media` when:
- The user explicitly asks for the video itself ("fetch this video", "download the video", "get the MP4")
- `web_fetch` detected media but `downloaded_files` is empty/incomplete
- You need the actual video file, not just metadata/text/images
- The video is complex or longer (>30 seconds) and may not render well in X embeds

Use `web_fetch` when:
- The user is reading/researching the thread (text + preview images are enough)
- You need metadata about the media without the actual video file
- The thread has no video or only static images

## Tool equivalence
- `download_media(url)` is the **most reliable** path for X video extraction
- It uses yt-dlp, which is maintained and supports X/Twitter natively
- Result is a workspace-local MP4/MKV file that can be analyzed with `analyze_video`

## Changelog
- 2026-06-07: Created after testing Yarchi Obsidian thread video extraction; documented the pattern and when to escalate from `web_fetch` to `download_media` for X/Twitter media.
