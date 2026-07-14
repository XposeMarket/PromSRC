# Dev Source Fast Approval Flow

Use this note when Raul wants Prometheus to edit Prometheus source now from the dev build.

## When To Use

Use `request_dev_source_edit` for small, scoped, dev-only source edits where:

- Raul asked for implementation, not only a plan.
- The file list is known or can be discovered by repo inspection.
- The change can be verified in the current turn.
- The change does not silently weaken safety, approval, shell/filesystem/browser/desktop, credential, auth, or audit behavior.

Prefer a full source proposal when the change is broad, risky, architectural, security-sensitive, or needs secondary review before patching.

## Required Sequence

1. Inspect repo/files first.
2. Check dirty state when available.
3. Create a short plan.
4. Request `request_dev_source_edit` with the narrowest file list and verification command.
5. After approval, patch only approved files.
6. Reread changed areas.
7. Run verification.
8. For `web-ui/src/**` or mobile, run `npm run sync:web-ui`.
9. For backend/gateway, run `npm run build:backend` or `npm run build`.
10. Prefer `prom_apply_dev_changes` with accurate `changed_surfaces` when available.
11. Verify live UI/endpoint behavior when relevant.

Approval unlocks source-write tools for the session/scope. It does not unlock broad editing, skipping verification, or weakening safety gates.

## Surface Mapping

- `web-ui/src/**`: `changed_surfaces: ["web-ui"]`
- `web-ui/src/mobile/**`: `changed_surfaces: ["mobile"]`
- `src/gateway/**`: `changed_surfaces: ["backend", "gateway"]`
- `src/**` non-gateway runtime: `changed_surfaces: ["backend"]` or `["src"]`
- mixed UI + backend: include all relevant surfaces

## Final Report

Changed:

- ...

Files:

- ...

Verified:

- ...

Live reload/restart:

- ...

Notes:

- ...
