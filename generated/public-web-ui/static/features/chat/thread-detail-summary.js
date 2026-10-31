// Shared metadata, not another token/quota gauge. All labels use text nodes.
export function threadDetailRows(data, now = Date.now()) {
  const valid = data && data.success !== false;
  const profile = valid ? data.profile || {} : {};
  const stamp = valid && typeof data.observedAt === 'string' ? Date.parse(data.observedAt) : NaN;
  const age = Number.isFinite(stamp) && stamp <= now ? now - stamp : NaN;
  const freshness = !Number.isFinite(age) ? 'Unknown observation time'
    : `${age > 60_000 ? 'Stale snapshot' : 'Snapshot'} · ${new Date(stamp).toLocaleTimeString()}`;
  const measurement = valid ? data.contextMeasurement : null;
  const source = measurement === 'provider_reported' ? 'Provider-reported last-call input'
    : measurement === 'request_estimate' ? 'Estimated last-call input'
      : measurement === 'composition_estimate' ? 'Estimated current composition' : 'Unknown';
  return [
    ['Provider', typeof profile.providerId === 'string' && profile.providerId ? profile.providerId : 'Unknown'],
    ['Model', typeof profile.model === 'string' && profile.model ? profile.model : 'Unknown'],
    ['Last-call / composition basis', source],
    ['Freshness', freshness],
    ['Scope', 'Context is not account allowance. Thread totals in the breakdown are recorded usage, not remaining quota.'],
  ];
}

export function renderThreadDetailSummary(root, data) {
  if (!root) return;
  let details = root.querySelector('[data-thread-detail-summary]');
  if (!details) {
    details = root.ownerDocument.createElement('details');
    details.dataset.threadDetailSummary = '';
    details.style.cssText = 'margin:10px 0 0;padding-top:8px;border-top:1px solid currentColor;font-size:12px;line-height:1.5;overflow-wrap:anywhere';
    const summary = root.ownerDocument.createElement('summary');
    summary.textContent = 'Thread details';
    summary.style.cursor = 'pointer';
    const list = root.ownerDocument.createElement('dl');
    list.style.cssText = 'margin:8px 0 0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px';
    details.append(summary, list);
    root.append(details);
  }
  const rows = threadDetailRows(data);
  const key = JSON.stringify([data?.sessionId || '', rows]);
  if (details.dataset.snapshotKey === key) return;
  details.dataset.snapshotKey = key;
  const list = details.querySelector('dl');
  list.replaceChildren();
  for (const [label, value] of rows) {
    const term = root.ownerDocument.createElement('dt');
    term.textContent = label;
    term.style.opacity = '0.7';
    const description = root.ownerDocument.createElement('dd');
    description.textContent = value;
    description.style.margin = '0';
    list.append(term, description);
  }
}
