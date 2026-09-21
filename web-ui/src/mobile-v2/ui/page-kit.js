export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function safeJson(value) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ''); }
}

export function asTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
}

export function relativeTime(value) {
  const time = Number(new Date(value || 0));
  if (!time) return '';
  const delta = Math.max(0, Date.now() - time);
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (/running|active|online|approved|completed|succeeded|healthy/.test(value)) return 'good';
  if (/failed|error|denied|revoked|offline|stalled/.test(value)) return 'bad';
  if (/paused|waiting|queued|pending|needs/.test(value)) return 'warn';
  return 'neutral';
}

export function statusPill(status, label = status) {
  return `<span class="pm-v2-pill ${statusClass(status)}">${escapeHtml(label || 'Unknown')}</span>`;
}

export function loading(label = 'Loading…') {
  return `<div class="pm-v2-page-loading"><span class="pm-v2-spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

export function emptyState(title, body = '') {
  return `<div class="pm-v2-empty"><strong>${escapeHtml(title)}</strong>${body ? `<span>${escapeHtml(body)}</span>` : ''}</div>`;
}

export function errorState(error, retryLabel = 'Retry') {
  return `<div class="pm-v2-error-card"><strong>Couldn’t load this</strong><span>${escapeHtml(error?.message || error || 'Unknown error')}</span><button type="button" class="pm-btn ghost" data-v2-retry>${escapeHtml(retryLabel)}</button></div>`;
}

export function pageHeading(title, subtitle = '', actions = '') {
  return `<div class="pm-v2-page-heading"><div><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>${actions ? `<div class="pm-v2-heading-actions">${actions}</div>` : ''}</div>`;
}

export function card(title, body, options = {}) {
  return `<section class="pm-card pm-v2-card ${options.className || ''}"${options.attrs || ''}>${title ? `<div class="pm-v2-card-title">${escapeHtml(title)}</div>` : ''}${body || ''}</section>`;
}

export function tabs(items, active) {
  return `<div class="pm-tabs pm-v2-tabs" role="tablist">${items.map((item) => `<button type="button" class="pm-tab-btn${item.id === active ? ' active' : ''}" data-v2-tab="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`).join('')}</div>`;
}

export function field(label, value, type = 'text', attrs = '') {
  if (type === 'textarea') return `<label class="pm-v2-field"><span>${escapeHtml(label)}</span><textarea ${attrs}>${escapeHtml(value || '')}</textarea></label>`;
  return `<label class="pm-v2-field"><span>${escapeHtml(label)}</span><input type="${escapeHtml(type)}" value="${escapeHtml(value || '')}" ${attrs}/></label>`;
}

export function normalizeText(record) {
  if (typeof record === 'string') return record;
  if (typeof record?.text === 'string') return record.text;
  if (typeof record?.content === 'string') return record.content;
  if (typeof record?.message === 'string') return record.message;
  if (Array.isArray(record?.content)) return record.content
    .map((part) => typeof part === 'string' ? part : part?.text || '')
    .filter((part) => part !== '')
    .join('\n');
  return '';
}
