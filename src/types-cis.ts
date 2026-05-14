
// ─── CIS Phase 1: Business Brain Types ───────────────────────────────────────────
// Added by CIS implementation. All additive — no existing types modified.

export interface EntityFile {
  /** Entity type: client, project, vendor, contact, social */
  type: 'client' | 'project' | 'vendor' | 'contact' | 'social';
  /** Slug-style ID matching the filename (e.g. "acme-corp") */
  id: string;
  /** Absolute path to the entity markdown file */
  path: string;
  /** Display name extracted from the file heading */
  name: string;
  /** ISO timestamp of last write */
  lastUpdated: string;
}

export interface IntegrationConnection {
  /** Unique ID for this connection (e.g. "gmail_primary") */
  id: string;
  /** Platform identifier */
  platform: 'gmail' | 'outlook' | 'slack' | 'teams' | 'salesforce' | 'hubspot' |
            'notion' | 'github' | 'jira' | 'linear' | 'stripe' | 'quickbooks' |
            'ga4' | 'instagram' | 'tiktok' | 'x' | 'linkedin' | 'facebook' |
            'google_drive' | 'dropbox' | 'reddit' | string;
  /** Human-readable display name */
  name: string;
  /** Whether this connection is currently active */
  enabled: boolean;
  /** vault:// reference for the OAuth token/API key */
  tokenRef: string;
  /** Permissions granted to Prometheus for this connection */
  permissions: IntegrationPermissions;
  /** ISO timestamp of last successful sync */
  lastSyncedAt?: string;
  /** TTL for cached data in minutes (default: 15) */
  cacheTtlMinutes?: number;
  /** Optional account identifier (e.g. email address) */
  accountId?: string;
}

export interface IntegrationPermissions {
  /** Can read data from this integration */
  read: boolean;
  /** Can draft/propose actions (shows to user for approval) */
  propose: boolean;
  /** Can execute write actions after user approval */
  commit: boolean;
  /** Can inject data into agent context automatically */
  injectContext: boolean;
}

export interface PolicyRule {
  /** Unique rule ID */
  id: string;
  /** Human-readable description */
  description: string;
  /** Tool name pattern to match (exact or glob-style: "send_*") */
  toolPattern: string;
  /** Optional additional conditions */
  conditions?: {
    /** Minimum numeric amount that triggers this rule */
    amount_gte?: number;
    /** Field in args to check the amount against */
    amount_field?: string;
    /** Message target types that trigger this rule */
    recipient_type?: ('external' | 'internal' | 'public')[];
    /** Keywords in args that trigger this rule */
    topic_match?: string[];
  };
  /** The policy tier this rule assigns */
  tier: 'read' | 'propose' | 'commit';
  /** Role required to approve commit-tier actions */
  approver_role?: 'user' | 'admin';
  /** Numeric risk score 0-100 */
  riskScore: number;
}

export interface AuditLogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Session that triggered this action */
  sessionId: string;
  /** Agent that executed the action */
  agentId?: string;
  /** Category of action */
  actionType: 'tool_call' | 'message_sent' | 'file_written' | 'approval_requested' | 'approval_resolved';
  /** Tool name if applicable */
  toolName?: string;
  /** Scrubbed tool arguments (secrets removed) */
  toolArgs?: Record<string, any>;
  /** Policy tier that was applied */
  policyTier?: 'read' | 'propose' | 'commit';
  /** Approval status if commit-tier */
  approvalStatus?: 'auto' | 'auto_allowed' | 'approved' | 'rejected' | 'pending';
  /** Brief summary of what happened */
  resultSummary?: string;
  /** Error message if the action failed */
  error?: string;
}
