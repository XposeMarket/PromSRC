# Recovery note: apply_dev_source_patchset failed: --- web-ui/src/mobile/mobile-pages.js via find_replace_w

Source candidate: sg_8cf5f23dffee9341
Captured: 2026-06-13T18:59:01.308Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: apply_dev_source_patchset failed: --- web-ui/src/mobile/mobile-pages.js via find_replace_webui_source --- ERROR: Text not found in web-ui/src/mobile/mobile-pages.js. Likely intended locations: 1) same text with nor

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-06-13/workflow-episodes.jsonl
- Brain/skill-episodes/2026-06-13/episodes.jsonl
