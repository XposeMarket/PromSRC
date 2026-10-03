/**
 * Model-facing tool-definition compaction.
 *
 * Tool definitions are re-sent on every model call (p50 ~16.5k tokens, ~18% of
 * all input on 2026-10-02). Property descriptions were 36% of that. This pass
 * only changes what the model sees; executors keep accepting every argument,
 * including the alias spellings dropped here.
 *
 *  - Optional properties documented purely as aliases ("Alias for path") are
 *    removed: the canonical spelling is right next to them.
 *  - Property descriptions are capped at a sentence boundary.
 *  - Descriptions that only restate an enum ("Read action to perform.") go.
 *
 * Definitions are never mutated; results are memoized per input object.
 */

export const PROPERTY_DESCRIPTION_MAX_CHARS = 160;

const ALIAS_ONLY_DESCRIPTION = /^\s*(?:legacy(?: camelcase)?[^.]{0,20}?\s)?alias\b/i;
const TRIVIAL_ENUM_DESCRIPTION = /^\s*(?:[\w/-]+\s){0,3}(?:action|operation)s? to perform\.?\s*$|^\s*category to activate\.?\s*$|^\s*which card renderer to use\.?\s*$/i;

const memo = new WeakMap<object, any>();

// Descriptions that state a contract (must/require/only/never/exactly) keep
// their full text: truncating them silently drops a rule the executor enforces.
const CONTRACT_WORDS = /\b(?:must|requires?|required|only|never|exactly|do not)\b/i;

export function capDescription(text: string, max = PROPERTY_DESCRIPTION_MAX_CHARS): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max || CONTRACT_WORDS.test(clean)) return clean;
  const cut = clean.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  if (boundary >= max * 0.5) return cut.slice(0, boundary + 1).trim();
  return `${cut.replace(/\s+\S*$/, '').trim()}…`;
}

function compactProperty(schema: any): any {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out: any = { ...schema };
  if (typeof out.description === 'string') {
    if (Array.isArray(out.enum) && TRIVIAL_ENUM_DESCRIPTION.test(out.description)) delete out.description;
    else out.description = capDescription(out.description);
    if (out.description === '') delete out.description;
  }
  if (out.properties && typeof out.properties === 'object') out.properties = compactProperties(out.properties, out.required);
  if (out.items && typeof out.items === 'object') out.items = compactProperty(out.items);
  return out;
}

function compactProperties(properties: Record<string, any>, required: unknown): Record<string, any> {
  const requiredSet = new Set<string>(Array.isArray(required) ? required.map(String) : []);
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(properties)) {
    const description = typeof value?.description === 'string' ? value.description : '';
    if (!requiredSet.has(key) && description && ALIAS_ONLY_DESCRIPTION.test(description)) continue;
    out[key] = compactProperty(value);
  }
  return out;
}

export function compactToolDefinitionForModel(definition: any): any {
  if (!definition || typeof definition !== 'object') return definition;
  const cached = memo.get(definition);
  if (cached) return cached;
  const fn = definition.function;
  if (!fn || typeof fn !== 'object' || !fn.parameters || typeof fn.parameters !== 'object') {
    memo.set(definition, definition);
    return definition;
  }
  const parameters: any = { ...fn.parameters };
  if (parameters.properties && typeof parameters.properties === 'object') {
    parameters.properties = compactProperties(parameters.properties, parameters.required);
  }
  const compacted = { ...definition, function: { ...fn, parameters } };
  memo.set(definition, compacted);
  return compacted;
}

export function compactToolDefinitionsForModel(definitions: any[]): any[] {
  return Array.isArray(definitions) ? definitions.map(compactToolDefinitionForModel) : definitions;
}
