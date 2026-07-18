# Prometheus Mobile Screenshot Audit — 2026-07-18

Source screenshots:
- `uploads/IMG_6994.png`
- `uploads/IMG_6992_1784392228030.png`
- `uploads/IMG_6983.png`
- `uploads/IMG_6962.png`
- `uploads/IMG_6911.png`
- `uploads/IMG_6901.png`
- `uploads/IMG_6849.png`
- `uploads/IMG_6924.png`

This is a visual audit only. Runtime causes are hypotheses unless the screenshot exposes the exact error.

## Critical product/runtime failures

1. **Raw internal errors are rendered as assistant messages** (`IMG_6983`, `IMG_6849`).
   - Full HTTP status, JSON payload, internal error code, session ID fragment, durable turn UUID, resource name, and lease implementation language are exposed to the user.
   - These should become concise human messages with an expandable technical-details affordance.

2. **Duplicate/retry storm behavior** (`IMG_6983`, `IMG_6849`).
   - The same `SESSION_TURN_ACTIVE` response appears multiple times in the transcript and again as a toast.
   - The same session-lease warning appears three times in one assistant response and again as a toast.
   - The UI appears to append each failed retry as a new message rather than coalescing one recoverable state.

3. **Session and resource lease recovery is broken or absent** (`IMG_6983`, `IMG_6849`).
   - `SESSION_TURN_ACTIVE` blocks a new request even though the visible work says `Worked for 0s`.
   - `journal lease token is no longer active` and `could not acquire its session lease` leave the user stranded.
   - There is no visible recovery action such as Retry, Resume previous turn, Interrupt stale turn, or Start fresh session.

4. **Goal lifecycle can report completion without executing** (`IMG_6911`).
   - The goal starts with `Status: active Turns: 0` and is then marked done with `Turns: 0` and `Marked done by user`.
   - The giant success toast visually implies successful completion even though the work was not performed.
   - User-cancelled/marked-done needs a neutral `Goal stopped` state, not success semantics.

5. **Context accounting is impossible/contradictory** (`IMG_6924`).
   - `425k / 272k (100%)` shows usage above capacity while clamping the percentage to 100%.
   - Either the denominator, aggregation, or label is wrong. If over capacity is legitimate, display 156% / overflow; otherwise fix the calculation.

## Rendering and layout failures

6. **Catastrophic Markdown loss / token concatenation** (`IMG_6992`).
   - Headings render literally as `###`.
   - Newlines disappear between headings, prose, and list items.
   - Words and block types concatenate: `implementationtextparallel`, `changeThis`, `improveThere`, `targetsRight`, `bundlesFor`.
   - Ordered and unordered list delimiters collapse into prose.
   - Inline code and prose run together.
   - This is not ordinary typography; the message structure or Markdown token boundaries were destroyed.

7. **Malformed activity/final-answer boundary** (`IMG_6962`).
   - `process****Verifying original image size and asset paths` exposes Markdown emphasis markers and joins two separate events.
   - Activity commentary, tool groups, and assistant prose do not maintain reliable block separation.

8. **Wide technical strings overflow instead of wrapping safely** (`IMG_6994`, `IMG_6983`, `IMG_6849`).
   - SHA-256/path content runs off the card edge in Runs.
   - Raw JSON/session IDs are clipped horizontally.
   - Long durable-turn UUIDs create poor line breaks and unreadable walls of text.
   - Code/path/hash content needs `overflow-wrap:anywhere`, bounded code blocks, truncation with copy, or horizontal scroll where appropriate.

9. **Sources card stack is severely broken** (`IMG_6901`).
   - Cards overlap each other, rotate excessively, and extend beyond the viewport.
   - Text and thumbnails from multiple sources are superimposed and unreadable.
   - The source deck occupies a huge mostly-empty screen while the usable content is compressed into one collision area.
   - The layout appears stuck mid-animation or uses desktop transforms without a mobile containment/fallback layout.

10. **Top content is hidden beneath the sticky header** (`IMG_6992`, `IMG_6962`, `IMG_6911`, `IMG_6924`).
    - Transcript text is visibly clipped behind the menu/model/edit controls.
    - The scroll container does not reserve the effective header height or restore a safe scroll anchor.

