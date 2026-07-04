# Recovery note: find_replace failed: ERROR: Text not found in games/mobile-sideways-fps/index.html. Likely

Source candidate: sg_f6d01492aef4eb5c
Captured: 2026-07-02T00:47:35.616Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in games/mobile-sideways-fps/index.html. Likely intended locations: 1) closest token block, lines 99-102: 97: function startClick(e){if(ui.start.style.display

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-01/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-01/episodes.jsonl
