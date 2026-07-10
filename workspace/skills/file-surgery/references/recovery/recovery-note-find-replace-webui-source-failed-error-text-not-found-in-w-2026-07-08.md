# Recovery note: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/mobile/mobile-pages.

Source candidate: sg_a7607892175176e5
Captured: 2026-07-08T19:01:00.780Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/mobile/mobile-pages.js. Likely intended locations: 1) matching prefix anchor, lines 2832-2865: 2830: && /^[a-z0-9'"(]/.test(String(run[0] || '')

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-08/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-08/episodes.jsonl
