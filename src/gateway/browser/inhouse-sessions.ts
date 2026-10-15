
/**
 * browser-tools.ts - Browser Automation for Prometheus
 *
 * Strategy: use the Electron in-house browser by default in the desktop app.
 * The Prometheus-owned Chrome/CDP lane and the user's Chrome extension remain
 * available as explicit secondary targets.
 * Background agents, tasks, and team agents get isolated persistent profiles
 * and CDP ports derived from their stable owner identity.
 *
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import { getConfig } from '../../config/config.js';

import { broadcastWS } from '../comms/broadcaster';

import { InHouseBrowserSession, BrowserSession, BrowserSessionInfo, BrowserSessionMetadata } from './types.js';
import { resolveSessionId } from './extraction.js';
import { inHouseSessions, inHouseProfilePreferences, mainBrowserTargetPreferences, inHouseTargetSessions, inHouseOptOutSessions, sessions } from './state.js';
import { normalizeInHouseTabs, normalizeInHouseProfileId, getInHouseSession, SHARED_SUBAGENT_BROWSER_PROFILE, isAgentOwnedBrowserSession, isInHouseBrowserAvailable, callInHouseBrowser } from './inhouse.js';
import { persistBrowserSessionRecord, getPersistedBrowserSessionRecord, getOrCreateBrowserInteractionState, resolveBrowserInteractionStateId } from './streaming.js';
import { recordBrowserHistoryResource } from './history.js';
import { getBrowserSessionMetadata, lookupTaskSummary } from './sessions.js';
import { clearBrowserSessionEphemeralState } from './selection.js';
import { getMainBrowserTarget } from './target.js';
import { getBrowserProfileLabel } from './chrome.js';


export function upsertInHouseSession(sessionId: string, state: any = {}): InHouseBrowserSession {
  const resolved = resolveSessionId(sessionId);
  const existing = inHouseSessions.get(resolved);
  const now = Date.now();
  const next: InHouseBrowserSession = {
    sessionId: resolved,
    profileId: String(state?.profile || existing?.profileId || resolveInHouseProfileId(resolved) || 'main').trim(),
    url: String(state?.url || existing?.url || ''),
    title: String(state?.title || existing?.title || ''),
    activeTabId: String(state?.activeTabId || existing?.activeTabId || '').trim(),
    tabs: state?.tabs !== undefined ? normalizeInHouseTabs(state.tabs) : normalizeInHouseTabs(existing?.tabs),
    lastSnapshot: String(existing?.lastSnapshot || ''),
    lastSnapshotAt: Number(existing?.lastSnapshotAt || 0),
    createdAt: Number(existing?.createdAt || now),
    updatedAt: now,
  };
  inHouseSessions.set(resolved, next);
  persistBrowserSessionRecord({
    sessionId: resolved,
    lastPageUrl: next.url,
    lastPageTitle: next.title,
  } as BrowserSession);
  if (next.url && next.url !== existing?.url) {
    recordBrowserHistoryResource(resolved, next.url, next.title, { source: 'inhouse_browser' });
  }
  return next;
}

/**
 * Accept state pushed by the Electron renderer when the user opens or drives
 * the embedded browser directly. Tool calls normally populate this map through
 * browser_open, but a manual canvas open must be visible to the agent too.
 */
export function syncInHouseBrowserState(sessionId: string, state: any = {}): BrowserSessionInfo & Record<string, any> {
  const resolved = resolveSessionId(sessionId);
  const profileId = String(state?.profile || state?.inhouseProfile || '').trim();
  if (profileId) inHouseProfilePreferences.set(resolved, normalizeInHouseProfileId(profileId) || 'main');
  const metadata = getBrowserSessionMetadata(resolved);
  if (metadata.ownerType === 'main') mainBrowserTargetPreferences.set(resolved, 'inhouse');
  else inHouseTargetSessions.add(resolved);

  const active = state?.active !== false && state?.attached !== false;
  if (!active || (state?.attached === false && Array.isArray(state?.tabs) && state.tabs.length === 0)) {
    clearInHouseSession(resolved);
    return buildInHouseStatusPayload(resolved, 'Prometheus in-house browser is closed for this chat session.', {
      active: false,
      url: String(state?.url || ''),
      title: String(state?.title || ''),
      tabs: [],
      activeTabId: '',
      inhouseProfile: profileId ? (normalizeInHouseProfileId(profileId) || 'main') : 'main',
      profileLabel: String(state?.profileLabel || '').trim(),
      source: 'user',
    });
  }

  const inHouse = upsertInHouseSession(resolved, state);
  return buildInHouseStatusPayload(resolved, 'Prometheus in-house browser is open for this chat session.', {
    active: true,
    url: inHouse.url,
    title: inHouse.title,
    tabs: inHouse.tabs,
    activeTabId: inHouse.activeTabId,
    inhouseProfile: inHouse.profileId,
    profileLabel: String(state?.profileLabel || '').trim(),
    source: 'user',
  });
}

