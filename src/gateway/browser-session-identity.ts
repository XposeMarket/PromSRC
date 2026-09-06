export const DEFAULT_BROWSER_SESSION_ID = 'default';

/**
 * Browser session IDs are map and persistence keys. Normalize only the
 * transport noise at the boundary so follow-up calls address the same
 * session without changing the caller's intentional casing or punctuation.
 */
export function normalizeBrowserSessionId(sessionId: unknown): string {
  const value = String(sessionId ?? '').trim();
  return value || DEFAULT_BROWSER_SESSION_ID;
}
