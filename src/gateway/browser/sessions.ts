
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

import path from 'path';

import { getConfig } from '../../config/config.js';
import { getActiveWorkspace } from '../../tools/workspace-context.js';

import { UserChromePage } from '../user-chrome-transport.js';

import { userChromeTabLocks, userChromeRelayUnsubscribers, browserConsolePageSessions, browserConsoleAttachedPages, browserSessionMetadata, sessions } from './state.js';
import { BrowserSession, BrowserConsoleEntry, BrowserSessionMetadata, BrowserProfileKind } from './types.js';
import { resolveSessionId } from './extraction.js';
import { getMainBrowserTarget } from './target.js';
import { getBrowserProfileLabel } from './chrome.js';


export function claimUserChromeTab(sessionId: string, page: UserChromePage): void {
  const tabId = page.tabId();
  const owner = userChromeTabLocks.get(tabId);
  if (owner && owner !== sessionId) throw new Error(`Personal Chrome tab is locked by browser session "${owner}". Select or open a different tab; concurrent agents cannot drive the same personal tab.`);
  userChromeTabLocks.set(tabId, sessionId);
}

export function releaseUserChromeTabLocks(sessionId: string): void {
  for (const [tabId, owner] of userChromeTabLocks) if (owner === sessionId) userChromeTabLocks.delete(tabId);
  const unsubscribe = userChromeRelayUnsubscribers.get(sessionId);
  if (unsubscribe) {
    try { unsubscribe(); } catch {}
    userChromeRelayUnsubscribers.delete(sessionId);
  }
}

export function safeBrowserPageUrl(page: any): string {
  try {
    return String(page?.url?.() || '');
  } catch {
    return '';
  }
}

export function pushBrowserConsoleEntry(session: BrowserSession, entry: Omit<BrowserConsoleEntry, 'ts'> & { ts?: number }): void {
  const entries = session.consoleEntries || (session.consoleEntries = []);
  entries.push({
    source: entry.source,
    level: String(entry.level || 'log'),
    message: String(entry.message || '').slice(0, 8000),
    ts: Number(entry.ts || Date.now()),
    url: entry.url || safeBrowserPageUrl(session.page),
    location: entry.location,
  });
  if (entries.length > 1000) entries.splice(0, entries.length - 1000);
}

export function attachBrowserConsoleCollector(session: BrowserSession, page: any): void {
  if (!page) return;
  let sessionSet = browserConsolePageSessions.get(page);
  if (!sessionSet) {
    sessionSet = new Set<BrowserSession>();
    browserConsolePageSessions.set(page, sessionSet);
  }
  sessionSet.add(session);
  if (browserConsoleAttachedPages.has(page)) return;
  browserConsoleAttachedPages.add(page);

  const pushToSessions = (entry: Omit<BrowserConsoleEntry, 'ts'> & { ts?: number }) => {
    const targets = browserConsolePageSessions.get(page) || new Set<BrowserSession>([session]);
    for (const target of targets) pushBrowserConsoleEntry(target, entry);
  };

  page.on?.('console', (msg: any) => {
    try {
      pushToSessions({
        source: 'playwright_console',
        level: String(msg?.type?.() || 'log'),
        message: String(msg?.text?.() || ''),
        url: safeBrowserPageUrl(page),
        location: msg?.location?.(),
      });
    } catch {}
  });
  page.on?.('pageerror', (err: any) => {
    try {
      pushToSessions({
        source: 'playwright_pageerror',
        level: 'error',
        message: String(err?.stack || err?.message || err || 'page error'),
        url: safeBrowserPageUrl(page),
      });
    } catch {}
  });
  page.on?.('crash', () => {
    pushToSessions({
      source: 'playwright_crash',
      level: 'error',
      message: 'Page crashed.',
      url: safeBrowserPageUrl(page),
    });
  });
  page.on?.('close', () => {
    try { browserConsolePageSessions.get(page)?.clear(); } catch {}
  });
}

export function inferBrowserOwnerType(sessionId: string): BrowserSessionMetadata['ownerType'] {
  const sid = String(sessionId || '').trim();
  if (sid.startsWith('background_')) return 'background';
  if (/^(subagent_|subagent_chat_|subagent-chat_)/i.test(sid)) return 'background';
  if (sid.startsWith('task_')) return 'task';
  if (sid.includes('::')) return 'detached';
  // Internal X scrapers (web_fetch include_thread/include_media) run their
  // own Playwright page. Treating them as 'main' made them inherit the main
  // chat's in-house browser target, which getOrCreateSession rejects.
  if (sid.startsWith('x_scrape_')) return 'detached';
  if (sid.startsWith('team_') || sid.startsWith('team_dispatch_')) return 'team-agent';
  return 'main';
}

