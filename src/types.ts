// Core type definitions for Prometheus

export type JobStatus = 'queued' | 'planning' | 'executing' | 'verifying' | 'completed' | 'failed' | 'needs_approval';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type AgentRole = 'manager' | 'executor' | 'verifier';
export type VerificationStatus = 'approved' | 'rejected' | 'needs_approval';

export interface Job {
  id: string;
  title: string;
  description?: string;
  status: JobStatus;
  priority: number;
  created_at: number;
  updated_at: number;
  completed_at?: number;
  metadata?: Record<string, any>;
}

export interface Task {
  id: string;
  job_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assigned_to?: AgentRole;
  dependencies: string[]; // task IDs
  retry_count: number;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  acceptance_criteria: string[];
}

export interface Step {
  id: string;
  task_id: string;
  step_number: number;
  agent_role: AgentRole;
  tool_name?: string;
  tool_args?: Record<string, any>;
  result?: any;
  error?: string;
  created_at: number;
}

export interface Artifact {
  id: string;
  job_id: string;
  task_id?: string;
  type: 'file' | 'patch' | 'report' | 'code';
  path?: string;
  content: string;
  created_at: number;
}

export interface Approval {
  id: string;
  job_id: string;
  task_id: string;
  action: string;
  reason?: string;
  details?: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  resolved_at?: number;
}

export interface TaskState {
  job_id: string;
  mission: string;
  constraints: string[];
  plan: Task[];
  current_task: string | null;
  completed_tasks: string[];
  pending_tasks: string[];
  open_questions: string[];
  risks: string[];
  artifacts: Artifact[];
  steps: Array<{
    action: any;
    result: any;
  }>;
  feedback?: string[];
}

// Agent Output Types

export interface ManagerOutput {
  thought: string;
  plan: Array<{
    id: string;
    title: string;
    description: string;
    dependencies: string[];
    acceptance_criteria: string[];
    assigned_to: AgentRole;
  }>;
  risks: string[];
  requires_approval: boolean;
}

export interface ExecutorOutput {
  thought: string;
  tool?: string;
  args?: Record<string, any>;
  response?: string;
  artifacts?: string[];
}

export interface VerifierOutput {
  thought: string;
  status: VerificationStatus;
  issues?: string[];
  approval_reason?: string;
}

// Tool Types

export interface ToolResult {
  success: boolean;
  data?: any;
  artifacts?: any[];
  error?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface ToolPermissions {
  shell: {
    workspace_only: boolean;
    confirm_destructive: boolean;
    blocked_patterns: string[];
  };
  files: {
    allowed_paths: string[];
    blocked_paths: string[];
  };
  browser: {
    profile: string;
    headless: boolean;
  };
}

export interface AgentToolPolicy {
  /** Tool names to explicitly allow (supports "group:fs" shorthands) */
  allow?: string[];
  /** Tool names to explicitly deny */
  deny?: string[];
  /** Profile shorthand: "minimal" | "coding" | "web" | "full" */
  profile?: 'minimal' | 'coding' | 'web' | 'full';
}

export type AgentPersonalityHumor = 'none' | 'dry' | 'light' | 'playful' | 'sharp';
export type AgentPersonalityLevel = 'low' | 'balanced' | 'high';
export type AgentPersonalityWarmth = 'reserved' | 'steady' | 'warm';
export type AgentPersonalityDirectness = 'gentle' | 'balanced' | 'blunt';

export interface AgentPersonality {
  /** Preset key or freeform archetype, e.g. "steady", "critic", "spark" */
  archetype: string;
  /** Short natural-language voice summary */
  tone: string;
  humor: AgentPersonalityHumor;
  seriousness: AgentPersonalityLevel;
  warmth: AgentPersonalityWarmth;
  directness: AgentPersonalityDirectness;
  /** Subtle habits that make this agent recognizable without becoming a bit */
  quirks?: string[];
  /** Things this agent must not do in its voice/personality */
  avoid?: string[];
}

export interface AgentIdentity {
  /** Human-facing name used in prompts and UI */
  displayName: string;
  /** Optional shorter handle used in chat/team references */
  shortName?: string;
  /** Why Prometheus chose this name/style */
  namingRationale?: string;
  personality?: AgentPersonality;
  /** Extra prose guidance layered into system_prompt.md */
  voiceGuidelines?: string;
}

export interface AgentDefinition {
  /** Unique ID for this agent - used in bindings and spawn calls */
  id: string;

