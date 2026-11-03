// Keep the original live form nodes (including focus, selection and controller state)
// when unrelated task progress causes a board refresh. Never retain resolved cards.
export function preserveRequestCards(root, entries) {
  const saved = new Map();
  const signatureFor = entry => {
    const p = entry.item?.payload || entry;
    return JSON.stringify(['question', 'browser_login'].includes(entry.kind || entry.item?.kind)
      ? { id:p.id, kind:entry.kind || entry.item?.kind, status:p.status, sessionId:p.sessionId || entry.sessionId, questions:p.questions, loginHandoff:p.loginHandoff }
      : p);
  };
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const selection = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  for (const entry of entries) {
    const node = [...root.querySelectorAll('[data-ny-entry]')].find(el => el.dataset.nyEntry === entry.id);
    const signature = signatureFor(entry);
    if (node && node.dataset.requestSignature === signature) saved.set(entry.id, node);
  }
  return () => {
    for (const entry of entries) {
      const node = [...root.querySelectorAll('[data-ny-entry]')].find(el => el.dataset.nyEntry === entry.id);
      if (!node) continue;
      const previous = saved.get(entry.id);
      if (previous) node.replaceWith(previous);
      else node.dataset.requestSignature = signatureFor(entry);
    }
    if (active?.isConnected) {
      active.focus({ preventScroll: true });
      if (selection) active.setSelectionRange(...selection);
    }
  };
}
