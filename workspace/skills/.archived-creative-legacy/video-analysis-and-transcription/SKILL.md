---
name: Video Analysis and Transcription
description: Use this skill when the user wants Prometheus to watch a video, extract audio, transcribe speech, summarize what happens, inspect visible text, or analyze media downloaded from X/Twitter or any other source. Triggers on requests like: analyze this video, watch this clip, transcribe this video, extract audio from this file, summarize this mp4, tell me what happens in this reel, analyze this downloaded video, pull audio from this X post, or turn this clip into transcript + summary. Best for end-to-end video workflows: acquire media, verify audio presence, run `analyze_video`, interpret transcript quality, and report concrete outputs and saved files.
emoji: "🎬"
version: 1.0.0
triggers: analyze this video, watch this video, watch this clip, transcribe this video, transcribe this clip, extract audio from this video, summarize this mp4, summarize this video, analyze this reel, analyze this downloaded video, get transcript from this video, pull audio from this x post, video transcript and summary
---

# Video Analysis and Transcription

Use this skill for any request where the job is to **understand a video or audio-bearing clip**, not just download it.

---

## What This Skill Covers

Use this skill when the user wants to:
- analyze a local video file in the workspace
- transcribe spoken audio from a video
- extract audio from a clip and confirm whether usable speech exists
- summarize what happens visually in a video
- inspect visible on-screen text in frames
- find clip-worthy moments, hooks, dead sections, scene changes, b-roll moments, or edit ranges
- analyze a video downloaded from X, YouTube, Instagram, TikTok, or any direct file/URL handoff
- turn a clip into **transcript + summary + notable moments**

This skill is the **analysis layer after media acquisition**.

If the user first needs the media file itself:
- X/Twitter post URL → use `x-post-fetch-and-media` or `x-browser-automation-playbook` first
- direct file URL → use `download_url`
- supported social/video page URL → use `download_media`

Then hand the resulting local file into this skill.

---

## Core Principle

Do not guess from filenames or page context. Work from the actual media file.

For video understanding, the default best path is:
1. make sure the file exists locally
2. run `analyze_video`
3. read the returned visual summary + transcript cues
4. state clearly what was confirmed versus uncertain

When the user asks for audio extraction/transcription specifically, you still usually start with `analyze_video` because it already handles:
- sampled visual frames
- audio extraction when available
- Whisper transcription when available

Only drop to manual shell-level extraction/testing when you are debugging the pipeline itself, not during ordinary user requests.

---

## Fast Default Workflow

### Case A — User gives a local video file
1. Confirm or locate the file path in the workspace.
2. Run:
   ```json
   analyze_video({
     "file_path": "downloads/media/example.mp4",
     "prompt": "Summarize what happens in the clip, include visible text, and transcribe any intelligible speech.",
     "sample_count": 6,
     "extract_audio": true,
     "transcribe": true
   })
   ```
3. Report:
   - what happens visually
   - what speech was transcribed
   - whether the transcript seems strong, partial, noisy, or absent
   - any saved artifact/output directory if returned

### Case B — User gives a page URL that likely contains video
1. If it is an X/social page supported by downloader tools, use `download_media` first.
2. If it is a direct file URL, use `download_url`.
3. After the file is saved locally, run `analyze_video`.
4. Return the saved file path plus the analysis.

### Case C — User mainly wants audio/transcript
1. Use the same `analyze_video` call with `extract_audio:true` and `transcribe:true`.
2. Prioritize reporting:
   - whether an audio track was actually present
   - transcript text
   - transcript quality/confidence language
3. If the result is weak, say so plainly instead of pretending the clip was clear.

---

## Recommended Prompt Patterns for `analyze_video`

Use prompts that force concrete output.

### General understanding
```text
Summarize what happens in this clip, include visible text, and note any spoken audio.
```

### Transcript-focused
```text
Transcribe any intelligible speech, summarize the visuals briefly, and call out if the audio is sparse, noisy, or unclear.
```

### Social-media clip analysis
```text
Describe the clip like a content analyst: what is shown, what message it is delivering, any on-screen text, and the exact speech/transcript if possible.
```

### Ad / marketing analysis
```text
Summarize the hook, main message, CTA, visible text overlays, and spoken audio. Note whether the message is clear and what the clip is trying to persuade the viewer to do.
```

### Clipping / edit-decision analysis
```text
Analyze this source video for short-form clipping. Identify candidate clip ranges with timestamps, hook moments, visual proof, dead air, scene changes, visible text, transcript/audio cues, and recommended crop/framing/speed/caption treatment.
```

