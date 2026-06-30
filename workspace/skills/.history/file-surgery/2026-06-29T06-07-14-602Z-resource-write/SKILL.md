---
name: File Surgery
description: >
  Codex-style file editing and cautious engineering playbook for workspace files, markdown, configs, skills, docs, scripts, UI files, and source-adjacent assets. Use this before any file mutation when the user asks to edit this file, fix this bug, implement a feature, refactor, update UI, patch the repo, change Prometheus source code, self-edit Prometheus, run tests, make this work, update a skill, rewrite config, add/remove sections, inspect code before editing, or verify a file edit. This skill forces repo-grounded inspection, short planning, smallest correct patches, verification, repair loops, git hygiene, and honest reporting.
emoji: "🧩"
version: 3.0.0
triggers: update file, edit file, patch file, file edit, file surgery, edit markdown, update skill, patch skill, replace lines, add section, remove section, fix config, rewrite document, verify file edit, clean up file, careful code edit, inspect before editing, verify build, edit this file, fix this bug, implement this feature, refactor this, update the UI, patch the repo, change Prometheus source code, self-edit Prometheus, run tests, make this work, src, web-ui, generated, package.json, tsconfig, server files, routes, tools, agents, skills, connectors, Prometheus internal code
---

# File Surgery Playbook

Use this when Prometheus needs to inspect, modify, or verify workspace files safely.

When the request is about code, UI, repo behavior, tests, builds, Prometheus internals, or anything under `src/`, `web-ui/`, `generated/`, `package.json`, `tsconfig*`, routes, tools, agents, skills, or connectors, treat it as an engineering task, not a chat task.

## Codex-Style Engineering Mode

You are in Codex-style engineering mode.

Your job is not to describe how to change the code. Your job is to inspect the repo, make the smallest correct patch, verify it, repair failures, and report exactly what changed. Do not guess the codebase structure. Read files first. Do not introduce new frameworks, build steps, dependencies, or architecture unless explicitly requested. Preserve existing behavior unless the user asked to change it.

Non-negotiables:

- Read before editing.
- Trust repo files over memory, user descriptions, and previous plans.
- Never invent paths, scripts, APIs, or architecture.
- Make minimal patches and preserve unrelated behavior.
- Do not reformat unrelated files.
- Run relevant verification after meaningful edits.
- Repair patch-caused failures.
- Never claim success without evidence.
- Never commit or push unless the user explicitly asks.

Source of truth rule:

- The current repo/files are the source of truth.
- User descriptions are intent, not implementation truth.
- If memory conflicts with files, trust files.
- If a previous plan conflicts with files, trust files.
- In EDIT mode, base changes strictly on the latest provided project files and keep everything else 1:1 identical.

Core loop:

**STAT → READ/SEARCH → RISK CHECK → PLAN → EDIT → VERIFY → REPORT**

Skipping any step is how files get corrupted, duplicated, partially overwritten, edited with stale assumptions, or changed without enough proof that the patch is correct.

---

## Hard Routing Rule

For workspace files, use the native file tools. Do **not** use `run_command`, PowerShell, Python, Node one-liners, `sed`, or shell redirection for file inspection or editing when file tools can do the job.

Use shell only for actual process execution, builds, tests, git operations, or a transformation the native file tools genuinely cannot perform.

---

## Coding Ops Addendum

When the file change affects code, scripts, routes, prompts, generated artifacts, or behavior-bearing config, add these constraints to the core loop:

- Before editing, inspect the smallest sufficient set of files to understand the existing pattern. Prefer reading nearby files over inventing structure. If the target file is large, locate relevant functions/classes first, then read focused ranges.
- Inspect relevant imports/exports, callers/callees, package scripts, neighboring modules/components, current git status/diff when available, and existing tests/smoke scripts.
- Produce a short plan before patching: files likely to change, why those files, verification commands, and risky/rollback areas. Keep it to 3-5 bullets for small tasks.
- Understand the current flow before changing it. Read the caller, callee, nearby types/contracts, and at least one representative use site.
- Preserve user work. Check current file state and, when available, git status/diff before touching files that may already be modified.
- Prefer the smallest behaviorally complete patch. Avoid drive-by refactors, formatting churn, dependency swaps, and broad rewrites unless they are necessary to solve the requested problem.
- Match local patterns. Use existing helpers, naming, error handling, logging style, validation conventions, and test structure.
- Keep generated and source copies in sync only when this repo's structure clearly expects both. If unsure, inspect build/copy scripts before editing both.
- Verify at the right level: syntax/parse checks for data files, targeted unit checks for isolated logic, build/typecheck for TypeScript changes, and runtime/browser checks for UI behavior.
- Report any verification you could not run and why. Do not imply safety that was not actually checked.

