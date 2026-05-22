# Pretext Fallback Layout Shim

Use this only when the Creative HTML Motion runtime cannot import `@chenglou/pretext` from ESM or when prototyping a clip that can later swap in real Pretext.

This shim is not a full Pretext replacement. It preserves the important creative contract: deterministic line breaks and grapheme anchor positions before rendering.

```html
<script>
window.PretextLike = (() => {
  function segment(text) {
    if (Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment);
    }
    return Array.from(text);
  }

  function wrapLines(ctx, text, maxWidth, lineHeight) {
    const words = text.split(/(\s+)/).filter(Boolean);
    const lines = [];
    let line = '';

    for (const token of words) {
      const test = line + token;
      if (line && ctx.measureText(test).width > maxWidth && !/^\s+$/.test(token)) {
        lines.push({ text: line.trimEnd(), width: ctx.measureText(line.trimEnd()).width, lineHeight });
        line = token.trimStart();
      } else {
        line = test;
      }
    }
    if (line.trim()) lines.push({ text: line.trimEnd(), width: ctx.measureText(line.trimEnd()).width, lineHeight });
    return lines;
  }

  function glyphAnchors(ctx, lines, x, y, lineHeight) {
    const anchors = [];
    for (let i = 0; i < lines.length; i++) {
      let gx = x;
      for (const char of segment(lines[i].text)) {
        anchors.push({ char, x: gx, y: y + i * lineHeight, tx: gx, ty: y + i * lineHeight });
        gx += ctx.measureText(char).width;
      }
    }
    return anchors;
  }

  function nextLine(ctx, text, startIndex, maxWidth) {
    let end = startIndex;
    let lastSpace = -1;
    while (end < text.length) {
      const test = text.slice(startIndex, end + 1);
      if (/\s/.test(text[end])) lastSpace = end;
      if (ctx.measureText(test).width > maxWidth) break;
      end++;
    }
    if (end >= text.length) return { text: text.slice(startIndex).trim(), end: text.length };
    const cut = lastSpace > startIndex ? lastSpace : Math.max(startIndex + 1, end - 1);
    return { text: text.slice(startIndex, cut).trim(), end: cut + 1 };
  }

  return { segment, wrapLines, glyphAnchors, nextLine };
})();
</script>
```

Rules:
- Keep the same `ctx.font`, `letterSpacing` assumption, and lineHeight between measurement and draw.
- Use this for prototypes and offline-safe exports; swap to real Pretext for complex multilingual, rich-inline, or variable-width streaming behavior.
- Do not claim exact Pretext parity when using this shim.
```