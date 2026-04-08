# Prometheus Website Plan

## 1) Website Goal
Build a cinematic, high-conversion, multi-page React/Next.js website for Prometheus that feels closer to a living system than a normal SaaS homepage.

Core positioning:
- Personal AI system with real execution power
- Subscription-first product at **$8/month**
- Mysterious, powerful, fire-themed identity
- Strong SEO foundation for discovery and marketing
- Built for accounts, auth, billing, and future app expansion

---

## 2) Creative Direction
### Brand feeling
- Dark
- Ominous
- Powerful
- Mythic / fire / forge / intelligence awakening
- More cinematic than “corporate SaaS”

### Visual references to borrow
**From OpenClaw:**
- Clear value proposition above the fold
- Strong social proof / capability-driven storytelling
- Product-feels-alive vibe

**From Claude Platform:**
- Large confident typography
- Premium minimal layout
- Clean sections with strong rhythm
- Clear CTA paths and pricing clarity

### Prometheus visual identity direction
- Primary palette: black, charcoal, ember red, deep orange, subtle green for terminal/ascii boot sequence
- Accent usage should feel intentional, not neon overload
- Typography: sharp serif for key mythic headlines + clean sans-serif for product copy
- Motion style: smooth fades, slow glows, subtle parallax, terminal-like reveal timings

---

## 3) Core Experience Concept
## Opening sequence
### Scene 1: Boot / startup loader
- Full-screen black background
- ASCII pattern loads **left-to-right, row-by-row**
- Color palette: green / dark green / black terminal feel
- Timing should feel intentional and eerie, not too fast
- Light CRT / scanline / glow effect optional

### Scene 2: Prometheus ASCII logo reveal
- The uploaded Prometheus ASCII art becomes the centerpiece
- Fade in from loader completion
- Slight glow / breathing animation
- Hold for a beat to establish identity

### Scene 3: Text-art reveal
- After logo fades, the uploaded Prometheus text art appears
- Smooth fade / dissolve or masked reveal
- Optional support from text animation library for elegant letter or line transitions

### Scene 4: Entry CTA
- Primary button centered below: **Enter the fire**
- Clicking enters the main site/app shell transition
- This should feel like entering a system, not just navigating to a homepage

---

## 4) Recommended Site Architecture
Use a **true multi-page React setup**, ideally **Next.js App Router**.

### Public marketing pages
1. **/** — cinematic landing page
2. **/product** — what Prometheus does
3. **/capabilities** — concrete feature and workflow breakdown
4. **/how-it-works** — orchestration, tools, background tasks, memory, teams
5. **/pricing** — $8/month plan, future tiers if needed
6. **/security** — local-first/privacy/tool permissions/audit story
7. **/blog** — SEO engine
8. **/docs** — onboarding, setup, FAQs, use cases
9. **/about** — mission / philosophy / founder story / why Prometheus
10. **/contact** — partnership / enterprise / support

### Account / app pages
11. **/login**
12. **/signup**
13. **/dashboard**
14. **/billing**
15. **/settings**
16. **/download** or **/get-started**

---

## 5) Homepage Section Plan
### Hero
- Big mythic headline
- One-line product clarity immediately below
- Primary CTA: Get started / Enter the fire
- Secondary CTA: Watch demo / See how it works
- Moving background or subtle video/animated layer

Example direction:
- “The AI system that actually acts.”
- “Prometheus runs tools, works in the background, remembers context, and helps you get real work done.”

### Social proof / credibility strip
- quotes
- logos
- usage outcomes
- demo proof points

### What it can do
- browser automation
- file work
- memory
- background tasks
- scheduling
- teams/subagents
- connectors
- self-improvement workflows

### Signature story section
Explain why this is different from normal chatbots:
- not just answers
- persistent
- can act
- can run workflows
- can improve over time

### Demo section
- video clips
- animated UI walkthrough
- terminal / system-style motion graphics

### Pricing preview
- $8/month anchor
- account-based access
- simple CTA

### Final CTA
- “Enter the fire” / “Start building with Prometheus” / “Create your Prometheus account”

---

## 6) Technical Stack Recommendation
### Frontend
- **Next.js 15+** with App Router
- **React**
- **TypeScript**
- **Tailwind CSS**
- **Framer Motion** for transitions
- Optional: **GSAP** only if needed for specific cinematic sequences

### Auth / accounts
- **Supabase Auth** or **Clerk**
- Account system required from day one
- Email/password + Google auth initially

### Billing
- **Stripe subscriptions**
- $8/month recurring plan
- customer portal for billing management

### CMS / content
- MDX for docs/blog
- or a lightweight headless CMS later if needed

### Video / media
- self-host optimized MP4/WebM clips
- poster images
- lazy loading

