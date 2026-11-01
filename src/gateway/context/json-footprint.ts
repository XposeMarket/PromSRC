/** Count JSON characters without materializing transcript-sized JSON strings.
 * Only plain data containers use this path. Exotic serialization (accessors,
 * toJSON, boxed values, cycles) is delegated to the caller's native fallback.
 * Undefined means unsupported; no property getter/toJSON is invoked here.
 */
import { types } from 'node:util';

export function countJsonContainerChars(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const ancestors = new Set<object>();
  // Repeated tool traces share strings within one estimate; retain no global cache.
  const strings = new Map<string, number>();
  function stringChars(text: string): number {
    const cached = strings.get(text);
    if (cached !== undefined) return cached;
    let count = text.length + 2;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92) count += 1;
      else if (code < 32) count += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 1 : 5;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) i += 1;
        else count += 5;
      } else if (code >= 0xdc00 && code <= 0xdfff) count += 5;
    }
    if (text.length >= 64 && strings.size < 256) strings.set(text, count);
    return count;
  }
  function count(item: unknown, depth: number): number | undefined {
    if (item === null) return 4;
    if (typeof item === 'string') return stringChars(item);
    if (typeof item === 'boolean') return item ? 4 : 5;
    if (typeof item === 'number') return Number.isFinite(item) ? String(item).length : 4;
    if (typeof item !== 'object' || depth > 200 || ancestors.has(item) || types.isProxy(item)) return undefined;
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return undefined;
    // Do not execute a custom serializer twice when falling back.
    if ('toJSON' in item) return undefined;
    ancestors.add(item);
    let total = 2;
    let entries = 0;
    const keys = array ? null : Object.keys(item);
    const length = array ? item.length : keys!.length;
    for (let i = 0; i < length; i += 1) {
      const key = array ? String(i) : keys![i];
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !('value' in descriptor)) {
        // Array holes may inherit accessors or values; let JSON handle those.
        if (!array || key in item) return undefined;
      }
      const child = descriptor?.value;
      if (typeof child === 'function' && (types.isProxy(child) || 'toJSON' in child)) return undefined;
      const omitted = child === undefined || typeof child === 'function' || typeof child === 'symbol';
      if (omitted && !array) continue;
      const size = omitted ? 4 : count(child, depth + 1);
      if (size === undefined) return undefined;
      total += (entries++ ? 1 : 0) + (array ? 0 : stringChars(key) + 1) + size;
    }
    ancestors.delete(item);
    return total;
  }
  try { return count(value, 0); } catch { return undefined; }
}
