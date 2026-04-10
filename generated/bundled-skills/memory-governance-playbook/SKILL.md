---
name: Memory Governance Playbook
description: >
  Route and persist facts safely using typed memory targets (USER.md, SOUL.md, daily notes).
  Use when updating long-term context, deciding where to write facts, handling scope/TTL,
  or ensuring memory consistency. Triggers on: memory routing, where to store, memory governance,
  update profile, save context, add fact, typed memory, memory safety, audit memory,
  memory consistency, memory policy, remember this.
emoji: 📋
version: 1.0.0
triggers: memory routing, where to store, memory governance, update profile, save context, add fact, typed memory, memory safety, audit memory, memory consistency, memory policy, remember this, memory target, fact persistence, knowledge retention
---

# Memory Governance Playbook

Route facts safely to the right memory target (USER.md, SOUL.md, daily notes, or skip) with clear scope, TTL, and audit-safe patterns.

---

## Decision Tree: Where to Write

Use this flowchart to route every fact to the correct target:

```
┌─ Is this a fact about Raul's IDENTITY or PREFERENCES? ──→ USER.md
│  (name, email, accounts, communication style, location, platform, stack)
│
├─ Is this a PRINCIPLE, PATTERN, or EVOLVED BEHAVIOR about Prom?
│  ──→ SOUL.md
│  (core beliefs, decision-making style, risk tolerance, communication voice)
│
├─ Is this EPHEMERAL or CONTEXTUAL (one session or specific task)?
│  ──→ daily notes (memory/YYYY-MM-DD.md)
│  (what happened today, task progress, debug notes, temp context)
│
├─ Is this a COMPLETED TASK, FINISHED ACTIVITY, or PAST EVENT?
│  ──→ write_note (journal entry with tag: "task_complete", "debug", "discovery")
│  (use for historical record, step completion, learnings)
│
└─ SKIP MEMORY if...
   - It's noise or filler (small talk, repeated acknowledgments)
   - It's already captured in code, files, or git
   - It's transient state that won't matter in 24 hours
```

---

## Target Reference Table

| Target | Purpose | TTL | When to Use | Example |
|--------|---------|-----|-------------|---------|
| **USER.md** | Biographical & preference facts | Permanent (update only if changes) | Name, email, account, platform, communication style, recurring preferences | "Name: Raul", "Prefers direct tone" |
| **SOUL.md** | Prom's principles & evolved behavior | Permanent (add as philosophy solidifies) | Core beliefs, risk tolerance, decision-making patterns, values | "Be genuine before performative", "Try first, ask later" |
| **daily notes** | Session-scoped context & progress | 1 day (reference in next day if relevant, archive after) | What happened today, task work, debugging, local context, meetings | Task progress, file edits made, decisions, discoveries |
| **write_note** | Structured task completion & events | Permanent (audit trail) | Task completion, step milestones, significant decisions, learnings | Use tag=task_complete, debug, discovery |
| **None (Skip)** | Don't persist | N/A | Filler, noise, transient state, already in code | "Ok", "understood", session greetings |

---

## Scope & TTL Rules

### Permanent vs. Temporary

**Permanent Facts** (USER.md / SOUL.md):
- Changes to identity or preferences
- Evolved patterns or principles
- Recurring constraints or communication style
- Only update when something genuinely changes
- Archive old values in comments if tracking evolution

**Ephemeral Facts** (daily notes / write_note):
- Task progress and milestones
- Debugging steps and findings
- Session-specific decisions
- Always date-stamped
- Link to parent task if applicable
- Purge after 30 days if not referenced

