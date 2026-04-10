---
name: Skill Creator
description: Create new Prometheus skills from scratch. Use whenever the user wants to build a new skill, capture a workflow as a skill, or add a capability to Prometheus's skill library. Triggers on: create a skill, make a new skill, build a skill, add skill, capture this as a skill, turn this into a skill, write a skill for, new skill, skill for X, add capability, skill builder. Always follow this process — don't free-form a skill file without reading this first.
emoji: 🛠️
version: 1.0.0
triggers: create a skill, make a skill, build a skill, add skill, capture as skill, turn this into a skill, write a skill, new skill, skill builder, skill creator, add capability to prometheus
---

# Skill Creator

A repeatable process for building high-quality Prometheus skills that actually trigger and work.

---

## What Is a Skill?

A skill is a markdown file (`SKILL.md`) that lives in `D:\Prometheus\workspace\skills\<skill-name>\` and teaches Prometheus how to do a specific type of task. Prometheus reads the skill when the task matches the trigger list in the skill's frontmatter.

Skills are **not** code — they're structured instructions, patterns, and reference material that guide behavior.

---

## Step 1: Define the Skill

Before writing anything, answer these:

1. **What should this skill enable Prometheus to do?** (one sentence)
2. **When should it trigger?** What would a user say that means they need this skill?
3. **What's the expected output?** A file? A report? Code? An action taken?
4. **What are the key steps or patterns** Prometheus should follow?
5. **What should Prometheus NOT do** (edge cases, common mistakes)?

---

## Step 2: Create the Directory

```
D:\Prometheus\workspace\skills\<skill-name>\SKILL.md
```

Use kebab-case for the folder name. Examples: `lead-enricher`, `email-drafter`, `pdf-extractor`.

---

## Step 3: Write the SKILL.md

Every skill must have this frontmatter:

```yaml
---
name: Human Readable Name
description: >
  One paragraph. Start with what it does. Then list specific triggers — user phrases
  or contexts that should activate this skill. Be explicit. Include synonyms.
  The more specific the trigger language, the better. Make it slightly "pushy" —
  err toward triggering rather than not.
emoji: 🔧
version: 1.0.0
triggers: keyword1, keyword2, phrase one, phrase two, action verb
---
```

### Frontmatter Rules
- `name`: Title case, human readable
- `description`: This is the primary trigger mechanism. Include BOTH what it does AND when to use it. Be specific. List real user phrases.
- `emoji`: Pick one that fits the skill's domain
- `triggers`: Comma-separated keywords and short phrases Prometheus should pattern-match on
- `version`: Start at `1.0.0`

---

## Step 4: Write the Skill Body

Structure the body using this template (adapt sections as needed):

```markdown
# Skill Name

One sentence summary of what this skill covers.

---

## 1. When to Use This
[Optional — only if nuance is needed about when to trigger vs. not]

## 2. Core Concept / Overview
[Brief mental model or key principle — 2-4 sentences max]

## 3. Step-by-Step / Patterns
[The main content — numbered steps, code patterns, reference tables]

## 4. Common Mistakes / Rules
[What NOT to do. Edge cases. Hard constraints.]

## 5. Checklist
[Optional — pre-flight checklist before executing the task]
```

### Writing Guidelines
- **Be specific, not vague.** "Use `git add .` then `git commit -m`" beats "commit your changes."
- **Include real code examples** for any technical skill.
- **Use tables** for decision matrices (when to use X vs Y).
- **Keep it under 400 lines.** If longer, the skill is too broad — split it.
- **No fluff.** Prometheus reads this mid-task. Every line must earn its place.

---

## Step 5: Register the Skill

Add the skill to `D:\Prometheus\workspace\skills\_state.json`:

```json
{
  "existing-skill": false,
  "your-new-skill": false
}
```

`false` = disabled (not yet active). The user enables skills via the Prometheus UI or by setting to `true`.

---

## Step 6: Test It

After creating the skill, verify it by asking: *"Would Prometheus know to read this skill given a realistic user request?"*

Run through 3 test prompts mentally:
- One that clearly matches — does the skill help?
- One edge case — does the skill handle it or stay silent?
- One that's close but shouldn't trigger — is the scope right?

If any test fails, tighten the trigger list or description.

---

## Complete Example

```
D:\Prometheus\workspace\skills\email-drafter\SKILL.md
```

```markdown
---
name: Email Drafter
description: >
  Draft professional emails from a brief or topic. Use whenever the user wants
  to write, compose, or send an email, needs a follow-up message, wants to
  respond to someone, or asks for help with any written communication via email.
  Triggers on: write email, draft email, compose message, follow up, respond to,
  email template, outreach email, cold email, send message.
emoji: ✉️
version: 1.0.0
triggers: write email, draft email, compose, follow up, respond to, email template, outreach, cold email, send message, reply to
---

# Email Drafter

Write clear, professional emails fast.

---

## Structure Every Email

1. **Subject** — specific and action-oriented
2. **Opening** — one sentence context or greeting
3. **Body** — the ask or information (2-3 sentences max)
4. **CTA** — clear next step
5. **Sign-off** — professional close

## Tone Guide
- Internal team: casual, direct
- Client/external: professional, warm
- Cold outreach: value-first, no fluff
- Follow-up: brief, reference prior context

## Rules
- Never start with "I hope this email finds you well"
- Subject lines under 50 characters
- One ask per email
- Always end with a clear next action
```

---

## Checklist Before Saving

- [ ] Frontmatter is valid YAML (check indentation)
- [ ] `description` includes both what it does AND trigger phrases
- [ ] `triggers` list covers the most likely user phrasings
- [ ] Body is under 400 lines
- [ ] At least one concrete example or code snippet
- [ ] Registered in `_state.json`
- [ ] Mentally tested with 3 realistic prompts
