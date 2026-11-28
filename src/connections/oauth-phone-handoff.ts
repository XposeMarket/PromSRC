import type { ConnectionAttempt } from './types';

/**
 * Sign-in adapters whose approved OAuth action may open in the PC's in-app browser for a paired phone.
 * Both return the authorization code to a callback owned by the local gateway, so the PC browser completes it.
 * The setup sheet offers this for every desktop-required OAuth action; remote MCP sign-in (mcp-oauth) was
 * missing here, so the phone got OAUTH_HANDOFF_UNAVAILABLE after tapping Authorize.
 */
const PHONE_HANDOFF_ADAPTERS = new Set(['connector-oauth', 'mcp-oauth']);

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
    || !PHONE_HANDOFF_ADAPTERS.has(attempt.plan?.strategy.adapter || '')
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
