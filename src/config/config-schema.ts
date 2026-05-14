/**
 * src/config/config-schema.ts
 *
 * Zod schema for PrometheusConfig — typed validation replacing the legacy
 * manual type-checking and redactConfigForUI() gymnastics.
 *
 * Usage:
 *   import { PrometheusConfigSchema, parseConfig } from './config-schema';
 *   const result = PrometheusConfigSchema.safeParse(rawJson);
 *
 * Step 30.1 of Phase 6 refactor.
 */

import { z } from 'zod';

// ─── Primitives ──────────────────────────────────────────────────────────────

const ProviderIDSchema = z.string().min(1);

// ─── LLM Providers ──────────────────────────────────────────────────────────

const OllamaProviderSchema = z.object({
  endpoint: z.string().url().or(z.string().startsWith('http')),
  model: z.string(),
});

const LlamaCppProviderSchema = z.object({
  endpoint: z.string(),
  model: z.string(),
  api_key: z.string().optional(),
});

const LMStudioProviderSchema = z.object({
  endpoint: z.string(),
  model: z.string(),
  api_key: z.string().optional(),
});

// Accepted reasoning effort levels for providers that expose one
// (OpenAI / Codex / Perplexity reasoning models).
const ReasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional();

const OpenAIProviderSchema = z.object({
  api_key: z.string(),   // may be "vault:<key>" or "env:VAR"
  model: z.string(),
  reasoning_effort: ReasoningEffortSchema,
});

const OpenAICodexProviderSchema = z.object({
  model: z.string(),
  reasoning_effort: ReasoningEffortSchema,
});

const AnthropicProviderSchema_LLM = z.object({
  model: z.string(),
  extended_thinking: z.boolean().optional(),
  thinking_budget: z.number().int().min(1024).optional(),
});

const PerplexityProviderSchema = z.object({
  api_key: z.string(),
  model: z.string(),
  reasoning_effort: ReasoningEffortSchema,
});

const GeminiProviderSchema = z.object({
  api_key: z.string(),
  model: z.string(),
});

const ProviderConfigValueSchema = z.record(z.unknown());

const LLMConfigSchema = z.object({
  provider: ProviderIDSchema,
  providers: z.record(ProviderConfigValueSchema),
});

const ImageGenerationConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  save_to_workspace: z.boolean().optional(),
  default_output_dir: z.string().optional(),
  providers: z.record(z.record(z.unknown())).optional(),
});

const VideoGenerationConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  save_to_workspace: z.boolean().optional(),
  default_output_dir: z.string().optional(),
  duration: z.number().optional(),
  resolution: z.string().optional(),
  providers: z.record(z.record(z.unknown())).optional(),
});

// ─── Tool Permissions ────────────────────────────────────────────────────────

const ToolPermissionsSchema = z.object({
  shell: z.object({
    workspace_only: z.boolean(),
    confirm_destructive: z.boolean(),
    blocked_patterns: z.array(z.string()),
  }),
  files: z.object({
    allowed_paths: z.array(z.string()),
    blocked_paths: z.array(z.string()),
  }),
  browser: z.object({
    profile: z.string(),
    headless: z.boolean(),
  }),
});

// ─── Agent Definition ────────────────────────────────────────────────────────

const AgentToolPolicySchema = z.object({
  allow:   z.array(z.string()).optional(),
  deny:    z.array(z.string()).optional(),
  profile: z.enum(['minimal', 'coding', 'web', 'full']).optional(),
});

const AgentPersonalitySchema = z.object({
  archetype: z.string().min(1),
  tone: z.string().min(1),
  humor: z.enum(['none', 'dry', 'light', 'playful', 'sharp']),
  seriousness: z.enum(['low', 'balanced', 'high']),
  warmth: z.enum(['reserved', 'steady', 'warm']),
  directness: z.enum(['gentle', 'balanced', 'blunt']),
  quirks: z.array(z.string()).optional(),
  avoid: z.array(z.string()).optional(),
});

const AgentIdentitySchema = z.object({
  displayName: z.string().min(1),
  shortName: z.string().optional(),
  namingRationale: z.string().optional(),
  personality: AgentPersonalitySchema.optional(),
  voiceGuidelines: z.string().optional(),
}).passthrough();

const AgentDefinitionSchema = z.object({
  id:          z.string().min(1),
  name:        z.string().min(1),
  description: z.string().optional(),
  emoji:       z.string().optional(),
  identity:    AgentIdentitySchema.optional(),
  roleType:    z.string().optional(),
  teamRole:    z.string().optional(),
  teamAssignment: z.string().optional(),
  workspace:   z.string().optional(),
  executionWorkspace: z.string().optional(),
  allowedWorkPaths: z.array(z.string()).optional(),
  model:       z.string().optional(),
  tools:       AgentToolPolicySchema.optional(),
  default:     z.boolean().optional(),
  isTeamManager: z.boolean().optional(),
  bindings: z.array(z.object({
    channel:   z.enum(['telegram', 'discord', 'whatsapp']),
    accountId: z.string().optional(),
    peerId:    z.string().optional(),
  })).optional(),
  cronSchedule: z.string().optional(),
  maxSteps:    z.number().int().positive().optional(),
});

