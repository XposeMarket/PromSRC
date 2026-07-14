# Verification Playbook

## Pick the Run Path

Inspect `package.json` and run only scripts that exist.

Common checks:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

If the project is static HTML, open the file directly or serve it with the repo's existing static server if one exists.

## Start the App

Use the repo's normal dev command. If a port is occupied, use the framework's port override rather than killing unrelated processes.

Examples:

```powershell
npm run dev
npm run dev -- --host 127.0.0.1 --port 5174
npm start
```

Keep the server running until visual QA is complete.

## Browser QA

Check at least two viewports:

- desktop: 1366x768 or 1440x900
- mobile: 390x844 or 375x812

Inspect:

- first viewport shows the actual requested experience
- primary action works
- navigation/view switching works
- filters/search/forms update visible state
- hover/focus/selected/disabled states are present when relevant
- no console errors tied to the work
- no horizontal scroll unless intentionally designed
- no overlapping or clipped text
- no broken images, missing icons, or blank canvas
- mobile layout remains usable without microscopic controls

## Canvas and 3D Checks

For canvas/WebGL/Three.js:

- verify the canvas has nontransparent/nonblank pixels
- verify resize keeps the subject framed
- verify interaction or animation changes visible pixels
- verify assets load before declaring success

## Static Audit Script

Run:

```powershell
py scripts/frontend_static_audit.py path\to\app
```

Or from the skill folder:

```powershell
py workspace\skills\codex-frontend-engineer\scripts\frontend_static_audit.py src
```

Treat warnings as prompts for review, not automatic failures.

## Final Report

Keep it concise:

- what changed
- files touched
- verification commands/browser checks
- known gaps if any

Do not claim browser verification if only static checks were run.
