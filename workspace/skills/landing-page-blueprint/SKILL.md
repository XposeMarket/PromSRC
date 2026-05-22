---
name: landing-page-blueprint
description: Use this skill whenever creating or editing a landing page (single-page marketing site, product splash page, waitlist page, lead-gen page, SaaS homepage).
emoji: "🧩"
version: 1.0.0
---

# Landing Page Blueprint

Use this skill whenever creating or editing a landing page (single-page marketing site, product splash page, waitlist page, lead-gen page, SaaS homepage).

## Goal
Produce a visually modern, comprehensive, conversion-focused landing page that is clear, fast, accessible, and easy to maintain — AND that renders fully in the Prometheus canvas preview without a web server.

---

## 1) Discovery (always do first)
Collect or infer:
- Product/service name
- Target audience
- Primary value proposition
- Primary CTA (e.g., Start free trial, Book demo, Join waitlist)
- Secondary CTA (optional)
- Brand tone (professional, playful, premium, technical)
- Proof assets available (testimonials, logos, metrics, case studies)
- FAQ topics

If details are missing, create sensible defaults and label them as placeholders.

---

## 2) Information Architecture (recommended section order)
Build sections in this order unless user requests otherwise:
1. Header / Nav
2. Hero (headline, subheadline, CTA, visual)
3. Social Proof (logos/metrics)
4. Problem → Solution
5. Features / Benefits (3–6 cards)
6. How It Works (3 steps)
7. Use Cases / Who It's For
8. Testimonials / Case snippets
9. Pricing or Plan Teaser (if relevant)
10. FAQ (5–8 items)
11. Final CTA banner
12. Footer (links, legal, contact)

Rule: Every major section should support the CTA.

---

## 3) Copywriting Framework
For each section:
- One clear heading
- One concise supporting paragraph
- Skimmable bullets where useful
- Specific CTA labels (avoid vague "Submit")

Hero headline formula:
- "<Outcome> without <pain>" or
- "The fastest way to <desired result>"

Copy standards:
- Clear over clever
- Concrete claims over hype
- Short paragraphs (1–3 lines)
- Avoid jargon unless audience is technical

---

## 4) Visual & UX Standards
- Responsive first (mobile, tablet, desktop)
- Use strong spacing rhythm (8px scale)
- Max content width (~1100–1200px)
- High contrast text and accessible focus states
- Sticky nav optional if page is long
- Card-based layout for features/testimonials
- Keep above-the-fold focused: value + CTA

Use modern CSS:
- CSS variables for colors/spacing/radius/shadows
- Flexbox/grid for layout
- Fluid typography with clamp()
- Subtle hover/focus transitions

---

## 5) Conversion Best Practices
- Primary CTA repeated 3+ times across page
- Add risk reducer near CTA (No credit card, Cancel anytime, etc.)
- Include proof near decision points (ratings, stats, testimonials)
- Minimize friction in forms (only essential fields)
- Keep nav simple; avoid too many exits on lead-gen pages

---

## 6) Accessibility + Performance Baseline
- Semantic landmarks: header/main/section/footer
- Proper heading hierarchy (h1 once)
- Alt text for meaningful images
- Keyboard-accessible buttons/links
- Visible focus styles
- Optimize images and avoid blocking scripts
- Prefer system or optimized web fonts

---

## 7) ⚠️ CRITICAL: File Output Pattern — Canvas-Ready + Production-Ready

The Prometheus canvas preview renders each file in an isolated iframe with NO web server.
This means `<link href="styles.css">` and `<script src="script.js">` will NOT load —
the preview will show an unstyled skeleton even though the files exist.

### ALWAYS follow this dual-output pattern:

**Step 1 — Create `index.html` as fully self-contained (canvas-ready)**
- Inline ALL CSS inside a `<style>` block in `<head>`
- Inline ALL JS inside a `<script>` block before `</body>`
- Leave the external file references as COMMENTS so it's clear what they map to:
  ```html
  <!-- Production: <link rel="stylesheet" href="styles.css" /> -->
  <style>
    /* all CSS here */
  </style>
  ```
  ```html
  <!-- Production: <script src="script.js"></script> -->
  <script>
    // all JS here
  </script>
  ```

**Step 2 — ALSO create the separate clean files for production use**
- `styles.css` — full stylesheet (identical content to what's inlined)
- `script.js` — full JS (identical content to what's inlined)

**Step 3 — In `index.html`, keep the external `<link>` and `<script>` tags as comments**
This makes it trivial for the user to switch to the production split-file version:
just uncomment the external refs and remove the inline `<style>`/`<script>` blocks.

### Why this matters:
- Canvas preview: works because everything is inline in index.html
- Production deploy: works because the clean split files exist and comments show where to switch
- No duplicate maintenance work: user has both patterns in one output

### Example structure of index.html head:
```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Product Name</title>
  <!-- Production: <link rel="stylesheet" href="styles.css" /> -->
  <style>
    /* === INLINED FROM styles.css — remove this block when using external stylesheet === */
    :root { ... }
    body { ... }
    /* ... full styles ... */
  </style>
</head>
```

### Example structure of index.html body end:
```html
  <!-- Production: <script src="script.js"></script> -->
  <script>
    /* === INLINED FROM script.js — remove this block when using external script === */
    document.getElementById('year').textContent = new Date().getFullYear();
  </script>
</body>
```

---

## 8) Implementation Pattern (HTML/CSS/JS)
When coding from scratch:
- Clean semantic HTML throughout
- JS minimal: menu toggle, smooth scroll, FAQ accordion, year auto-fill
- No heavy dependencies unless user explicitly asks
- Always use CSS variables for theming so colors/fonts are easy to swap

Recommended file output (always all three):
- `index.html` — self-contained (inlined CSS + JS) with external refs as comments
- `styles.css` — clean production stylesheet
- `script.js` — clean production JS

---

## 9) Quality Checklist (before completion)
- [ ] Headline clearly states core value
- [ ] CTA is visible above the fold
- [ ] Sections follow logical persuasion flow
- [ ] Mobile layout is clean and readable
- [ ] Contrast and focus states are accessible
- [ ] Copy is concise and benefit-driven
- [ ] No placeholder text left unintentionally
- [ ] Footer includes essential links/info
- [ ] index.html is fully self-contained (CSS + JS inlined) — canvas preview works ✓
- [ ] styles.css and script.js also exist as clean separate files — production ready ✓
- [ ] External file refs left as comments in index.html for easy switch to split-file mode ✓

---

## 10) Output Style
When delivering to user:
1. Brief summary of structure and design direction
2. Complete implementation — all three files (index.html self-contained, styles.css, script.js)
3. Note that index.html previews fully in canvas AND is production-switchable via the comments
4. Optional quick wins list (A/B test headline, CTA variant, proof placement)

If user asks for "nice and comprehensive," favor completeness and polished defaults over minimal scaffolding.