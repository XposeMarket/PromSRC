---
name: File Surgery
description: >
  Safe, exact file-editing playbook for workspace files, markdown, configs, skills, docs, and other non-source assets. Use this before any file mutation when the user asks to update a file, edit a skill, patch markdown, rewrite config, add a section, fix formatting, remove duplicated text, or inspect and surgically modify workspace content. Triggers on: update this file, edit the markdown, patch the skill, replace these lines, add a section, fix the config, clean up this file, rewrite the doc, apply a file change, or verify a file edit. This skill emphasizes native file tools, line-numbered reads, bottom-to-top edits, and immediate verification; it explicitly avoids shell scripts for file inspection/editing when Prometheus file tools exist.
emoji: "🧩"
version: 2.0.0
triggers: update file, edit file, patch file, file edit, file surgery, edit markdown, update skill, patch skill, replace lines, add section, remove section, fix config, rewrite document, verify file edit, clean up file
---

# File Surgery Playbook

Use this when Prometheus needs to inspect, modify, or verify workspace files safely.

Core loop:

**STAT → READ/SEARCH → PLAN → EDIT → VERIFY**

Skipping any step is how files get corrupted, duplicated, partially overwritten, or edited with stale assumptions.

---

## Hard Routing Rule

For workspace files, use the native file tools. Do **not** use `run_command`, PowerShell, Python, Node one-liners, `sed`, or shell redirection for file inspection or editing when file tools can do the job.

Use shell only for actual process execution, builds, tests, git operations, or a transformation the native file tools genuinely cannot perform.

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

## The Five-Step Loop

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

### Step 3: PLAN the edit

Before mutating anything, know:

- Exact file path
- Exact line range or exact text to replace
- The complete replacement content
- What should remain above and below the edit
- Whether multiple edits must be ordered bottom-to-top
- Whether a full rewrite is safer than line surgery

If editing multiple non-adjacent line ranges in one file, plan all ranges before executing any and work from the highest line number down.

### Step 4: EDIT with the safest tool

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

### Step 5: VERIFY immediately

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

If verification fails, stop and fix the real current file state. Do not continue stacking edits on broken assumptions.

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
- Verify code fences: every ``` opening has a matching closing fence.
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

- Check imports after edits
- Visually balance `{}`, `()`, `[]`, template strings, and JSX tags
- If behavior changed, run the relevant test/build with `run_command` only after file edits are done

For Prometheus product source under `src/` or `web-ui/`, do not directly edit from main chat. Use source inspection, proposal rigor, and approved source-write execution.

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
