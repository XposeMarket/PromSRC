# SPEC: Focused inline Sources, products and images
Surface: both
Parity: fixed both: shared cards runtime; Chromium desktop and WebKit mobile tests/screenshots, light/dark.
Test: node scripts/test-focused-carousels.mjs
Size justification: Shared component plus cross-surface browser regression; no backend changes.

## Problem
User wants one focused inline card with neighboring peeks and swipe-through navigation, like the theme selector rather than equally weighted strips/grids. Applies to Sources, product and image carousels. Tier 1 presentation only; primary model builds and reviews directly.
## Existing code
cards/card-runtime.js owns shared hydration. Desktop ChatPage.js and mobile/mobile-pages.js build sources/products; cards-data.js builds galleries. mobile-theme-picker.css demonstrates centered scroll snap.
## Chosen approach
Shared focused-carousel helper enhances existing markup with native horizontal center snap, focused scale/opacity, position and previous/next controls. Preserves content, source/product links, gallery lightbox and single-item behavior. No parser, storage, permission or backend changes. Native scroll avoids custom touch gesture interception.
## Acceptance
Three carousel types center first/middle/last items on desktop/mobile; controls and keyboard work; no page overflow. Links and lightboxes survive; reduced motion honored; no controls for one/zero items. Inserted cards hydrate and removed cards release ResizeObservers. No theme selector changes, popovers or changes to user messages/citation pills.
## Out of scope
Theme selector, other cards, backend data, memory, permissions, publishing, merge/deployment.
## Files
- .pr/SPEC.md
- web-ui/src/cards/focused-carousel.js
- web-ui/src/cards/card-runtime.js
- scripts/test-focused-carousels.mjs
- generated/public-web-ui/*
## Scope notes
Runtime self/17,18,23 read; self/23 and surface docs updated in same turn (outside repo).
## Risks
CSS cascade and dynamic DOM insertion. Regression uses actual renderer declarations/styles on Chromium and WebKit. Rollback removes helper/runtime integration; no migrations.

## Visual refinement (Nov 8)
Multi-image galleries have no outer card background, border, padding or title strip; image buttons, accessible labels and lightbox data remain intact. Product images dominate a compact details section on both surfaces: no reserved title/card height, two-line title, one-line description, lighter metadata. Only enhanced multi-item carousels change; regression verifies computed chrome and image/detail proportions.
