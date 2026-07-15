export type WorkContextDomain = 'coding' | 'browser' | 'desktop' | 'creative' | 'generic';

export type WorkContextFreshness = 'fresh' | 'relocated' | 'stale' | 'unknown';

export interface WorkContextArtifact {
  kind: string;
  path?: string;
  url?: string;
  id?: string;
  hash?: string;
  bytes?: number;
  updatedAt: number;
}

export interface WorkContextTarget {
  kind: 'file' | 'symbol' | 'element' | 'window' | 'scene' | 'asset' | 'other';
  path?: string;
  name?: string;
  symbol?: string;
  anchors?: string[];
  hash?: string;
  lineHints?: number[];
  freshness: WorkContextFreshness;
  updatedAt: number;
}

export interface WorkContextStep {
  summary: string;
  status: 'completed' | 'failed' | 'pending' | 'blocked';
  toolName?: string;
  evidenceRef?: string;
  updatedAt: number;
}

export interface CodingWorkContext {
  root?: string;
  branch?: string;
  head?: string;
  packageManager?: string;
  dirtyFilesBefore: string[];
  dirtyFilesNow: string[];
  targets: WorkContextTarget[];
  buildDirectory?: string;
  buildCommand?: string;
  testCommand?: string;
  devCommand?: string;
  lastCheck?: {
    command?: string;
    exitCode?: number;
    passed: boolean;
    summary?: string;
    updatedAt: number;
  };
}

export interface BrowserWorkContext {
  browserSessionId?: string;
  profileKind?: string;
  profileLabel?: string;
  url?: string;
  title?: string;
  pageType?: string;
  contentHash?: string;
  controlOwner?: string;
  namedTargets: WorkContextTarget[];
  pendingCommitBoundary?: string;
  updatedAt: number;
}

export interface DesktopWorkContext {
  activeWindowHandle?: number;
  activeWindowTitle?: string;
  activeWindowProcessName?: string;
  activeMonitorIndex?: number;
  screenshotId?: string;
  contentHash?: string;
  semanticTargets: WorkContextTarget[];
  pendingCommitBoundary?: string;
  updatedAt: number;
}

export interface CreativeWorkContext {
  mode?: string;
  projectRoot?: string;
  projectLabel?: string;
  sceneId?: string;
  sceneVersion?: number;
  sceneHash?: string;
  compositionId?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  activeLayers: string[];
  sourceAssets: WorkContextTarget[];
  lastQa?: {
    passed: boolean;
    summary?: string;
    updatedAt: number;
  };
  renderSettings?: Record<string, string | number | boolean | null>;
  updatedAt: number;
}

export interface WorkContextPacket {
  version: 1;
  id: string;
  sessionId: string;
  revision: number;
  status: 'active' | 'completed' | 'blocked' | 'archived';
  activeDomain: WorkContextDomain;
  objective: string;
  objectiveFingerprint: string;
  createdAt: number;
  updatedAt: number;
  lastUserMessage?: string;
  nextSafeAction?: string;
  freshness: WorkContextFreshness;
  completedSteps: WorkContextStep[];
  pendingSteps: WorkContextStep[];
  evidenceRefs: string[];
  artifacts: WorkContextArtifact[];
  metrics: {
    startedAt: number;
    totalToolCalls: number;
    discoveryToolCalls: number;
    mutationToolCalls: number;
    verificationToolCalls: number;
    accumulatedToolMs: number;
    firstTargetAt?: number;
    firstMutationAt?: number;
    verifiedAt?: number;
    requestToVerifiedMs?: number;
    estimatedNonToolMs?: number;
  };
  coding?: CodingWorkContext;
  browser?: BrowserWorkContext;
  desktop?: DesktopWorkContext;
  creative?: CreativeWorkContext;
  generic: {
    relevantPaths: string[];
    decisions: string[];
    lastTool?: string;
    updatedAt: number;
  };
}

export interface WorkContextConfig {
  enabled: boolean;
  shadowMode: boolean;
  maxPacketBytes: number;
  maxAgeHours: number;
  fastPaths: Record<WorkContextDomain, boolean>;
}

export interface PreparedWorkContext {
  packet: WorkContextPacket | null;
  block: string;
  domain: WorkContextDomain;
  continuation: boolean;
  fastPathEligible: boolean;
  reason: string;
}
