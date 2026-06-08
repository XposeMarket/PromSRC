# Recovery note: find_replace_webui_source failed: Text not found in web-ui/src/mobile/mobile-pages.js. Use

Source candidate: sg_5b987b82172186a3
Captured: 2026-05-30T02:36:04.410Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_webui_source failed: Text not found in web-ui/src/mobile/mobile-pages.js. Use read_webui_source to confirm exact text including whitespace.

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-05-29/workflow-episodes.jsonl
- Brain/skill-episodes/2026-05-29/episodes.jsonl
