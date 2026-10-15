
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


export type PwBrowser = any;
export type PwContext = any;
export type PwPage = any;
export type BrowserProfileKind = 'prometheus' | 'user' | 'inhouse';

export type BrowserConsoleEntry = {
  source: 'playwright_console' | 'playwright_pageerror' | 'playwright_crash' | 'in_page';
  level: string;
  message: string;
  ts: number;
  url?: string;
  location?: any;
};

export interface BrowserSession {
  sessionId: string;
  browser: PwBrowser;
  context: PwContext;
  page: PwPage;
  ownsBrowser: boolean;
  isolated: boolean;
  debugPort?: number;
  profileDir?: string;
  profileKind: BrowserProfileKind;
  browserTarget: BrowserProfileKind;
  /** Personal Chrome is extension/debugger backed, never a real-profile CDP port. */
  transport?: 'cdp' | 'extension';
  lastSnapshot: string;
  lastSnapshotAt: number;  // epoch ms when lastSnapshot was captured; 0 = never
  lastPageUrl: string;
  lastPageTitle: string;
  consoleEntries: BrowserConsoleEntry[];
  injectedStaticContext: Partial<Record<'shortcuts' | 'knowledge' | 'control', {
    key: string;
    hash: string;
    shownAt: number;
  }>>;
  createdAt: number;
}

export interface InHouseBrowserSession {
  sessionId: string;
  profileId: string;
  url: string;
  title: string;
  activeTabId: string;
  tabs: Array<{
    id: string;
    index: number;
    title: string;
    url: string;
    loading: boolean;
    active: boolean;
    canGoBack?: boolean;
    canGoForward?: boolean;
  }>;
  lastSnapshot: string;
  lastSnapshotAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface BrowserSessionMetadata {
  sessionId: string;
  ownerType: 'main' | 'background' | 'task' | 'team-agent' | 'detached';
  ownerId?: string;
  /** Internal resource-store scope; never exposed in browser UI payloads. */
  workspacePath?: string;
  label?: string;
  taskPrompt?: string;
  spawnerSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedBrowserSessionRecord {
  sessionId: string;
  url: string;
  title: string;
  updatedAt: number;
}

export interface BrowserSessionRestoreHint {
  url?: string;
  title?: string;
}

export type BrowserPerformanceObserver = (
  stage: string,
  fields?: Record<string, number | string | boolean>,
) => void;

export function markBrowserPerformance(
  observer: BrowserPerformanceObserver | undefined,
  stage: string,
  fields: Record<string, number | string | boolean> = {},
): void {
  try { observer?.(stage, fields); } catch { /* telemetry must not affect browser semantics */ }
}

export function classifyBrowserLifecycleError(error: unknown): string {
  const message = String((error as any)?.message || error || '').toLowerCase();
  if (/personal chrome.*extension|extension.*not connected|extension.*onboarding/.test(message)) return 'extension_unavailable';
  if (/target page|target closed|page.*closed|context.*closed|browser.*closed|disconnected/.test(message)) return 'session_closed';
  if (/timeout|timed out/.test(message)) return 'timeout';
  if (/debug port|cdp|connect|attach/.test(message)) return 'cdp_attach';
  if (/net::|navigation|url/.test(message)) return 'navigation';
  return 'unknown';
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

export interface BrowserInteractionState {
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
  profileKind?: BrowserProfileKind;
  browserTarget?: BrowserProfileKind;
  profileLabel?: string;
  inhouseProfile?: string;
  activeTabId?: string;
  tabs?: Array<{
    id: string;
    index: number;
    title: string;
    url: string;
    loading: boolean;
    active: boolean;
    canGoBack?: boolean;
    canGoForward?: boolean;
  }>;
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

export interface SnapElement {
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
  imageUrl?: string;
  publisher?: string;
  publishedAt?: string;
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

export interface BrowserScrollSnapshotDelta {
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