export function setInHouseBrowserProfilePreference(sessionId: string, profileId: unknown): BrowserSessionInfo & Record<string, any> {
  const resolved = resolveSessionId(sessionId);
  const normalized = normalizeInHouseProfileId(profileId) || 'main';
  inHouseProfilePreferences.set(resolved, normalized);
  const metadata = getBrowserSessionMetadata(resolved);
  if (metadata.ownerType === 'main') mainBrowserTargetPreferences.set(resolved, 'inhouse');
  else inHouseTargetSessions.add(resolved);
  return buildInHouseStatusPayload(resolved, `In-house browser profile set to ${normalized}.`, {
    active: !!getInHouseSession(resolved),
    inhouseProfile: normalized,
    source: 'system',
  });
}

export function clearInHouseSession(sessionId: string): void {
  const resolved = resolveSessionId(sessionId);
  clearBrowserSessionEphemeralState(resolved);
  inHouseSessions.delete(resolved);
}

export function resolveBrowserSessionAgentId(metadata: BrowserSessionMetadata): string {
  const sid = String(metadata.sessionId || '').trim();
  if (/^(subagent_chat_|subagent-chat_|subagent_)/i.test(sid)) return String(metadata.ownerId || '').trim();
  if (metadata.ownerType === 'task') return lookupTaskSummary(String(metadata.ownerId || '')).teamAgentId;
  return '';
}

export function resolveAgentBrowserProfileSetting(metadata: BrowserSessionMetadata, cfgOverride?: any): string {
  let cfg: any = cfgOverride;
  if (!cfg) {
    try { cfg = getConfig().getConfig() as any; } catch { cfg = {}; }
  }
  const agentId = resolveBrowserSessionAgentId(metadata);
  let agentSetting = '';
  if (agentId) {
    const agents: any[] = Array.isArray(cfg?.agents) ? cfg.agents : [];
    const agent = agents.find((entry: any) => String(entry?.id || '') === agentId);
    agentSetting = String(agent?.browser_profile ?? agent?.browserProfile ?? '').trim();
  }
  const globalSetting = String(cfg?.subagent_browser_profile ?? cfg?.subagentBrowserProfile ?? '').trim();
  const raw = (agentSetting || globalSetting || SHARED_SUBAGENT_BROWSER_PROFILE).toLowerCase();
  if (raw === 'isolated' || raw === 'agent' || raw === 'own' || raw === 'per-agent') return 'isolated';
  return normalizeInHouseProfileId(raw) || SHARED_SUBAGENT_BROWSER_PROFILE;
}

export function resolveInHouseProfileId(sessionId: string): string {
  const resolved = resolveSessionId(sessionId);
  const explicit = inHouseProfilePreferences.get(resolved);
  if (explicit) return explicit;
  const metadata = getBrowserSessionMetadata(resolved);
  if (metadata.ownerType === 'main') return 'main';
  if (isAgentOwnedBrowserSession(metadata)) {
    const setting = resolveAgentBrowserProfileSetting(metadata);
    if (setting !== 'isolated') return setting;
  }
  const ownerId = normalizeInHouseProfileId(metadata.ownerId || resolved) || normalizeInHouseProfileId(resolved) || 'agent';
  return `${metadata.ownerType}-${ownerId}`;
}

export function shouldUseInHouseBrowser(sessionId: string): boolean {
  const resolved = resolveSessionId(sessionId);
  const metadata = getBrowserSessionMetadata(resolved);
  if (metadata.ownerType === 'main') return getMainBrowserTarget(resolved) === 'inhouse';
  if (inHouseTargetSessions.has(resolved)) return true;
  // Subagents/tasks/team agents use the in-app browser by default on desktop so
  // they share logins with main chat and show up in the browser panel. They can
  // still opt out per session with browser_open(target="prometheus").
  if (inHouseOptOutSessions.has(resolved)) return false;
  return isAgentOwnedBrowserSession(metadata) && isInHouseBrowserAvailable();
}