---

## 7) Animation System Plan
### What to animate
- boot sequence
- ASCII row-by-row render
- logo fade and glow
- text reveal using pre-measured text animation techniques
- section reveals on scroll
- CTA hover states
- subtle ambient background motion

### Rules
- motion must feel premium, not gimmicky
- homepage should still be fast and accessible
- users should be able to skip intro after first visit
- respect reduced-motion preferences

### Recommended intro behavior
- first visit: show full intro
- returning visitor: short version or skip automatically using localStorage/cookie
- add “Skip intro” control

---

## 8) ASCII Integration Plan
Use the uploaded files as the basis for the intro sequence:
- Prometheus ASCII logo asset
- Prometheus text ASCII asset
- Additional block-style startup asset

### Implementation idea
- Parse ASCII files into arrays of lines
- Animate per-line or per-character reveal with requestAnimationFrame / timed intervals
- Apply subtle glow and opacity ramps
- Use monospace rendering with precise spacing preservation
- Keep assets as raw `.txt` files in public/content/ascii or import as strings at build time

---

## 9) Text Effects / Pretext Direction
Use the pretext-style approach for premium text choreography where line measurement matters.

Good use cases:
- headline reveal masks
- multiline hero line transitions
- staggered line entry without layout jank
- responsive text animation where line breaks need control

Do **not** overuse it everywhere.
Use it for:
- hero headline
- one or two showcase sections
- manifesto / tagline moments

---

## 10) Video / Media Plan
### Needed media assets
- Hero background loop
- Product demo clips
- Feature micro-demos
- Terminal/ASCII intro sequence recording for promo use
- Optional founder/demo voiceover video

### Best placement
- homepage hero background
- demo section on homepage
- capabilities page
- pricing/support reassurance sections

### Performance rules
- compress aggressively
- lazy load below the fold
- avoid autoplaying large files on mobile unless optimized

---

## 11) SEO Foundation Requirements
### Framework requirements
- SSR / SSG support via Next.js
- clean route structure
- semantic HTML
- metadata per page
- canonical URLs
- Open Graph + Twitter metadata
- sitemap.xml
- robots.txt
- schema markup

### Content strategy
The site must target both:
1. **Brand searches** for Prometheus
2. **Problem/intent searches** such as:
- AI assistant that can use tools
- AI agent with browser automation
- local-first AI assistant
- background task AI
- autonomous AI workflow tool
- AI that can control your computer
- AI agent with memory and scheduling

### Core SEO pages to create
- landing page
- feature pages for each major capability
- comparison pages
- use-case pages
- blog posts around specific pain points and search intent
- documentation pages with long-tail terms

### Technical SEO checklist
- strong title tags
- strong meta descriptions
- one H1 per page
- internal linking
- descriptive alt text
- fast LCP/CLS/INP performance
- structured data where appropriate
- programmatic metadata support in Next.js

---

## 12) Conversion Flow
### Main funnel
1. visitor lands on cinematic homepage
2. understands value fast
3. watches proof/demo
4. sees pricing simplicity
5. creates account
6. starts subscription or trial

### CTA strategy
- Enter the fire
- Start with Prometheus
- Create account
- Watch demo
- See capabilities

Keep one dominant CTA per section.

---

## 13) Content / Copy Tone
- bold
- intelligent
- cinematic
- not cringe
- not generic AI buzzword soup
- clear enough that normal buyers still understand it

Prometheus should sound like:
- a serious product
- a powerful system
- something alive and evolving

---

## 14) Recommended Build Order
### Phase 1 — foundation
- Next.js app structure
- design system
- auth
- billing
- metadata/SEO base
- route scaffolding

### Phase 2 — cinematic homepage
- intro sequence
- hero
- capability sections
- pricing preview
- CTA flow

### Phase 3 — key pages
- product
- capabilities
- how it works
- pricing
- security
- docs/blog base

### Phase 4 — media + polish
- demo videos
- motion refinement
- comparison pages
- blog content
- analytics

---

## 15) Build Handoff Requirements for Claude/Codex
The implementation prompt should require:
- true multi-page Next.js app
- production-grade folder structure
- reusable components
- SEO metadata per route
- auth + subscription flow scaffolding
- intro animation system with ASCII assets
- responsive design
- clean accessibility baseline
- no fake single-page prototype shortcuts

---

## 16) Final Direction
The final site should feel like:
- OpenClaw’s “this actually does things” energy
- Claude Platform’s premium typography and layout confidence
- Prometheus’s own identity: darker, more mythic, more cinematic, more fire-forged

It should sell both:
- **immediate intrigue**
- **real product trust**

And it should be structured so a coding model can build it as a real subscription-ready product site, not just a pretty demo.