---

## Output Standard

Always separate results into these buckets when relevant:

### 1. File analyzed
State the exact file path.

### 2. Visual summary
What the clip visibly shows.

### 3. Transcript / spoken audio
Quote the transcript when available.

### 4. Quality / confidence
State whether the speech was:
- clear
- mostly clear
- partial
- faint/noisy
- absent / no usable speech detected

### 5. Important caveats
Examples:
- music-heavy clip with little speech
- overlapping speakers
- short clip with only one phrase
- auto-generated captions visible but spoken audio unclear

### 6. Edit decision list
When the user wants clips or a new promo built from source footage, include:
- source range: `startMs` / `endMs` or `MM:SS-MM:SS`
- selected moment summary
- why it is useful
- visual crop/framing recommendation
- audio/transcript note
- speed/caption treatment
- target role: hook, proof, b-roll, transition, CTA, or montage tile

Good result format:
- `File:` `downloads/media/example.mp4`
- `Visual:` A man demonstrates a product at a desk while on-screen captions appear.
- `Transcript:` “...exact quoted text...”
- `Quality:` Mostly clear, minor misses on the first second.

Bad result format:
- “I watched it.”
- “Looks fine.”
- “Probably says something about marketing.”

---

## Interpretation Rules

### If transcript quality is weak
Do not treat that as tool failure automatically.
Common reasons:
- the source audio is extremely quiet
- background music dominates the clip
- speech is distorted or compressed
- there are only one or two short words
- the clip has no real speech track

Say exactly that the transcript is weak because the underlying audio appears weak, sparse, or noisy.

### If visuals are strong but transcript is empty
Still provide value from the visual analysis.
The answer can be useful even with no speech.

### If the video is primarily captions/text-on-screen
Report the visible text clearly even if spoken audio is minimal.

### If the user wants exact wording
Quote only what the analysis actually recovered. Do not “clean up” uncertain phrases into confident fake text.

---

## X / Social Media Handoff Rules

This skill does not replace the X-fetch or media-download skills. It sits downstream from them.

### For an X post with video
Preferred flow:
1. identify/fetch the X post using `web_fetch` when text/media discovery matters
2. acquire the media with `download_media`
3. analyze the saved file with `analyze_video`

### For a downloaded X clip already in workspace
Go straight to `analyze_video`.

### For any other supported social/video URL
Use `download_media`, then this skill.

---

## Verification Rules

Before claiming success, verify at least one of:
- `analyze_video` returned structured output for the target file
- the tool returned the concrete file path analyzed
- the tool produced transcript/visual summary content tied to that file

Do not claim transcription worked just because a download succeeded.
Do not claim audio existed just because the file was an MP4.

---

## When to Escalate Beyond `analyze_video`

Escalate only for diagnostics or pipeline debugging, such as:
- confirming whether ffmpeg is installed and callable
- checking whether a file has an audio stream at all
- comparing two clips to understand why one transcript is weak
- validating Whisper setup after installation
- building a finished edit from selected moments, which should hand off to Creative Video / HTML Motion tools after the edit decision list is clear

For ordinary user requests, `analyze_video` is the default and usually sufficient.

---

## Anti-Patterns

Do **not**:
- open the browser just to “watch” a local file
- guess transcript text from context clues
- claim certainty when the transcript is partial or noisy
- force manual extraction steps when `analyze_video` can do the job directly
- confuse media acquisition with media understanding
- report only transcript text and ignore the visual side of the clip when the user asked what happens in the video
- pick random source ranges for clipping without explaining why those timestamps were chosen
- hand a long video directly to a template before analyzing the actual content

---

## Scope Tests

### Clear match
- “Analyze this downloaded MP4 and tell me what happens.”
- “Transcribe this video.”
- “Pull audio from this X video and summarize it.”

### Edge case
- “Can you see if this clip even has usable speech?”
  - Yes, this skill fits.

### False positive
- “Download the video from this tweet.”
  - Not this skill alone. First use X/media acquisition, then this skill.

---

## Known Good Operational Pattern

A validated end-to-end path already worked in this environment:
- local video file present in `downloads/media/`
- audio extraction available via ffmpeg
- transcription available via Whisper-backed video analysis
- stronger clips produce meaningful transcript output; weak/noisy clips may produce sparse text

That means the right default is not caution or speculation. The right default is to run the analysis and report the real result.
