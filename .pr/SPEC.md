# fix(mobile): readable message edit composer + sans long-press preview

Tier: 1 (UI restore, outside the 8 sensitive areas)
Surface: single:mobile

## Problem
Mobile edit composer Cancel/Send used `.pm-msg-action`, whose late mobile override (`body.pm-mobile-active .pm-msg-action { width:30px }`) squeezed the text labels into circles; the textarea was a fixed cramped 4 rows. The long-press clone/popover are appended to `<body>`, outside `.pm-app` (which owns `font-family`), so the preview fell back to serif.

## Fix
- Dedicated `.pm-mobile-edit-btn` (44px min height, natural padded width, nowrap, chat font, primary = orange).
- Textarea: content-estimated rows (3-8), oninput auto-grow, bounded `max-height: min(45dvh,320px)` with scroll, 16px font (no iOS zoom).
- Final-authority font rule for body-level long-press portal nodes.
- Draft/edit/send/cancel semantics unchanged (same data-msg-action / data-msg-edit-input hooks).

## Chosen approach
Scoped mobile-only CSS final-authority block plus a dedicated button class in the renderer (no change to the shared `.pm-msg-action` icon sizing, chat engine, storage or permissions).

## Acceptance
- Cancel/Send are pill text buttons >=44px tall with natural width at 320 and 390px viewports.
- Textarea grows with content and caps at min(45dvh,320px) with internal scroll; short drafts stay compact.
- Long-press lifted clone and popover render in the system sans font.
- Cancel/Send/draft hooks unchanged; regression test passes.

## Files
- web-ui/src/mobile/mobile-chat-page-runtime.js
- web-ui/src/mobile/mobile-chat-message-renderer.js
- scripts/test-mobile-composer-edit.mjs
- web-ui/src/mobile/mobile-pages.js
- web-ui/src/styles/mobile.css
- scripts/test-mobile-message-edit-ui.mjs
- .pr/SPEC.md

Test: node scripts/test-mobile-message-edit-ui.mjs

Parity: single-surface: desktop uses its own `.msg-edit-composer` (web-ui/src/pages/ChatPage.js:7569, components.css:1055) and has no body-level long-press portal; the bug was the mobile-only `body.pm-mobile-active .pm-msg-action` 30px override.

## Risks
- Only mobile edit composer + long-press portal styling; desktop untouched (all selectors scoped to body.pm-mobile-active / mobile renderer).
- Notice via edit composer layout regressions on phone; rollback = revert commit.

## Composer edit revision (Raul Nov 7)
Edit now borrows the normal bottom composer temporarily. Original user bubble remains visible, greyed out; Cancel restores prior draft. Submit routes to existing edit/rerun handler before question/slash/send handling. Edit text is transient and does not overwrite the ordinary saved composer draft. No backend/storage format change. Desktop intentionally retains its existing editor; request is mobile-only.
Additional files: web-ui/src/mobile/mobile-chat-page-runtime.js, web-ui/src/mobile/mobile-chat-message-renderer.js, scripts/test-mobile-composer-edit.mjs.
Test: node scripts/test-mobile-composer-edit.mjs
Acceptance: same composer input, dimmed original bubble, visible Cancel, draft restored, no inline editor, existing rerun retained.
