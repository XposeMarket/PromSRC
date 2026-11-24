// Category retention moved to src/gateway/tool-category-retention.ts (all providers).

/** Canonicalize object keys only; array order (including enum/required) is semantic. */
export function canonicalAnthropicToolValue(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalAnthropicToolValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalAnthropicToolValue(value[key])]));
  }
  return value;
}
