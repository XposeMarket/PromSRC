# Background chat and tool presentation

Implemented in the source tree and generated web assets. The running Prometheus process was not restarted, and the active Vita workflow was not controlled during this change.

## Changes

- Mobile side chats fill the space below the measured main header. Their composer stays in the sheet's flex layout, and the panel ends at the visual viewport edge. This removes the fixed-position coordinate mismatch inside the clipped, blurred panel when the keyboard opens.
- Background headers retain and display the actual model and reasoning effort. Background records preserve that metadata across partial events and persistence.
- The work-duration disclosure exposes ordinary tool rows directly. Explicit reasoning summaries retain the shared main-chat presentation. Completed side-chat traces stay mounted when collapsed, so reopening does not depend on a main-chat message index.
- Background token narration boundaries and pre-tool commentary enter the visible timeline. Public summaries keep their separate summary channel; private reasoning remains excluded. Main-chat reasoning handlers are unchanged.
- Declared plans appear as the existing steps pill above the side composer and expand to the step list. Both declared progress events and legacy background plan tools are supported. Explicit plan checkpoints are recoverable after reconnect.
- Image/video preview events survive background checkpoints and desktop/mobile event conversion. They use the existing image/contact-sheet/frame-gallery renderers.
- Shared tool rows unpack background, browser, and desktop wrapper actions. Labels describe waits, messages, clicks, scrolling, window actions, key presses, and media analysis. Expandable details show messages, notes, wait limits, elapsed time, page/window/element information, and other supplied context. Note and message bodies use sanitized Markdown. Unknown targets are not invented.
- Fixed a cold-open replay bug: a status response's server cursor no longer replaces the client's consumed-event cursor. Lane references stay stable through replay, and traces from a different stream are not merged back into the new stream.

## Verification

- Backend TypeScript build passed.
- Generated desktop/mobile build and source-sync checks passed.
- Background steering, replay/presentation, tool activity, media preview, and main reasoning-summary regressions passed.
- Mobile CSS ownership, renderer ownership/authority, runtime authority, and composer/keyboard contracts passed.
- An isolated browser fixture used production tool rendering, Markdown sanitization, work-timer handlers, plan rendering, viewport measurement, and CSS layers. At 390 × 844, the panel began at 88px below an 80px header and the composer ended at 831px. At 390 × 460, the composer ended at 447px and the transcript shrank above it. Repeated collapse/reopen preserved completed trace content; the plan expanded to two steps; message Markdown rendered headings/emphasis/lists; no horizontal overflow was found.

Screenshots: `artifacts/background-agent-mobile.png` and `artifacts/background-agent-keyboard.png`. Regenerate the fixture with `node scripts/test-background-agent-presentation.mjs --write-fixture`.

The keyboard check used a reduced browser viewport plus visual-viewport geometry tests. A physical iPhone keyboard was not exercised. The fixture uses recorded media and synthetic agent events; it sends no live agent messages and does not operate the Vita.
