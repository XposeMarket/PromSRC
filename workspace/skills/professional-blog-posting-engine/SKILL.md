---
name: Professional Blog Posting Engine
description: Create publication-ready blog posts for businesses, brands, products, and services with strong editorial quality, search-intent alignment, SEO-aware structure, EEAT-style credibility, and conversion-focused CTAs. Use whenever the user asks to write a blog post, create an SEO article, turn a keyword into an article, make a local SEO blog, write a thought-leadership post, create a comparison article, build a how-to post, or turn notes into a publishable article. Triggers on requests like: "write a blog post," "create an SEO article," "turn this keyword into a blog," "make a ranking-quality article," "write a local SEO post," "draft a blog for my company," and "turn these notes into a publishable post." Best for full article production workflows that need planning, outlining, drafting, SEO packaging, internal linking ideas, schema suggestions, social promotion assets, and QA in one pass.
emoji: "✍️"
version: 1.0.0
---

---
name: Professional Blog Posting Engine
description: >
  Create publication-ready blog posts for businesses, brands, products, and services with strong editorial quality, search-intent alignment, SEO-aware structure, EEAT-style credibility, and conversion-focused CTAs. Use whenever the user asks to write a blog post, create an SEO article, turn a keyword into an article, make a local SEO blog, write a thought-leadership post, create a comparison article, build a how-to post, or turn notes into a publishable article. Triggers on requests like: "write a blog post," "create an SEO article," "turn this keyword into a blog," "make a ranking-quality article," "write a local SEO post," "draft a blog for my company," and "turn these notes into a publishable post." Best for full article production workflows that need planning, outlining, drafting, SEO packaging, internal linking ideas, schema suggestions, social promotion assets, and QA in one pass.
emoji: ✍️
version: 1.0.0
triggers: write a blog post, create an SEO article, SEO blog post, turn this keyword into an article, write a local SEO post, make a ranking-quality article, draft a blog for my company, create a thought leadership article, write a comparison post, create a how-to article, turn notes into a publishable article, write a blog for my business, make a blog post for my SaaS, create a blog article
---

# Professional Blog Posting Engine

Create **real, publication-ready blog content** that is useful to humans first, aligned to search intent, structurally easy to publish, and naturally supportive of conversions.

This skill is not a generic text generator. It behaves like a **content strategist + SEO editor + professional copywriter + QA layer**.

---

## What This Skill Produces

For a valid blog-writing request, return the final output in this exact order:

1. **Content strategy summary**
2. **SEO package**
3. **Full blog article**
4. **Internal linking plan**
5. **Schema recommendation**
6. **Featured image brief**
7. **Social promotion assets**
8. **QA report**

If the user only wants part of that package, honor the request — but default to the full package when they ask for a real blog post.

---

## When to Use This Skill

Use this skill when the user wants any of the following:

- a business blog article
- a SaaS or product marketing post
- a local SEO article
- an educational guide
- a comparison post
- a problem/solution article
- a how-to article
- a thought leadership article
- a service-page/blog hybrid
- a topical authority post
- notes or a keyword turned into a publishable article

### Do **not** use this skill alone when

- the user only wants short social captions
- the user wants a landing page, not an article
- the topic requires factual research but sources are missing and the claims matter
- the topic is medical, legal, or financial and needs expert verification
- the user only wants keyword research, not article creation

In those cases, pair this with research, fact-checking, or another more appropriate skill before drafting.

---

## Required Inputs

Accept the following structure when available. Do **not** block if some fields are missing — make the safest reasonable assumption and flag it in QA.

```json
{
  "topic": "string",
  "primary_keyword": "string",
  "secondary_keywords": ["string"],
  "search_intent": "informational | commercial | navigational | transactional",
  "audience": "string",
  "brand_name": "string",
  "brand_voice": "string",
  "industry": "string",
  "location": "string or null",
  "goal": "traffic | leads | authority | education | conversions",
  "cta": "string",
  "word_count_target": 1800,
  "reading_level": "grade 7-9 | general business | advanced",
  "include_faq": true,
  "include_schema": true,
  "include_meta": true,
  "include_social_assets": true,
  "internal_link_targets": [
    {
      "url": "string",
      "anchor_hint": "string",
      "purpose": "supporting | conversion | topical authority"
    }
  ],
  "external_references": [
    {
      "title": "string",
      "url": "string",
      "notes": "string"
    }
  ],
  "offer_or_service": "string",
  "author_name": "string",
  "author_role": "string",
  "publish_date": "YYYY-MM-DD",
  "avoid_claims": ["string"],
  "competitor_angles": ["string"],
  "notes": "string"
}
```

---

## Core Writing Rules

### 1) Human-first writing
Optimize for usefulness, clarity, trust, and decision-helpfulness before SEO tricks.

### 2) Match the search intent exactly
- **Informational:** teach clearly and answer the question fast
- **Commercial:** compare, frame tradeoffs, and support evaluation
- **Transactional:** move toward action and reduce hesitation
- **Navigational:** help the reader find the right page, product, or action quickly

