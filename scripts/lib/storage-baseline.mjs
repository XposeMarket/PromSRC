import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const BUCKETS = new Set(['audit', 'memory', 'sessions', 'cache', 'logs', 'diagnostics', 'artifacts', 'downloads', 'projects', 'skills', 'runtime', 'workspace', '.prometheus']);
const count = () => ({ files: 0, bytes: 0 });
function bounded(value, fallback, max, name) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${name}`);
  return n;
}

// Metadata only. The explicit root must be trusted, not adversarially mutated.
export async function scanStorage(root, options = {}) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Explicit root required');
  const maxEntries = bounded(options.maxEntries, 100000, 1000000, 'maxEntries');
  const maxDepth = bounded(options.maxDepth, 16, 64, 'maxDepth');
  const now = options.now === undefined ? Date.now() : options.now;
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid time');
  let canonical;
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    canonical = await fs.realpath(root);
  } catch { throw new Error('Root must be an accessible non-link directory'); }
  const report = {
    schemaVersion: 1,
    rootId: createHash('sha256').update(process.platform + '\0' + canonical).digest('hex'),
    observedAt: new Date(now).toISOString(),
    sizeKind: 'apparent_bytes', maxEntries, maxDepth,
    complete: true, entries: 0, files: 0, bytes: 0, skippedLinks: 0, skippedSpecial: 0,
    errors: 0, depthLimited: 0, entryLimited: false,
    buckets: {}, age: { under7Days: count(), days7To30: count(), over30Days: count(), unknown: count() },
  };
  async function walk(dir, depth, bucket) {
    let handle;
    try { handle = await fs.opendir(dir); }
    catch { report.errors++; report.complete = false; return; }
    try {
      for await (const entry of handle) {
        if (report.entries >= maxEntries) { report.entryLimited = true; report.complete = false; break; }
        report.entries++;
        const filename = path.join(dir, entry.name);
        let stat;
        try { stat = await fs.lstat(filename); }
        catch { report.errors++; report.complete = false; continue; }
        if (stat.isSymbolicLink()) { report.skippedLinks++; continue; }
        const group = bucket || (BUCKETS.has(entry.name) ? entry.name : 'other');
        if (stat.isDirectory()) {
          if (depth >= maxDepth) { report.depthLimited++; report.complete = false; }
          else await walk(filename, depth + 1, group);
        } else if (stat.isFile()) {
          if (!Number.isSafeInteger(stat.size) || stat.size < 0 || !Number.isSafeInteger(report.bytes + stat.size)) {
            report.errors++; report.complete = false; continue;
          }
          const ageMs = now - stat.mtimeMs;
          const age = !Number.isFinite(ageMs) || ageMs < 0 ? 'unknown'
            : ageMs < 7 * 86400000 ? 'under7Days' : ageMs < 30 * 86400000 ? 'days7To30' : 'over30Days';
          const groupCount = report.buckets[group] ||= count();
          for (const target of [report, groupCount, report.age[age]]) { target.files++; target.bytes += stat.size; }
        } else report.skippedSpecial++;
        if (report.entryLimited) break;
      }
    } catch { report.errors++; report.complete = false; }
  }
  await walk(canonical, 1, '');
  report.buckets = Object.fromEntries(Object.entries(report.buckets).sort(([a], [b]) => a.localeCompare(b)));
  return report;
}

function validTotals(groups, report, keys) {
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return false;
  let files = 0, bytes = 0;
  for (const [key, value] of Object.entries(groups)) {
    if (!keys.has(key) || !value || !Number.isSafeInteger(value.files) || value.files < 0
      || !Number.isSafeInteger(value.bytes) || value.bytes < 0) return false;
    files += value.files; bytes += value.bytes;
    if (!Number.isSafeInteger(files) || !Number.isSafeInteger(bytes)) return false;
  }
  return files === report.files && bytes === report.bytes;
}
function validReport(r) {
  return r && r.schemaVersion === 1 && r.sizeKind === 'apparent_bytes'
    && typeof r.rootId === 'string' && /^[a-f0-9]{64}$/.test(r.rootId)
    && typeof r.complete === 'boolean'
    && Number.isSafeInteger(r.bytes) && r.bytes >= 0
    && Number.isSafeInteger(r.files) && r.files >= 0
    && validTotals(r.buckets, r, new Set([...BUCKETS, 'other']))
    && validTotals(r.age, r, new Set(['under7Days', 'days7To30', 'over30Days', 'unknown']))
    && typeof r.observedAt === 'string' && Number.isFinite(Date.parse(r.observedAt));
}
export function compareStorage(before, after) {
  if (!validReport(before) || !validReport(after)) throw new Error('Invalid storage report');
  if (before.rootId !== after.rootId) throw new Error('Storage roots do not match');
  if (Date.parse(after.observedAt) < Date.parse(before.observedAt)) throw new Error('Reports out of chronological order');
  return { schemaVersion: 1, rootId: before.rootId, sizeKind: 'apparent_bytes',
    provisional: !before.complete || !after.complete,
    from: before.observedAt, to: after.observedAt,
    bytesDelta: after.bytes - before.bytes, filesDelta: after.files - before.files };
}
