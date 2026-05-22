## 6F) HTML Motion Blocks

Current HTML Motion block IDs in `html-motion-blocks.ts`:

- `timed-caption`
- `lower-third`
- `seekable-canvas`
- `ascii-source-canvas`
- `punch-caption`
- `karaoke-caption`
- `subtitle-bar`
- `app-frame`
- `phone-mockup`
- `dashboard-panel`
- `count-up-stat`
- `bar-race`
- `sparkline-reveal`
- `flash-transition`
- `wipe-transition`
- `blur-push-transition`
- `shader-canvas-transition`
- `end-card`
- `button-pulse`
- `logo-lockup`
- `feature-checklist`
- `notification-stack`
- `icon-burst`
- `price-offer-card`
- `timeline-steps`
- `gradient-wipe-transition`
- `browser-workspace-frame`
- `chat-build-panel`
- `tweak-panel`
- `cursor-path`
- `artifact-gallery`
- `export-agent-modal`

Block families:

- captions: `timed-caption`, `punch-caption`, `karaoke-caption`, `subtitle-bar`, `lower-third`
- product proof/UI: `app-frame`, `phone-mockup`, `dashboard-panel`, `feature-checklist`, `notification-stack`
- charts/data: `count-up-stat`, `bar-race`, `sparkline-reveal`
- transitions: `flash-transition`, `wipe-transition`, `blur-push-transition`, `shader-canvas-transition`, `gradient-wipe-transition`
- CTA/brand: `end-card`, `button-pulse`, `logo-lockup`, `price-offer-card`
- product-demo film: `browser-workspace-frame`, `chat-build-panel`, `tweak-panel`, `cursor-path`, `artifact-gallery`, `export-agent-modal`
- misc/motion: `seekable-canvas`, `ascii-source-canvas`, `icon-burst`, `timeline-steps`

Use blocks to enrich or patch existing HTML clips rather than inventing fragile one-off markup.

Creative render job routes now exist for async render/export tracking:

- `GET /api/canvas/creative-render-jobs`
- `POST /api/canvas/creative-render-jobs`
- `POST /api/canvas/creative-render-jobs/:jobId/start`
- `GET /api/canvas/creative-render-jobs/:jobId`
- `POST /api/canvas/creative-render-jobs/:jobId/progress`
- `POST /api/canvas/creative-render-jobs/:jobId/cancel`
- `POST /api/canvas/creative-render-jobs/:jobId/complete`