/**
 * Rebuild the gateway-side mapping only after Electron confirms that the
 * requested session still owns a live native tab. This is intentionally a
 * read-only recovery path: it never opens a tab, changes lanes, or guesses
 * from another session's globally presented state.
 */
export async function recoverInHouseSessionMapping(sessionId: string): Promise<{ recovered?: boolean; error?: string } | null> {
  const resolved = resolveSessionId(sessionId);
  if (getInHouseSession(resolved) || sessions.has(resolved)) return null;
  const targetIsKnownInHouse = shouldUseInHouseBrowser(resolved);
  // A gateway restart can lose the subagent target preference even though the
  // Electron process still owns the exact native tab. Probing /state with the
  // requested session id is safe and lets Electron remain authoritative.
  if (!isInHouseBrowserAvailable()) {
    return targetIsKnownInHouse
      ? { error: `ERROR: [browser_connection_failed] Could not recover session=${resolved}, target=inhouse: Electron native browser RPC is unavailable.` }
      : null;
  }
  try {
    const state: any = await callInHouseBrowser('state', { sessionId: resolved });
      const returnedSessionId = String(state?.sessionId || '').trim();
      if (returnedSessionId !== resolved) {
        return { error: `ERROR: [browser_target_mismatch] Native browser returned a different session; requested=${resolved}, target=inhouse.` };
      }
      if (state?.attached !== true || !String(state?.url || '').trim()) {
      if (!targetIsKnownInHouse) return null;
      const hadPage = !!getPersistedBrowserSessionRecord(resolved);
      return { error: `ERROR: [${hadPage ? 'browser_session_unavailable' : 'browser_not_opened'}] No active native browser for session=${resolved}, target=inhouse. ${hadPage ? 'Saved page metadata exists, but Electron has no attached session.' : 'Open a browser for this chat first.'}` };
    }
    syncInHouseBrowserState(resolved, state);
    return { recovered: true };
  } catch (err: any) {
    return targetIsKnownInHouse
      ? { error: `ERROR: [browser_connection_failed] Could not recover session=${resolved}, target=inhouse: ${err.message}` }
      : null;
  }
}

export function buildInHouseStatusPayload(sessionId: string, statusLabel: string, extra: Record<string, any> = {}): BrowserSessionInfo & Record<string, any> {
  const resolved = resolveSessionId(sessionId);
  const inHouse = getInHouseSession(resolved);
  const interactionState = getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved));
  const inhouseProfile = String(extra.inhouseProfile || inHouse?.profileId || resolveInHouseProfileId(resolved) || 'main').trim();
  return {
    sessionId: resolved,
    active: !!inHouse,
    url: String(extra.url || inHouse?.url || ''),
    title: String(extra.title || inHouse?.title || ''),
    activeTabId: String(extra.activeTabId || inHouse?.activeTabId || '').trim(),
    tabs: Array.isArray(extra.tabs) ? normalizeInHouseTabs(extra.tabs) : normalizeInHouseTabs(inHouse?.tabs),
    inhouseProfile,
    profileKind: 'inhouse',
    browserTarget: 'inhouse',
    profileLabel: String(extra.profileLabel || (inhouseProfile === 'main' ? getBrowserProfileLabel('inhouse') : `In-house profile ${inhouseProfile}`)),
    profileDir: 'Electron persistent partition: persist:prometheus-inhouse-browser',
    debugPort: 0,
    mode: interactionState.mode,
    captured: interactionState.captured,
    controlOwner: interactionState.controlOwner,
    streamActive: false,
    streamTransport: '',
    streamFocus: 'interactive',
    source: extra.source || 'system',
    statusLabel,
    timestamp: Date.now(),
    ...extra,
  };
}

export function broadcastInHouseBrowserStatus(sessionId: string, tool: string, statusLabel: string, extra: Record<string, any> = {}): void {
  broadcastWS({
    type: 'browser:status',
    ...buildInHouseStatusPayload(sessionId, statusLabel, {
      tool,
      ...extra,
    }),
  });
}
