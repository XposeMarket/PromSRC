import { decodeCardData } from '../cards/card-utils.js';
const gallery = '.pc-gallery-tile[data-pc-act="lightbox"]';
const control = `[data-pm-media][data-kind="image"], [data-pm-generated-thumb], img.prom-inline-media, .markdown-body img:not(a img, button img), ${gallery}`;

export function installChatImagePreview(root) {
  async function activate(event) {
    const trigger = event.target.closest?.(control);
    const row = trigger?.closest('.pm-msg');
    if (!row || !document.body.classList.contains('pm-mobile-active')) return;
    if (event.type === 'keydown' && (!trigger.matches('img[role="button"]') || !['Enter', ' '].includes(event.key))) return;
    event.preventDefault(); event.stopPropagation();
    trigger.focus({ preventScroll: true });
    const { openMessageGallery } = await import('../cards/gallery-lightbox.js');
    if (row.isConnected && document.body.classList.contains('pm-mobile-active')) openMessageGallery(row, trigger, control, gallery, decodeCardData);
  }
  root.addEventListener('click', activate, true);
  root.addEventListener('keydown', activate, true);
}
