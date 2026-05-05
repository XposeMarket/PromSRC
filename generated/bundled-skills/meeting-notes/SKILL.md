---
name: meeting-notes
description: Turn messy meeting input into clean, structured, actionable output.
emoji: "🧩"
version: 1.0.0
---

# Meeting Notes

Turn messy meeting input into clean, structured, actionable output.

---

## 1. Input Types Accepted

| Input | What you do |
|---|---|
| Raw transcript (speaker-labeled) | Full extraction — decisions, actions, discussion |
| Rough bullet dump | Organize, clarify, identify actions |
| Voice note summary (from audio) | Clean and structure the summary |
| Paste of key points | Format into standard template |
| Email thread recap | Extract decisions and next steps |
| "Here's what we discussed" free text | Same as rough bullet dump |

---

## 2. Extraction Framework

Read the input and extract these 5 things in order:

### 1. Context Block
- Meeting title/type (standup, 1:1, kickoff, retrospective, sales call, etc.)
- Date (if mentioned or use "Date: [not provided]")
- Attendees (if mentioned)
- Duration (if mentioned)

### 2. Decisions Made
Decisions = things that were agreed upon with no more discussion needed.
- State them as completed facts: "Decided to X" not "We might X"
- Include who owns the decision if mentioned
- If a decision reverses a previous one, note that

### 3. Action Items
Each action item needs:
- **What** — specific deliverable, not vague ("send invoice to client" not "handle billing")
- **Who** — owner (use initials or name if given; "Unassigned" if nobody claimed it)
- **When** — deadline (if given; "No deadline set" if not)

Format: `- [ ] [OWNER] [Action] — [Deadline]`

### 4. Key Discussion Points
Points that were discussed but didn't result in a decision or action. These are context for people who weren't in the meeting.
- Keep to 3-7 bullets
- Quote exact wording for important statements (use " ")
- Flag unresolved questions with ❓

### 5. Follow-Ups / Open Questions
Unresolved items that need to be revisited:
- Questions that weren't answered
- Topics explicitly deferred to a future meeting
- Risks or concerns raised but not addressed

---

## 3. Output Template

```markdown
# Meeting Notes — [Meeting Title]

**Date:** [date]
**Type:** [Standup / 1:1 / Kickoff / Retrospective / Sales Call / etc.]
**Attendees:** [Names or "Not recorded"]
**Duration:** [N minutes or "Not recorded"]

---

## Decisions

- ✅ [Decision 1] — agreed by [who]
- ✅ [Decision 2]
- ✅ [Decision 3]

---

## Action Items

- [ ] **[Name/Role]** — [Specific action] — _Due: [date/timeframe]_
- [ ] **[Name/Role]** — [Specific action] — _Due: [date/timeframe]_
- [ ] **Unassigned** — [Action nobody claimed] — _Due: TBD_

---

## Key Discussion Points

- [Topic A]: [1-2 sentence summary of what was discussed]
- [Topic B]: [summary]
- ❓ [Unresolved question raised in discussion]

---

## Open Questions & Follow-Ups

| Question / Topic | Owner | Target date |
|---|---|---|
| [Unresolved question] | [name or TBD] | [date or next meeting] |

---

## Notes

[Any other context worth preserving — tone, mood, off-agenda items, parking lot topics]
```

---

## 4. Meeting Type Variations

### Standup / Daily Sync
Simplify to:
- **Yesterday:** [what each person did]
- **Today:** [what each person is doing]
- **Blockers:** [anything blocking progress]
- **Action items:** [any follow-ups surfaced]

### Retrospective
Organize into:
- **What went well:** [bullet list]
- **What didn't go well:** [bullet list]
- **Experiments / Improvements:** [what team will try differently]
- **Action items:** [concrete changes to make]

### Sales / Discovery Call
Emphasize:
- **Prospect context:** company, role, situation
- **Pain points expressed:** [their words, in quotes ideally]
- **Interest level:** [hot / warm / cold]
- **Objections raised:** [and any responses given]
- **Agreed next step:** [specific — "send proposal by Friday" not "follow up"]

### 1:1
- **Topics discussed**
- **Feedback shared** (manager → report, and report → manager)
- **Goals / priorities reconfirmed**
- **Action items**

---

## 5. Quality Rules

- **Be specific** — "John will send the contract by Friday 5pm" not "someone handles the contract"
- **Active voice** — "Sarah owns this" not "this was owned by Sarah"
- **Flag ambiguity** — if you can't tell who owns something, mark as [Unassigned] and note in open questions
- **No padding** — if a topic wasn't covered, omit that section rather than write "N/A"
- **Quote exact language** for decisions and important commitments (avoids misinterpretation)
- **Separate discussion from action** — discussion is context, action items are commitments