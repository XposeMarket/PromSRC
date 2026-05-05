---
name: web-design-skill
description: Front End UI Design Skill
emoji: "🧩"
version: 1.0.0
---

---
name: web-design-system
description: >
  Master-level visual design system for building stunning, professional websites with premium aesthetics.
  ALWAYS use this skill when creating any website, landing page, portfolio, SaaS page, or web UI where visual
  quality matters. Triggers on: "fancy", "beautiful", "modern", "premium", "professional", "impressive",
  "polished", "luxury", "sleek", or "stunning" websites. Also triggers for any request involving background
  images, hero sections, color palettes, typography choices, layout design, dark/light themes, glassmorphism,
  gradients, or overall site aesthetic. Pair with web-animation skill for motion on top of great design.
---

# Web Design System Skill

A complete design decision framework for building websites that look like they were made by a world-class studio.
This skill covers everything visual: layout, color, typography, imagery, backgrounds, spacing, and UI patterns.

---

## Step 0: Design Brief (always answer these first)

Before writing a single line of code, commit to answers:

1. **Vibe word** — pick one: *Luxury / Raw / Playful / Editorial / Technical / Organic / Futuristic / Minimal / Bold*
2. **Color mode** — Dark or Light? (dark is more forgiving and dramatic; light feels clean/modern)
3. **Primary audience** — Who sees this? (affects vocabulary, complexity, font choices)
4. **One unforgettable element** — What will the visitor remember?

---

## 1. Color Palettes

### The 60–30–10 Rule
- **60%** — Background / large surfaces (near-black, deep navy, off-white, warm cream)
- **30%** — Secondary (cards, sections, subtle contrast)
- **10%** — Accent (the ONE color that pops; use sparingly)

### CSS Variable Setup (always use this pattern)
```css
:root {
  /* Backgrounds */
  --bg-primary:   #0a0a0f;   /* deepest bg */
  --bg-secondary: #12121a;   /* cards, elevated surfaces */
  --bg-tertiary:  #1c1c28;   /* hover states, borders */

  /* Text */
  --text-primary:   #f0f0f5;
  --text-secondary: #9090a0;
  --text-muted:     #55556a;

  /* Accents */
  --accent-1: #7c5cfc;       /* primary accent */
  --accent-2: #fc5c7d;       /* secondary accent (gradients, highlights) */
  --accent-glow: rgba(124, 92, 252, 0.25);

  /* Semantic */
  --border: rgba(255,255,255,0.07);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
  --shadow-md: 0 8px 32px rgba(0,0,0,0.4);
  --shadow-lg: 0 24px 64px rgba(0,0,0,0.5);
  --shadow-glow: 0 0 40px var(--accent-glow);

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-xl: 32px;

  /* Transitions */
  --transition-fast: 0.15s ease;
  --transition-base: 0.3s cubic-bezier(0.16,1,0.3,1);
  --transition-slow: 0.6s cubic-bezier(0.16,1,0.3,1);
}
```

### Signature Palette Presets (pick one, then customize)

#### 1. Deep Space (dark, dramatic, premium tech)
```css
--bg-primary: #04040a; --bg-secondary: #0d0d1a; --bg-tertiary: #161628;
--accent-1: #6e56cf; --accent-2: #3d9cf5; --text-primary: #ededf5;
```

#### 2. Obsidian (pure dark, editorial, luxury)
```css
--bg-primary: #080808; --bg-secondary: #111111; --bg-tertiary: #1e1e1e;
--accent-1: #e8c87a; --accent-2: #c85d3c; --text-primary: #f5f5f0;
```

#### 3. Midnight Forest (dark green, organic premium)
```css
--bg-primary: #060e09; --bg-secondary: #0e1c12; --bg-tertiary: #1a2e1e;
--accent-1: #4ade80; --accent-2: #86efac; --text-primary: #ecfdf5;
```

#### 4. Arctic Light (light, clean, modern SaaS)
```css
--bg-primary: #fafafa; --bg-secondary: #ffffff; --bg-tertiary: #f0f0f4;
--accent-1: #2563eb; --accent-2: #7c3aed; --text-primary: #0f0f14;
```

#### 5. Warm Sand (light, editorial, lifestyle)
```css
--bg-primary: #faf7f2; --bg-secondary: #ffffff; --bg-tertiary: #f0ebe2;
--accent-1: #c2410c; --accent-2: #78350f; --text-primary: #1c1009;
```

---

## 2. Typography

### Font Pairing Strategy
Always use **2 fonts max**: one display (headlines) + one body (reading). Never use Inter, Roboto, or Arial.

### Recommended Pairings

| Display (headlines) | Body (text) | Vibe |
|---|---|---|
| Playfair Display | Lato | Editorial, luxury |
| Syne | DM Sans | Modern, geometric |
| Clash Display | Satoshi | Tech, bold |
| Cormorant Garamond | Jost | Elegant, high-fashion |
| Space Grotesk | Figtree | Clean, developer-friendly |
| Bebas Neue | Nunito | Bold, sporty |
| Fraunces | Source Serif Pro | Organic, magazine |
| Monument Extended | Inter | Brutalist, statement |

