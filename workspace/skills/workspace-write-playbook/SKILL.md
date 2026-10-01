---
name: "workspace-write-playbook"
description: "Choose safe Prometheus workspace read, edit, command, git, and recovery tools. Use for multi-step workspace operations; not for a single targeted file edit (file-surgery)."
---

# Workspace Write Playbook

Use this playbook for user-project files, generated artifacts, commands, tests, and Git state. Keep ordinary file editing inside workspace-native tools; use shell only for bounded commands that the native tools cannot express.

## Inspect before changing

1. Confirm the real workspace/repository root and target paths.
2. Read/search the relevant files and inspect symbols or references before editing.
3. Inspect Git status and existing diffs; do not overwrite unrelated user work.
4. For multi-file, destructive, or uncertain work, create a safety snapshot or operation plan and preview the patch before applying it.
5. Identify the acceptance check: targeted test, lint, typecheck, build, runtime smoke test, artifact existence, or Git diff.

## Edit safely

Prefer exact workspace edit operations with a narrow file scope. Preserve encoding, line endings, surrounding behavior, and unrelated changes. Do not use PowerShell, Python, or ad-hoc scripts as the default editor when an exact edit tool can express the change. For generated files, keep the source-of-truth and generated output relationship explicit.

## Commands and processes

Use PowerShell syntax on Windows. Run bounded commands with a timeout and no-output timeout. Start a supervised process only when it must outlive one command, then inspect status/logs and stop only processes Prometheus started when safe. Never hide command output or silently broaden a path.

## Verify every mutation

After editing, inspect the post-edit context and diff. Run the smallest relevant checks, then broader build/typecheck checks when the project contract requires them. Scan secrets and unexpectedly large files when producing or importing artifacts. For web projects, use the local browser verification workflow against the actual rendered artifact. For Git, report branch/status/diff independently; never imply commit or push occurred without proof.

## Recovery

- stale or mismatched file context: reread and reapply a smaller exact edit;
- patch conflict or malformed replacement: restore the snapshot or revert only the attempted change, then preview again;
- command timeout: inspect whether a process is still running before retrying;
- test failure: preserve the diff, classify the failure, fix or report it rather than hiding it;
- path/permission block: stop and report the exact allowed-path or approval gate;
- failed generated artifact: keep logs and partial outputs, then retry the smallest deterministic step.

Do not delete, commit, push, or make a source edit on behalf of a different project without the applicable approval. Completion means the intended diff exists and the promised verification passes or is explicitly reported as not verified.
