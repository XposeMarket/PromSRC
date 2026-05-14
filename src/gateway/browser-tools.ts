/**
 * browser-tools.ts - Browser Automation for Prometheus
 * 
 * Strategy: Connect to user's Chrome via CDP (--remote-debugging-port=9222).
 * If Chrome isn't running with the debug port, launch it ourselves with a
 * dedicated Prometheus profile so it doesn't conflict with the user's Chrome.
 * 
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { formatShortcutsForUrl } from './site-shortcuts';
import {
  type BrowserKnowledgeExtractionField,
  type BrowserKnowledgeExtractionSchema,
  formatNamedBrowserElementsForUrl,
  listNamedBrowserElementsForUrl,
  listNamedBrowserExtractionSchemasForUrl,
  listNamedBrowserItemRootsForUrl,
  matchNamedBrowserElementForUrl,
  matchNamedBrowserExtractionSchemaForUrl,
  matchNamedBrowserItemRootForUrl,
  saveNamedBrowserElementForUrl,
  saveNamedBrowserExtractionSchemaForUrl,
  saveNamedBrowserItemRootForUrl,
  type BrowserKnowledgeElement,
  type BrowserKnowledgeItemRoot,
  type BrowserSiteKnowledge,
} from './browser-site-knowledge.js';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from '../tools/workspace-context.js';
import { broadcastWS } from './comms/broadcaster';

type PwBrowser = any;
type PwContext = any;
type PwPage = any;

interface BrowserSession {
  sessionId: string;
  browser: PwBrowser;
  context: PwContext;
  page: PwPage;
  ownsBrowser: boolean;
  isolated: boolean;
  debugPort?: number;
  profileDir?: string;
  lastSnapshot: string;
  lastSnapshotAt: number;  // epoch ms when lastSnapshot was captured; 0 = never
  lastPageUrl: string;
  lastPageTitle: string;
  injectedStaticContext: Partial<Record<'shortcuts' | 'knowledge' | 'control', {
    key: string;
    hash: string;
    shownAt: number;
  }>>;
  createdAt: number;
}

export interface BrowserSessionMetadata {
  sessionId: string;
  ownerType: 'main' | 'background' | 'task' | 'team-agent' | 'detached';
  ownerId?: string;
  label?: string;
  taskPrompt?: string;
  spawnerSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

interface PersistedBrowserSessionRecord {
  sessionId: string;
  url: string;
  title: string;
  updatedAt: number;
}

interface BrowserSessionRestoreHint {
  url?: string;
  title?: string;
}

export type BrowserInteractionMode = 'agent' | 'copilot' | 'teach';
export type BrowserUserAction = {
  kind: 'click' | 'wheel' | 'key' | 'text';
  x?: number;
  y?: number;
  button?: 'left' | 'middle' | 'right';
  deltaX?: number;
  deltaY?: number;
  key?: string;
  text?: string;
  mode: BrowserInteractionMode;
  url: string;
  title: string;
  summary: string;
  timestamp: number;
};

interface BrowserInteractionState {
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  lastInputAt: number;
  recentUserActions: BrowserUserAction[];
  lastActor: 'agent' | 'user' | 'system';
  lastActorSummary: string;
  updatedAt: number;
}

export interface BrowserSessionInfo {
  active: boolean;
  url?: string;
  title?: string;
  sessionId?: string;
  originLabel?: string;
  debugPort?: number;
  profileDir?: string;
  mode?: BrowserInteractionMode;
  captured?: boolean;
  controlOwner?: BrowserInteractionState['controlOwner'];
  streamActive?: boolean;
  streamTransport?: 'cdp' | 'snapshot' | '';
  streamFocus?: 'passive' | 'interactive';
  lastActor?: BrowserInteractionState['lastActor'];
  lastActorSummary?: string;
  recentUserActions?: BrowserUserAction[];
}

export interface BrowserSessionListEntry extends BrowserSessionInfo {
  sessionId: string;
  ownerType: BrowserSessionMetadata['ownerType'];
  ownerId: string;
  label: string;
  taskPrompt: string;
  spawnerSessionId: string;
  createdAt: number;
  updatedAt: number;
}

export type BrowserTeachPhase = 'idle' | 'recording' | 'approval_pending' | 'verifying' | 'verified';

export interface BrowserTeachStepSnapshot {
  id: string;
  kind: string;
  toolName: string;
  title: string;
  summary: string;
  toolPreview: string;
  targetName: string;
  risk: 'none' | 'high';
  status: string;
  createdAt: number;
  executedAt: number;
  pageUrl: string;
  pageTitle: string;
  resultSummary: string;
  selection?: {
    selector?: string;
    tagName?: string;
    id?: string;
    text?: string;
    bounds?: { x: number; y: number; width: number; height: number } | null;
  } | null;
  input?: Record<string, any>;
  args?: Record<string, any>;
}

export interface BrowserTeachVerificationResult {
  status: 'passed' | 'failed' | 'partial';
  mode: 'full' | 'safe' | 'step';
  boundaryLabel: string;
  stopBeforeStep: number;
  verifierSessionId: string;
  executedCount: number;
  totalRecordedSteps: number;
  riskyStepIndexes: number[];
  failedStep?: number;
  failureSummary?: string;
  finalUrl: string;
  finalTitle: string;
  startedAt: number;
  completedAt: number;
}

export interface BrowserTeachSessionSnapshot {
  active: boolean;
  phase: BrowserTeachPhase;
  startedAt: number;
  completedAt: number;
  approvalRequestedAt: number;
  reviewRequestedAt: number;
  startUrl: string;
  startTitle: string;
  executingStepId: string;
  steps: BrowserTeachStepSnapshot[];
  pendingStep?: BrowserTeachStepSnapshot | null;
  verification?: BrowserTeachVerificationResult | null;
}

interface SnapElement {
  ref: number;
  tag: string;        // raw tag name
  role: string;       // semantic role for the LLM
  name: string;       // visible text / label
  type?: string;      // input type="" if applicable
  placeholder?: string;
  value?: string;
  isInput: boolean;   // can this be filled?
}

export type BrowserPageType = 'x_feed' | 'search_results' | 'article' | 'chat_interface' | 'generic';

export interface BrowserFeedItem {
  id?: string;
  author?: string;
  handle?: string;
  time?: string;
  text?: string;
  link?: string;
  title?: string;
  snippet?: string;
  source?: string;
  hasImage?: boolean;
  hasVideo?: boolean;
  media?: Array<{
    type: 'image' | 'video';
    url?: string;
    previewUrl?: string;
  }>;
  metrics?: {
    likes?: string;
    replies?: string;
    reposts?: string;
    views?: string;
  };
}

interface BrowserScrollSnapshotDelta {
  pass: number;
  scrollY: number;
  added: string[];
  removed: string[];
  totalElements: number;
}

export interface BrowserAdvisorPacket {
  page: {
    title: string;
    url: string;
    pageType: BrowserPageType;
  };
  snapshot: string;
  snapshotElements: number;
  extractedFeed: BrowserFeedItem[];
  textBlocks: string[];
  pageText: string;          // visible body text for non-feed pages (chat responses, articles)
  isGenerating: boolean;    // true when a chat interface is still streaming a response
  contentHash: string;
}

export type BrowserObserveMode = 'none' | 'compact' | 'delta' | 'snapshot' | 'screenshot';

const OBSERVE_MODE_ENUM: BrowserObserveMode[] = ['none', 'compact', 'delta', 'snapshot', 'screenshot'];

const BROWSER_TOOL_DEFAULT_OBSERVE_MODE: Record<string, BrowserObserveMode> = {
  browser_wait: 'none',
  browser_get_page_text: 'none',
  browser_get_focused_item: 'none',
  browser_click: 'delta',
  browser_fill: 'delta',
  browser_upload_file: 'screenshot',
  browser_press_key: 'none',
  browser_key: 'none',
  browser_drag: 'delta',
  browser_click_and_download: 'delta',
  browser_scroll_collect: 'delta',
  browser_scroll: 'none',
  browser_open: 'screenshot',
  browser_vision_click: 'screenshot',
  browser_snapshot: 'snapshot',
  browser_snapshot_delta: 'none',
  browser_vision_screenshot: 'screenshot',
  browser_vision_type: 'delta',
  browser_send_to_telegram: 'none',
  browser_run_js: 'screenshot',
};

function normalizeBrowserObserveMode(mode: unknown): BrowserObserveMode | undefined {
  const value = String(mode || '').trim().toLowerCase();
  return value === 'none' || value === 'compact' || value === 'delta' || value === 'snapshot' || value === 'screenshot'
    ? value
    : undefined;
}

export function resolveBrowserObserveMode(toolName: string, observe?: unknown): BrowserObserveMode {
  return normalizeBrowserObserveMode(observe)
    || BROWSER_TOOL_DEFAULT_OBSERVE_MODE[String(toolName || '').trim()]
    || 'none';
}

function attachShortcutsContext(
  output: string,
  url: string,
  sessionId?: string,
  options?: { forceStatic?: boolean },
): string {
  const text = String(output || '');
  const extras: string[] = [];
  const resolvedSessionId = sessionId ? resolveSessionId(sessionId) : '';
  const session = resolvedSessionId ? sessions.get(resolvedSessionId) || null : null;
  const interactionState = sessionId
    ? browserInteractionStates.get(resolveBrowserInteractionStateId(sessionId))
    : null;
  const interactionMode = normalizeBrowserInteractionMode(interactionState?.mode);
  const forceStaticRefresh = !!options?.forceStatic
    || /\berror\b|\bfailed\b|\bnot found\b|\bcould not\b|\brecover(?:y|ing)?\b/i.test(text);
  const forceRefreshCooldownMs = 15_000;
  const contextHost = (() => {
    try {
      const parsed = new URL(String(url || '').startsWith('http') ? String(url || '') : `https://${String(url || '')}`);
      return parsed.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return String(url || '').trim().toLowerCase();
    }
  })();
  const shouldAppendStaticContext = (
    kind: 'shortcuts' | 'knowledge' | 'control',
    key: string,
    block: string,
  ): boolean => {
    if (!block) return false;
    if (!session) return true;
    if (!session.injectedStaticContext) session.injectedStaticContext = {};
    const entry = session.injectedStaticContext?.[kind];
    const hash = stableHash(block);
    const changed = !entry || entry.key !== key || entry.hash !== hash;
    const withinForceCooldown = !!entry
      && entry.key === key
      && entry.hash === hash
      && (Date.now() - Number(entry.shownAt || 0)) < forceRefreshCooldownMs;
    if (!changed && (!forceStaticRefresh || withinForceCooldown)) return false;
    session.injectedStaticContext[kind] = { key, hash, shownAt: Date.now() };
    return true;
  };
  if (!text.includes('SITE SHORTCUTS FOR')) {
    const shortcutsBlock = formatShortcutsForUrl(url);
    if (shouldAppendStaticContext('shortcuts', `${contextHost}|mode=${interactionMode}`, shortcutsBlock)) {
      extras.push(shortcutsBlock);
    }
  }
  if (!text.includes('BROWSER MEMORY FOR')) {
    const knowledgeBlock = formatNamedBrowserElementsForUrl(url);
    if (shouldAppendStaticContext('knowledge', contextHost, knowledgeBlock)) {
      extras.push(knowledgeBlock);
    }
  }
  if (sessionId && !text.includes('[BROWSER CONTROL]')) {
    const interactionBlock = formatBrowserInteractionContextBlock(sessionId);
    if (shouldAppendStaticContext('control', `${contextHost}|mode=${interactionMode}`, interactionBlock)) {
      extras.push(interactionBlock);
    }
  }
  if (!extras.length) return text;
  return text ? `${text}\n\n${extras.join('\n\n')}` : extras.join('\n\n');
}

function rememberSnapshot(session: BrowserSession, snapshot: string): void {
  const previousUrl = session.lastPageUrl || '';
  const previousTitle = session.lastPageTitle || '';
  session.lastSnapshot = snapshot;
  session.lastSnapshotAt = Date.now();
  const titleMatch = snapshot.match(/^Page:\s*(.+)$/m);
  const urlMatch = snapshot.match(/^URL:\s*(.+)$/m);
  if (titleMatch?.[1]) session.lastPageTitle = titleMatch[1].trim();
  if (urlMatch?.[1]) session.lastPageUrl = urlMatch[1].trim();
  if (session.lastPageUrl !== previousUrl || session.lastPageTitle !== previousTitle) {
    persistBrowserSessionRecord(session);
  }
}

async function syncPageMetadata(session: BrowserSession): Promise<{
  url: string;
  title: string;
  urlChanged: boolean;
  titleChanged: boolean;
}> {
  const previousUrl = session.lastPageUrl || '';
  const previousTitle = session.lastPageTitle || '';
  const url = String(session.page.url?.() || '').trim();
  let title = '';
  try {
    title = String(await session.page.title()).trim();
  } catch {
    title = previousTitle;
  }
  const urlChanged = !!url && url !== previousUrl;
  const titleChanged = !!title && title !== previousTitle;
  if (url) session.lastPageUrl = url;
  if (title) session.lastPageTitle = title;
  if (session.lastPageUrl !== previousUrl || session.lastPageTitle !== previousTitle) {
    persistBrowserSessionRecord(session);
  }
  return {
    url: session.lastPageUrl,
    title: session.lastPageTitle,
    urlChanged,
    titleChanged,
  };
}

function rememberPageMetadata(session: BrowserSession, state: { url?: string; title?: string }): void {
  const previousUrl = session.lastPageUrl || '';
  const previousTitle = session.lastPageTitle || '';
  const url = String(state?.url || '').trim();
  const title = String(state?.title || '').trim();
  if (url) session.lastPageUrl = url;
  if (title) session.lastPageTitle = title;
  if (session.lastPageUrl !== previousUrl || session.lastPageTitle !== previousTitle) {
    persistBrowserSessionRecord(session);
  }
}

function truncateCompactValue(value: string, max: number = 90): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
}

type BrowserCompactState = {
  url: string;
  title: string;
  elementCount: number;
  focusSignature: string;
  focusSummary: string;
};

async function captureCompactBrowserState(page: PwPage): Promise<BrowserCompactState> {
  const url = String(page.url?.() || '').trim();
  let title = '';
  try {
    title = String(await page.title()).trim();
  } catch {}
  const compactData = await page.evaluate((selector: string) => {
    const doc = (globalThis as any).document;
    const openModal = (
      doc.querySelector('[role="dialog"][aria-modal="true"]')
      || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
      || doc.querySelector('[data-testid="sheetDialog"], [data-testid="confirmationSheetDialog"], [data-testid="keyboardShortcutModal"]')
      || doc.querySelector('dialog[open]')
      || doc.querySelector('[data-testid="Dropdown"]')
      || doc.querySelector('[role="menu"]')
      || null
    );
    const searchRoot = openModal || doc;
    const seen = new Set<any>();
    const nodes: any[] = [];
    for (const el of Array.from(searchRoot.querySelectorAll(selector))) {
      if (!seen.has(el)) {
        seen.add(el);
        nodes.push(el);
      }
    }
    const isVisible = (el: any) => {
      const rect = typeof el?.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      const hiddenByBox =
        (el?.offsetWidth === 0 && el?.offsetHeight === 0)
        || (rect ? (rect.width === 0 && rect.height === 0) : false);
      const style = typeof (globalThis as any).getComputedStyle === 'function'
        ? (globalThis as any).getComputedStyle(el)
        : null;
      const hiddenByStyle =
        !!style
        && (style.display === 'none' || style.visibility === 'hidden');
      return !(hiddenByBox || hiddenByStyle);
    };
    let elementCount = 0;
    for (const el of nodes) {
      const tag = String(el?.tagName || '').toLowerCase();
      const role = String(el?.getAttribute?.('role') || '').toLowerCase();
      const isContentEditable = el?.getAttribute?.('contenteditable') === 'true';
      const inputLikeTag = ['input', 'textarea', 'select'].includes(tag) || isContentEditable;
      const name = String(
        el?.getAttribute?.('aria-label')
        || (el?.innerText || '').trim()
        || el?.getAttribute?.('placeholder')
        || el?.getAttribute?.('data-testid')
        || ''
      ).trim();
      if (!name && !inputLikeTag) continue;
      if (!isVisible(el)) continue;
      elementCount += 1;
    }

    const describeTweet = (tweetEl: any) => {
      if (!tweetEl) return null;
      const tweetText = String((tweetEl.querySelector?.('[data-testid="tweetText"]') as any)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      const author = String((tweetEl.querySelector?.('[data-testid="User-Name"]') as any)?.innerText || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      const link = String((tweetEl.querySelector?.('a[href*="/status/"]') as any)?.href || '').trim();
      const idMatch = link.match(/\/status\/(\d+)/);
      const allTweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
      const idx = allTweets.indexOf(tweetEl);
      const position = idx >= 0 ? idx + 1 : 0;
      const totalVisible = allTweets.length;
      const pieces = [`tweet #${position || '?'}/${totalVisible || '?'}`];
      if (author) pieces.push(author);
      if (tweetText) pieces.push(`"${tweetText}"`);
      return {
        focusSignature: `tweet:${idMatch?.[1] || `${position}:${author}:${tweetText.slice(0, 40)}`}`,
        focusSummary: pieces.join(' '),
      };
    };

    const focused = doc.activeElement;
    if (!focused || focused === doc.body) {
      const highlighted = doc.querySelector(
        'article[data-testid="tweet"][tabindex="0"], article[data-testid="tweet"]:focus-within'
      );
      const tweet = describeTweet(highlighted);
      if (tweet) return { elementCount, ...tweet };
      return {
        elementCount,
        focusSignature: 'none',
        focusSummary: 'none',
      };
    }

    let article: any = focused;
    while (article && article.tagName?.toLowerCase() !== 'article') {
      article = article.parentElement;
    }
    if (article && article.getAttribute?.('data-testid') === 'tweet') {
      const tweet = describeTweet(article);
      if (tweet) return { elementCount, ...tweet };
    }

    const tag = String(focused.tagName || '').toLowerCase() || 'element';
    const role = String(focused.getAttribute?.('role') || '').toLowerCase() || tag;
    const ariaLabel = String(focused.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const placeholder = String(focused.getAttribute?.('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const text = String(focused.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const testId = String(focused.getAttribute?.('data-testid') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const label = ariaLabel || text || placeholder || testId || tag;
    return {
      elementCount,
      focusSignature: `element:${tag}:${role}:${ariaLabel}:${placeholder}:${testId}:${text.slice(0, 40)}`,
      focusSummary: `${tag}${role && role !== tag ? ` role=${role}` : ''} "${label}"`,
    };
  }, INTERACTIVE_SELECTOR).catch(() => ({
    elementCount: 0,
    focusSignature: 'unknown',
    focusSummary: 'unknown',
  }));
  return {
    url,
    title,
    elementCount: Number(compactData?.elementCount || 0),
    focusSignature: String(compactData?.focusSignature || 'unknown'),
    focusSummary: String(compactData?.focusSummary || 'unknown'),
  };
}

async function buildCompactBrowserObservation(
  session: BrowserSession,
  action: string,
  before: BrowserCompactState,
): Promise<string> {
  const after = await captureCompactBrowserState(session.page);
  rememberPageMetadata(session, after);
  const urlChanged = before.url !== after.url;
  const titleChanged = before.title !== after.title;
  const focusChanged = before.focusSignature !== after.focusSignature;
  const lines = [
    action,
    urlChanged
      ? `URL changed: ${truncateCompactValue(before.url) || '(blank)'} -> ${truncateCompactValue(after.url) || '(blank)'}.`
      : 'URL unchanged.',
    titleChanged
      ? `Title changed: ${truncateCompactValue(before.title) || '(blank)'} -> ${truncateCompactValue(after.title) || '(blank)'}.`
      : 'Title unchanged.',
    `Focused element changed: ${focusChanged ? 'yes' : 'no'}.`,
    `DOM count: ${before.elementCount} -> ${after.elementCount}.`,
  ];
  const focusSummary = truncateCompactValue(after.focusSummary, 120);
  if (focusSummary && focusSummary !== 'unknown') {
    lines.push(`Focused element: ${focusSummary}.`);
  }
  return lines.join('\n');
}

async function buildMinimalBrowserAck(session: BrowserSession, base: string): Promise<string> {
  const meta = await syncPageMetadata(session);
  const extras: string[] = [];
  if (meta.urlChanged && meta.url) extras.push(`URL: ${meta.url}`);
  if (meta.titleChanged && meta.title) extras.push(`Title: ${meta.title}`);
  return extras.length ? `${base}\n${extras.join('\n')}` : base;
}

function shouldReturnSnapshot(mode: BrowserObserveMode): boolean {
  return mode === 'snapshot';
}

function shouldUseCompactObservation(mode: BrowserObserveMode): boolean {
  return mode === 'compact';
}

// ─── Session Management ────────────────────────────────────────────────────────

const sessions: Map<string, BrowserSession> = new Map();
const browserSessionMetadata: Map<string, BrowserSessionMetadata> = new Map();
const browserInteractionStates: Map<string, BrowserInteractionState> = new Map();
const browserControlWaiters: Map<string, Array<() => void>> = new Map();
const browserTeachSessions: Map<string, BrowserTeachSessionSnapshot> = new Map();
let browserSessionRegistryCache: Map<string, PersistedBrowserSessionRecord> | null = null;

function inferBrowserOwnerType(sessionId: string): BrowserSessionMetadata['ownerType'] {
  const sid = String(sessionId || '').trim();
  if (sid.startsWith('background_')) return 'background';
  if (sid.startsWith('task_')) return 'task';
  if (sid.includes('::')) return 'detached';
  if (sid.startsWith('team_') || sid.startsWith('team_dispatch_')) return 'team-agent';
  return 'main';
}

function inferBrowserOwnerId(sessionId: string): string {
  const sid = String(sessionId || '').trim();
  if (sid.startsWith('background_')) return sid.slice('background_'.length);
  if (sid.startsWith('task_')) return sid.slice('task_'.length);
  return sid;
}

function buildDefaultBrowserLabel(sessionId: string, ownerType = inferBrowserOwnerType(sessionId)): string {
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
    label: String(input.label || previous?.label || buildDefaultBrowserLabel(resolved, ownerType)).trim(),
    taskPrompt: String(input.taskPrompt || previous?.taskPrompt || '').trim(),
    spawnerSessionId: String(input.spawnerSessionId || previous?.spawnerSessionId || '').trim(),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  browserSessionMetadata.set(resolved, metadata);
  return metadata;
}

export function getBrowserSessionMetadata(sessionId: string): BrowserSessionMetadata {
  const resolved = resolveSessionId(sessionId);
  return browserSessionMetadata.get(resolved)
    || registerBrowserSessionMetadata(resolved, { ownerType: inferBrowserOwnerType(resolved) });
}

function buildBrowserSessionMetadataPayload(sessionId: string): Record<string, any> {
  const metadata = getBrowserSessionMetadata(sessionId);
  const originLabel = formatBrowserSessionOriginLabel(sessionId, metadata);
  return {
    browserOwnerType: metadata.ownerType,
    browserOwnerId: metadata.ownerId || '',
    browserLabel: metadata.label || originLabel || buildDefaultBrowserLabel(sessionId, metadata.ownerType),
    browserOriginLabel: originLabel,
    browserTaskPrompt: metadata.taskPrompt || '',
    browserSpawnerSessionId: metadata.spawnerSessionId || '',
  };
}

function lookupAgentName(agentId: string): string {
  const id = String(agentId || '').trim();
  if (!id) return '';
  try {
    const agent = (require('../config/config') as typeof import('../config/config')).getAgentById(id) as any;
    return String(agent?.name || id).trim();
  } catch {
    return id;
  }
}

function lookupTaskSummary(taskId: string): { title: string; subagentProfile: string; teamAgentId: string; teamId: string } {
  const id = String(taskId || '').trim();
  if (!id) return { title: '', subagentProfile: '', teamAgentId: '', teamId: '' };
  try {
    const task = (require('./tasks/task-store') as typeof import('./tasks/task-store')).loadTask(id) as any;
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

function lookupTeamForAgent(agentId: string): { teamId: string; teamName: string } {
  const id = String(agentId || '').trim();
  if (!id) return { teamId: '', teamName: '' };
  try {
    const managed = require('./teams/managed-teams') as typeof import('./teams/managed-teams');
    const team = managed.getTeamForAgent(id) as any;
    return {
      teamId: String(team?.id || '').trim(),
      teamName: String(team?.name || '').trim(),
    };
  } catch {
    return { teamId: '', teamName: '' };
  }
}

function parseTeamDispatchAgentId(sessionId: string): string {
  const match = String(sessionId || '').trim().match(/^team_dispatch_(.+)_\d+$/);
  return String(match?.[1] || '').trim();
}

function formatBrowserSessionOriginLabel(sessionId: string, metadata = getBrowserSessionMetadata(sessionId)): string {
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
              const managed = require('./teams/managed-teams') as typeof import('./teams/managed-teams');
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
type BrowserLiveStreamFocus = 'passive' | 'interactive';
type BrowserLiveStreamTransport = 'cdp' | 'snapshot';
interface BrowserLiveStreamState {
  sessionId: string;
  active: boolean;
  focus: BrowserLiveStreamFocus;
  transport: BrowserLiveStreamTransport | null;
  status: string;
  startedAt: number;
  lastFrameAt: number;
  loopToken: number;
  leaseTimer: any;
  cdpSession: any | null;
  cdpFrameHandler: ((payload: any) => void) | null;
}
const browserLiveStreams: Map<string, BrowserLiveStreamState> = new Map();
const BROWSER_LIVE_STREAM_LEASE_MS = 20_000;
const BROWSER_STREAM_HEARTBEAT_STATUS = 'Live browser stream ready.';

function normalizeBrowserInteractionMode(mode: unknown): BrowserInteractionMode {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'copilot' || value === 'teach') return value;
  return 'agent';
}

function getBrowserSessionRegistryPath(): string {
  return path.join(getConfig().getConfigDir(), 'browser-sessions.json');
}

function shouldPersistBrowserSessionId(sessionId: string): boolean {
  const value = String(sessionId || '').trim();
  if (!value) return false;
  if (value.startsWith('__preview_internal__')) return false;
  if (value.startsWith('task_')) return false;
  if (value.includes('::')) return false;
  return true;
}

function isRestorableBrowserUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  if (/^about:/i.test(value)) return false;
  if (/^chrome:/i.test(value)) return false;
  if (/^devtools:/i.test(value)) return false;
  return true;
}

function loadBrowserSessionRegistry(): Map<string, PersistedBrowserSessionRecord> {
  if (browserSessionRegistryCache) return browserSessionRegistryCache;
  const registry = new Map<string, PersistedBrowserSessionRecord>();
  const registryPath = getBrowserSessionRegistryPath();
  try {
    if (fs.existsSync(registryPath)) {
      const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      const entries = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      for (const entry of entries) {
        const sessionId = String(entry?.sessionId || '').trim();
        if (!shouldPersistBrowserSessionId(sessionId)) continue;
        registry.set(sessionId, {
          sessionId,
          url: String(entry?.url || '').trim(),
          title: String(entry?.title || '').trim(),
          updatedAt: Number(entry?.updatedAt || 0) || 0,
        });
      }
    }
  } catch (err: any) {
    console.warn(`[Browser] Could not load persisted browser session registry: ${String(err?.message || err)}`);
  }
  browserSessionRegistryCache = registry;
  return registry;
}

function writeBrowserSessionRegistry(registry: Map<string, PersistedBrowserSessionRecord> = loadBrowserSessionRegistry()): void {
  const registryPath = getBrowserSessionRegistryPath();
  try {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        sessions: [...registry.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
      }, null, 2),
      'utf-8',
    );
  } catch (err: any) {
    console.warn(`[Browser] Could not persist browser session registry: ${String(err?.message || err)}`);
  }
}

function getPersistedBrowserSessionRecord(sessionId: string): PersistedBrowserSessionRecord | null {
  const resolved = String(sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(resolved)) return null;
  return loadBrowserSessionRegistry().get(resolved) || null;
}

function buildBrowserSessionRestoreRecord(
  sessionId: string,
  hint?: BrowserSessionRestoreHint | null,
): PersistedBrowserSessionRecord | null {
  const resolved = String(sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(resolved)) return null;
  const persisted = getPersistedBrowserSessionRecord(resolved);
  if (persisted && isRestorableBrowserUrl(persisted.url)) return persisted;
  const hintedUrl = String(hint?.url || '').trim();
  if (isRestorableBrowserUrl(hintedUrl)) {
    return {
      sessionId: resolved,
      url: hintedUrl,
      title: String(hint?.title || '').trim(),
      updatedAt: Date.now(),
    };
  }
  return persisted;
}

function upsertPersistedBrowserSessionRecord(record: PersistedBrowserSessionRecord): void {
  const sessionId = String(record?.sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(sessionId)) return;
  const url = String(record?.url || '').trim();
  const title = String(record?.title || '').trim();
  if (!isRestorableBrowserUrl(url)) return;
  if (!url && !title) return;
  const registry = loadBrowserSessionRegistry();
  const previous = registry.get(sessionId);
  if (previous && previous.url === url && previous.title === title) return;
  registry.set(sessionId, {
    sessionId,
    url,
    title,
    updatedAt: Date.now(),
  });
  writeBrowserSessionRegistry(registry);
}

function removePersistedBrowserSessionRecord(sessionId: string): void {
  const resolved = String(sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(resolved)) return;
  const registry = loadBrowserSessionRegistry();
  if (!registry.delete(resolved)) return;
  writeBrowserSessionRegistry(registry);
}

function normalizeBrowserRestoreUrl(rawUrl: string): string {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value.replace(/#.*$/, '');
  }
}

async function findRestorableBrowserPage(
  pages: any[],
  record: PersistedBrowserSessionRecord | null,
): Promise<any | null> {
  if (!record || !Array.isArray(pages) || !pages.length) return null;
  const targetUrl = normalizeBrowserRestoreUrl(record.url);
  const targetTitle = String(record.title || '').trim();
  let bestPage: any | null = null;
  let bestScore = 0;
  for (const page of pages) {
    let pageUrl = '';
    let pageTitle = '';
    try { pageUrl = String(page?.url?.() || '').trim(); } catch {}
    try { pageTitle = String(await page?.title?.()).trim(); } catch {}
    let score = 0;
    if (targetUrl && normalizeBrowserRestoreUrl(pageUrl) === targetUrl) score += 4;
    if (targetTitle && pageTitle === targetTitle) score += 2;
    if (!targetUrl && targetTitle && pageTitle === targetTitle) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestPage = page;
    }
  }
  return bestScore > 0 ? bestPage : null;
}

function persistBrowserSessionRecord(session: BrowserSession): void {
  const sessionId = String(session?.sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(sessionId)) return;
  upsertPersistedBrowserSessionRecord({
    sessionId,
    url: String(session?.lastPageUrl || session?.page?.url?.() || '').trim(),
    title: String(session?.lastPageTitle || '').trim(),
    updatedAt: Date.now(),
  });
}

function normalizeBrowserTeachPhase(phase: unknown): BrowserTeachPhase {
  const value = String(phase || '').trim().toLowerCase();
  if (value === 'recording' || value === 'approval_pending' || value === 'verifying' || value === 'verified') return value;
  return 'idle';
}

function normalizeBrowserTeachRisk(risk: unknown): 'none' | 'high' {
  return String(risk || '').trim().toLowerCase() === 'high' ? 'high' : 'none';
}

function sanitizeBrowserTeachStep(raw: any): BrowserTeachStepSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const toolName = String(raw.toolName || '').trim();
  if (!toolName) return null;
  const selection = raw.selection && typeof raw.selection === 'object'
    ? {
        selector: String(raw.selection.selector || '').trim(),
        tagName: String(raw.selection.tagName || '').trim(),
        id: String(raw.selection.id || '').trim(),
        text: String(raw.selection.text || '').trim(),
        bounds: raw.selection.bounds && typeof raw.selection.bounds === 'object'
          ? {
              x: Number(raw.selection.bounds.x || 0) || 0,
              y: Number(raw.selection.bounds.y || 0) || 0,
              width: Number(raw.selection.bounds.width || 0) || 0,
              height: Number(raw.selection.bounds.height || 0) || 0,
            }
          : null,
      }
    : null;
  return {
    id: String(raw.id || '').trim() || `teach-step-${Date.now()}`,
    kind: String(raw.kind || '').trim(),
    toolName,
    title: String(raw.title || '').trim(),
    summary: String(raw.summary || '').trim(),
    toolPreview: String(raw.toolPreview || '').trim(),
    targetName: String(raw.targetName || '').trim(),
    risk: normalizeBrowserTeachRisk(raw.risk),
    status: String(raw.status || '').trim() || 'recorded',
    createdAt: Number(raw.createdAt || 0) || 0,
    executedAt: Number(raw.executedAt || 0) || 0,
    pageUrl: String(raw.pageUrl || '').trim(),
    pageTitle: String(raw.pageTitle || '').trim(),
    resultSummary: String(raw.resultSummary || '').trim(),
    selection,
    input: raw.input && typeof raw.input === 'object' ? { ...raw.input } : {},
    args: raw.args && typeof raw.args === 'object' ? { ...raw.args } : {},
  };
}

function sanitizeBrowserTeachVerification(raw: any): BrowserTeachVerificationResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = String(raw.status || '').trim().toLowerCase();
  const mode = String(raw.mode || '').trim().toLowerCase();
  return {
    status: status === 'failed' ? 'failed' : (status === 'partial' ? 'partial' : 'passed'),
    mode: mode === 'safe' ? 'safe' : (mode === 'step' ? 'step' : 'full'),
    boundaryLabel: String(raw.boundaryLabel || '').trim(),
    stopBeforeStep: Math.max(0, Number(raw.stopBeforeStep || 0) || 0),
    verifierSessionId: String(raw.verifierSessionId || '').trim(),
    executedCount: Math.max(0, Number(raw.executedCount || 0) || 0),
    totalRecordedSteps: Math.max(0, Number(raw.totalRecordedSteps || 0) || 0),
    riskyStepIndexes: Array.isArray(raw.riskyStepIndexes)
      ? raw.riskyStepIndexes.map((value: any) => Math.max(0, Number(value || 0) || 0)).filter(Boolean)
      : [],
    failedStep: Math.max(0, Number(raw.failedStep || 0) || 0) || undefined,
    failureSummary: String(raw.failureSummary || '').trim() || undefined,
    finalUrl: String(raw.finalUrl || '').trim(),
    finalTitle: String(raw.finalTitle || '').trim(),
    startedAt: Number(raw.startedAt || 0) || 0,
    completedAt: Number(raw.completedAt || 0) || 0,
  };
}

function sanitizeBrowserTeachSession(raw: any): BrowserTeachSessionSnapshot {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    active: source.active === true,
    phase: normalizeBrowserTeachPhase(source.phase),
    startedAt: Number(source.startedAt || 0) || 0,
    completedAt: Number(source.completedAt || 0) || 0,
    approvalRequestedAt: Number(source.approvalRequestedAt || 0) || 0,
    reviewRequestedAt: Number(source.reviewRequestedAt || 0) || 0,
    startUrl: String(source.startUrl || '').trim(),
    startTitle: String(source.startTitle || '').trim(),
    executingStepId: String(source.executingStepId || '').trim(),
    steps: Array.isArray(source.steps)
      ? source.steps.map((step: any) => sanitizeBrowserTeachStep(step)).filter(Boolean) as BrowserTeachStepSnapshot[]
      : [],
    pendingStep: sanitizeBrowserTeachStep(source.pendingStep),
    verification: sanitizeBrowserTeachVerification(source.verification),
  };
}

export function saveBrowserTeachSessionSnapshot(sessionId: string, payload: any): BrowserTeachSessionSnapshot {
  const resolved = resolveSessionId(sessionId);
  const sanitized = sanitizeBrowserTeachSession(payload);
  browserTeachSessions.set(resolved, sanitized);
  return sanitized;
}

export function clearBrowserTeachSessionSnapshot(sessionId: string): void {
  browserTeachSessions.delete(resolveSessionId(sessionId));
}

export function getBrowserTeachSessionSnapshot(sessionId: string): BrowserTeachSessionSnapshot | null {
  return browserTeachSessions.get(resolveSessionId(sessionId)) || null;
}

function resolveBrowserInteractionStateId(sessionId: string): string {
  const resolved = resolveSessionId(sessionId);
  if (String(sessionId || '').startsWith('task_')) {
    try {
      const taskId = String(sessionId || '').slice('task_'.length);
      const { loadTask } = require('./tasks/task-store') as typeof import('./tasks/task-store');
      const task = loadTask(taskId);
      const parentId = String(task?.sessionId || '').trim();
      if (parentId && (browserInteractionStates.has(parentId) || sessions.has(parentId))) {
        return parentId;
      }
    } catch {
      // Fall back to the resolved session id below.
    }
  }
  return resolved;
}

function getOrCreateBrowserInteractionState(sessionId: string): BrowserInteractionState {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  const existing = browserInteractionStates.get(resolved);
  if (existing) return existing;
  const created: BrowserInteractionState = {
    mode: 'agent',
    captured: false,
    controlOwner: 'agent',
    lastInputAt: 0,
    recentUserActions: [],
    lastActor: 'system',
    lastActorSummary: 'Browser session ready.',
    updatedAt: Date.now(),
  };
  browserInteractionStates.set(resolved, created);
  return created;
}

function recordBrowserUserAction(sessionId: string, action: BrowserUserAction): BrowserInteractionState {
  const state = getOrCreateBrowserInteractionState(sessionId);
  state.captured = true;
  state.controlOwner = 'user';
  state.lastInputAt = Number(action.timestamp || Date.now()) || Date.now();
  state.lastActor = 'user';
  state.lastActorSummary = action.summary;
  state.updatedAt = Number(action.timestamp || Date.now()) || Date.now();
  state.recentUserActions = [action, ...state.recentUserActions]
    .slice(0, 6)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  return state;
}

function clearBrowserInteractionState(sessionId: string): void {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  browserInteractionStates.delete(resolved);
  browserControlWaiters.delete(resolved);
  if (resolved !== sessionId) browserInteractionStates.delete(sessionId);
}

function releaseBrowserControlWaiters(sessionId: string): void {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  const waiters = browserControlWaiters.get(resolved) || [];
  browserControlWaiters.delete(resolved);
  for (const resolve of waiters) {
    try { resolve(); } catch {}
  }
}

export function setBrowserInteractionModeState(sessionId: string, mode: unknown): BrowserInteractionState {
  const state = getOrCreateBrowserInteractionState(sessionId);
  state.mode = normalizeBrowserInteractionMode(mode);
  if (state.mode === 'agent') {
    state.captured = false;
    state.controlOwner = 'agent';
    releaseBrowserControlWaiters(sessionId);
  }
  state.lastActor = 'system';
  state.lastActorSummary = `Browser interaction mode is now ${state.mode}.`;
  state.updatedAt = Date.now();
  return state;
}

export function setBrowserControlCaptureState(
  sessionId: string,
  options: { captured: boolean; owner?: 'agent' | 'user'; reason?: string },
): BrowserInteractionState {
  const state = getOrCreateBrowserInteractionState(sessionId);
  state.captured = options.captured === true;
  state.controlOwner = state.captured ? (options.owner === 'agent' ? 'agent' : 'user') : 'agent';
  state.updatedAt = Date.now();
  if (!state.captured) {
    state.lastActor = 'system';
    state.lastActorSummary = String(options.reason || 'Browser control returned to Prometheus.').trim();
    releaseBrowserControlWaiters(sessionId);
  } else {
    state.lastActor = 'user';
    state.lastActorSummary = String(options.reason || 'User is controlling the browser in Co-pilot mode.').trim();
    state.lastInputAt = state.updatedAt;
  }
  return state;
}

export async function waitForBrowserControlRelease(
  sessionId: string,
  toolName: string,
  timeoutMs = 120_000,
): Promise<void> {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  const state = browserInteractionStates.get(resolved);
  if (!state || !state.captured || state.controlOwner !== 'user') return;
  if (state.mode !== 'copilot' && state.mode !== 'teach') return;
  try {
    broadcastWS({
      type: 'browser:control',
      sessionId: resolveSessionId(sessionId),
      mode: state.mode,
      captured: true,
      controlOwner: 'user',
      statusLabel: `Waiting for you to release browser control before ${toolName}.`,
      waitingTool: toolName,
      timestamp: Date.now(),
    });
  } catch {
    // Best effort UI cue only.
  }
  await new Promise<void>((resolve, reject) => {
    const waiters = browserControlWaiters.get(resolved) || [];
    const onRelease = () => {
      clearTimeout(timeoutHandle);
      resolve();
    };
    const timeoutHandle = setTimeout(() => {
      const current = browserControlWaiters.get(resolved) || [];
      browserControlWaiters.set(resolved, current.filter((entry) => entry !== onRelease));
      reject(new Error(`Browser tool "${toolName}" paused for user Co-pilot control and timed out waiting for release.`));
    }, Math.max(5_000, Math.min(timeoutMs, 300_000)));
    waiters.push(onRelease);
    browserControlWaiters.set(resolved, waiters);
  });
}

export function formatBrowserInteractionContextBlock(sessionId: string): string {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  const state = browserInteractionStates.get(resolved);
  if (!state) return '';
  const mode = normalizeBrowserInteractionMode(state.mode);
  const actions = Array.isArray(state.recentUserActions) ? state.recentUserActions.slice(0, 3) : [];
  if (mode === 'agent' && !actions.length && state.lastActor !== 'user') return '';
  const lines: string[] = [
    '[BROWSER CONTROL]',
    `mode=${mode}`,
    `captured=${state.captured ? 'yes' : 'no'}`,
    `control_owner=${state.controlOwner}`,
  ];
  if (state.lastActorSummary) {
    lines.push(`last_event=${state.lastActorSummary}`);
  }
  if (actions.length) {
    lines.push('recent_user_actions:');
    for (const action of actions) {
      const timeLabel = new Date(Number(action.timestamp || Date.now())).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
      lines.push(`- ${timeLabel}: ${action.summary}`);
    }
  }
  if (state.captured && state.controlOwner === 'user') {
    lines.push('The user currently has the browser captured. Agent browser actions should wait until release.');
  }
  if (mode === 'copilot' || mode === 'teach' || actions.length) {
    lines.push('If the page changed without a browser tool call, assume the user changed it in Co-pilot/Teach mode and continue from the current page state.');
  }
  return lines.join('\n');
}

function normalizeBrowserLiveStreamFocus(focus: unknown): BrowserLiveStreamFocus {
  return String(focus || '').trim().toLowerCase() === 'interactive' ? 'interactive' : 'passive';
}

function getBrowserViewportSize(session: BrowserSession): { width: number; height: number } {
  const viewport = session.page.viewportSize?.() || null;
  return {
    width: Number(viewport?.width || 1280),
    height: Number(viewport?.height || 720),
  };
}

function clearBrowserLiveStreamLease(stream: BrowserLiveStreamState | null | undefined): void {
  if (!stream?.leaseTimer) return;
  try { clearTimeout(stream.leaseTimer); } catch {}
  stream.leaseTimer = null;
}

async function broadcastBrowserLiveStreamStatus(
  sessionId: string,
  stream: BrowserLiveStreamState | null,
  overrides?: Partial<{
    active: boolean;
    transport: BrowserLiveStreamTransport | '';
    focus: BrowserLiveStreamFocus;
    status: string;
  }>,
): Promise<void> {
  try {
    const resolved = resolveSessionId(sessionId);
    const session = sessions.get(resolved);
    const interactionState = getOrCreateBrowserInteractionState(resolved);
    broadcastWS({
      type: 'browser:stream_status',
      sessionId: resolved,
      active: overrides?.active ?? (stream?.active === true),
      transport: overrides?.transport ?? (stream?.transport || ''),
      focus: overrides?.focus ?? (stream?.focus || 'passive'),
      status: String(overrides?.status || stream?.status || '').trim(),
      url: String(session?.lastPageUrl || session?.page?.url?.() || ''),
      title: String(session?.lastPageTitle || ''),
      mode: interactionState.mode,
      captured: interactionState.captured,
      controlOwner: interactionState.controlOwner,
      timestamp: Date.now(),
      ...buildBrowserSessionMetadataPayload(resolved),
    });
  } catch {
    // Best-effort UI status only.
  }
}

function refreshBrowserLiveStreamLease(sessionId: string): void {
  const resolved = resolveSessionId(sessionId);
  const stream = browserLiveStreams.get(resolved);
  if (!stream) return;
  clearBrowserLiveStreamLease(stream);
  stream.leaseTimer = setTimeout(() => {
    stopBrowserLiveStream(resolved, 'Live browser stream stopped after inactivity.').catch(() => {});
  }, BROWSER_LIVE_STREAM_LEASE_MS);
}

async function emitBrowserLiveFrame(
  sessionId: string,
  transport: BrowserLiveStreamTransport,
  frameBase64: string,
  width: number,
  height: number,
  frameFormat: 'jpeg' | 'png',
): Promise<void> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session || !frameBase64) return;
  const stream = browserLiveStreams.get(resolved);
  if (stream) stream.lastFrameAt = Date.now();
  const interactionState = getOrCreateBrowserInteractionState(resolved);
  broadcastWS({
    type: 'browser:frame',
    sessionId: resolved,
    active: true,
    transport,
    focus: stream?.focus || 'passive',
    mode: interactionState.mode,
    captured: interactionState.captured,
    controlOwner: interactionState.controlOwner,
    url: String(session.lastPageUrl || session.page.url?.() || ''),
    title: String(session.lastPageTitle || ''),
    frameBase64,
    frameWidth: width,
    frameHeight: height,
    frameFormat,
    timestamp: Date.now(),
    ...buildBrowserSessionMetadataPayload(resolved),
  });
}

async function emitBrowserAgentCursor(
  sessionId: string,
  payload: {
    x?: number;
    y?: number;
    kind?: 'move' | 'click' | 'fill' | 'type' | 'key' | 'scroll' | 'navigate' | 'wait';
    phase?: 'start' | 'active' | 'end';
    label?: string;
  } = {},
): Promise<void> {
  try {
    const resolved = resolveSessionId(sessionId);
    const session = sessions.get(resolved);
    if (!session) return;
    const viewport = getBrowserViewportSize(session);
    const rawX = Number(payload.x);
    const rawY = Number(payload.y);
    const hasPoint = Number.isFinite(rawX) && Number.isFinite(rawY);
    broadcastWS({
      type: 'browser:agent_cursor',
      sessionId: resolved,
      x: hasPoint ? Math.round(rawX) : Math.round(viewport.width / 2),
      y: hasPoint ? Math.round(rawY) : Math.round(viewport.height / 2),
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      kind: payload.kind || 'move',
      phase: payload.phase || 'active',
      label: String(payload.label || '').trim(),
      url: String(session.lastPageUrl || session.page.url?.() || ''),
      title: String(session.lastPageTitle || ''),
      timestamp: Date.now(),
    });
  } catch {
    // Cursor telemetry is visual-only.
  }
}

async function resolveSelectorViewportCenter(
  page: PwPage,
  selector: string,
  labelPrefix: string,
): Promise<null | { x: number; y: number; label: string }> {
  const value = String(selector || '').trim();
  if (!value) return null;
  try {
    const locator = page.locator(value).first();
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const meta = await describeLocator(locator);
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return {
      x: Math.round(box.x + (box.width / 2)),
      y: Math.round(box.y + (box.height / 2)),
      label: `${labelPrefix} (${meta.role}: "${meta.name}")`,
    };
  } catch {
    return null;
  }
}

async function resolveActiveElementViewportCenter(
  page: PwPage,
): Promise<null | { x: number; y: number; label: string }> {
  try {
    return await page.evaluate(() => {
      const doc = (globalThis as any).document as any;
      const active = doc?.activeElement as any;
      const rect = active && typeof active.getBoundingClientRect === 'function'
        ? active.getBoundingClientRect()
        : null;
      const viewportWidth = Math.round((globalThis as any).innerWidth || 0);
      const viewportHeight = Math.round((globalThis as any).innerHeight || 0);
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { x: Math.round(viewportWidth / 2), y: Math.round(viewportHeight / 2), label: 'focused page' };
      }
      const label = String(
        active?.getAttribute?.('aria-label')
        || active?.getAttribute?.('placeholder')
        || active?.innerText
        || active?.tagName
        || 'focused element',
      ).replace(/\s+/g, ' ').trim().slice(0, 80);
      return {
        x: Math.round(rect.left + (rect.width / 2)),
        y: Math.round(rect.top + (rect.height / 2)),
        label: label || 'focused element',
      };
    });
  } catch {
    return null;
  }
}

async function browserHasEditableFocus(page: PwPage): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const active = doc?.activeElement as any;
      if (!active || active === doc?.body) return false;
      const tag = String(active.tagName || '').toLowerCase();
      const role = String(active.getAttribute?.('role') || '').toLowerCase();
      const type = String(active.getAttribute?.('type') || '').toLowerCase();
      if (active.isContentEditable || active.getAttribute?.('contenteditable') === 'true') return true;
      if (tag === 'textarea') return true;
      if (tag === 'input') {
        return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(type);
      }
      return role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton';
    });
  } catch {
    return false;
  }
}

async function startBrowserSnapshotStreamLoop(
  sessionId: string,
  stream: BrowserLiveStreamState,
): Promise<void> {
  const resolved = resolveSessionId(sessionId);
  const token = (stream.loopToken += 1);
  stream.transport = 'snapshot';
  stream.status = 'Live screenshot stream active.';
  browserLiveStreams.set(resolved, stream);
  await broadcastBrowserLiveStreamStatus(resolved, stream, { active: true });
  void (async () => {
    while (true) {
      const current = browserLiveStreams.get(resolved);
      if (!current || !current.active || current.loopToken !== token || current.transport !== 'snapshot') break;
      const session = sessions.get(resolved);
      if (!session) break;
      const viewport = getBrowserViewportSize(session);
      try {
        const buf: Buffer = await session.page.screenshot({
          type: 'jpeg',
          quality: current.focus === 'interactive' ? 54 : 66,
          fullPage: false,
        });
        await emitBrowserLiveFrame(resolved, 'snapshot', buf.toString('base64'), viewport.width, viewport.height, 'jpeg');
      } catch (err: any) {
        const message = String(err?.message || err || '').toLowerCase();
        if (message.includes('closed') || message.includes('target page') || message.includes('context')) {
          await stopBrowserLiveStream(resolved, 'Live browser stream ended because the page closed.');
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, current.focus === 'interactive' ? 90 : 220));
    }
  })().catch(() => {});
}

async function tryStartBrowserCDPStream(
  sessionId: string,
  stream: BrowserLiveStreamState,
): Promise<boolean> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session?.context?.newCDPSession || !session?.page) return false;
  const viewport = getBrowserViewportSize(session);
  const token = (stream.loopToken += 1);
  try {
    const cdp = await session.context.newCDPSession(session.page);
    const onFrame = (payload: any) => {
      const current = browserLiveStreams.get(resolved);
      const shotData = String(payload?.data || '');
      if (!shotData) {
        void cdp.send('Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
        return;
      }
      if (!current || !current.active || current.loopToken !== token || current.transport !== 'cdp') {
        void cdp.send('Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
        return;
      }
      const minIntervalMs = current.focus === 'interactive' ? 60 : 140;
      if (current.lastFrameAt > 0 && (Date.now() - current.lastFrameAt) < minIntervalMs) {
        void cdp.send('Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
        return;
      }
      void cdp.send('Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
      void emitBrowserLiveFrame(
        resolved,
        'cdp',
        shotData,
        viewport.width,
        viewport.height,
        'jpeg',
      );
    };
    stream.transport = 'cdp';
    stream.status = 'Live CDP stream active.';
    stream.cdpSession = cdp;
    stream.cdpFrameHandler = onFrame;
    browserLiveStreams.set(resolved, stream);
    cdp.on?.('Page.screencastFrame', onFrame);
    await cdp.send('Page.enable');
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: stream.focus === 'interactive' ? 56 : 68,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      everyNthFrame: stream.focus === 'interactive' ? 1 : 2,
    });
    await broadcastBrowserLiveStreamStatus(resolved, stream, { active: true });
    setTimeout(() => {
      const current = browserLiveStreams.get(resolved);
      if (!current || !current.active || current.loopToken !== token || current.transport !== 'cdp' || current.lastFrameAt > 0) return;
      void (async () => {
        try {
          const currentCdp = current.cdpSession;
          const currentHandler = current.cdpFrameHandler;
          if (currentCdp && currentHandler) {
            if (typeof currentCdp.off === 'function') currentCdp.off('Page.screencastFrame', currentHandler);
            else if (typeof currentCdp.removeListener === 'function') currentCdp.removeListener('Page.screencastFrame', currentHandler);
          }
          await currentCdp?.send?.('Page.stopScreencast').catch(() => {});
          await currentCdp?.detach?.().catch(() => {});
        } catch {}
        current.cdpSession = null;
        current.cdpFrameHandler = null;
        current.transport = null;
        current.status = 'CDP stream stalled. Falling back to screenshot stream.';
        browserLiveStreams.set(resolved, current);
        await broadcastBrowserLiveStreamStatus(resolved, current, {
          active: true,
          transport: '',
          status: current.status,
        });
        await startBrowserSnapshotStreamLoop(resolved, current);
      })().catch(() => {});
    }, 1500);
    return true;
  } catch (err: any) {
    try {
      const cdp = stream.cdpSession;
      const handler = stream.cdpFrameHandler;
      if (cdp && handler) {
        if (typeof cdp.off === 'function') cdp.off('Page.screencastFrame', handler);
        else if (typeof cdp.removeListener === 'function') cdp.removeListener('Page.screencastFrame', handler);
      }
      await cdp?.send?.('Page.stopScreencast').catch(() => {});
      await cdp?.detach?.().catch(() => {});
    } catch {}
    stream.cdpSession = null;
    stream.cdpFrameHandler = null;
    stream.transport = null;
    stream.status = `CDP live stream unavailable: ${String(err?.message || err || 'unknown error')}`;
    browserLiveStreams.set(resolved, stream);
    await broadcastBrowserLiveStreamStatus(resolved, stream, {
      active: true,
      transport: '',
      status: 'CDP live stream unavailable. Falling back to screenshot stream.',
    });
    return false;
  }
}

export async function startBrowserLiveStream(
  sessionId: string,
  options?: { focus?: unknown; preferCdp?: boolean; restoreUrl?: string; restoreTitle?: string },
): Promise<{
  sessionId: string;
  active: boolean;
  transport: BrowserLiveStreamTransport;
  focus: BrowserLiveStreamFocus;
  status: string;
}> {
  const resolved = resolveSessionId(sessionId);
  const session = await getOrCreateSession(resolved, {
    url: String(options?.restoreUrl || '').trim(),
    title: String(options?.restoreTitle || '').trim(),
  });
  await syncPageMetadata(session).catch(() => {});
  const focus = normalizeBrowserLiveStreamFocus(options?.focus);
  const existing = browserLiveStreams.get(resolved);
  if (existing?.active && existing.focus === focus && existing.transport) {
    refreshBrowserLiveStreamLease(resolved);
    await broadcastBrowserLiveStreamStatus(resolved, existing, {
      active: true,
      transport: existing.transport,
      focus,
      status: existing.status || BROWSER_STREAM_HEARTBEAT_STATUS,
    });
    return {
      sessionId: resolved,
      active: true,
      transport: existing.transport,
      focus,
      status: existing.status || BROWSER_STREAM_HEARTBEAT_STATUS,
    };
  }
  if (existing) {
    await stopBrowserLiveStream(resolved, 'Reconfiguring live browser stream.');
  }
  const stream: BrowserLiveStreamState = {
    sessionId: resolved,
    active: true,
    focus,
    transport: null,
    status: 'Starting live browser stream...',
    startedAt: Date.now(),
    lastFrameAt: 0,
    loopToken: 0,
    leaseTimer: null,
    cdpSession: null,
    cdpFrameHandler: null,
  };
  browserLiveStreams.set(resolved, stream);
  refreshBrowserLiveStreamLease(resolved);
  const startedCDP = options?.preferCdp === false ? false : await tryStartBrowserCDPStream(resolved, stream);
  if (!startedCDP) {
    await startBrowserSnapshotStreamLoop(resolved, stream);
  }
  const current = browserLiveStreams.get(resolved) || stream;
  return {
    sessionId: resolved,
    active: true,
    transport: current.transport || 'snapshot',
    focus,
    status: current.status || BROWSER_STREAM_HEARTBEAT_STATUS,
  };
}

export async function browserReopenSession(
  sessionId: string,
  restoreHint?: BrowserSessionRestoreHint,
): Promise<null | {
  sessionId: string;
  url: string;
  site: string;
  title: string;
  active: boolean;
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  streamActive: boolean;
  streamTransport: 'cdp' | 'snapshot' | '';
  streamFocus: BrowserLiveStreamFocus;
  frameBase64: string;
  frameWidth: number;
  frameHeight: number;
  elements: BrowserKnowledgeElement[];
  itemRoots: BrowserKnowledgeItemRoot[];
  extractionSchemas: BrowserKnowledgeExtractionSchema[];
}> {
  const resolved = resolveSessionId(sessionId);
  const session = await getOrCreateSession(resolved, restoreHint).catch(() => null);
  if (!session) return null;
  const hintedUrl = String(restoreHint?.url || '').trim();
  const persisted = buildBrowserSessionRestoreRecord(resolved, restoreHint);
  const targetUrl = isRestorableBrowserUrl(hintedUrl) ? hintedUrl : String(persisted?.url || '').trim();
  if (isRestorableBrowserUrl(targetUrl)) {
    const currentUrl = String(session.page.url?.() || '').trim();
    if (normalizeBrowserRestoreUrl(currentUrl) !== normalizeBrowserRestoreUrl(targetUrl)) {
      await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await session.page.waitForTimeout(350).catch(() => {});
    }
    rememberPageMetadata(session, {
      url: targetUrl,
      title: String(await session.page.title().catch(() => restoreHint?.title || '') || restoreHint?.title || '').trim(),
    });
  }
  return getBrowserNamedElementsForSession(resolved, restoreHint);
}

export async function stopBrowserLiveStream(
  sessionId: string,
  reason: string = 'Live browser stream stopped.',
): Promise<void> {
  const resolved = resolveSessionId(sessionId);
  const stream = browserLiveStreams.get(resolved);
  if (!stream) return;
  browserLiveStreams.delete(resolved);
  clearBrowserLiveStreamLease(stream);
  stream.active = false;
  stream.status = String(reason || 'Live browser stream stopped.').trim();
  stream.loopToken += 1;
  try {
    const cdp = stream.cdpSession;
    const handler = stream.cdpFrameHandler;
    if (cdp && handler) {
      if (typeof cdp.off === 'function') cdp.off('Page.screencastFrame', handler);
      else if (typeof cdp.removeListener === 'function') cdp.removeListener('Page.screencastFrame', handler);
    }
    await cdp?.send?.('Page.stopScreencast').catch(() => {});
    await cdp?.detach?.().catch(() => {});
  } catch {}
  stream.cdpSession = null;
  stream.cdpFrameHandler = null;
  await broadcastBrowserLiveStreamStatus(resolved, stream, {
    active: false,
    transport: stream.transport || '',
    focus: stream.focus,
    status: stream.status,
  });
}

// ─── Browser Vision Screenshot Cache ─────────────────────────────────────────
// Stores the last browser_vision_screenshot result per session so chat.router.ts
// can inject it as a role:'user' vision message (OpenAI doesn't support images in tool messages).
const _lastBrowserScreenshot: Map<string, { base64: string; width: number; height: number; ts: number }> = new Map();

export function setLastBrowserScreenshot(sessionId: string, data: { base64: string; width: number; height: number }): void {
  _lastBrowserScreenshot.set(sessionId, { ...data, ts: Date.now() });
}

export function getLastBrowserScreenshot(sessionId: string): { base64: string; width: number; height: number } | null {
  const entry = _lastBrowserScreenshot.get(sessionId);
  if (!entry) return null;
  // Expire after 60 seconds — stale screenshots are useless
  if (Date.now() - entry.ts > 60_000) {
    _lastBrowserScreenshot.delete(sessionId);
    return null;
  }
  return { base64: entry.base64, width: entry.width, height: entry.height };
}

export function clearLastBrowserScreenshot(sessionId: string): void {
  _lastBrowserScreenshot.delete(sessionId);
}

interface BrowserDownloadRecord {
  savedPath: string;
  relPath: string;
  suggestedFilename: string;
  url: string;
  sizeBytes: number;
  ts: number;
}

const _lastBrowserDownload: Map<string, BrowserDownloadRecord> = new Map();

export function getLastBrowserDownload(sessionId: string): BrowserDownloadRecord | null {
  const entry = _lastBrowserDownload.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.ts > 10 * 60_000) {
    _lastBrowserDownload.delete(sessionId);
    return null;
  }
  return entry;
}

// ─── Network Intercept Store ───────────────────────────────────────────────────
interface NetworkLogEntry {
  url: string;
  method: string;
  status: number;
  contentType: string;
  body?: string;
  ts: number;
}
const _networkInterceptLog: Map<string, NetworkLogEntry[]> = new Map();
const _networkInterceptHandlers: Map<string, (response: any) => void> = new Map();

// ─── Macro Recording Store (browser-side: element watch state) ────────────────
// Per-session snapshot hash stored for delta computation
const _snapshotHashCache: Map<string, string> = new Map();

let playwrightModule: any = null;
let playwrightChecked = false;

function ensurePlaywrightBrowsersPath(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  try {
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.homedir(), '.playwright-browsers');
  } catch {
    // Best-effort only; Playwright has its own defaults.
  }
}

async function findBundledChromiumExecutable(): Promise<string | null> {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const home = os.homedir();
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, '.playwright-browsers'),
    path.join(home, '.playwright-browsers'),
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? path.join(home, 'AppData', 'Local', 'ms-playwright')
        : path.join(home, '.cache', 'ms-playwright'),
  ];

  const exeCandidates = process.platform === 'darwin'
    ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? ['chrome-win/chrome.exe']
      : ['chrome-linux/chrome'];

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const dirs = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith('chromium-'))
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a));
      for (const dir of dirs) {
        for (const rel of exeCandidates) {
          const candidate = path.join(root, dir, rel);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // Continue scanning other roots.
    }
  }
  return null;
}

async function findBrowserExecutableForPlaywright(): Promise<string | null> {
  const fs = await import('fs');
  const chromePaths = [
    process.env.CHROME_PATH,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : '',
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : '',
    process.platform === 'linux' ? '/usr/bin/chromium' : '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    await findBundledChromiumExecutable(),
  ].filter(Boolean) as string[];
  return chromePaths.find((candidate) => fs.existsSync(candidate)) || null;
}

async function getPW(): Promise<any | null> {
  if (playwrightChecked) return playwrightModule;
  playwrightChecked = true;
  ensurePlaywrightBrowsersPath();
  try {
    playwrightModule = await (Function('return import("playwright")')() as Promise<any>);
    return playwrightModule;
  } catch {
    console.warn('[Browser] Playwright not installed. Run: npm install playwright && npx playwright install chromium');
    return null;
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/json/version`);
    return resp.ok;
  } catch { return false; }
}

function getMainChromeDebugPort(): number {
  return Number(process.env.CHROME_DEBUG_PORT || '9222');
}

function stableBrowserHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash * 31) + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function sanitizeBrowserProfileSegment(value: string, fallback: string): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function getStableBrowserIdentity(sessionId: string, metadata: BrowserSessionMetadata): string {
  const ownerId = String(metadata.ownerId || '').trim();
  const teamId = String(metadata.spawnerSessionId || '').trim();
  const sid = String(sessionId || '').trim();
  if (metadata.ownerType === 'team-agent') {
    if (teamId && ownerId) return `team-${teamId}-${ownerId}`;
    if (ownerId) return `team-${ownerId}`;
    const roomMatch = sid.match(/^team_room_member_(.+)___AGENT___(.+)$/);
    if (roomMatch?.[1] && roomMatch?.[2]) return `team-${roomMatch[1]}-${roomMatch[2]}`;
    const dispatchMatch = sid.match(/^team_dispatch_(.+)_\d+$/);
    if (dispatchMatch?.[1]) return `team-${dispatchMatch[1]}`;
  }
  if (metadata.ownerType === 'background' && ownerId) return `background-${ownerId}`;
  if (metadata.ownerType === 'task' && ownerId) {
    const task = lookupTaskSummary(ownerId || sid.replace(/^task_/, ''));
    if (task.teamId && task.teamAgentId) return `team-${task.teamId}-${task.teamAgentId}`;
    if (task.teamAgentId) return `team-${task.teamAgentId}`;
    return `task-${ownerId}`;
  }
  if (ownerId && ownerId !== sid) return `${metadata.ownerType}-${ownerId}`;
  return `${metadata.ownerType}-${sid || 'default'}`;
}

function getPersistentBrowserProfileRoot(): string {
  return process.env.CHROME_PROFILES_DIR
    || path.join(os.homedir(), '.prometheus', 'chrome-profiles');
}

function getPersistentBrowserProfileDir(identity: string): string {
  return path.join(getPersistentBrowserProfileRoot(), sanitizeBrowserProfileSegment(identity, 'default'));
}

function getLegacyBrowserIdentities(sessionId: string, metadata: BrowserSessionMetadata): string[] {
  const ownerId = String(metadata.ownerId || '').trim();
  const sid = String(sessionId || '').trim();
  const identities: string[] = [];
  if (metadata.ownerType === 'team-agent') {
    if (ownerId) identities.push(`team-${ownerId}`, `team-agent-${ownerId}`);
    const teamId = String(metadata.spawnerSessionId || '').trim();
    if (teamId && ownerId) identities.push(`team-${teamId}-${ownerId}`);
    const dispatchMatch = sid.match(/^team_dispatch_(.+)_\d+$/);
    if (dispatchMatch?.[1]) identities.push(`team-${dispatchMatch[1]}`);
  }
  if (metadata.ownerType === 'task') {
    const task = lookupTaskSummary(ownerId || sid.replace(/^task_/, ''));
    if (task.teamAgentId) identities.push(`team-${task.teamAgentId}`, `team-agent-${task.teamAgentId}`);
    if (task.teamId && task.teamAgentId) identities.push(`team-${task.teamId}-${task.teamAgentId}`);
  }
  return Array.from(new Set(identities.filter(Boolean)));
}

function resolvePersistentBrowserProfileDir(identity: string, sessionId: string, metadata: BrowserSessionMetadata): string {
  const root = process.env.CHROME_PROFILES_DIR
    || path.join(os.homedir(), '.prometheus', 'chrome-profiles');
  const primary = path.join(root, sanitizeBrowserProfileSegment(identity, 'default'));
  if (fs.existsSync(primary)) return primary;
  for (const legacyIdentity of getLegacyBrowserIdentities(sessionId, metadata)) {
    const legacy = path.join(root, sanitizeBrowserProfileSegment(legacyIdentity, 'default'));
    if (legacy !== primary && fs.existsSync(legacy)) {
      console.log(`[Browser] Reusing legacy persistent profile ${legacy} for stable identity ${identity}`);
      return legacy;
    }
  }
  return primary;
}

function getPersistentBrowserPort(identity: string): number {
  const mainPort = getMainChromeDebugPort();
  const base = Number(process.env.CHROME_BACKGROUND_DEBUG_PORT_BASE || String(mainPort + 100));
  const span = Math.max(1, Number(process.env.CHROME_BACKGROUND_DEBUG_PORT_SPAN || '1000'));
  return base + (stableBrowserHash(identity) % span);
}

async function connectOrLaunchPersistentChrome(
  pw: any,
  sessionId: string,
  metadata: BrowserSessionMetadata,
): Promise<{ browser: any; debugPort: number; profileDir: string; ownsBrowser: boolean }> {
  const identity = getStableBrowserIdentity(sessionId, metadata);
  const debugPort = metadata.ownerType === 'main'
    ? getMainChromeDebugPort()
    : getPersistentBrowserPort(identity);
  const profileDir = metadata.ownerType === 'main'
    ? (process.env.CHROME_PROFILE || path.join(os.homedir(), '.prometheus', 'chrome-debug-profile'))
    : resolvePersistentBrowserProfileDir(identity, sessionId, metadata);

  if (await isPortOpen(debugPort)) {
    try {
      const browser = await pw.chromium.connectOverCDP(`http://localhost:${debugPort}`);
      console.log(`[Browser] Connected to Chrome on port ${debugPort} (${metadata.ownerType}, profile: ${profileDir})`);
      return { browser, debugPort, profileDir, ownsBrowser: false };
    } catch (e: any) {
      console.warn(`[Browser] Port ${debugPort} responded but CDP connect failed: ${e.message}`);
    }
  }

  const chromePath = await findBrowserExecutableForPlaywright();
  if (!chromePath) {
    throw new Error('No Chrome/Chromium executable found. Configure CHROME_PATH or install Chrome at the app/runtime level.');
  }

  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
  const { spawn } = await import('child_process');
  console.log(`[Browser] Launching Chrome with --remote-debugging-port=${debugPort} and profile ${profileDir}...`);
  spawn(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
  ], { detached: true, stdio: 'ignore' }).unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (!await isPortOpen(debugPort)) continue;
    try {
      const browser = await pw.chromium.connectOverCDP(`http://localhost:${debugPort}`);
      console.log(`[Browser] Launched and connected to Chrome on port ${debugPort} (${metadata.ownerType})`);
      return { browser, debugPort, profileDir, ownsBrowser: true };
    } catch {
      // Chrome may expose /json/version a moment before CDP is ready.
    }
  }

  throw new Error(`Chrome launched but did not respond on port ${debugPort} after 15s. Close the Chrome window using profile ${profileDir} and try again.`);
}

async function isSessionAlive(session: BrowserSession): Promise<boolean> {
  try {
    // A closed page will throw on .url() or return 'about:blank' after CDP disconnect
    const url = session.page.url();
    if (!url && url !== 'about:blank') return false;
    if (session.ownsBrowser && !session.debugPort) return true;
    // Also ping the debug port to confirm the underlying Chrome process is still up.
    const debugPort = session.debugPort || getMainChromeDebugPort();
    const alive = await isPortOpen(debugPort);
    return alive;
  } catch {
    return false;
  }
}

/**
 * Returns the path to the user's real Chrome profile directory.
 * Used when CHROME_USE_REAL_PROFILE=true — allows Prometheus to reuse
 * existing login sessions instead of starting fresh with an isolated profile.
 * WARNING: Chrome must be fully closed before connecting, or CDP will reject it.
 */
