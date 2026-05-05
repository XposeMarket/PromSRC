# Animation Patterns Reference

Ready-to-paste patterns for common UI components. Each is self-contained.

## 1. Sticky Nav That Changes on Scroll
```css
.navbar {
  position: fixed; top: 0; width: 100%;
  padding: 24px 48px;
  transition: padding 0.4s ease, background 0.4s ease, backdrop-filter 0.4s ease;
}
.navbar.scrolled {
  padding: 12px 48px;
  background: rgba(10, 10, 10, 0.85);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
```
```js
window.addEventListener('scroll', () => {
  document.querySelector('.navbar').classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });
```

## 2. Reveal Grid (staggered)
```html
<div class="grid-reveal">
  <div data-animate data-delay="1">Card 1</div>
  <div data-animate data-delay="2">Card 2</div>
  <div data-animate data-delay="3">Card 3</div>
</div>
```

## 3. Cursor Glow Effect
```js
const glow = document.createElement('div');
glow.className = 'cursor-glow';
document.body.appendChild(glow);
window.addEventListener('mousemove', e => {
  glow.style.left = e.clientX + 'px';
  glow.style.top  = e.clientY + 'px';
});
```
```css
.cursor-glow {
  pointer-events: none;
  position: fixed;
  width: 400px; height: 400px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(120,80,255,0.12) 0%, transparent 70%);
  transform: translate(-50%, -50%);
  transition: left 0.15s ease, top 0.15s ease;
  z-index: 9;
}
```

## 4. Image Reveal (wipe effect)
```css
.img-reveal {
  position: relative;
  overflow: hidden;
}
.img-reveal::after {
  content: '';
  position: absolute; inset: 0;
  background: var(--bg);
  transform: scaleX(1);
  transform-origin: right;
  transition: transform 0.8s cubic-bezier(0.76, 0, 0.24, 1);
}
.img-reveal.is-visible::after {
  transform: scaleX(0);
}
```

## 5. Button Ripple Effect
```js
document.querySelectorAll('.btn-ripple').forEach(btn => {
  btn.addEventListener('click', e => {
    const ripple = document.createElement('span');
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `
      position: absolute; border-radius: 50%;
      width: ${size}px; height: ${size}px;
      left: ${e.clientX - rect.left - size/2}px;
      top: ${e.clientY - rect.top - size/2}px;
      background: rgba(255,255,255,0.25);
      transform: scale(0);
      animation: ripple 0.6s ease-out forwards;
      pointer-events: none;
    `;
    btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});
```
```css
@keyframes ripple {
  to { transform: scale(2.5); opacity: 0; }
}
```

## 6. Horizontal Scroll Section
```css
.h-scroll-wrapper {
  overflow-x: auto;
  display: flex;
  gap: 24px;
  padding: 24px;
  scrollbar-width: none;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}
.h-scroll-wrapper::-webkit-scrollbar { display: none; }
.h-scroll-item {
  flex: 0 0 320px;
  scroll-snap-align: start;
}
```

## 7. Accordion with Smooth Height
```css
.accordion-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1),
              padding 0.4s ease;
}
.accordion-body.open {
  max-height: 500px; /* safe upper limit */
}
```

## 8. Tilt Effect on Cards (3D perspective)
```js
function tiltCard(el) {
  el.addEventListener('mousemove', e => {
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top)  / rect.height - 0.5;
    el.style.transform = `perspective(800px) rotateY(${x * 12}deg) rotateX(${-y * 12}deg) scale(1.02)`;
  });
  el.addEventListener('mouseleave', () => {
    el.style.transform = '';
    el.style.transition = 'transform 0.6s ease';
  });
}
document.querySelectorAll('.tilt-card').forEach(tiltCard);
```

## 9. Text Scramble Effect
```js
class TextScramble {
  constructor(el) {
    this.el = el;
    this.chars = '!<>-_\\/[]{}—=+*^?#________';
    this.update = this.update.bind(this);
  }
  setText(newText) {
    const old = this.el.innerText;
    const len = Math.max(old.length, newText.length);
    const promise = new Promise(r => this.resolve = r);
    this.queue = Array.from({ length: len }, (_, i) => ({
      from: old[i] || '',
      to: newText[i] || '',
      start: Math.floor(Math.random() * 10),
      end: Math.floor(Math.random() * 10) + 10,
    }));
    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;
    this.update();
    return promise;
  }
  update() {
    let output = '', complete = 0;
    this.queue.forEach(({ from, to, start, end, char }, i) => {
      if (this.frame >= end) { complete++; output += to; }
      else if (this.frame >= start) {
        if (!char || Math.random() < 0.28)
          this.queue[i].char = this.chars[Math.floor(Math.random() * this.chars.length)];
        output += `<span class="scramble-char">${this.queue[i].char}</span>`;
      } else { output += from; }
    });
    this.el.innerHTML = output;
    if (complete === this.queue.length) this.resolve();
    else this.frameRequest = requestAnimationFrame(this.update), this.frame++;
  }
}
```

## 10. Marquee / Infinite Scroll Ticker
```css
.marquee {
  overflow: hidden;
  white-space: nowrap;
}
.marquee-inner {
  display: inline-flex;
  animation: marquee 20s linear infinite;
}
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.marquee:hover .marquee-inner { animation-play-state: paused; }
```
```html
<!-- Duplicate items so it loops seamlessly -->
<div class="marquee">
  <div class="marquee-inner">
    <span>Item 1</span><span>Item 2</span><!-- ... -->
    <span>Item 1</span><span>Item 2</span><!-- duplicate -->
  </div>
</div>
```

## 11. Modal with Smooth Backdrop
```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(6px);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.modal-overlay.active {
  opacity: 1;
  pointer-events: all;
}
.modal-box {
  transform: scale(0.92) translateY(20px);
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
  opacity: 0;
}
.modal-overlay.active .modal-box {
  transform: none;
  opacity: 1;
}
```

## 12. Smooth Anchor Scrolling
```js
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
```

## 13. Sticky Section Headers
```css
.sticky-label {
  position: sticky;
  top: 80px; /* below navbar */
  z-index: 10;
  padding: 8px 0;
  background: var(--bg);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
```

## 14. Video Background Hero
```html
<section class="video-hero">
  <video autoplay muted loop playsinline class="video-bg">
    <source src="hero.mp4" type="video/mp4">
  </video>
  <div class="video-overlay"></div>
  <div class="hero-content">...</div>
</section>
```
```css
.video-hero { position: relative; overflow: hidden; height: 100vh; }
.video-bg   { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.video-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.7));
}
.hero-content { position: relative; z-index: 2; }
```

## 15. Split-Screen Hover
```css
.split-screen { display: flex; }
.split-panel {
  flex: 1;
  transition: flex 0.5s cubic-bezier(0.76, 0, 0.24, 1);
  overflow: hidden;
}
.split-screen:hover .split-panel { flex: 0.6; }
.split-screen:hover .split-panel:hover { flex: 1.4; }
```