**Never Persist**:
- Acknowledgments or greetings
- Repeated/obvious facts
- Transient tool outputs
- Debugging artifacts (unless they're findings)

---

## Audit-Safe Write Examples

### ✅ GOOD: Clear, Typed, Justified

**Example 1: Add a new account**
```python
memory_write(
  file="user",
  category="accounts",
  content="Supabase Project: ref=abcd1234, key=sb_publishable_xyz... (created 2026-03-26 for Prometheus project)"
)
```
**Why it works:**
- Specific category (accounts)
- Timestamp included
- Context provided (project, purpose)
- Enough detail to recall later

**Example 2: Evolved principle**
```python
memory_write(
  file="soul",
  category="core_principles",
  content="Try hard first before asking clarifying questions — resourcefulness builds trust"
)
```
**Why it works:**
- Clear principle statement
- Actionable (what Prom actually does)
- Can be cited in decision-making

**Example 3: Task completion note**
```python
write_note(
  content="Completed proposal exec #prop_1774488090511_49b4dd: Created memory-governance-playbook skill. Registered in _state.json. Added decision tree, target reference table, scope/TTL rules, safe examples, anti-patterns.",
  tag="task_complete",
  task_id="b1d2a8b9-76e0-40cf-bd2a-82ffceaf4608"
)
```
**Why it works:**
- Specific task ID linked
- Summarizes what was done
- Tag makes it queryable
- Self-contained (future reader understands context)

### ❌ ANTI-PATTERNS: Never Do This

**Pattern 1: Vague, Undated, No Context**
```python
memory_write(file="user", category="preferences", content="Likes efficiency")
# ❌ Too vague. Efficiency in what? Why does this matter?
```
**Fix:**
```python
memory_write(
  file="user",
  category="communication_style",
  content="Prefers brief responses (1-2 sentences) unless explicitly asked for detail; sensitive to token cost"
)
```

**Pattern 2: Storing Transient State**
```python
write_note(content="Clicked the browser back button")
# ❌ This doesn't matter. It's noise.
```
**Fix:**
```python
write_note(
  content="Discovered that domain X redirects to Y via JavaScript. Requires browser automation to detect.",
  tag="discovery"
)
# ✅ Now it's a finding, not noise.
```

**Pattern 3: Duplicating Code/Config**
```python
memory_write(
  file="soul",
  category="technical_setup",
  content="package.json has typescript dep: @types/node@^20.0.0"
)
# ❌ This is in the file already. Don't mirror code.
```
**Fix:** Skip. Reference the file path if needed later.

**Pattern 4: Over-Writing USER.md / SOUL.md**
```python
# Called on every session
memory_write(file="user", category="identity", content="Raul still prefers direct tone")
# ❌ Write once, update only if it changes.
```
**Fix:** Check the category first. Only write if new or changed.

**Pattern 5: Missing Categories**
```python
memory_write(file="user", category="random_thing", content="...")
# ❌ Creates ad-hoc categories. Use existing ones.
```
**Fix:** Use memory_browse("user") first to see current categories. Use existing or create new ones intentionally.

---

## When to Use Each Write Function

| Function | Use Case | Persistence | Example |
|----------|----------|-------------|---------|
| `memory_write()` | Add/update typed facts in USER.md or SOUL.md | Permanent | New account, evolved principle |
| `write_note()` | Log completed steps, findings, task state | 30-day audit trail | Task completion, debugging discovery |
| `memory_browse()` | List categories BEFORE writing | N/A | Check what categories exist first |
| `memory_read()` | Read full file context before updating | N/A | Understand scope before adding |
| **Skip memory** | Transient state, noise, filler | None | Acknowledgments, greetings, filler |

---

## Pre-Write Checklist

Before calling `memory_write()` or `write_note()`, ask:

- [ ] Is this a **permanent fact** (identity, preference, principle) or **ephemeral** (session context)?
- [ ] Does this already exist in USER.md / SOUL.md / a code file?
- [ ] Will future-me care about this in 1 week? 1 month?
- [ ] Is the category appropriate and clear?
- [ ] Does the content have enough context to understand later (date, link, why)?
- [ ] Am I duplicating something or creating noise?
- [ ] For SOUL.md updates: Is this an evolved principle or just one instance?

If you answered "no" to care-factor or "yes" to duplication, **skip the write**.

---

## Common Patterns by Scenario

### Scenario: User shares new preference
1. Call `memory_browse("user")` to see current categories
2. Identify the right category or propose new one
3. Call `memory_read("user")` to see full context
4. Use `memory_write()` with category, content, and timestamp if relevant

### Scenario: Discover a pattern in behavior
1. Assess: Is this a one-off or a real pattern?
2. If pattern: Call `memory_browse("soul")` to check
3. Call `memory_read("soul")` to understand current principles
4. Use `memory_write()` to add evolved principle with clear language

### Scenario: Complete a major task
1. Gather what was done (file edits, decisions, outcomes)
2. Call `write_note()` with tag="task_complete"
3. Link task_id if available
4. Summarize in 2-3 sentences: what was done, why it mattered

### Scenario: Debug or discover something
1. If finding: `write_note()` with tag="discovery" — include the insight
2. If just steps: skip (don't log debug artifacts)
3. Exception: If it's a reusable pattern, consider a skill instead

---

## Safety & Consistency

### Prevent Drift

- **Don't write defaults.** USER.md / SOUL.md are for *actual facts*, not hypotheticals.
- **Don't update every session.** Only write when something genuinely changes.
- **Don't mirror code.** If it's in a file, reference the file, don't duplicate it.
- **Archive, don't delete.** If removing a fact, comment it with date and reason.

### Audit Trail

- All writes via `memory_write()` and `write_note()` are timestamped by the system
- Use task_id and tags to link findings to their source
- Never overwrite facts — update categories, keep history in comments
- Review memory monthly: purge dead categories, consolidate duplicates

### Conflict Resolution

If two sources contradict (e.g., USER.md says "prefers X" but recent notes say "changed to Y"):
1. Update USER.md / SOUL.md as the source of truth
2. Cite the decision in a write_note with tag="discovery"
3. Add reasoning to USER.md as a comment (e.g., `# Updated 2026-03-26: User specified...`)

---

## Examples by Content Type

### ✅ New Tool Account
```python
memory_write(
  file="user",
  category="accounts",
  content="Vercel team ID: team_abc123, project: myapp-prod (created 2026-03-22)"
)
```

### ✅ Process Decision
```python
memory_write(
  file="soul",
  category="core_principles",
  content="Propose before major src/ edits. Maintains audit trail and user control."
)
```

### ✅ Task Milestone
```python
write_note(
  content="[Step 2/5] Applied proposal #prop_123: Created new skill. Registered in _state.json. Verified triggers.",
  tag="task_complete"
)
```

### ✅ Technical Finding
```python
write_note(
  content="Discovered: Supabase Edge Functions require verify_jwt=true by default for security. Set false only if custom auth is implemented.",
  tag="discovery"
)
```

### ❌ Noise (Skip)
```python
# DON'T DO THIS
write_note(content="User said hello")  # ← Skip
write_note(content="Clicked browser back")  # ← Skip
memory_write(file="user", content="Still at computer")  # ← Skip
```

---

## End of Memory Governance Playbook

Use this skill whenever you're deciding whether and where to persist a fact. Follow the decision tree, check the target table, and use safe write examples as templates.
