# Recovery note: apply_dev_source_patchset failed: ERROR: Text not found in web-ui/src/pages/ChatPage.js. L

Source candidate: sg_35558b489d041935
Captured: 2026-06-13T18:43:19.875Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: apply_dev_source_patchset failed: ERROR: Text not found in web-ui/src/pages/ChatPage.js. Likely intended locations: 1) same text with normalized whitespace, lines 10160-10165: 10158: .filter(Boolean); 10159: } 1016

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-06-13/workflow-episodes.jsonl
- Brain/skill-episodes/2026-06-13/episodes.jsonl
