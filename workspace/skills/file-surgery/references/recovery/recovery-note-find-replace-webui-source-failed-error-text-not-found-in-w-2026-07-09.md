# Recovery note: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/mobile/mobile-model-

Source candidate: sg_399fdb7cac81ab09
Captured: 2026-07-09T23:43:46.632Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/mobile/mobile-model-badge.js. Likely intended locations: 1) same text with normalized whitespace, lines 302-303: 300: <div class="pm-msheet-body

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-09/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-09/episodes.jsonl
