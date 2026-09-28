/**
 * Normalize the `tool_categories` argument of background_spawn / background_ops spawn.
 *
 * Models do not always send a JSON array: they send a single string
 * ("workspace_write"), a comma/space separated string ("workspace_write, browser_automation"),
 * or a JSON-encoded array string ('["workspace_write"]'). The spawn handlers used to accept only
 * real arrays, so every other shape was silently dropped and the worker started with core tools
 * only (no workspace_run terminal), which is the slow-background-agent bug fixed in #394.
 */
export function normalizeSpawnToolCategoriesArg(raw: unknown): string[] | undefined {
  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return undefined;
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) values = parsed;
      } catch {
        values = text.replace(/^\[|\]$/g, '').split(/[\s,]+/);
      }
    } else {
      values = text.split(/[\s,]+/);
    }
  } else {
    return undefined;
  }
  const out: string[] = [];
  for (const value of values) {
    const clean = String(value ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.length ? out : undefined;
}
