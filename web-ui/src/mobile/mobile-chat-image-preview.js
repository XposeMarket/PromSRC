// Resolve images from the current row at tap time, including streamed/restored rows.
const control = '[data-pm-media][data-kind="image"], [data-pm-generated-thumb], img.prom-inline-media, .markdown-body img:not(a img, button img)';
const key = n => n.dataset.path || n.dataset.workspacePath || n.dataset.src || n.currentSrc || n.src;

export function installChatImagePreview(root, openCanvas) {
  function activate(event) {
    const trigger = event.target.closest?.(control);
    const row = trigger?.closest('.pm-msg');
    if (!row || !document.body.classList.contains('pm-mobile-active')) return;
    if (event.type === 'keydown' && (!trigger.matches('img[role="button"]') || !['Enter', ' '].includes(event.key))) return;
    const items = new Map();
    for (const node of row.querySelectorAll(control)) {
      if (node.closest('.pm-msg') !== row || node.parentElement?.closest(control)) continue;
      // Generated batches repeat the selected thumbnail as their hero.
      if (node.hasAttribute('data-pm-generated-primary') && node.parentElement.querySelector('[data-pm-generated-thumb]')) continue;
      const src = node.dataset.src || node.currentSrc || node.src;
      if (src && !items.has(key(node))) items.set(key(node), { kind: 'image', src, path: node.dataset.path || node.dataset.workspacePath || '', download: node.dataset.download || src, name: node.dataset.name || node.alt || 'Image' });
    }
    const start = [...items.keys()].indexOf(key(trigger));
    if (start < 0) return;
    event.preventDefault();
    event.stopPropagation();
    showPreview([...items.values()], start, trigger, openCanvas);
  }
  // Before per-card handlers and the shell's delegated Canvas fallback.
  root.addEventListener('click', activate, true);
  root.addEventListener('keydown', activate, true);
}

function showPreview(items, start, trigger, openCanvas) {
  const dialog = document.createElement('dialog');
  dialog.className = 'pm-chat-image-dialog';
  dialog.setAttribute('aria-label', 'Image preview');
  dialog.innerHTML = `<header><strong></strong><button type="button" aria-label="Close preview" autofocus>×</button></header><div class="pm-chat-image-track"></div><footer><button type="button" class="to-canvas">Open in Canvas</button><div class="pm-chat-image-nav"><button type="button" aria-label="Previous image">‹</button><span aria-live="polite"></span><button type="button" aria-label="Next image">›</button></div></footer>`;
  const track = dialog.querySelector('.pm-chat-image-track');
  const [close, canvas, prev, next] = dialog.querySelectorAll('button');
  const label = dialog.querySelector('strong');
  const counter = dialog.querySelector('[aria-live]');
  for (const item of items) {
    const img = new Image();
    img.alt = item.name;
    img.loading = 'lazy';
    img.src = item.src;
    track.append(img);
  }
  let index = start;
  function display(i) {
    index = Math.min(items.length - 1, Math.max(0, i));
    label.textContent = items[index].name;
    counter.textContent = `${index + 1} / ${items.length}`;
    prev.disabled = index === 0;
    next.disabled = index === items.length - 1;
  }
  const go = i => { display(i); track.scrollLeft = track.clientWidth * index; };
  track.onscroll = () => { if (track.clientWidth) display(Math.round(track.scrollLeft / track.clientWidth)); };
  prev.onclick = () => go(index - 1);
  next.onclick = () => go(index + 1);
  dialog.querySelector('.pm-chat-image-nav').hidden = items.length === 1;
  close.onclick = () => dialog.close();
  canvas.onclick = () => { dialog.close(); openCanvas(items[index]); };
  dialog.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    go(index + (event.key === 'ArrowRight' ? 1 : -1));
  };
  dialog.onclick = event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  };
  const dismiss = () => dialog.close();
  window.addEventListener('hashchange', dismiss, { once: true });
  dialog.onclose = () => { window.removeEventListener('hashchange', dismiss); dialog.remove(); };
  trigger.focus({ preventScroll: true });
  document.body.append(dialog);
  dialog.showModal();
  go(start);
}