11. **Bottom content is hidden beneath persistent chrome** (`IMG_6994`, `IMG_6983`, `IMG_6849`).
    - The bottom navigation overlays Runs cards/content.
    - Error toasts overlap the composer and obscure its controls.
    - The transcript needs bottom padding equal to composer + nav + safe area + transient overlay spacing.

12. **Toasts are being used for paragraphs** (`IMG_6983`, `IMG_6911`, `IMG_6849`).
    - Error and success toasts are enormous, multi-line, and remain over primary controls.
    - They repeat transcript content instead of summarizing it.
    - Toasts should be short and bounded (1–3 lines), with details in an expandable sheet/message.

13. **Toast text clips horizontally** (`IMG_6983`).
    - The raw 409 JSON line extends beyond the red pill on both sides.
    - Missing wrapping, max-width, or inner padding containment.

14. **Pending approval/status control truncates essential meaning** (`IMG_6962`).
    - `The pending dev source edit appro...` provides no useful target/action context.
    - The adjacent ellipsis control is ambiguous and visually resembles another overflow menu.
    - It should identify the approval and expose a clear Review action.

15. **Tiny, unlabeled spinner floats near the right edge** (`IMG_6994`, `IMG_6992`, `IMG_6983`, `IMG_6962`, `IMG_6911`, `IMG_6924`).
    - It overlaps content/header space and gives no accessible meaning.
    - If it is turn progress, it should live in a stable labeled status region; if decorative, remove it.

16. **Ambiguous floating up-chevron control** (`IMG_6983`, faintly behind overflow in `IMG_6911`).
    - It has no label and inconsistent visibility/placement.
    - It may conflict with scroll-to-bottom/top semantics and overlaps other controls.

## Information architecture and legibility

17. **Internal implementation language dominates user-facing chat** (`IMG_6983`, `IMG_6849`).
    - `SESSION_TURN_ACTIVE`, `journal lease token`, `desktop:global-input`, durable turn UUIDs, and raw `sessionId` do not belong in the primary conversational layer.

18. **Tool/activity feed is too verbose and visually repetitive** (`IMG_6962`, `IMG_6924`).
    - Repeated rows such as `Read file`, `Used 1 tool`, `3 tool calls`, and planning narration consume most of the viewport.
    - Mixed labels are inconsistent: `2 tool calls 2 calls`, `Used 1 tool 1 item`, `Request Tool Category completed 1 call`.
    - Default should be a compact grouped timeline, with detailed calls collapsed.

19. **Long headings/activity labels are clipped** (`IMG_6924`).
    - `Request Tool Category completed, Memory Search ...` and `Blocked: "$id...` are ellipsized without a reliable expansion affordance.

20. **Runs output renders raw Markdown rather than formatted content** (`IMG_6994`).
    - Literal `**Ready artifact**`, backticks, and dense hash/path output appear inside the card.
    - Run summaries need Markdown rendering or a purpose-built artifact row.

21. **Run card hierarchy is overloaded** (`IMG_6994`).
    - Agent name, status pill, prose, raw artifact metadata, handoff steps, age, and duration are cramped into one card.
    - Completed artifact should be a compact attachment/file action; technical metadata should be secondary.

22. **Redundant agent naming** (`IMG_6994`).
    - Page context already says `Gaming Engineer`, while each card repeats `[Subagent] Gaming Engineer`.
    - `[Subagent]` reads like an internal prefix and should not be user-facing.

23. **Status contradiction on agent page** (`IMG_6994`).
    - Agent header says `idle` while Runs immediately presents a paused run requiring recovery.
    - If these are distinct concepts, labels should clarify `Agent idle · 1 paused run`; otherwise the state model is misleading.

24. **Navigation tabs crowd the width** (`IMG_6994`).
    - Five labels (`Overview`, `Chat`, `AGENT.md`, `Runs`, `Heartbeat`) nearly fill the viewport with uneven spacing and no overflow strategy.
    - This will fail at larger text sizes/localization.

25. **Header chrome consumes excessive vertical and horizontal space** (most chat screenshots).
    - Large menu, model pill, edit button, and overflow button dominate the first ~170 px while obscuring content.
    - Blur makes underlying text visible but unreadable, producing visual noise rather than separation.

