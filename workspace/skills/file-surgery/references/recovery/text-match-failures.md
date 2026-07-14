# Recovery note: apply_dev_source_patchset failed: ERROR: Text not found in web-ui/src/pages/ChatPage.js. L

Source candidate: sg_35558b489d041935
Captured: 2026-06-13T18:43:19.875Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: apply_dev_source_patchset failed: ERROR: Text not found in web-ui/src/pages/ChatPage.js. Likely intended locations: 1) same text with normalized whitespace, lines 10160-10165: 10158: .filter(Boolean); 10159: } 1016

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-06-13/workflow-episodes.jsonl
- Brain/skill-episodes/2026-06-13/episodes.jsonl

---

## recovery note apply dev source patchset failed web ui src mobile mobile 2026 06 13

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

---

## recovery note apply workspace patchset failed applied 0 failed 1 results 2026 06 24

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

---

## recovery note find replace failed error text not found in dog adoption l 2026 06 01

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

---

## recovery note find replace failed error text not found in games mobile s 2026 06 28

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

---

## recovery note find replace failed error text not found in repos nebulax 2026 07 05

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

---

## recovery note find replace failed error text not found in repos promsrc 2026 07 08

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

---

## recovery note find replace failed error text not found in self 16 mobile 2026 07 04

# Recovery note: find_replace failed: ERROR: Text not found in self/16-mobile-app.md. No close candidate fo

Source candidate: sg_6be16342c5699429
Captured: 2026-07-04T01:14:04.025Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace failed: ERROR: Text not found in self/16-mobile-app.md. No close candidate found. Use read_file to confirm exact text including whitespace.

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-03/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-03/episodes.jsonl

---

## recovery note find replace failed error text not found in skills brand s 2026 06 12

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

---

## recovery note find replace source failed text not found in src gateway r 2026 05 23

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

---

## recovery note find replace webui source failed error text not found in w 2026 07 08

# Recovery note: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/mobile/mobile-pages.

Source candidate: sg_a7607892175176e5
Captured: 2026-07-08T19:01:00.780Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/mobile/mobile-pages.js. Likely intended locations: 1) matching prefix anchor, lines 2832-2865: 2830: && /^[a-z0-9'"(]/.test(String(run[0] || '')

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-08/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-08/episodes.jsonl

---

## recovery note find replace webui source failed error text not found in w 2026 07 09

# Recovery note: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/mobile/mobile-model-

Source candidate: sg_399fdb7cac81ab09
Captured: 2026-07-09T23:43:46.632Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/mobile/mobile-model-badge.js. Likely intended locations: 1) same text with normalized whitespace, lines 302-303: 300: <div class="pm-msheet-body

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-09/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-09/episodes.jsonl

---

## recovery note find replace webui source failed error text not found in w 2026 07 10

# Recovery note: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/styles/mobile.css. L

Source candidate: sg_96c4ad52d38f8cc3
Captured: 2026-07-10T00:01:25.840Z
Lesson type: recovery
Confidence: medium

## Future Trigger
Use this when file-surgery hits this failure pattern: find_replace_webui_source failed: ERROR: Text not found in web-ui/src/styles/mobile.css. Likely intended locations: 1) same text with normalized whitespace, lines 690-729: 688: } 689: .pm-msheet-toggle-hint { font-

## Learned Behavior
After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.

## Why This Helps
Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.

## Avoid
- Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.

## Evidence
- Brain/skill-gardener/2026-07-09/workflow-episodes.jsonl
- Brain/skill-episodes/2026-07-09/episodes.jsonl
