# Recovery note: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/styles/mobile.css. L

Source candidate: sg_96c4ad52d38f8cc3
Captured: 2026-07-10T00:01:25.840Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/styles/mobile.css. Likely intended locations: 1) same text with normalized whitespace, lines 690-729: 688: } 689: .pm-msheet-toggle-hint { font-

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-09/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-09/episodes.jsonl
