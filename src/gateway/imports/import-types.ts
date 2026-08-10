/**
 * P11-37 external import contracts.
 *
 * Import records are intentionally separate from the live chat runtime.  A
 * normalized historical event is data, never an instruction to execute a
 * tool, spawn a process, or contact a provider.
 */

export type ImportJobKind = 'conversation' | 'setup';
export type ConversationImportMode = 'sessions' | 'projects';

export interface ImportSourceBatch {
  id: string;
  label: string;
  sourceFiles: string[];
  transcriptCount: number;
  bytes: number;
  previewable: boolean;
  previewBlockReason?: string;
}

export type ImportJobStatus =
  | 'staging'
  | 'parsing'
  | 'preview_ready'
  | 'committing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'rolled_back'
  | 'deleted';

export type ImportAdapterId =
  | 'chatgpt-export'
  | 'generic-json'
  | 'generic-jsonl'
  | 'generic-markdown'
  | 'codex-local'
  | 'claude-code-local'
  | 'cursor-local'
  | 'hermes-local'
  | 'openclaw-local'
  | 'localclaw-local'
  | 'setup-config'
  | 'unsupported';

export interface ImportSourceIdentity {
  provider: string;
  adapter: ImportAdapterId;
  sourceLabel: string;
  sourceAccountId?: string;
  sourceConversationId?: string;
  sourceSessionKey?: string;
  sourceFile?: string;
  inputDigest: string;
  importedAt: string;
}

export interface ImportedHistoricalEvent {
  id: string;
  type: 'tool_call' | 'tool_result' | 'reasoning' | 'status' | 'browser' | 'artifact' | 'subagent' | 'system';
  timestamp: number;
  name?: string;
  inputPreview?: string;
  resultPreview?: string;
  content?: string;
  sourceMessageId?: string;
  sourceEventId?: string;
  provider?: string;
  model?: string;
  /** Always true for imported events. This is a defense-in-depth marker. */
  historicalOnly: true;
  metadata?: Record<string, unknown>;
}

export interface ImportedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sourceMessageId?: string;
  provider?: string;
  model?: string;
  reasoningSummary?: string;
  events?: ImportedHistoricalEvent[];
  metadata?: Record<string, unknown>;
}

export interface ImportedResource {
  id: string;
  kind: 'file' | 'image' | 'link' | 'web_page' | 'browser_page' | 'artifact' | 'tool_result';
  title: string;
  mimeType?: string;
  url?: string;
  relativePath?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  sourceMessageId?: string;
  sensitive?: boolean;
}

export interface ImportedProjectReference {
  /** Stable source-scoped identity used to group sessions during import. */
  sourceProjectId: string;
  name: string;
  /** Source working directory when the adapter exposes one. */
  sourcePath?: string;
  /** Set when the source path can safely be linked as a Prometheus workspace. */
  workspacePath?: string;
  metadata?: Record<string, unknown>;
}

export interface ImportedConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: ImportSourceIdentity;
  messages: ImportedMessage[];
  events: ImportedHistoricalEvent[];
  resources: ImportedResource[];
  project?: ImportedProjectReference;
  metadata?: Record<string, unknown>;
}

export interface SetupSecretNotice {
  serverId?: string;
  key: string;
  reason: 'credential_redacted' | 'reauthorization_required' | 'unsupported_secret';
}

export interface ImportedMcpServer {
  id: string;
  config: Record<string, unknown>;
  sourceFile: string;
  secretNotices: SetupSecretNotice[];
}

export interface ImportedSetupFile {
  relativePath: string;
  category: 'memory' | 'skill' | 'agent_instructions' | 'permissions' | 'connector' | 'config' | 'unknown';
  size: number;
  sha256: string;
  activation: 'inactive_snapshot' | 'review_required' | 'not_applied';
}

export interface ImportedSetup {
  source: ImportSourceIdentity;
  mcpServers: ImportedMcpServer[];
  files: ImportedSetupFile[];
  secretNotices: SetupSecretNotice[];
  warnings: string[];
}

export interface ImportPreview {
  adapter: ImportAdapterId;
  provider: string;
  sourceLabel: string;
  sourceDigest: string;
  conversationMode?: ConversationImportMode;
  conversations: number;
  projects: number;
  messages: number;
  historicalEvents: number;
  resources: number;
  setupFiles: number;
  mcpServers: number;
  secretsRedacted: number;
  conflicts: number;
  warnings: string[];
  unsupported?: boolean;
  unsupportedReason?: string;
  conversationSummariesTotal?: number;
  conversationSummariesTruncated?: boolean;
  conversationSummaries: Array<{
    id: string;
    title: string;
    projectName?: string;
    messages: number;
    events: number;
    resources: number;
    createdAt: number;
    updatedAt: number;
  }>;
  projectSummaries: Array<{
    id: string;
    name: string;
    sourcePath?: string;
    conversations: number;
    messages: number;
    events: number;
  }>;
}

export interface ImportJobProgress {
  phase: ImportJobStatus;
  completed: number;
  total: number;
  message?: string;
  checkpoint?: string;
}

export interface ImportJobResult {
  sessionIds: string[];
  projectIds: string[];
  createdProjectIds: string[];
  resourceIds: string[];
  createdResourceIds: string[];
  mcpServerIds: string[];
  setupSnapshotPath?: string;
  skipped: number;
  conflicts: number;
  failures: string[];
  rolledBackAt?: string;
}

export interface ExternalImportBinding {
  version: 1;
  jobId: string;
  dedupeKey: string;
  source: ImportSourceIdentity;
  continuation: 'prometheus';
  sourceResume: 'unsupported';
  importedMessageCount: number;
  importedEventCount: number;
  importedResourceCount: number;
  importedAt: string;
}

export interface ImportJob {
  schemaVersion: 1;
  id: string;
  ownerId: string;
  workspacePath: string;
  kind: ImportJobKind;
  conversationMode?: ConversationImportMode;
  status: ImportJobStatus;
  adapter: ImportAdapterId;
  provider: string;
  sourceLabel: string;
  sourceDigest: string;
  stagedPath: string;
  normalizedPath?: string;
  createdAt: string;
  updatedAt: string;
  progress: ImportJobProgress;
  preview?: ImportPreview;
  /** Explicit chat selection captured at confirmation time. Omitted means legacy/API import-all behavior. */
  selectedConversationIds?: string[];
  setup?: ImportedSetup;
  result?: ImportJobResult;
  error?: string;
  checkpoint?: string;
  backupPath?: string;
  /** The original path is intentionally not persisted or returned. */
  sourcePathProvided: boolean;
  sourceAccountId?: string;
  /** Setup conflict policy captured at preview time; credentials are never included. */
  overwrite?: boolean;
}