  /** Human-readable name shown in the UI */
  name: string;

  /** Short description - shown in UI, injected into orchestrator context */
  description?: string;

  /** Base preset role used to create a team subagent, e.g. researcher/analyst/operator */
  roleType?: string;

  /** Team-specific role title layered on top of the base preset, e.g. Website/SEO Qualifier */
  teamRole?: string;

  /** Team-specific assignment/mission for this agent within its managed team */
  teamAssignment?: string;

  /** Legacy metadata field; skill UI renders computer icons instead. */
  emoji?: string;

  /** Optional personality/name identity layer for this agent */
  identity?: AgentIdentity;

  /**
   * Absolute path to this agent's workspace directory.
   * If omitted, defaults to: <configDir>/../agents/<id>/workspace
   * The directory will be created automatically if it doesn't exist.
   */
  workspace?: string;

  /**
   * Optional workspace root used for file tools and command execution.
   * This is separate from `workspace`, which remains the agent's
   * identity/artifact directory.
   */
  executionWorkspace?: string;

  /**
   * Absolute or workspace-relative paths this agent is allowed to work in.
   * Defaults to the main workspace when omitted.
   */
  allowedWorkPaths?: string[];

  /**
   * Model override for this agent.
   * Format: "provider/model" e.g. "ollama/qwen3:4b" or "openai/gpt-4o"
   * If omitted, uses the global llm.provider + model.
   */
  model?: string;

  /** Tool policy for this agent - overrides global tool config */
  tools?: AgentToolPolicy;

  /**
   * If true, this agent is the default receiver for user chat sessions.
   * Only one agent should have default: true.
   * If none is set, the first agent in the list is used.
   */
  default?: boolean;

  /**
   * Channel bindings - which incoming messages route to this agent.
   * Simplified version of OpenClaw bindings.
   * Examples:
   *   { channel: "telegram", accountId: "default" }
   *   { channel: "telegram", peerId: "123456789" }
   */
  bindings?: Array<{
    channel: 'telegram' | 'discord' | 'whatsapp';
    accountId?: string;
    peerId?: string;
  }>;

  /**
   * Cron schedule for autonomous runs (POSIX cron syntax).
   * e.g. "0 8 * * *" = every day at 8am
   * Requires heartbeat.enabled = true in config.
   */
  cronSchedule?: string;

