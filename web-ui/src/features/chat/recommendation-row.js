const SOURCE_ICONS = {
  github: 'mdi:github',
  task: 'mdi:check-circle-outline',
  schedule: 'mdi:calendar-clock-outline',
  session: 'mdi:message-text-outline',
  project: 'mdi:folder-outline',
  brain: 'mdi:lightbulb-outline',
  other: 'mdi:sparkles',
};

export function normalizeRecommendation(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const label = String(value.label || value.title || '').replace(/\s+/g, ' ').trim();
  const prompt = String(value.prompt || '').trim();
  const sourceType = String(value.sourceType || value.source_type || 'other').trim().toLowerCase();
  if (!label || !prompt) return null;
  return {
    id: id || `rec_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48)}`,
    label,
    prompt,
    sourceType,
    sourceRef: String(value.sourceRef || value.source_ref || '').trim(),
    kind: String(value.kind || '').trim(),
    confidence: Number(value.confidence || 0),
  };
}

export function recommendationIconName(recommendation) {
  const type = String(recommendation?.sourceType || 'other').toLowerCase();
  return SOURCE_ICONS[type] || SOURCE_ICONS.other;
}

export function renderRecommendationRows(recommendations, escapeHtml) {
  const items = (Array.isArray(recommendations) ? recommendations : [])
    .map(normalizeRecommendation)
    .filter(Boolean)
    .slice(0, 3);
  if (!items.length) return '';
  return `<div class="pm-recommendations" aria-label="Recommended next actions">
    ${items.map((rec, index) => `<button class="pm-recommendation-row" type="button" data-pm-recommendation-index="${index}" data-pm-recommendation-id="${escapeHtml(rec.id)}" aria-label="${escapeHtml(rec.label)}">
      <span class="pm-recommendation-icon" aria-hidden="true"><iconify-icon icon="${escapeHtml(recommendationIconName(rec))}"></iconify-icon></span>
      <span class="pm-recommendation-label">${escapeHtml(rec.label)}</span>
    </button>`).join('')}
  </div>`;
}
