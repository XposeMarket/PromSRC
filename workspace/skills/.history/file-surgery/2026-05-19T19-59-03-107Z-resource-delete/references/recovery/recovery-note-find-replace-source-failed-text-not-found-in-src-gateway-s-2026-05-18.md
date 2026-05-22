# Recovery note: find_replace_source failed: Text not found in src/gateway/session.ts. Use read_source to c

Source candidate: sg_473932bedbcc5c82
Captured: 2026-05-18T17:14:28.776Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_source failed: Text not found in src/gateway/session.ts. Use read_source to confirm exact text including whitespace.

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-05-18/workflow-episodes.jsonl
- Brain/skill-episodes/2026-05-18/episodes.jsonl