function getRealChromeProfileDir(): string {
  const os = require('os') as typeof import('os');
  const home = os.homedir();
  if (process.platform === 'win32') {
    return `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\User Data`;
  } else if (process.platform === 'darwin') {
    return `${home}/Library/Application Support/Google/Chrome`;
  }
  return `${home}/.config/google-chrome`;
}

async function getOrCreateSession(sessionId: string, restoreHint?: BrowserSessionRestoreHint): Promise<BrowserSession> {
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId)!;
    // Verify the session is still usable — if Chrome was closed externally the
    // page/browser objects are dead and every tool call will fail with
    // "Target page, context or browser has been closed". Evict and recreate.
    const alive = await isSessionAlive(existing);
    if (alive) return existing;
    console.log(`[Browser] Session "${sessionId}" is dead (Chrome was closed). Evicting and relaunching...`);
    await stopBrowserLiveStream(sessionId, 'Live browser stream stopped because the Chrome session ended.').catch(() => {});
    sessions.delete(sessionId);
    try { await existing.page.close(); } catch {}
    try { await existing.browser.close(); } catch {}
  }

  const pw = await getPW();
  if (!pw) throw new Error('Playwright not installed. Run: npm install playwright && npx playwright install chromium');

  const metadata = registerBrowserSessionMetadata(sessionId);
  const browserConnection = await connectOrLaunchPersistentChrome(pw, sessionId, metadata);
  const browser = browserConnection.browser;

  // Get or create a context, then a page
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pages = context.pages();
  const persistedRecord = buildBrowserSessionRestoreRecord(sessionId, restoreHint);
  const restoredPage = await findRestorableBrowserPage(pages, persistedRecord);
  const page =
    restoredPage
    || pages.find((p: any) => p.url() === 'about:blank')
    || await context.newPage();

  const session: BrowserSession = {
    sessionId,
    browser,
    context,
    page,
    ownsBrowser: browserConnection.ownsBrowser,
    isolated: metadata.ownerType !== 'main',
    debugPort: browserConnection.debugPort,
    profileDir: browserConnection.profileDir,
    lastSnapshot: '',
    lastSnapshotAt: 0,
    lastPageUrl: '',
    lastPageTitle: '',
    injectedStaticContext: {},
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);
  console.log(`[Browser] Session created for ${sessionId}`);
  if (!restoredPage && persistedRecord && isRestorableBrowserUrl(persistedRecord.url)) {
    try {
      await page.goto(persistedRecord.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(350).catch(() => {});
      rememberPageMetadata(session, {
        url: persistedRecord.url,
        title: String(await page.title().catch(() => persistedRecord.title) || persistedRecord.title || '').trim(),
      });
      console.log(`[Browser] Restored session "${sessionId}" to ${persistedRecord.url}`);
    } catch (err: any) {
      console.warn(`[Browser] Could not restore session "${sessionId}" to ${persistedRecord.url}: ${String(err?.message || err)}`);
    }
  }
  await syncPageMetadata(session).catch(() => {});
  persistBrowserSessionRecord(session);

  // Auto-handle OAuth popups (e.g. "Continue as Raul" Google sign-in dialog).
  // These appear as new pages in the context and are invisible to the DOM snapshot.
  // We click the primary confirm button automatically so the agent doesn't get stuck.
  context.on('page', async (popup: any) => {
    try {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const popupUrl = popup.url();
      console.log(`[Browser] Popup opened: ${popupUrl}`);
      // Google OAuth confirm page: click the blue continue/confirm button
      const confirmSelectors = [
        'button[id="submit_approve_access"]',  // Google OAuth approve
        'button:has-text("Continue")',
        'button:has-text("Allow")',
        'button:has-text("Confirm")',
        'button:has-text("Accept")',
        '#submit_approve_access',
      ];
      for (const sel of confirmSelectors) {
        try {
          const btn = popup.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click();
            console.log(`[Browser] Auto-clicked popup confirm: ${sel}`);
            break;
          }
        } catch { /* try next selector */ }
      }
    } catch (err: any) {
      console.warn(`[Browser] Popup handler error: ${err.message}`);
    }
  });

  return session;
}

