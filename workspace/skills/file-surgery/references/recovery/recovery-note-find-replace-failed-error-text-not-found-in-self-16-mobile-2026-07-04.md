# Recovery note: find_replace failed: ERROR: Text not found in self/16-mobile-app.md. No close candidate fo

Source candidate: sg_6be16342c5699429
Captured: 2026-07-04T01:14:04.025Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in self/16-mobile-app.md. No close candidate found. Use read_file to confirm exact text including whitespace.

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-03/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-03/episodes.jsonl
