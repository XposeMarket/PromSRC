/**
 * Connected (live) external agents: shared types.
 *
 * Prometheus acts only as the UI for the user's own installed agent (Codex in
 * stage 3). The agent keeps its own login, model, tools, sandbox, instructions
 * and sessions. See workspace plans/connected-agents-unified-devices/live/LIVE-CONTRACT.md.
 */

export type ExternalAgentId = 'codex' | 'claude-code' | 'openclaw' | 'hermes' | 'cursor';

export const EXTERNAL_AGENT_IDS: readonly ExternalAgentId[] = ['codex', 'claude-code', 'openclaw', 'hermes', 'cursor'];

export function isExternalAgentId(value: unknown): value is ExternalAgentId {
  return typeof value === 'string' && (EXTERNAL_AGENT_IDS as readonly string[]).includes(value);
}

export type ExternalAgentStatus =
  | 'not_installed'
  | 'found'
  | 'checking'
  | 'ready'
  | 'signed_out'
  | 'too_old'
  | 'unsupported'
  | 'error';

export interface ExternalAgentCapabilities {
  resume: boolean;
  interrupt: boolean;
  approvals: boolean;
  images: boolean;
  modelList: boolean;
}

export interface ExternalAgentSnapshot {
  id: ExternalAgentId;
  name: string;
  tile: string;
  detected: boolean;
  enabled: boolean;
  status: ExternalAgentStatus;
  statusText: string;
  fixHint?: string;
  version?: string;
  /** Never a token. Email is masked. */
  account?: { kind: string; label?: string };
  capabilities: ExternalAgentCapabilities;
  selectable: boolean;
  lastCheckedAt?: string;
}

export type ExternalItemKind = 'command' | 'file_change' | 'mcp_tool' | 'web_search' | 'plan' | 'other';

export type ExternalAgentEvent =
  | { type: 'state'; phase: 'starting' | 'resuming' | 'running' }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'item_started'; itemId: string; kind: ExternalItemKind; title: string; detail?: string }
  | { type: 'item_completed'; itemId: string; kind: ExternalItemKind; ok: boolean; summary: string; exitCode?: number; title?: string }
  | { type: 'usage'; usedTokens?: number; maxTokens?: number }
  | { type: 'notice'; text: string };

export type ExternalRequestKind = 'command' | 'file_change' | 'permissions' | 'question' | 'plan' | 'other';
export type ExternalRequestOptionKind = 'allow_once' | 'allow_session' | 'deny' | 'cancel' | 'answer';

export interface ExternalUserRequest {
  requestId: string;
  agentId: ExternalAgentId;
  sessionId: string;
  kind: ExternalRequestKind;
  title: string;
  detail: {
    command?: string;
    cwd?: string;
    reason?: string;
    preview?: string;
    files?: string[];
    /** Permission cards: every item an Allow button would grant, one readable line each. */
    grants?: string[];
    questions?: Array<{ id: string; prompt: string; options?: Array<{ id: string; label: string }>; multi?: boolean }>;
    raw?: unknown;
  };
  options: Array<{ id: string; label: string; kind: ExternalRequestOptionKind }>;
}

export interface ExternalUserResponse {
  optionId: string;
  answers?: Record<string, string[]>;
  text?: string;
}

export interface ExternalModelCatalog {
  models: Array<{ id: string; label: string; efforts?: string[] }>;
  currentModel?: string;
  unavailableReason?: string;
}

export interface ExternalTurnInput {
  /** Explicit user choice only; omitted preserves the harness's configuration. */
  model?: string;
  /** Explicit reasoning level reported by the harness for that model; omitted = harness default. */
  effort?: string;
  sessionId: string;
  upstreamSessionId?: string;
  cwd: string;
  text: string;
  images?: Array<{ path: string }>;
  signal: AbortSignal;
  emit: (event: ExternalAgentEvent) => void;
  /** Persist before the first upstream prompt. */
  onSessionBound?: (upstreamSessionId: string) => void;
  /** Request card id factory input: the adapter builds everything except requestId/agentId/sessionId. */
  requestUser: (
    req: Omit<ExternalUserRequest, 'requestId' | 'agentId' | 'sessionId'>,
    opts?: { signal?: AbortSignal; cancelResponse?: ExternalUserResponse },
  ) => Promise<ExternalUserResponse>;
}

export interface ExternalTurnResult {
  upstreamSessionId: string;
  upstreamTurnId?: string;
  status: 'completed' | 'interrupted' | 'failed';
  finalText: string;
  error?: string;
  model?: string;
  /** The stored upstream session could not be found on resume. */
  upstreamMissing?: boolean;
}

export type ExternalAgentVerifyResult = Pick<ExternalAgentSnapshot, 'status' | 'statusText' | 'fixHint' | 'version' | 'account' | 'capabilities'>;

