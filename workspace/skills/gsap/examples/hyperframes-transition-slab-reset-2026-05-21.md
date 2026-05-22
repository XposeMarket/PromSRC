# Example: HyperFrames transition slabs must reset offscreen (2026-05-21)

Observed while fixing `hyperframes-promo-test/index.html` after a rendered HyperFrames promo was visually buried by transition slabs.

## Failure mode

A transition slab/bar animates across the screen but its final transform state remains onscreen after the transition. Later scenes render underneath the slab, so the whole video appears overlaid or blocked even though lint/inspect may not flag the intent mistake.

## Safer pattern

- Initialize transition-only elements hidden/offscreen with `autoAlpha: 0` and an offscreen transform.
- Animate them only during the transition window.
- Add a completion/reset step that sends them back offscreen and hidden before the next scene holds.
- Prefer explicit `gsap.set(...)` cleanup over relying on the end state of a `to()` tween.

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

## QA note

After patching, render or inspect representative frames immediately after each transition boundary, not only mid-scene. This catches persistent overlay elements that only appear because a prior tween left final state behind.

## Evidence

- `audit/chats/transcripts/mobile_mpey71s7_yol8uo.md:38-57`: Raul reported the promo was "super fire" but overlaid; Prometheus traced the issue to transition slabs ending onscreen and fixed/rendered a clean version.
- `Brain/skill-gardener/2026-05-21/workflow-episodes.jsonl:1`: captured the exact repair workflow and CLI verification attempts.
