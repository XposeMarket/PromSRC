import { createHash } from 'crypto';

function normalizeToolArgs(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeToolArgs(entry, seen));
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeToolArgs((value as Record<string, unknown>)[key], seen);
    }
    seen.delete(value);
    return normalized;
  }
  return value;
}

export function serializeCanonicalToolArgs(args: unknown): string {
  try {
    const serialized = JSON.stringify(normalizeToolArgs(args ?? {}, new WeakSet<object>()));
    return serialized === undefined ? String(args ?? '') : serialized;
  } catch {
    return String(args ?? '');
  }
}

export function digestCanonicalToolArgs(args: unknown): string {
  return createHash('sha256').update(serializeCanonicalToolArgs(args), 'utf8').digest('hex');
}

export function previewCanonicalToolArgs(args: unknown, maxChars = 200): string {
  return serializeCanonicalToolArgs(args).slice(0, Math.max(0, maxChars));
}
