# X Media Transcription Workflow

Date: 2026-06-07
Context: Adding X-specific audio/video transcription guidance

## X Media Download + Transcription Pipeline

When working with X (Twitter) videos, audio content, or spaces that need transcription:

### 1. X Video Post → Transcription
```
# For X post URLs with video content:
1. web_fetch("https://x.com/user/status/id") 
   # Check if post has media, get context
   
2. download_media(url, output_dir: "downloads/x-videos")
   # Download the actual video file
   
3. If no automatic transcription occurred:
   creative_transcribe_audio({
     source: "<downloaded-video-path>",
     provider: "openai"  # or "xai"
   })
```

### 2. X Spaces or Long Audio Content
```
1. browser_open("x.com/i/spaces/[space_id]")
2. Use browser_click_and_download for space recording if available
3. creative_transcribe_audio({ 
     source: "<downloaded-audio>",
     language: "en"  # specify if known
   })
```

### 3. Bulk X Video Collection + Analysis
```
1. browser_scroll_collect on X search results
2. Extract video URLs from collected text
3. download_media for each video URL
4. Batch transcription:
   - analyze_video(transcribe: true) for each file
   - creative_transcribe_audio as fallback for missed transcriptions
```

## X-Specific Transcription Use Cases

### Thread Research with Video Evidence
When researching X threads that contain video proof/explanations:
- Fetch thread with web_fetch_batch
- Download embedded videos with download_media  
- Transcribe to get full context beyond just text tweets
- Combine transcript with thread text for comprehensive analysis

### Competitor Analysis via X Videos
For competitors posting demo videos, feature explanations, or announcements:
- Search X for competitor video content
- Download key videos using download_media
- Transcribe to extract feature claims, positioning, demos
- Analyze competitive intelligence from both video and audio content

### X Engagement Research  
When analyzing viral X content with audio/video:
- Identify trending video posts via X search/collection
- Download high-engagement video content
- Transcribe to understand what resonated in the audio layer
- Use insights for content strategy

## Integration with X Browser Workflows

### After web_fetch X URL Collection
```
urls = ["x.com/user/status/1", "x.com/user/status/2", ...]
results = web_fetch_batch({ urls })

for result in results:
  if result.has_media:
    video_file = download_media(result.url)
    transcript = creative_transcribe_audio({ source: video_file })
    # Combine result.text + transcript for full context
```

### After browser_scroll_collect on X
```
x_content = browser_scroll_collect({
  scrolls: 10, 
  multiplier: 1.75,
  include_structured: true  # Gets video URLs if available
})

# Extract video URLs from collected content
# Download and transcribe video content found in scroll collection
```

## Provider Choice for X Content

### OpenAI (Whisper) - Recommended for:
- Clear speech/narration in demo videos
- Professional content (founder updates, product announcements)  
- English-primary content
- When accuracy is critical for competitive analysis

### xAI - Good for:
- Casual/informal X content
- Non-English content that OpenAI misses
- When OpenAI quotas are hit
- Experimental/edge cases

## File Organization for X Transcriptions

Suggested workspace structure:
```
downloads/
  x-videos/
    YYYY-MM-DD/
      [username]_[status-id].mp4
      [username]_[status-id]_transcript.json
  x-spaces/
    [space-id].mp3
    [space-id]_transcript.json
```

Use consistent naming for easier batch processing and analysis.

## Quality Checks

After X video transcription:
1. Check transcript length vs video duration (catch silent/music-only videos)
2. Verify speaker clarity (some X videos have poor audio)
3. Cross-reference transcript with any visible text/captions in video
4. Flag videos that are mostly music/sound effects vs speech content

## Error Handling for X Media

Common X media transcription issues:
- **Video is silent/music only**: Check before transcribing, or transcribe and note empty/music result
- **Poor audio quality**: Try both providers, note quality limitations
- **Multi-language content**: Specify language parameter when known
- **Very short clips**: May not be worth transcribing (<10 seconds)
- **Copyright music**: May interfere with speech recognition

Always verify that downloaded X media actually contains speech before investing in transcription processing.
