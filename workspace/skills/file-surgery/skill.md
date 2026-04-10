---
name: File Surgery
description: Precise, safe patterns for reading, editing, and verifying files without corruption. Use whenever editing any existing file — source code, markdown, JSON, config, or any text file. Triggers on: edit file, update file, modify file, change file, fix file, patch file, replace text, insert line, delete line, refactor, update config.
emoji: "🔬"
version: 1.0.0
triggers: edit file, update file, modify file, change file, fix file, patch file, replace text, insert line, delete line, refactor, update config, find and replace, rewrite section
---

# File Surgery Playbook

Every file edit follows the same four-step loop. No exceptions.

**READ → PLAN → EDIT → VERIFY**

Skipping any step is how files get corrupted or partially overwritten.

---

## The Four-Step Loop

### Step 1: READ with line numbers
Always read before editing. Get exact line numbers.

```
read("path/to/file.ts")
```

The output shows line numbers. Write them down mentally. You need exact start/end lines for the edit.

**Never edit from memory or assumption. Always read first.**

### Step 2: PLAN the edit
Before calling any edit tool, know:
- Exact start line
- Exact end line (inclusive)
- Exactly what the replacement content is
- What should remain above and below the edit

If editing multiple non-adjacent sections → plan ALL edits before executing ANY. Work from bottom to top (highest line number first) so earlier edits don't shift the line numbers you rely on for later edits.

### Step 3: EDIT with the right tool

**For replacing a contiguous block of lines:**
```
edit("path/to/file.ts", start_line, end_line, "new content here")
```

**For appending to a file:**
```
append("path/to/file.ts", "content to add at end")
```

**For complete file replacement (use sparingly):**
```
write("path/to/file.ts", "entire file content")
```

**For JSON files — always use write, never edit:**
Read → parse mentally → reconstruct the full corrected JSON → write the whole file back.
Never surgically edit JSON with line-based tools. JSON is not line-safe.

### Step 4: VERIFY immediately after every edit
```
read("path/to/file.ts")
```

Confirm:
- The changed section looks correct
- The lines above and below are intact
- No duplication, no missing content, no corrupted structure

**If verification fails:** Do not continue. Read what's there, understand what went wrong, fix it before proceeding.

---

## Multi-Section Edits

When editing multiple sections of the same file:

1. Read the full file once
2. Identify ALL sections to change
3. Sort by line number, **highest first**
4. Execute edits from bottom to top
5. Read the full file once at the end to verify all changes

**Why bottom-to-top:** Editing line 50 doesn't change the line numbers at line 10. Editing line 10 first shifts everything below it.

---

## Common Failure Patterns — Avoid These

| Bad Pattern | Why It Fails | Correct Pattern |
|---|---|---|
| Edit without reading first | Wrong line numbers, stale assumptions | Always read → then edit |
| Edit from memory after a long conversation | Line numbers drift, content changes | Re-read every time |
| Verify by reading a different section | Miss corruption in the edited area | Read the exact lines you changed |
| Edit JSON with line-based tools | JSON structure breaks across lines | Read → reconstruct → write full file |
| Edit top-to-bottom when doing multiple edits | First edit shifts line numbers for second | Always edit bottom-to-top |
| Write the entire file to change one line | Risks losing content if the write is wrong | Use edit for surgical changes |
| Skip verification because the edit "looked right" | Silently broken files | Always verify |

---

## TypeScript / JavaScript Files

Extra care required because structure matters:

- After editing, check that brackets `{}`, parentheses `()`, and imports still balance visually
- If you added or removed an import, verify the import block is syntactically valid
- If the project uses TypeScript, the build (`npm run build`) is the final verification — run it if possible after significant changes

---

## Markdown / Config Files

- After editing, check that headers, lists, and code blocks still render correctly in your mental model
- For YAML: indentation is structure — verify indent levels are preserved exactly

---

## The Golden Rule

**If you're not 100% certain what's on a line, read the file again.**

Reading is free. Corrupting a file costs a debugging session.
