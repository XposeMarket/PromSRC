# Prometheus Website Implementation Spec

## Purpose
This document is the **build-spec companion** to the higher-level Prometheus website plan. Its purpose is to give Claude/Codex a strict, implementation-ready blueprint for building the real site.

This is **not** a throwaway prototype.
This should be implemented as a **production-grade, multi-page Next.js application** with proper structure for auth, subscriptions, SEO, analytics, media, and future app growth.

---

## 1) Core Build Requirements
### Mandatory stack
- **Next.js** (App Router)
- **React**
- **TypeScript**
- **Tailwind CSS**
- **Framer Motion** for animations
- **Stripe** for subscriptions
- **Supabase Auth** or **Clerk** for authentication

### Mandatory standards
- True multi-page architecture
- Responsive across desktop/tablet/mobile
- Reusable component system
- Clean folder structure
- Production-ready code quality
- Strong accessibility baseline
- Good Lighthouse performance target
- Full SEO setup
- No fake prototype shortcuts
- No single giant home-page pretending to be a product site

---

## 2) Product Positioning to Reflect in Copy and Structure
Prometheus should be presented as:
- an AI system, not just a chatbot
- capable of acting, not just answering
- account-based and subscription-based
- persistent across sessions
- useful for workflows, execution, memory, tools, background work, and orchestration

The website must balance:
- cinematic intrigue
- product clarity
- trust
- conversion

Avoid generic AI buzzword language.
Copy should feel sharp, intelligent, and premium.

---

## 3) Required Route Map
Implement these routes at minimum.

### Public pages
- `/` — landing page
- `/product` — overview of Prometheus as a system
- `/capabilities` — feature breakdown
- `/how-it-works` — architecture and workflow explanation
- `/pricing` — subscription page
- `/security` — privacy, permissions, local-first / safety narrative
- `/docs` — docs landing
- `/blog` — blog landing
- `/about` — mission / philosophy / story
- `/contact` — contact/support/partnership page

### Auth / product pages
- `/login`
- `/signup`
- `/dashboard`
- `/billing`
- `/settings`
- `/get-started` or `/download`

### Optional high-value SEO pages
- `/use-cases`
- `/compare`
- `/compare/openclaw`
- `/compare/chatgpt`
- `/compare/claude`
- `/ai-browser-automation`
- `/background-tasks`
- `/local-first-ai`

---

## 4) Folder / App Structure
Recommended structure:

```txt
/app
  /(marketing)
    page.tsx
    product/page.tsx
    capabilities/page.tsx
    how-it-works/page.tsx
    pricing/page.tsx
    security/page.tsx
    docs/page.tsx
    blog/page.tsx
    about/page.tsx
    contact/page.tsx
    use-cases/page.tsx
    compare/page.tsx
  /(auth)
    login/page.tsx
    signup/page.tsx
  /(app)
    dashboard/page.tsx
    billing/page.tsx
    settings/page.tsx
    get-started/page.tsx

/components
  layout/
  navigation/
  hero/
  intro/
  ascii/
  pricing/
  seo/
  media/
  sections/
  forms/
  ui/

/lib
  auth/
  stripe/
  seo/
  analytics/
  ascii/
  animation/
  content/

/content
  blog/
  docs/
  ascii/

/public
  images/
  videos/
  og/
  favicons/
```

---

## 5) Intro Sequence Spec
This is one of the signature parts of the site.

### Required behavior
On first visit:
1. Show fullscreen intro overlay
2. Render startup ASCII pattern **left-to-right, row-by-row**
3. Transition to Prometheus ASCII logo art
4. Transition to Prometheus text art
5. Show CTA button: **Enter the fire**
6. On click, animate into homepage content

On return visits:
- either skip automatically
- or show shortened version
- always provide a **Skip intro** option

### Technical requirements
- preserve exact monospace spacing
- use preformatted rendering (`white-space: pre`)
- animate by line or by character with careful timing
- no layout shift during intro
- must work without blocking the entire app forever if an animation fails
- intro state stored in localStorage or cookie
- respect `prefers-reduced-motion`

### Visual style
- black background
- green/dark green startup loader phase
- subtle glow permitted
- no cheesy hacker effects
- Prometheus logo/text phase may transition into ember/dark orange accent world

---

## 6) ASCII Asset Handling Spec
Use the uploaded ASCII assets as real source files for the intro.

