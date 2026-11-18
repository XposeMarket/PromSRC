// Compute the available requested interval first, then apply the delivery cap.
// A continuation always describes missing requested lines, never unrelated file content.
export interface ReadWindowArgs {
  start_line?: number; num_lines?: number; around_line?: number; aroundLine?: number;
  before?: number; after?: number; head?: number; tail?: number; max_lines?: number;
  full?: boolean; full_file?: boolean; allow_large?: boolean;
}

function integer(value: unknown, fallback: number, minimum: number): number {
  return value != null && Number.isFinite(Number(value)) ? Math.max(minimum, Math.floor(Number(value))) : fallback;
}

export function fileReadWindow(total: number, args: ReadWindowArgs, defaultCap: number) {
  const start = integer(args.start_line, 0, 1), count = integer(args.num_lines, 0, 1);
  const around = integer(args.around_line ?? args.aroundLine, 0, 1);
  const head = integer(args.head, 0, 0), tail = integer(args.tail, 0, 0);
  let lo = 1, hi = total, fromTail = false, boundedRequest = false;
  if (around) {
    lo = Math.max(1, around - Math.min(240, integer(args.before, 40, 0)));
    hi = Math.min(total, around + Math.min(240, integer(args.after, 80, 0)));
    boundedRequest = true;
  } else if (start || count) {
    lo = start || 1;
    if (count) { hi = Math.min(total, lo + count - 1); boundedRequest = true; }
  } else if (head) { hi = Math.min(total, head); boundedRequest = true; }
  else if (tail) { lo = Math.max(1, total - tail + 1); fromTail = boundedRequest = true; }
  const cap = Math.min(480, integer(args.max_lines, boundedRequest ? Math.max(1, hi - lo + 1) : defaultCap, 1));
  const full = args.full === true || args.full_file === true || args.allow_large === true;
  const first = fromTail && !full ? Math.max(lo, hi - cap + 1) : lo;
  const last = full || fromTail ? hi : Math.min(hi, first + cap - 1);
  const missing = first > lo ? { start: lo, count: first - lo } : last < hi ? { start: last + 1, count: hi - last } : undefined;
  return { first, last, missing, boundedRequest };
}

export function describeReadWindow(w: ReturnType<typeof fileReadWindow>): string {
  if (!w.missing) return '';
  return `\n[${w.boundedRequest ? 'READ_TRUNCATED' : 'READ_DEFAULT_CAP'}] Returned lines ${w.first}-${w.last}. Remaining requested lines: ${w.missing.start}-${w.missing.start + w.missing.count - 1}. Use start_line:${w.missing.start}, num_lines:${w.missing.count}.`;
}