  /**
   * Maximum steps the reactor may take per run.
   * Defaults to global orchestration.maxSteps (8) or 8.
   */
  maxSteps?: number;

}

// ─── Agent Model Defaults ─────────────────────────────────────────────────────

/**
 * Per-type model defaults. When an agent of that type is spawned and has no
 * explicit model override, the matching default here is used before falling
 * back to the global primary model.
 *
 * Format for each value: "provider/model"
 * e.g. "anthropic/claude-haiku-4-5-20251001" or "openai/gpt-4o"
 * Leave a field undefined/empty to fall back to the global primary.
 */
export interface AgentModelDefaults {
  /** Main chat agent (user-facing conversation) */
  main_chat?: string;
  /** Proposal executors handling high-risk changes */
  proposal_executor_high_risk?: string;
  /** Proposal executors handling low-risk changes */
  proposal_executor_low_risk?: string;
  /** Team manager agents */
  manager?: string;
  /** Dedicated managed-team runtime */
  team_manager?: string;
  /** Team subagents */
  subagent?: string;
  /** Dedicated managed-team subagent runtime */
  team_subagent?: string;
  /** Background tasks / scheduled cron jobs */
  background_task?: string;
  /** Ephemeral background_spawn agents */
  background_agent?: string;
  /** Per-role planner subagents */
  subagent_planner?: string;
  /** Per-role orchestrator subagents */
  subagent_orchestrator?: string;
  /** Per-role researcher subagents */
  subagent_researcher?: string;
  /** Per-role analyst subagents */
  subagent_analyst?: string;
  /** Per-role builder subagents */
  subagent_builder?: string;
  /** Per-role operator subagents */
  subagent_operator?: string;
  /** Per-role verifier subagents */
  subagent_verifier?: string;
  /** Fast downshift tier used by switch_model */
  switch_model_low?: string;
  /** Careful downshift tier used by switch_model */
  switch_model_medium?: string;
  /** Meta-coordinator model */
  coordinator?: string;
}

export interface AgentModelDefaultTemplate {
  id: string;
  name: string;
  defaults: AgentModelDefaults;
  created_at: string;
  updated_at: string;
}

// Config Types

export interface PrometheusConfig {
  version: string;
  gateway: {
    port: number;
    host: string;
    auth: {
      enabled: boolean;
      token?: string;
    };
  };
  ollama: {
    endpoint: string;
    timeout: number;
    concurrency: {
      llm_workers: number;
      tool_workers: number;
    };
  };
  models: {
    primary: string;
    roles: {
      manager: string;
      executor: string;
      verifier: string;
    };
  };
  image_generation?: {
    provider?: string;
    model?: string;
    save_to_workspace?: boolean;
    default_output_dir?: string;
    providers?: Record<string, Record<string, unknown> | undefined>;
  };
  video_generation?: {
    provider?: string;
    model?: string;
    save_to_workspace?: boolean;
    default_output_dir?: string;
    duration?: number;
    resolution?: string;
    providers?: Record<string, Record<string, unknown> | undefined>;
  };
  /**
   * Per-agent-type model defaults. Consulted at spawn time when an agent has
   * no explicit model override. Falls back to models.primary if unset.
   */
  agent_model_defaults?: AgentModelDefaults;
  /**
   * Named snapshots of agent_model_defaults. The gateway and AI tools use
   * these to swap full routing presets without manually changing each slot.
   */
  agent_model_default_templates?: AgentModelDefaultTemplate[];
  active_agent_model_default_template?: string;
  tools: {
    enabled: string[];
    permissions: ToolPermissions;
  };
  skills: {
    directory: string;
    registries: string[];
    auto_update: boolean;
  };
  memory: {
    provider: string;
    path: string;
    embedding_model: string;
  };
  memory_options?: {
    auto_confirm?: boolean;
    audit?: boolean;
    truncate_length?: number;
  };
  heartbeat: {
    enabled: boolean;
    interval_minutes: number;
    workspace_file: string;
  };
  workspace: {
    path: string;
  };
  /**
   * Named agent definitions. The first agent with default:true (or the first
   * entry if none is marked) handles all unrouted user chat messages.
   * Leave empty to use single-agent mode (original behavior).
   */
  agents?: AgentDefinition[];
  session?: {
    maxMessages?: number;
    compactionThreshold?: number;
    memoryFlushThreshold?: number;
    /**
     * Rolling context compaction (message-window based).
     * When enabled, the gateway periodically summarizes the thread and resets
     * active chat history to the compact summary.
     */
    rollingCompactionEnabled?: boolean;
    /** Trigger compaction when this many non-summary messages are reached. */
    rollingCompactionMessageCount?: number;
    /** Number of recent assistant turns to include tool-log snippets from. */
    rollingCompactionToolTurns?: number;
    /** Max words requested from the compactor summary. */
    rollingCompactionSummaryMaxWords?: number;
    /** Optional model override for compaction (active provider model namespace). */
    rollingCompactionModel?: string;
    mainChatGoals?: {
      enabled?: boolean;
      autoResumeOnRestart?: boolean;
      summaryEveryTurns?: number;
      summaryMaxWords?: number;
      judgeModel?: string;
      compactionModel?: string;
      maxConsecutiveJudgeFailures?: number;
      maxConsecutiveRuntimeFailures?: number;
      permissions?: {
        approvalMode?: 'normal' | 'never';
        hardDenyEnabled?: boolean;
        recordDeniedActions?: boolean;
        denyDestructiveGit?: boolean;
        denyRemoteScriptExecution?: boolean;
        denyDesktopCredentialEntry?: boolean;
      };
    };
  };
  telegram?: {
    enabled: boolean;
    botToken: string;
    allowedUserIds: number[];
    streamMode: 'full' | 'partial';
    personas?: Record<string, {
      enabled?: boolean;
      agentId: string;
      botToken?: string;
      managedBotUserId?: number;
      botUsername?: string;
      allowedUserIds?: number[];
      groupChatIds?: number[];
      requireMentionInGroups?: boolean;
      streamMode?: 'full' | 'partial';
    }>;
    teamRooms?: Record<string, {
      enabled?: boolean;
      teamId: string;
      chatId: number;
      topicId?: number;
      title?: string;
      usePersonaIdentities?: boolean;
    }>;
  };
  channels?: {
    telegram?: {
      enabled: boolean;
      botToken: string;
      allowedUserIds: number[];
      streamMode: 'full' | 'partial';
      personas?: Record<string, {
        enabled?: boolean;
        agentId: string;
        botToken?: string;
        managedBotUserId?: number;
        botUsername?: string;
        allowedUserIds?: number[];
        groupChatIds?: number[];
        requireMentionInGroups?: boolean;
        streamMode?: 'full' | 'partial';
      }>;
      teamRooms?: Record<string, {
        enabled?: boolean;
        teamId: string;
        chatId: number;
        topicId?: number;
        title?: string;
        usePersonaIdentities?: boolean;
      }>;
    };
    discord?: {
      enabled: boolean;
      botToken: string;
      applicationId?: string;
      guildId?: string;
      channelId?: string;
      webhookUrl?: string;
    };
    whatsapp?: {
      enabled: boolean;
      accessToken: string;
      phoneNumberId: string;
      businessAccountId?: string;
      verifyToken?: string;
      webhookSecret?: string;
      testRecipient?: string;
    };
  };
  search?: {
    preferred_provider?: string;
    tinyfish_api_key?: string;
    tavily_api_key?: string;
    google_api_key?: string;
    google_cx?: string;
    brave_api_key?: string;
    search_rigor?: string;
  };
  llm?: LLMConfig;
  orchestration?: {
    enabled: boolean;
    secondary: {
      provider: string | '';
      model: string;
    };
    triggers: {
      consecutive_failures: number;
      stagnation_rounds: number;
      loop_detection: boolean;
      risky_files_threshold: number;
      risky_tool_ops_threshold: number;
      no_progress_seconds: number;
    };
    preflight: {
      mode: 'off' | 'complex_only' | 'always';
      allow_secondary_chat: boolean;
    };
    limits: {
      assist_cooldown_rounds: number;
      max_assists_per_turn: number;
      max_assists_per_session: number;
      telemetry_history_limit: number;
    };
    browser?: {
      max_advisor_calls_per_turn?: number;
      max_collected_items?: number;
      max_forced_retries?: number;
      min_feed_items_before_answer?: number;
    };
    preempt?: {
      enabled?: boolean;
      stall_threshold_seconds?: number;
      max_preempts_per_turn?: number;
      max_preempts_per_session?: number;
      restart_mode?: 'inherit_console' | 'detached_hidden';
    };
    file_ops?: {
      enabled?: boolean;
      primary_create_max_lines?: number;
      primary_create_max_chars?: number;
      primary_edit_max_lines?: number;
      primary_edit_max_chars?: number;
      primary_edit_max_files?: number;
      verify_create_always?: boolean;
      verify_large_payload_lines?: number;
      verify_large_payload_chars?: number;
      watchdog_no_progress_cycles?: number;
      checkpointing_enabled?: boolean;
    };
    // true = full multi-agent subagent_spawn (parallel, Claude Cowork-style)
    subagent_mode?: boolean;
  };
  hooks?: {
    enabled: boolean;
    token: string;
    path: string;
  };
  agent_policy?: {
    retrieval_mode?: string;
  };