Escalate or pause before editing when the requested change is ambiguous, touches secrets/auth/payment/destructive data paths, requires deleting user work, or would change broad architecture without an explicit request.

### Prometheus Repo Facts to Preserve

- Prometheus web UI is currently a static vanilla JS app, not React.
- Do not introduce React, JSX, Tailwind, Next routing, or a new build step unless Raul explicitly requests it.
- Prefer vanilla JS ES modules for current `web-ui` work.
- Desktop page switching uses `setMode()` in `web-ui/src/app.js`.
- Static assets are served through Express routes in `src/gateway/core/app.ts`.
- For `web-ui/src/**` or mobile edits, edit source first and run `npm run sync:web-ui`; do not hand-edit `generated/public-web-ui/**` except for emergency verification.
- For backend/gateway `src/**`, run `npm run build:backend` or `npm run build` before expecting the running gateway to see changes.
- In dev/server mode after source, web UI, or mobile edits, prefer `prom_apply_dev_changes` with accurate `changed_surfaces` when that tool is available; it handles sync/build/restart/reload consistently.

### Dependency and Architecture Discipline

- Do not add dependencies unless required.
- Before adding a dependency, check whether an existing dependency already solves it, explain why it is needed, update package files consistently, and verify install/build impact.
- No new frontend framework, React/Tailwind/JSX, build pipeline, or CDN dependency unless explicitly approved.
- Do not migrate architecture unless the task is explicitly a migration.
- Do not replace the existing app shell, routing, state model, or styling system.
- Fit the requested feature into the existing architecture.

### Risk Routing

- Small edit: <=80 changed lines, <=2 files, non-critical UI/text behavior. Patch directly, then verify.
- Medium edit: 3-6 files or an architectural touchpoint. Patch, verify, and ask for or run secondary review before final when available.
- Large/risky edit: core runtime, tool execution, scheduler, memory, auth, filesystem, shell commands, browser/desktop control, credentials, or self-modifying Prometheus internals. Create a plan first, inspect related tests/logging/audit paths, get secondary critique when available, patch, verify, then final review.

When editing Prometheus itself:

- Do not modify safety, approval, filesystem, shell, browser, or credential-handling code without explicit user intent.
- Never weaken approval gates.
- Never broaden filesystem access silently.
- Never store secrets in source files.
- Never log credentials, tokens, cookies, OAuth codes, or API keys.
- Never remove audit logging unless explicitly requested and reviewed.

---

## Tool Map

| Job | Use |
|---|---|
| Check size/line count before reading | `file_stats(filename)` |
| Read exact line-numbered content | `read_file(filename, start_line?, num_lines?)` |
| Find text in one file | `grep_file(filename, pattern, context_lines?)` |
| Search across files | `search_files(directory, pattern, file_glob?, context_lines?)` |
| Replace exact known text | `find_replace(filename, find, replace, replace_all?)` |
| Replace a known line range | `replace_lines(filename, start_line, end_line, new_content)` |
| Insert content after a line | `insert_after(filename, after_line, content)` |
| Delete a known line range | `delete_lines(filename, start_line, end_line)` |
| Create a brand-new file | `create_file(filename, content)` |
| Full rewrite / create-or-overwrite | `write_file(filename, content)` |
| Rename or move | `rename_file(old_path, new_path)` |
| Make directories | `mkdir(path)` |
| List directories | `list_directory(path, max_depth?, max_entries?)` |

For `src/`, `web-ui/`, or Prometheus root source surfaces, follow the source/proposal route instead of casual workspace edits. Never directly mutate `src/` from main chat unless running inside an approved proposal/code-execution context with the source-write tools.