// ─── Channel Configs ─────────────────────────────────────────────────────────

const TelegramPersonaConfigSchema = z.object({
  enabled: z.boolean().optional(),
  agentId: z.string(),
  botToken: z.string().optional(),
  managedBotUserId: z.number().optional(),
  botUsername: z.string().optional(),
  allowedUserIds: z.array(z.number()).optional(),
  groupChatIds: z.array(z.number()).optional(),
  requireMentionInGroups: z.boolean().optional(),
  streamMode: z.enum(['full', 'partial']).optional(),
});

const TelegramTeamRoomConfigSchema = z.object({
  enabled: z.boolean().optional(),
  teamId: z.string(),
  chatId: z.number(),
  topicId: z.number().optional(),
  title: z.string().optional(),
  usePersonaIdentities: z.boolean().optional(),
});

const TelegramConfigSchema = z.object({
  enabled:        z.boolean(),
  botToken:       z.string(),
  allowedUserIds: z.array(z.number()),
  streamMode:     z.enum(['full', 'partial']),
  personas:       z.record(TelegramPersonaConfigSchema).optional(),
  teamRooms:      z.record(TelegramTeamRoomConfigSchema).optional(),
});

const DiscordConfigSchema = z.object({
  enabled:       z.boolean(),
  botToken:      z.string(),
  applicationId: z.string().optional(),
  guildId:       z.string().optional(),
  channelId:     z.string().optional(),
  webhookUrl:    z.string().optional(),
});

const WhatsappConfigSchema = z.object({
  enabled:           z.boolean(),
  accessToken:       z.string(),
  phoneNumberId:     z.string(),
  businessAccountId: z.string().optional(),
  verifyToken:       z.string().optional(),
  webhookSecret:     z.string().optional(),
  testRecipient:     z.string().optional(),
});

// ─── Top-Level Config Schema ─────────────────────────────────────────────────