26. **Model naming is inconsistent** (across screenshots).
    - `Model`, `5.6 Terra Medium`, `5.6 Sol Medium`, and `5.6 Luna Medium` use different levels of specificity.
    - If sessions intentionally differ, the generic `Model` label still fails to identify the active route.

27. **Voice screen lacks a stable, readable primary state** (`IMG_6901`).
    - Sources collision competes with the central voice orb.
    - `SWIPE DOWN` is low contrast and visually detached.
    - It is unclear whether the app is listening, thinking, presenting sources, or waiting for a gesture.

28. **Low-contrast secondary text** (all screenshots, especially `IMG_6901`, `IMG_6994`).
    - Muted gray labels and content approach the background too closely.
    - Source titles, timestamps, nav inactive states, and `SWIPE DOWN` may fail accessibility contrast.

29. **The interface is not robust to Dynamic Type / large text** (visible throughout).
    - Dense rows, fixed pills, five-tab strip, raw error payloads, and fixed overlays have little reflow capacity.
    - Several failures likely become worse with larger accessibility text.

## Screenshot-specific summary

### `IMG_6994.png`
- Bottom nav overlays Runs content.
- SHA/path overflows the completed-run card.
- Raw Markdown is unrendered.
- `[Subagent]` internal prefix leaks.
- Header `idle` conflicts with paused run.
- Tabs are crowded.
- Run card hierarchy is overloaded.
- Small unlabeled spinner floats on the right.

### `IMG_6992_1784392228030.png`
- Severe Markdown/newline/token-boundary destruction.
- Top transcript is hidden beneath header.
- Floating controls obscure the first lines.
- Unlabeled right-edge spinner.

### `IMG_6983.png`
- Raw 409 JSON and internal session data exposed.
- Same failure duplicated in transcript and toast.
- Toast overflows and blocks composer.
- No one-tap recovery for stale/active turn.
- Top content hidden by header.
- Ambiguous floating chevron.

### `IMG_6962.png`
- Activity blocks concatenate and leak `****` Markdown.
- Repetitive/inconsistent tool-call labels.
- Pending approval control truncates the only useful text.
- Header clips content.
- Unlabeled spinner.

### `IMG_6911.png`
- Goal can be marked done at zero turns.
- User-stopped state is rendered as green success.
- Giant verbose toast blocks transcript/composer.
- Toast repeats the full goal instead of summarizing.
- Header clips prior content.

### `IMG_6901.png`
- Sources carousel/deck is catastrophically overlapped, rotated, and off-screen.
- Source text and images are unreadable.
- Huge dead space and unclear voice state.
- Low-contrast gesture label.

### `IMG_6849.png`
- Raw durable-turn/resource-lease internals exposed.
- Same warning repeated three times plus toast.
- No recovery route.
- Error toast overlaps composer and control.
- UUID/resource text creates poor wrapping.

### `IMG_6924.png`
- Impossible context display: `425k / 272k (100%)`.
- Context popover covers active transcript/tool feed.
- Activity feed is excessively verbose and clips labels.
- Top content hidden by header.
- Unlabeled spinner.

## Consolidated priority order

### P0 — blocks trust or task completion
1. Fix stale active-turn/session/resource lease recovery and stop duplicate retry messages.
2. Never render raw internal exceptions/JSON as primary assistant output.
3. Fix mobile Markdown/message-frame coalescing and activity/final block boundaries.
4. Fix goal completion semantics so cancelled/zero-turn goals cannot look successfully completed.
5. Fix sources-card mobile layout/animation containment.

### P1 — major usability
6. Replace paragraph toasts with bounded summaries and expandable details.
7. Correct sticky-header and bottom-chrome content insets.
8. Correct context-window arithmetic/labeling.
9. Add robust wrapping/truncation/copy behavior for paths, hashes, UUIDs, and code.
10. Collapse and normalize tool activity rows.

### P2 — polish/accessibility
11. Clarify spinner, chevron, approval, and status controls.
12. Simplify agent Runs hierarchy and remove internal prefixes.
13. Add a mobile overflow strategy for agent tabs.
14. Reduce header chrome and improve contrast.
15. Test all affected views with Dynamic Type and narrow viewport widths.
