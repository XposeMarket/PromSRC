# Recovery note: find_replace failed: ERROR: Text not found in games/mobile-sideways-fps/index.html. No clo

Source candidate: sg_ae1b916a1e813599
Captured: 2026-07-02T00:05:27.923Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in games/mobile-sideways-fps/index.html. No close candidate found. Use read_file to confirm exact text including whitespace.

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-01/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-01/episodes.jsonl
