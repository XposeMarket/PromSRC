# Recovery note: find_replace failed: ERROR: Text not found in games/mobile-space-explorer/js/main.js. Like

Source candidate: sg_1745e6109c05d120
Captured: 2026-07-03T22:54:55.509Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in games/mobile-space-explorer/js/main.js. Likely intended locations: 1) same text with normalized whitespace, lines 334-339: 332: }; 333: } 334: document.get

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-03/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-03/episodes.jsonl