---

## The Seven-Step Loop

### Step 1: STAT

Unknown file? Get metadata first.

```json
file_stats({ "filename": "skills/example/SKILL.md" })
```

Use this to learn whether the file fits in one read or needs windowed reads.

### Step 2: READ or SEARCH

Always inspect the real current content before editing.

```json
read_file({ "filename": "skills/example/SKILL.md" })
```

For targeted changes, search first:

```json
grep_file({ "filename": "skills/example/SKILL.md", "pattern": "version:", "context_lines": 3 })
```

For unknown locations:

```json
search_files({ "directory": "skills", "pattern": "old phrase", "file_glob": "*.md", "context_lines": 2 })
```

**Never edit from memory or from a prior conversation. Re-read if there is any doubt.**

### Step 3: RISK CHECK

Before planning the mutation, classify the edit:

- Low risk: docs wording, unique text replacement, isolated markdown section.
- Medium risk: JSON/YAML/config, scripts, generated assets, duplicated source/workspace copies.
- High risk: `src/`, `web-ui/`, auth/secrets, migrations, scheduling, persistence, external APIs, or anything that can delete/overwrite data.

For medium/high-risk changes, inspect related files and decide the minimum viable verification before editing. If the edit is high-risk and the user request is vague, ask one concise clarifying question or state the conservative assumption before proceeding.

If the patch touches more than 3 files, more than 150 lines, core agent/tool execution code, auth/security/payment/connectors, shell/filesystem/browser/desktop permissions, memory/scheduler, or self-modifying Prometheus internals, trigger secondary review before finalizing when available.

### Step 4: PLAN the edit

Before mutating anything, know:

- Exact file path
- Exact line range or exact text to replace
- The complete replacement content
- What should remain above and below the edit
- Current behavior and the local convention you are preserving
- Expected behavior after the patch
- Verification command or manual check to run afterward
- Whether multiple edits must be ordered bottom-to-top
- Whether a full rewrite is safer than line surgery

For code tasks, share a concise implementation plan before editing:

- Files likely to change
- Why those files
- Verification command(s)
- Rollback/risky areas

If editing multiple non-adjacent line ranges in one file, plan all ranges before executing any and work from the highest line number down.

### Step 5: EDIT with the safest tool

Prefer the smallest safe edit.

#### Exact phrase replacement

Use when the old text is unique and known exactly.

```json
find_replace({
  "filename": "skills/example/SKILL.md",
  "find": "old exact text",
  "replace": "new exact text",
  "replace_all": false
})
```

#### Line-range replacement

Use when text is not unique, or when replacing a section/block.

```json
replace_lines({
  "filename": "skills/example/SKILL.md",
  "start_line": 20,
  "end_line": 34,
  "new_content": "replacement block"
})
```

#### Insert after a line

Use for adding a new section without disturbing existing content.

```json
insert_after({
  "filename": "skills/example/SKILL.md",
  "after_line": 88,
  "content": "\n## New Section\n\nContent here."
})
```

#### Delete a range

Use only after reading the exact lines to remove.

```json
delete_lines({
  "filename": "skills/example/SKILL.md",
  "start_line": 42,
  "end_line": 49
})
```

#### Full rewrite

Use sparingly, but confidently when the whole file is small, structurally outdated, or easier to replace safely than patch section-by-section.

```json
write_file({
  "filename": "skills/example/SKILL.md",
  "content": "complete file content"
})
```

Do not use `create_file` for an existing file. Use `write_file` only when overwriting is intentional.

### Step 6: VERIFY immediately

After every mutation, re-read the changed file or exact changed window.

```json
read_file({ "filename": "skills/example/SKILL.md", "start_line": 1, "num_lines": 120 })
```

Confirm:

- The intended change exists
- Adjacent content is intact
- No accidental duplicates
- No missing headers, frontmatter, braces, or code fences
- Formatting and indentation survived
- Version/changelog/metadata were updated if this is a skill or doc upgrade
- Behavior-bearing edits passed the smallest relevant automated or manual check available

For code changes, inspect `package.json` scripts before choosing verification. Select checks by changed files:

