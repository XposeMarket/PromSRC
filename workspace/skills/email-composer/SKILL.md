---
name: Email Composer
description: Write professional, cold, follow-up, sales, onboarding, and transactional emails. Calibrates tone, nails subject lines, writes compelling CTAs, and follows email best practices. Triggers on any request to write, draft, or improve an email.
emoji: ✉️
version: 1.0.0
triggers: write email, draft email, cold email, follow up email, reply to email, email template, outreach email, sales email, email subject, improve this email, email sequence, newsletter, onboarding email
---

# Email Composer

Use this skill for any email-writing task — from a single cold outreach to a full nurture sequence.

---

## 1. Discovery Questions

Before writing, identify (or infer sensible defaults for):

| Question | Why it matters |
|---|---|
| Who is the sender? | Determines voice, credibility signals |
| Who is the recipient? | Tone, familiarity, pain points |
| What is the goal of this email? | Call to action, conversion outcome |
| What is the relationship? (cold / warm / existing customer) | Level of directness and formality |
| What tone? (professional / friendly / urgent / casual) | Writing register |
| Is there a specific CTA? | What action the reader should take |
| Has the recipient received emails before? | Follow-up vs first contact |

If not provided, write with sensible defaults and offer variants.

---

## 2. Email Types & Strategies

### Cold Outreach
**Goal:** Get a meeting, demo, or response from someone who doesn't know you.

**Structure:**
1. **Hook** (1 sentence) — specific to them, not generic
2. **Relevance** (1-2 sentences) — why you're reaching out to THEM specifically
3. **Value** (1-2 sentences) — what's in it for them
4. **CTA** (1 sentence) — single, low-friction ask (15-min call, not "sign up")
5. **Sign-off** — name, title, company

**Rules:**
- Subject line: specific, not salesy (avoid ALL CAPS, "!", "free")
- Never start with "I" or "My name is"
- One CTA only — multiple asks kill response rates
- Under 150 words if possible
- Personalization token: reference their company, role, or recent work

### Follow-Up
**Goal:** Re-engage someone who didn't respond.

**Rules:**
- Reference previous email in first sentence
- Add new value or context — don't just say "following up"
- Shorter than the original
- Max 2-3 follow-ups in a sequence before stopping
- Space: 3-5 days after first, 5-7 days after second

**Follow-up sequence spacing:**
- Email 1 (initial) → wait 3-5 days
- Email 2 (follow-up 1) → wait 5-7 days
- Email 3 (follow-up 2) → wait 7-10 days
- Email 4 (break-up) → "Is this still relevant? Happy to close out if not."

### Sales / Demo Request
**Goal:** Book a demo or qualify interest.

**Additional rules:**
- Mention a specific pain point relevant to their industry/role
- Include one social proof element (customer name, metric, result)
- Make the CTA a question: "Would a quick 15-min call make sense this week?"

### Customer Onboarding
**Goal:** Welcome a new user/customer and drive activation.

**Structure:**
1. Warm welcome (acknowledge their decision)
2. What to do FIRST (single next action, link to it)
3. Quick win (what they can accomplish in under 5 minutes)
4. Support link or reply invitation
5. Sign-off from a real person (not "The Team")

### Transactional (confirmation, receipt, alert)
- Subject: clear and specific ("Your order #1234 is confirmed")
- Body: 3 sentences max — confirmation, key details, next step
- No sales content in the same email

---

## 3. Subject Line Rules

**What works:**
- Specific > Generic: "Quick question about [CompanyName]'s onboarding" > "Partnership opportunity"
- Short (4-7 words ideal for mobile preview)
- Creates curiosity without being clickbait
- Personalization in subject: outperforms generic by ~30%

**What to avoid:**
- "Following up" (overused, vague)
- ALL CAPS or excessive exclamation marks
- "FREE", "Limited time", "Act now" (spam triggers)
- Questions that can be answered with "no"
- Emojis (context-dependent; use sparingly for B2C, rarely for B2B)

**Subject line formula templates:**
- `[Specific observation about them] — quick thought`
- `[Problem they have] → [hint at solution]`
- `[Mutual connection/company] → reaching out`
- `Re: [Topic they care about]` (for warm follow-ups)

---

## 4. Tone Calibration

| Tone | When to use | Signals |
|---|---|---|
| **Formal** | Enterprise, C-suite, legal, finance | Full sentences, no contractions, proper salutation |
| **Professional** | Standard B2B | Contractions ok, friendly but structured |
| **Friendly** | SMB, startups, peers | Conversational, "Hey [Name]", light humor ok |
| **Casual** | Existing customers, close contacts | First name, short sentences, emojis ok |
| **Urgent** | Time-sensitive offers, alerts | Short, action-forward, deadline stated |

---

## 5. CTA Design

A strong CTA:
- Is ONE action only
- Is specific ("Book a 15-min slot here: [link]" not "Let me know if interested")
- Is low-friction (not "sign up", "buy", "commit")
- Has a built-in reason to act now (optional: "I have 3 spots open this week")

**CTA formulas by goal:**
- Meeting: "Do you have 15 minutes [day] or [day] this week?"
- Response: "Does this resonate, or am I off-base?"
- Demo: "Want me to show you how [outcome] in 20 minutes?"
- Breakup: "Should I close out this thread?"

---

## 6. Output Format

Always deliver:
1. **Subject line** — with 2 alternatives labeled (A, B, C)
2. **Body** — full email, ready to paste
3. **Personalization notes** — where to fill in [brackets] and what to put there
4. **Tone rating** — brief note on the tone used and why
5. **Variants** (optional) — if requested, shorter/longer/different CTA version

---

## 7. Email Sequence Builder

For multi-email sequences, output as a table first:

| # | Timing | Goal | Subject preview | Key hook |
|---|---|---|---|---|
| 1 | Day 0 | First contact | ... | ... |
| 2 | Day 4 | Follow-up | ... | ... |
| 3 | Day 10 | Break-up | ... | ... |

Then write each email in full below the table.
