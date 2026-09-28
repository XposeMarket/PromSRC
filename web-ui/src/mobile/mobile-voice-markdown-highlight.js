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
  // Progress is a fraction of spoken audio time, not of word count. Weight each
  // word by how long it takes to say (syllables + trailing punctuation pause) so
  // long words and sentence breaks stay aligned with the voice.
  const weights = words.flat().map((match) => mobileVoiceWordSpeechWeight(match[0]));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || total;
  const target = clamped * totalWeight;
  let spoken = 0;
  let acc = 0;
  while (spoken < total && acc + weights[spoken] * 0.5 <= target) {
    acc += weights[spoken];
    spoken += 1;
  }
  if (clamped >= 1) spoken = total;
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

// Relative speaking time of one token. Roughly: one unit per syllable, digits
// read as words, and pauses after commas / sentence ends.
export function mobileVoiceWordSpeechWeight(token = '') {
  const raw = String(token || '');
  const letters = raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let syllables = 0;
  if (/^\p{N}+$/u.test(letters)) {
    syllables = Math.min(8, letters.length * 1.4);
  } else if (letters) {
    const groups = letters.replace(/e$/, '').match(/[aeiouyáéíóúàèìòùäëïöüâêîôû]+/g);
    syllables = Math.max(1, groups ? groups.length : Math.ceil(letters.length / 3));
  } else {
    syllables = 0.3;
  }
  let pause = 0;
  if (/[.!?…]["')\]]*$/.test(raw)) pause = 1.6;
  else if (/[,;:—–-]["')\]]*$/.test(raw)) pause = 0.8;
  return 0.35 + syllables + pause;
}