- TypeScript/source runtime change: run typecheck/build, usually `npm run build:backend` or `npm run build`.
- Frontend module change: run syntax/import sanity checks, `npm run sync:web-ui` when relevant, and a browser smoke test when possible.
- Package/dependency change: verify install/build impact.
- CSS-only change: browser smoke and visual check.
- Tool/scheduler/memory/security change: targeted unit/integration tests if available plus build.
- Docs-only change: no build required unless docs generation exists.

For Prometheus UI changes, prefer:

1. Start or use the local dev server/gateway when available.
2. Open the affected page.
3. Check visible rendering.
4. Check browser console errors.
5. Exercise the changed interaction.
6. Screenshot when useful.

If verification fails, stop and fix the real current file state. Do not continue stacking edits on broken assumptions.

Repair loop:

1. Read the full relevant error.
2. Identify whether the failure is patch-caused or pre-existing.
3. Fix patch-caused failures.
4. Rerun verification.
5. Repeat up to 3 automatic repair cycles.

After 3 failed repair attempts, stop and report the command, failing error, suspected cause, files changed, and next recommended patch.

### Step 7: REPORT

Final response must include:

- What changed
- Files modified
- Verification run
- Any remaining issues
- Follow-up recommendation, if relevant

If tests/builds were skipped, say exactly why. If there are many unrelated existing git changes, mention only that the workspace was already dirty and your edit was scoped to the requested file(s). Say "implemented, not verified" or "partially implemented" when that is the truth.

---

## Edit Tool Decision Table

| Situation | Best tool | Why |
|---|---|---|
| One unique phrase must change | `find_replace` | Smallest safe mutation |
| Same phrase appears multiple times but only one should change | `replace_lines` | Avoids replacing the wrong instance |
| Whole section needs replacement | `replace_lines` | Clear boundary by line number |
| Need to add content after a known heading/block | `insert_after` | Preserves existing content |
| Need to remove duplicated/stale block | `delete_lines` | Exact deletion boundary |
| File is tiny and mostly outdated | `write_file` | Less brittle than many surgical edits |
| New file does not exist | `create_file` | Prevents accidental overwrite |
| Move/rename file | `rename_file` | Preserves content and creates parents |
| JSON/config has structural risk | `write_file` | Reconstruct valid whole file |

---

## Multi-Section Edits

When editing multiple sections of the same file:

1. `file_stats`
2. Read the relevant full file or windows
3. Identify all sections to change
4. Sort by line number, **highest first**
5. Apply line-based edits from bottom to top
6. Re-read the file or changed windows at the end

Why bottom-to-top: editing line 90 does not affect line 30. Editing line 30 first shifts everything below it.

If using `find_replace` with exact unique text, bottom-to-top is less important, but still verify every replacement.

---

## Markdown and Skill Files

For `.md` and `SKILL.md` files:

- Preserve YAML frontmatter exactly: opening `---`, closing `---`, valid keys, no tabs.
- If upgrading a skill, bump `version` and improve `description`/`triggers` if they are weak.
- Keep skill bodies under ~400 lines unless the topic truly needs more.
- Verify code fences: every fenced code block opening has a matching closing fence.
- Check headings, lists, and tables after editing.
- Prefer full rewrite for small, old skills when the structure is broadly outdated.

Skill upgrade checklist:

- [ ] Read current `SKILL.md` fully
- [ ] Identify what is outdated or missing
- [ ] Bump version appropriately
- [ ] Update frontmatter trigger quality if needed
- [ ] Edit with native file tools
- [ ] Verify with `read_file`
- [ ] Optionally `skill_read(id)` after editing to confirm the skill loads cleanly

---

## JSON, YAML, and Config Files

### JSON

JSON is structure-sensitive. Prefer full-file reconstruction with `write_file` unless the change is a tiny, exact, risk-free value replacement.

After editing JSON, verify:

- Braces/brackets balance
- Commas are valid
- Strings remain quoted
- No comments were introduced into strict JSON

### YAML

YAML indentation is structure. Use `replace_lines` for known blocks and verify surrounding indentation carefully.

### Env/secrets/configs