async function replaceDetachedBrowserSession(parentSessionId: string, suffix: string): Promise<{ sessionId: string; session: BrowserSession }> {
  const parentResolved = resolveSessionId(parentSessionId);
  const parent = await getOrCreateSession(parentResolved);
  const detachedSessionId = `${parentResolved}::${String(suffix || 'detached').trim() || 'detached'}`;
  const existing = sessions.get(detachedSessionId);
  if (existing) {
    try { await stopBrowserLiveStream(detachedSessionId, 'Detached browser session reset.'); } catch {}
    try { await existing.page.close(); } catch {}
    sessions.delete(detachedSessionId);
    clearBrowserInteractionState(detachedSessionId);
    clearBrowserTeachSessionSnapshot(detachedSessionId);
  }
  const page = await parent.context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
  const detached: BrowserSession = {
    sessionId: detachedSessionId,
    browser: parent.browser,
    context: parent.context,
    page,
    ownsBrowser: false,
    isolated: parent.isolated === true,
    debugPort: parent.debugPort,
    profileDir: parent.profileDir,
    lastSnapshot: '',
    lastSnapshotAt: 0,
    lastPageUrl: '',
    lastPageTitle: '',
    injectedStaticContext: {},
    createdAt: Date.now(),
  };
  sessions.set(detachedSessionId, detached);
  return { sessionId: detachedSessionId, session: detached };
}

// ─── DOM-Based Snapshot (works on ALL Playwright versions) ─────────────────────

async function takeSnapshot(page: PwPage, maxElements: number = 100): Promise<string> {
  try {
    const title = await page.title();
    const url = page.url();

    // Scrape the DOM directly — no dependency on accessibility APIs
    const snapshotData: {
      elements: SnapElement[];
      diagnostics: {
        scanned: number;
        included: number;
        hidden: number;
        unlabeled_non_input: number;
        unnamed_input_included: number;
      };
      modalOpen: boolean;
      modalLabel: string;
    } = await page.evaluate((max: number) => {
      const doc = (globalThis as any).document;
      // Expanded selector set — includes data-testid (React apps), explicit search inputs
      const selector = [
        'a[href]', 'button', 'input', 'select', 'textarea',
        'input[type="search"]', 'input[type="text"]',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="search"]',
        '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]',
        '[contenteditable="true"]',
        '[data-testid]',
        'h1', 'h2', 'h3',
      ].join(', ');

      // ── Modal / dialog detection ───────────────────────────────────────────
      // If a modal or dialog is open, ONLY elements inside it are interactable.
      // Scanning the full DOM would expose background elements the AI cannot
      // actually click (they are aria-hidden or covered by the overlay).
      // Priority: aria-modal dialogs > role=dialog > data-testid dialogs.
      const openModal = (
        doc.querySelector('[role="dialog"][aria-modal="true"]')
        || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
        || doc.querySelector('[data-testid="sheetDialog"], [data-testid="confirmationSheetDialog"], [data-testid="keyboardShortcutModal"]')
        || doc.querySelector('dialog[open]')
        // X.com reply-permission dropdown and other sheets that aren't role=dialog
        || doc.querySelector('[data-testid="Dropdown"]')
        || doc.querySelector('[role="menu"]')
        || null
      );
      const searchRoot = openModal || doc;

      // De-duplicate nodes (data-testid + input could match same element twice)
      const seen = new Set<any>();
      const nodes: any[] = [];
      for (const el of Array.from(searchRoot.querySelectorAll(selector))) {
        if (!seen.has(el)) { seen.add(el); nodes.push(el); }
        if (nodes.length >= max) break;
      }

      const results: any[] = [];
      const diagnostics = {
        scanned: nodes.length,
        included: 0,
        hidden: 0,
        unlabeled_non_input: 0,
        unnamed_input_included: 0,
      };

      // ── Stable ref assignment using data-sc-ref attributes ─────────────────
      // Pre-scan all existing data-sc-ref values so we never reassign a taken ref.
      // Elements that already have data-sc-ref keep the SAME ref across DOM mutations
      // (React re-renders, SPA route changes) — this eliminates ref-drift entirely.
      const usedRefs = new Set<number>();
      for (const anyEl of Array.from(doc.querySelectorAll('[data-sc-ref]'))) {
        const n = parseInt((anyEl as any).getAttribute('data-sc-ref') || '', 10);
        if (!isNaN(n) && n > 0) usedRefs.add(n);
      }
      let _nextRef = 1;
      const assignRef = (el: any): number => {
        const existing = el.getAttribute('data-sc-ref');
        if (existing) {
          const n = parseInt(existing, 10);
          if (!isNaN(n) && n > 0) return n;
        }
        while (usedRefs.has(_nextRef)) _nextRef++;
        const r = _nextRef++;
        usedRefs.add(r);
        try { el.setAttribute('data-sc-ref', String(r)); } catch { /* read-only frame */ }
        return r;
      };

      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const tag = el.tagName.toLowerCase();
        const ariaRole = el.getAttribute('role') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const inputType = el.getAttribute('type') || '';
        const testId = el.getAttribute('data-testid') || '';
        const text = (el.innerText || '').trim().slice(0, 80);
        const val = el.value ? String(el.value).slice(0, 60) : '';
        const isContentEditable = el.getAttribute('contenteditable') === 'true';
        const inputLikeTag = ['input', 'textarea', 'select'].includes(tag) || isContentEditable;

        // Determine visible name — prefer aria-label, then text, then placeholder, then data-testid
        let name = ariaLabel || text || placeholder || testId || '';
        if (!name && tag === 'input') name = placeholder || inputType || 'input';
        if (!name && isContentEditable) name = 'editable';

        // Skip invisible or empty non-interactive elements
        if (!name && !inputLikeTag) {
          diagnostics.unlabeled_non_input++;
          continue;
        }
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        const hiddenByBox =
          (el.offsetWidth === 0 && el.offsetHeight === 0)
          || (rect ? (rect.width === 0 && rect.height === 0) : false);
        const style = typeof (globalThis as any).getComputedStyle === 'function'
          ? (globalThis as any).getComputedStyle(el)
          : null;
        const hiddenByStyle =
          !!style
          && (style.display === 'none' || style.visibility === 'hidden');
        if (hiddenByBox || hiddenByStyle) {
          diagnostics.hidden++;
          continue;
        }

        // Determine semantic role
        let role = ariaRole || tag;
        if (tag === 'a') role = 'link';
        if (tag === 'button' || ariaRole === 'button') role = 'button';
        if (tag === 'input' && ['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(inputType)) role = 'textbox';
        if (tag === 'input' && inputType === 'search') role = 'searchbox';
        if (tag === 'textarea') role = 'textbox';
        if (tag === 'select' || ariaRole === 'combobox' || ariaRole === 'listbox') role = 'combobox';
        if (ariaRole === 'searchbox' || ariaRole === 'textbox') role = ariaRole;
        if (tag === 'input' && inputType === 'checkbox') role = 'checkbox';
        if (tag === 'input' && inputType === 'radio') role = 'radio';

        const isInput = ['textbox', 'searchbox', 'combobox', 'textarea'].includes(role)
          || (tag === 'input' && ['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(inputType))
          || tag === 'textarea'
          || isContentEditable;

        if (!name && isInput) diagnostics.unnamed_input_included++;

        results.push({
          // Stable ref: persists across DOM mutations via data-sc-ref attribute
          ref: assignRef(el),
          tag,
          role,
          // Use placeholder as name fallback so model sees "Search Reddit" not empty string
          name: (name || placeholder || '').slice(0, 80),
          type: inputType || undefined,
          placeholder: placeholder || undefined,
          value: val || undefined,
          isInput,
          testId: testId || undefined,
        });
      }
      diagnostics.included = results.length;
      const modalLabel = openModal
        ? (openModal.getAttribute('aria-label') || openModal.getAttribute('aria-labelledby') && (doc.getElementById(openModal.getAttribute('aria-labelledby') || '') as any)?.innerText || openModal.getAttribute('data-testid') || 'dialog')
        : '';
      return { elements: results, diagnostics, modalOpen: !!openModal, modalLabel: String(modalLabel || '').trim().slice(0, 80) };
    }, maxElements);
    const rawElements = Array.isArray(snapshotData?.elements) ? snapshotData.elements : [];
    const elements: SnapElement[] = rawElements
      .map((raw: any) => {
        const role = String(raw?.role || raw?.tag || 'element').trim().toLowerCase() || 'element';
        const tag = String(raw?.tag || role || 'div').trim().toLowerCase() || 'div';
        const name = String(raw?.name || raw?.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const type = raw?.type ? String(raw.type).replace(/\s+/g, ' ').trim().slice(0, 40) : undefined;
        const placeholder = raw?.placeholder
          ? String(raw.placeholder).replace(/\s+/g, ' ').trim().slice(0, 80)
          : undefined;
        const value = raw?.value
          ? String(raw.value).replace(/\s+/g, ' ').trim().slice(0, 60)
          : undefined;
        const isInput = !!raw?.isInput
          || ['textbox', 'searchbox', 'combobox', 'textarea'].includes(role)
          || tag === 'input'
          || tag === 'textarea'
          || tag === 'select';
        // Use the stable ref from data-sc-ref attribute (set during page.evaluate)
        const ref = Number.isFinite(Number(raw?.ref)) && Number(raw.ref) > 0 ? Number(raw.ref) : 0;
        return { ref, tag, role, name, type, placeholder, value, isInput };
      })
      .filter((el) => el.ref > 0 && (el.name.length > 0 || el.isInput));

    const toCount = (value: unknown, fallback: number): number => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
    };
    const rawDiagnostics = snapshotData?.diagnostics && typeof snapshotData.diagnostics === 'object'
      ? snapshotData.diagnostics as Record<string, unknown>
      : {};
    const diagnostics = {
      scanned: toCount(rawDiagnostics.scanned, Math.max(rawElements.length, elements.length)),
      included: elements.length,
      hidden: toCount(rawDiagnostics.hidden, 0),
      unlabeled_non_input: toCount(rawDiagnostics.unlabeled_non_input, 0),
      unnamed_input_included: toCount(rawDiagnostics.unnamed_input_included, 0),
    };
    if (diagnostics.scanned < diagnostics.included) {
      diagnostics.scanned = diagnostics.included;
    }

    // Build compact text for the LLM
    const displayUrlRaw = String(url || '').replace(/\s+/g, ' ').trim();
    const displayUrl = displayUrlRaw.length > 360 ? `${displayUrlRaw.slice(0, 357)}...` : displayUrlRaw;
    const lines = [
      `Page: ${title}`,
      `Elements (${elements.length}):`,
      `Snapshot diagnostics: scanned=${diagnostics.scanned} included=${diagnostics.included} hidden=${diagnostics.hidden} unlabeled_non_input=${diagnostics.unlabeled_non_input} unnamed_input_included=${diagnostics.unnamed_input_included}`,
      `URL: ${displayUrl}`,
      '',
    ];
    for (const el of elements) {
      let line = `[@${el.ref}] ${el.role}`;
      // Always show a name — fall back to placeholder so inputs are never shown as [@N] textbox ""
      const displayName = el.name || (el as any).placeholder || '';
      if (displayName) line += ` "${displayName}"`;
      if (el.isInput) line += ' [INPUT]';
      if (el.value) line += ` value="${el.value}"`;
      lines.push(line);
    }
    const snapshotText = lines.join('\n');

    // Modal / dialog open — warn the AI so it doesn't try to interact with background elements.
    if (snapshotData?.modalOpen) {
      const label = snapshotData.modalLabel ? ` ("${snapshotData.modalLabel}")` : '';
      return snapshotText
        + `\n\n[MODAL OPEN]${label} A dialog/modal is blocking the page. The ${elements.length} elements above are ONLY the controls inside this modal. Background page elements are NOT accessible until the modal is closed. To dismiss: look for a Close button or press Escape with browser_press_key({"key":"Escape"}).`;
    }

    // Login wall detection — append an explicit action hint so the agent doesn't loop.
    // If the page looks like a login wall and there's a one-click sign-in button, say so.
    const elementText = elements.map(e => e.name).join(' ').toLowerCase();
    const isLoginWall = /join today|sign in|log in|create account/i.test(title + ' ' + elementText);
    if (isLoginWall) {
      const signInRef = elements.find(e =>
        /sign in as|continue as|sign in with google|sign in with apple/i.test(e.name)
      );
      if (signInRef) {
        return snapshotText + `\n\n[LOGIN PAGE DETECTED] Click @${signInRef.ref} ("${signInRef.name}") to sign in immediately. Do NOT loop on snapshots.`;
      }
      const plainSignIn = elements.find(e => /^sign in$/i.test(e.name.trim()));
      if (plainSignIn) {
        return snapshotText + `\n\n[LOGIN PAGE DETECTED] Click @${plainSignIn.ref} ("${plainSignIn.name}") to proceed to the login form.`;
      }
    }

    // ── Low-element heuristic: try same-origin frame piercing, flag cross-origin ─
    // If the main document has few elements, content is likely in iframes.
    // Same-origin frames: we can scan their elements directly via Playwright frames().
    // Cross-origin frames: we cannot read them, but we surface the URL for navigation.
    if (elements.length < 15) {
      try {
        const pageOrigin = (() => { try { return new URL(url).origin; } catch { return ''; } })();

        // Collect iframe info from DOM
        const iframeInfo: Array<{ src: string; id: string; name: string; width: number; height: number }> =
          await page.evaluate(() => {
            return Array.from((globalThis as any).document.querySelectorAll('iframe'))
              .map((f: any) => ({
                src: f.src || f.getAttribute('src') || '',
                id: f.id || '',
                name: f.name || f.getAttribute('title') || '',
                width: f.offsetWidth,
                height: f.offsetHeight,
              }))
              .filter((f: any) => f.src && !f.src.startsWith('javascript') && f.width > 60 && f.height > 60)
              .slice(0, 8);
          });

        const crossOrigin: typeof iframeInfo = [];
        const sameOriginElements: string[] = [];
        let nextFrameRef = elements.reduce((max, el) => Math.max(max, Number(el.ref) || 0), 0) + 1;

        // Try to pierce same-origin frames via Playwright's frames() API
        for (const frameHandle of page.frames()) {
          try {
            const fUrl = frameHandle.url();
            if (!fUrl || fUrl === 'about:blank' || fUrl === url) continue;
            // Check if this frame matches one of the DOM iframes
            const matchInfo = iframeInfo.find(f => f.src && fUrl.startsWith(f.src.split('?')[0]));
            const frameOrigin = (() => { try { return new URL(fUrl).origin; } catch { return ''; } })();
            if (pageOrigin && frameOrigin && frameOrigin !== pageOrigin) {
              // Cross-origin: flag it
              if (matchInfo) crossOrigin.push(matchInfo);
              continue;
            }
            // Same-origin: scan elements inside this frame
            const startRef = nextFrameRef;
            const frameData = await frameHandle.evaluate((args: { max: number; startRef: number }) => {
              const doc = (globalThis as any).document;
              const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]';
              const results: any[] = [];
              let nextRef = Number(args.startRef) || 1;
              for (const el of Array.from(doc.querySelectorAll(sel)).slice(0, args.max) as any[]) {
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || tag;
                const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || '').slice(0, 80);
                if (!name && !['input','textarea','select'].includes(tag)) continue;
                const rect = el.getBoundingClientRect?.();
                if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0)) continue;
                // Reassign frame refs from the current snapshot high-water mark so
                // they stay unique against main-frame refs and old legacy frame refs.
                const ref = nextRef++;
                try { el.setAttribute('data-sc-ref', String(ref)); } catch {}
                results.push({ ref, role, name, tag, isInput: ['input','textarea','select'].includes(tag) });
              }
              return results;
            }, { max: 60, startRef }).catch(() => []);
            nextFrameRef = frameData.reduce((max: number, entry: any) => Math.max(max, Number(entry?.ref) || 0), startRef - 1) + 1;

            for (const el of frameData) {
              const frameLabel = matchInfo ? (matchInfo.name || matchInfo.id || new URL(fUrl).hostname) : new URL(fUrl).hostname;
              let line = `[@${el.ref}] ${el.role} "${el.name}" [frame:${frameLabel}]`;
              if (el.isInput) line += ' [INPUT]';
              sameOriginElements.push(line);
            }
          } catch { /* cross-origin frame, skip */ }
        }

        // Any iframe in DOM but NOT reachable via page.frames() is cross-origin
        for (const fi of iframeInfo) {
          const fOrigin = (() => { try { return new URL(fi.src).origin; } catch { return ''; } })();
          if (pageOrigin && fOrigin && fOrigin !== pageOrigin && !crossOrigin.find(c => c.src === fi.src)) {
            crossOrigin.push(fi);
          }
        }

        const extras: string[] = [];
        if (sameOriginElements.length > 0) {
          extras.push(`\n[SAME-ORIGIN FRAME ELEMENTS — interactable via normal browser_click/browser_fill]\n${sameOriginElements.join('\n')}`);
        }
        if (crossOrigin.length > 0) {
          const lines = crossOrigin.map(f => `  - ${f.name || f.id || 'iframe'} → ${f.src.slice(0, 200)}`).join('\n');
          extras.push(`\n[CROSS-ORIGIN IFRAMES — content cannot be read directly; navigate with browser_open]\n${lines}`);
        }
        if (extras.length > 0) {
          return snapshotText + extras.join('');
        }
      } catch { /* best effort */ }

      // ── Fallback: append visible body text so AI can still read content ─────
      try {
        const bodyText = await page.evaluate(() => {
          const el = (globalThis as any).document.body;
          if (!el) return '';
          return (el.innerText || el.textContent || '')
            .replace(/\s{3,}/g, '\n')
            .trim()
            .slice(0, 3000);
        });
        if (bodyText && bodyText.length > 100) {
          return snapshotText + '\n\n[PAGE TEXT \u2014 low element count, showing visible content]\n' + bodyText;
        }
      } catch { /* best effort */ }
    }

    return snapshotText;
  } catch (err: any) {
    return `Snapshot error: ${err.message}`;
  }
}

// ─── Element Interaction ───────────────────────────────────────────────────────

// Shared selector used consistently across snapshot + click + fill
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  'input[type="search"]', 'input[type="text"]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="search"]',
  '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]',
  '[contenteditable="true"]',
  '[data-testid]',
  'h1', 'h2', 'h3',
].join(', ');

async function findLocatorByStableRef(page: PwPage, ref: number): Promise<any | null> {
  const selector = `[data-sc-ref="${ref}"]`;
  for (const frame of page.frames()) {
    try {
      const locator = frame.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (count > 0) return locator;
    } catch {
      // Continue scanning other frames.
    }
  }
  return null;
}

async function describeLocator(locator: any): Promise<{
  tag: string;
  role: string;
  name: string;
  isInput: boolean;
  isContentEditable: boolean;
}> {
  const meta = await locator.evaluate((el: any) => {
    const tag = String(el?.tagName || '').toLowerCase() || 'element';
    const role = String(el?.getAttribute?.('role') || '').toLowerCase() || tag;
    const isContentEditable = el?.getAttribute?.('contenteditable') === 'true';
    const isInput = ['input', 'textarea', 'select'].includes(tag)
      || isContentEditable
      || ['textbox', 'searchbox', 'combobox'].includes(role);
    const name = String(
      el?.getAttribute?.('aria-label')
      || (el?.innerText || '').trim()
      || el?.getAttribute?.('placeholder')
      || el?.getAttribute?.('data-testid')
      || tag,
    ).slice(0, 80);
    return { tag, role, name, isInput, isContentEditable };
  }).catch(() => null);
  if (!meta) {
    return { tag: 'element', role: 'element', name: 'element', isInput: false, isContentEditable: false };
  }
  return {
    tag: String(meta.tag || 'element'),
    role: String(meta.role || meta.tag || 'element'),
    name: String(meta.name || meta.tag || 'element').trim() || 'element',
    isInput: !!meta.isInput,
    isContentEditable: !!meta.isContentEditable,
  };
}

