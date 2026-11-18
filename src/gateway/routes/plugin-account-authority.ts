import type { Request } from 'express';
import { ownerSurfaceState, secureInputTransportAllowed } from './secure-access.router.js';
import { getCurrentUserId, hasAccountSession } from './account.router.js';
import { getConfig } from '../../config/config.js';
import { resolvePluginAccountOwner } from '../../connections/account-owner.js';
import { setAccountSessionAuthority, clearAccountSessionAuthority } from '../../connections/account-session-authority.js';
import { getRuntimeActorContext, isDistinctRuntimeActor } from '../runtime-actor.js';

/** Authenticated UI admission only. Request body/origin/callerContext are never authority. */
export function bindInteractivePluginAccountAuthority(req: Pick<Request, 'headers' | 'socket' | 'is'>, sessionId: string): boolean {
  // Paired plugin-setup permission alone does not confer general agent account authority.
  if (!secureInputTransportAllowed(req) || !ownerSurfaceState(req).canApprove) {
    clearAccountSessionAuthority(sessionId);
    return false;
  }
  const actor = getRuntimeActorContext(sessionId);
  if (isDistinctRuntimeActor(actor) || (actor && actor.kind !== 'main' && actor.kind !== 'voice')
    // Reserved worker/team/session namespaces cannot become owners by posting a chat request.
    || /^(team_|agent_|subagent_|bg_|background_|task_|cron_|proposal_|heartbeat_)/i.test(sessionId)) {
    clearAccountSessionAuthority(sessionId);
    return false;
  }
  const userId = getCurrentUserId();
  if (hasAccountSession() && !userId) {
    clearAccountSessionAuthority(sessionId);
    throw new Error('ACCOUNT_OWNER_UNAVAILABLE');
  }
  const ownerId = resolvePluginAccountOwner(getConfig().getConfigDir(), userId);
  setAccountSessionAuthority(sessionId, { kind: 'owner', ownerId, principalId: ownerId, ancestors: [] });
  return true;
}
