# Audio Transcription Workflow for Browser/Media Downloads

Date: 2026-06-07
Context: Adding transcription guidance to browser automation and media workflows

## When to Transcribe Audio/Video

Use transcription when:
- Downloaded media from browser workflows contains speech/audio content
- User wants to understand video content without watching
- Audio/video analysis shows meaningful speech but no automatic transcript was generated
- X/Twitter videos, YouTube clips, or other media pages have important audio content

## Transcription Tools Available

### Primary: creative_transcribe_audio
Use `creative_transcribe_audio` when automatic transcription doesn't happen during `analyze_video` or `download_media`:

```javascript
creative_transcribe_audio({
  source: "path/to/audio/or/video/file.mp4",  // workspace path
  provider: "openai",  // or "xai" 
  language: "en"       // optional
})
```

- Works with video files (extracts audio automatically) or pure audio files
- Returns timestamped transcript segments
- Integrates with Creative Mode workflow if active

### Fallback: analyze_video with transcribe flag
When using `analyze_video`, set `transcribe: true`:

```javascript
analyze_video({
  file_path: "downloads/video.mp4",
  analysis_mode: "quick",  // or "detail"
  transcribe: true,
  extract_audio: true
})
```

## Common Browser → Transcription Workflows

### 1. X/Twitter Video Download + Transcription
```
1. browser_open("x.com/user/status/id") or web_fetch("x.com/user/status/id")
2. download_media(url, output_dir: "downloads/x-videos")
3. If automatic transcription didn't occur:
   creative_transcribe_audio({ source: "<downloaded-path>" })
```

### 2. YouTube/Media Page → Full Analysis
```
1. download_media(youtube_url, output_dir: "downloads/media")
2. analyze_video(file_path: "<downloaded-path>", transcribe: true)
3. If transcript is missing or poor quality:
   creative_transcribe_audio({ source: "<downloaded-path>", provider: "openai" })
```

### 3. Browser-Triggered Download → Transcription
```
1. browser_open(media_page_url)
2. browser_click_and_download(download_button_ref)
3. creative_transcribe_audio({ source: "<workspace-download-path>" })
```

## Provider Selection

- **OpenAI**: Generally more accurate for English, faster processing
- **xAI**: Good alternative if OpenAI quotas hit or for non-English content

Test both if accuracy matters; OpenAI Whisper is usually the default choice.

## Integration with Creative Mode

If using Creative Mode for video work:
- `creative_transcribe_audio` automatically integrates with Creative asset library
- Results can feed into caption generation, voiceover work, or video editing workflows
- Transcribed segments become available for Creative timeline/caption tools

## File Path Requirements

Always use workspace-relative or absolute workspace-contained paths:
- Good: `"downloads/video-analysis/file.mp4"`
- Good: `"downloads/x-videos/tweet-video.mp4"`  
- Bad: External URLs (download first)
- Bad: Paths outside workspace (copy to workspace first)

## Error Recovery

If `creative_transcribe_audio` fails:
1. Check file exists and is accessible
2. Try alternative provider (`openai` vs `xai`)
3. For video files, try extracting audio first with `analyze_video(..., extract_audio: true)`
4. Use the extracted audio file with `creative_transcribe_audio`