async function resolveViewportPointFromTarget(
  page: PwPage,
  target: { ref?: number; x?: number; y?: number },
  labelPrefix: string,
): Promise<{ x: number; y: number; label: string }> {
  const ref = Number(target?.ref);
  if (Number.isFinite(ref) && ref > 0) {
    const locator = await findLocatorByStableRef(page, ref);
    if (!locator) throw new Error(`${labelPrefix} ref @${ref} not found`);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const meta = await describeLocator(locator);
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error(`${labelPrefix} ref @${ref} is not visible`);
    }
    return {
      x: Math.round(box.x + (box.width / 2)),
      y: Math.round(box.y + (box.height / 2)),
      label: `@${ref} (${meta.role}: "${meta.name}")`,
    };
  }
  const x = Math.round(Number(target?.x));
  const y = Math.round(Number(target?.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${labelPrefix} requires either *_ref or both *_x and *_y`);
  }
  return { x, y, label: `(${x}, ${y})` };
}

// Click a page element by its stable data-sc-ref number
async function clickByRef(page: PwPage, ref: number): Promise<{ role: string; name: string }> {
  const locator = await findLocatorByStableRef(page, ref);
  if (locator) {
    const meta = await describeLocator(locator);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click();
    await page.waitForTimeout(1500);
    return { role: meta.role, name: meta.name };
  }

  // Fallback: positional scan (legacy path for elements without data-sc-ref)
  const fallback = await page.evaluate((args: { refIdx: number; sel: string }) => {
    const doc = (globalThis as any).document;
    const openModal = (
      doc.querySelector('[role="dialog"][aria-modal="true"]')
      || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
      || doc.querySelector('dialog[open]')
      || doc.querySelector('[role="menu"]')
      || null
    );
    const searchRoot = openModal || doc;
    let counter = 0;
    for (const el of Array.from(searchRoot.querySelectorAll(args.sel)) as any[]) {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const isContentEditable = el.getAttribute('contenteditable') === 'true';
      const isInputLike = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
      const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80) || (isContentEditable ? 'editable' : '');
      if (!name && !isInputLike) continue;
      const rect = el.getBoundingClientRect?.();
      if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0 && rect.height === 0)) continue;
      const style = (globalThis as any).getComputedStyle?.(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
      counter++;
      if (counter === args.refIdx) {
        el.scrollIntoView({ block: 'center' });
        el.focus();
        el.click();
        return { role: role || tag, name: name || tag };
      }
    }
    return null;
  }, { refIdx: ref, sel: INTERACTIVE_SELECTOR });
  if (!fallback) throw new Error(`Element @${ref} not found`);
  await page.waitForTimeout(1500);
  return fallback;
}

async function clickBySelector(page: PwPage, selector: string): Promise<{ role: string; name: string }> {
  const locator = page.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  if (!count) throw new Error(`No element found for selector "${selector}"`);
  const meta = await locator.evaluate((el: any) => {
    const tag = String(el?.tagName || '').toLowerCase() || 'element';
    const role = String(el?.getAttribute?.('role') || '').toLowerCase() || tag;
    const name = String(
      el?.getAttribute?.('aria-label')
      || (el?.innerText || '').trim()
      || el?.getAttribute?.('placeholder')
      || el?.getAttribute?.('data-testid')
      || tag,
    ).slice(0, 80);
    return { role, name };
  }).catch(() => null);
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click();
  await page.waitForTimeout(1500);
  return {
    role: String(meta?.role || 'element'),
    name: String(meta?.name || selector).trim() || selector,
  };
}

// Fill a page element by its stable data-sc-ref number
async function fillByRef(page: PwPage, ref: number, text: string): Promise<{ role: string; name: string; needsNativeType?: boolean }> {
  const locator = await findLocatorByStableRef(page, ref);
  const result = locator
    ? await locator.evaluate((el: any, args: { ref: number; text: string }) => {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const isContentEditable = el.getAttribute('contenteditable') === 'true';
      const isInput = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
      const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80) || (isContentEditable ? 'editable' : '');
      if (!isInput) return { error: `Element @${args.ref} (${el.getAttribute('role') || tag}) is not a text input.` };
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
      if (typeof el.focus === 'function') el.focus();
      if (tag === 'select') {
        el.value = args.text;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (isContentEditable) {
        if (typeof el.click === 'function') el.click();
        return { role: role || tag, name: name || tag, needsNativeType: true };
      } else {
        const nativeSetter = Object.getOwnPropertyDescriptor((globalThis as any).HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor((globalThis as any).HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(el, args.text);
        else el.value = args.text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { role: role || tag, name: name || tag };
    }, { ref, text })
    : null;

  if (result === null) {
    // Fallback: positional scan (legacy path for elements without data-sc-ref)
    const fallback = await page.evaluate((args: { ref: number; text: string; sel: string }) => {
      const doc = (globalThis as any).document;
      const openModal = doc.querySelector('[role="dialog"][aria-modal="true"]') || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])') || doc.querySelector('dialog[open]') || doc.querySelector('[role="menu"]') || null;
      const searchRoot = openModal || doc;
      let counter = 0;
      for (const el of Array.from(searchRoot.querySelectorAll(args.sel)) as any[]) {
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const isContentEditable = el.getAttribute('contenteditable') === 'true';
        const isInput = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
        const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80) || (isContentEditable ? 'editable' : '');
        if (!name && !isInput) continue;
        const rect = el.getBoundingClientRect?.();
        if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0 && rect.height === 0)) continue;
        const style = (globalThis as any).getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
        counter++;
        if (counter === args.ref) {
          if (!isInput) return { error: `Element @${args.ref} (${el.getAttribute('role') || tag}) is not a text input.` };
          el.scrollIntoView({ block: 'center' }); el.focus();
          if (tag === 'select') { el.value = args.text; el.dispatchEvent(new Event('change', { bubbles: true })); }
          else if (isContentEditable) { el.click(); return { role: role || tag, name: name || tag, needsNativeType: true }; }
          else {
            const nativeSetter = Object.getOwnPropertyDescriptor((globalThis as any).HTMLInputElement.prototype, 'value')?.set || Object.getOwnPropertyDescriptor((globalThis as any).HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(el, args.text); else el.value = args.text;
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { role: role || tag, name: name || tag };
        }
      }
      return { error: `Element @${args.ref} not found` };
    }, { ref, text, sel: INTERACTIVE_SELECTOR });
    if (!fallback || (fallback as any).error) throw new Error((fallback as any)?.error || `Element @${ref} not found`);
    // contenteditable native-type path for fallback
    if ((fallback as any).needsNativeType) {
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+A');
      await page.waitForTimeout(100);
      await page.keyboard.type(text, { delay: 20 });
      await page.waitForTimeout(400);
    } else {
      await page.waitForTimeout(800);
    }
    return { role: (fallback as any).role, name: (fallback as any).name, needsNativeType: !!(fallback as any).needsNativeType };
  }

  if (!result || (result as any).error) throw new Error((result as any)?.error || `Element @${ref} not found`);

  // contenteditable elements (e.g. X.com composer) need Playwright-native typing.
  // The evaluate() click above set DOM focus; now we clear any existing content
  // with Ctrl+A then type the text through the real CDP keyboard pipeline.
  if ((result as any).needsNativeType) {
    // Small wait for React to process the click/focus event
    await page.waitForTimeout(300);
    // Select-all to clear any pre-existing text in the composer
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(100);
    // Type text character by character — this fires real KeyDown/KeyPress/KeyUp/Input
    // events that React's synthetic event system correctly intercepts.
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(400);
  } else {
    await page.waitForTimeout(800);
  }

  return { role: result.role, name: result.name, needsNativeType: !!(result as any).needsNativeType };
}

async function fillBySelector(
  page: PwPage,
  selector: string,
  text: string,
): Promise<{ role: string; name: string; needsNativeType?: boolean }> {
  const locator = page.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  if (!count) throw new Error(`No element found for selector "${selector}"`);
  const result = await locator.evaluate((el: any, nextText: string) => {
    const tag = String(el?.tagName || '').toLowerCase();
    const role = String(el?.getAttribute?.('role') || '').toLowerCase();
    const isContentEditable = el?.getAttribute?.('contenteditable') === 'true';
    const isInput = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
    const name = String(
      el?.getAttribute?.('aria-label')
      || (el?.innerText || '').trim()
      || el?.getAttribute?.('placeholder')
      || el?.getAttribute?.('data-testid')
      || '',
    ).slice(0, 80) || (isContentEditable ? 'editable' : '') || tag || 'element';
    if (!isInput) {
      return { error: `Element "${name}" (${role || tag || 'element'}) is not a text input.` };
    }
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    if (typeof el?.focus === 'function') el.focus();
    if (tag === 'select') {
      el.value = nextText;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { role: role || tag, name };
    }
    if (isContentEditable) {
      if (typeof el?.click === 'function') el.click();
      return { role: role || tag, name, needsNativeType: true };
    }
    const nativeSetter = Object.getOwnPropertyDescriptor((globalThis as any).HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor((globalThis as any).HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, nextText);
    else el.value = nextText;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { role: role || tag, name };
  }, text);

  if (!result || (result as any).error) {
    throw new Error((result as any)?.error || `Unable to fill selector "${selector}"`);
  }
  if ((result as any).needsNativeType) {
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(100);
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(400);
  } else {
    await page.waitForTimeout(800);
  }
  return {
    role: String((result as any).role || 'element'),
    name: String((result as any).name || selector).trim() || selector,
    needsNativeType: !!(result as any).needsNativeType,
  };
}

// Press a key (e.g. Enter, Tab)
async function pressKey(page: PwPage, key: string): Promise<void> {
  await page.keyboard.press(key);
  // Allow page navigation / React state updates to settle
  await page.waitForTimeout(1500);
}

function parseSnapshotElementCount(snapshot: string): number {
  const m = String(snapshot || '').match(/Elements\s*\((\d+)\):/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function stableHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function normalizeFeedItemText(item: BrowserFeedItem): string {
  return [
    item.id || '',
    item.author || '',
    item.handle || '',
    item.time || '',
    item.text || '',
    item.link || '',
    item.title || '',
    item.snippet || '',
    item.source || '',
  ].join('|');
}

function dedupeFeedItems(items: BrowserFeedItem[]): BrowserFeedItem[] {
  const out: BrowserFeedItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.id
      ? `id:${item.id}`
      : item.link
        ? `link:${item.link}`
        : stableHash(normalizeFeedItemText(item).slice(0, 500));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildPacketHash(input: {
  url: string;
  pageType: BrowserPageType;
  snapshot: string;
  extractedFeed: BrowserFeedItem[];
  textBlocks: string[];
  pageText?: string;
}): string {
  const compact = [
    input.url,
    input.pageType,
    input.snapshot.slice(0, 1800),
    ...input.extractedFeed.slice(0, 40).map((i) => normalizeFeedItemText(i)),
    ...input.textBlocks.slice(0, 20),
    (input.pageText || '').slice(0, 800),
  ].join('\n');
  return stableHash(compact);
}

async function extractStructuredFromPage(
  page: PwPage,
  maxItems: number,
): Promise<{
  pageType: BrowserPageType;
  extractedFeed: BrowserFeedItem[];
  textBlocks: string[];
  pageText: string;
  isGenerating: boolean;
}> {
  const extracted = await page.evaluate((max: number) => {
    const doc = (globalThis as any).document;
    const normalize = (v: any, maxLen: number = 400) =>
      String(v || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    const toAbs = (href: string) => {
      try { return new URL(href, (globalThis as any).location.href).toString(); } catch { return String(href || '').trim(); }
    };
    const host = String((globalThis as any).location.hostname || '').toLowerCase();
    const url = String((globalThis as any).location.href || '').toLowerCase();
    const title = normalize((globalThis as any).document.title || '', 180);
    const out: { pageType: any; extractedFeed: any[]; textBlocks: string[]; pageText: string; isGenerating: boolean } = {
      pageType: 'generic',
      extractedFeed: [],
      textBlocks: [],
      pageText: '',
      isGenerating: false,
    };

    // ── Chat interface detection (ChatGPT, Claude, Gemini, etc.) ────────────────
    const isChatInterface = /(^|\.)chatgpt\.com$/.test(host)
      || /(^|\.)claude\.ai$/.test(host)
      || /(^|\.)gemini\.google\.com$/.test(host)
      || /(^|\.)chat\.openai\.com$/.test(host)
      || /\/c\/[a-f0-9-]{8,}/.test(url);   // generic /c/<uuid> conversation URL pattern

    if (isChatInterface) {
      out.pageType = 'chat_interface';

      // Detect if the AI is still generating — look for stop/streaming indicators
      const bodyText = normalize(doc.body?.innerText || '', 200);
      const stopBtn = doc.querySelector(
        'button[aria-label*="Stop"], button[data-testid*="stop"], [aria-label*="Stop generating"], .stop-button',
      );
      const streamingIndicator = doc.querySelector(
        '[data-testid="streaming-indicator"], .result-streaming, [class*="streaming"], [class*="generating"]',
      );
      // Heuristic: page title "ChatGPT" (not yet renamed to conversation topic) + very few response nodes
      const stillOnDefaultTitle = /^chatgpt$/i.test(title.trim());
      out.isGenerating = !!(stopBtn || streamingIndicator);

      // Extract the last assistant message — ChatGPT uses [data-message-author-role="assistant"]
      // Claude.ai uses [data-is-streaming], Gemini uses .model-response-text
      const assistantMsgSelectors = [
        '[data-message-author-role="assistant"]',
        '[data-testid*="conversation-turn"]:last-of-type',
        '.agent-turn',
        '.model-response-text',
        '[class*="AssistantMessage"]',
        '[class*="response-text"]',
      ];
      let lastMsgText = '';
      for (const sel of assistantMsgSelectors) {
        const nodes = Array.from(doc.querySelectorAll(sel)) as any[];
        if (!nodes.length) continue;
        const last = nodes[nodes.length - 1];
        const txt = normalize(last?.innerText || last?.textContent || '', 3000);
        if (txt.length > 60) { lastMsgText = txt; break; }
      }

      // Fallback: grab all paragraph text from main content area
      if (!lastMsgText) {
        const mainArea = doc.querySelector('main, [role="main"], #__next > div:nth-child(2)');
        if (mainArea) lastMsgText = normalize(mainArea?.innerText || '', 3000);
      }

      out.pageText = lastMsgText;
      // Put a short excerpt in textBlocks so existing advisor prompts that read textBlocks also work
      if (lastMsgText) out.textBlocks = [lastMsgText.slice(0, 1200)];
      return out;
    }

    const isX = /(^|\.)x\.com$/.test(host) || /(^|\.)twitter\.com$/.test(host);
    const isSearch = /(search|results|q=)/.test(url) || /(google|bing|duckduckgo|brave|yahoo)\./.test(host);

    if (isX) {
      // Smarter X.com page type detection — not all x.com pages are feed pages.
      // Compose, settings, notifications, and other interactive pages should be 'generic'
      // so the browser advisor treats them as interaction targets, not feed collectors.
      const xPathname = String((globalThis as any).location?.pathname || '');
      const isXComposePage = /^\/(compose|intent)/.test(xPathname);
      const isXSettingsPage = xPathname.startsWith('/settings') || xPathname.startsWith('/i/');
      const isXNotifications = xPathname.startsWith('/notifications');
      const isXHomeFeed = xPathname === '/' || xPathname === '/home' || xPathname === '';
      const isXProfileOrThread = /^\/[a-z0-9_]+(\/(status\/\d+)?)?$/i.test(xPathname) && !isXComposePage && !isXSettingsPage && !isXNotifications;

      if (isXComposePage || isXSettingsPage || isXNotifications) {
        // Interactive page — treat as generic so advisor uses ref-based interaction mode
        out.pageType = 'generic';
        return out;
      } else if (isXHomeFeed || isXProfileOrThread) {
        // Home feed has a composer at the top — if the composer textarea is present
        // in the DOM, treat as generic so the scroll-before-act gate fires and forces
        // the model to interact with the composer rather than scrolling past it.
        const composerPresent = !!doc.querySelector(
          '[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea"], '
          + 'div[contenteditable="true"][aria-label], '
          + 'div[role="textbox"][data-testid]'
        );
        out.pageType = composerPresent ? 'generic' : 'x_feed';
      } else {
        // Unknown x.com path — fall back to generic (safer for interaction)
        out.pageType = 'generic';
        return out;
      }

      const seen = new Set<string>();
      const tweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]')) as any[];
      for (const tw of tweets) {
        const text = normalize(
          Array.from(tw.querySelectorAll('[data-testid="tweetText"]'))
            .map((n: any) => n.innerText || n.textContent || '')
            .join(' '),
          1800,
        );
        const statusLink = tw.querySelector('a[href*="/status/"]') as any;
        const link = statusLink ? toAbs(statusLink.getAttribute('href') || '') : '';
        const idMatch = link.match(/\/status\/(\d+)/);
        const tweetId = idMatch ? idMatch[1] : '';
        const userNameNode = tw.querySelector('[data-testid="User-Name"]') as any;
        const author = normalize(
          userNameNode?.querySelector('span')?.textContent
            || tw.querySelector('a[role="link"] span')?.textContent
            || '',
          120,
        );
        let handle = '';
        const spans = userNameNode ? Array.from(userNameNode.querySelectorAll('span')) : [];
        for (const sp of spans) {
          const val = normalize((sp as any).textContent || '', 80);
          if (/^@[a-z0-9_]{1,30}$/i.test(val)) { handle = val; break; }
        }
        if (!handle) {
          const m = normalize(tw.innerText || '', 500).match(/@[a-z0-9_]{1,30}/i);
          handle = m ? m[0] : '';
        }

        const time = normalize((tw.querySelector('time') as any)?.getAttribute('datetime') || '', 80);
        const replies = normalize((tw.querySelector('[data-testid="reply"]') as any)?.innerText || '', 30);
        const reposts = normalize((tw.querySelector('[data-testid="retweet"]') as any)?.innerText || '', 30);
        const likes = normalize((tw.querySelector('[data-testid="like"]') as any)?.innerText || '', 30);
        const views = normalize((tw.querySelector('[data-testid="viewCount"]') as any)?.innerText || '', 30);
        const imageUrls = Array.from(
          tw.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')
        )
          .map((node: any) => normalize(node.currentSrc || node.src || node.getAttribute('src') || '', 1200))
          .filter(Boolean)
          .map((src: string) => toAbs(src));
        const uniqueImageUrls = Array.from(new Set(imageUrls));
        const videoNode = tw.querySelector('[data-testid="videoPlayer"] video, video') as any;
        const rawVideoSrc = normalize(videoNode?.currentSrc || videoNode?.src || '', 1200);
        const videoSrc = rawVideoSrc && !/^blob:/i.test(rawVideoSrc) ? toAbs(rawVideoSrc) : '';
        const videoPoster = normalize(
          videoNode?.getAttribute?.('poster')
            || (tw.querySelector('[data-testid="videoPlayer"] img') as any)?.currentSrc
            || (tw.querySelector('[data-testid="videoPlayer"] img') as any)?.src
            || '',
          1200,
        );
        const hasVideo = !!(tw.querySelector('[data-testid="videoPlayer"]') || tw.querySelector('video'));
        const media = [
          ...uniqueImageUrls.map((mediaUrl: string) => ({ type: 'image' as const, url: mediaUrl })),
          ...(hasVideo ? [{ type: 'video' as const, url: videoSrc || undefined, previewUrl: videoPoster || undefined }] : []),
        ];
        const hasImage = uniqueImageUrls.length > 0 || hasVideo;

        if (!text && !link) continue;
        const key = tweetId || link || `${handle}|${text.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.extractedFeed.push({
          id: tweetId || undefined,
          author: author || undefined,
          handle: handle || undefined,
          time: time || undefined,
          text: text || undefined,
          link: link || undefined,
          source: 'x',
          hasImage: hasImage || undefined,
          hasVideo: hasVideo || undefined,
          media: media.length ? media : undefined,
          metrics: {
            replies: replies || undefined,
            reposts: reposts || undefined,
            likes: likes || undefined,
            views: views || undefined,
          },
        });
        if (out.extractedFeed.length >= max) break;
      }
      return out;
    }

    if (isSearch) {
      out.pageType = 'search_results';
      const cards = Array.from(
        doc.querySelectorAll(
          'div.g, div[data-sokoban-container], li.b_algo, .result, .search-result, article, main section',
        ),
      ) as any[];
      const seen = new Set<string>();
      for (const card of cards) {
        const titleEl = card.querySelector('h3, h2');
        const linkEl = card.querySelector('a[href]');
        const snippetEl = card.querySelector('.VwiC3b, .IsZvec, p, span');
        const titleText = normalize(titleEl?.textContent || '', 220);
        const link = normalize(linkEl ? toAbs(linkEl.getAttribute('href') || '') : '', 500);
        const snippet = normalize(snippetEl?.textContent || '', 500);
        if (!titleText && !snippet) continue;
        const key = link || `${titleText}|${snippet.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.extractedFeed.push({
          title: titleText || undefined,
          link: link || undefined,
          snippet: snippet || undefined,
          source: host,
        });
        if (out.extractedFeed.length >= max) break;
      }
      return out;
    }

    // Generic article-ish content for research pages.
    const paras = Array.from(doc.querySelectorAll('article p, main p, p')) as any[];
    const blocks: string[] = [];
    for (const p of paras) {
      const text = normalize(p.innerText || p.textContent || '', 700);
      if (text.length < 80) continue;
      blocks.push(text);
      if (blocks.length >= max) break;
    }
    out.textBlocks = blocks;
    out.pageText = blocks.slice(0, 6).join(' ');
    if (
      /article|news|blog|post|story/i.test(title)
      || /(news|blog|substack|medium)\./.test(host)
      || blocks.length >= 4
    ) {
      out.pageType = 'article';
    }
    return out;
  }, Math.max(4, Math.min(maxItems, 60)));

  return {
    pageType: extracted.pageType,
    extractedFeed: dedupeFeedItems((extracted.extractedFeed || []) as BrowserFeedItem[]).slice(0, maxItems),
    textBlocks: (Array.isArray(extracted.textBlocks) ? extracted.textBlocks : []).map((s: any) => String(s || '')).filter(Boolean).slice(0, maxItems),
    pageText: String(extracted.pageText || ''),
    isGenerating: !!extracted.isGenerating,
  };
}

// How stale a cached snapshot is allowed to be before we re-scrape for the advisor.
// browser_open / click / fill / scroll all update session.lastSnapshot immediately, so
// in those flows the snapshot is always < 500 ms old. Only browser_wait paths might
// produce a snapshot that drifts, hence the 4-second ceiling.
const SNAPSHOT_CACHE_TTL_MS = 4000;

async function buildAdvisorPacketForSession(
  session: BrowserSession,
  options?: { maxItems?: number; snapshotElements?: number; cachedSnapshotMs?: number },
): Promise<BrowserAdvisorPacket> {
  const maxItems = Math.max(6, Math.min(Number(options?.maxItems || 24), 60));
  const snapshotElements = Math.max(80, Math.min(Number(options?.snapshotElements || 140), 280));

  const title = await session.page.title();
  const url = session.page.url();

  // Reuse the snapshot the tool handler already captured if it's fresh enough.
  // This avoids a second full DOM scrape immediately after browser_open / click / fill / scroll.
  const cacheAgeMs = options?.cachedSnapshotMs ?? SNAPSHOT_CACHE_TTL_MS;
  const snapshotAge = session.lastSnapshotAt ? Date.now() - session.lastSnapshotAt : Infinity;
  let snapshot: string;
  if (session.lastSnapshot && snapshotAge < cacheAgeMs) {
    snapshot = session.lastSnapshot;
  } else {
    snapshot = await takeSnapshot(session.page, snapshotElements);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
  }

  // extractStructuredFromPage is a separate page.evaluate that does its own DOM walk.
  // We still need it for feed/article extraction which the compact snapshot doesn't capture.
  const structured = await extractStructuredFromPage(session.page, maxItems);

  const packet: BrowserAdvisorPacket = {
    page: {
      title: String(title || '').trim(),
      url: String(url || '').trim(),
      pageType: structured.pageType,
    },
    snapshot,
    snapshotElements: parseSnapshotElementCount(snapshot),
    extractedFeed: structured.extractedFeed,
    textBlocks: structured.textBlocks,
    pageText: structured.pageText,
    isGenerating: structured.isGenerating,
    contentHash: buildPacketHash({
      url,
      pageType: structured.pageType,
      snapshot,
      extractedFeed: structured.extractedFeed,
      textBlocks: structured.textBlocks,
      pageText: structured.pageText,
    }),
  };
  return packet;
}

// ─── Exported Tool Handlers ────────────────────────────────────────────────────

// ─── Shared browser session alias ────────────────────────────────────────────
// Task sessions (task_<id>) share the browser connection of the parent user
// session that spawned them.  Without this, each task would try to open a
// fresh CDP connection from a cold start — which always fails mid-task because
// the debug port is already bound to the live user Chrome instance.
//
// Resolution order:
//   1. Exact session match (cache hit)
//   2. If sessionId starts with "task_" and the parent session exists, clone it
//   3. Otherwise create a brand-new session (normal CHAT path)
export function resolveSessionId(sessionId: string): string {
  const sid = String(sessionId || 'default');
  if (sessions.has(sid)) return sid;                       // fast path — already exists
  if (sid.startsWith('task_')) {
    // Walk back to find a live parent: task_<taskId> was spawned from a user
    // session stored in the task record.  Try common parent IDs in order.
    const taskId = sid.slice('task_'.length);
    const { loadTask } = require('./tasks/task-store') as typeof import('./tasks/task-store');
    const task = loadTask(taskId);
    const parentId = task?.sessionId || 'default';
    if (sessions.has(parentId)) {
      console.log(`[Browser] Task session "${sid}" aliased to parent session "${parentId}"`);
      sessions.set(sid, sessions.get(parentId)!);
      return sid;
    }
    // Parent not yet open — fall through so getOrCreateSession makes a fresh one
  }
  return sid;
}

async function broadcastBrowserViewportUpdate(
  sessionId: string,
  session: BrowserSession,
  tool: string,
  statusLabel: string,
): Promise<void> {
  try {
    const shot = await browserVisionScreenshot(sessionId);
    const title = await session.page.title().catch(() => '');
    const interactionState = getOrCreateBrowserInteractionState(sessionId);
    const liveStream = browserLiveStreams.get(resolveSessionId(sessionId));
    broadcastWS({
      type: 'browser:status',
      sessionId,
      tool,
      active: true,
      url: String(session.page.url() || ''),
      title: String(title || ''),
      statusLabel,
      mode: interactionState.mode,
      captured: interactionState.captured,
      controlOwner: interactionState.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      frameBase64: shot?.base64 || '',
      frameWidth: Number(shot?.width || 0),
      frameHeight: Number(shot?.height || 0),
      frameFormat: shot?.base64 ? 'png' : '',
      timestamp: Date.now(),
      ...buildBrowserSessionMetadataPayload(sessionId),
    });
  } catch {}
}

function buildBrowserElementSelector(parts: {
  id?: string;
  tagName?: string;
  classList?: string[];
  siblingIndex?: number;
  parentChain?: Array<{ tagName?: string; id?: string; classList?: string[]; siblingIndex?: number }>;
}): string {
  const buildSegment = (node: { tagName?: string; id?: string; classList?: string[]; siblingIndex?: number }) => {
    const tag = String(node?.tagName || '').toLowerCase();
    if (!tag) return '';
    if (node?.id) return `#${node.id}`;
    let segment = tag;
    const classList = Array.isArray(node?.classList) ? node.classList.filter(Boolean).slice(0, 3) : [];
    if (classList.length) segment += `.${classList.join('.')}`;
    if (Number.isFinite(Number(node?.siblingIndex)) && Number(node.siblingIndex) > 0) {
      segment += `:nth-of-type(${Number(node.siblingIndex)})`;
    }
    return segment;
  };
  const chain = Array.isArray(parts.parentChain) ? parts.parentChain.map(buildSegment).filter(Boolean) : [];
  const current = buildSegment(parts);
  if (current) chain.push(current);
  return chain.join(' > ');
}

function browserWorkspaceRoot(): string {
  const globalWorkspace = getConfig().getConfig().workspace.path;
  return getActiveWorkspace(globalWorkspace);
}

function sanitizeDownloadFilename(input: string): string {
  const base = path.basename(String(input || '').trim() || 'download');
  return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'download';
}

function ensureBrowserWorkspacePath(targetPath: string): string {
  const workspaceRoot = browserWorkspaceRoot();
  const absPath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(path.join(workspaceRoot, targetPath));
  const rel = path.relative(workspaceRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${targetPath}" is outside workspace.`);
  }
  return absPath;
}

function ensureBrowserOutputDir(outputDir?: string): { workspaceRoot: string; absDir: string; relDir: string } {
  const workspaceRoot = browserWorkspaceRoot();
  const absDir = ensureBrowserWorkspacePath(outputDir || 'downloads');
  const relDir = path.relative(workspaceRoot, absDir).replace(/\\/g, '/') || '.';
  return { workspaceRoot, absDir, relDir };
}

function uniqueDownloadPath(absDir: string, filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  const ext = path.extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  let candidate = path.join(absDir, safe);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(absDir, `${stem}_${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

async function persistBrowserDownload(
  sessionId: string,
  download: any,
  options?: { filename_hint?: string; output_dir?: string },
): Promise<BrowserDownloadRecord> {
  const { workspaceRoot, absDir } = ensureBrowserOutputDir(options?.output_dir);
  fs.mkdirSync(absDir, { recursive: true });
  const suggested = sanitizeDownloadFilename(
    String(options?.filename_hint || download?.suggestedFilename?.() || 'download'),
  );
  const absPath = uniqueDownloadPath(absDir, suggested);
  await download.saveAs(absPath);
  const stat = fs.statSync(absPath);
  const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  const record: BrowserDownloadRecord = {
    savedPath: absPath,
    relPath,
    suggestedFilename: suggested,
    url: String(download?.url?.() || ''),
    sizeBytes: stat.size,
    ts: Date.now(),
  };
  _lastBrowserDownload.set(resolveSessionId(sessionId), record);
  return record;
}

function toUploadPaths(filePath?: string, filePaths?: string[]): string[] {
  return Array.from(
    new Set(
      [filePath, ...(Array.isArray(filePaths) ? filePaths : [])]
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .map((p) => ensureBrowserWorkspacePath(p)),
    ),
  );
}

export async function browserOpen(
  sessionId: string,
  url: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  // ── URL sanity guard ──────────────────────────────────────────────────────
  // When called from inside the node_call<> VM sandbox the URL may arrive as
  // undefined / null / a stringified object if the model emitted bad code.
  // CDP rejects all of these with "Cannot navigate to invalid URL" and the
  // reactor retries indefinitely — producing the 29-step loop seen in logs.
  const rawUrl = String(url ?? '').trim();
  if (!rawUrl || rawUrl === 'undefined' || rawUrl === 'null' || rawUrl === 'object') {
    return 'ERROR: browser_open requires a valid URL string. Received: ' + JSON.stringify(url);
  }

  const resolvedSessionId = resolveSessionId(sessionId);
  let session: BrowserSession;
  try {
    session = await getOrCreateSession(resolvedSessionId);
  } catch (err: any) {
    return `ERROR: ${err.message}`;
  }

  try {
    let targetUrl = rawUrl;
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_open');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;

    await emitBrowserAgentCursor(sessionId, { kind: 'navigate', phase: 'start', label: targetUrl });
    await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Best-effort networkidle wait — catches SPAs that hydrate after domcontentloaded
    // Non-blocking: if it times out that's fine, we just take a snapshot with what's loaded
    await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Extra settle time for React/Next hydration
    await session.page.waitForTimeout(1500);
    await syncPageMetadata(session).catch(() => {});
    await emitBrowserAgentCursor(sessionId, { kind: 'navigate', phase: 'end', label: session.page.url() });

    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      // Attach per-site shortcut context on open and keep it host-driven (no site hardcoding).
      return attachShortcutsContext(snapshot, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, 'Browser opened.', compactBefore);
    }
    return buildMinimalBrowserAck(session, 'Browser opened.');
  } catch (err: any) {
    return `ERROR: Navigation failed: ${err.message}`;
  }
}

export async function browserSnapshot(sessionId: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  let session = sessions.get(resolved);
  if (session && !(await isSessionAlive(session))) {
    console.log(`[Browser] browserSnapshot: session dead, evicting.`);
    sessions.delete(resolved);
    try { await session.page.close(); } catch {}
    try { await session.browser.close(); } catch {}
    session = undefined;
  }
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    // Wait for the DOM to settle before snapshotting — SPAs (like x.com) may still
    // be hydrating after domcontentloaded, leaving querySelectorAll with 0 results.
    // networkidle is best-effort; we proceed even if it times out.
    await session.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Additional settle time for React/Next/Vue hydration to mount interactive elements.
    await session.page.waitForTimeout(600);
    const snapshot = await takeSnapshot(session.page);
    rememberSnapshot(session, snapshot);
    return attachShortcutsContext(snapshot, session.page.url(), sessionId);
  } catch (err: any) {
    return `ERROR: Snapshot failed: ${err.message}`;
  }
}

export async function browserNavigateControl(
  sessionId: string,
  payload: { action?: 'back' | 'forward' | 'reload' | 'open'; url?: string },
): Promise<{
  sessionId: string;
  active: boolean;
  url: string;
  title: string;
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  streamActive: boolean;
  streamTransport: 'cdp' | 'snapshot' | '';
  streamFocus: BrowserLiveStreamFocus;
  source: 'user';
  statusLabel: string;
  frameBase64: string;
  frameWidth: number;
  frameHeight: number;
  frameFormat: 'png';
  timestamp: number;
}> {
  const resolved = resolveSessionId(sessionId);
  const session = await getOrCreateSession(resolved, {
    url: String(payload?.url || '').trim(),
  });
  const action = String(payload?.action || '').trim().toLowerCase();
  const liveStream = browserLiveStreams.get(resolved);
  const actionLabel = action === 'back'
    ? 'Went back'
    : action === 'forward'
      ? 'Went forward'
      : action === 'reload'
        ? 'Reloaded page'
        : 'Opened page';
  if (!['back', 'forward', 'reload', 'open'].includes(action)) {
    throw new Error(`Unsupported browser navigation action "${action || 'unknown'}".`);
  }
  await emitBrowserAgentCursor(resolved, { kind: 'navigate', phase: 'start', label: actionLabel });
  if (action === 'back') {
    await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
  } else if (action === 'forward') {
    await session.page.goForward({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
  } else if (action === 'reload') {
    await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  } else {
    let targetUrl = String(payload?.url || '').trim();
    if (!targetUrl) throw new Error('Open requires a URL.');
    if (!/^[a-z][a-z0-9+.-]*:/i.test(targetUrl)) targetUrl = `https://${targetUrl}`;
    await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  }
  await session.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await session.page.waitForTimeout(350).catch(() => {});
  const meta = await syncPageMetadata(session).catch(() => ({ url: session.page.url(), title: '' } as any));
  await emitBrowserAgentCursor(resolved, { kind: 'navigate', phase: 'end', label: meta?.url || session.page.url() });
  const shot = await browserVisionScreenshot(resolved).catch(() => null);
  const interactionState = getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved));
  return {
    sessionId: resolved,
    active: true,
    url: String(meta?.url || session.page.url() || ''),
    title: String(meta?.title || await session.page.title().catch(() => '') || ''),
    mode: interactionState.mode,
    captured: interactionState.captured,
    controlOwner: interactionState.controlOwner,
    streamActive: liveStream?.active === true,
    streamTransport: liveStream?.transport || '',
    streamFocus: liveStream?.focus || 'passive',
    source: 'user',
    statusLabel: `${actionLabel}.`,
    frameBase64: String(shot?.base64 || ''),
    frameWidth: Number(shot?.width || 0),
    frameHeight: Number(shot?.height || 0),
    frameFormat: 'png',
    timestamp: Date.now(),
  };
}

export async function browserClick(
  sessionId: string,
  target: number | { ref?: number; element?: string; selector?: string },
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const requestedElement = typeof target === 'object' && target !== null ? String(target.element || '').trim() : '';
  const requestedSelector = typeof target === 'object' && target !== null ? String(target.selector || '').trim() : '';
  const requestedRef = typeof target === 'number'
    ? Number(target)
    : Number((target && typeof target === 'object' ? target.ref : 0) || 0);
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_click');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    if (requestedSelector) {
      const cursorPoint = await resolveSelectorViewportCenter(session.page, requestedSelector, `selector "${requestedSelector}"`);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'start' });
      const el = await clickBySelector(session.page, requestedSelector);
      await session.page.waitForTimeout(500);
      await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'click', phase: 'end', label: cursorPoint?.label || `Clicked selector "${requestedSelector}"` });
      if (shouldReturnSnapshot(observeMode)) {
        const snapshot = await takeSnapshot(session.page);
        rememberSnapshot(session, snapshot);
        return attachShortcutsContext(
          `Clicked selector "${requestedSelector}" (${el.role}: "${el.name}")\n\n${snapshot}`,
          session.page.url(),
          sessionId,
        );
      }
      if (compactBefore) {
        return buildCompactBrowserObservation(
          session,
          `Clicked selector "${requestedSelector}" (${el.role}: "${el.name}").`,
          compactBefore,
        );
      }
      return buildMinimalBrowserAck(session, `Clicked selector "${requestedSelector}" (${el.role}: "${el.name}").`);
    }
    if (requestedElement) {
      const resolvedElement = await resolveNamedBrowserElement(sessionId, requestedElement);
      if (!resolvedElement) {
        const available = listNamedBrowserElementsForUrl(session.page.url()).map((entry) => entry.name).slice(0, 12);
        const suffix = available.length
          ? ` Available saved elements for this site: ${available.join(', ')}.`
          : ' No saved elements exist for this site yet.';
        return attachShortcutsContext(
          `ERROR: Could not resolve a saved browser element named "${requestedElement}".${suffix}`,
          session.page.url(),
          sessionId,
        );
      }
      const cursorPoint = await resolveSelectorViewportCenter(session.page, resolvedElement.selector, `saved element "${resolvedElement.entry.name}"`);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'start' });
      const el = await clickBySelector(session.page, resolvedElement.selector);
      await session.page.waitForTimeout(500);
      await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'click', phase: 'end', label: cursorPoint?.label || `Clicked saved element "${resolvedElement.entry.name}"` });
      if (shouldReturnSnapshot(observeMode)) {
        const snapshot = await takeSnapshot(session.page);
        rememberSnapshot(session, snapshot);
        return attachShortcutsContext(
          `Clicked saved element "${resolvedElement.entry.name}" (${el.role}: "${el.name}")\n\n${snapshot}`,
          session.page.url(),
          sessionId,
        );
      }
      if (compactBefore) {
        return buildCompactBrowserObservation(
          session,
          `Clicked saved element "${resolvedElement.entry.name}" (${el.role}: "${el.name}").`,
          compactBefore,
        );
      }
      return buildMinimalBrowserAck(session, `Clicked saved element "${resolvedElement.entry.name}" (${el.role}: "${el.name}").`);
    }
    if (!Number.isFinite(requestedRef) || requestedRef <= 0) {
      return 'ERROR: browser_click requires ref, element, or selector.';
    }
    const cursorPoint = await resolveViewportPointFromTarget(session.page, { ref: requestedRef }, 'browser_click').catch(() => null);
    if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'start' });
    const el = await clickByRef(session.page, requestedRef);
    // Extra settle before snapshot — dialogs / dropdowns / navigation need time
    await session.page.waitForTimeout(500);
    await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'click', phase: 'end', label: cursorPoint?.label || `Clicked @${requestedRef}` });
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      return attachShortcutsContext(`Clicked @${requestedRef} (${el.role}: "${el.name}")\n\n${snapshot}`, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Clicked @${requestedRef} (${el.role}: "${el.name}").`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Clicked @${requestedRef} (${el.role}: "${el.name}").`);
  } catch (err: any) {
    if (requestedSelector) {
      return attachShortcutsContext(`ERROR: Click selector "${requestedSelector}" failed: ${err.message}`, session.page.url(), sessionId);
    }
    return requestedElement
      ? attachShortcutsContext(`ERROR: Click "${requestedElement}" failed: ${err.message}`, session.page.url(), sessionId)
      : `ERROR: Click @${requestedRef} failed: ${err.message}`;
  }
}

