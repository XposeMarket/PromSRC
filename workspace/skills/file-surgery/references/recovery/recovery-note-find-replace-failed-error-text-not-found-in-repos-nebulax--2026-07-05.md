# Recovery note: find_replace failed: ERROR: Text not found in repos/nebulax-test/assets/js/inline-02.jsx. 

Source candidate: sg_c5b7ddadd11c127f
Captured: 2026-07-05T04:00:39.019Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in repos/nebulax-test/assets/js/inline-02.jsx. Likely intended locations: 1) same text with normalized whitespace, lines 200-202: 198: </div> 199: ); 200: } 2

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-05/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-05/episodes.jsonl