export interface ExternalAgentAdapter {
  id: ExternalAgentId;
  name: string;
  tile: string;
  capabilities: ExternalAgentCapabilities;
  /** Cheap: is a program present? Opens no auth files, starts no session. */
  detect(): Promise<{ found: boolean; executable?: string }>;
  /** The agent's own status path (version + its own account check). Never reads tokens, never starts a login. */
  verify(): Promise<ExternalAgentVerifyResult>;
  listModels?(context: { cwd: string; upstreamSessionId?: string }): Promise<ExternalModelCatalog>;
  runTurn(input: ExternalTurnInput): Promise<ExternalTurnResult>;
  /** Stop every child process this adapter owns. */
  shutdown(): Promise<void>;
  /** True while a child process is alive (tests: no orphan after shutdown). */
  isRunning?(): boolean;
}

/** Persisted on the Prometheus session record (session.ts `externalAgent`). */
export interface ExternalAgentBinding {
  version: 1;
  selectedModel?: string;
  selectedEffort?: string;
  currentModel?: string;
  agentId: ExternalAgentId;
  cwd: string;
  upstreamSessionId?: string;
  boundAt: string;
  lastTurn?: { status: 'completed' | 'interrupted' | 'failed'; upstreamTurnId?: string; endedAt: string; error?: string; upstreamMissing?: boolean };
}

/** Compact form carried on session summaries. Never carries anything from the agent's auth. */
export interface ExternalAgentSummary {
  agentId: ExternalAgentId;
  cwd: string;
  hasUpstream: boolean;
  lastTurnStatus?: 'completed' | 'interrupted' | 'failed';
}

export function normalizeExternalAgentBinding(input: any): ExternalAgentBinding | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if (!isExternalAgentId(input.agentId)) return undefined;
  const cwd = String(input.cwd || '').trim().slice(0, 1000);
  if (!cwd) return undefined;
  const upstream = String(input.upstreamSessionId || '').trim().slice(0, 300);
  const last = input.lastTurn && typeof input.lastTurn === 'object' ? input.lastTurn : null;
  const lastStatus = last && ['completed', 'interrupted', 'failed'].includes(String(last.status)) ? String(last.status) as 'completed' | 'interrupted' | 'failed' : null;
  return {
    version: 1,
    agentId: input.agentId,
    cwd,
    ...(upstream ? { upstreamSessionId: upstream } : {}),
    ...(typeof input.selectedModel === 'string' && input.selectedModel.trim() ? { selectedModel: input.selectedModel.trim().slice(0, 200) } : {}),
    ...(typeof input.selectedEffort === 'string' && /^[a-z_-]{1,20}$/.test(input.selectedEffort) ? { selectedEffort: input.selectedEffort } : {}),
    ...(typeof input.currentModel === 'string' && input.currentModel.trim() ? { currentModel: input.currentModel.trim().slice(0, 200) } : {}),
    boundAt: String(input.boundAt || '').trim().slice(0, 40) || new Date().toISOString(),
    ...(lastStatus ? {
      lastTurn: {
        status: lastStatus,
        ...(last.upstreamMissing === true ? { upstreamMissing: true } : {}),
        ...(String(last.upstreamTurnId || '').trim() ? { upstreamTurnId: String(last.upstreamTurnId).trim().slice(0, 300) } : {}),
        endedAt: String(last.endedAt || '').trim().slice(0, 40) || new Date().toISOString(),
        ...(String(last.error || '').trim() ? { error: String(last.error).trim().slice(0, 300) } : {}),
      },
    } : {}),
  };
}

export function summarizeExternalAgentBinding(binding: ExternalAgentBinding | undefined | null): ExternalAgentSummary | undefined {
  if (!binding) return undefined;
  return {
    agentId: binding.agentId,
    cwd: binding.cwd,
    hasUpstream: !!binding.upstreamSessionId,
    ...(binding.lastTurn?.status ? { lastTurnStatus: binding.lastTurn.status } : {}),
  };
}

/** Cut text on code points: a lone UTF-16 surrogate makes Codex `turn/start` hang (T3 Code gotcha). */
export function sanitizeAgentText(value: string, maxChars = 200_000): string {
  const text = String(value ?? '');
  let out = '';
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        if (count + 2 > maxChars) break;
        out += text[i] + text[i + 1];
        count += 2;
        i += 1;
      }
      continue; // lone high surrogate: drop
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue; // lone low surrogate: drop
    if (count + 1 > maxChars) break;
    out += text[i];
    count += 1;
  }
  return out;
}

/** Mask an email: r***@gmail.com. */
export function maskEmail(value: unknown): string {
  const email = String(value || '').trim();
  const at = email.indexOf('@');
  if (at < 1) return '';
  return `${email[0]}***${email.slice(at)}`;
}
