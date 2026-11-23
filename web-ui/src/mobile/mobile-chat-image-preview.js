import { openLightbox } from '../cards/card-runtime.js';
import { decodeCardData } from '../cards/card-utils.js';

const gallery = '.pc-gallery-tile[data-pc-act="lightbox"]';
const control = `[data-pm-media][data-kind="image"], [data-pm-generated-thumb], img.prom-inline-media, .markdown-body img:not(a img, button img), ${gallery}`;

export function installChatImagePreview(root) {
  function activate(event) {
    const trigger = event.target.closest?.(control);
    const row = trigger?.closest('.pm-msg');
    if (!row || !document.body.classList.contains('pm-mobile-active')) return;
    if (event.type === 'keydown' && (!trigger.matches('img[role="button"]') || !['Enter', ' '].includes(event.key))) return;
    const items = new Map(), keys = new Map(), galleries = new Map();
    for (const node of row.querySelectorAll(control)) {
      if (node.closest('.pm-msg') !== row || node.parentElement?.closest(control)) continue;
      let item;
      if (node.matches(gallery)) {
        const card = node.closest('.pc-gallery');
        if (!galleries.has(card)) galleries.set(card, decodeCardData(card));
        item = galleries.get(card)?.[Number(node.dataset.i)];
      } else {
        item = { src: node.dataset.src || node.currentSrc || node.src, title: node.dataset.name || node.alt || 'Image' };
      }
      if (!item?.src && !item?.thumb) continue;
      const key = node.dataset.path || node.dataset.workspacePath || item.src || item.thumb;
      keys.set(node, key);
      // The generated hero duplicates the selected thumb; keep the strip's ordering.
      if (node.hasAttribute('data-pm-generated-primary') && node.parentElement.querySelector('[data-pm-generated-thumb]')) continue;
      if (!items.has(key)) items.set(key, item);
    }
    const start = [...items.keys()].indexOf(keys.get(trigger));
    if (start < 0) return;
    event.preventDefault(); event.stopPropagation();
    trigger.focus({ preventScroll: true });
    openLightbox([...items.values()], start);
  }
  root.addEventListener('click', activate, true);
  root.addEventListener('keydown', activate, true);
}
