## 6) Creative Modes

Creative mode is persisted per session in `session.ts` and is surfaced to the desktop/mobile UI.
Current supported values are:

- `design`
- `image`
- `canvas` (legacy image/canvas alias)
- `video`

Mode lifecycle:

- enter/switch with `enter_creative_mode` / `switch_creative_mode`
- exit with `exit_creative_mode`
- inspect with `get_creative_mode`
- persist on the session as `creativeMode`
- broadcast mode changes to the UI

### What each mode owns

**Design**

- live HTML/app/project preview editing
- same-origin DOM inspection/selection when the preview supports it
- design annotations and edit/chat/select interaction over the preview
- does **not** mount the dedicated video editor

**Image**

- generated/reference image workflows plus the structured Creative scene graph
- image/canvas scene operations, editable visual elements, assets, and export
- keeps the native image/canvas surface; it does **not** mount the dedicated video editor

**Canvas**

- legacy compatibility value for the image/canvas lane
- new user-facing work should prefer `image` unless a caller explicitly depends on the legacy value

**Video**

- mounts the dedicated Creative video editor (`web-ui/src/components/creative/editor/`)
- supports scene-graph motion editing, assets, text/shapes/effects/filters, subtitles, preview, history, export, and timeline controls
- multi-clip sequencing is owned by the Creative composition contract in `src/gateway/creative/composition.ts` and its renderer, rather than by image/canvas scene operations

### Runtime boundary

Do not describe the current implementation as selecting named `creative_design`, `creative_image`, `creative_canvas`, or `creative_video` prompt profiles. Those names are legacy documentation and are not part of the current `BuildPersonalityContextOptions` contract in `src/gateway/prompt-context.ts`.

Likewise, do not rely on the old claim that `src/gateway/routes/chat.router.ts` owns an isolated Creative Runtime: that route file is now an empty compatibility shell after the runtime refactor. Current Creative behavior is distributed across persisted session mode state, Creative tool definitions/skills, the active gateway capability executors, and the mode-specific UI/editor surfaces.

When auditing Creative behavior, verify the current execution owner instead of assuming an old `chat.router.ts` or named prompt-profile path still exists.
