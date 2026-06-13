# Recovery note: `find_replace` text not found during skill/file edits

Source candidate: sg_81ebcf72fef7fe6a
Captured: 2026-06-12T02:19:40.713Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when a workspace or skill file edit fails because `find_replace` reports `Text not found`, but the intended location still appears to exist with changed whitespace, frontmatter structure, inserted metadata, or nearby wording.

## Learned Behavior
Re-read the exact surrounding lines with line numbers before retrying. Shrink the patch to the smallest stable span, prefer `replace_lines` for a known line range when frontmatter/spacing drifted, and then run the narrowest relevant validation or readback before continuing.

## Why This Helps
Keeps valid file/skill cleanup moving after context drift without retrying stale replacement text, abandoning the edit, or turning one file's raw error payload into the permanent trigger.

## Avoid
- Do not keep retrying the same stale `find_replace` text.
- Do not preserve a specific failed path as the trigger unless the path itself is the reusable lesson.
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-06-11/workflow-episodes.jsonl
- Brain/skill-episodes/2026-06-11/episodes.jsonl
