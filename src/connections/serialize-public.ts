/** Strip internal protected credential handles at external serialization boundaries.
 *  JSON semantics first (toJSON, Date -> string, Map/undefined dropped), then redact plain JSON. */
function redactJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return /(?:vault:)?connection\.credentials\.[^\s"<>]+/.test(value) ? value.replace(/(?:vault:)?connection\.credentials\.[^\s"<>]+/g, '[protected credential]') : value;
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, item]) => !(key === 'credentialRef' && typeof item === 'string' && item.replace(/^vault:/, '').startsWith('connection.credentials.'))).map(([key, item]) => [key, redactJsonValue(item)]));
  return value;
}

export function publicConnectionValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return (typeof value === 'string' ? redactJsonValue(value) : value) as T;
  return redactJsonValue(JSON.parse(JSON.stringify(value))) as T;
}
