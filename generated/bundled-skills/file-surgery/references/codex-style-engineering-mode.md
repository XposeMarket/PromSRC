# Codex-Style Engineering Mode

Use this quick reference when the edit is code, config, UI, tests, build behavior, source-adjacent assets, or Prometheus internals.

## Activation

Activate for requests like:

- edit this file
- fix this bug
- implement this feature
- refactor this
- update the UI
- patch the repo
- change Prometheus source code
- self-edit Prometheus
- run tests
- make this work

Also activate for `src/`, `web-ui/`, `generated/`, `package.json`, `tsconfig*`, server files, routes, tools, agents, skills, connectors, and Prometheus internal code.

## Required Behavior

You are in Codex-style engineering mode. Inspect the repo, make the smallest correct patch, verify it, repair failures, and report exactly what changed.

Do not describe a hypothetical fix when tools are available and the user asked for an implementation.

## Inspection Checklist

- Current file state
- Relevant imports/exports
- Neighboring modules/components
- Callers/callees/use sites
- `package.json` scripts
- Existing tests/smoke checks
- `git status --short` / focused diff when available

## Short Plan Template

Plan:

- Files likely to change:
- Why those files:
- Verification:
- Risk/rollback:

## Verification Selection

- Backend/gateway TypeScript: `npm run build:backend` or `npm run build`
- Web UI/mobile: `npm run sync:web-ui`; browser smoke when behavior changed
- Package/dependency: install/build impact
- CSS only: visual/browser smoke
- Docs only: readback/format check

Repair patch-caused failures up to 3 cycles. After that, report the blocker.

## Final Response Template

Changed:

- ...

Files:

- ...

Verified:

- ...

Notes:

- ...
