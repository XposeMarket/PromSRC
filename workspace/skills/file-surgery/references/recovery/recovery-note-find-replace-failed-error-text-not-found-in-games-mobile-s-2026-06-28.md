# Recovery note: find_replace failed: ERROR: Text not found in games/mobile-sideways-fps/ZOMBIES_ROADMAP.md

Source candidate: sg_bd496e8f9851a4af
Captured: 2026-06-28T16:06:11.955Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in games/mobile-sideways-fps/ZOMBIES_ROADMAP.md. Likely intended locations: 1) closest token block, lines 146-149: 144: - [x] Add pause/restart controls. 145:

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-06-28/workflow-episodes.jsonl
- Brain/skill-episodes/2026-06-28/episodes.jsonl
