# Prometheus public release — pointer

Migrated from **MEMORY.md** `key_decisions` (2026-05-05) on 2026-07-07. Do not duplicate the full runbook in MEMORY.

## Canonical runbooks

- **workspace/self/18-public-release.md** — owner-approved flow: scope review, `check:web-ui`, `build`, `build:public`, smoke-test unpacked app, explicit staging, commit/push, publish, verify `releases/latest` and PromSite download routing.
- **git-workflow** skill — `notes/github-cli-full-access-setup-2026-05-16.md` for `gh` auth and token hygiene (never paste tokens into chat or memory files).

## One-line decision (keep in MEMORY if needed)

Public downloads resolve via `https://api.github.com/repos/XposeMarket/prometheus-releases/releases/latest` → newest `.exe`. Shipping a new public build means publishing a newer release in **XposeMarket/prometheus-releases**, not only bumping PromSRC on `main`.

## Token hygiene

- Set `$env:GH_TOKEN` only for the publish session; remove after use.
- Token needs write access to **prometheus-releases**; revoke if exposed.
- Prefer **self/18** manual GitHub API asset upload if `electron-builder` publish hangs or `win-unpacked` is incomplete.

## Dev repo push helpers

Use gateway tools **prom_repo_push**, **prom_repo_pull**, **prom_repo_sync** for PromSRC sync (separate from public installer publish).