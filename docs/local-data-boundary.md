# Prometheus local-data boundary

PromSRC is application source. User/runtime state is machine-local and must not be versioned with the application checkout.

## Must remain local

The following are user/runtime state and must never be committed to PromSRC:

- workspace files and project working data
- chat/session records and transcripts
- tool observations, tool-result dumps, and audit materializations
- memories, facts, self-learning state, Brain/Thought/Dream output
- tasks, schedules, cron runs, proposals, team/subagent state
- uploads, downloads, generated images/video/audio, temporary files
- connection state, credentials, tokens, vault contents, logs, diagnostics
- local clones and external project repositories

## Source-controlled material

Application source code, tests, deterministic fixtures, schemas, migrations, documentation, build configuration, and intentionally checked-in static assets belong in Git.

Fixtures must be synthetic and must not be copied from live user data.

## Safe migration rule

Changing `.gitignore` is not sufficient for paths that Git already tracks. Removing a tracked path in a commit causes a normal `git pull` to remove the corresponding clean file from an existing checkout.

For that reason workspace cleanup is deliberately two-stage:

1. Run `node scripts/migrate-local-data-out-of-repo.mjs` from the existing checkout. It copies project-local `.prometheus` state to `~/.prometheus`, copies the checkout workspace to `~/workspace`, writes the workspace path into the migrated config, and keeps a full timestamped backup under `~/.prometheus-migration-backups/`.
2. Restart Prometheus and verify chats, workspace files, memories, projects, and settings are present from the home-scoped data directories.
3. Only then merge/pull the follow-up commit that removes already-tracked `workspace/` content from Git.

Do not combine steps 1 and 3 into a single first-time pull for an existing checkout.

## Pull/update invariant

After migration, Git updates operate only on the source checkout. Persistent Prometheus state lives outside the repository, so checkout resets, branch switches, pulls, source reinstalls, and source cleanup cannot delete chats or workspace data.