export async function browserFill(
  sessionId: string,
  target: number | { ref?: number; element?: string; selector?: string },
  text: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const requestedElement = typeof target === 'object' && target !== null ? String(target.element || '').trim() : '';
  const requestedSelector = typeof target === 'object' && target !== null ? String(target.selector || '').trim() : '';
  const requestedRef = typeof target === 'number'
    ? Number(target)
    : Number((target && typeof target === 'object' ? target.ref : 0) || 0);
  try {
    let el: { role: string; name: string; needsNativeType?: boolean };
    let submitHint: { ref: number; label: string; strategy: string } | null = null;
    let resultLabel = '';
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_fill');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;

    if (requestedSelector) {
      const cursorPoint = await resolveSelectorViewportCenter(session.page, requestedSelector, `selector "${requestedSelector}"`);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'start' });
      el = await fillBySelector(session.page, requestedSelector, text);
      await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'fill', phase: 'end', label: cursorPoint?.label || `Filled selector "${requestedSelector}"` });
      resultLabel = `selector "${requestedSelector}"`;
    } else if (requestedElement) {
      const resolvedElement = await resolveNamedBrowserElement(sessionId, requestedElement);
      if (!resolvedElement) {
        const available = listNamedBrowserElementsForUrl(session.page.url()).map((entry) => entry.name).slice(0, 12);
        const suffix = available.length
          ? ` Available saved elements for this site: ${available.join(', ')}.`
          : ' No saved elements exist for this site yet.';
        return attachShortcutsContext(
          `ERROR: Could not resolve a saved browser element named "${requestedElement}".${suffix}`,
          session.page.url(),
          sessionId,
        );
      }
      const cursorPoint = await resolveSelectorViewportCenter(session.page, resolvedElement.selector, `saved element "${resolvedElement.entry.name}"`);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'start' });
      el = await fillBySelector(session.page, resolvedElement.selector, text);
      await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'fill', phase: 'end', label: cursorPoint?.label || `Filled saved element "${resolvedElement.entry.name}"` });
      resultLabel = `saved element "${resolvedElement.entry.name}"`;
    } else {
      if (!Number.isFinite(requestedRef) || requestedRef <= 0) {
        return 'ERROR: browser_fill requires ref, element, or selector, plus text.';
      }
      const cursorPoint = await resolveViewportPointFromTarget(session.page, { ref: requestedRef }, 'browser_fill').catch(() => null);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'start' });
      el = await fillByRef(session.page, requestedRef, text);
      await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'fill', phase: 'end', label: cursorPoint?.label || `Filled @${requestedRef}` });
      resultLabel = `@${requestedRef}`;

      // After filling, find the submit button closest to the filled element in the DOM.
      // This lets us annotate the snapshot so the model clicks the RIGHT Post button
      // (the composer's) and not a Post button elsewhere on the page (e.g. in the feed).
      // Find the Post/Tweet submit button ref after filling.
      // Strategy: use X.com's stable data-testid first, then fall back to DOM walk.
      // We recount refs using the same filter logic as takeSnapshot to get the correct number.
      submitHint = await session.page.evaluate((args: { ref: number; sel: string }) => {
        const doc = (globalThis as any).document as any;
        const openModal: any = (
          doc.querySelector('[role="dialog"][aria-modal="true"]')
          || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
          || doc.querySelector('dialog[open]')
          || doc.querySelector('[data-testid="Dropdown"]')
          || doc.querySelector('[role="menu"]')
          || null
        );
        const searchRoot: any = openModal || doc.documentElement;

        // Build the same visible-element list as takeSnapshot so ref numbers match exactly
        const isVisible = (e: any): boolean => {
          const r = typeof e.getBoundingClientRect === 'function' ? e.getBoundingClientRect() : null;
          if (!r || (r.width === 0 && r.height === 0)) return false;
          const style = typeof (globalThis as any).getComputedStyle === 'function' ? (globalThis as any).getComputedStyle(e) : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
          return true;
        };
        const seen = new Set<any>();
        const all: any[] = [];
        for (const e of Array.from(searchRoot.querySelectorAll(args.sel))) {
          if (!seen.has(e)) { seen.add(e); all.push(e); }
        }
        // Filter same way as takeSnapshot
        const visible = all.filter((e: any) => {
          const tag = e.tagName.toLowerCase();
          const role = (e.getAttribute('role') || '').toLowerCase();
          const ce = e.getAttribute('contenteditable') === 'true';
          const isInput = ['input', 'textarea', 'select'].includes(tag) || ce || ['textbox', 'searchbox', 'combobox'].includes(role);
          const name = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.getAttribute('data-testid') || '').trim().slice(0, 80) || (ce ? 'editable' : '');
          if (!name && !isInput) return false;
          return isVisible(e);
        });

        // Strategy 1: X.com stable testid — tweetButtonInline is the in-timeline composer Post button
        const xPostBtn = doc.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
        if (xPostBtn && isVisible(xPostBtn)) {
          const btnRef = visible.indexOf(xPostBtn) + 1;
          if (btnRef > 0) {
            const label = (xPostBtn.getAttribute('aria-label') || xPostBtn.innerText || 'Post').trim();
            return { ref: btnRef, label, strategy: 'testid' };
          }
        }

        // Strategy 2: Find filled element, walk up DOM to find Post/Tweet button ancestor
        let filledEl: any = null;
        for (let i = 0; i < visible.length; i++) {
          if (i + 1 === args.ref) { filledEl = visible[i]; break; }
        }
        if (!filledEl) return null;

        let ancestor: any = filledEl.parentElement;
        const MAX_DEPTH = 14;
        for (let d = 0; d < MAX_DEPTH && ancestor; d++) {
          const buttons = Array.from(ancestor.querySelectorAll('button, [role="button"]')) as any[];
          for (const btn of buttons) {
            const label = (btn.getAttribute('aria-label') || btn.innerText || '').trim();
            if (/^(post|tweet)$/i.test(label) && isVisible(btn)) {
              const btnRef = visible.indexOf(btn) + 1;
              if (btnRef > 0) return { ref: btnRef, label, strategy: 'walk' };
            }
          }
          ancestor = ancestor.parentElement;
        }
        return null;
      }, { ref: requestedRef, sel: INTERACTIVE_SELECTOR }).catch(() => null);
    }

    if (observeMode !== 'none') {
      await broadcastBrowserViewportUpdate(
        sessionId,
        session,
        'browser_fill',
        `Filled ${el.role}: "${String(el.name || '').slice(0, 60)}"`,
      );
    }

    // ── X.com composer: click Post button directly after a contenteditable fill ──
    // The ref-based hint is unreliable because X renders multiple "Post"-labelled
    // buttons (inline composer + toolbar) and the wrong one gets picked.
    // Strategy: try stable testids in order, fall back to text match.
    // We do this HERE so the model never has to guess the ref.
    if ((el as any).needsNativeType === true) {
      // Only auto-submit for contenteditable fills (the X.com composer case)
      const xPostSelectors = [
        '[data-testid="tweetButtonInline"]',   // home feed inline composer
        '[data-testid="tweetButton"]',          // full /compose modal
      ];
      let clicked = false;
      for (const sel of xPostSelectors) {
        try {
          const btn = session.page.locator(sel).first();
          if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
            await btn.click();
            clicked = true;
            console.log(`[Browser] Auto-clicked Post button via ${sel}`);
            break;
          }
        } catch { /* try next */ }
      }
      if (clicked) {
        // Wait for post to submit and feed to update
        await session.page.waitForTimeout(2000);
        await session.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        if (shouldReturnSnapshot(observeMode)) {
          const afterSnapshot = await takeSnapshot(session.page);
          rememberSnapshot(session, afterSnapshot);
          return attachShortcutsContext(
            `Filled composer and clicked Post button. Tweet has been posted successfully. Snapshot refreshed (${parseSnapshotElementCount(afterSnapshot)} elements).`,
            session.page.url(),
            sessionId,
          );
        }
        if (compactBefore) {
          return buildCompactBrowserObservation(session, 'Filled composer and clicked Post button.', compactBefore);
        }
        return buildMinimalBrowserAck(session, 'Filled composer and clicked Post button.');
      }
    }

    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      let snapshotResult = `Filled ${resultLabel} (${el.role}: "${el.name}") with "${text.slice(0, 50)}". Snapshot refreshed (${parseSnapshotElementCount(snapshot)} elements).`;
      if (submitHint) {
        snapshotResult += ` Submit hint: click @${submitHint.ref} ("${submitHint.label}").`;
      }
      return attachShortcutsContext(snapshotResult, session.page.url(), sessionId);
    }

    let result = `Filled ${resultLabel} (${el.role}: "${el.name}") with "${text.slice(0, 50)}".`;
    if (submitHint) {
      result += ` Submit hint: click @${submitHint.ref} ("${submitHint.label}").`;
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, result, compactBefore);
    }
    return buildMinimalBrowserAck(session, result);
  } catch (err: any) {
    if (requestedSelector) {
      return attachShortcutsContext(`ERROR: Fill selector "${requestedSelector}" failed: ${err.message}`, session.page.url(), sessionId);
    }
    return requestedElement
      ? attachShortcutsContext(`ERROR: Fill "${requestedElement}" failed: ${err.message}`, session.page.url(), sessionId)
      : `ERROR: Fill @${requestedRef} failed: ${err.message}`;
  }
}

export async function browserUploadFile(
  sessionId: string,
  options: {
    ref?: number;
    selector?: string;
    file_path?: string;
    file_paths?: string[];
    observe?: BrowserObserveMode;
  },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const observeMode = options.observe || resolveBrowserObserveMode('browser_upload_file');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const uploadPaths = toUploadPaths(options.file_path, options.file_paths);
    if (!uploadPaths.length) return 'ERROR: file_path or file_paths is required.';
    for (const uploadPath of uploadPaths) {
      if (!fs.existsSync(uploadPath)) return `ERROR: Upload file not found: ${uploadPath}`;
    }

    let target: any = null;
    if (options.selector) {
      target = session.page.locator(String(options.selector)).first();
      if (!(await target.count())) {
        return `ERROR: No file input found for selector "${options.selector}".`;
      }
    } else if (Number.isFinite(Number(options.ref)) && Number(options.ref) > 0) {
      const handle = await session.page.evaluateHandle((args: { ref: number; sel: string }) => {
        const doc = (globalThis as any).document;
        const direct = doc.querySelector(`[data-sc-ref="${args.ref}"]`);
        if (direct) return direct;
        const openModal = doc.querySelector('[role="dialog"][aria-modal="true"]')
          || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
          || doc.querySelector('dialog[open]')
          || doc.querySelector('[role="menu"]')
          || null;
        const searchRoot = openModal || doc;
        let counter = 0;
        for (const el of Array.from(searchRoot.querySelectorAll(args.sel)) as any[]) {
          const tag = el.tagName.toLowerCase();
          const role = (el.getAttribute('role') || '').toLowerCase();
          const isInput = ['input', 'textarea', 'select'].includes(tag) || ['textbox', 'searchbox', 'combobox'].includes(role);
          const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80);
          if (!name && !isInput) continue;
          const rect = el.getBoundingClientRect?.();
          if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0 && rect.height === 0)) continue;
          const style = (globalThis as any).getComputedStyle?.(el);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
          counter += 1;
          if (counter === args.ref) return el;
        }
        return null;
      }, { ref: Number(options.ref), sel: INTERACTIVE_SELECTOR });
      const element = handle.asElement();
      if (!element) return `ERROR: Element @${options.ref} not found.`;
      const nestedInput = await element.$('input[type="file"]');
      target = nestedInput || element;
    } else {
      return 'ERROR: browser_upload_file requires ref or selector.';
    }

    const typeAttr = String((await target.getAttribute('type').catch(() => '')) || '').toLowerCase();
    const tagName = String((await target.evaluate((el: any) => el.tagName.toLowerCase()).catch(() => '')) || '').toLowerCase();
    if (!(tagName === 'input' && typeAttr === 'file')) {
      const nested = await target.locator('input[type="file"]').first();
      if (await nested.count()) {
        target = nested;
      } else {
        return 'ERROR: Target element is not an <input type="file">. Pass the file input selector directly.';
      }
    }

    await target.setInputFiles(uploadPaths);
    await session.page.waitForTimeout(700);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      return attachShortcutsContext(
        `Uploaded ${uploadPaths.length} file(s): ${uploadPaths.map((p) => path.basename(p)).join(', ')}.\n\n${snapshot}`,
        session.page.url(),
        sessionId,
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(
        session,
        `Uploaded ${uploadPaths.length} file(s): ${uploadPaths.map((p) => path.basename(p)).join(', ')}.`,
        compactBefore,
      );
    }
    return buildMinimalBrowserAck(session, `Uploaded ${uploadPaths.length} file(s): ${uploadPaths.map((p) => path.basename(p)).join(', ')}.`);
  } catch (err: any) {
    return `ERROR: browser_upload_file failed: ${err.message}`;
  }
}

export async function browserClickAndDownload(
  sessionId: string,
  ref: number,
  options?: { timeout_ms?: number; filename_hint?: string; output_dir?: string; observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const timeoutMs = Math.min(Math.max(Number(options?.timeout_ms || 15000), 1000), 120000);
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_click_and_download');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const downloadPromise = session.page.waitForEvent('download', { timeout: timeoutMs });
    const clicked = await clickByRef(session.page, ref);
    const download = await downloadPromise;
    const saved = await persistBrowserDownload(sessionId, download, options);
    if (shouldReturnSnapshot(observeMode)) {
      await session.page.waitForTimeout(400).catch(() => {});
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      return attachShortcutsContext(
        `Clicked @${ref} (${clicked.role}: "${clicked.name}") and saved download to ${saved.relPath} (${saved.sizeBytes} bytes).\n\n${snapshot}`,
        session.page.url(),
        sessionId,
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(
        session,
        `Clicked @${ref} (${clicked.role}: "${clicked.name}") and saved download to ${saved.relPath} (${saved.sizeBytes} bytes).`,
        compactBefore,
      );
    }
    return buildMinimalBrowserAck(session, `Clicked @${ref} (${clicked.role}: "${clicked.name}") and saved download to ${saved.relPath} (${saved.sizeBytes} bytes).`);
  } catch (err: any) {
    return `ERROR: browser_click_and_download failed: ${err.message}`;
  }
}

export async function browserPressKey(
  sessionId: string,
  key: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_press_key');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const cursorPoint = await resolveActiveElementViewportCenter(session.page).catch(() => null);
    await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'key', phase: 'start', label: key });
    await pressKey(session.page, key);
    // Best-effort networkidle after key press (Enter often triggers navigation)
    await session.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'key', phase: 'end', label: key });
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const count = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(`Pressed "${key}". Snapshot refreshed (${count} elements).`, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Pressed "${key}".`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Pressed "${key}".`);
  } catch (err: any) {
    return attachShortcutsContext(`ERROR: Key press failed: ${err.message}`, session.page.url(), sessionId);
  }
}

/**
 * Type text into whatever element currently has keyboard focus.
 * Unlike browserFill (which needs a @ref), this just sends keystrokes — works for
 * contenteditable divs (e.g. X/Twitter compose box) where fill by ref often fails.
 */
export async function browserType(sessionId: string, text: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const cursorPoint = await resolveActiveElementViewportCenter(session.page).catch(() => null);
    await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'type', phase: 'start', label: `Typing ${String(text || '').length} characters` });
    await session.page.keyboard.type(String(text || ''), { delay: 25 });
    await session.page.waitForTimeout(400);
    await emitBrowserAgentCursor(sessionId, { ...(cursorPoint || {}), kind: 'type', phase: 'end', label: `Typed ${String(text || '').length} characters` });
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    const count = parseSnapshotElementCount(snapshot);
    return attachShortcutsContext(`Typed ${String(text).length} chars into focused element. Snapshot refreshed (${count} elements).`, session.page.url(), sessionId);
  } catch (err: any) {
    return `ERROR: browser_type failed: ${err.message}`;
  }
}

export async function browserWait(
  sessionId: string,
  ms: number,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const clamped = Math.min(Math.max(ms || 1000, 500), 8000);
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_wait');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    await session.page.waitForTimeout(clamped);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const count = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(`Waited ${clamped}ms. Snapshot refreshed (${count} elements).`, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Waited ${clamped}ms.`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Waited ${clamped}ms.`);
  } catch (err: any) {
    return `ERROR: Wait failed: ${err.message}`;
  }
}

/**
 * Returns info about the currently keyboard-focused element on the page.
 * Critical for navigation shortcuts (j/k on X.com) — tells the AI which tweet/item
 * is currently selected so it knows how many more presses are needed.
 */
export async function browserGetFocusedItem(sessionId: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const info = await session.page.evaluate(() => {
      const doc = (globalThis as any).document;
      const focused = doc.activeElement;
      if (!focused || focused === doc.body) {
        // On X.com, keyboard-focused tweet has data-testid="tweet" and a CSS highlight class
        // Check for X.com highlighted/focused tweet (has outline or aria-selected)
        const highlighted = doc.querySelector(
          'article[data-testid="tweet"][tabindex="0"], article[data-testid="tweet"]:focus-within'
        );
        if (highlighted) {
          const tweetText = (highlighted.querySelector('[data-testid="tweetText"]') as any)?.innerText?.trim()?.slice(0, 120) || '';
          const author = (highlighted.querySelector('[data-testid="User-Name"]') as any)?.innerText?.trim()?.replace(/\n/g, ' ')?.slice(0, 60) || '';
          const link = (highlighted.querySelector('a[href*="/status/"]') as any)?.href || '';
          const idMatch = link.match(/\/status\/(\d+)/);
          // Count position in feed
          const allTweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
          const idx = allTweets.indexOf(highlighted);
          return {
            type: 'tweet',
            position: idx + 1,
            totalVisible: allTweets.length,
            author,
            text: tweetText,
            tweetId: idMatch ? idMatch[1] : '',
            link,
          };
        }
        return { type: 'none', message: 'No element focused. Press j to select first tweet, or click a tweet first.' };
      }

      const tag = focused.tagName?.toLowerCase() || 'unknown';
      const role = focused.getAttribute('role') || '';
      const ariaLabel = focused.getAttribute('aria-label') || '';
      const text = (focused.innerText || '').trim().slice(0, 120);
      const testId = focused.getAttribute('data-testid') || '';

      // Check if this focused element is inside a tweet — find the ancestor article
      let article: any = focused;
      while (article && article.tagName?.toLowerCase() !== 'article') {
        article = article.parentElement;
      }
      if (article && article.getAttribute('data-testid') === 'tweet') {
        const tweetText = (article.querySelector('[data-testid="tweetText"]') as any)?.innerText?.trim()?.slice(0, 120) || '';
        const author = (article.querySelector('[data-testid="User-Name"]') as any)?.innerText?.trim()?.replace(/\n/g, ' ')?.slice(0, 60) || '';
        const link = (article.querySelector('a[href*="/status/"]') as any)?.href || '';
        const idMatch = link.match(/\/status\/(\d+)/);
        const allTweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
        const idx = allTweets.indexOf(article);
        return {
          type: 'tweet',
          position: idx + 1,
          totalVisible: allTweets.length,
          author,
          text: tweetText,
          tweetId: idMatch ? idMatch[1] : '',
          link,
          focusedElement: { tag, role, ariaLabel, testId },
        };
      }

      return {
        type: 'element',
        tag,
        role,
        ariaLabel,
        text,
        testId,
      };
    });

    if (info.type === 'tweet') {
      const lines = [
        `⌨️ KEYBOARD FOCUS: Tweet #${info.position} of ${info.totalVisible} visible`,
        `   Author: ${info.author || '(unknown)'}`,
        `   Text: ${info.text ? info.text.slice(0, 100) : '(no text)'}`,
        info.tweetId ? `   Tweet ID: ${info.tweetId}` : '',
        info.link ? `   Link: ${info.link}` : '',
        ``,
        `NAVIGATION HINT: To reach tweet #N, press j a total of N times from no selection, or adjust from current position.`,
        `Current position is #${info.position}. Press j to go forward, k to go back.`,
      ].filter(Boolean);
      return lines.join('\n');
    }

    if (info.type === 'none') {
      return `⌨️ KEYBOARD FOCUS: No tweet selected\n${info.message}`;
    }

    return `⌨️ KEYBOARD FOCUS: ${info.type} — <${info.tag}> role="${info.role}" label="${info.ariaLabel}" text="${info.text?.slice(0,80)}" testid="${info.testId}"`;
  } catch (err: any) {
    return `ERROR: getFocusedItem failed: ${err.message}`;
  }
}

export async function browserClose(sessionId: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return 'No browser session to close.';
  const persistedSessionId = String(session.sessionId || resolved || '').trim();
  try {
    await stopBrowserLiveStream(resolved, 'Live browser stream stopped because the browser tab closed.').catch(() => {});
    await session.page.close();
    if (session.ownsBrowser) {
      try { await session.browser.close(); } catch {}
    }
    sessions.delete(resolved);
    if (resolved !== sessionId) sessions.delete(sessionId);
    clearBrowserInteractionState(resolved);
    browserSessionMetadata.delete(resolved);
    removePersistedBrowserSessionRecord(persistedSessionId);
    console.log(`[Browser] Session closed for ${sessionId}`);
    return 'Browser tab closed.';
  } catch (err: any) {
    await stopBrowserLiveStream(resolved, 'Live browser stream stopped because the browser tab closed.').catch(() => {});
    sessions.delete(resolved);
    if (resolved !== sessionId) sessions.delete(sessionId);
    clearBrowserInteractionState(resolved);
    browserSessionMetadata.delete(resolved);
    removePersistedBrowserSessionRecord(persistedSessionId);
    return `Browser closed (with warning: ${err.message})`;
  }
}

export async function browserScroll(
  sessionId: string,
  direction: 'down' | 'up',
  multiplier?: number,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const clampedMult = Math.min(Math.max(multiplier || 1.0, 0.5), 4.0);

  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_scroll');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const viewport = getBrowserViewportSize(session);
    await emitBrowserAgentCursor(sessionId, {
      x: Math.round(viewport.width / 2),
      y: Math.round(viewport.height * 0.72),
      kind: 'scroll',
      phase: 'start',
      label: `Scroll ${direction}`,
    });
    await session.page.evaluate((mult: number) => {
      const pageGlobal = globalThis as any;
      pageGlobal.scrollBy(0, pageGlobal.innerHeight * mult);
    }, direction === 'up' ? -clampedMult : clampedMult);

    await session.page.waitForTimeout(1200); // X/Twitter needs ~1s for new articles to mount
    await emitBrowserAgentCursor(sessionId, {
      x: Math.round(viewport.width / 2),
      y: Math.round(viewport.height * 0.72),
      kind: 'scroll',
      phase: 'end',
      label: `Scrolled ${direction}`,
    });

    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const elementCount = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(
        `Scrolled ${direction} ${clampedMult}x viewport. ` +
        `Snapshot refreshed (${elementCount} elements). ` +
        `Use browser_snapshot only if you need fresh @ref interactions.`,
        session.page.url(),
        sessionId,
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Scrolled ${direction} ${clampedMult}x viewport.`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Scrolled ${direction} ${clampedMult}x viewport.`);
  } catch (err: any) {
    return `ERROR: Scroll failed: ${err.message}`;
  }
}

function browserFeedItemKey(item: BrowserFeedItem): string {
  return String(
    item.id
    || item.link
    || `${item.source || ''}|${item.handle || ''}|${item.author || ''}|${item.title || ''}|${item.text || item.snippet || ''}`,
  ).replace(/\s+/g, ' ').trim().toLowerCase();
}

function textBlockKey(text: string): string {
  return stableHash(String(text || '').replace(/\s+/g, ' ').trim().slice(0, 900));
}

function appendUniqueBrowserFeedItems(
  target: BrowserFeedItem[],
  seen: Set<string>,
  items: BrowserFeedItem[],
  limit: number,
): number {
  let added = 0;
  for (const item of items) {
    const key = browserFeedItemKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(item);
    added += 1;
    if (target.length >= limit) break;
  }
  return added;
}

function appendUniqueTextBlocks(
  target: string[],
  seen: Set<string>,
  blocks: string[],
  limit: number,
): number {
  let added = 0;
  for (const block of blocks) {
    const text = String(block || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = textBlockKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(text);
    added += 1;
    if (target.length >= limit) break;
  }
  return added;
}

function buildBrowserSnapshotDelta(
  prevSnapshot: string,
  newSnapshot: string,
  pass: number,
  scrollY: number,
): BrowserScrollSnapshotDelta {
  const toElemSet = (snap: string) => new Set(
    String(snap || '').split('\n').filter((line) => /@\d+/.test(line)).slice(0, 400),
  );
  const prevSet = toElemSet(prevSnapshot);
  const newSet = toElemSet(newSnapshot);
  return {
    pass,
    scrollY,
    added: [...newSet].filter((line) => !prevSet.has(line)).slice(0, 80),
    removed: [...prevSet].filter((line) => !newSet.has(line)).slice(0, 80),
    totalElements: newSet.size,
  };
}

export async function browserDrag(
  sessionId: string,
  options: {
    from_ref?: number;
    to_ref?: number;
    from_x?: number;
    from_y?: number;
    to_x?: number;
    to_y?: number;
    steps?: number;
    observe?: BrowserObserveMode;
  } = {},
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const observeMode = options.observe || resolveBrowserObserveMode('browser_drag');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const start = await resolveViewportPointFromTarget(session.page, {
      ref: options.from_ref,
      x: options.from_x,
      y: options.from_y,
    }, 'browser_drag start');
    const end = await resolveViewportPointFromTarget(session.page, {
      ref: options.to_ref,
      x: options.to_x,
      y: options.to_y,
    }, 'browser_drag end');
    const steps = Math.max(2, Math.min(80, Math.floor(Number(options.steps) || 20)));

    await session.page.mouse.move(start.x, start.y);
    await session.page.mouse.down();
    await session.page.mouse.move(end.x, end.y, { steps });
    await session.page.mouse.up();
    await session.page.waitForTimeout(700);

    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const elementCount = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(
        `Dragged from ${start.label} to ${end.label} in ${steps} step(s). Snapshot refreshed (${elementCount} elements).`,
        session.page.url(),
        sessionId,
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Dragged from ${start.label} to ${end.label} in ${steps} step(s).`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Dragged from ${start.label} to ${end.label} in ${steps} step(s).`);
  } catch (err: any) {
    return `ERROR: browser_drag failed: ${err.message}`;
  }
}

export async function browserScrollCollect(
  sessionId: string,
  options: {
    scrolls?: number;
    direction?: 'down' | 'up';
    multiplier?: number;
    delay_ms?: number;
    stop_text?: string;
    max_chars?: number;
    include_initial?: boolean;
    max_seconds?: number;
    stop_after_no_new?: number;
    include_snapshots?: boolean;
    include_structured?: boolean;
  } = {}
): Promise<string> {
  const resolvedSessionId = resolveSessionId(sessionId);
  const session = sessions.get(resolvedSessionId);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const scrolls   = Math.min(Math.max(options.scrolls || 5, 1), 30);
  const direction  = options.direction || 'down';
  const mult       = Math.min(Math.max(options.multiplier || 1.5, 0.5), 4.0);
  const delayMs    = Math.min(Math.max(options.delay_ms || 1500, 500), 5000);
  const stopText   = options.stop_text || '';
  const maxChars   = Math.min(Math.max(options.max_chars || 50000, 5000), 100000);
  const includeInitial = options.include_initial !== false;
  const maxSeconds = Math.min(Math.max(Number(options.max_seconds || 45) || 45, 5), 180);
  const stopAfterNoNew = Math.min(Math.max(Number(options.stop_after_no_new || 3) || 3, 1), 10);
  const includeSnapshots = options.include_snapshots !== false;
  const includeStructured = options.include_structured !== false;

  const seenLines  = new Set<string>();
  const allNewText: string[] = [];
  const scrollLog: string[]  = [];
  const structuredItems: BrowserFeedItem[] = [];
  const structuredTextBlocks: string[] = [];
  const snapshotDeltas: BrowserScrollSnapshotDelta[] = [];
  const seenStructuredItems = new Set<string>();
  const seenTextBlocks = new Set<string>();
  let totalChars   = 0;
  let stopReason   = 'completed all scrolls';
  let consecutiveNoNew = 0;
  const startedAt = Date.now();

  try {
    const totalPasses = includeInitial ? scrolls + 1 : scrolls;
    let previousSnapshot = includeSnapshots ? await takeSnapshot(session.page, 120).catch(() => '') : '';
    if (previousSnapshot) rememberSnapshot(session, previousSnapshot);
    for (let pass = 0; pass < totalPasses; pass++) {
      const isInitialPass = includeInitial && pass === 0;
      const prevScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      if (!isInitialPass) {
        // Scroll
        await session.page.evaluate((m: number) => {
          (globalThis as any).scrollBy(0, (globalThis as any).innerHeight * m);
        }, direction === 'up' ? -mult : mult);

        // Wait for content to load
        await session.page.waitForTimeout(delayMs);
      }

      // Read visible text — with structured extraction for X.com/Twitter
      const pageText = await session.page.evaluate(() => {
        const doc = (globalThis as any).document;
        const normalize = (value: any, maxLen: number = 1000) =>
          String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
        const toAbs = (href: string) => {
          try { return new URL(href, (globalThis as any).location.href).toString(); } catch { return String(href || '').trim(); }
        };
        // X.com structured tweet extraction
        const tweetEls = doc.querySelectorAll('article[data-testid="tweet"]');
        if (tweetEls.length > 0) {
          return Array.from(tweetEls).map((el: any) => {
            const nameBlock = normalize(el.querySelector('[data-testid="User-Name"]')?.innerText, 240);
            const text = String(el.querySelector('[data-testid="tweetText"]')?.innerText || '').trim();
            const statusLink = Array.from(el.querySelectorAll('a[href*="/status/"]'))
              .map((a: any) => toAbs(a.getAttribute('href') || a.href || ''))
              .find((href: string) => /\/status\/\d+/i.test(href)) || '';
            const time = (el.querySelector('time') as any)?.dateTime || normalize(el.querySelector('time')?.textContent, 80);
            const replies = normalize(el.querySelector('[data-testid="reply"]')?.textContent, 40);
            const reposts = normalize(el.querySelector('[data-testid="retweet"]')?.textContent, 40);
            const likes = normalize(el.querySelector('[data-testid="like"]')?.textContent, 40);
            const views = normalize(el.querySelector('a[href$="/analytics"]')?.textContent, 40);
            const idMatch = statusLink.match(/\/status\/(\d+)/i);
            const lines = [
              idMatch ? `Tweet ID: ${idMatch[1]}` : '',
              nameBlock ? `Author: ${nameBlock}` : '',
              time ? `Time: ${time}` : '',
              statusLink ? `Link: ${statusLink}` : '',
              text ? `Text:\n${text}` : 'Text: (no visible text)',
              `Metrics: replies ${replies || '0'} | reposts ${reposts || '0'} | likes ${likes || '0'}${views ? ` | views ${views}` : ''}`,
            ].filter(Boolean);
            return lines.join('\n');
          }).join('\n---TWEET---\n');
        }
        // General fallback — use live body.innerText (not a detached clone)
        const body = doc.body;
        if (!body) return '';
        return (body.innerText || '')
          .replace(/[^\S\n]{3,}/g, ' ')
          .replace(/\n{4,}/g, '\n\n')
          .trim();
      });

      const currentScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      let structuredPageType: BrowserPageType | '' = '';
      let structuredAdded = 0;
      let textBlockAdded = 0;
      if (includeStructured) {
        const structured = await extractStructuredFromPage(session.page, 60).catch(() => null);
        if (structured) {
          structuredPageType = structured.pageType;
          structuredAdded = appendUniqueBrowserFeedItems(structuredItems, seenStructuredItems, structured.extractedFeed || [], 300);
          textBlockAdded = appendUniqueTextBlocks(structuredTextBlocks, seenTextBlocks, structured.textBlocks || [], 300);
          const fallbackPageText = String(structured.pageText || '').replace(/\s+/g, ' ').trim();
          if (fallbackPageText && fallbackPageText.length >= 80) {
            textBlockAdded += appendUniqueTextBlocks(structuredTextBlocks, seenTextBlocks, [fallbackPageText], 300);
          }
        }
      }

      if (includeSnapshots) {
        const nextSnapshot = await takeSnapshot(session.page, 120).catch(() => '');
        if (nextSnapshot) {
          if (previousSnapshot) {
            snapshotDeltas.push(buildBrowserSnapshotDelta(previousSnapshot, nextSnapshot, pass + 1, currentScrollY));
          }
          previousSnapshot = nextSnapshot;
          rememberSnapshot(session, nextSnapshot);
        }
      }

      // Deduplicate — structured tweets vs general lines
      const isStructuredTweets = pageText.includes('\n---TWEET---\n');
      const chunks = isStructuredTweets
        ? pageText.split('\n---TWEET---\n')
        : pageText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      const newLines: string[] = [];
      for (const chunk of chunks) {
        // For tweets, dedup by tweet text content; for lines, by first 200 chars
        const normalizedChunk = chunk.replace(/\s+/g, ' ').trim();
        const linkMatch = chunk.match(/^Link:\s*(.+)$/im);
        const idMatch = chunk.match(/^Tweet ID:\s*(\S+)/im);
        const key = isStructuredTweets
          ? (idMatch?.[1] ? `tweet:${idMatch[1]}` : linkMatch?.[1] ? `link:${linkMatch[1].trim()}` : normalizedChunk.slice(0, 400))
          : normalizedChunk.slice(0, 220);
        if (!seenLines.has(key)) {
          seenLines.add(key);
          newLines.push(chunk);
        }
      }

      const newText = isStructuredTweets ? newLines.join('\n---TWEET---\n') : newLines.join('\n');
      const newChars = newText.length;

      const newSignals = newChars + structuredAdded + textBlockAdded;
      consecutiveNoNew = newSignals > 0 ? 0 : consecutiveNoNew + 1;
      scrollLog.push(
        isInitialPass
          ? `  #${pass + 1}: initial viewport +${newChars.toLocaleString()} chars, +${structuredAdded} item(s), +${textBlockAdded} block(s)${structuredPageType ? `, type=${structuredPageType}` : ''}, scrollY=${currentScrollY}`
          : `  #${pass + 1}: scrolled ${direction} ${mult}x +${newChars.toLocaleString()} chars, +${structuredAdded} item(s), +${textBlockAdded} block(s)${structuredPageType ? `, type=${structuredPageType}` : ''}, scrollY=${currentScrollY}`
      );

      if (newChars > 0) {
        allNewText.push(newText);
        totalChars += newChars;
      }

      try {
        broadcastWS({
          type: 'browser:collect:progress',
          sessionId: resolvedSessionId,
          mode: isStructuredTweets ? 'x_text' : 'text',
          collected: seenLines.size,
          structuredItems: structuredItems.length,
          textBlocks: structuredTextBlocks.length,
          chars: totalChars,
          pass: pass + 1,
          maxPasses: totalPasses,
          stopReason,
          timestamp: Date.now(),
        });
      } catch {
        // Best-effort progress signal only.
      }

      // Early stop: max chars reached
      if (totalChars >= maxChars) {
        stopReason = 'max_chars reached';
        break;
      }

      if (Date.now() - startedAt >= maxSeconds * 1000) {
        stopReason = 'max_seconds reached';
        break;
      }

      // Early stop: page bottom (scroll position didn't change)
      if (!isInitialPass && currentScrollY === prevScrollY && direction === 'down') {
        scrollLog[scrollLog.length - 1] += ' — page bottom reached, stopping';
        stopReason = 'reached bottom';
        break;
      }

      if (!isInitialPass && consecutiveNoNew >= stopAfterNoNew) {
        stopReason = `no new text after ${consecutiveNoNew} pass(es)`;
        break;
      }

      // Early stop: sentinel text found
      if (stopText && pageText.includes(stopText)) {
        stopReason = `stop_text "${stopText}" found`;
        break;
      }
    }

    // Build result
    const collectedText = allNewText.join('\n\n').slice(0, maxChars);
    const scrollActions = includeInitial ? Math.max(0, scrollLog.length - 1) : scrollLog.length;
    const structuredPayload = {
      mode: 'browser_scroll_collect',
      url: session.page.url(),
      quality: {
        uniqueTextLines: seenLines.size,
        textChars: totalChars,
        structuredItems: structuredItems.length,
        textBlocks: structuredTextBlocks.length,
        snapshotDeltas: snapshotDeltas.length,
      },
      items: structuredItems.slice(0, 120),
      textBlocks: structuredTextBlocks.slice(0, 80),
      snapshot_deltas: snapshotDeltas.slice(-12),
    };
    const header = [
      `browser_scroll_collect: ${scrollLog.length} collection pass(es), ${scrollActions} scroll action(s) ${direction} (stopped: ${stopReason})`,
      `Total text collected: ${totalChars.toLocaleString()} chars | Unique lines: ${seenLines.size} | Structured items: ${structuredItems.length} | Text blocks: ${structuredTextBlocks.length}`,
      '',
    ].join('\n');

    const result = [
      header,
      '=== STRUCTURED COLLECTION (generic extractor) ===',
      JSON.stringify(structuredPayload, null, 2),
      '',
      '=== COLLECTED TEXT (deduplicated) ===',
      collectedText,
      '',
      '=== SCROLL LOG ===',
      ...scrollLog,
    ].join('\n');

    return result;

  } catch (err: any) {
    return `ERROR: browser_scroll_collect failed: ${err.message}`;
  }
}

