# Recovery note: find_replace failed: ERROR: Text not found in repos/PromSRC-compare/src/gateway/agents-run

Source candidate: sg_cac62ef362a90469
Captured: 2026-07-08T00:24:34.945Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in repos/PromSRC-compare/src/gateway/agents-runtime/subagent-manager.ts. Likely intended locations: 1) same text with normalized whitespace, lines 3-3: 1: /**

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-07/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-07/episodes.jsonl
