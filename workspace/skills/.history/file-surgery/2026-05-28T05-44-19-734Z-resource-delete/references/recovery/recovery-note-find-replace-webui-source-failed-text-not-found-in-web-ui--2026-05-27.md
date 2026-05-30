# Recovery note: find_replace_webui_source failed: Text not found in web-ui/src/mobile/mobile-shell.js. Use

Source candidate: sg_af67c0d0a18cf762
Captured: 2026-05-27T00:50:56.720Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_webui_source failed: Text not found in web-ui/src/mobile/mobile-shell.js. Use read_webui_source to confirm exact text including whitespace.

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-05-26/workflow-episodes.jsonl
- Brain/skill-episodes/2026-05-26/episodes.jsonl
