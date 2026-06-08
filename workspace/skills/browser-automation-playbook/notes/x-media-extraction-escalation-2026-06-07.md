# X Media Extraction Escalation — 2026-06-07

## Context
When working with X/Twitter status URLs, the standard fetch workflow is `web_fetch` (non-browser). However, browser-adjacent tools like `download_media` (using yt-dlp) can be more reliable for video extraction when `web_fetch` doesn't fully capture media.

## The Pattern

### 1. Standard X URL fetch
Use `web_fetch(url)` first for X status URLs. It returns:
- Thread/tweet text
- Image files (downloaded to `downloads/x_fetch_media/images/`)
- Media summary (`x_media_summary`)
- List of downloaded files

### 2. Media escalation
If `web_fetch` detected video but `downloaded_files` is empty or incomplete:
- Use `download_media(x_url)` with the same X status URL
- `download_media` uses yt-dlp, which has native X/Twitter video extraction
- Result is a workspace-local MP4 file ready for analysis

### 3. Why escalate?
`web_fetch` is optimized for text/metadata extraction. Video download from X/Twitter can be:
- Delayed/fallback in the `web_fetch` implementation
- Incomplete for certain video types or tweet structures
- `download_media` + yt-dlp is more robust and maintained specifically for video platforms

## Example workflow

```
User: "Fetch this X thread: https://x.com/undefinedki/status/2063305573097951631"

Step 1: web_fetch(url)
  → Returns: tweets, images, x_media_summary: "Detected media..."
  → Check x_media.downloaded_files

Step 2 (if video missing):
  download_media(url)
  → Returns: MP4 file, 152.5 seconds, 30.5 MB
  → Ready for analyze_video(path)
```

## When NOT to escalate
- User only needs thread text or static images → `web_fetch` is fine
- User is researching/reading, not extracting video → no escalation needed
- Video is short/simple and `web_fetch` captured it → use what `web_fetch` provided

## Integration with browser automation
`download_media` is **not** a browser tool, but it belongs in the browser workflow because:
- It handles media pages (X, YouTube, Instagram, TikTok, etc.) that are often accessed via browser
- Video extraction from interactive sites often requires both text/metadata (`web_fetch`) and full media (`download_media`)
- It provides a direct, non-interactive path for media acquisition from social/video URLs

## Changelog
- 2026-06-07: Created after live testing on Yarchi Obsidian thread; documented the escalation pattern from `web_fetch` to `download_media` for robust X video extraction.