### 3) No fake authority
Never invent:
- statistics
- studies
- years of experience
- testimonials
- customer quotes
- certifications
- first-hand testing
- case studies
- awards

If evidence is missing, either write more generally or explicitly note the limitation.

### 4) Natural keyword usage only
Use the primary keyword naturally in:
- the title or a close variation
- the intro
- one H2 when natural
- the conclusion or CTA zone when natural
- meta title and meta description

Do **not** stuff keywords.

### 5) Quality over word count
The word-count target is guidance, not permission to add fluff.

### 6) Every section must earn its place
Each section must do at least one of these:
- answer a reader question
- deepen understanding
- improve trust
- support conversion
- improve page navigation

### 7) Strong intros only
The opening must:
1. identify the real question or problem
2. explain why it matters
3. preview the value of the article
4. move into the content without throat-clearing

### 8) Use scannable structure
Prefer:
- short paragraphs
- clear H2/H3s
- bullets where useful
- comparison sections when relevant
- mini takeaways where useful

### 9) Internal links must be intentional
Every suggested internal link needs a reason:
- supporting concept
- topical authority
- conversion path
- related service or offer

### 10) End with movement
Every article must end with a real next step:
- CTA
- summary + next action
- consultation invite
- product/service path
- related resource path

---

## Tone Guardrails

Support tone profiles such as:
- professional and authoritative
- modern SaaS educator
- local business trustworthy expert
- premium brand editorial
- technical but accessible
- persuasive commercial

Regardless of tone:
- do **not** sound like AI
- do **not** overuse em dashes
- do **not** use fake storytelling
- do **not** inflate weak points into hype
- do **not** make every paragraph equally intense
- do **not** write robotic transitions

---

## SEO Guardrails

Follow these principles:
- people-first content over search-engine-first phrasing
- unique, descriptive title and meta description
- headings that reflect real user questions
- internal links with crawlable, clear anchor text
- useful schema only when appropriate
- no manipulative keyword stuffing or deceptive tactics

---

## Anti-Slop Rules

Reject or rewrite any output containing:
- generic intros like "In today’s fast-paced digital world..."
- repetitive paragraph starters
- vague claims without substance
- keyword stuffing
- fake expertise
- overuse of "whether you're..."
- padded conclusions
- cliches with no informational value
- headings that say nothing (e.g. weak "Final Thoughts")

---

## Workflow

## Phase 1 — Brief Normalization

First, normalize the request into a usable brief.

Infer or validate:
- who the post is for
- what should actually rank
- the likely search intent
- whether this needs local SEO framing
- whether the best format is a guide, comparison, checklist, explainer, or thought-leadership article

### Output for Phase 1

```json
{
  "normalized_topic": "string",
  "primary_intent": "string",
  "recommended_format": "guide | listicle | comparison | how-to | explainer | thought leadership",
  "audience_summary": "string",
  "conversion_goal": "string",
  "risks": ["thin topic", "needs evidence", "local proof missing"]
}
```

Do not stop after this phase — use it to inform the final article package.

---

## Phase 2 — Article Strategy

Build the strategy before drafting.

Must determine:
- **primary angle**
- **secondary angle**
- **reader pain points**
- **desired takeaway**
- **SERP-style subtopics to cover**
- **internal link opportunities**
- **CTA strategy**

### Output for Phase 2

```json
{
  "angle": "string",
  "reader_problem": "string",
  "reader_takeaway": "string",
  "subtopics": ["string"],
  "questions_to_answer": ["string"],
  "internal_link_plan": ["string"],
  "cta_strategy": "string"
}
```

---

## Phase 3 — Outline Generation

Create a real editorial outline before drafting.

### Outline requirements
- one clear **H1**
- one purposeful intro
- **4-8 H2s** depending on length and topic complexity
- H3s where they improve clarity
- FAQ section if enabled
- conclusion/CTA section

### Outline quality rules
- no redundant headings
- no filler headings
- headings should mirror search intent and real questions
- each H2 should advance understanding or decision quality

---

## Phase 4 — Drafting

Write the full article.

### Drafting rules
- lead with a direct answer when useful
- define terms simply
- use practical examples where possible
- include actionable steps, not just theory
- vary sentence rhythm
- avoid robotic transitions
- avoid unnatural keyword repetition
- include subtle brand relevance only where appropriate

### Recommended writing formula

#### Intro formula
1. State the question or problem
2. Explain why it matters
3. Preview the value
4. Transition into the article

#### Section formula
1. Clear subheading
2. Direct answer or point
3. Supporting explanation
4. Example or application
5. Transition if useful

#### Conclusion formula
1. Reinforce the takeaway
2. Reduce uncertainty
3. Present a next step
4. Deliver CTA naturally

---

## Phase 5 — SEO Enhancement

After drafting, generate:
- SEO title options (3)
- meta description
- slug
- excerpt
- suggested category
- suggested tags
- image alt text suggestions
- schema recommendation
- internal link anchors
- FAQ schema candidates if valid

---

## Phase 6 — Quality Assurance

Self-audit the article before finalizing.