export function inferBrowserOwnerId(sessionId: string): string {
  const sid = String(sessionId || '').trim();
  if (sid.startsWith('background_')) return sid.slice('background_'.length);
  if (sid.startsWith('subagent_chat_')) return sid.slice('subagent_chat_'.length);
  if (sid.startsWith('subagent-chat_')) return sid.slice('subagent-chat_'.length);
  if (sid.startsWith('subagent_')) return sid.slice('subagent_'.length);
  if (sid.startsWith('task_')) return sid.slice('task_'.length);
  return sid;
}

export function buildDefaultBrowserLabel(sessionId: string, ownerType = inferBrowserOwnerType(sessionId)): string {
  if (ownerType === 'background') return 'Subagent';
  if (ownerType === 'task') return 'Task Agent';
  if (ownerType === 'team-agent') return 'Team Agent';
  if (ownerType === 'detached') return 'Verifier';
  return 'Main Agent';
}

export function registerBrowserSessionMetadata(sessionId: string, input: Partial<Omit<BrowserSessionMetadata, 'sessionId' | 'createdAt' | 'updatedAt'>> = {}): BrowserSessionMetadata {
  const resolved = String(sessionId || 'default').trim() || 'default';
  const previous = browserSessionMetadata.get(resolved);
  const ownerType = input.ownerType || previous?.ownerType || inferBrowserOwnerType(resolved);
  const now = Date.now();
  const metadata: BrowserSessionMetadata = {
    sessionId: resolved,
    ownerType,
    ownerId: String(input.ownerId || previous?.ownerId || inferBrowserOwnerId(resolved)).trim(),
    workspacePath: path.resolve(String(input.workspacePath || previous?.workspacePath || getActiveWorkspace(getConfig().getWorkspacePath()))),
    label: String(input.label || previous?.label || buildDefaultBrowserLabel(resolved, ownerType)).trim(),
    taskPrompt: String(input.taskPrompt || previous?.taskPrompt || '').trim(),
    spawnerSessionId: String(input.spawnerSessionId || previous?.spawnerSessionId || '').trim(),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  browserSessionMetadata.set(resolved, metadata);
  return metadata;
}

/**
 * Runtime-owned label for a snapshot ref ("button \"Post\""), read from the last DOM
 * snapshot the gateway captured. Used by the final-action gate so classification
 * never depends on model-written descriptions of the target.
 */
export function getBrowserRefLabel(sessionId: string, ref: number | undefined): string {
  if (ref == null || !Number.isFinite(ref)) return '';
  try {
    const session = sessions.get(resolveSessionId(sessionId));
    const snapshot = String(session?.lastSnapshot || '');
    if (!snapshot) return '';
    const match = snapshot.match(new RegExp(`^\\s*\\[@${Math.floor(ref)}\\]\\s*([^\\n]*)$`, 'm'));
    return match ? match[1].replace(/\[frame:[^\]]*\]/g, '').trim().slice(0, 300) : '';
  } catch {
    return '';
  }
}

export function getBrowserSessionMetadata(sessionId: string): BrowserSessionMetadata {
  const resolved = resolveSessionId(sessionId);
  return browserSessionMetadata.get(resolved)
    || registerBrowserSessionMetadata(resolved, { ownerType: inferBrowserOwnerType(resolved) });
}

export function buildBrowserSessionMetadataPayload(sessionId: string): Record<string, any> {
  const metadata = getBrowserSessionMetadata(sessionId);
  const originLabel = formatBrowserSessionOriginLabel(sessionId, metadata);
  // Always emit the active lane so the renderer can flip its native in-house
  // surface on/off. The in-house lane sets these to 'inhouse' explicitly; the
  // Playwright/CDP lanes report the live session's profile (or the main target).
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  const profileKind: BrowserProfileKind = session?.profileKind
    || (metadata.ownerType === 'main' ? getMainBrowserTarget(resolved) : 'prometheus');
  const browserTarget: BrowserProfileKind = session?.browserTarget || profileKind;
  return {
    browserOwnerType: metadata.ownerType,
    browserOwnerId: metadata.ownerId || '',
    browserLabel: metadata.label || originLabel || buildDefaultBrowserLabel(sessionId, metadata.ownerType),
    browserOriginLabel: originLabel,
    browserTaskPrompt: metadata.taskPrompt || '',
    browserSpawnerSessionId: metadata.spawnerSessionId || '',
    profileKind,
    browserTarget,
    profileLabel: getBrowserProfileLabel(profileKind),
  };
}

