/** Retain a bounded category union, never a stale/disconnected tool definition. */
export const ANTHROPIC_RETAINED_CATEGORY_LIMIT = 8;
export function retainAnthropicToolCategories(active: Set<string>, retained: string[]): string[] {
  // Connector/MCP registries have unbounded, revocable schemas. Never retain
  // their activation implicitly; rebuild them only while explicitly active.
  return Array.from(new Set([...retained, ...active]))
    .filter(category => !['external_apps', 'mcp_server_tools'].includes(category))
    .slice(0, ANTHROPIC_RETAINED_CATEGORY_LIMIT);
}

/** Canonicalize object keys only; array order (including enum/required) is semantic. */
export function canonicalAnthropicToolValue(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalAnthropicToolValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalAnthropicToolValue(value[key])]));
  }
  return value;
}
