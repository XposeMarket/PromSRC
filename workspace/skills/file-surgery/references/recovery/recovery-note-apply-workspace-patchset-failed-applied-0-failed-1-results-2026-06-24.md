# Recovery note: workspace patch text not found after context drift

Source candidate: sg_7844decb187a9ceb
Captured: 2026-06-24T02:34:45.154Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when a workspace file patch fails because exact text is no longer found, especially after generated output, manual edits, or nearby context drift changed the expected span.

## Learned Behavior
Do not retry the same replacement blindly. Re-read the exact surrounding lines from the current file, shrink the patch to the smallest stable span, then run the narrowest relevant syntax or validation check before continuing.

## Why This Helps
Keeps valid file-edit work moving after context drift without rerendering unnecessarily, abandoning a valid result, or wandering into unrelated fixes.

## Avoid
- Do not preserve the specific failed file/path as the trigger unless the path itself is the reusable lesson.
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-06-23/workflow-episodes.jsonl
- Brain/skill-episodes/2026-06-23/episodes.jsonl
