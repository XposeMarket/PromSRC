---
name: "local-file-browser-verification"
description: "Open and verify a local HTML/web project in a browser, including visual layout, responsive behavior, interaction, console errors, local asset loading, and post-edit smoke testing. Use for browser QA of local files or localhost; do not use for generic coding or live-site automation unrelated to verification."
---

# Local browser verification

Test the actual rendered artifact rather than inferring behavior from source.

1. Identify the canonical entrypoint and whether it needs a local server instead of `file://`.
2. Start only the project’s documented safe server command, when required.
3. Open the exact local/localhost URL and confirm the expected build.
4. Exercise primary interactions and representative states.
5. Inspect desktop and mobile widths, overflow, hit targets, focus, text clipping, images/fonts, and canvas/media.
6. Check console/network errors and distinguish application bugs from browser/security restrictions.
7. Re-test the changed behavior plus one adjacent regression path.
8. Stop temporary processes Prometheus started and report evidence.

Do not silently test a generated/stale copy or a different port. Use browser tools before desktop automation for browser content.

Read [detailed-guide.md](references/detailed-guide.md) for local-server choices, mobile QA, hit-testing, file-URL restrictions, and debugging patterns. Read [hit-testing-debug-snippets.md](references/hit-testing-debug-snippets.md) only for pointer/touch failures.
