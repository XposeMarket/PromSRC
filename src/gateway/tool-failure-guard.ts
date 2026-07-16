import path from 'path';
import crypto from 'crypto';

const EQUIVALENT_READ_TOOLS = new Set([
  'workspace_read',
  'dev_source_read',
  'read_file',
  'read_files_batch',
  'read_source',
  'read_dev_sources',
  'read_webui_source',
  'file_stats',
  'source_stats',
  'webui_source_stats',
  'grep_file',
  'grep_source',
  'grep_webui_source',
]);

function normalizeReadTarget(raw: unknown): string {
  let value = String(raw || '').trim().replace(/\\/g, '/');
  if (!value) return '';
  value = value.replace(/^file:\/+/i, '/').replace(/\/+/g, '/');
  const lower = value.toLowerCase();
  const sourceMarker = lower.lastIndexOf('/src/');
  const webUiMarker = lower.lastIndexOf('/web-ui/');
  if (webUiMarker >= 0) value = value.slice(webUiMarker + 1);
  else if (sourceMarker >= 0) value = value.slice(sourceMarker + 1);
  value = value.replace(/^\.\/+/, '');
  if (/^(gateway|runtime|providers|config|cli|tools)\//i.test(value)) value = `src/${value}`;
  return path.posix.normalize(value).replace(/^\.\//, '').toLowerCase();
}

function readAction(toolName: string, args: Record<string, any>): string {
  if (toolName === 'workspace_read' || toolName === 'dev_source_read') {
    return String(args.action || 'read').trim().toLowerCase();
  }
  if (/grep|search/i.test(toolName)) return 'grep';
  if (/stats/i.test(toolName)) return 'stats';
  if (/batch/i.test(toolName)) return 'batch_read';
  return 'read';
}

export function equivalentFailedReadSignature(toolName: unknown, rawArgs: unknown): string | null {
  const name = String(toolName || '').trim();
  if (!EQUIVALENT_READ_TOOLS.has(name)) return null;
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs as Record<string, any>
    : {};
  const action = readAction(name, args);
  if (!['read', 'batch_read', 'stats', 'grep', 'search', 'validate'].includes(action)) return null;

  const scalarTarget = args.file ?? args.filename ?? args.path ?? args.name ?? args.directory;
  const batchTargets = Array.isArray(args.files)
    ? args.files.map((entry: any) => normalizeReadTarget(entry?.file ?? entry?.filename ?? entry?.path ?? entry?.name)).filter(Boolean)
    : Array.isArray(args.paths)
      ? args.paths.map(normalizeReadTarget).filter(Boolean)
      : [];
  const targets = batchTargets.length ? batchTargets.sort() : [normalizeReadTarget(scalarTarget)].filter(Boolean);
  const pattern = action === 'grep' || action === 'search'
    ? String(args.pattern ?? args.query ?? args.search ?? '').trim().toLowerCase()
    : '';
  if (!targets.length && !pattern) return null;
  return `read:${action}:${targets.join('|')}:${pattern}`;
}

export function countEquivalentFailedReads(
  toolName: unknown,
  args: unknown,
  priorResults: Array<{ name?: unknown; args?: unknown; error?: unknown; result?: unknown }>,
): number {
  const signature = equivalentFailedReadSignature(toolName, args);
  if (!signature) return 0;
  const failureCounts = new Map<string, number>();
  for (const result of priorResults) {
    if (result?.error !== true || equivalentFailedReadSignature(result.name, result.args) !== signature) continue;
    const normalizedFailure = String(result.result ?? '')
      .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
      .replace(/\b\d{2,}\b/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 2000);
    if (!normalizedFailure) continue;
    const failureKey = crypto.createHash('sha256').update(normalizedFailure).digest('hex');
    failureCounts.set(failureKey, (failureCounts.get(failureKey) || 0) + 1);
  }
  return Math.max(0, ...failureCounts.values());
}