### QA checklist
- Does it satisfy the intent?
- Is the title compelling and accurate?
- Is the intro strong?
- Are headings useful and non-generic?
- Is the framing original enough to feel real?
- Is it free from fluff?
- Are keywords natural?
- Are claims properly grounded?
- Is there a clear CTA?
- Are internal links intentional?
- Would a real editor approve it?

If any major item fails, revise once before returning.

---

## Final Output Contract

Return the result in this exact order.

## 1) Content strategy summary
Include:
- Topic
- Audience
- Intent
- Recommended format
- Conversion goal
- Primary angle

## 2) SEO package
Include:
- Primary keyword
- Secondary keywords
- SEO title (3 options)
- Meta description
- URL slug
- Suggested category
- Suggested tags

## 3) Full blog article
Include:
- H1
- full article body with H2/H3 sections
- FAQ if enabled
- conclusion + CTA

## 4) Internal linking plan
Return a table-like list with:
- anchor suggestion
- destination page
- reason for link

## 5) Schema recommendation
Return JSON-LD when applicable.
Usually:
- `BlogPosting`
- `Article`
- `FAQPage` (only when valid)

## 6) Featured image brief
Include:
- image concept
- overlay text if any
- alt text

## 7) Social promotion assets
Include:
- X/Twitter post
- LinkedIn post
- Facebook caption
- short email newsletter teaser

## 8) QA report
Include:
- strengths
- risks
- editor notes
- factual verification warnings if needed

---

## Internal Linking Reference Template

Use a format like this:

| Anchor Suggestion | Destination Page | Reason |
|---|---|---|
| "roof repair services" | `/services/roof-repair` | conversion path from informational query |
| "signs of storm damage" | `/blog/storm-damage-signs` | supporting topical authority |
| "schedule an inspection" | `/contact` | CTA / lead conversion |

If actual URLs are not available, use placeholders and label them clearly.

---

## Schema Template Reference

Use a safe JSON-LD structure like this and adapt it to the real brief:

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "[Article Title]",
  "description": "[Meta description or short summary]",
  "author": {
    "@type": "Person",
    "name": "[Author Name]"
  },
  "datePublished": "[YYYY-MM-DD]",
  "publisher": {
    "@type": "Organization",
    "name": "[Brand Name]"
  }
}
```

If FAQ content is included and valid, add a separate `FAQPage` block.

---

## Automatic Enrichment Guidance

If other tools or context are available, you may enrich the brief with:
- major SERP themes
- People Also Ask-style questions
- related entities/topics
- competitor content angles
- brand-site internal pages to link
- location modifiers
- product or service differentiators

Important: use enrichment to improve originality and completeness — **not** to produce copycat output.

---

## Scoring Model

Optionally self-score before finalizing:

```json
{
  "intent_match_score": 1,
  "clarity_score": 1,
  "originality_score": 1,
  "seo_readiness_score": 1,
  "conversion_score": 1,
  "overall_publish_readiness": 1,
  "needs_revision": false
}
```

Use a 1-10 scale. If `overall_publish_readiness < 8`, revise once.

---

## Example Safe Execution Prompt

Use this internal operating stance:

```text
You are Prometheus’s professional blog writing engine.

Your job is to create publication-ready blog content that is useful, credible, search-intent aligned, and conversion-aware.

You do not write generic AI slop. You write like a professional content strategist, editor, and SEO-aware brand writer working together.

Your priorities, in order:
1. Help the reader.
2. Match search intent.
3. Make the page easy to understand and publish.
4. Support conversions naturally.
5. Improve discoverability without sounding engineered.

Rules:
- Write for humans first.
- Never invent stats, studies, credentials, case studies, testimonials, or firsthand experience.
- Keep keyword usage natural.
- Use strong headings and a purposeful outline.
- Make the introduction immediately valuable.
- Include practical detail and specificity.
- End with a natural CTA.
- Return all requested publishing assets.

Before writing, normalize the brief and decide the best article format.
Then produce:
- strategy summary,
- SEO package,
- full article,
- internal linking plan,
- schema recommendation,
- image brief,
- social assets,
- QA report.

If information is missing, make the safest reasonable assumption and note it in the QA report.
```

---

## Anti-Patterns

Do **not**:
- default to generic blog formulas
- write intros that delay the answer
- use generic headings that could fit any article
- force every secondary keyword into the article
- fake proof to sound authoritative
- use bloated CTA paragraphs
- let brand voice overpower clarity
- use schema mechanically when it is not valid
- bury the actual answer below long setup

---

## Trigger Tests

### Clear match
User says: **"Write a blog post for my roofing company about hail damage signs."**
Expected: This skill should load.

### Edge case
User says: **"Turn these rough notes into a publishable SEO article for my SaaS."**
Expected: This skill should load and normalize missing inputs safely.

### False positive
User says: **"Write three X posts promoting my new feature."**
Expected: This skill should **not** load by itself.

---

## Bottom Line

This skill should produce blog posts that are:
- readable
- useful
- rank-aware
- trustworthy
- on-brand
- conversion-capable
- actually ready to publish

Not just "generated text."