If a file contains secrets, tokens, API keys, credentials, or auth material, load/use the secret-and-token skill before editing. Never paste secrets into chat unless the user explicitly asks and it is safe.

---

## TypeScript / JavaScript Files

For ordinary workspace scripts, use this skill plus extra verification:

- Never claim a file exists unless you have listed or read it.
- Never edit a path from memory without checking it exists first.
- If the user mentions a file name that does not exist, search the repo before creating a new one.
- Prefer following existing naming/location conventions.
- Read related imports, exported types, call sites, and existing tests before editing.
- Check imports after edits and remove unused imports only when they are yours or clearly made obsolete by the patch.
- Visually balance `{}`, `()`, `[]`, template strings, and JSX tags.
- Preserve error handling and async/concurrency semantics unless the request is specifically to change them.
- If behavior changed, run the relevant test/build with `run_command` only after file edits are done.
- If no targeted test exists, run the narrowest available static check or explain the manual verification performed.

For Prometheus product source under `src/` or `web-ui/`, use source inspection, src-edit proposal rigor, and either approved proposal execution or the dev-only `request_dev_source_edit` fast approval flow. Approval unlocks only scoped source-write tools for the approved chat/session; it does not remove the requirement to inspect, patch minimally, sync/build, verify, and report.

If creating a new module:

- Keep it focused.
- Export clear functions.
- Follow existing style.
- Avoid global side effects.
- Add cleanup/destroy methods if it mounts UI or listeners.

For Creative Editor work:

- Modules should expose `createX`/`destroyX` patterns.
- Mounts should be reversible.
- Event listeners should be cleaned up.
- State should mutate through approved `sceneGraph` operations only; use `applySceneGraphOps` when repo inspection confirms it is the current pathway.

---

## Common Failure Patterns

| Bad pattern | Why it fails | Correct pattern |
|---|---|---|
| Using `run_command` to read or edit files | Bypasses safer native tools and creates quoting/encoding risk | Use `file_stats`, `read_file`, `grep_file`, `search_files`, then file mutation tools |
| Editing without reading first | Wrong line numbers, stale assumptions | Always inspect current file state first |
| Editing from memory after a long chat | File may have changed | Re-read the exact file/window |
| Replacing a non-unique phrase | Changes the wrong occurrence | Use `replace_lines` with verified line numbers |
| Multiple line edits top-to-bottom | Earlier edit shifts later line numbers | Edit bottom-to-top |
| Full rewrite for a one-line change | Higher risk of losing content | Use `find_replace` or `replace_lines` |
| Tiny line edit for a structurally broken file | Can leave hidden corruption | Use a careful full rewrite |
| Skipping verification | Silent corruption survives | Re-read immediately |
| Editing source files outside proposal flow | Can bypass review/build discipline | Use source/proposal route |
| Changing code without reading callers | Fix works locally but breaks integration | Read caller/callee/use sites first |
| Refactoring while fixing a bug | Enlarges blast radius and hides the real change | Make the requested fix, then suggest follow-up refactor separately |
| Updating one copy of a mirrored skill or asset | Runtime uses the stale copy | Inspect sync/build conventions and update expected mirrors together |
| Claiming tests passed when they were not run | Gives false confidence | State exactly what ran and what did not |
| Adding React/Tailwind/Next to current Prometheus web UI | Architecture drift | Use vanilla JS ES modules unless explicitly requested |
| Hand-editing generated web/mobile files as the source of truth | Changes are overwritten by sync | Edit `web-ui/src/**`, then run `npm run sync:web-ui` |
| Continuing after 3 failed repairs | Infinite churn hides the blocker | Stop and report command/error/cause/changed files/next patch |

---

## Recovery Protocol

If an edit goes wrong:

1. Stop making new changes.
2. `read_file` the affected area or full file.
3. Identify exactly what is missing, duplicated, or malformed.
4. Use the smallest corrective edit that restores structure.
5. Re-read and verify.
6. If available, use git only for inspection/recovery commands after understanding the file state; do not blindly overwrite user work.

---

## Golden Rule

**If you are not 100% certain what is currently in the file, read it again.**

Reading is cheap. Corrupting a file costs a debugging session.
