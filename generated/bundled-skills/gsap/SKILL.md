---
name: "gsap"
description: "GSAP animation reference for HyperFrames compositions. Use for paused timelines, deterministic seeking, tween methods, easing, stagger, labels, nesting, transforms, and performance when a HyperFrames motion task specifically uses GSAP."
---

# GSAP for HyperFrames

Use this as a specialist reference after `hyperframes` routes the task. Read `hyperframes-core` before authoring composition HTML and use `hyperframes-animation` for broader choreography.

## Render contract

1. Create a paused timeline synchronously after the DOM exists.
2. Register it on `window.__timelines` under the exact `data-composition-id`.
3. Let HyperFrames seek the timeline. Do not call `play()` for render-critical motion.
4. Keep loops finite, use seeded randomness, and avoid timers or async timeline construction.
5. Prefer transforms and opacity over layout properties. Use camelCase GSAP properties.

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
tl.from(".title", { y: 48, autoAlpha: 0, duration: 0.6 }, 0);
tl.to(".accent", { scaleX: 1, duration: 0.5 }, 0.25);
window.__timelines.main = tl;
```

Use timeline position parameters and labels instead of delay chains. Be deliberate with `from`/`fromTo` immediate rendering when multiple tweens target the same property.

Read [the detailed guide](references/detailed-guide.md) for tween APIs, eases, transforms, labels, nesting, responsive patterns, and performance details. Read [effects](references/effects.md) only for matching ready-made effects.

Validate with HyperFrames lint/check, snapshots at meaningful times, and a final probe of the rendered video.
