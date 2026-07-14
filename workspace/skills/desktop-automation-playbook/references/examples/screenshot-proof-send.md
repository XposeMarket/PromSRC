# Screenshot proof send guardrail (2026-06-01)

Observed failure: after focusing Codex, the run tried to send a screenshot proof using a transient screenshot/attachment id through a generic delivery send path and hit `Attachment not found`. A later desktop screenshot request succeeded with the simpler path: take a fresh desktop screenshot, then send that fresh image.

Safer recipe when the user asks for proof after desktop work:

1. Complete and verify the desktop action using the normal screenshot/window-state loop.
2. Take a fresh proof capture with `desktop_screenshot(...)` or the relevant desktop screenshot tool after the action is visibly complete.
3. Send the fresh captured screenshot using the desktop/the configured messaging channel proof tool for screenshots, rather than reusing an internal `screenshot_id`, capture id, or attachment id as a file path.
4. If a generic delivery tool reports `Attachment not found`, immediately recover by taking a new screenshot and sending that new capture; do not claim the screenshot was sent until the send tool succeeds.

Evidence: `Brain/skill-episodes/2026-06-01/episodes.jsonl` entry at `2026-06-01T05:36:41.214Z` recorded `delivery_send_screenshot` failing with `Attachment not found`; `Brain/skill-gardener/2026-06-01/workflow-episodes.jsonl` entries at `2026-06-01T06:06:47.348Z` and `2026-06-01T06:07:39.411Z` recorded successful desktop screenshot send flows.
