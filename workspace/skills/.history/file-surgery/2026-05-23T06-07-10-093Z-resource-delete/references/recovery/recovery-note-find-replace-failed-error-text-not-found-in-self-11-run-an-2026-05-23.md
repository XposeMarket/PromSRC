# Recovery note: find_replace failed: ERROR: Text not found in self/11-run-and-supervisor.md

Source candidate: sg_cc6ae9ee9bf08ded
Captured: 2026-05-23T02:26:52.276Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in self/11-run-and-supervisor.md

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-05-22/workflow-episodes.jsonl
- Brain/skill-episodes/2026-05-22/episodes.jsonl
