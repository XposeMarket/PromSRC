---
name: Skill Creator
description: >
  Create, upgrade, and quality-check Prometheus skills from scratch. Use whenever
  the user wants to build a new skill, capture a workflow as a reusable skill,
  add a capability to Prometheus's skill library, upgrade an existing skill, or
  evaluate whether a skill will trigger and work well. Triggers on: "create a skill",
  "make a new skill", "build a skill", "add skill", "capture this as a skill",
  "turn this into a skill", "write a skill for", "new skill", "skill for X",
  "add capability", "skill builder", "upgrade this skill", "improve this skill",
  "review this skill", "skill isn't triggering", "skill quality check",
  "write me a skill that", "I want Prometheus to be able to".
emoji: 🛠️
version: 2.0.0
triggers: create a skill, make a skill, build a skill, add skill, capture as skill, turn this into a skill, write a skill, new skill, skill builder, skill creator, add capability, upgrade skill, improve skill, review skill, skill not triggering, skill quality check, I want prometheus to be able to
---

# Skill Creator

A repeatable, quality-controlled process for building Prometheus skills that trigger reliably and actually change behavior.

---

## What Is a Skill?

A skill is a `SKILL.md` file that lives in:
```
D:\Prometheus\workspace\skills\<skill-name>\SKILL.md
```

Prometheus reads the skill when a user's request matches the trigger signals in the frontmatter. Skills are **structured instructions, not code** — they guide how Prometheus thinks and acts for a specific category of task.

**A skill succeeds when:**
1. It triggers on the right requests (and not the wrong ones)
2. It measurably improves the output quality for that task
3. It doesn't make Prometheus robotic or over-procedural

---

## Step 1: Skill Scoping

Before writing anything, answer:

```
1. ONE-LINER: What does this skill enable Prometheus to do?
   [Must be expressible in one sentence]

2. TRIGGER SIGNALS: What would a user say that means they need this?
   [List 8-12 real phrases. Include synonyms and indirect phrasings]

3. NON-TRIGGERS: What looks similar but should NOT trigger this skill?
   [Define the scope boundary]

4. OUTPUT: What does the ideal output look like?
   [A file? A report? A draft? A recommendation? An action?]

5. SCOPE TEST: Can this fit in one SKILL.md under 400 lines?
   [If no — split into multiple skills or use a playbook]
```

---

## Step 2: Frontmatter — The Trigger Engine

The frontmatter is the most critical part. Get this wrong and the skill never fires.

```yaml
---
name: Human Readable Name
description: >
  [Paragraph 1: What the skill does — 2-3 sentences]
  [Paragraph 2: Explicit trigger phrases — list 8-15 real user phrasings]
  [Paragraph 3: Who it's for / what context activates it]
emoji: 🔧
version: 1.0.0
triggers: keyword1, keyword2, keyword phrase, action verb phrase, user intent phrase
---
```

### Description Field Rules (most important)

The `description` is the primary trigger signal Prometheus uses. It must:

```
✅ Start with what the skill does (functional description)
✅ Include explicit user phrases: "triggers on: X, Y, Z"
✅ Cover synonyms and alternate phrasings of the same intent
✅ Be slightly biased toward triggering — err on the side of "use this"
✅ Be 3-6 sentences (not a bullet list — prose reads better as context)
❌ Never be just a title ("Brand Strategist Skill") — that's useless
❌ Never assume the trigger is obvious — be explicit
```

### Triggers Field Rules

```
✅ 8-15 comma-separated short phrases
✅ Include exact user phrasings, not just category words
✅ Include both noun forms ("competitive analysis") and verb forms ("analyze competitors")
✅ Include indirect phrasings ("how do we compare" not just "competitive analysis")
❌ Don't duplicate the name — add signal, not repetition
```

### Trigger Quality Test

For each phrase in `triggers`, ask:
```
If a user says exactly this, should this skill load? Yes/No
If No — remove it.
```

For each phrase NOT in `triggers`, ask:
```
Could a user say this and need this skill? If yes — add it.
```

---

## Step 3: Skill Body Structure

Use this template as a starting point (adapt sections to fit):

```markdown
# Skill Name

One sentence: what this skill is for.

---

## [Core Section 1] — e.g., "When to Use This" or "The Core Principle"
[Mental model, key principle, or scoping guidance — 2-4 sentences]

## [Process Section] — numbered steps or a framework
[The main content — steps, patterns, decision trees, templates]

## [Reference Section] — tables, checklists, examples
[Lookup material the user or Prometheus needs mid-task]

## [Anti-patterns / Rules Section]
[What NOT to do. Hard constraints. Edge cases to handle explicitly]
```

