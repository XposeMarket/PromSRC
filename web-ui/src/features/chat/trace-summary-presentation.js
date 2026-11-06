// Pure desktop trace-label presentation, extracted from the legacy ChatPage owner.
export function liveTraceSummaryKey(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function desktopTraceProgressSummary(entries, dedupeText) {
  const source = Array.isArray(entries) ? entries : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const entry = source[index];
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    if (String(extra.source || entry?.source || '').toLowerCase() !== 'agent_progress') continue;
    const text = dedupeText(entry?.text || entry?.content || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    // Keep the provider's curated label, even when durable prose repeats it.
    return text.slice(0, 220);
  }
  return '';
}
