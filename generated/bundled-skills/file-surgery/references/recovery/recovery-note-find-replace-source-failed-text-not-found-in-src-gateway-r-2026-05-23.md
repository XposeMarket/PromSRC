# Recovery note: source patch text not found after context drift

Source candidate: sg_b61d3f9527647511
Captured: 2026-05-23T19:12:09.728Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when a source/file edit patch fails because exact text is no longer found after prior edits, generated-file sync, or nearby context drift.

## Learned Behavior
Do not retry the same replacement blindly. Re-read the exact surrounding lines from the current file, shrink the patch to the smallest stable span, then run the narrowest relevant syntax/validation check before continuing.

## Why This Helps
Keeps valid source-edit work moving after context drift without wandering into unrelated fixes or saving a raw one-file/tool-error transcript as reusable guidance.

## Avoid
- Do not preserve the specific failed source path as the trigger unless the path itself is the reusable lesson.
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl
- Brain/skill-episodes/2026-05-23/episodes.jsonl