export const PrometheusConfigSchema = z.object({
  version: z.string(),

  gateway: z.object({
    port: z.number().int().min(1).max(65535),
    host: z.string(),
    auth: z.object({
      enabled: z.boolean(),
      token:   z.string().optional(),
    }),
  }),

  ollama: z.object({
    endpoint:    z.string(),
    timeout:     z.number().int().positive(),
    concurrency: z.object({
      llm_workers:  z.number().int().min(1),
      tool_workers: z.number().int().min(1),
    }),
  }),

  models: z.object({
    primary: z.string(),
    roles: z.object({
      manager:  z.string(),
      executor: z.string(),
      verifier: z.string(),
    }),
  }),

  // Per-agent-type model defaults. Consulted at spawn time when an agent
  // has no explicit model override. Falls back to models.primary if unset.
  agent_model_defaults: z.object({
    main_chat:                     z.string().optional(),
    proposal_executor_high_risk:   z.string().optional(),
    proposal_executor_low_risk:    z.string().optional(),
    manager:                       z.string().optional(),
    team_manager:                  z.string().optional(),
    subagent:                      z.string().optional(),
    team_subagent:                 z.string().optional(),
    background_task:               z.string().optional(),
    // Per-role-type subagent defaults (checked before generic 'subagent' fallback)
    subagent_planner:              z.string().optional(),
    subagent_orchestrator:         z.string().optional(),
    subagent_researcher:           z.string().optional(),
    subagent_analyst:              z.string().optional(),
    subagent_builder:              z.string().optional(),
    subagent_operator:             z.string().optional(),
    subagent_verifier:             z.string().optional(),
    // Switch model tiers — resolved by switch_model tool at runtime
    switch_model_low:              z.string().optional(), // speed tier (e.g. "anthropic/claude-haiku-4-5-20251001")
    switch_model_medium:           z.string().optional(), // careful tier (e.g. "openai_codex/gpt-5.1-codex-mini")
    // Meta-coordinator model for ask_team_coordinator sessions
    coordinator:                   z.string().optional(),
    // Ephemeral background_spawn agents
    background_agent:              z.string().optional(),
  }).optional(),

  agent_model_default_templates: z.array(z.object({
    id: z.string(),
    name: z.string(),
    defaults: z.object({
      main_chat:                     z.string().optional(),
      proposal_executor_high_risk:   z.string().optional(),
      proposal_executor_low_risk:    z.string().optional(),
      manager:                       z.string().optional(),
      team_manager:                  z.string().optional(),
      subagent:                      z.string().optional(),
      team_subagent:                 z.string().optional(),
      background_task:               z.string().optional(),
      subagent_planner:              z.string().optional(),
      subagent_orchestrator:         z.string().optional(),
      subagent_researcher:           z.string().optional(),
      subagent_analyst:              z.string().optional(),
      subagent_builder:              z.string().optional(),
      subagent_operator:             z.string().optional(),
      subagent_verifier:             z.string().optional(),
      switch_model_low:              z.string().optional(),
      switch_model_medium:           z.string().optional(),
      coordinator:                   z.string().optional(),
      background_agent:              z.string().optional(),
    }).optional().default({}),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })).optional(),
  active_agent_model_default_template: z.string().optional(),

  tools: z.object({
    enabled:     z.array(z.string()),
    permissions: ToolPermissionsSchema,
  }),

  skills: z.object({
    directory:    z.string(),
    registries:   z.array(z.string()),
    auto_update:  z.boolean(),
  }),

  memory: z.object({
    provider:        z.string(),
    path:            z.string(),
    embedding_model: z.string(),
  }),

  memory_options: z.object({
    auto_confirm:     z.boolean().optional(),
    audit:            z.boolean().optional(),
    truncate_length:  z.number().int().optional(),
  }).optional(),

  heartbeat: z.object({
    enabled:           z.boolean(),
    interval_minutes:  z.number().int().positive(),
    workspace_file:    z.string(),
  }),

  workspace: z.object({
    path: z.string(),
  }),

  agents: z.array(AgentDefinitionSchema).optional(),

  session: z.object({
    maxMessages:            z.number().int().optional(),
    compactionThreshold:    z.number().min(0).max(1).optional(),
    memoryFlushThreshold:   z.number().min(0).max(1).optional(),
    rollingCompactionEnabled: z.boolean().optional(),
    rollingCompactionMessageCount: z.number().int().min(10).max(120).optional(),
    rollingCompactionToolTurns: z.number().int().min(1).max(12).optional(),
    rollingCompactionSummaryMaxWords: z.number().int().min(80).max(500).optional(),
    rollingCompactionModel: z.string().optional(),
    mainChatGoals: z.object({
      enabled: z.boolean().optional(),
      autoResumeOnRestart: z.boolean().optional(),
      summaryEveryTurns: z.number().int().min(1).max(50).optional(),
      summaryMaxWords: z.number().int().min(120).max(1200).optional(),
      judgeModel: z.string().optional(),
      compactionModel: z.string().optional(),
      maxConsecutiveJudgeFailures: z.number().int().min(1).max(20).optional(),
      maxConsecutiveRuntimeFailures: z.number().int().min(1).max(20).optional(),
      permissions: z.object({
        approvalMode: z.enum(['normal', 'never']).optional(),
        hardDenyEnabled: z.boolean().optional(),
        recordDeniedActions: z.boolean().optional(),
        denyDestructiveGit: z.boolean().optional(),
        denyRemoteScriptExecution: z.boolean().optional(),
        denyDesktopCredentialEntry: z.boolean().optional(),
      }).optional(),
    }).optional(),
  }).optional(),

  // Legacy top-level telegram (kept for backward compat)
  telegram: TelegramConfigSchema.optional(),

  channels: z.object({
    telegram:  TelegramConfigSchema.optional(),
    discord:   DiscordConfigSchema.optional(),
    whatsapp:  WhatsappConfigSchema.optional(),
  }).optional(),

  search: z.object({
    preferred_provider: z.string().optional(),
    tinyfish_api_key:   z.string().optional(),
    tavily_api_key:     z.string().optional(),
    google_api_key:     z.string().optional(),
    google_cx:          z.string().optional(),
    brave_api_key:      z.string().optional(),
    search_rigor:       z.string().optional(),
  }).optional(),

  llm: LLMConfigSchema.optional(),
  image_generation: ImageGenerationConfigSchema.optional(),
  video_generation: VideoGenerationConfigSchema.optional(),

  hooks: z.object({
    enabled: z.boolean(),
    token:   z.string(),
    path:    z.string(),
  }).optional(),

  agent_policy: z.object({
    retrieval_mode: z.string().optional(),
  }).optional(),

  agent_builder: z.object({
    enabled: z.boolean(),
    url:     z.string().optional(),
  }).optional(),
});

// ─── Inferred Type ───────────────────────────────────────────────────────────
// Use this instead of importing PrometheusConfig from types.ts when you want
// the schema-derived version (guaranteed to match validation).
export type ValidatedConfig = z.infer<typeof PrometheusConfigSchema>;

// ─── Parse helpers ───────────────────────────────────────────────────────────

/**
 * Validate a raw JSON object against the config schema.
 * Returns { success: true, data } or { success: false, error }.
 * Safe to call at startup — never throws.
 */
export function parseConfig(raw: unknown): z.SafeParseReturnType<typeof PrometheusConfigSchema._type, ValidatedConfig> {
  return PrometheusConfigSchema.safeParse(raw);
}

/**
 * Validate and throw on failure — useful for startup assertions.
 */
export function assertConfig(raw: unknown): ValidatedConfig {
  return PrometheusConfigSchema.parse(raw);
}

/**
 * Return a list of validation issues for display in the settings UI.
 * Returns an empty array if config is valid.
 */
export function getConfigErrors(raw: unknown): string[] {
  const result = PrometheusConfigSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`
  );
}
