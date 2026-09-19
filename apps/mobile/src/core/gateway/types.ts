export interface GatewayDescriptor {
  id: string;
  name: string;
  origin: string;
}

export interface GatewayConnection extends GatewayDescriptor {
  /** Device grant issued by this gateway's pairing flow. Never shared across gateways. */
  token: string;
}

export interface SessionSummary {
  id: string;
  title?: string;
  channel?: string;
  createdAt?: number;
  lastActiveAt?: number;
  lastAssistantAt?: number | null;
  pinnedAt?: number | null;
  settledAt?: number | null;
  settled?: boolean;
  mobileUnread?: boolean;
  [key: string]: unknown;
}

export interface SessionListResult {
  sessions: SessionSummary[];
  total: number;
}

export interface SessionHistoryPage<TItem = unknown> {
  sessionId: string;
  items: TItem[];
  pageInfo: {
    olderCursor?: string | null;
    hasOlder?: boolean;
    totalCount?: number;
    startIndex?: number;
    endIndex?: number;
    [key: string]: unknown;
  };
}

export interface SessionRecord extends SessionSummary {
  history?: unknown[];
  processLog?: unknown[];
  historyPage?: SessionHistoryPage['pageInfo'];
  historyTruncated?: boolean;
  totalHistoryCount?: number;
  voiceRoom?: unknown;
}

export interface CreateSessionInput {
  id?: string;
  title?: string;
}

export interface ChatAttachment {
  name: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface ChatRequest {
  message: string;
  sessionId: string;
  clientRequestId?: string;
  attachments?: ChatAttachment[];
  attachmentPreviews?: unknown[];
  callerContext?: string;
  excludedSkillIds?: string[];
  selectedSkillIds?: string[];
}
