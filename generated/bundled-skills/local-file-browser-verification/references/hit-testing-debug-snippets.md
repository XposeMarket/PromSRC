# Hit-Testing Debug Snippets

Use these only when screenshots/snapshots show an element but real clicking fails or behavior is unclear.

## Element at center of target

```js
const target = document.querySelector('#startBtn, button, [role="button"]');
const rect = target?.getBoundingClientRect();
const point = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
const top = point ? document.elementFromPoint(point.x, point.y) : null;
({
  target: target?.outerHTML,
  rect,
  point,
  topAtCenter: top?.outerHTML,
  topId: top?.id,
  topClass: top?.className
});
```

## Inspect likely overlay styles

```js
[...document.querySelectorAll('body *')]
  .map(el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      id: el.id,
      className: el.className,
      position: s.position,
      zIndex: s.zIndex,
      pointerEvents: s.pointerEvents,
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height }
    };
  })
  .filter(x => x.rect.w > 100 && x.rect.h > 100)
  .sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0));
```

## Listener sanity check

```js
const btn = document.querySelector('#startBtn, button');
btn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
```

Do not use synthetic dispatch as proof of user success. It is only a diagnostic fallback. Real browser/desktop click/tap verification is still required.
