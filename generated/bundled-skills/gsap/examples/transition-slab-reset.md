# HyperFrames transition slabs must reset offscreen

When a transition slab ends onscreen, later scenes can render underneath it even though lint passes.

Initialize transition-only elements hidden and offscreen, animate them only through the transition window, and explicitly reset them before the next scene holds:

```js
const slabs = gsap.utils.toArray('.transition-slab');
gsap.set(slabs, { xPercent: -130, autoAlpha: 0 });

tl.set(slabs, { xPercent: -130, autoAlpha: 1 }, transitionAt)
  .to(slabs, {
    xPercent: 130,
    duration: 0.7,
    ease: 'power3.inOut',
    stagger: 0.06,
  }, transitionAt)
  .set(slabs, { xPercent: -130, autoAlpha: 0 }, transitionAt + 0.76);
```

Inspect representative frames immediately after every transition boundary. This catches persistent overlays that are invisible when reviewing only mid-scene frames.