Implementation requirements:
- store ASCII source as raw text assets
- import and parse into arrays of lines
- build reusable ASCII renderer component
- build reusable ASCII animation hook or utility
- support:
  - full render
  - row-by-row reveal
  - fade out
  - crossfade to next asset

Need components such as:
- `AsciiRenderer`
- `AsciiReveal`
- `IntroSequence`
- `IntroGate`

---

## 7) Homepage Detailed Section Spec
### A. Intro handoff
After intro completes, homepage appears with a smooth transition.

### B. Hero section
Requirements:
- large premium headline
- short supporting copy with immediate clarity
- primary CTA
- secondary CTA
- visual layer: ambient motion / looping background / product visual

Hero must answer in seconds:
- what Prometheus is
- why it matters
- what action to take next

### C. Capability preview strip
Grid or cards for:
- browser automation
- files and workflows
- memory
- background tasks
- scheduling
- teams / subagents
- integrations / connectors

### D. “Not just chat” section
Explain difference between ordinary AI chat and Prometheus.

### E. Demo/media section
Embed product demo video or animated mock walkthrough.

### F. Workflow/story section
Show example workflows with clear outcomes.

### G. Pricing preview
Show simple subscription framing with $8/month anchor.

### H. Final CTA section
Push user into signup/pricing/get-started.

---

## 8) Page-by-Page Build Spec
## `/product`
Purpose:
- explain what Prometheus actually is
- high-level product overview

Sections:
- headline + overview
- what makes it different
- system pillars
- visual architecture summary
- CTA

## `/capabilities`
Purpose:
- concrete feature detail

Required sections:
- browser execution
- memory/context
- file operations
- background tasks
- scheduling
- team/subagent workflows
- integrations
- future extensibility

## `/how-it-works`
Purpose:
- explain orchestration in a digestible way

Sections:
- request → planning → tools → verification → persistence
- diagrams or visual flow blocks
- how accounts, tasks, memory, and execution connect

## `/pricing`
Purpose:
- sell $8/month clearly

Requirements:
- one clear primary plan
- what’s included
- billing FAQ
- CTA to signup
- Stripe-ready button structure

## `/security`
Purpose:
- build trust

Topics:
- permissions
- account isolation
- privacy framing
- local-first / control narrative where applicable
- responsible execution / transparency story

## `/docs`
Purpose:
- content hub for onboarding + SEO

Must be structured for later expansion.

## `/blog`
Purpose:
- SEO and product storytelling

Must support article cards, tags, metadata, and clean slugs.

## `/about`
Purpose:
- founder/product philosophy
- why this exists
- mission and vision

## `/contact`
Purpose:
- support and inquiries
- clean form and/or direct contact path

---

## 9) Auth / Subscription Flow Spec
Because this is a real subscription product, auth and billing must be built into the site structure.

### Required flow
1. user lands on marketing site
2. clicks CTA
3. reaches signup/login
4. creates account
5. completes subscription or reaches billing step
6. lands in dashboard / get-started flow

### Requirements
- email/password auth
- Google auth optional but recommended
- auth guard for app pages
- billing state awareness
- basic dashboard shell after login
- route protection for private pages

### Stripe requirements
- monthly subscription support
- customer portal support
- graceful handling of active/inactive status
- billing page with plan info and manage subscription CTA

---

## 10) Dashboard Shell Requirements
Even if the core product app is not fully built yet, provide a real dashboard shell.

Minimum dashboard sections:
- welcome panel
- subscription status
- onboarding steps
- quick links to docs/download/get-started
- account/settings access

This helps the site feel like a real product ecosystem.

---

## 11) SEO Implementation Spec
### Required technical SEO
- metadata per page using Next metadata API
- title templates
- meta descriptions
- canonical URLs
- Open Graph tags
- Twitter/X card tags
- sitemap.xml
- robots.txt
- semantic heading structure
- structured data where appropriate

### Content SEO strategy
Pages should target both branded and non-branded discovery.

Examples of target search intent:
- AI assistant that can use tools
- AI agent with browser automation
- autonomous workflow AI
- local-first AI assistant
- background task AI software
- AI with memory and scheduling
- AI that can control your computer

### Blog/use-case content system
Create the structure so future posts can target long-tail terms.

Need support for:
- slugs
- categories/tags
- author/date metadata
- OG images
- internal linking

