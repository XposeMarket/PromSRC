---
name: Web Animations
description: Web Animations for when creating web pages.
emoji: "🧩"
version: 1.0.0
---

---
name: web-animation
description: >
  Expert guidance for implementing professional, polished animations and interactions in websites and web apps.
  ALWAYS use this skill when the user wants any of: page animations, scroll effects, hover animations, entrance effects,
  parallax, loading animations, micro-interactions, smooth transitions, CSS keyframes, GSAP, Framer Motion, 
  animated backgrounds, particle effects, or any kind of motion design in a web context. Also trigger when building
  a "fancy", "professional", "modern", "premium", or "impressive" website — motion is a core part of that bar.
  Combine with the web-design-system skill for full-stack visual excellence.
---

# Web Animation Skill

This skill makes websites feel *alive*. It provides patterns, code snippets, and decision frameworks for implementing
professional-grade animations across every layer of the stack.

## Quick Decision Framework

Before writing any animation code, answer:
1. **Is this CSS-only sufficient?** (transitions, keyframes, hover states) → yes for most UI micro-interactions
2. **Do I need scroll-based triggers?** → use Intersection Observer or GSAP ScrollTrigger
3. **Is there complex sequencing / timeline control?** → use GSAP
4. **Is this a React project?** → prefer Framer Motion; fall back to CSS for simple cases
5. **Is performance critical?** → stick to `transform` and `opacity` only (GPU composited)

---

## 1. CSS Animation Foundations

### Entrance Animations (reusable utility classes)
```css
/* Base: elements start invisible */
[data-animate] {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
[data-animate].is-visible {
  opacity: 1;
  transform: none;
}

/* Variants */
[data-animate="fade"]          { transform: none; }
[data-animate="slide-left"]    { transform: translateX(-40px); }
[data-animate="slide-right"]   { transform: translateX(40px); }
[data-animate="scale"]         { transform: scale(0.85); }
[data-animate="blur"]          { filter: blur(12px); transform: none; }
[data-animate="blur"].is-visible { filter: blur(0); }

/* Stagger delays via CSS custom properties */
[data-delay="1"] { transition-delay: 0.1s; }
[data-delay="2"] { transition-delay: 0.2s; }
[data-delay="3"] { transition-delay: 0.3s; }
/* ... up to 8 */
```

### Trigger with Intersection Observer
```js
const observer = new IntersectionObserver(
  (entries) => entries.forEach(el => {
    if (el.isIntersecting) {
      el.target.classList.add('is-visible');
      observer.unobserve(el.target); // fire once
    }
  }),
  { threshold: 0.15 }
);
document.querySelectorAll('[data-animate]').forEach(el => observer.observe(el));
```

---

## 2. Hover Animations

### Card Lift + Glow
```css
.card {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.3s ease;
  will-change: transform;
}
.card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: 0 24px 48px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.08);
}
```

### Magnetic Button Effect (JS)
```js
function magneticButton(el, strength = 0.4) {
  el.addEventListener('mousemove', (e) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) * strength;
    const dy = (e.clientY - cy) * strength;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  el.addEventListener('mouseleave', () => {
    el.style.transform = '';
    el.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
  });
}
document.querySelectorAll('.btn-magnetic').forEach(magneticButton);
```

### Underline Reveal
```css
.nav-link {
  position: relative;
}
.nav-link::after {
  content: '';
  position: absolute;
  bottom: -2px; left: 0;
  width: 100%; height: 2px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: right;
  transition: transform 0.35s cubic-bezier(0.76, 0, 0.24, 1);
}
.nav-link:hover::after {
  transform: scaleX(1);
  transform-origin: left;
}
```

### Image Zoom on Hover
```css
.img-wrapper {
  overflow: hidden;
  border-radius: 12px;
}
.img-wrapper img {
  transition: transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  will-change: transform;
}
.img-wrapper:hover img {
  transform: scale(1.08);
}
```

---

## 3. Scroll Animations

### Parallax (pure CSS — no JS)
```css
.parallax-section {
  background-attachment: fixed;         /* desktop only */
  background-size: cover;
  background-position: center;
}
@media (max-width: 768px) {
  .parallax-section { background-attachment: scroll; } /* mobile fix */
}
```

### JS Parallax (more control)
```js
function parallax(selector, speed = 0.3) {
  const el = document.querySelector(selector);
  window.addEventListener('scroll', () => {
    const offset = window.scrollY * speed;
    el.style.transform = `translateY(${offset}px)`;
  }, { passive: true });
}
parallax('.hero-bg', 0.4);
```

### Scroll Progress Bar
```css
.scroll-progress {
  position: fixed; top: 0; left: 0;
  height: 3px; width: 0%;
  background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
  z-index: 9999;
  transition: width 0.1s linear;
}
```
```js
window.addEventListener('scroll', () => {
  const pct = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
  document.querySelector('.scroll-progress').style.width = pct + '%';
}, { passive: true });
```

---

## 4. Page Load & Hero Animations

### Staggered Hero Reveal (CSS)
```css
@keyframes heroFadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: none; }
}

.hero-eyebrow  { animation: heroFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
.hero-headline { animation: heroFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.25s both; }
.hero-sub      { animation: heroFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.4s both; }
.hero-cta      { animation: heroFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.55s both; }
```

