// Counts stay in the view models for paging; headers only signal occupied categories.
export function taskHeaderIndicator(key, count) {
  if (!(count > 0)) return '';
  const running = key === 'running';
  if (!running && !['paused', 'needs_assistance', 'needs_you'].includes(key)) return '';
  const color = running ? '#2fae66' : '#e25555';
  return ` <span class="task-header-indicator" role="img" aria-label="Has items" style="white-space:nowrap">(<span style="color:${color}">●</span>)</span>`;
}
