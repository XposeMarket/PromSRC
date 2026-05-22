# Creative export: Failed to fetch but artifact exists

Source candidate: sg_052fb7ee0e7023b8
Captured: 2026-05-15T18:26:29.399Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when Creative/HyperFrames export reports `Failed to fetch` after rendering.

## Learned Behavior
Before treating the export as failed, verify the artifact path, file size, timeline snapshots, and quality report; if those pass, report it as an export transport/status issue.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Recovery Steps
1. Check whether the exported MP4 path exists.
2. Check that the file size is nonzero.
3. Render timeline snapshots or inspect frames to confirm the clip changed over time.
4. Run or inspect the quality report for fatal layout/export issues.
5. If those pass, treat the message as a transport/status reporting issue, not a failed render.

## Avoid
- Do not discard or rerender a valid export solely because the API response said `Failed to fetch`.

## Evidence
- Brain/skill-gardener/2026-05-15/workflow-episodes.jsonl
- Brain/skill-episodes/2026-05-15/episodes.jsonl