export async function browserScrollCollectV2(
  sessionId: string,
  options: Record<string, any> = {},
): Promise<string> {
  const resolvedSessionId = resolveSessionId(sessionId);
  const session = sessions.get(resolvedSessionId);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const maxScrolls = Math.min(Math.max(Number(options.max_scrolls ?? options.scrolls ?? 8) || 8, 0), 40);
  const limit = Math.min(Math.max(Number(options.limit || 50) || 50, 1), 500);
  const direction: 'down' | 'up' = String(options.direction || 'down').trim().toLowerCase() === 'up' ? 'up' : 'down';
  const multiplier = Math.min(Math.max(Number(options.multiplier || 1.5) || 1.5, 0.5), 4.0);
  const delayMs = Math.min(Math.max(Number(options.delay_ms || 1200) || 1200, 250), 5000);
  const maxSeconds = Math.min(Math.max(Number(options.max_seconds || 30) || 30, 5), 180);
  const stopText = String(options.stop_text || '').trim();

  try {
    const schemaInput = options.schema && typeof options.schema === 'object'
      ? { ...(options.schema || {}), ...options }
      : { ...options };
    const resolved = resolveBrowserExtractionSchemaForUrl(session.page.url(), schemaInput);
    if (!resolved.schema) return `ERROR: ${resolved.error || 'Could not resolve extraction schema.'}`;

    const perPassLimit = Math.min(
      Math.max(
        Number(options.per_pass_limit || Math.max(resolved.schema.limit, Math.min(limit * 2, 120))) || Math.max(limit, 40),
        1,
      ),
      500,
    );

    const seenKeys = new Set<string>();
    const scrollLog: string[] = [];
    const items: Array<Record<string, any>> = [];
    let deduped = 0;
    let missingRequiredFields = 0;
    let stopReason = 'completed all passes';
    const startedAt = Date.now();

    for (let pass = 0; pass <= maxScrolls; pass++) {
      let prevScrollY = 0;
      if (pass > 0) {
        prevScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
        await session.page.evaluate((dir: 'down' | 'up', mult: number) => {
          const pageGlobal = globalThis as any;
          const distance = Number(pageGlobal.innerHeight || 0) * mult;
          pageGlobal.scrollBy(0, dir === 'up' ? -distance : distance);
        }, direction, multiplier);
        await session.page.waitForTimeout(delayMs);
      }

      const currentScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      const extracted = await extractStructuredItemsFromCurrentPage(session.page, resolved.schema, { limit: perPassLimit });
      let addedThisPass = 0;

      for (const entry of extracted) {
        const item = entry.item || {};
        const hasAnyValue = Object.values(item).some((value) => value != null && String(value).trim() !== '');
        if (!hasAnyValue) continue;

        const dedupeValue = resolved.schema.dedupeKey
          ? item[resolved.schema.dedupeKey]
          : null;
        const dedupeSource = dedupeValue != null && String(dedupeValue).trim() !== ''
          ? `${resolved.schema.dedupeKey}:${String(dedupeValue).trim().slice(0, 500)}`
          : entry.meta?.dedupeSource || JSON.stringify(item);
        const dedupeHash = stableHash(String(dedupeSource || '').slice(0, 1200));
        if (seenKeys.has(dedupeHash)) {
          deduped += 1;
          continue;
        }

        seenKeys.add(dedupeHash);
        items.push(item);
        missingRequiredFields += Number(entry.meta?.requiredMissing || 0) || 0;
        addedThisPass += 1;
        if (items.length >= limit) {
          stopReason = 'limit reached';
          break;
        }
      }

      scrollLog.push(
        pass === 0
          ? `#${pass + 1}: initial viewport -> +${addedThisPass} items (scrollY=${currentScrollY})`
          : `#${pass + 1}: scrolled ${direction} ${multiplier}x -> +${addedThisPass} items (scrollY=${currentScrollY})`,
      );

      try {
        broadcastWS({
          type: 'browser:collect:progress',
          sessionId: resolvedSessionId,
          mode: 'structured',
          schemaName: resolved.schema.requestedSchemaName || resolved.schema.saveAs || resolved.schema.name || '',
          itemRoot: resolved.schema.itemRootName || '',
          collected: items.length,
          deduped,
          pass: pass + 1,
          maxPasses: maxScrolls + 1,
          stopReason,
          timestamp: Date.now(),
        });
      } catch {
        // Best-effort progress signal only.
      }

      if (items.length >= limit) break;

      if (Date.now() - startedAt >= maxSeconds * 1000) {
        stopReason = 'max_seconds reached';
        break;
      }

      if (pass > 0 && direction === 'down' && currentScrollY === prevScrollY) {
        stopReason = 'reached bottom';
        break;
      }

      if (stopText) {
        const pageText = await session.page.evaluate(() => String((globalThis as any).document?.body?.innerText || ''));
        if (pageText.includes(stopText)) {
          stopReason = `stop_text "${stopText}" found`;
          break;
        }
      }
    }

    const saveName = String(resolved.schema.saveAs || '').trim();
    if (saveName) {
      const savedResult = saveNamedBrowserExtractionSchemaForUrl(session.page.url(), {
        name: saveName,
        aliases: resolved.schema.aliases,
        itemRoot: resolved.schema.itemRootName,
        containerSelector: resolved.schema.containerSelector,
        dedupeKey: resolved.schema.dedupeKey,
        limit: resolved.schema.limit,
        fields: resolved.schema.fields,
        url: session.page.url(),
      });
      broadcastBrowserKnowledgeSnapshot(resolvedSessionId, session.page.url(), savedResult.site, {
        action: 'saved_schema',
        savedKind: 'schema',
        saved: savedResult.saved,
      });
    }

    const requiredFieldCount = Object.values(resolved.schema.fields).filter((field) => field?.required === true).length;
    const completeness = requiredFieldCount > 0 && items.length > 0
      ? Math.max(0, 1 - (missingRequiredFields / Math.max(1, items.length * requiredFieldCount)))
      : (items.length > 0 ? 1 : 0);
    const retrieval = Math.min(1, items.length / Math.max(1, limit));
    const confidence = Number((((completeness * 0.7) + (retrieval * 0.3)) || 0).toFixed(2));

    const payload = {
      mode: 'browser_scroll_collect_v2',
      site: (() => {
        try {
          return String(new URL(session.page.url()).hostname || '').replace(/^www\./i, '').toLowerCase();
        } catch {
          return '';
        }
      })(),
      schema: {
        requested: resolved.schema.requestedSchemaName || '',
        source: resolved.schema.source,
        item_root: resolved.schema.itemRootName || '',
        container_selector: resolved.schema.containerSelector,
        dedupe_key: resolved.schema.dedupeKey || '',
        fields: Object.keys(resolved.schema.fields),
      },
      quality: {
        requested: limit,
        found: items.length,
        returned: items.length,
        missingRequiredFields,
        deduped,
        confidence,
      },
      scrollsPerformed: Math.max(0, scrollLog.length - 1),
      passesPerformed: scrollLog.length,
      stopReason,
      durationMs: Date.now() - startedAt,
      scrollLog,
      items,
    };

    return JSON.stringify(payload, null, 2);
  } catch (err: any) {
    return `ERROR: browser_scroll_collect_v2 failed: ${err.message}`;
  }
}

export async function getBrowserAdvisorPacket(
  sessionId: string,
  options?: { maxItems?: number; snapshotElements?: number },
): Promise<BrowserAdvisorPacket | null> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return null;
  try {
    return await buildAdvisorPacketForSession(session, options);
  } catch {
    return null;
  }
}

// ─── Tool Definitions (for Ollama) ─────────────────────────────────────────────

