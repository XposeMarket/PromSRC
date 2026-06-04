# Onboarding System

Last verified against `web-ui/src/onboarding/`, `web-ui/src/pages/SettingsPage.js`, `web-ui/src/app.js`, `web-ui/index.html`, `src/gateway/routes/onboarding.router.ts`, `src/gateway/onboarding/`, and `src/gateway/migration/` on: 2026-06-03

## Purpose

Prometheus onboarding is the first-run and reset-time experience that introduces the product, helps users connect a model, optionally imports older agent-app data, runs a meet-and-greet chat, and seeds long-term memory with explicit approval.

It must feel like a polished product modal flow. It must not look like raw browser-default UI, a debug panel, or an unstyled full-page overlay. Onboarding is a high-trust surface because it may ask for model setup, personal context, and memory writes.

## Source Map

Frontend onboarding modules live in `web-ui/src/onboarding/`:

- `onboarding-controller.js` orchestrates steps and exposes `window.OnboardingController.runIfNeeded(...)`.
- `tutorial-overlay.js` renders the clean tutorial modal.
- `migration-panel.js` handles optional import from Hermes, OpenClaw, LocalClaw, or custom source paths.
- `model-picker.js` handles model setup.
- `meet-panel.js` creates the onboarding meet-and-greet chat session.
- `memory-confirm.js` previews and applies memory seed writes.
- `redo-onboarding.js` implements the triple-confirm hard reset UI.

Styling lives in `web-ui/src/styles/onboarding.css` and must be linked from `web-ui/index.html`.

Backend onboarding routes live in `src/gateway/routes/onboarding.router.ts`.

State/storage helpers live in `src/gateway/onboarding/`:

- `onboarding-store.ts` tracks the per-user onboarding record and next step.
- `memory-seed.ts` plans and applies approved memory file writes.
- `model-health.ts` checks model availability.
- `redo-onboarding.ts` performs the hard reset.
- `meet-prompt.ts` provides the onboarding chat system prompt.

Migration routes and logic live separately in `src/gateway/routes/migration.router.ts` and `src/gateway/migration/migration-service.ts`.

## Step Model

`onboarding-store.nextStep(record)` determines the normal progression:

1. `tutorial`
2. `migration`
3. `model`
4. `meet`
5. `memory_confirm`
6. `done`

The controller loops through this sequence and asks the backend for fresh status after each persistent step.

Important behavior:

- Tutorial replay must not advance into the full step model.
- Dev test must not pollute user memory or unexpectedly mutate onboarding state.
- Redo onboarding is destructive and must remain gated by the triple confirmation flow.
- Migration should be optional. If no source is found, it should skip cleanly instead of trapping the user in a disabled panel.

## Settings Placement

Onboarding controls belong in `Settings -> System`, not in a separate top-level Settings tab.

The System tab should expose a compact onboarding control group:

- `Replay tutorial`: opens only the clean tutorial modal from `tutorial-overlay.js`.
- `Dev test`: deliberately runs an operator test flow with writes disabled where applicable and skips migration unless explicitly testing migration.
- `Redo onboarding...`: launches `startRedoOnboardingFlow()` from `redo-onboarding.js`.

Do not add a standalone `Onboarding` Settings tab unless the product design is intentionally changed.

## Replay vs Dev Test vs Redo

Replay tutorial:

- Purpose: let the user view the polished product tour again.
- Should call the tutorial overlay directly.
- Should not call `/api/onboarding/replay-tutorial` unless the intent is to mutate onboarding status.
- Should not fall through into migration, model setup, meet-and-greet, or memory seed.

Dev test:

- Purpose: let the operator inspect the onboarding flow without damaging the user's real workspace.
- Uses `OnboardingController.runIfNeeded({ devTest: true, skipMigration: true })`.
- Memory confirm must use `devTest` mode so no memory is written.
- Migration is skipped by default because it is a separate import-management surface and can look alarming when no sources exist.

Redo onboarding:

- Purpose: intentionally wipe user onboarding-owned state and restart from the beginning.
- Must use `startRedoOnboardingFlow()`.
- Must retain the triple gate: explanation, exact phrase, countdown.
- Must clearly list what is deleted vs kept.

## Migration Boundary

Migration is a real feature, but it is not the same as the tutorial.

Migration can scan for:

- Hermes
- OpenClaw
- LocalClaw
- Custom source path, via the Settings migration panel

The polished management surface for migration is the Settings migration panel in `SettingsPage.js`, backed by `/api/migration/*`.

The onboarding migration step should remain optional and defensive:

- If no automatic sources are found, mark migration complete as skipped and continue.
- If sources are found, preview before import.
- Never import without explicit user action.
- Never present disabled buttons as a dead-end.

## Styling Contract

Onboarding UI must render as modal UI:

- `#prom-onboarding-root` is the fixed overlay.
- `.prom-onb-card` is the centered modal card.
- `.prom-onb-header`, `.prom-onb-body`, and `.prom-onb-footer` define the modal structure.
- `onboarding.css` must be linked in both source and generated/public UI.

The overlay must not appear as:

- Raw default `h2` text over the app.
- A full-height unstyled panel.
- A separate app surface beside the chat.
- A disabled import screen with no clear way forward.

After frontend edits, run:

```powershell
npm run sync:web-ui
npm run build:web
node --check web-ui/src/pages/SettingsPage.js
node --check web-ui/src/onboarding/onboarding-controller.js
```

Use browser/UI smoke testing when the browser connector is working.

## Sharp Edge From 2026-06-03

Do not unconditionally call `OnboardingController.runIfNeeded()` from `web-ui/src/app.js`.

That caused a user whose saved onboarding state was at `migration` to get a raw-looking migration overlay immediately on reload. It felt like a broken panel hijacking the app.

Correct behavior:

- App boot should not ambush existing users with onboarding.
- Manual replay should be tutorial-only.
- Dev test should be deliberate from `Settings -> System`.
- Full redo should be deliberate through the triple-confirm reset.

## Current Manual Entry Points

`Settings -> System` owns the visible controls:

- `replayOnboardingTutorial()`
- `runOnboardingDevTest()`
- `redoOnboardingFromSettings()`

`app.js` may expose a manual helper such as `window.runPrometheusOnboarding`, but it should not auto-run it on boot.

## Generated UI Sync

Public/generated UI mirrors the source UI:

- `web-ui/index.html` -> `generated/public-web-ui/index.html`
- `web-ui/src/...` -> `generated/public-web-ui/static/...`
- `web-ui/src/styles/...` -> `generated/public-web-ui/static/styles/...`

Any source edit under `web-ui/` that should ship must be followed by `npm run sync:web-ui`.
