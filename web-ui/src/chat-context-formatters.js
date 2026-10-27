export function formatContextDurationLabel(value) {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(2)}s`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
}

export function formatContextToolDurationSuffix(tool) {
  const value = Math.max(0, Number(tool?.durationMsMax || tool?.durationMsAvg || tool?.durationMsTotal || 0));
  const label = formatContextDurationLabel(value);
  if (!label) return '';
  return ` · ${label}${Number(tool?.durationMsMax || 0) > 0 && Number(tool?.calls || 0) > 1 ? ' max' : ''}`;
}

export function formatContextTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? m.toFixed(0) : m.toFixed(1)}m`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k >= 100 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return String(Math.round(n));
}

