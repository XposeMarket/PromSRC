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

## Files
- web-ui/src/mobile/mobile-pages.js
- web-ui/src/styles/mobile.css
- scripts/test-mobile-message-edit-ui.mjs
- .pr/SPEC.md

Test: node scripts/test-mobile-message-edit-ui.mjs

## Risks
- Only mobile edit composer + long-press portal styling; desktop untouched (all selectors scoped to body.pm-mobile-active / mobile renderer).
- Notice via edit composer layout regressions on phone; rollback = revert commit.
