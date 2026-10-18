// Keep ownership outside mutable transcript rows/snapshots and never infer it
// from the selected chat. The SSE closure retains its original object key.
const owners = new WeakMap();
export function rememberMobileStreamOwner(turn, sessionId) {
  if (!turn || typeof turn !== 'object') return '';
  const sid = String(sessionId || '').trim();
  if (sid && !owners.has(turn)) owners.set(turn, sid);
  return owners.get(turn) || '';
}
export function mobileStreamOwner(turn, threads) {
  return owners.get(turn) || rememberMobileStreamOwner(turn,
    Object.keys(threads).find((sid) => Array.isArray(threads[sid]) && threads[sid].includes(turn)));
}