### Body Writing Rules

```
✅ Specific over vague: "Use `git add -p` for staged hunks" beats "commit carefully"
✅ Examples over description: show a template, not a description of a template
✅ Tables for comparisons and decision matrices
✅ Code blocks for anything that gets copy-pasted
✅ Bold key terms — helps skim-reading mid-task
✅ Under 400 lines — if longer, split the skill
❌ No filler intros: skip "In today's world, X is important"
❌ No redundant headers (don't explain what a section is about — just do it)
❌ No passive voice on instructions — "Use X" not "X should be used"
```

---

## Step 4: Skill File Creation

1. Create the directory:
   ```
   D:\Prometheus\workspace\skills\<kebab-case-name>\
   ```

2. Write `SKILL.md` with frontmatter + body

3. If the skill references external material (templates, examples, lookup tables), add them in a `references/` subfolder:
   ```
   D:\Prometheus\workspace\skills\<skill-name>\references\<file>.md
   ```

---

## Step 5: Register in _state.json

Add the skill to `D:\Prometheus\workspace\skills\_state.json`:

```json
{
  "existing-skill": false,
  "your-new-skill": false
}
```

`false` = inactive (user enables via UI or by changing to `true`)

---

## Step 6: Quality Checklist

Run this before finalizing any skill:

### Trigger Quality
- [ ] `description` includes explicit trigger phrases ("triggers on: X, Y, Z")
- [ ] `triggers` field has 8+ distinct phrases
- [ ] Tested with 5 realistic user prompts — would Prometheus know to load this?
- [ ] Scope boundary is clear — what does NOT trigger this?

### Content Quality
- [ ] Body is under 400 lines
- [ ] At least one concrete example, template, or code snippet
- [ ] Anti-patterns section exists (what not to do)
- [ ] Every section earns its place — no fluff
- [ ] Follows the user's writing style (not overly AI-generic)

### Technical Quality
- [ ] Frontmatter YAML is valid (check indentation, no tabs)
- [ ] `name` is Title Case
- [ ] `version` starts at `1.0.0` (or bumped if upgrading)
- [ ] Registered in `_state.json`
- [ ] Folder uses kebab-case

---

## Step 7: Testing Protocol

Run 3 mental tests:

```
TEST 1 — Clear match:
  User says: "[obvious trigger phrase]"
  Expected: Skill loads and guides the right behavior
  Pass/Fail?

TEST 2 — Edge case:
  User says: "[related but ambiguous request]"
  Expected: Skill handles gracefully or stays silent
  Pass/Fail?

TEST 3 — False positive:
  User says: "[similar but wrong domain]"
  Expected: Skill does NOT trigger
  Pass/Fail?
```

If any test fails:
- Fail on Test 1 → Add trigger phrases, strengthen description
- Fail on Test 2 → Add a "when NOT to use" section or narrow triggers
- Fail on Test 3 → Remove overly broad trigger phrases

---

## Skill Upgrade Protocol

When upgrading an existing skill:

```
1. Read the current SKILL.md fully before editing anything
2. Identify: What's missing? What's wrong? What's outdated?
3. Bump the version number (1.0.0 → 1.1.0 for minor, 2.0.0 for major rewrite)
4. Run the full quality checklist on the upgraded version
5. Note what changed in a comment at the top if the change is significant
```

---

## Skill Anatomy Reference

```
workspace/skills/
  _state.json                    ← registry (skill-name: enabled bool)
  <skill-name>/
    SKILL.md                     ← required: frontmatter + body
    references/                  ← optional: lookup files, templates
      <reference-file>.md
```

**Skill loading:** Prometheus reads `SKILL.md` frontmatter to match triggers, then loads the full body into context when triggered. The `description` field is the primary matching signal. `triggers` provides additional keyword hints.

---

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Vague description ("helps with X") | Skill never triggers | Add 10 explicit user phrases |
| Triggers too broad ("help", "write") | Skill over-triggers | Narrow to specific domain phrases |
| No concrete examples | Output stays generic | Add at minimum one full template |
| Over 400 lines | Overwhelming and slow | Split into sub-skills or trim |
| Missing anti-patterns section | Prometheus makes common mistakes | Add "rules" or "what not to do" section |
| Not registered in _state.json | Skill exists but never activates | Always register after creation |