export function lookupAgentName(agentId: string): string {
  const id = String(agentId || '').trim();
  if (!id) return '';
  try {
    const agent = (require('../../config/config') as typeof import('../../config/config')).getAgentById(id) as any;
    return String(agent?.name || id).trim();
  } catch {
    return id;
  }
}

export function lookupTaskSummary(taskId: string): { title: string; subagentProfile: string; teamAgentId: string; teamId: string } {
  const id = String(taskId || '').trim();
  if (!id) return { title: '', subagentProfile: '', teamAgentId: '', teamId: '' };
  try {
    const task = (require('../tasks/task-store') as typeof import('../tasks/task-store')).loadTask(id) as any;
    return {
      title: String(task?.title || task?.prompt || '').trim(),
      subagentProfile: String(task?.subagentProfile || '').trim(),
      teamAgentId: String(task?.teamSubagent?.agentId || task?.agentId || '').trim(),
      teamId: String(task?.teamSubagent?.teamId || task?.teamId || '').trim(),
    };
  } catch {
    return { title: '', subagentProfile: '', teamAgentId: '', teamId: '' };
  }
}

export function lookupTeamForAgent(agentId: string): { teamId: string; teamName: string } {
  const id = String(agentId || '').trim();
  if (!id) return { teamId: '', teamName: '' };
  try {
    const managed = require('../teams/managed-teams') as typeof import('../teams/managed-teams');
    const team = managed.getTeamForAgent(id) as any;
    return {
      teamId: String(team?.id || '').trim(),
      teamName: String(team?.name || '').trim(),
    };
  } catch {
    return { teamId: '', teamName: '' };
  }
}

export function parseTeamDispatchAgentId(sessionId: string): string {
  const match = String(sessionId || '').trim().match(/^team_dispatch_(.+)_\d+$/);
  return String(match?.[1] || '').trim();
}

export function formatBrowserSessionOriginLabel(sessionId: string, metadata = getBrowserSessionMetadata(sessionId)): string {
  const sid = String(sessionId || '').trim();
  const ownerId = String(metadata.ownerId || '').trim();
  if (metadata.ownerType === 'main') return 'Main Chat';
  if (metadata.ownerType === 'background') {
    const suffix = ownerId ? ` ${ownerId}` : '';
    return `Background agent (background_spawn)${suffix}`;
  }
  if (metadata.ownerType === 'task') {
    const task = lookupTaskSummary(ownerId || sid.replace(/^task_/, ''));
    if (task.teamAgentId || task.teamId) {
      const agentId = task.teamAgentId || task.subagentProfile;
      const team = task.teamId
        ? (() => {
            try {
              const managed = require('../teams/managed-teams') as typeof import('../teams/managed-teams');
              const t = managed.getManagedTeam(task.teamId) as any;
              return { teamId: task.teamId, teamName: String(t?.name || task.teamId).trim() };
            } catch {
              return { teamId: task.teamId, teamName: task.teamId };
            }
          })()
        : lookupTeamForAgent(agentId);
      return `Team Subagent (${team.teamName || team.teamId || 'Team'} / ${lookupAgentName(agentId) || agentId || 'agent'})`;
    }
    if (task.subagentProfile) return `Subagent (${task.subagentProfile})`;
    return `Background task${task.title ? ` (${task.title.slice(0, 60)})` : ''}`;
  }
  if (metadata.ownerType === 'team-agent') {
    const agentId = parseTeamDispatchAgentId(sid) || ownerId;
    const team = lookupTeamForAgent(agentId);
    return `Team Subagent (${team.teamName || team.teamId || 'Team'} / ${lookupAgentName(agentId) || agentId || 'agent'})`;
  }
  if (metadata.ownerType === 'detached') return `Detached browser (${metadata.label || ownerId || sid})`;
  return metadata.label || buildDefaultBrowserLabel(sid, metadata.ownerType);
}