### Google Fonts Import Pattern
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap" rel="stylesheet">
```

### Type Scale (CSS)
```css
/* Fluid responsive typography — scales with viewport */
:root {
  --text-xs:   clamp(0.7rem,  0.7rem  + 0.2vw, 0.8rem);
  --text-sm:   clamp(0.85rem, 0.85rem + 0.2vw, 0.95rem);
  --text-base: clamp(1rem,    1rem    + 0.2vw, 1.1rem);
  --text-lg:   clamp(1.15rem, 1.1rem  + 0.4vw, 1.3rem);
  --text-xl:   clamp(1.3rem,  1.2rem  + 0.6vw, 1.6rem);
  --text-2xl:  clamp(1.6rem,  1.4rem  + 1vw,   2.2rem);
  --text-3xl:  clamp(2rem,    1.6rem  + 2vw,   3rem);
  --text-4xl:  clamp(2.5rem,  1.8rem  + 3.5vw, 5rem);
  --text-hero: clamp(3rem,    2rem    + 6vw,   8rem);
}

body { font-family: 'DM Sans', sans-serif; font-size: var(--text-base); }
h1, h2, h3 { font-family: 'Syne', sans-serif; }

.headline   { font-size: var(--text-4xl); font-weight: 800; line-height: 1.05; letter-spacing: -0.03em; }
.subheading { font-size: var(--text-xl);  font-weight: 400; line-height: 1.5; color: var(--text-secondary); }
.eyebrow    { font-size: var(--text-sm);  font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-1); }
```

---

## 3. Layout Patterns

### CSS Grid System
```css
.container {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 clamp(16px, 5vw, 80px);
}

/* Responsive grid */
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
.grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; }
.grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; }

/* Bento grid */
.bento {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-template-rows: auto;
  gap: 20px;
}
.bento-wide  { grid-column: span 8; }
.bento-tall  { grid-row: span 2; }
.bento-small { grid-column: span 4; }
```

### Section Spacing
```css
section { padding: clamp(60px, 10vw, 140px) 0; }
.section-sm { padding: clamp(40px, 6vw, 80px) 0; }
.section-lg { padding: clamp(80px, 14vw, 200px) 0; }
```

---

## 4. Background Treatments

### Full-Page Gradient Background
```css
body {
  background:
    radial-gradient(ellipse 80% 50% at 20% -10%, rgba(124,92,252,0.25) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(252,92,125,0.15) 0%, transparent 60%),
    var(--bg-primary);
}
```

### Hero with Background Image
```css
.hero {
  position: relative;
  min-height: 100vh;
  background:
    linear-gradient(to bottom, rgba(4,4,10,0.5) 0%, rgba(4,4,10,0.85) 70%, var(--bg-primary) 100%),
    url('hero-bg.jpg') center/cover no-repeat;
}
```

### Section Dividers (instead of boring hr)
```css
/* Diagonal cut */
.section-diagonal::after {
  content: '';
  position: absolute; bottom: -60px; left: 0;
  width: 100%; height: 120px;
  background: var(--bg-secondary);
  clip-path: polygon(0 0, 100% 60px, 100% 120px, 0 120px);
}

/* Curved bottom */
.section-curved::after {
  content: '';
  position: absolute; bottom: -1px; left: 0;
  width: 100%; height: 80px;
  background: var(--bg-primary);
  clip-path: ellipse(55% 100% at 50% 100%);
}

/* Wave SVG divider */
/* Use inline SVG: <svg viewBox="0 0 1440 80" preserveAspectRatio="none"> */
/* <path d="M0,40 C360,80 1080,0 1440,40 L1440,80 L0,80 Z" fill="var(--bg-next)"/> */
```

### Glassmorphism Cards
```css
.glass-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06);
}
```

### Grain / Noise Texture (adds premium feel)
```css
/* Add to body or any section */
.grain::before {
  content: '';
  position: fixed; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 9999;
  opacity: 1;
}
```

---

## 5. Component Library

### Hero Section
```html
<section class="hero">
  <div class="container hero-inner">
    <span class="eyebrow">Introducing</span>
    <h1 class="headline">The future of <br><span class="gradient-text">everything</span></h1>
    <p class="subheading">One sentence that explains the value prop. Bold. Clear. Memorable.</p>
    <div class="hero-cta-group">
      <a href="#" class="btn btn-primary btn-magnetic">Get started →</a>
      <a href="#" class="btn btn-ghost">See how it works</a>
    </div>
  </div>
