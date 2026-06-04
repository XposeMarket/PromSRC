# Recovery note: `find_replace` text not found after context drift

Source candidate: sg_5d9219d2301884ca
Captured: 2026-06-01T16:32:28.934Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when a workspace file edit fails because `find_replace` or a narrow text patch reports `Text not found`, especially after the file was recently edited or generated and the intended location still appears to exist with different whitespace, nearby wording, or formatting.

## Learned Behavior
Re-read the exact surrounding lines with line numbers, then retry with the smallest safe patch: `replace_lines` for a known line range, or a more exact `find_replace` after confirming whitespace and punctuation. After the edit, run the narrowest useful validation for the touched file before continuing.

## Why This Helps
Prevents Prometheus from abandoning a valid edit, rerendering unrelated output, or looping on stale patch text when the real issue is minor context drift.

## Avoid
- Do not keep retrying the same stale text.
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.
- Do not generalize one file's exact error text into a permanent trigger unless the behavior applies across file edits.

## Evidence
- Brain/skill-gardener/2026-06-01/workflow-episodes.jsonl
- Brain/skill-episodes/2026-06-01/episodes.jsonl
