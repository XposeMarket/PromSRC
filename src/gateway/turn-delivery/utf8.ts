/** Return the exact UTF-8 byte length used by JSON/SSE/IPC transports. */
export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

/**
 * Truncate a string to an exact UTF-8 byte budget without cutting a UTF-16
 * surrogate pair (and therefore without emitting a broken UTF-8 code point).
 */
export function truncateUtf8(value: string, maxBytes: number): string {
  const input = String(value ?? '');
  const budget = Math.max(0, Math.floor(Number(maxBytes) || 0));
  if (budget === 0 || input.length === 0) return '';
  if (utf8ByteLength(input) <= budget) return input;

  let low = 0;
  let high = input.length;
  while (low < high) {
    const rawMid = Math.ceil((low + high) / 2);
    const mid = rawMid > 0 && rawMid < input.length
      && isHighSurrogate(input.charCodeAt(rawMid - 1))
      && isLowSurrogate(input.charCodeAt(rawMid))
      ? rawMid - 1
      : rawMid;
    if (mid <= low) {
      high = low;
      break;
    }
    if (utf8ByteLength(input.slice(0, mid)) <= budget) low = mid;
    else high = mid - 1;
  }

  let end = Math.max(0, Math.min(input.length, low));
  if (end > 0 && end < input.length
    && isHighSurrogate(input.charCodeAt(end - 1))
    && isLowSurrogate(input.charCodeAt(end))) {
    end -= 1;
  }
  let result = input.slice(0, end);
  while (result && utf8ByteLength(result) > budget) {
    const last = result.charCodeAt(result.length - 1);
    result = result.slice(0, isLowSurrogate(last) && result.length > 1 ? -2 : -1);
  }
  return result;
}

/** Keep a suffix inside the byte budget while truncating the leading text. */
export function truncateUtf8WithSuffix(value: string, maxBytes: number, suffix: string): string {
  const input = String(value ?? '');
  const budget = Math.max(0, Math.floor(Number(maxBytes) || 0));
  if (utf8ByteLength(input) <= budget) return input;
  if (budget === 0) return '';
  const boundedSuffix = truncateUtf8(String(suffix ?? ''), budget);
  const prefixBudget = Math.max(0, budget - utf8ByteLength(boundedSuffix));
  return `${truncateUtf8(input, prefixBudget)}${boundedSuffix}`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