</section>
```

### Button System
```css
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 14px 28px;
  font-family: inherit; font-weight: 600; font-size: var(--text-sm);
  border-radius: var(--radius-md);
  border: none; cursor: pointer;
  text-decoration: none;
  transition: all var(--transition-base);
  letter-spacing: 0.01em;
  position: relative; overflow: hidden;
}
.btn-primary {
  background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
  color: white;
  box-shadow: 0 4px 20px var(--accent-glow);
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 30px var(--accent-glow);
  filter: brightness(1.1);
}
.btn-ghost {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border);
}
.btn-ghost:hover {
  background: var(--bg-tertiary);
  border-color: rgba(255,255,255,0.15);
}
.btn-outline {
  background: transparent;
  color: var(--accent-1);
  border: 1px solid var(--accent-1);
}
.btn-outline:hover {
  background: var(--accent-1);
  color: white;
}
```

### Feature Cards
```css
.feature-card {
  padding: 32px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  transition: transform var(--transition-base), border-color var(--transition-base), box-shadow var(--transition-base);
}
.feature-card:hover {
  transform: translateY(-6px);
  border-color: rgba(255,255,255,0.15);
  box-shadow: var(--shadow-lg);
}
.feature-icon {
  width: 48px; height: 48px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 20px;
}
```

### Navigation Bar
```css
.navbar {
  position: fixed; top: 0; left: 0; right: 0;
  height: 72px;
  display: flex; align-items: center;
  padding: 0 clamp(20px, 5vw, 80px);
  z-index: 100;
  transition: background 0.4s ease, backdrop-filter 0.4s ease;
}
.navbar.scrolled {
  background: rgba(4,4,10,0.85);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
}
.nav-links {
  display: flex; gap: 40px; list-style: none;
  margin: 0 auto; padding: 0;
}
.nav-link {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: var(--text-sm); font-weight: 500;
  transition: color var(--transition-fast);
}
.nav-link:hover { color: var(--text-primary); }
```

### Stats / Metrics Row
```css
.stats-grid {
  display: flex; flex-wrap: wrap;
  gap: 1px;
  background: var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.stat-item {
  flex: 1; min-width: 180px;
  padding: 40px 32px;
  background: var(--bg-secondary);
  text-align: center;
}
.stat-number {
  font-size: var(--text-4xl);
  font-weight: 800;
  font-family: var(--font-display);
  background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

### Testimonial Card
```css
.testimonial-card {
  padding: 40px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}
.testimonial-quote {
  font-size: var(--text-lg);
  line-height: 1.7;
  color: var(--text-primary);
  margin-bottom: 24px;
}
.testimonial-quote::before { content: '"'; font-size: 3em; color: var(--accent-1); line-height: 0; }
.testimonial-author { display: flex; align-items: center; gap: 14px; }
.author-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
```

### Footer
```css
.footer {
  padding: 80px 0 40px;
  border-top: 1px solid var(--border);
}
.footer-grid {
  display: grid;
  grid-template-columns: 2fr repeat(3, 1fr);
  gap: 48px;
}
@media (max-width: 768px) { .footer-grid { grid-template-columns: 1fr 1fr; } }
.footer-links { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.footer-link { color: var(--text-secondary); text-decoration: none; font-size: var(--text-sm); transition: color 0.2s; }
.footer-link:hover { color: var(--text-primary); }
```

---

## 6. Responsive Design

### Breakpoints
```css
/* Mobile first approach */
/* sm: 640px, md: 768px, lg: 1024px, xl: 1280px, 2xl: 1536px */

@media (max-width: 768px) {
  .hide-mobile { display: none; }
  .stack-mobile { flex-direction: column; }
  .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
  .footer-grid { grid-template-columns: 1fr; }
  .nav-links { display: none; } /* use hamburger menu */
}

@media (min-width: 1280px) {
  .container { max-width: 1200px; }
}
```

---

## 7. Dark Mode Toggle (optional)
```js
const toggle = document.querySelector('.theme-toggle');
const root = document.documentElement;
toggle?.addEventListener('click', () => {
  const isDark = root.getAttribute('data-theme') === 'dark';
  root.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
});
// Init
root.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
```
```css
[data-theme="light"] {
  --bg-primary: #fafafa;
  --bg-secondary: #ffffff;
  --text-primary: #0f0f14;
  --text-secondary: #555564;
  --border: rgba(0,0,0,0.08);
}
```

---

## 8. Images & Media

### Image Guidelines
- Use `object-fit: cover` for all hero/card images
- Always include `loading="lazy"` on below-fold images
- Add a subtle overlay for text on image readability
- Use `aspect-ratio` to prevent layout shift

```css
.img-cover {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.img-card {
  width: 100%;
  aspect-ratio: 16/9;
  object-fit: cover;
  border-radius: var(--radius-md);
}
.img-portrait {
  width: 100%;
  aspect-ratio: 3/4;
  object-fit: cover;
}
```

### Free Image Sources (for reference to agent)
- **Unsplash** — `https://source.unsplash.com/1200x800/?keyword`
- **Picsum** — `https://picsum.photos/1200/800` (random)
- **Placeholder SVG** — `https://placehold.co/600x400/1a1a2e/ffffff?text=Image`

---

## 9. Reset & Base Styles
Always include this at the top:
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body {
  font-family: var(--font-body, system-ui);
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
img, video { max-width: 100%; height: auto; }
a { color: inherit; }
button { font: inherit; }
```

---

## 10. Full HTML Template
See `references/html-template.html` for a complete starter template combining all patterns.

## Reference Files
- `references/html-template.html` — Full starter HTML with all systems wired up
- `references/color-palettes.md` — 12 curated palettes with hex codes