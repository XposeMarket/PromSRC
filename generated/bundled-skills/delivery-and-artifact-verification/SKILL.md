---
name: "delivery-and-artifact-verification"
description: "Deliver and verify an actual generated file, screenshot, report, or attachment through the requested channel. Use for presentation and receipt; not for finding old artifacts (artifact-registry)."
---

# Delivery and Artifact Verification

Use this for presenting or sending a generated artifact, screenshot, file, image, report, or result. Keep creation, persistence, delivery, and user-visible receipt as separate states.

## Prepare

Confirm the final artifact path exists, is readable, and matches the requested format. For media or reports, perform the relevant decode, content, visual, or link check before delivery. Choose the origin-aware target unless the user named another destination. Do not deliver a stale draft or temporary file.

## Deliver

Use the narrowest delivery action: present a local file for inline review, send an attachment through the requested channel, or send text-only status when no artifact is needed. Preserve filenames and include a concise caption. Treat external sends, publishing, and other irreversible actions as separate final-action approval gates when applicable.

## Verify and recover

Inspect the post-delivery result or receipt. Confirm target, attachment count/name, visible content, and destination status. A local path or successful tool response alone is not proof the user received it. If delivery fails, keep the verified local artifact and report delivery failure separately. For missing or oversized files, reread the path or create a bounded derivative without destroying the source. Never blindly duplicate a send.