---

## 12) Media / Video Implementation Spec
### Requirements
- support hero background media
- support demo video blocks
- lazy loading below fold
- optimized poster images
- mobile-aware handling
- no huge unoptimized media files

### Suggested components
- `VideoHero`
- `DemoVideoCard`
- `MediaFrame`

---

## 13) Text Animation / Pretext Usage Spec
Use pretext-inspired or pretext-integrated text handling for premium multiline reveal control.

Use cases:
- homepage hero headline
- manifesto text section
- selected section intros

Do not animate every heading on the site.
Motion should feel curated.

Requirements:
- no layout popping
- responsive stability
- graceful degradation if JS is slow

---

## 14) Design System Requirements
### Core tokens
Need reusable values for:
- colors
- spacing
- typography scale
- border radius
- shadows/glows
- motion timing

### Theme direction
- background: black / charcoal
- accent: ember red / dark orange
- intro-only accent: terminal green
- text: warm white / muted gray

### Typography
Use a pairing such as:
- display serif for major cinematic headlines
- modern sans for body and UI

### Components needed
- navbar
- footer
- buttons
- cards
- pricing cards
- feature blocks
- section wrappers
- CTA banners
- form controls
- ASCII rendering blocks

---

## 15) Accessibility Requirements
Must include:
- keyboard navigability
- visible focus states
- reduced motion support
- sufficient contrast
- semantic HTML
- alt text and aria labels where appropriate
- skip intro / skip to content support

The cinematic style must not destroy usability.

---

## 16) Performance Requirements
- keep homepage performant despite motion/media
- defer non-critical animation work
- lazy load heavy sections/media
- optimize fonts and media
- avoid huge JS bundles for small effects
- maintain strong Core Web Vitals targets

Especially important:
- intro sequence cannot permanently block main rendering
- media-heavy sections must be optimized

---

## 17) Analytics / Tracking Requirements
Implement lightweight analytics hooks so marketing performance can be measured.

Track at minimum:
- intro completed
- intro skipped
- hero CTA clicks
- pricing CTA clicks
- signup started
- subscription started
- docs/blog engagement

Use a clean analytics abstraction so vendor can be changed later.

---

## 18) Copywriting Guidelines for the Coding Model
Copy must be:
- direct
- premium
- cinematic but understandable
- confident
- not overhyped nonsense

Avoid phrases like:
- revolutionize everything
- futuristic synergy
- next-generation paradigm

Prefer:
- clear outcomes
- strong verbs
- concise product language
- memorable mythic phrasing only where it fits

---

## 19) Content Placeholders the Build Should Include
The build should ship with high-quality placeholder content for:
- hero headline/subheadline
- capability descriptions
- pricing copy
- about page mission copy
- FAQ stubs
- blog seed posts or blog cards
- docs categories

These placeholders should feel real enough to hand-edit later.

---

## 20) Build Deliverable Expectations
The coding model should output a project that includes:
- complete Next.js source
- route structure
- reusable components
- intro animation implementation
- SEO metadata setup
- auth/billing scaffolding
- responsive pages
- placeholder content
- clean styling system

It should be ready to:
- run locally
- be connected to real auth keys
- be connected to Stripe
- be deployed on Vercel or similar

---

## 21) Explicit Do-Not-Do List
Do **not**:
- build this as a single-page-only site
- use fake placeholder routes with no structure
- make everything over-animated
- make the intro unavoidable on every visit
- use cheesy hacker visuals
- bury the value proposition under aesthetics
- ignore SEO and metadata
- leave auth/billing as afterthoughts

---

## 22) Suggested Execution Order for the Coding Model
1. scaffold app structure
2. build design tokens and reusable layout components
3. build intro/ascii system
4. build homepage
5. build core marketing pages
6. build auth pages
7. build billing/dashboard shell
8. add SEO metadata and structured content support
9. optimize motion/media/accessibility
10. polish and verify responsiveness

---

## 23) Final Instruction to the Coding Model
Build Prometheus as a **real product website with cinematic identity**, not a concept mockup.

The site should feel premium and memorable, but still be practical, scalable, and easy to extend into a real subscription product.

The intro should create emotional identity.
The page structure should create trust.
The copy should create clarity.
The auth + billing structure should create business readiness.
The SEO architecture should create discoverability.

