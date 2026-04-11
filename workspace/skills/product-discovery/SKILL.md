---
name: Product Discovery
description: >
  User research synthesis, opportunity sizing, feature prioritization, and product
  roadmap decisions. Use whenever the user needs to decide what to build next, validate
  a product idea, prioritize a feature backlog, run a discovery sprint, synthesize
  customer feedback, or create a PRD. Triggers on: "product discovery", "what should
  we build", "feature prioritization", "RICE scoring", "ICE scoring", "product roadmap",
  "prioritize the backlog", "validate this feature", "customer feedback synthesis",
  "opportunity sizing", "user story", "PRD", "product requirements", "Jobs to be Done",
  "JTBD", "discovery sprint", "product hypothesis", "feature request", "should we build X",
  "is X worth building", "product strategy", "roadmap planning".
emoji: 🗺️
version: 1.0.0
triggers: product discovery, feature prioritization, RICE scoring, ICE scoring, product roadmap, prioritize backlog, validate feature, opportunity sizing, user story, PRD, product requirements, JTBD, jobs to be done, discovery sprint, product hypothesis, feature request, should we build, product strategy, roadmap planning, what to build next
---

# Product Discovery

Structured process for deciding what to build, validating it's worth building, and scoping it so the team can execute.

---

## The Core Loop

```
Opportunity → Hypothesis → Validation → Prioritization → Spec
```

Don't skip steps. Building the wrong thing is more expensive than taking a week to validate.

---

## Step 1: Opportunity Framing

Before any solution, frame the opportunity:

```
OPPORTUNITY STATEMENT TEMPLATE:
"We have observed that [customer type] struggle to [job/outcome] when [context/situation].
This results in [consequence — cost, risk, frustration].
We believe a solution exists in [general problem space]."

Example:
"We have observed that SDRs struggle to personalize outreach at scale when managing 100+
prospects simultaneously. This results in generic emails, low reply rates, and wasted 
pipeline capacity. We believe a solution exists in AI-assisted personalization without
sacrificing deliverability."
```

**Opportunity score inputs:**
```
Customer pain intensity (1-10):
Frequency of the problem (daily / weekly / monthly / rare):
Current workarounds (what do they do now? how broken is it?):
Strategic fit (does solving this fit our product direction?):
Market signal (# of requests, support tickets, sales losses citing this):
```

---

## Step 2: Jobs to Be Done (JTBD)

Frame every feature as a job the customer is hiring your product to do:

```
JOB STATEMENT: "When [situation], I want to [motivation], so I can [expected outcome]."

Example: 
"When I'm preparing for a sales call, I want to quickly see the prospect's recent 
activity and company news, so I can open with something relevant and build rapport faster."

Jobs have three layers:
  Functional: What does the customer actually need to accomplish?
  Social:     How do they want to be seen by others as a result?
  Emotional:  How do they want to feel?
```

**Avoid:**
- "Users want a dashboard" — that's a solution
- "Users want faster reports" — that's a feature request
- "Users want to know their pipeline health at-a-glance so they never get caught off guard in a forecast meeting" — that's a job

---

## Step 3: Feature Prioritization Frameworks

### RICE Scoring

```
REACH:   How many users does this affect per period? (# of users)
IMPACT:  How much does it affect them? (3=massive, 2=high, 1=medium, 0.5=low, 0.25=minimal)
CONFIDENCE: How certain are you in R, I, E? (100%=high, 80%=medium, 50%=low)
EFFORT:  How many person-weeks to build? (person-weeks)

RICE Score = (Reach × Impact × Confidence) / Effort

Example:
  Feature: Auto-import from CRM
  Reach: 500 users/month
  Impact: 2 (high)
  Confidence: 80%
  Effort: 4 person-weeks
  RICE = (500 × 2 × 0.8) / 4 = 200
```

### ICE Scoring (faster, less data-dependent)

