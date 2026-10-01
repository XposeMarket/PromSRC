---
name: "release-deployment-ops"
description: "Prepare, execute, and verify a software release across a hosting environment with preflight checks, environment separation, migration safety, rollback planning, deployment evidence, and post-release smoke tests. Use for deployment and release operations, not for ordinary local builds."
---

# Release Deployment Ops

Use when a project is being released to a hosting environment or a release process needs to be designed or audited. Keep preview, staging, and production distinct and treat deployment as a change with a recovery path.

## 1. Identify the release

Resolve the repository, commit or artifact, target environment, service shape, runtime, domains, required dependencies, migrations, secrets, and owner. Confirm the intended destination and whether the request is dry-run, preview, staging, or production. Do not guess the target.

## 2. Preflight

Inspect the real build and deployment configuration. Run applicable typecheck, tests, lint, build, artifact/package checks, environment-variable validation without printing values, dependency and migration checks, and configuration validation. Confirm the artifact is tied to an immutable commit or digest. Identify health endpoints, smoke checks, rollback target, and possible downtime.

## 3. Plan side effects

List the exact commands, files, remote actions, data migrations, DNS or domain changes, and approval points. Treat production deploy, schema migration, permission changes, destructive cleanup, and traffic switching as separate high-impact actions. Never improvise provider-specific commands from memory; use current project documentation or official platform documentation.

## 4. Deploy safely

Prefer an atomic or preview path. Back up or validate recoverability before irreversible migrations. Keep logs sanitized. Do not place secrets in skill files, build output, command history, or reports. Stop when authentication, environment, or rollback conditions are not satisfied.

## 5. Verify and recover

Run post-deploy health, representative user-flow, asset, API, log, and error checks. Confirm the deployed revision and environment. If verification fails, stop traffic escalation and use the documented rollback path rather than hiding the failure. Report exact evidence, what was not verified, and whether the release is complete, partially deployed, or rolled back.
