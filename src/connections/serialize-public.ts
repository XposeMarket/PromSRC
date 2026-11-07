/** Strip internal protected credential handles at external serialization boundaries. */
export function publicConnectionValue<T>(value: T): T {
  if (typeof value === 'string') return (/(?:vault:)?connection\.credentials\.[^\s"<>]+/g.test(value) ? value.replace(/(?:vault:)?connection\.credentials\.[^\s"<>]+/g, '[protected credential]') : value) as T;
  if (Array.isArray(value)) return value.map(publicConnectionValue) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key, item]) => !(key === 'credentialRef' && typeof item === 'string' && item.replace(/^vault:/, '').startsWith('connection.credentials.'))).map(([key, item]) => [key, publicConnectionValue(item)])) as T;
  return value;
}
