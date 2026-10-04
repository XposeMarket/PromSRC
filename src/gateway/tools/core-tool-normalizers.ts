// Small, pure argument/result normalizers for core tools. Kept out of the
// 22k-line executor so they can be unit-tested directly.

/**
 * Accept the chart shapes models actually send, not just series[].points[]:
 *  - series[].points[] / series[].data[] (canonical + legacy)
 *  - series[].values[] / series[].data as plain numbers, paired with labels[]
 *  - top-level labels[] + data[]|values[] (Chart.js style, one series)
 *  - top-level labels[] + datasets[{label,data[]}] (Chart.js style)
 */
export function normalizeChartSeriesArgs(args: any): any[] {
  const labels: any[] = Array.isArray(args?.labels) ? args.labels : [];
  const pair = (values: any[]) => values.map((v: any, i: number) => (
    v && typeof v === 'object' ? v : { x: labels[i] ?? i + 1, y: v }
  ));
  const fromSeries = (list: any[]) => list.map((s: any) => {
    const raw = Array.isArray(s?.points) ? s.points
      : Array.isArray(s?.data) ? s.data
        : Array.isArray(s?.values) ? s.values : [];
    return { ...s, points: pair(raw) };
  });
  if (Array.isArray(args?.series) && args.series.length) return fromSeries(args.series);
  if (Array.isArray(args?.datasets) && args.datasets.length) return fromSeries(args.datasets);
  const flat = Array.isArray(args?.data) ? args.data : Array.isArray(args?.values) ? args.values : null;
  if (flat) return [{ label: args?.seriesLabel || args?.label || args?.title, points: pair(flat) }];
  return [];
}

/**
 * Structured memory index hits as compact text lines instead of a JSON blob.
 * The JSON carried chunkIds, canonical keys, stats, and lexical arrays that the
 * model never used; it was ~half of every memory search result.
 */
export function formatStructuredMemoryHits(serialized: string, limit = 6): string {
  let parsed: any;
  try { parsed = JSON.parse(serialized); } catch { return String(serialized || '').slice(0, 1500); }
  const hits: any[] = Array.isArray(parsed?.hits) ? parsed.hits.slice(0, limit) : [];
  if (!hits.length) return 'no structured hits';
  return hits.map((hit: any) => {
    const when = hit.timestamp ? String(hit.timestamp).slice(0, 10) : '';
    const kind = hit.recordType || hit.sourceType || '';
    const where = hit.sourcePath ? ` ${hit.sourcePath}` : '';
    const preview = String(hit.preview || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    return `- [${kind}${when ? ` ${when}` : ''}] ${String(hit.title || '').slice(0, 100)}${where}${hit.recordId ? ` id=${hit.recordId}` : ''}\n  ${preview}`;
  }).join('\n');
}