```
IMPACT:    Expected impact if it works (1-10)
CONFIDENCE: How sure are you it'll work (1-10)
EASE:      How easy is it to implement (1-10)

ICE Score = (Impact + Confidence + Ease) / 3

Best for: quick stack-ranking when you don't have reliable reach data
```

### Opportunity Scoring Matrix

```
For each initiative, score 1-10:
  Strategic alignment:   Does this advance our 12-month goal?
  Revenue potential:     Could this drive measurable revenue?
  Customer retention:    Would this reduce churn?
  Competitive moat:      Does this deepen our defensibility?
  Urgency:               How much does delay cost us?
  Feasibility:           Can we ship this in the next quarter?

Total score / 6 = Opportunity Score
```

### Prioritization Decision Table

```
High impact + Low effort = DO NOW
High impact + High effort = PLAN AND RESOURCE
Low impact + Low effort = DO IF YOU HAVE CAPACITY
Low impact + High effort = CUT OR DEPRIORITIZE
```

---

## Step 4: Validation Before Building

Match evidence strength to investment size:

| Validation type | Effort | Use when |
|----------------|--------|---------|
| Customer interview (5+) | Low | Early hypothesis |
| Landing page / smoke test | Low | Willingness to pay signal |
| Wizard of Oz prototype | Medium | Test the full experience manually |
| Clickable prototype | Medium | Test UX/flow before engineering |
| Beta / limited release | High | Validate at scale before full build |

**Hypothesis format:**
```
"We believe [customer] will [behavior] because [rationale].
We'll know this is true when [measurable outcome] within [timeframe]."

Example:
"We believe VP Sales will pay $200/seat for auto-generated deal summaries because
they spend 3+ hours/week manually updating CRM fields.
We'll know this is true when 30% of beta users enable it within 2 weeks."
```

---

## Step 5: Writing a PRD (Product Requirements Document)

```markdown
# PRD: [Feature Name]
Author: [Name]  |  Date: [Date]  |  Status: Draft / Review / Approved

---

## Problem Statement
[What problem does this solve? Who experiences it? What does it cost them?]

## Target User
[Specific persona / segment — not "all users"]

## Success Metrics
- Primary: [The one metric that tells us this worked]
- Secondary: [Supporting signals]
- Guardrail: [What we must not break]

## User Stories
- As a [persona], I want to [action], so that [outcome].
- As a [persona], I want to [action], so that [outcome].

## Scope

### In Scope (v1)
- [Feature 1]
- [Feature 2]

### Out of Scope (explicitly)
- [Thing that's related but not included — prevents scope creep]

## Requirements

### Functional Requirements
1. [System must do X]
2. [System must do Y]

### Non-functional Requirements
- Performance: [load time, throughput targets]
- Security: [data handling, access control]
- Accessibility: [WCAG level, if applicable]

## Edge Cases & Error States
- [What happens when X fails?]
- [What if user doesn't have permission?]
- [Empty state behavior]

## Open Questions
- [ ] [Question to resolve before build starts]

## Dependencies
- [Team / system / data dependency]

## Timeline
Discovery done: [date]
Design complete: [date]
Engineering start: [date]
Ship target: [date]
```

---

## Step 6: Discovery Anti-Patterns

```
❌ Building from feature requests without understanding the job
   → Users ask for "faster horse"; find the job, not the solution

❌ Validating with people who already like you
   → Interview skeptics and churned users, not fans

❌ Treating all feature requests equally
   → Frequency of request ≠ value of feature

❌ Skipping the "why now" question
   → Why hasn't this been solved? What makes this moment different?

❌ Spec-ing a solution before defining success metrics
   → Write the metrics before the requirements, not after

❌ Discovery by committee
   → One DRI (directly responsible individual) per feature

❌ "We'll figure out the hard problems in sprint"
   → If you don't know how to solve the core technical or UX challenge, that IS the discovery work
```
