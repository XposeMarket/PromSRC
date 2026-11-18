import type { ConnectionAttempt } from './types';

/** Only a previously approved, live OAuth action can open a phone-controlled browser. */
export async function openConnectionPhoneHandoff(
  attempt: ConnectionAttempt | undefined,
  open: (sessionId: string, url: string) => Promise<string> = async (sessionId, url) => {
    const { browserOpenInHouse } = await import('../gateway/browser/inhouse-actions.js');
    return browserOpenInHouse(sessionId, url, { observe: 'none' });
  },
): Promise<{ sessionId: string; site: string }> {
  const action = attempt?.requiredUserAction;
  if (!attempt || attempt.state !== 'awaiting_oauth' || action?.type !== 'oauth'
    || attempt.plan?.strategy.adapter !== 'connector-oauth'
    || !action.desktopRequired || action.preferSystemBrowser || !action.authorizationUrl
    || (action.expiresAt && (!Number.isFinite(Date.parse(action.expiresAt)) || Date.parse(action.expiresAt) <= Date.now()))) {
    throw new Error('OAUTH_HANDOFF_UNAVAILABLE');
  }
  const url = new URL(action.authorizationUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('OAUTH_HANDOFF_UNAVAILABLE');
  // Browser identity is server-derived, never a caller-supplied session/URL.
  const sessionId = `connection_oauth_${attempt.id}`;
  const result = await open(sessionId, url.href);
  if (result.startsWith('ERROR')) throw new Error('OAUTH_HANDOFF_BROWSER_UNAVAILABLE');
  return { sessionId, site: attempt.serviceName || attempt.serviceId };
}
