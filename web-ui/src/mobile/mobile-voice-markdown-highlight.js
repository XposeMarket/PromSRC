// Highlight visible words after Markdown has been rendered. Never splice spans into
// raw Markdown: doing so corrupts links, lists, emphasis, and fenced code blocks.
export function highlightMobileVoiceMarkdown(html, progress = 0, doc = globalThis.document) {
  if (!html || !doc?.createElement || !doc?.createTreeWalker) return html;
  const root = doc.createElement('div');
  root.innerHTML = html;
  const walker = doc.createTreeWalker(root, 4); // NodeFilter.SHOW_TEXT
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue?.trim() || node.parentElement?.closest('pre, code, kbd, samp, script, style, svg, button')) continue;
    nodes.push(node);
  }
  const words = nodes.map((textNode) => [...textNode.nodeValue.matchAll(/[^\s]+/gu)]);
  const total = words.reduce((count, matches) => count + matches.length, 0);
  if (!total) return html;
  const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  const spoken = Math.floor(clamped * total);
  let index = 0;
  nodes.forEach((textNode, nodeIndex) => {
    const fragment = doc.createDocumentFragment();
    const value = textNode.nodeValue;
    let offset = 0;
    for (const match of words[nodeIndex]) {
      const start = match.index;
      if (start > offset) fragment.appendChild(doc.createTextNode(value.slice(offset, start)));
      const span = doc.createElement('span');
      span.className = `pm-voice-word pm-voice-word--${index < spoken ? 'spoken' : index === spoken ? 'active' : 'pending'}`;
      span.textContent = match[0];
      fragment.appendChild(span);
      offset = start + match[0].length;
      index += 1;
    }
    if (offset < value.length) fragment.appendChild(doc.createTextNode(value.slice(offset)));
    textNode.parentNode.replaceChild(fragment, textNode);
  });
  return root.innerHTML;
}
