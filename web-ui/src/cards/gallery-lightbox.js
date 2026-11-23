export function openLightbox(items, start = 0) {
  if (!items?.length || document.querySelector('dialog.pc-lightbox[open]')) return;
  let i = Math.max(0, Math.min(items.length - 1, start));
  const box = document.createElement('dialog');
  box.className = 'pc-lightbox';
  box.setAttribute('aria-label', 'Image gallery');
  const multi = items.length > 1;
  const nav = (cls, label, glyph) => multi ? `<button type="button" class="pc-lb-nav ${cls}" aria-label="${label}">${glyph}</button>` : '';
  box.innerHTML = `<button type="button" class="pc-lb-close" aria-label="Close" autofocus>×</button>${nav('prev','Previous','‹')}<figure><img alt="" referrerpolicy="no-referrer"><figcaption aria-live="polite"></figcaption></figure>${nav('next','Next','›')}`;
  const style = document.createElement('style');
  style.textContent = `.pc-lightbox{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:24px}
.pc-lightbox figure{margin:0;max-width:min(1100px,92vw);display:grid;gap:8px}.pc-lightbox img{max-width:100%;max-height:80vh;object-fit:contain;border-radius:8px}
.pc-lightbox figcaption{color:#ddd;font-size:13px;display:flex;justify-content:space-between;gap:12px}.pc-lightbox a{color:#fff}
.pc-lb-close,.pc-lb-nav{position:absolute;background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:50%;width:42px;height:42px;font-size:24px;cursor:pointer}
.pc-lb-close{top:16px;right:16px}.pc-lb-nav.prev{left:16px}.pc-lb-nav.next{right:16px}
dialog.pc-lightbox{box-sizing:border-box;margin:0;border:0;width:100%;height:100%;max-width:none;max-height:none;overscroll-behavior:contain}dialog.pc-lightbox:not([open]){display:none}dialog.pc-lightbox::backdrop{background:transparent}.pc-lightbox img{touch-action:pan-y pinch-zoom}.pc-lightbox figcaption{overflow-wrap:anywhere}.pc-lightbox figcaption span{flex:none}.pc-lightbox .pc-lb-close{top:max(16px,env(safe-area-inset-top));right:max(16px,env(safe-area-inset-right))}`;
  box.append(style);
  const image = box.querySelector('img'), caption = box.querySelector('figcaption');
  const paint = () => {
    const it = items[i];
    image.src = it.src || it.thumb;
    image.alt = it.title || '';
    caption.textContent = it.title || '';
    if (it.page) {
      const link = document.createElement('a');
      try { const url = new URL(it.page, document.baseURI); if (['http:', 'https:'].includes(url.protocol)) link.href = url.href; } catch {}
      if (link.href) { link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${it.source || 'Source'} ↗`; caption.append(' · ', link); }
    }
    if (multi) { const count = document.createElement('span'); count.textContent = `${i + 1} / ${items.length}`; caption.append(count); }
  };
  const close = () => box.close();
  const step = d => { i = (i + d + items.length) % items.length; paint(); };
  box.addEventListener('click', e => {
    if (e.target === box || e.target.closest('.pc-lb-close')) close();
    else if (e.target.closest('.pc-lb-nav.prev')) step(-1);
    else if (e.target.closest('.pc-lb-nav.next')) step(1);
  });
  box.addEventListener('keydown', e => {
    if (!multi || !['ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowRight' ? 1 : -1);
  });
  // Swipe on the photo only. Leave pinch-zoom, vertical gestures and source links alone.
  let origin;
  image.addEventListener('touchstart', e => { origin = e.touches.length === 1 ? e.touches[0] : null; }, { passive: true });
  image.addEventListener('touchcancel', () => { origin = null; });
  image.addEventListener('touchend', e => {
    if (!origin || !multi) return;
    const dx = e.changedTouches[0].clientX - origin.clientX, dy = e.changedTouches[0].clientY - origin.clientY;
    origin = null;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.3) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  window.addEventListener('hashchange', close);
  box.addEventListener('close', () => { window.removeEventListener('hashchange', close); box.remove(); }, { once: true });
  paint(); document.body.append(box); box.showModal();
}

export function openMessageGallery(row, trigger, control, gallery, decodeCardData) {
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
    openLightbox([...items.values()], start);
}