export function getBrowserToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'browser_open',
        description: 'Open a URL in a Playwright-controlled Chrome browser (NOT your regular Chrome or Edge). This is the ONLY correct way to open URLs for browser automation — NEVER use run_command to open chrome/edge, as those windows are invisible to all other browser tools. Always use browser_open first to establish a session before using browser_snapshot, browser_click, etc. Returns a compact ack unless you request observe="snapshot". Do NOT call browser_open again for a different URL within the same site — use browser_click on the link @ref instead. For searches, build a direct search URL (e.g. github.com/search?q=query). Elements marked [INPUT] can be filled. If element count looks low, call browser_wait with observe="snapshot" to let JS finish loading and expose refs.',
        parameters: {
          type: 'object', required: ['url'],
          properties: {
            url: { type: 'string', description: 'Full URL to navigate to. For searches, build the search URL directly.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: screenshot for navigation.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot',
        description: 'Re-scan the current page and return an updated list of interactive elements with @ref numbers. ONLY call this when you do NOT already have a recent snapshot in context — do NOT call it twice in a row or immediately after another explicit observation unless you know the page changed. If you just received a snapshot, ACT on it immediately (browser_click or browser_fill) instead of re-snapping. Repeated snapshot calls without acting = stall loop.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: snapshot for explicit snapshot request.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: 'Click a page element by its @ref number or by a saved named element for the current site. Use element when Teach mode has already saved names like "tweet composer" or "post button". Use observe="compact" for a small orientation summary, or observe="snapshot" when you need fresh refs. Do not reflexively call browser_snapshot again unless you specifically need a new @ref map after the UI changes.',
        parameters: {
          type: 'object',
          properties: {
            ref: { type: 'number', description: '@ref number from the most recent snapshot' },
            element: { type: 'string', description: 'Saved named element for the current site, such as "tweet composer" or "post button".' },
            selector: { type: 'string', description: 'CSS selector for a taught target when you have not promoted it to a saved named element yet.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for medium-risk clicks.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_fill',
        description: 'Type text into an [INPUT] element by its @ref number or a saved named element for the current site. Use element when Teach mode has already saved names like "tweet composer" or "search box". Use observe="compact" for a small orientation summary, or observe="snapshot" when you need fresh refs. After filling, use browser_press_key with "Enter" to submit, or browser_click on the submit button unless the site-specific composer automation already handled it.',
        parameters: {
          type: 'object', required: ['text'],
          properties: {
            ref: { type: 'number', description: '@ref number of an [INPUT] element from the snapshot' },
            element: { type: 'string', description: 'Saved named element for the current site, such as "tweet composer" or "search box".' },
            selector: { type: 'string', description: 'CSS selector for a taught input target when you have not promoted it to a saved named element yet.' },
            text: { type: 'string', description: 'Text to type into the field' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for text input.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_upload_file',
        description:
          'Upload one or more local workspace files into an <input type="file"> on the current page. ' +
          'Prefer selector when the site uses a hidden file input; use ref when the input is visible in the snapshot. ' +
          'file_path/file_paths may be absolute paths or workspace-relative paths like "downloads/image.png". ' +
          'After upload, confirm the preview with browser_vision_screenshot or request observe="snapshot" if you need fresh DOM refs in the tool result.',
        parameters: {
          type: 'object',
          properties: {
            ref: { type: 'number', description: '@ref number for a visible upload control or file input from the latest snapshot.' },
            selector: { type: 'string', description: 'CSS selector for the target file input, useful for hidden inputs.' },
            file_path: { type: 'string', description: 'Single workspace-relative or absolute file path to upload.' },
            file_paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Multiple workspace-relative or absolute file paths to upload.',
            },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: screenshot for upload preview confirmation.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_press_key',
        description: 'Press a keyboard key. Use "Enter" to submit a form or search after filling an input. Use "Escape" to close a popup. Use "Tab" to move focus to the next field. With observe="none" this returns only a tiny ack; use observe="compact" for a small orientation summary.',
        parameters: {
          type: 'object', required: ['key'],
          properties: {
            key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowDown, ArrowUp, Space' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for deterministic keypresses.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_key',
        description: 'Alias for browser_press_key. Press a keyboard key on the focused element.',
        parameters: {
          type: 'object', required: ['key'],
          properties: {
            key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowDown, ArrowUp, Space, etc.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for deterministic keypresses.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_type',
        description:
          'Type text into the currently focused element by sending raw keystrokes. ' +
          'Use this for contenteditable elements (e.g. X/Twitter compose box, rich text editors) where browser_fill does not work. ' +
          'First click the target element to focus it, then call browser_type with the text.',
        parameters: {
          type: 'object', required: ['text'],
          properties: {
            text: { type: 'string', description: 'Text to type into the focused element.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_wait',
        description: 'Wait for the page to settle. With observe="none" this returns only a tiny ack; use observe="compact" for a small orientation summary or observe="snapshot" for fresh DOM refs after the wait. Use this when: (1) a page just loaded but has few elements, (2) after a click that should open something but the snapshot looks unchanged, (3) waiting for search results or dynamic content to appear.',
        parameters: {
          type: 'object',
          properties: {
            ms: { type: 'number', description: 'Milliseconds to wait before snapping (500-8000, default 2000)' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for timing-only waits.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_click_and_download',
        description:
          'Click an element by @ref and wait for the resulting browser download, then save it into the workspace. ' +
          'Use this for visible download buttons, image save links, and export controls when the download starts directly from a click. Returns a compact ack unless observe="snapshot".',
        parameters: {
          type: 'object',
          required: ['ref'],
          properties: {
            ref: { type: 'number', description: '@ref number for the download trigger from the latest snapshot.' },
            timeout_ms: { type: 'number', description: 'Max wait time in milliseconds (default 15000, max 120000).' },
            filename_hint: { type: 'string', description: 'Optional filename to prefer when the browser suggestion is missing or generic.' },
            output_dir: { type: 'string', description: 'Workspace-relative output directory for the saved file. Default: downloads/browser.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta after the click+download.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll',
        description: 'Scroll the page by a multiple of the viewport height. Prefer this over browser_press_key(PageDown) on sites with infinite scroll or content virtualization. Use direction="down" with multiplier=1.75 on X/Twitter to reliably load new tweets past virtualization. Default multiplier=1.0. With observe="none" this returns only a tiny ack; use observe="compact" for a small orientation summary.',
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['down', 'up'], description: 'Scroll direction' },
            multiplier: { type: 'number', description: 'Viewport height multiplier. Use 1.75 for X/Twitter, 1.0 for most sites. Range: 0.5–4.0.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for scrolling.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll_collect',
        description:
          'Scroll multiple times and collect ALL visible text at each position — a single-call web scraping engine. ' +
          'Use this instead of repeated browser_scroll calls when you need to collect data from infinite scroll pages, ' +
          'search results, feeds, or any page with content that loads on scroll. ' +
          'Returns deduplicated text from all scroll positions in one response. ' +
          'When you have saved item roots or saved extraction schemas, prefer browser_scroll_collect_v2 for structured JSON items. ' +
          'Does NOT return a DOM snapshot — call browser_snapshot() afterward if you need to interact with elements. ' +
          'Example: browser_scroll_collect({scrolls: 10, multiplier: 1.75}) on X/Twitter to collect ~30-50 tweets at once.',
        parameters: {
          type: 'object',
          properties: {
            scrolls:    { type: 'number', description: 'Number of scroll iterations (1–30, default 5)' },
            direction:  { type: 'string', enum: ['down', 'up'], description: 'Scroll direction (default: down)' },
            multiplier: { type: 'number', description: 'Viewport height multiplier per scroll (0.5–4.0, default 1.5). Use 1.75 for X/Twitter.' },
            delay_ms:   { type: 'number', description: 'Wait between scrolls in ms for content to load (500–5000, default 1500)' },
            stop_text:  { type: 'string', description: 'Stop scrolling early when this text appears on page (e.g. "No more results")' },
            max_chars:  { type: 'number', description: 'Max total chars to collect (5000–100000, default 50000)' },
            include_initial: { type: 'boolean', description: 'Collect the current viewport before the first scroll (default true).' },
            max_seconds: { type: 'number', description: 'Overall time cap in seconds (5-180, default 45).' },
            stop_after_no_new: { type: 'number', description: 'Stop after this many consecutive scrolled passes add no new text (1-10, default 3).' },
            include_structured: { type: 'boolean', description: 'Run the generic browser extractor on each pass for X feeds, search results, articles, chat interfaces, and paragraph-heavy pages (default true).' },
            include_snapshots: { type: 'boolean', description: 'Capture compact DOM snapshot deltas between passes to show newly visible/removed elements (default true).' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for content collection.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_drag',
        description:
          'Drag within the browser viewport. Use from_ref/to_ref when draggable handles appear in the snapshot, or from_x/from_y/to_x/to_y when working from browser_vision_screenshot coordinates. Useful for sliders, drag-and-drop lists, map/canvas panning, and split-pane resizers. Returns a compact ack unless observe="snapshot".',
        parameters: {
          type: 'object',
          properties: {
            from_ref: { type: 'number', description: 'Optional start element @ref from the latest snapshot.' },
            to_ref: { type: 'number', description: 'Optional end element @ref from the latest snapshot.' },
            from_x: { type: 'number', description: 'Viewport start X when dragging by coordinates.' },
            from_y: { type: 'number', description: 'Viewport start Y when dragging by coordinates.' },
            to_x: { type: 'number', description: 'Viewport end X when dragging by coordinates.' },
            to_y: { type: 'number', description: 'Viewport end Y when dragging by coordinates.' },
            steps: { type: 'number', description: 'Interpolation steps for smoother dragging (default 20).' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for drag interactions.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll_collect_v2',
        description:
          'Structured infinite-scroll collector built on saved item roots and extraction schemas. ' +
          'Use item_root plus fields, or schema_name to reuse a saved extraction schema for the current site. ' +
          'Returns deduplicated JSON items with quality metadata, stop reason, and a scroll log. ' +
          'Use save_as to persist the active schema for future extraction and collection.',
        parameters: {
          type: 'object',
          properties: {
            schema_name: { type: 'string', description: 'Saved extraction schema for the current site, such as "tweet card schema".' },
            item_root: { type: 'string', description: 'Saved named item root for the current site, such as "tweet card" or "result row".' },
            container_selector: { type: 'string', description: 'Optional direct CSS selector for repeated items. Usually omit this and use item_root or schema_name.' },
            fields: { type: 'object', description: 'Field map for structured extraction. Example: { "text": { "selector": "[data-testid=\'tweetText\']" }, "link": { "selector": "a", "type": "href" } }' },
            dedupe_key: { type: 'string', description: 'Optional field name used to deduplicate items, such as "link" or "id".' },
            limit: { type: 'number', description: 'Max total items to return (default 50, max 500).' },
            max_scrolls: { type: 'number', description: 'Max scroll actions after the initial viewport pass (default 8, max 40).' },
            multiplier: { type: 'number', description: 'Viewport height multiplier per scroll (default 1.5).' },
            delay_ms: { type: 'number', description: 'Delay between scrolls in milliseconds (default 1200).' },
            max_seconds: { type: 'number', description: 'Overall time cap in seconds (default 30, max 180).' },
            stop_text: { type: 'string', description: 'Optional stop sentinel text that ends collection when found in page text.' },
            save_as: { type: 'string', description: 'Optional name to persist the active extraction schema for this site.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_close',
        description: 'Close the browser tab when done.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_focused_item',
        description: 'Check which item currently has keyboard focus on the page. CRITICAL for keyboard navigation: after pressing j/k on X.com to navigate tweets, call this to find out which tweet number is currently focused, its author, and its text. Use this after EVERY j/k press so you can determine if you need more presses to reach the right tweet. Returns position (e.g. "Tweet #2 of 8 visible") and tweet content so you can confirm you are on the correct item before pressing like/reply/etc.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for read-only focus check.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_page_text',
        description: 'Extract ALL visible text from the current page, including content inside iframes. Use this when browser_snapshot shows very few elements (< 12) and the page likely has menus, product listings, or other content hidden in iframes (common with dispensary menus using Jane Technologies, Dutchie, or Leafly widgets) or script-rendered blocks. Returns raw page text + a list of any iframe URLs found so you can navigate to them directly with browser_open. If element is provided, resolves a saved named browser element for the current site and returns that element\'s text/details instead of the full page.',
        parameters: {
          type: 'object',
          properties: {
            element: { type: 'string', description: 'Optional saved named element for the current site, such as "tweet composer" or "post button".' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for read-only text extraction.' },
          },
        },
      },
    },
    // ─ Vision fallback tools ─ injected only when VISION MODE is active ──────────────────
    {
      type: 'function',
      function: {
        name: 'browser_vision_screenshot',
        description:
          'Capture the current browser tab viewport as PNG (not full desktop). Use when DOM snapshot is sparse. ' +
          'The image is attached for vision-capable models — you choose browser_vision_click / browser_vision_type coordinates.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none (tool IS the observation).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_vision_click',
        description:
          'Click at viewport pixel coordinates (from browser_vision_screenshot / attached image). ' +
          'Use when DOM is sparse. After clicking, if snapshot element count recovers to > 10, prefer browser_click(@ref).',
        parameters: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            x: { type: 'number', description: 'Pixel X coordinate within the browser viewport' },
            y: { type: 'number', description: 'Pixel Y coordinate within the browser viewport' },
            button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default left)' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: screenshot for vision-based clicks.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_vision_type',
        description:
          'Click at pixel coordinates and type text. ' +
          'Use when VISION MODE is active and you need to type into a canvas/overlay input with no DOM ref. ' +
          'After typing, check the returned snapshot element count — if > 10, switch back to DOM mode.',
        parameters: {
          type: 'object',
          required: ['x', 'y', 'text'],
          properties: {
            x: { type: 'number', description: 'Pixel X coordinate to click before typing' },
            y: { type: 'number', description: 'Pixel Y coordinate to click before typing' },
            text: { type: 'string', description: 'Text to type after clicking' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for vision typing.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_send_to_telegram',
        description:
          'Capture the current browser tab as a screenshot and send it to the user via Telegram. ' +
          'Use this to share what the browser is currently showing — search results, tweets, articles, dashboards, etc. ' +
          'Takes a fresh screenshot of the visible viewport (not full page) and sends it as a photo with caption.',
        parameters: {
          type: 'object',
          properties: {
            caption: { type: 'string', description: 'Caption for the screenshot (default: "Browser screenshot")' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none (side-effect only).' },
          },
        },
      },
    },
    // ─ NEW POWER TOOLS ──────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'browser_run_js',
        description:
          'Execute arbitrary JavaScript in the current page context and return the result. ' +
          'Top-level await is supported. Use this to: read React/Vue component state, trigger programmatic events, ' +
          'inspect hidden variables, extract data not visible in the DOM, run browser APIs. ' +
          'Return value is JSON-serialized. Example: `return document.cookie` or `return window.__STORE__.getState()`. ' +
          'WARNING: treat this as a fallback tool. Prefer browser_snapshot/browser_vision_screenshot + browser_click/browser_fill first, and only use browser_run_js when visual/DOM refs are insufficient. ' +
          'Only use for inspection/read-only operations unless you intentionally want to modify page state.',
        parameters: {
          type: 'object',
          required: ['code'],
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript to execute in the page. Top-level await works. Return a value with `return expr`. Example: `return document.title`',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_intercept_network',
        description:
          'Hook into the Playwright network layer to capture XHR/fetch responses. ' +
          'Call with action="start" before navigating/clicking, then action="read" to inspect what APIs returned. ' +
          'JSON and text response bodies are captured. Binary/image responses are skipped. ' +
          'Use to: inspect what an API returned, find hidden data endpoints, debug what data is loading. ' +
          'action="start" begins capturing; action="stop" removes the listener; action="read" dumps the log; action="clear" wipes it.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['start', 'stop', 'read', 'clear'],
              description: '"start" = begin capturing, "stop" = remove listener, "read" = show captured entries, "clear" = wipe log',
            },
            url_filter: {
              type: 'string',
              description: 'Optional substring to filter URLs (e.g. "/api/" to capture only API calls). Applied in both start and read.',
            },
            max_entries: {
              type: 'number',
              description: 'Max responses to buffer (default 200, max 500).',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'inspect_console',
        description:
          'Inspect browser console health for the current page. Installs a lightweight in-page console/error collector on first call, then returns captured logs, errors, warnings, unhandled rejections, URL, and title.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['read', 'clear'], description: 'read returns captured entries; clear empties the collector. Default read.' },
            max_entries: { type: 'number', description: 'Maximum console entries to return. Default 100.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_accessibility_check',
        description:
          'Run a lightweight browser accessibility sanity check on the current page: title, lang, images without alt, unlabeled controls, duplicate ids, invalid links, heading order, and low semantic landmarks.',
        parameters: {
          type: 'object',
          properties: {
            max_results: { type: 'number', description: 'Maximum findings to return. Default 100.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_smoke_test',
        description:
          'Open a URL, wait for it to settle, capture a snapshot, inspect console errors, and run the accessibility sanity check in one typed workflow.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'URL to test, including localhost URLs.' },
            wait_ms: { type: 'number', description: 'Milliseconds to wait after navigation. Default 1500.' },
            max_console_entries: { type: 'number', description: 'Maximum console entries to include. Default 50.' },
            max_a11y_results: { type: 'number', description: 'Maximum accessibility findings. Default 50.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_element_watch',
        description:
          'Wait until a DOM element appears, disappears, or contains specific text — without burning tokens on repeated snapshots. ' +
          'Uses Playwright\'s native waitForSelector for appear/disappear (efficient, no polling overhead). ' +
          'Use instead of browser_wait + browser_snapshot loops when you know exactly what you\'re waiting for. ' +
          'Returns a fresh snapshot when the condition is met.',
        parameters: {
          type: 'object',
          required: ['selector', 'wait_for'],
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to watch (e.g. ".result-list", "#submit-btn", "[data-testid=\'chat-bubble\']")',
            },
            wait_for: {
              type: 'string',
              enum: ['appear', 'disappear', 'text_contains'],
              description: '"appear" = wait until visible, "disappear" = wait until hidden/removed, "text_contains" = wait until element text includes the "text" param',
            },
            text: {
              type: 'string',
              description: 'Required when wait_for="text_contains". The substring to look for inside the element.',
            },
            timeout_ms: {
              type: 'number',
              description: 'Max wait in ms (default 15000, max 120000).',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot_delta',
        description:
          'Re-scan the page and return ONLY what changed since the last snapshot. ' +
          'Shows added elements, removed elements, and page title/URL changes. ' +
          'Use this instead of browser_snapshot on SPAs and heavy pages to reduce token usage by 60–80%. ' +
          'If no previous snapshot exists, returns a full snapshot. ' +
          'PREFER over browser_snapshot when you already have a snapshot in context and just want to see what changed after an action.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_extract_structured',
        description:
          'Extract structured JSON data from the page using a CSS-schema. ' +
          'Define a container_selector, use item_root to reference a saved named item root, or use schema_name to reuse a saved extraction schema for the current site. Then define fields (each with a CSS selector and extraction type). ' +
          'Returns a JSON array of objects — one per container match. ' +
          'Use this to scrape product listings, search results, tables, social posts, etc. in one call instead of parsing page text. ' +
          'Field type options: "text" (default, innerText), "href" (link href), "src" (img src), "attr" (any attribute), "html" (innerHTML). Use save_as to persist the active schema.',
        parameters: {
          type: 'object',
          required: ['schema'],
          properties: {
            schema: {
              type: 'object',
              description:
                'Extraction schema. Example: { "container_selector": ".product", "limit": 20, "fields": { "name": { "selector": "h2" }, "price": { "selector": ".price" }, "link": { "selector": "a", "type": "href" } } } or { "item_root": "tweet card", "fields": { "text": { "selector": "[data-testid=\'tweetText\']" } }, "save_as": "tweet card schema" } or { "schema_name": "tweet card schema" }',
              properties: {
                schema_name: { type: 'string', description: 'Saved extraction schema for the current site.' },
                container_selector: { type: 'string', description: 'CSS selector for the repeated container element' },
                item_root: { type: 'string', description: 'Saved named item root for the current site, such as "tweet card" or "result row".' },
                limit: { type: 'number', description: 'Max items to return (default 50, max 500)' },
                dedupe_key: { type: 'string', description: 'Optional field name to use for deduping when this schema is later reused for scroll collection.' },
                save_as: { type: 'string', description: 'Optional name to persist this extraction schema for the current site.' },
                fields: {
                  type: 'object',
                  description: 'Map of field name → { selector: string, type?: "text"|"href"|"src"|"attr"|"html", attribute?: string }',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      selector: { type: 'string' },
                      type: { type: 'string', enum: ['text', 'href', 'src', 'attr', 'html'] },
                      attribute: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_teach_verify',
        description:
          'Replay the current Teach-mode workflow in a detached verifier browser tab that shares the current login/session state but does not disturb the visible browser canvas. ' +
          'Use this only after the user explicitly approves verification. ' +
          'mode="full" runs the full recorded workflow. mode="safe" stops before the final risky step if one exists. stop_before_step lets you stop before a specific 1-based recorded step number. ' +
          'Returns a step-by-step verification summary, the stopping boundary, any failure, and the final page.',
        parameters: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['full', 'safe', 'step'],
              description: 'Verification boundary mode. Use "safe" to stop before the final risky step, or "step" with stop_before_step to choose the boundary explicitly.',
            },
            stop_before_step: {
              type: 'number',
              description: 'Optional 1-based recorded step index to stop before. Example: 6 means replay steps 1-5 only.',
            },
          },
        },
      },
    },
  ];
}

export async function browserGetPageText(
  sessionId: string,
  options?: { element?: string },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const url = session.page.url();
    const title = await session.page.title();
    const requestedElement = String(options?.element || '').trim();

    if (requestedElement) {
      const resolvedElement = await resolveNamedBrowserElement(sessionId, requestedElement);
      if (!resolvedElement) {
        const available = listNamedBrowserElementsForUrl(url).map((entry) => entry.name).slice(0, 12);
        const suffix = available.length
          ? ` Available saved elements for this site: ${available.join(', ')}.`
          : ' No saved elements exist for this site yet.';
        return attachShortcutsContext(
          `ERROR: Could not resolve a saved browser element named "${requestedElement}".${suffix}`,
          url,
          sessionId,
        );
      }
      const details = await session.page.locator(resolvedElement.selector).first().evaluate((node: any) => ({
        text: String((node?.innerText || node?.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 1200),
        value: String(node?.value || '').trim().slice(0, 400),
        placeholder: String(node?.getAttribute?.('placeholder') || '').trim().slice(0, 240),
        ariaLabel: String(node?.getAttribute?.('aria-label') || '').trim().slice(0, 240),
        href: String(node?.href || node?.getAttribute?.('href') || '').trim().slice(0, 400),
        src: String(node?.src || node?.getAttribute?.('src') || '').trim().slice(0, 400),
        htmlSnippet: String(node?.outerHTML || '').slice(0, 800),
      })).catch(() => null);
      const lines = [
        `Named Element: ${resolvedElement.entry.name}`,
        `Page: ${title}`,
        `URL: ${url}`,
        `Selector: ${resolvedElement.selector}`,
        `Tag: ${resolvedElement.tagName || resolvedElement.entry.tagName || 'unknown'}`,
      ];
      if (resolvedElement.id || resolvedElement.entry.id) lines.push(`ID: ${resolvedElement.id || resolvedElement.entry.id}`);
      if (details?.ariaLabel) lines.push(`Aria Label: ${details.ariaLabel}`);
      if (details?.placeholder) lines.push(`Placeholder: ${details.placeholder}`);
      if (details?.value) lines.push(`Value: ${details.value}`);
      if (details?.href) lines.push(`Href: ${details.href}`);
      if (details?.src) lines.push(`Src: ${details.src}`);
      lines.push('');
      if (details?.text) lines.push(`=== ELEMENT TEXT ===\n${details.text}`);
      else if (resolvedElement.text || resolvedElement.entry.text) lines.push(`=== ELEMENT TEXT ===\n${resolvedElement.text || resolvedElement.entry.text}`);
      if (details?.htmlSnippet) lines.push(`\n=== HTML SNIPPET ===\n${details.htmlSnippet}`);
      return attachShortcutsContext(lines.join('\n'), url, sessionId);
    }

    // 1. Main document visible text
    const mainText = await session.page.evaluate(() => {
      const body = (globalThis as any).document.body;
      if (!body) return '';
      // Strip scripts and styles before reading innerText
      const clone = body.cloneNode(true) as any;
      for (const el of clone.querySelectorAll('script,style,noscript')) el.remove();
      return (clone.innerText || clone.textContent || '')
        .replace(/[^\S\n]{3,}/g, ' ')
        .replace(/\n{4,}/g, '\n\n')
        .trim()
        .slice(0, 6000);
    });

    // 2. Detect iframes — report their src URLs so AI can navigate to them
    const iframes = await session.page.evaluate(() => {
      return Array.from((globalThis as any).document.querySelectorAll('iframe'))
        .map((f: any) => ({
          src: f.src || f.getAttribute('src') || '',
          id: f.id || '',
          title: f.getAttribute('title') || f.name || '',
          w: f.offsetWidth,
          h: f.offsetHeight,
        }))
        .filter((f: any) => f.src && !f.src.startsWith('javascript') && f.w > 80 && f.h > 80);
    }) as Array<{ src: string; id: string; title: string; w: number; h: number }>;

    // 3. Try to read same-origin iframes directly via Playwright frames API
    const iframeTexts: string[] = [];
    for (const frameHandle of session.page.frames()) {
      try {
        const frameUrl = frameHandle.url();
        if (!frameUrl || frameUrl === 'about:blank' || frameUrl === url) continue;
        const fText = await frameHandle.evaluate(() => {
          const body = (globalThis as any).document.body;
          if (!body) return '';
          const clone = body.cloneNode(true) as any;
          for (const el of clone.querySelectorAll('script,style,noscript')) el.remove();
          return (clone.innerText || clone.textContent || '')
            .replace(/[^\S\n]{3,}/g, ' ')
            .replace(/\n{4,}/g, '\n\n')
            .trim()
            .slice(0, 4000);
        }).catch(() => '');
        if (fText && fText.length > 80) {
          iframeTexts.push(`--- IFRAME (${frameUrl.slice(0, 120)}) ---\n${fText}`);
        }
      } catch { /* cross-origin iframe — skip text, will be listed in iframe URLs */ }
    }

    const parts: string[] = [
      `Page: ${title}`,
      `URL: ${url}`,
      '',
    ];

    if (mainText) {
      parts.push('=== MAIN PAGE TEXT ===');
      parts.push(mainText);
    }

    if (iframeTexts.length > 0) {
      parts.push('');
      parts.push('=== IFRAME CONTENT (same-origin) ===');
      parts.push(...iframeTexts);
    }

    // Cross-origin iframes — can't read text but list the URLs
    const crossOriginIframes = iframes.filter(f => {
      try {
        const fHost = new URL(f.src).hostname;
        const pHost = new URL(url).hostname;
        return fHost !== pHost;
      } catch { return true; }
    });
    if (crossOriginIframes.length > 0) {
      parts.push('');
      parts.push('=== CROSS-ORIGIN IFRAMES (navigate to these with browser_open) ===');
      for (const f of crossOriginIframes) {
        const label = f.title || f.id || 'iframe';
        parts.push(`  ${label}: ${f.src}`);
      }
      parts.push('');
      parts.push('TIP: Use browser_open({url: "<iframe src above>"}) to navigate directly into the embedded menu/widget.');
    }

    const result = parts.join('\n');
    return result.length > 20 ? result : 'No readable text found on this page.';
  } catch (err: any) {
    return `ERROR: browser_get_page_text failed: ${err.message}`;
  }
}

export { INTERACTIVE_SELECTOR };

// ─── browser_run_js ───────────────────────────────────────────────────────────

/**
 * Execute arbitrary JavaScript in the current page context and return the result.
 * Wraps in an async IIFE so top-level await works. Result is JSON-serialized.
 * Playwright's page.evaluate() passes a serializable return value back to Node.
 */
export async function browserRunJs(sessionId: string, code: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!code || !code.trim()) return 'ERROR: code parameter is required.';
  try {
    // Wrap in async IIFE so `await` works at top level
    const wrapped = `(async () => { ${code} })()`;
    const result = await session.page.evaluate(wrapped);
    if (result === undefined || result === null) return 'JS executed successfully (returned: null/undefined).';
    if (typeof result === 'object') return JSON.stringify(result, null, 2);
    return String(result);
  } catch (err: any) {
    return `ERROR: JS execution failed: ${err.message}`;
  }
}

// ─── browser_intercept_network ────────────────────────────────────────────────

/**
 * Hook into Playwright's network layer to intercept and log XHR/fetch responses.
 * action='start': begin capturing (optional url_filter substring match)
 * action='stop': remove the listener
 * action='read': return captured log (optionally filter by url substring)
 * action='clear': wipe the log without stopping
 */
export async function browserInterceptNetwork(
  sessionId: string,
  action: 'start' | 'stop' | 'read' | 'clear',
  urlFilter?: string,
  maxEntries = 200,
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  if (action === 'start') {
    // Remove old handler if already intercepting
    const oldHandler = _networkInterceptHandlers.get(resolved);
    if (oldHandler) session.page.off('response', oldHandler);
    _networkInterceptLog.set(resolved, []);

    const handler = async (response: any) => {
      try {
        const url: string = response.url();
        if (urlFilter && !url.includes(urlFilter)) return;
        const log = _networkInterceptLog.get(resolved);
        if (!log || log.length >= maxEntries) return;
        const req = response.request();
        const headers = response.headers();
        const contentType = (headers['content-type'] || '').split(';')[0].trim();
        let body: string | undefined;
        // Capture body only for JSON / text to avoid large binaries
        if (contentType.includes('json') || contentType.startsWith('text/')) {
          try {
            body = await response.text();
            if (body && body.length > 3000) body = body.slice(0, 3000) + '…[truncated]';
          } catch { /* ignore */ }
        }
        log.push({ url, method: req.method(), status: response.status(), contentType, body, ts: Date.now() });
      } catch { /* ignore disposal errors */ }
    };
    _networkInterceptHandlers.set(resolved, handler);
    session.page.on('response', handler);
    const limit = String(maxEntries);
    const filterNote = urlFilter ? ` (url filter: "${urlFilter}")` : '';
    return `Network interception started${filterNote}. Capturing up to ${limit} responses. Use browser_intercept_network(action="read") to inspect, "stop" to disable.`;
  }

  if (action === 'stop') {
    const handler = _networkInterceptHandlers.get(resolved);
    if (handler) { session.page.off('response', handler); _networkInterceptHandlers.delete(resolved); }
    const count = (_networkInterceptLog.get(resolved) || []).length;
    return `Network interception stopped. ${count} entries in log — use action="read" to view.`;
  }

  if (action === 'clear') {
    _networkInterceptLog.set(resolved, []);
    return 'Network intercept log cleared.';
  }

  if (action === 'read') {
    const log = (_networkInterceptLog.get(resolved) || []).filter(e => !urlFilter || e.url.includes(urlFilter));
    if (log.length === 0) {
      return _networkInterceptHandlers.has(resolved)
        ? 'No matching network responses captured yet (interception is active).'
        : 'No entries — start interception first with action="start".';
    }
    const lines = log.map(e => {
      const time = new Date(e.ts).toISOString().slice(11, 23);
      const bodyLine = e.body ? `\n    Body: ${e.body.replace(/\n/g, ' ')}` : '';
      return `[${time}] ${e.method} ${e.status} ${e.contentType}\n    ${e.url}${bodyLine}`;
    });
    return `Network log (${log.length} entries):\n\n${lines.join('\n\n')}`;
  }

  return 'ERROR: action must be "start", "stop", "read", or "clear".';
}

// ─── browser_element_watch ────────────────────────────────────────────────────

/**
 * Wait until a DOM element appears, disappears, or contains specific text.
 * Uses Playwright's native waitForSelector for appear/disappear — efficient,
 * no polling overhead. Returns a fresh snapshot when condition is met.
 */
export async function browserElementWatch(
  sessionId: string,
  selector: string,
  waitFor: 'appear' | 'disappear' | 'text_contains',
  text?: string,
  timeoutMs = 15000,
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!selector) return 'ERROR: selector is required.';
  const safeTimeout = Math.min(Math.max(Number(timeoutMs) || 15000, 500), 120_000);

  const freshSnapshot = async () => {
    const snap = await takeSnapshot(session.page);
    session.lastSnapshot = snap;
    session.lastSnapshotAt = Date.now();
    return attachShortcutsContext(snap, session.page.url(), sessionId);
  };

  try {
    if (waitFor === 'appear') {
      await session.page.waitForSelector(selector, { state: 'visible', timeout: safeTimeout });
      return `Element "${selector}" appeared.\n\n${await freshSnapshot()}`;
    }
    if (waitFor === 'disappear') {
      await session.page.waitForSelector(selector, { state: 'hidden', timeout: safeTimeout });
      return `Element "${selector}" disappeared.\n\n${await freshSnapshot()}`;
    }
    if (waitFor === 'text_contains') {
      if (!text) return 'ERROR: text_contains requires a "text" parameter.';
      const deadline = Date.now() + safeTimeout;
      while (Date.now() < deadline) {
        try {
          const el = session.page.locator(selector).first();
          const elText = await el.innerText({ timeout: 1000 }).catch(() => '');
          if (elText.includes(text)) {
            return `Element "${selector}" contains text "${text}".\n\n${await freshSnapshot()}`;
          }
        } catch { /* element not present yet — keep polling */ }
        await session.page.waitForTimeout(500);
      }
      return `ERROR: Timed out after ${safeTimeout}ms waiting for "${selector}" to contain text "${text}".`;
    }
    return 'ERROR: waitFor must be "appear", "disappear", or "text_contains".';
  } catch (err: any) {
    return `ERROR: browser_element_watch failed: ${err.message}`;
  }
}

// ─── browser_snapshot_delta ───────────────────────────────────────────────────

/**
 * Re-scan the page and return ONLY what changed since the last snapshot.
 * Compares element lines (each line containing @ref text) between snapshots.
 * Dramatically reduces token cost on heavy SPAs where most elements stay stable.
 * Falls back to full snapshot if no previous snapshot exists.
 */
export async function browserSnapshotDelta(sessionId: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const prevSnapshot = session.lastSnapshot;
  const newSnapshot = await takeSnapshot(session.page);
  rememberSnapshot(session, newSnapshot);
  const url = session.page.url();

  if (!prevSnapshot) {
    const elemCount = (newSnapshot.match(/@\d+/g) || []).length;
    return attachShortcutsContext(
      `No previous snapshot to diff — returning full snapshot (${elemCount} elements):\n\n${newSnapshot}`,
      url,
    );
  }

  // Compare element lines (lines containing @ref numbers)
  const toElemSet = (snap: string) => new Set(snap.split('\n').filter(l => l.includes('@')));
  const prevSet = toElemSet(prevSnapshot);
  const newSet = toElemSet(newSnapshot);
  const added = [...newSet].filter(l => !prevSet.has(l));
  const removed = [...prevSet].filter(l => !newSet.has(l));

  // Check for page-level changes even if element lines are identical
  const prevTitle = (prevSnapshot.match(/^Page:\s*(.+)$/m) || [])[1] || '';
  const newTitle = (newSnapshot.match(/^Page:\s*(.+)$/m) || [])[1] || '';
  const prevUrl = (prevSnapshot.match(/^URL:\s*(.+)$/m) || [])[1] || '';
  const newUrl = (newSnapshot.match(/^URL:\s*(.+)$/m) || [])[1] || '';

  if (added.length === 0 && removed.length === 0 && prevTitle === newTitle && prevUrl === newUrl) {
    return attachShortcutsContext(
      `No DOM changes detected (${newSet.size} elements unchanged).`,
      url,
    );
  }

  const parts: string[] = [`DOM delta — +${added.length} added, -${removed.length} removed (${newSet.size} total)`];
  if (prevTitle !== newTitle) parts.push(`Page title: "${prevTitle}" → "${newTitle}"`);
  if (prevUrl !== newUrl) parts.push(`URL: ${prevUrl} → ${newUrl}`);
  if (added.length > 0) { parts.push('\n=== ADDED ==='); parts.push(...added.slice(0, 60)); }
  if (removed.length > 0) { parts.push('\n=== REMOVED ==='); parts.push(...removed.slice(0, 60)); }
  if (added.length > 60 || removed.length > 60) parts.push('\n…(truncated — use browser_snapshot for full view)');

  return attachShortcutsContext(parts.join('\n'), url, sessionId);
}

// ─── browser_extract_structured ───────────────────────────────────────────────

/**
 * Extract structured data from the current page by describing a schema.
 * Schema format:
 *   container_selector: CSS selector for repeated items (e.g. ".product-card")
 *   limit: max items to return (default 50)
 *   fields: { fieldName: { selector: CSS, type: "text"|"href"|"src"|"attr", attribute?: string } }
 *
 * Example schema to scrape products:
 *   { "container_selector": ".product", "fields": {
 *       "name":  { "selector": "h2" },
 *       "price": { "selector": ".price" },
 *       "link":  { "selector": "a", "type": "href" }
 *   }}
 *
 * Returns JSON array of matched items. Fields not found return null.
 */
export async function browserExtractStructured(
  sessionId: string,
  schema: Record<string, any>,
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!schema || typeof schema !== 'object') return 'ERROR: schema must be an object with container_selector, item_root, or schema_name plus fields.';

  try {
    const resolved = resolveBrowserExtractionSchemaForUrl(session.page.url(), schema || {});
    if (!resolved.schema) {
      return `ERROR: ${resolved.error || 'Could not resolve extraction schema.'}`;
    }

    const resultWithMeta = await extractStructuredItemsFromCurrentPage(session.page, resolved.schema);
    const result = resultWithMeta
      .map((entry) => entry.item)
      .filter((item) => Object.values(item).some((value) => value != null && String(value).trim() !== ''));

    if (!Array.isArray(result) || result.length === 0) {
      const targetLabel = resolved.schema.itemRootName
        ? `item_root "${resolved.schema.itemRootName}" (${resolved.schema.containerSelector})`
        : `container_selector "${resolved.schema.containerSelector || 'body'}"`;
      return `No items found matching ${targetLabel}.`;
    }

    const prefixLines: string[] = [];
    if (resolved.schema.requestedSchemaName) {
      prefixLines.push(`Resolved schema_name "${resolved.schema.requestedSchemaName}" (${resolved.schema.source})`);
    }
    if (resolved.schema.itemRootName) {
      prefixLines.push(`Resolved item_root "${resolved.schema.itemRootName}" -> ${resolved.schema.containerSelector}`);
    }

    const saveName = String(resolved.schema.saveAs || '').trim();
    if (saveName) {
      const savedResult = saveNamedBrowserExtractionSchemaForUrl(session.page.url(), {
        name: saveName,
        aliases: resolved.schema.aliases,
        itemRoot: resolved.schema.itemRootName,
        containerSelector: resolved.schema.containerSelector,
        dedupeKey: resolved.schema.dedupeKey,
        limit: resolved.schema.limit,
        fields: resolved.schema.fields,
        url: session.page.url(),
      });
      broadcastBrowserKnowledgeSnapshot(resolveSessionId(sessionId), session.page.url(), savedResult.site, {
        action: 'saved_schema',
        savedKind: 'schema',
        saved: savedResult.saved,
      });
      prefixLines.push(`Saved extraction schema "${savedResult.saved.name}" for this site.`);
    }

    return `${prefixLines.length ? `${prefixLines.join('\n')}\n\n` : ''}${JSON.stringify(result, null, 2)}`;
  } catch (err: any) {
    return `ERROR: browser_extract_structured failed: ${err.message}`;
  }
}

// ─── Vision Tools (Component 1 + 3) ──────────────────────────────────────────
//
// These tools capture the Playwright viewport as a PNG (not via PowerShell/desktop)
// and allow coordinate-based click/type when the DOM snapshot has too few elements.
// Used by the vision fallback system when stabilization is exhausted.

/**
 * Capture the current browser tab viewport as a base64 PNG.
 * Much faster than desktop_screenshot because it uses Playwright's CDP directly.
 * Returns null if no session exists.
 */
export async function browserVisionScreenshot(sessionId: string): Promise<{
  base64: string;
  width: number;
  height: number;
} | null> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return null;
  try {
    const buf: Buffer = await session.page.screenshot({ type: 'png', fullPage: false });
    const viewport = session.page.viewportSize() || { width: 1280, height: 720 };
    const out = {
      base64: buf.toString('base64'),
      width: viewport.width,
      height: viewport.height,
    };
    // Keep the latest browser screenshot available for primary vision injection.
    setLastBrowserScreenshot(sessionId, out);
    return out;
  } catch (err: any) {
    console.warn('[Browser] browserVisionScreenshot failed:', err.message);
    return null;
  }
}

/**
 * Capture a browser tab screenshot and send it to Telegram.
 * Takes a fresh screenshot via Playwright, then sends it to all allowed Telegram users.
 */
export async function browserSendToTelegram(
  sessionId: string,
  caption: string = 'Browser screenshot',
  telegramChannel?: any,
): Promise<string> {
  if (!telegramChannel) {
    return 'ERROR: Telegram channel not available.';
  }
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const buf: Buffer = await session.page.screenshot({ type: 'png', fullPage: false });
    const viewport = session.page.viewportSize() || { width: 1280, height: 720 };
    // Also expose this screenshot to the model so it's not "send-only".
    setLastBrowserScreenshot(sessionId, {
      base64: buf.toString('base64'),
      width: viewport.width,
      height: viewport.height,
    });
    await telegramChannel.sendPhotoToAllowed(buf, caption);
    return `Browser screenshot sent to Telegram (${viewport.width}x${viewport.height}). Caption: "${caption}"`;
  } catch (err: any) {
    return `ERROR: Failed to send browser screenshot to Telegram: ${err?.message || err}`;
  }
}

/**
 * Click at viewport coordinates (pixels). Uses Playwright CDP mouse API.
 * More precise than DOM refs — works on canvas/SVG/WebGL pages.
 * Returns a fresh DOM snapshot after clicking so the model can check if DOM recovered.
 */
export async function browserVisionClick(
  sessionId: string,
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const px = Math.round(Number(x) || 0);
  const py = Math.round(Number(y) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return 'ERROR: x and y must be valid numbers.';
  }
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_vision_click');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    await session.page.mouse.click(px, py, { button });
    await session.page.waitForTimeout(600);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const elemCount = (snapshot.match(/@\d+/g) || []).length;
      return (
        `Vision-clicked (${px}, ${py}). Post-click snapshot (${elemCount} elements):\n\n` +
        attachShortcutsContext(snapshot, session.page.url(), sessionId)
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Vision-clicked (${px}, ${py}).`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Vision-clicked (${px}, ${py}).`);
  } catch (err: any) {
    return `ERROR: Vision click at (${px}, ${py}) failed: ${err.message}`;
  }
}

/**
 * Click at viewport coordinates then type text. Uses Playwright mouse + keyboard APIs.
 * Works on canvas/input overlays that don't have DOM refs.
 * Returns a fresh snapshot.
 */
export async function browserVisionType(
  sessionId: string,
  x: number,
  y: number,
  text: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const px = Math.round(Number(x) || 0);
  const py = Math.round(Number(y) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return 'ERROR: x and y must be valid numbers.';
  }
  const payload = String(text || '');
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_vision_type');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    await session.page.mouse.click(px, py);
    await session.page.waitForTimeout(200);
    await session.page.keyboard.type(payload, { delay: 25 });
    await session.page.waitForTimeout(500);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const elemCount = (snapshot.match(/@\d+/g) || []).length;
      return (
        `Vision-typed ${payload.length} chars at (${px}, ${py}). Post-type snapshot (${elemCount} elements):\n\n` +
        attachShortcutsContext(snapshot, session.page.url(), sessionId)
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Vision-typed ${payload.length} chars at (${px}, ${py}).`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Vision-typed ${payload.length} chars at (${px}, ${py}).`);
  } catch (err: any) {
    return `ERROR: Vision type at (${px}, ${py}) failed: ${err.message}`;
  }
}

// ─── Session State Helpers (for system prompt injection) ───────────────────────

export function hasBrowserSession(sessionId: string): boolean {
  return sessions.has(resolveSessionId(sessionId));
}

export async function browserHandleUserInput(
  sessionId: string,
  payload: {
    action?: string;
    x?: number;
    y?: number;
    button?: 'left' | 'middle' | 'right';
    deltaX?: number;
    deltaY?: number;
    key?: string;
    text?: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
): Promise<{
  sessionId: string;
  active: boolean;
  url: string;
  title: string;
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  streamActive: boolean;
  streamTransport: 'cdp' | 'snapshot' | '';
  streamFocus: BrowserLiveStreamFocus;
  source: 'user';
  statusLabel: string;
  frameBase64: string;
  frameWidth: number;
  frameHeight: number;
  frameFormat: 'png';
  timestamp: number;
  userAction: BrowserUserAction;
  clickHighlight: null | {
    selector: string;
    tagName: string;
    id: string;
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
  };
}> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) throw new Error('No browser session. Use browser_open first.');
  const action = String(payload?.action || '').trim().toLowerCase();
  if (!['click', 'wheel', 'key', 'text'].includes(action)) {
    throw new Error(`Unsupported browser input action "${action || 'unknown'}".`);
  }
  const interactionState = getOrCreateBrowserInteractionState(resolved);
  const mode = normalizeBrowserInteractionMode(interactionState.mode);
  const liveStream = browserLiveStreams.get(resolved);
  if (mode !== 'copilot' && mode !== 'teach') {
    throw new Error(`Browser input is only enabled in Co-pilot or Teach mode. Current mode: ${mode}.`);
  }
  const px = Math.round(Number(payload?.x || 0));
  const py = Math.round(Number(payload?.y || 0));
  const requiresPoint = action === 'click' || action === 'wheel';
  if (requiresPoint && (!Number.isFinite(px) || !Number.isFinite(py))) {
    throw new Error('Browser input requires valid viewport coordinates.');
  }
  const beforeUrl = String(session.lastPageUrl || session.page.url() || '').trim();
  const beforeTitle = String(session.lastPageTitle || await session.page.title().catch(() => '') || '').trim();
  let clickHighlight = null as null | Awaited<ReturnType<typeof browserInspectPoint>>;
  let summary = '';
  if (action === 'click') {
    const button: 'left' | 'middle' | 'right' = payload?.button === 'middle' || payload?.button === 'right'
      ? payload.button
      : 'left';
    clickHighlight = await browserInspectPoint(resolved, px, py).catch(() => null);
    await session.page.mouse.click(px, py, { button });
    await session.page.waitForTimeout(350).catch(() => {});
    summary = `User clicked at (${px}, ${py}) in ${mode} mode.`;
  } else if (action === 'wheel') {
    const deltaX = Number(payload?.deltaX || 0);
    const deltaY = Number(payload?.deltaY || 0);
    await session.page.mouse.move(px, py);
    await session.page.mouse.wheel(deltaX, deltaY);
    await session.page.waitForTimeout(250).catch(() => {});
    summary = `User scrolled the browser in ${mode} mode (delta ${Math.round(deltaX)}, ${Math.round(deltaY)}).`;
  } else if (action === 'text') {
    const text = String(payload?.text || '');
    if (!text) throw new Error('Browser text input requires text.');
    await session.page.keyboard.insertText(text);
    await session.page.waitForTimeout(120).catch(() => {});
    summary = `User typed "${text.replace(/\s+/g, ' ').slice(0, 40)}" in ${mode} mode.`;
  } else if (action === 'key') {
    const key = String(payload?.key || '').trim();
    if (!key) throw new Error('Browser key input requires key.');
    const modifiers = [
      payload?.ctrlKey ? 'Control' : '',
      payload?.altKey ? 'Alt' : '',
      payload?.metaKey ? 'Meta' : '',
      payload?.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    const combo = [...modifiers, key].join('+');
    const plainSpace = key === 'Space' && !payload?.ctrlKey && !payload?.altKey && !payload?.metaKey && !payload?.shiftKey;
    if (plainSpace && await browserHasEditableFocus(session.page)) {
      await session.page.keyboard.insertText(' ');
      await session.page.waitForTimeout(120).catch(() => {});
      summary = `User typed a space in ${mode} mode.`;
    } else {
      await session.page.keyboard.press(combo);
      await session.page.waitForTimeout(120).catch(() => {});
      summary = `User pressed ${combo} in ${mode} mode.`;
    }
  }
  const captureState = setBrowserControlCaptureState(resolved, {
    captured: true,
    owner: 'user',
    reason: mode === 'teach'
      ? 'User is confirming a recorded Teach step.'
      : 'User is controlling the browser in Co-pilot mode.',
  });
  const meta = await syncPageMetadata(session);
  const timestamp = Date.now();
  const currentUrl = String(meta.url || beforeUrl || session.page.url() || '').trim();
  const currentTitle = String(meta.title || beforeTitle || '').trim();
  if ((meta.urlChanged || meta.titleChanged) && (currentTitle || currentUrl)) {
    summary += ` The page changed to ${currentTitle ? `"${currentTitle}"` : currentUrl}${currentUrl ? ` (${currentUrl})` : ''}.`;
  }
  const userAction: BrowserUserAction = {
    kind: action as BrowserUserAction['kind'],
    ...(requiresPoint ? { x: px, y: py } : {}),
    ...(action === 'click'
      ? { button: payload?.button === 'middle' || payload?.button === 'right' ? payload.button : 'left' }
      : {}),
    ...(action === 'wheel' ? { deltaX: Number(payload?.deltaX || 0), deltaY: Number(payload?.deltaY || 0) } : {}),
    ...(action === 'key' ? { key: String(payload?.key || '').trim() } : {}),
    ...(action === 'text' ? { text: String(payload?.text || '') } : {}),
    mode,
    url: currentUrl,
    title: currentTitle,
    summary,
    timestamp,
  };
  recordBrowserUserAction(resolved, userAction);
  const shot = await browserVisionScreenshot(resolved).catch(() => null);
  return {
    sessionId: resolved,
    active: true,
    url: currentUrl,
    title: currentTitle,
    mode,
    captured: captureState.captured,
    controlOwner: captureState.controlOwner,
    streamActive: liveStream?.active === true,
    streamTransport: liveStream?.transport || '',
    streamFocus: liveStream?.focus || 'passive',
    source: 'user',
    statusLabel: mode === 'teach' ? 'Teach step executed.' : 'You are controlling the browser.',
    frameBase64: String(shot?.base64 || ''),
    frameWidth: Number(shot?.width || 0),
    frameHeight: Number(shot?.height || 0),
    frameFormat: 'png',
    timestamp,
    userAction,
    clickHighlight: clickHighlight?.bounds
      ? {
          selector: String(clickHighlight.selector || '').trim(),
          tagName: String(clickHighlight.tagName || '').trim(),
          id: String(clickHighlight.id || '').trim(),
          text: String(clickHighlight.text || '').trim(),
          bounds: clickHighlight.bounds,
        }
      : null,
  };
}

function summarizeTeachVerificationResult(result: string): string {
  const text = String(result || '').trim();
  if (!text) return '';
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  return firstLine.slice(0, 220);
}

function isTeachVerificationError(result: string): boolean {
  return /^ERROR:/i.test(String(result || '').trim());
}

function findFinalRiskyTeachStepIndex(steps: BrowserTeachStepSnapshot[]): number {
  let found = 0;
  for (let index = 0; index < steps.length; index += 1) {
    if (normalizeBrowserTeachRisk(steps[index]?.risk) === 'high') found = index + 1;
  }
  return found;
}

export async function browserTeachVerify(
  sessionId: string,
  options?: {
    mode?: 'full' | 'safe' | 'step';
    stop_before_step?: number;
    stopBeforeStep?: number;
  },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const teach = getBrowserTeachSessionSnapshot(resolved);
  if (!teach || !teach.active || !Array.isArray(teach.steps) || !teach.steps.length) {
    return 'ERROR: No recorded Teach workflow is available for this session yet.';
  }
  if (!String(teach.startUrl || '').trim()) {
    return 'ERROR: The recorded Teach workflow is missing its start URL.';
  }

  const requestedMode = String(options?.mode || '').trim().toLowerCase();
  const mode: 'full' | 'safe' | 'step' = requestedMode === 'safe'
    ? 'safe'
    : (requestedMode === 'step' ? 'step' : 'full');
  let stopBeforeStep = Math.max(
    0,
    Number(options?.stop_before_step || options?.stopBeforeStep || 0) || 0,
  );
  const totalRecordedSteps = teach.steps.length;
  const riskyStepIndexes = teach.steps
    .map((step, index) => (normalizeBrowserTeachRisk(step?.risk) === 'high' ? index + 1 : 0))
    .filter(Boolean);
  if (mode === 'safe' && stopBeforeStep <= 0) {
    stopBeforeStep = findFinalRiskyTeachStepIndex(teach.steps);
  }
  if (stopBeforeStep > totalRecordedSteps) stopBeforeStep = totalRecordedSteps;
  const stepsToReplay = stopBeforeStep > 0 ? teach.steps.slice(0, Math.max(0, stopBeforeStep - 1)) : teach.steps.slice();
  const boundaryLabel = stopBeforeStep > 0
    ? `Stop before step ${stopBeforeStep}`
    : (mode === 'safe' ? 'Run the full workflow (no risky step found)' : 'Run the full workflow');

  const startedAt = Date.now();
  browserTeachSessions.set(resolved, {
    ...teach,
    phase: 'verifying',
    verification: null,
  });
  const detached = await replaceDetachedBrowserSession(resolved, 'teach-verify');
  const verifierSessionId = detached.sessionId;

  const openResult = await browserOpen(verifierSessionId, teach.startUrl, { observe: 'none' });
  if (isTeachVerificationError(openResult)) {
    return `ERROR: Teach verification could not return to the recorded start URL: ${summarizeTeachVerificationResult(openResult)}`;
  }
  const verifierSession = sessions.get(verifierSessionId) || detached.session;
  const verifierTitle = String(await verifierSession.page.title().catch(() => '') || '').trim();
  try {
    broadcastWS({
      type: 'browser:teach:verification_started',
      sessionId: resolved,
      verifierSessionId,
      phase: 'verifying',
      url: String(verifierSession.page.url?.() || teach.startUrl || '').trim(),
      title: verifierTitle,
      statusLabel: 'Watching the detached Teach verifier tab.',
      timestamp: Date.now(),
    });
  } catch {
    // Best-effort UI sync only.
  }
  await broadcastBrowserViewportUpdate(
    verifierSessionId,
    verifierSession,
    'browser_teach_verify',
    'Teach verifier returned to the recorded start URL.',
  ).catch(() => {});

  const executionLines: string[] = [];
  let failedStep = 0;
  let failureSummary = '';

  for (let index = 0; index < stepsToReplay.length; index += 1) {
    const step = teach.steps[index];
    const stepNumber = index + 1;
    let result = '';
    switch (String(step?.toolName || '').trim()) {
      case 'browser_click':
        result = await browserClick(verifierSessionId, step.args || {}, { observe: 'none' });
        break;
      case 'browser_fill':
        result = await browserFill(
          verifierSessionId,
          step.args || {},
          String(step?.args?.text || ''),
          { observe: 'none' },
        );
        break;
      case 'browser_type':
        result = await browserType(verifierSessionId, String(step?.args?.text || ''));
        break;
      case 'browser_press_key':
        result = await browserPressKey(verifierSessionId, String(step?.args?.key || ''), { observe: 'none' });
        break;
      case 'browser_scroll':
        result = await browserScroll(
          verifierSessionId,
          String(step?.args?.direction || '').trim().toLowerCase() === 'up' ? 'up' : 'down',
          Number(step?.args?.multiplier || 1) || 1,
          { observe: 'none' },
        );
        break;
      default:
        result = `ERROR: Unsupported Teach step tool "${String(step?.toolName || 'unknown').trim()}".`;
        break;
    }
    const resultSummary = summarizeTeachVerificationResult(result);
    executionLines.push(`${stepNumber}. ${String(step?.toolPreview || step?.summary || step?.toolName || 'browser step').trim()} -> ${resultSummary || 'Done.'}`);
    await broadcastBrowserViewportUpdate(
      verifierSessionId,
      verifierSession,
      'browser_teach_verify',
      isTeachVerificationError(result)
        ? `Teach verifier stopped at step ${stepNumber}: ${resultSummary || 'step failed.'}`
        : `Teach verifier replayed step ${stepNumber} of ${stepsToReplay.length}.`,
    ).catch(() => {});
    if (isTeachVerificationError(result)) {
      failedStep = stepNumber;
      failureSummary = resultSummary || `Step ${stepNumber} failed.`;
      break;
    }
  }

  const finalUrl = String(verifierSession?.page?.url?.() || teach.startUrl || '').trim();
  const finalTitle = String(await verifierSession.page.title().catch(() => '') || '').trim();
  const completedAt = Date.now();
  const executedCount = failedStep > 0 ? Math.max(0, failedStep - 1) : stepsToReplay.length;
  const verification: BrowserTeachVerificationResult = {
    status: failedStep > 0
      ? (executedCount > 0 ? 'partial' : 'failed')
      : 'passed',
    mode,
    boundaryLabel,
    stopBeforeStep,
    verifierSessionId,
    executedCount,
    totalRecordedSteps,
    riskyStepIndexes,
    ...(failedStep > 0 ? { failedStep, failureSummary } : {}),
    finalUrl,
    finalTitle,
    startedAt,
    completedAt,
  };
  browserTeachSessions.set(resolved, {
    ...teach,
    phase: 'verified',
    verification,
  });
  await broadcastBrowserViewportUpdate(
    verifierSessionId,
    verifierSession,
    'browser_teach_verify',
    verification.status === 'passed'
      ? 'Teach verifier completed the approved replay.'
      : (verification.status === 'partial'
        ? 'Teach verifier reached an issue after partial progress.'
        : 'Teach verifier failed before completing the approved replay.'),
  ).catch(() => {});
  try {
    broadcastWS({
      type: 'browser:teach:verification',
      sessionId: resolved,
      phase: 'verified',
      verification,
      timestamp: completedAt,
    });
  } catch {
    // Best-effort UI sync only.
  }

  const lines = [
    `Teach verification ${verification.status === 'passed' ? 'passed' : (verification.status === 'partial' ? 'completed with issues' : 'failed')}.`,
    `Boundary: ${boundaryLabel}.`,
    `Start URL: ${teach.startUrl}`,
    `Verifier session: ${verifierSessionId}`,
    `Executed ${executedCount} of ${totalRecordedSteps} recorded step${totalRecordedSteps === 1 ? '' : 's'}.`,
    verification.stopBeforeStep > 0
      ? `Stopped before step ${verification.stopBeforeStep}.`
      : 'Ran the recorded workflow through the approved boundary.',
    riskyStepIndexes.length ? `Risky steps in the recorded workflow: ${riskyStepIndexes.join(', ')}.` : 'Risky steps in the recorded workflow: none.',
    executionLines.length ? `Step log:\n${executionLines.join('\n')}` : '',
    failedStep > 0 ? `Failure: ${failureSummary}` : '',
    finalTitle || finalUrl ? `Final page: ${finalTitle ? `"${finalTitle}"` : finalUrl}${finalUrl ? ` (${finalUrl})` : ''}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function getBrowserSessionInfo(sessionId: string): BrowserSessionInfo {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  const metadata = getBrowserSessionMetadata(resolved);
  const originLabel = formatBrowserSessionOriginLabel(resolved, metadata);
  const interactionState = browserInteractionStates.get(resolveBrowserInteractionStateId(sessionId));
  const liveStream = browserLiveStreams.get(resolved);
  if (!session) {
    return {
      active: false,
      sessionId: resolved,
      originLabel,
      mode: interactionState?.mode,
      captured: interactionState?.captured,
      controlOwner: interactionState?.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      lastActor: interactionState?.lastActor,
      lastActorSummary: interactionState?.lastActorSummary,
      recentUserActions: interactionState?.recentUserActions ? [...interactionState.recentUserActions] : [],
    };
  }
  try {
    const url = session.lastPageUrl || session.page.url();
    const title = session.lastPageTitle || undefined;
    return {
      active: true,
      sessionId: resolved,
      originLabel,
      url,
      title,
      debugPort: session.debugPort,
      profileDir: session.profileDir,
      mode: interactionState?.mode,
      captured: interactionState?.captured,
      controlOwner: interactionState?.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      lastActor: interactionState?.lastActor,
      lastActorSummary: interactionState?.lastActorSummary,
      recentUserActions: interactionState?.recentUserActions ? [...interactionState.recentUserActions] : [],
    };
  } catch {
    return {
      active: true,
      sessionId: resolved,
      originLabel,
      debugPort: session.debugPort,
      profileDir: session.profileDir,
      mode: interactionState?.mode,
      captured: interactionState?.captured,
      controlOwner: interactionState?.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      lastActor: interactionState?.lastActor,
      lastActorSummary: interactionState?.lastActorSummary,
      recentUserActions: interactionState?.recentUserActions ? [...interactionState.recentUserActions] : [],
    };
  }
}

export function listBrowserSessions(): BrowserSessionListEntry[] {
  const entries: BrowserSessionListEntry[] = [];
  const seen = new Set<string>();
  const seenSessionObjects = new Set<BrowserSession>();
  for (const [sessionId, session] of sessions.entries()) {
    if (seen.has(sessionId)) continue;
    if (seenSessionObjects.has(session)) continue;
    seen.add(sessionId);
    seenSessionObjects.add(session);
    const metadata = getBrowserSessionMetadata(sessionId);
    const info = getBrowserSessionInfo(sessionId);
    entries.push({
      ...info,
      active: true,
      sessionId,
      ownerType: metadata.ownerType,
      ownerId: metadata.ownerId || '',
      label: metadata.label || '',
      originLabel: info.originLabel || formatBrowserSessionOriginLabel(sessionId, metadata),
      taskPrompt: metadata.taskPrompt || '',
      spawnerSessionId: metadata.spawnerSessionId || '',
      createdAt: session.createdAt || metadata.createdAt || 0,
      updatedAt: metadata.updatedAt || session.createdAt || 0,
      debugPort: session.debugPort,
      profileDir: session.profileDir,
    });
  }
  return entries.sort((a, b) => {
    const weight = (entry: BrowserSessionListEntry) => {
      if (entry.ownerType === 'main') return 0;
      if (entry.ownerType === 'background') return 1;
      if (entry.ownerType === 'task') return 2;
      if (entry.ownerType === 'team-agent') return 3;
      return 4;
    };
    return weight(a) - weight(b) || (b.createdAt || 0) - (a.createdAt || 0);
  });
}

async function resolveNamedBrowserElement(
  sessionId: string,
  name: string,
): Promise<null | {
  entry: BrowserKnowledgeElement;
  selector: string;
  tagName: string;
  id: string;
  text: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
}> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return null;
  const url = String(session.page.url() || '').trim();
  const entry = matchNamedBrowserElementForUrl(url, name);
  if (!entry) return null;
  const selectors = Array.from(new Set([
    String(entry.selector || '').trim(),
    ...(Array.isArray(entry.selectors) ? entry.selectors.map((value) => String(value || '').trim()) : []),
    entry.id ? `#${entry.id}` : '',
  ].filter(Boolean)));

  for (const selector of selectors) {
    try {
      const locator = session.page.locator(selector).first();
      const count = await locator.count();
      if (!count) continue;
      const meta = await locator.evaluate((node: any) => {
        const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
        return {
          tagName: String(node?.tagName || '').toLowerCase(),
          id: String(node?.id || '').trim(),
          text: String((node?.innerText || node?.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 240),
          bounds: rect
            ? {
                x: Math.round(Number(rect.left || 0)),
                y: Math.round(Number(rect.top || 0)),
                width: Math.round(Number(rect.width || 0)),
                height: Math.round(Number(rect.height || 0)),
              }
            : null,
        };
      });
      return {
        entry,
        selector,
        tagName: String(meta?.tagName || entry.tagName || '').trim(),
        id: String(meta?.id || entry.id || '').trim(),
        text: String(meta?.text || entry.text || '').trim(),
        bounds: meta?.bounds || null,
      };
    } catch {
      // Try the next selector candidate.
    }
  }

  return null;
}

interface ResolvedBrowserExtractionSchema {
  name: string;
  requestedSchemaName: string;
  saveAs: string;
  aliases: string[];
  source: 'inline' | 'saved' | 'saved+override';
  itemRootName: string;
  containerSelector: string;
  dedupeKey: string;
  limit: number;
  fields: Record<string, BrowserKnowledgeExtractionField>;
}

function normalizeExtractionFieldInput(raw: any): BrowserKnowledgeExtractionField | null {
  if (!raw || typeof raw !== 'object') return null;
  const selector = String(raw.selector || '').trim();
  if (!selector) return null;
  const typeRaw = String(raw.type || 'text').trim().toLowerCase();
  const type = typeRaw === 'href' || typeRaw === 'src' || typeRaw === 'attr' || typeRaw === 'html' ? typeRaw : 'text';
  const field: BrowserKnowledgeExtractionField = { selector, type };
  const attribute = String(raw.attribute || '').trim();
  if (attribute) field.attribute = attribute;
  if (raw.required != null) field.required = raw.required === true;
  return field;
}

function normalizeExtractionFieldsInput(raw: any): Record<string, BrowserKnowledgeExtractionField> {
  const fields: Record<string, BrowserKnowledgeExtractionField> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fields;
  for (const [fieldName, value] of Object.entries(raw)) {
    const cleanName = String(fieldName || '').trim();
    if (!cleanName) continue;
    const normalized = normalizeExtractionFieldInput(value);
    if (!normalized) continue;
    fields[cleanName] = normalized;
  }
  return fields;
}

function resolveBrowserExtractionSchemaForUrl(
  url: string,
  schemaInput: Record<string, any>,
): { schema?: ResolvedBrowserExtractionSchema; error?: string } {
  const input = schemaInput && typeof schemaInput === 'object' ? { ...schemaInput } : {};
  const requestedSchemaName = String(input.schema_name || input.use_schema || input.schemaName || '').trim();
  const savedSchema = requestedSchemaName ? matchNamedBrowserExtractionSchemaForUrl(url, requestedSchemaName) : null;
  if (requestedSchemaName && !savedSchema) {
    const available = listNamedBrowserExtractionSchemasForUrl(url).map((entry) => entry.name).slice(0, 12);
    const suffix = available.length
      ? ` Available saved extraction schemas for this site: ${available.join(', ')}.`
      : ' No saved extraction schemas exist for this site yet.';
    return { error: `Could not resolve a saved extraction schema named "${requestedSchemaName}".${suffix}` };
  }

  const inlineFields = normalizeExtractionFieldsInput(input.fields);
  const fields = Object.keys(inlineFields).length ? inlineFields : { ...(savedSchema?.fields || {}) };
  if (!Object.keys(fields).length) {
    return { error: 'browser_extract_structured requires schema.fields or schema_name pointing to a saved schema with fields.' };
  }

  const itemRootName = String(
    input.item_root
    || input.root_name
    || input.container_name
    || savedSchema?.itemRoot
    || '',
  ).trim();
  let containerSelector = String(
    input.container_selector
    || input.containerSelector
    || savedSchema?.containerSelector
    || '',
  ).trim();

  if (!containerSelector && itemRootName) {
    const root = matchNamedBrowserItemRootForUrl(url, itemRootName);
    if (!root) {
      const available = listNamedBrowserItemRootsForUrl(url).map((entry) => entry.name).slice(0, 12);
      const suffix = available.length
        ? ` Available saved item roots for this site: ${available.join(', ')}.`
        : ' No saved item roots exist for this site yet.';
      return { error: `Could not resolve a saved item root named "${itemRootName}".${suffix}` };
    }
    containerSelector = String(root.selector || '').trim();
  }

  if (!containerSelector) {
    return { error: 'browser_extract_structured requires schema.container_selector, schema.item_root, or schema_name.' };
  }

  const overridesUsed = Object.keys(inlineFields).length > 0
    || !!String(input.item_root || input.root_name || input.container_name || input.container_selector || input.containerSelector || '').trim()
    || input.limit != null
    || input.dedupe_key != null
    || input.dedupeKey != null;

  return {
    schema: {
      name: String(input.name || requestedSchemaName || savedSchema?.name || '').trim(),
      requestedSchemaName,
      saveAs: String(input.save_as || input.remember_as || '').trim(),
      aliases: Array.isArray(input.aliases) ? input.aliases.map((value: any) => String(value || '').trim()).filter(Boolean) : [],
      source: savedSchema ? (overridesUsed ? 'saved+override' : 'saved') : 'inline',
      itemRootName,
      containerSelector,
      dedupeKey: String(input.dedupe_key || input.dedupeKey || savedSchema?.dedupeKey || '').trim(),
      limit: Math.min(Math.max(Number(input.limit || savedSchema?.limit || 50) || 50, 1), 500),
      fields,
    },
  };
}

async function extractStructuredItemsFromCurrentPage(
  page: PwPage,
  schema: ResolvedBrowserExtractionSchema,
  options: { limit?: number } = {},
): Promise<Array<{
  item: Record<string, any>;
  meta: { requiredMissing: number; containerText: string; dedupeSource: string };
}>> {
  const payload = {
    containerSelector: schema.containerSelector,
    fields: schema.fields,
    limit: Math.min(Math.max(Number(options.limit || schema.limit || 50) || 50, 1), 500),
  };

  return page.evaluate((s: any) => {
    const doc = (globalThis as any).document;
    const containerSel: string = s.containerSelector || 'body';
    const fields: Record<string, any> = s.fields || {};
    const limitNum = Math.min(Number(s.limit) || 50, 500);
    const containers = Array.from(doc.querySelectorAll(containerSel)).slice(0, limitNum);

    return containers.map((container: any) => {
      const item: Record<string, any> = {};
      let requiredMissing = 0;
      const dedupeParts: string[] = [];
      for (const [fieldName, def] of Object.entries(fields)) {
        const fieldDef = def as any;
        const sel: string = String(fieldDef?.selector || '').trim();
        if (!sel) {
          item[fieldName] = null;
          if (fieldDef?.required) requiredMissing += 1;
          continue;
        }
        try {
          const el: any = container.querySelector(sel);
          if (!el) {
            item[fieldName] = null;
            if (fieldDef?.required) requiredMissing += 1;
            continue;
          }
          const extractType: string = String(fieldDef?.type || 'text').trim().toLowerCase();
          let value: any = null;
          if (extractType === 'href') value = el.href || el.getAttribute('href') || null;
          else if (extractType === 'src') value = el.src || el.getAttribute('src') || null;
          else if (extractType === 'attr') value = el.getAttribute(fieldDef.attribute || 'value') || null;
          else if (extractType === 'html') value = (el.innerHTML || '').trim().slice(0, 1000);
          else value = ((el.innerText || el.textContent || '').trim()).slice(0, 500);
          if ((value == null || String(value).trim() === '') && fieldDef?.required) requiredMissing += 1;
          item[fieldName] = value;
          if (value != null && String(value).trim()) {
            dedupeParts.push(`${fieldName}:${String(value).replace(/\s+/g, ' ').trim().slice(0, 240)}`);
          }
        } catch {
          item[fieldName] = null;
          if (fieldDef?.required) requiredMissing += 1;
        }
      }
      const containerText = String(container?.innerText || container?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);
      return {
        item,
        meta: {
          requiredMissing,
          containerText,
          dedupeSource: dedupeParts.join('|') || containerText.slice(0, 500),
        },
      };
    });
  }, payload);
}

function broadcastBrowserKnowledgeSnapshot(
  sessionId: string,
  url: string,
  site: BrowserSiteKnowledge,
  payload: { action: string; savedKind?: 'element' | 'item_root' | 'schema'; saved?: any },
): void {
  try {
    broadcastWS({
      type: 'browser:knowledge',
      action: payload.action,
      sessionId,
      url,
      site: site.hostname,
      savedKind: payload.savedKind,
      saved: payload.saved,
      elements: site.elements,
      itemRoots: site.itemRoots,
      extractionSchemas: site.extractionSchemas,
      timestamp: Date.now(),
    });
  } catch {
    // Best-effort UI sync only.
  }
}

export async function getBrowserNamedElementsForSession(sessionId: string, restoreHint?: BrowserSessionRestoreHint): Promise<null | {
  sessionId: string;
  url: string;
  site: string;
  title: string;
  active: boolean;
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  streamActive: boolean;
  streamTransport: 'cdp' | 'snapshot' | '';
  streamFocus: BrowserLiveStreamFocus;
  frameBase64: string;
  frameWidth: number;
  frameHeight: number;
  elements: BrowserKnowledgeElement[];
  itemRoots: BrowserKnowledgeItemRoot[];
  extractionSchemas: BrowserKnowledgeExtractionSchema[];
}> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved) || await getOrCreateSession(resolved, restoreHint).catch(() => null);
  if (!session) return null;
  const liveStream = browserLiveStreams.get(resolved);
  const url = String(session.page.url() || '').trim();
  const shot = getLastBrowserScreenshot(resolved) || await browserVisionScreenshot(resolved).catch(() => null);
  const title = await session.page.title().catch(() => '');
  return {
    sessionId: resolved,
    url,
    site: (() => {
      try {
        return String(new URL(url).hostname || '').replace(/^www\./i, '').toLowerCase();
      } catch {
        return '';
      }
    })(),
    title: String(title || ''),
    active: true,
    mode: getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved)).mode,
    captured: getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved)).captured,
    controlOwner: getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved)).controlOwner,
    streamActive: liveStream?.active === true,
    streamTransport: liveStream?.transport || '',
    streamFocus: liveStream?.focus || 'passive',
    frameBase64: String(shot?.base64 || ''),
    frameWidth: Number(shot?.width || 0),
    frameHeight: Number(shot?.height || 0),
    elements: listNamedBrowserElementsForUrl(url),
    itemRoots: listNamedBrowserItemRootsForUrl(url),
    extractionSchemas: listNamedBrowserExtractionSchemasForUrl(url),
  };
}

export async function saveBrowserNamedElement(
  sessionId: string,
  payload: { name?: string; selector?: string; tagName?: string; id?: string; text?: string; url?: string; kind?: 'element' | 'item_root' },
): Promise<{
  sessionId: string;
  url: string;
  site: string;
  kind: 'element' | 'item_root';
  elements: BrowserKnowledgeElement[];
  itemRoots: BrowserKnowledgeItemRoot[];
  extractionSchemas: BrowserKnowledgeExtractionSchema[];
  saved: BrowserKnowledgeElement | BrowserKnowledgeItemRoot;
}> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) throw new Error('No browser session. Use browser_open first.');
  const url = String(session.page.url() || payload?.url || '').trim();
  const kind = String(payload?.kind || 'element').trim().toLowerCase() === 'item_root' ? 'item_root' : 'element';
  const { site, saved } = (() => {
    const saveFn = kind === 'item_root' ? saveNamedBrowserItemRootForUrl : saveNamedBrowserElementForUrl;
    const result = saveFn(url, {
      name: String(payload?.name || '').trim(),
      selector: String(payload?.selector || '').trim(),
      tagName: String(payload?.tagName || '').trim(),
      id: String(payload?.id || '').trim(),
      text: String(payload?.text || '').trim(),
      url,
    });
    return { site: result.site, saved: result.saved };
  })();
  return {
    sessionId: resolved,
    url,
    site: site.hostname,
    kind,
    elements: site.elements,
    itemRoots: site.itemRoots,
    extractionSchemas: site.extractionSchemas,
    saved,
  };
}

export async function browserInspectPoint(
  sessionId: string,
  x: number,
  y: number,
): Promise<null | {
  sessionId: string;
  url: string;
  title: string;
  selector: string;
  tagName: string;
  id: string;
  classList: string[];
  text: string;
  htmlSnippet: string;
  bounds: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return null;
  const px = Math.round(Number(x) || 0);
  const py = Math.round(Number(y) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  try {
    const inspected = await session.page.evaluate((point: { x: number; y: number }) => {
      const pointX = Number(point?.x || 0);
      const pointY = Number(point?.y || 0);
      const doc = (globalThis as any).document as any;
      const raw = doc.elementFromPoint(pointX, pointY) as any;
      if (!raw) return null;
      const viewportWidth = Math.round((globalThis as any).innerWidth || 0);
      const viewportHeight = Math.round((globalThis as any).innerHeight || 0);
      const readRole = (node: any) => String(node?.getAttribute?.('role') || '').trim().toLowerCase();
      const readText = (node: any) => String((node?.innerText || node?.textContent || '')).replace(/\s+/g, ' ').trim();
      const readRect = (node: any) => {
        const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
        return {
          left: Math.round(Number(rect?.left || 0)),
          top: Math.round(Number(rect?.top || 0)),
          width: Math.max(0, Math.round(Number(rect?.width || 0))),
          height: Math.max(0, Math.round(Number(rect?.height || 0))),
        };
      };
      const hasStableAttrs = (node: any) => {
        if (!node || typeof node !== 'object') return false;
        return Boolean(
          String(node.id || '').trim()
          || String(node.getAttribute?.('data-testid') || '').trim()
          || String(node.getAttribute?.('aria-label') || '').trim()
          || String(node.getAttribute?.('name') || '').trim()
          || String(node.getAttribute?.('placeholder') || '').trim()
          || String(node.getAttribute?.('title') || '').trim()
        );
      };
      const isInteractive = (node: any) => {
        const tagName = String(node?.tagName || '').toLowerCase();
        const role = readRole(node);
        if (!tagName) return false;
        if (node?.isContentEditable) return true;
        if (['button', 'a', 'input', 'textarea', 'select', 'option', 'label', 'summary'].includes(tagName)) return true;
        return ['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem'].includes(role);
      };
      const noisyLeafTags = new Set(['path', 'svg', 'use', 'g', 'circle', 'rect', 'polygon', 'span', 'strong', 'em', 'b', 'i', 'small', 'time']);
      const isReasonableBox = (node: any, rawRect: { width: number; height: number }) => {
        const rect = readRect(node);
        if (rect.width < 18 || rect.height < 14) return false;
        if (rect.width > viewportWidth * 0.94 || rect.height > viewportHeight * 0.72) return false;
        const rawArea = Math.max(1, rawRect.width * rawRect.height);
        const area = rect.width * rect.height;
        if (area > rawArea * 36 && area > 160000) return false;
        return true;
      };
      const rawRect = readRect(raw);
      const lineage: any[] = [];
      let cursor = raw;
      let depth = 0;
      while (cursor && depth < 7) {
        const tagName = String(cursor?.tagName || '').toLowerCase();
        if (!tagName || tagName === 'body' || tagName === 'html') break;
        lineage.push(cursor);
        cursor = cursor.parentElement;
        depth += 1;
      }
      const semantic = lineage.find((node) => isInteractive(node) && isReasonableBox(node, rawRect));
      const stable = lineage.find((node, idx) => idx <= 3 && hasStableAttrs(node) && isReasonableBox(node, rawRect));
      const structural = lineage.find((node, idx) => {
        if (idx === 0) return false;
        const tagName = String(node?.tagName || '').toLowerCase();
        if (!tagName || noisyLeafTags.has(tagName)) return false;
        return isReasonableBox(node, rawRect);
      });
      const el = (semantic || stable || structural || raw) as any;
      const rect = el.getBoundingClientRect();
      const readNode = (node: any) => {
        if (!node || typeof node !== 'object') return null;
        const tagName = String(node.tagName || '').toLowerCase();
        if (!tagName) return null;
        const id = String(node.id || '').trim();
        const classList = Array.from(node.classList || []).map((value) => String(value || '').trim()).filter(Boolean);
        let siblingIndex = 0;
        if (node.parentElement) {
          const siblings = Array.from(node.parentElement.children || []).filter((candidate: any) => String(candidate?.tagName || '').toLowerCase() === tagName);
          const idx = siblings.indexOf(node);
          siblingIndex = idx >= 0 ? idx + 1 : 0;
        }
        return { tagName, id, classList, siblingIndex };
      };
      const parentChain: Array<{ tagName: string; id: string; classList: string[]; siblingIndex: number }> = [];
      let parentCursor = el.parentElement;
      while (parentCursor && parentChain.length < 4) {
        const entry = readNode(parentCursor);
        if (!entry) break;
        parentChain.unshift(entry);
        if (entry.id) break;
        parentCursor = parentCursor.parentElement;
      }
      const current = readNode(el);
      const text = String((el.innerText || el.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 240);
      return {
        ...current,
        parentChain,
        text,
        htmlSnippet: String(el.outerHTML || '').slice(0, 800),
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        viewport: {
          width: viewportWidth,
          height: viewportHeight,
        },
      };
    }, { x: px, y: py });
    if (!inspected || !inspected.tagName) return null;
    const selector = buildBrowserElementSelector(inspected);
    return {
      sessionId: resolved,
      url: String(session.page.url() || ''),
      title: String((await session.page.title().catch(() => '')) || ''),
      selector,
      tagName: String(inspected.tagName || ''),
      id: String(inspected.id || ''),
      classList: Array.isArray(inspected.classList) ? inspected.classList : [],
      text: String(inspected.text || ''),
      htmlSnippet: String(inspected.htmlSnippet || ''),
      bounds: inspected.bounds,
      viewport: inspected.viewport,
    };
  } catch {
    return null;
  }
}

// Cleanup on process exit
process.on('exit', () => {
  for (const [, session] of sessions) {
    try { session.page.close(); } catch {}
  }
});

// ─── Preview Screenshot ───────────────────────────────────────────────────────
// Used by the Telegram file browser to render a visual preview of any workspace
// file. Completely isolated from the main chat browser session — opens a fresh
// page, screenshots it in chunks, then immediately closes the page.
// Chrome is auto-launched if it isn't running (same path as normal browser tools).

export interface PreviewChunk {
  index: number;       // 0-based chunk number
  total: number;       // total number of chunks
  base64: string;      // PNG encoded as base64
  width: number;
  height: number;      // actual height of this chunk (last chunk may be smaller)
}

/**
 * Take a full-page screenshot of a URL and return it as an array of vertical
 * chunks so long pages can be sent as a Telegram photo album.
 *
 * @param url         The URL to screenshot (typically the /preview route)
 * @param chunkHeight Height in px of each chunk (default 1200)
 * @param maxChunks   Maximum chunks to return (default 10 = up to ~12000px)
 */
export async function browserPreviewScreenshot(
  url: string,
  chunkHeight = 1200,
  maxChunks = 10,
): Promise<PreviewChunk[]> {
  // Get (or launch) Chrome using the same logic as normal browser tools.
  // Using a dedicated session ID keeps this page completely separate from
  // any active user browser session.
  const PREVIEW_SESSION = '__preview_internal__';
  const session = await getOrCreateSession(PREVIEW_SESSION);

  // Always open a BRAND NEW page — never reuse the session's shared page.
  // This ensures zero interference with the user's active browsing session.
  const page: PwPage = await session.context.newPage();

  try {
    // Clean 1280px viewport — matches a standard desktop browser width.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    // Brief settle to let fonts/images render fully
    await page.waitForTimeout(400);

    // Get the full rendered page height — use the maximum of several measures
    // because some pages (e.g. 100vh layouts) return a small scrollHeight.
    const fullHeight: number = await page.evaluate(`
      Math.max(
        document.documentElement.scrollHeight || 0,
        document.documentElement.clientHeight || 0,
        document.body ? document.body.scrollHeight : 0,
        document.body ? document.body.offsetHeight : 0
      )
    `);
    const viewportWidth = 1280;
    const viewportHeight = 900;
    // Clamp: if the page reports a tiny or zero height, fall back to viewport height
    const effectiveHeight = Math.max(fullHeight, viewportHeight);
    const safeChunkHeight = Math.max(200, Math.min(2000, chunkHeight));
    const totalChunks = Math.min(maxChunks, Math.ceil(effectiveHeight / safeChunkHeight));

    const chunks: PreviewChunk[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const scrollY = i * safeChunkHeight;
      // Never let the chunk extend past the effective page height
      const thisChunkHeight = Math.min(safeChunkHeight, effectiveHeight - scrollY);
      if (thisChunkHeight <= 0) break;

      // Scroll so the chunk we want is at the TOP of the viewport
      await page.evaluate(`window.scrollTo(0, ${scrollY})`);
      await page.waitForTimeout(80);

      // Resize viewport to exactly the chunk height so the screenshot
      // captures only this slice — clip coords are always viewport-relative
      // so we set the viewport to match the chunk height instead of clipping
      await page.setViewportSize({ width: viewportWidth, height: thisChunkHeight });

      const buf: Buffer = await page.screenshot({ type: 'png' });

      // Restore viewport for next iteration
      await page.setViewportSize({ width: viewportWidth, height: safeChunkHeight });

      chunks.push({
        index: i,
        total: totalChunks,
        base64: buf.toString('base64'),
        width: viewportWidth,
        height: thisChunkHeight,
      });
    }

    return chunks;
  } finally {
    // Always close this temporary page — never leave it open in Chrome
    try { await page.close(); } catch {}
  }
}

// ─── X/Twitter Thread Scraper ─────────────────────────────────────────────────
// Detects X URLs and scrapes tweet thread data using snapshots + deltas.

interface ExtractedTweet {
  text?: string;
  author?: string;
  handle?: string;
  timestamp?: string;
  metrics?: {
    likes?: string;
    replies?: string;
    reposts?: string;
    views?: string;
  };
  hasImage?: boolean;
  hasVideo?: boolean;
  media?: Array<{
    type: 'image' | 'video';
    url?: string;
    previewUrl?: string;
  }>;
  id?: string;
  link?: string;
  inReplyTo?: string;
  rawRef?: string;
}

interface XSnapshotDelta {
  pass: number;
  scrollY: number;
  added: string[];
  removed: string[];
  totalElements: number;
}

function mapBrowserFeedToExtractedTweets(feed: BrowserFeedItem[]): ExtractedTweet[] {
  return feed
    .filter((item) => item.source === 'x' && (item.text || item.link))
    .map((item) => ({
      id: item.id,
      link: item.link,
      author: item.author,
      handle: item.handle,
      timestamp: item.time,
      text: item.text,
      hasImage: item.hasImage,
      hasVideo: item.hasVideo,
      media: item.media,
      rawRef: item.id || item.link,
      metrics: item.metrics
        ? {
            likes: item.metrics.likes,
            replies: item.metrics.replies,
            reposts: item.metrics.reposts,
            views: item.metrics.views,
          }
        : undefined,
    }));
}

function buildSnapshotDelta(prevSnapshot: string, newSnapshot: string, pass: number, scrollY: number): XSnapshotDelta {
  const toElemSet = (snap: string) => new Set(snap.split('\n').filter(line => line.includes('@')));
  const prevSet = toElemSet(prevSnapshot);
  const newSet = toElemSet(newSnapshot);
  return {
    pass,
    scrollY,
    added: [...newSet].filter(line => !prevSet.has(line)).slice(0, 80),
    removed: [...prevSet].filter(line => !newSet.has(line)).slice(0, 80),
    totalElements: newSet.size,
  };
}

export async function fetchXThread(sessionId: string, url: string): Promise<string> {
  // Use unique session ID for X scraping, isolated from main session
  const xSessionId = `x_scrape_${Date.now()}`;
  const resolvedXSessionId = resolveSessionId(xSessionId);
  const tweets: ExtractedTweet[] = [];
  const snapshotDeltas: XSnapshotDelta[] = [];
  const seen = new Set<string>();
  const tweetKey = (tweet: ExtractedTweet): string => String(
    tweet.id || tweet.link || `${tweet.handle || ''}|${tweet.text || ''}`,
  ).replace(/\s+/g, ' ').trim().toLowerCase();
  const appendNewTweets = (items: ExtractedTweet[]): number => {
    let added = 0;
    for (const tweet of items) {
      const key = tweetKey(tweet);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tweets.push(tweet);
      added += 1;
    }
    return added;
  };

  try {
    const session = await getOrCreateSession(resolvedXSessionId);
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await Promise.race([
      session.page.waitForSelector('article[data-testid="tweet"]', { timeout: 2500 }).catch(() => null),
      session.page.waitForTimeout(900),
    ]);

    const captureTweets = async (): Promise<ExtractedTweet[]> => {
      const structured = await extractStructuredFromPage(session.page, 40);
      return mapBrowserFeedToExtractedTweets(structured.extractedFeed || []);
    };

    // Initial structured extraction
    appendNewTweets(await captureTweets());
    let previousSnapshot = await takeSnapshot(session.page, 80);
    rememberSnapshot(session, previousSnapshot);

    // Scroll and capture deltas (max 4 scrolls). Stop once scrolling stops
    // producing new unique tweets; X virtualizes old articles, so raw visible
    // tweet count alone is not a useful progress signal.
    let emptyPasses = 0;
    for (let i = 0; i < 4; i++) {
      const prevScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      await session.page.evaluate(() => {
        const pageGlobal = globalThis as any;
        pageGlobal.scrollBy(0, Number(pageGlobal.innerHeight || 0) * 1.2);
      });
      await session.page.waitForTimeout(i === 0 ? 900 : 650);

      const newTweets = await captureTweets();
      const added = appendNewTweets(newTweets);
      const currentScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      const nextSnapshot = await takeSnapshot(session.page, 80);
      snapshotDeltas.push(buildSnapshotDelta(previousSnapshot, nextSnapshot, i + 1, currentScrollY));
      previousSnapshot = nextSnapshot;
      rememberSnapshot(session, nextSnapshot);

      if (added === 0) emptyPasses += 1;
      else emptyPasses = 0;

      if (emptyPasses >= 2 || currentScrollY === prevScrollY) {
        break;
      }
    }

    return JSON.stringify({
      success: true,
      url,
      tweets,
      count: tweets.length,
      snapshot_deltas: snapshotDeltas,
      message: `Captured ${tweets.length} tweets from X thread`,
    });
  } catch (err: any) {
    return JSON.stringify({
      success: false,
      url,
      error: err?.message || String(err),
    });
  } finally {
    // ALWAYS close the browser session, even on error
    try {
      await browserClose(xSessionId);
    } catch {
      // Silent fail — browser may have already closed
    }
  }
}