### Number Counter Animation
```js
function animateCounter(el, target, duration = 1800) {
  const start = performance.now();
  const update = (time) => {
    const progress = Math.min((time - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 4); // ease out quart
    el.textContent = Math.floor(ease * target).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}
// Usage: animateCounter(document.querySelector('.stat-number'), 12500);
```

---

## 5. Background Animations

### Animated Gradient Mesh
```css
@keyframes gradientShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.gradient-bg {
  background: linear-gradient(-45deg, #1a0533, #0d1b4b, #003d4d, #1a2e00);
  background-size: 400% 400%;
  animation: gradientShift 12s ease infinite;
}
```

### CSS Noise Texture Overlay
```css
.noise-overlay::before {
  content: '';
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 1;
}
```

### Floating Orbs / Blobs
```css
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.35;
  animation: blobFloat 8s ease-in-out infinite;
}
@keyframes blobFloat {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%       { transform: translate(30px, -20px) scale(1.05); }
  66%       { transform: translate(-20px, 15px) scale(0.95); }
}
.blob-1 { width: 500px; height: 500px; background: var(--accent-1); top: -100px; left: -150px; animation-delay: 0s; }
.blob-2 { width: 400px; height: 400px; background: var(--accent-2); bottom: -80px; right: -100px; animation-delay: -3s; }
```

---

## 6. Text Animations

### Character-by-Character Reveal (JS)
```js
function splitTextAnimate(el) {
  const chars = el.textContent.split('').map((c, i) => {
    const span = document.createElement('span');
    span.textContent = c === ' ' ? '\u00A0' : c;
    span.style.cssText = `
      display: inline-block;
      opacity: 0;
      transform: translateY(1em);
      transition: opacity 0.4s ease ${i * 0.03}s, transform 0.4s cubic-bezier(0.16,1,0.3,1) ${i * 0.03}s;
    `;
    return span;
  });
  el.textContent = '';
  chars.forEach(s => el.appendChild(s));
  requestAnimationFrame(() => chars.forEach(s => {
    s.style.opacity = 1;
    s.style.transform = 'none';
  }));
}
```

### Typewriter Effect
```js
function typewriter(el, text, speed = 50) {
  el.textContent = '';
  let i = 0;
  const type = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(type, speed + Math.random() * 30);
    }
  };
  type();
}
```

### Gradient Text
```css
.gradient-text {
  background: linear-gradient(135deg, var(--accent-1) 0%, var(--accent-2) 50%, var(--accent-3) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

---

## 7. Loading & Transition States

### Page Transition Overlay
```css
.page-transition {
  position: fixed; inset: 0;
  background: var(--bg);
  z-index: 99999;
  transform: scaleY(0);
  transform-origin: bottom;
  transition: transform 0.5s cubic-bezier(0.76, 0, 0.24, 1);
}
.page-transition.active {
  transform: scaleY(1);
  transform-origin: top;
}
```

### Skeleton Loader
```css
@keyframes shimmer {
  from { background-position: -200% 0; }
  to   { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, #1a1a1a 25%, #2a2a2a 50%, #1a1a1a 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite linear;
  border-radius: 6px;
}
```

---

## 8. Performance Rules

Always follow these to keep animations smooth:

| DO ✅ | AVOID ❌ |
|---|---|
| Animate `transform` and `opacity` | Animate `width`, `height`, `top`, `left` |
| Use `will-change: transform` on animated elements | Overuse `will-change` (memory cost) |
| Use `passive: true` on scroll listeners | Blocking scroll handlers |
| Use `cubic-bezier` for natural easing | Linear or ease-in-out for everything |
| Use `requestAnimationFrame` for JS animations | `setInterval` for animations |
| Test on mobile / low-end devices | Only test on your fast dev machine |
| Respect `prefers-reduced-motion` | Force animations on everyone |

### Reduced Motion Support (always include)
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 9. Third-Party Libraries (when to use)

| Library | Best for | CDN |
|---|---|---|
| **GSAP** | Complex timelines, scroll-linked, SVG morphing | `gsap.com/docs` |
| **Framer Motion** | React animations, layout animations, gestures | `npm i framer-motion` |
| **AOS** | Simple scroll-reveal with minimal setup | `unpkg.com/aos` |
| **Lottie** | After Effects-based vector animations | `lottiefiles.com` |
| **Three.js** | 3D WebGL backgrounds, particle systems | `threejs.org` |
| **tsParticles** | Particle backgrounds (lightweight) | `cdn.jsdelivr.net` |

### GSAP Quick Setup (CDN)
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js"></script>
```
```js
gsap.registerPlugin(ScrollTrigger);

gsap.fromTo('.hero-title',
  { opacity: 0, y: 60 },
  { opacity: 1, y: 0, duration: 1, ease: 'power3.out', delay: 0.2 }
);

gsap.from('.feature-card', {
  scrollTrigger: { trigger: '.features', start: 'top 80%' },
  opacity: 0, y: 40, stagger: 0.15, duration: 0.8, ease: 'power2.out'
});
```

---

## Reference Files
- `references/easing-cheatsheet.md` — Full list of recommended cubic-bezier values by feel
- `references/animation-patterns.md` — 20+ ready-to-paste animation patterns for common UI components