  /**
   * Agent Builder integration.
   * Set enabled: true only when Agent Builder (localhost:3005) is running and
   * you want Prometheus to use its workflow design + execution tools.
   * When false (default), the 8 Agent Builder tools are NOT registered,
   * not visible to the AI, and workflow context is not injected into prompts.
   */
  agent_builder?: {
    /** Master switch. Default: false */
    enabled: boolean;
    /** Agent Builder URL. Default: http://localhost:3005 */
    url?: string;
  };
}

export type LocalClawConfig = PrometheusConfig;

// ─── Multi-Provider LLM Config ──────────────────────────────────────────────

export type ProviderID = string;

export interface OllamaProviderConfig    { endpoint: string; model: string; }
export interface LlamaCppProviderConfig  { endpoint: string; model: string; api_key?: string; }
export interface LMStudioProviderConfig  { endpoint: string; model: string; api_key?: string; }
export interface OpenAIProviderConfig    { api_key: string;  model: string; }
export interface OpenAICodexProviderConfig {
  model: string;
} // token managed by auth/openai-oauth.ts
export type GenericProviderConfig = Record<string, unknown>;

export interface LLMConfig {
  provider: ProviderID;
  providers: Record<string, GenericProviderConfig | undefined>;
}

export interface Skill {
  name: string;
  description: string;
  author?: string;
  version: string;
  tags: string[];
  permissions: {
    tools: string[];
    approval_required: boolean;
  };
  content: string;
}

// ─── CIS Phase 1: Business Brain & Integration Types ─────────────────────────────
// All additive. No existing types modified.

export interface EntityFile {
  type: 'client' | 'project' | 'vendor' | 'contact' | 'social';
  id: string;           // slug matching filename, e.g. "acme-corp"
  path: string;         // absolute path to the .md file
  name: string;         // display name from file heading
  lastUpdated: string;  // ISO timestamp
}

export interface IntegrationPermissions {
  read: boolean;
  propose: boolean;
  commit: boolean;
  injectContext: boolean;
}

export interface IntegrationConnection {
  id: string;
  platform: 'gmail' | 'outlook' | 'slack' | 'teams' | 'salesforce' | 'hubspot' |
            'notion' | 'github' | 'jira' | 'linear' | 'stripe' | 'quickbooks' |
            'ga4' | 'instagram' | 'tiktok' | 'x' | 'linkedin' | 'facebook' |
            'google_drive' | 'dropbox' | 'reddit' | string;
  name: string;
  enabled: boolean;
  tokenRef: string;
  permissions: IntegrationPermissions;
  lastSyncedAt?: string;
  cacheTtlMinutes?: number;
  accountId?: string;
}

export interface PolicyRule {
  id: string;
  description: string;
  toolPattern: string;
  conditions?: {
    amount_gte?: number;
    amount_field?: string;
    recipient_type?: ('external' | 'internal' | 'public')[];
    topic_match?: string[];
  };
  tier: 'read' | 'propose' | 'commit';
  approver_role?: 'user' | 'admin';
  riskScore: number;
}

export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  agentId?: string;
  actionType: 'tool_call' | 'message_sent' | 'file_written' | 'approval_requested' | 'approval_resolved';
  toolName?: string;
  toolArgs?: Record<string, any>;
  policyTier?: 'read' | 'propose' | 'commit';
  approvalStatus?: 'auto' | 'auto_allowed' | 'approved' | 'rejected' | 'pending';
  resultSummary?: string;
  error?: string;
}
