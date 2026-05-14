// src/gateway/tool-builder.ts
// Tool definitions and execution utilities — extracted from server-v2.ts (Step 13.1, Phase 3).
// Exports: BuildToolsDeps, buildTools(), ToolResult, TaskControlResponse, ScheduleJobAction,
//          normalizeScheduleJobAction, summarizeCronJob, normalizeDeliveryChannel,
//          normalizeToolArgs, parseJsonLike, toStringRecord, parseLooseMap

import { getConfig } from '../config/config';
import { getBrowserToolDefinitions } from './browser-tools';
import { getDesktopToolDefinitions } from './desktop-tools';
import { registerAgentBuilderTools } from './agents-runtime/agent-builder-integration';
import { getFileWebMemoryTools } from './tools/defs/file-web-memory';
import { getAgentTeamScheduleTools } from './tools/defs/agent-team-schedule';
import { getCisSystemTools } from './tools/defs/cis-system';
import { getCreativeToolDefs } from './tools/defs/creative-tools';
import { getCompositeDefs, getCompositeManagementTools, loadComposites } from './tools/composite-tools';
import { ensurePrometheusExtensionRuntimeLoaded } from '../extensions/legacy-connector-adapter';
import { getExtensionRuntimeRegistry } from '../extensions/runtime-registry';
import { getPublicBuildAllowedCategories } from '../runtime/distribution.js';

export interface BuildToolsDeps {
  getMCPManager: () => any;
}

// ─── Tool Category System ─────────────────────────────────────────────────────
// Tools split into: core (always injected) + on-demand categories.
// Categories are activated per-session via request_tool_category tool.

export const ALL_TOOL_CATEGORIES = [
  'browser_automation',
  'desktop_automation',
  'agents_and_teams',
  'prometheus_source_read',
  'prometheus_source_write',
  'workspace_write',
  'advanced_memory',
  'media_assets',
  'media_quality',
  'automations',
  'external_apps',
  'integration_admin',
  'social_intelligence',
  'proposal_admin',
  'mcp_server_tools',
  'composite_tools',
  'creative_mode',
] as const;
export type ToolCategory = typeof ALL_TOOL_CATEGORIES[number];
type InternalToolCategory = ToolCategory;

export function buildConnectorStatus(): string {
  ensurePrometheusExtensionRuntimeLoaded();
  return getExtensionRuntimeRegistry().buildConnectorStatus();
}

export function getRuntimeToolCategories(): ToolCategory[] {
  return getPublicBuildAllowedCategories(ALL_TOOL_CATEGORIES) as ToolCategory[];
}

const TOOL_CATEGORY_ALIASES: Record<string, ToolCategory> = {
  browser: 'browser_automation',
  browser_automation: 'browser_automation',
  desktop: 'desktop_automation',
  desktop_automation: 'desktop_automation',
  team_ops: 'agents_and_teams',
  teams: 'agents_and_teams',
  agents: 'agents_and_teams',
  agents_and_teams: 'agents_and_teams',
  source_read: 'prometheus_source_read',
  prometheus_source_read: 'prometheus_source_read',
  source_write: 'prometheus_source_write',
  prometheus_source_write: 'prometheus_source_write',
  file_ops: 'workspace_write',
  files: 'workspace_write',
  workspace_write: 'workspace_write',
  memory: 'advanced_memory',
  advanced_memory: 'advanced_memory',
  media: 'media_assets',
  media_assets: 'media_assets',
  media_quality: 'media_quality',
  schedule: 'automations',
  scheduling: 'automations',
  automations: 'automations',
  connectors: 'external_apps',
  external_apps: 'external_apps',
  integrations: 'integration_admin',
  integration_admin: 'integration_admin',
  social_intelligence: 'social_intelligence',
  proposal_admin: 'proposal_admin',
  mcp: 'mcp_server_tools',
  mcp_server_tools: 'mcp_server_tools',
  composites: 'composite_tools',
  composite_tools: 'composite_tools',
  creative_mode: 'creative_mode',
};

export function normalizeToolCategory(raw: unknown): ToolCategory | null {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  const normalized = TOOL_CATEGORY_ALIASES[key];
  if (!normalized) return null;
  return getRuntimeToolCategories().includes(normalized) ? normalized : null;
}

// Explicit name lists for non-prefix categories
const TEAM_OPS_TOOL_NAMES = new Set([
  'spawn_subagent',
  'agent_list', 'agent_info', 'agent_update', 'delete_agent',
  'message_subagent', 'talk_to_subagent', 'talk_to_manager', 'talk_to_teammate',
  'request_context', 'request_manager_help',
  'update_my_status', 'update_team_goal', 'share_artifact', 'team_manage',
  'dispatch_to_agent', 'dispatch_team_agent', 'request_team_member_turn', 'get_agent_result',
  'post_to_team_chat', 'message_main_agent', 'reply_to_team',
  'manage_team_goal', 'manage_team_context_ref',
  // ask_team_coordinator intentionally excluded — it's a core tool (always available)
  // deploy_analysis_team intentionally excluded — user-facing tool, must always be available
]);

// schedule_job + parse_schedule_pattern are CORE — always injected so cron/heartbeat/subagent
// sessions can reschedule and manage jobs without needing category activation.
// background_spawn/status/progress/join are also CORE — always injected.

const SOURCE_WRITE_TOOL_NAMES = new Set([
	  'find_replace_source', 'replace_lines_source', 'insert_after_source',
	  'delete_lines_source', 'write_source', 'delete_source',
	  'find_replace_webui_source', 'replace_lines_webui_source', 'insert_after_webui_source',
	  'delete_lines_webui_source', 'write_webui_source', 'delete_webui_source',
	  'find_replace_prom', 'replace_lines_prom', 'insert_after_prom',
	  'delete_lines_prom', 'write_prom_file', 'delete_prom_file',
	]);

const DEV_ONLY_SOURCE_READ_TOOL_NAMES = new Set([
  'read_source', 'list_source', 'grep_source', 'source_stats', 'src_stats',
  'read_webui_source', 'list_webui_source', 'grep_webui_source', 'webui_source_stats', 'webui_stats',
  'list_prom', 'prom_file_stats', 'read_prom_file', 'grep_prom',
]);

const FILE_OPS_TOOL_NAMES = new Set([
  'create_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'delete_file',
  'write_file',
  'rename_file',
  'copy_file',
  'move_file',
  'copy_directory',
  'move_directory',
  'path_exists',
  'show_diff',
  'preview_patch',
  'apply_patch',
  'format_changed_files',
  'revert_last_tool_change',
  'revert_own_patch',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'git_commit',
  'git_push',
  'open_pr',
  'run_tests',
  'run_linter',
  'run_formatter',
  'run_typecheck',
  'start_dev_server',
  'stop_process',
  'read_process_output',
  'snapshot_workspace',
  'restore_snapshot',
  'scan_secrets',
  'scan_large_files',
  'operation_plan',
  'code_outline',
  'get_symbols',
  'go_to_definition',
  'find_references',
]);

const MEMORY_TOOL_NAMES = new Set([
  'memory_read_record',
  'memory_search_project',
  'memory_search_timeline',
  'memory_get_related',
  'memory_graph_snapshot',
  'memory_index_refresh',
  'memory_provider_status',
  'memory_embedding_status',
  'memory_embedding_backfill',
  'memory_debug_search',
  'memory_consolidate',
  'memory_review_claims',
  'memory_accept_claim',
  'memory_reject_claim',
  'memory_supersede_record',
]);

const MEDIA_TOOL_NAMES = new Set([
  'download_url',
  'download_media',
  'analyze_image',
  'analyze_video',
]);

const MEDIA_QUALITY_TOOL_NAMES = new Set([
  'image_check_contrast',
  'image_check_text_overflow',
  'image_detect_empty_regions',
  'image_get_bounds_summary',
  'image_get_element_at_point',
  'image_get_overlaps',
  'video_render_contact_sheet',
  'video_render_frame',
  'video_check_audio_sync',
  'video_check_caption_timing',
]);

const AUTOMATION_TOOL_NAMES = new Set([
  'schedule_job',
  'schedule_job_detail',
  'schedule_job_history',
  'schedule_job_log_search',
  'schedule_job_outputs',
  'schedule_job_patch',
  'schedule_job_stuck_control',
]);

const CORE_CREATIVE_CONTROL_TOOL_NAMES = new Set([
  'get_creative_mode',
  'switch_creative_mode',
]);

const INTEGRATION_ADMIN_TOOL_NAMES = new Set([
  'mcp_server_manage', 'webhook_manage', 'integration_quick_setup',
]);

const SOCIAL_INTELLIGENCE_TOOL_NAMES = new Set(['social_intel']);

const PROPOSAL_ADMIN_TOOL_NAMES = new Set(['edit_proposal']);

const COMPOSITE_MANAGEMENT_TOOL_NAMES = new Set([
  'create_composite',
  'get_composite',
  'edit_composite',
  'delete_composite',
  'list_composites',
]);

function isSavedCompositeToolName(name: string): boolean {
  try {
    return loadComposites().has(name);
  } catch {
    return false;
  }
}

export function getToolCategory(name: string): InternalToolCategory | null {
  // Keep these always available as core runtime tools.
  if (name === 'browser_send_to_telegram') return null;
  if (name === 'connector_list') return null; // core tool — always available
  if (CORE_CREATIVE_CONTROL_TOOL_NAMES.has(name)) return null;
  if (name === 'save_site_shortcut') return 'browser_automation';
  if (name === 'inspect_console' || name === 'run_accessibility_check' || name === 'browser_smoke_test') return 'browser_automation';
  if (name.startsWith('browser_')) return 'browser_automation';
  if (name.startsWith('desktop_')) return 'desktop_automation';
  if (name.startsWith('connector_')) return 'external_apps';
  if (name.startsWith('mcp__')) return 'mcp_server_tools';
  if (name.startsWith('vercel_')) return 'integration_admin';
  if (TEAM_OPS_TOOL_NAMES.has(name)) return 'agents_and_teams';
  if (DEV_ONLY_SOURCE_READ_TOOL_NAMES.has(name)) return 'prometheus_source_read';
  if (SOURCE_WRITE_TOOL_NAMES.has(name)) return 'prometheus_source_write';
  if (FILE_OPS_TOOL_NAMES.has(name)) return 'workspace_write';
  if (MEMORY_TOOL_NAMES.has(name)) return 'advanced_memory';
  if (MEDIA_TOOL_NAMES.has(name)) return 'media_assets';
  if (MEDIA_QUALITY_TOOL_NAMES.has(name)) return 'media_quality';
  if (AUTOMATION_TOOL_NAMES.has(name)) return 'automations';
  if (name.startsWith('creative_')) return 'creative_mode';
  if (INTEGRATION_ADMIN_TOOL_NAMES.has(name)) return 'integration_admin';
  if (SOCIAL_INTELLIGENCE_TOOL_NAMES.has(name)) return 'social_intelligence';
  if (PROPOSAL_ADMIN_TOOL_NAMES.has(name)) return 'proposal_admin';
  if (COMPOSITE_MANAGEMENT_TOOL_NAMES.has(name) || isSavedCompositeToolName(name)) return 'composite_tools';
  return null; // null = core tool, always included
}

export function buildTools(deps: BuildToolsDeps, activatedCategories?: Set<string>) {
  const { getMCPManager } = deps;
  const isPublicBuild = getPublicBuildAllowedCategories(['prometheus_source_write'] as const).length === 0;

  const toolDefs = [
    // ── File, Web, and Memory tools ──────────────────────────────────────────
    ...getFileWebMemoryTools(),
    // ── Telegram proactive push (works from any session) ───────────────────
    {
      type: 'function',
      function: {
        name: 'send_telegram',
        description:
          'Proactively send a message or screenshot to the user\'s Telegram. ' +
          'Works from ANY session — web UI, background task, cron job. ' +
          'Use to notify the user of task completion, errors, or to share a desktop screenshot. ' +
          'For screenshots: call desktop_screenshot first, then send_telegram with screenshot:true.',
        parameters: {
          type: 'object', required: [],
          properties: {
            text: { type: 'string', description: 'Text message to send. Also used as caption when screenshot:true.' },
            screenshot: { type: 'boolean', description: 'If true, sends the last captured desktop screenshot as a photo. Requires desktop_screenshot to have been called first.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run shell commands or open apps. Dev CLI commands (git, npm, node, python, etc.) run CAPTURED by default — output is returned inline, no new window. Pass visible:true only if the user explicitly needs to see a terminal window. For GUI apps (notepad, code, explorer) a visible window opens automatically. NEVER use for Chrome/Edge — use browser_open instead. **GIT BEST PRACTICES FOR PROMETHEUS**: (1) For submodule (workspace/xposemarket-site), ALWAYS use full path: `git -C workspace/xposemarket-site status` NOT `cd xposemarket-site` which fails with "path not found". (2) Use `git -C <path>` pattern for reliable automation. (3) Initialize submodules: `git submodule update --init --recursive`.',
        parameters: {
          type: 'object', required: ['command'],
          properties: {
            command: { type: 'string', description: 'Examples: "notepad", "git init", "npm install", "npm run build", "git push origin main", "code D:\\project", "git -C workspace/xposemarket-site status", "git status". **CRITICAL FOR GIT**: (1) Submodule at workspace/xposemarket-site — NEVER use `cd xposemarket-site` alone. Use `git -C workspace/xposemarket-site status` instead. (2) Do NOT use "chrome" or "msedge" — use browser_open instead.' },
            cwd: { type: 'string', description: 'Optional working directory relative to the active workspace, or an absolute path inside it. Use this for repo folders with spaces, e.g. "Prometheus Website/prometheus-site".' },
            visible: { type: 'boolean', description: 'If true, opens a visible terminal window instead of capturing output. Default: false (captured).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'start_process',
        description: 'Start a long-running command as a supervised Prometheus process. Use this for dev servers, watchers, interactive CLIs, long builds, renders, or commands the user may want to inspect/kill later. Returns a runId; use process_status/process_log/process_wait/process_kill/process_submit to manage it.',
        parameters: {
          type: 'object',
          required: ['command'],
          properties: {
            command: { type: 'string', description: 'Command to start, e.g. "npm run dev" or "python server.py".' },
            cwd: { type: 'string', description: 'Optional working directory relative to active workspace, or absolute path inside allowed paths.' },
            title: { type: 'string', description: 'Optional human-readable title for UI command cards.' },
            stdin: { type: 'boolean', description: 'If true, keep stdin open so process_submit can answer prompts.' },
            noOutputTimeoutMs: { type: 'number', description: 'Optional no-output timeout in milliseconds.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_status',
        description: 'Inspect supervised command runs. Pass runId for one process, or omit it to list recent process cards.',
        parameters: {
          type: 'object',
          properties: {
            runId: { type: 'string', description: 'Optional run id.' },
            limit: { type: 'number', description: 'Optional max runs to list.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_log',
        description: 'Read stdout/stderr logs for a supervised process run.',
        parameters: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string', description: 'Process run id.' },
            maxChars: { type: 'number', description: 'Optional max characters to return.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_wait',
        description: 'Wait for a running supervised process to exit and return its captured output.',
        parameters: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string', description: 'Process run id.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_kill',
        description: 'Kill a running supervised process by runId.',
        parameters: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string', description: 'Process run id.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_submit',
        description: 'Send one line of stdin to a running supervised process. Use for prompts in interactive CLIs started with start_process({stdin:true}).',
        parameters: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string', description: 'Process run id.' },
            data: { type: 'string', description: 'Text to send before Enter.' },
          },
        },
      },
    },
    // Browser automation tools
    ...getBrowserToolDefinitions(),
    ...getDesktopToolDefinitions(),
    // ── Sub-agent tools ── shown based on subagent_mode toggle ────────────────────────────────────
    ...(() => {
      const subagentMode = (getConfig().getConfig() as any).orchestration?.subagent_mode === true;
      if (subagentMode) {
        return [{
          type: 'function' as const,
          function: {
            name: 'subagent_spawn',
            description:
              'Spawn a child agent in an isolated session to handle a parallel subtask. ' +
              'The current task pauses until ALL spawned children complete. ' +
              'Do NOT call this recursively from inside a child task.',
            parameters: {
              type: 'object',
              required: ['task_title', 'task_prompt'],
              properties: {
                task_title:      { type: 'string', description: 'Short title for the sub-agent task' },
                task_prompt:     { type: 'string', description: 'Full instruction for the sub-agent (be precise)' },
                context_snippet: { type: 'string', description: 'Relevant context pre-extracted for the sub-agent (file contents, URLs, etc.)' },
                expected_output: { type: 'string', description: 'What the sub-agent should return when done' },
                profile: {
                  type: 'string',
                  enum: ['file_editor', 'researcher', 'shell_runner', 'reader_only'],
                  description: 'Tool access profile: file_editor=read/write files, researcher=read+web, shell_runner=run_command, reader_only=read only',
                },
              },
            },
          },
        }];
      }
      return [];
    })(),
    // ── Agent, Team, and Schedule tools ──────────────────────────────────────
    ...getAgentTeamScheduleTools(),
    // ── CIS, System, and Self-improvement tools ───────────────────────────────
    ...getCisSystemTools(),
    // ── Creative editor tools ─────────────────────────────────────────────────
    ...getCreativeToolDefs(),
    // ── Agent Builder Integration Tools (only when enabled in config) ─────────
  ] as any[];

  const agentBuilderEnabled = (getConfig().getConfig() as any)?.agent_builder?.enabled === true;
  if (agentBuilderEnabled) {
    registerAgentBuilderTools(toolDefs);
  }

  // ── connector_list: always-available connector discovery tool ─────────────
  toolDefs.push({
    type: 'function',
    function: {
      name: 'connector_list',
      description:
        'List all available connectors (Gmail, GitHub, Slack, Notion, Google Drive, Reddit, HubSpot, Salesforce, Stripe, Google Analytics) and their connection status. ' +
        'Shows which connectors are connected and what tools are available for each. ' +
        'Use this before activating the external_apps category to check what\'s available.',
      parameters: { type: 'object', required: [], properties: {} },
    },
  });

  // ── Connector tools (activated via connectors category) ───────────────────
  try {
    ensurePrometheusExtensionRuntimeLoaded();
    toolDefs.push(...getExtensionRuntimeRegistry().listToolDefinitions());
  } catch { /* connector defs may not load in all build targets */ }

  // ── Inject MCP tools from connected servers ────────────────────────────────
  try {
    const mcpTools = getMCPManager().getAllTools();
    for (const t of mcpTools) {
      const prefixedName = `mcp__${t.serverId}__${t.name}`;
      toolDefs.push({
        type: 'function',
        function: {
          name: prefixedName,
          description: `[MCP:${t.serverName}] ${t.description}`,
          parameters: t.inputSchema ?? { type: 'object', properties: {}, required: [] },
        },
      });
    }
  } catch { /* MCP not ready yet — skip silently */ }

  // ── Dynamic composite tools (user-defined tool sequences) ─────────────────
  try {
    toolDefs.push(...getCompositeDefs());
    toolDefs.push(...getCompositeManagementTools());
  } catch { /* composites dir may not exist yet — skip silently */ }

  const runtimeToolDefs = isPublicBuild
    ? toolDefs.filter((t: any) => !DEV_ONLY_SOURCE_READ_TOOL_NAMES.has(String(t?.function?.name || '')))
    : toolDefs;

  // ── Filter to core + activated categories ──────────────────────────────────
  // When activatedCategories is provided, only return core tools + those in active categories.
  if (activatedCategories !== undefined) {
    const normalizedActiveCategories = new Set<string>();
    for (const category of activatedCategories) {
      const normalized = normalizeToolCategory(category);
      if (normalized) normalizedActiveCategories.add(normalized);
    }
    return runtimeToolDefs.filter((t: any) => {
      const name = String(t?.function?.name || '');
      const cat = getToolCategory(name);
      return cat === null || normalizedActiveCategories.has(cat);
    });
  }

  return runtimeToolDefs;
}

// ─── Tool Execution Helpers ────────────────────────────────────────────────────

export interface ToolResult {
  name: string;
  args: any;
  result: string;
  error: boolean;
  extra?: any;
  data?: any;
  artifacts?: any[];
}

export interface TaskControlResponse {
  success: boolean;
  action: string;
  code?: string;
  message?: string;
  scope?: string;
  task?: Record<string, any> | null;
  tasks?: Array<Record<string, any>>;
  scheduled_jobs?: Array<Record<string, any>>;
  candidates?: Array<Record<string, any>>;
}

export type ScheduleJobAction =
  | 'list'
  | 'create'
  | 'update'
  | 'pause'
  | 'resume'
  | 'delete'
  | 'run_now';

export function normalizeScheduleJobAction(raw: any): ScheduleJobAction | null {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'run-now') return 'run_now';
  if (['list', 'create', 'update', 'pause', 'resume', 'delete', 'run_now'].includes(v)) {
    return v as ScheduleJobAction;
  }
  return null;
}

export function summarizeCronJob(job: any): Record<string, any> {
  return {
    id: String(job?.id || ''),
    name: String(job?.name || ''),
    type: String(job?.type || 'recurring'),
    status: String(job?.status || 'scheduled'),
    enabled: job?.enabled !== false,
    schedule: job?.schedule || null,
    runAt: job?.runAt || null,
    tz: job?.tz || null,
    nextRun: job?.nextRun || null,
    lastRun: job?.lastRun || null,
    lastResult: job?.lastResult || null,
    sessionTarget: job?.sessionTarget || 'isolated',
    subagent_id: job?.subagent_id || null,
    team_id: job?.team_id || null,
    scheduleOwnerSubagent: job?.subagent_id || null,
    assignmentTarget: job?.assignmentTarget || null,
    deliverToMainChannel: job?.deliverToMainChannel === true,
    model: job?.model || null,
  };
}

export function normalizeDeliveryChannel(raw: any): 'web' | 'telegram' | 'discord' | 'whatsapp' {
  const v = String(raw || 'web').trim().toLowerCase();
  if (v === 'telegram' || v === 'discord' || v === 'whatsapp') return v;
  return 'web';
}

export function normalizeToolArgs(rawArgs: any): any {
  if (rawArgs == null) return {};
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof rawArgs === 'object') return rawArgs;
  return {};
}

export function normalizeToolArgsForTool(toolName: string, rawArgs: any): any {
  const normalized = normalizeToolArgs(rawArgs);
  if (toolName !== 'request_tool_category' || normalized?.category) return normalized;

  const categories = getRuntimeToolCategories();
  const readCategory = (value: unknown): string => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const direct = normalizeToolCategory(raw);
    if (direct && categories.includes(direct)) return direct;
    const match = raw.match(/\b(browser_automation|desktop_automation|agents_and_teams|prometheus_source_read|prometheus_source_write|workspace_write|advanced_memory|media_assets|media_quality|automations|external_apps|integration_admin|social_intelligence|proposal_admin|mcp_server_tools|composite_tools|creative_mode|browser|desktop|team_ops|source_read|source_write|file_ops|memory|media|integrations|connectors|mcp|composites)\b/);
    const matched = match ? normalizeToolCategory(match[1]) : null;
    return matched && categories.includes(matched) ? matched : '';
  };

  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    const category = readCategory((rawArgs as any).category || (rawArgs as any).name || (rawArgs as any).tool || (rawArgs as any).value);
    return category ? { ...normalized, category } : normalized;
  }

  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    let parsed: unknown = null;
    try { parsed = JSON.parse(trimmed); } catch { /* tolerate shorthand provider output */ }
    const category = readCategory(parsed || trimmed.replace(/^['"]|['"]$/g, ''));
    return category ? { ...normalized, category } : normalized;
  }

  return normalized;
}

export function parseJsonLike(raw: any): any {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function toStringRecord(raw: any): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[String(k)] = String(v);
  return out;
}

export function parseLooseMap(raw: any): Record<string, string> {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return toStringRecord(raw);
  if (typeof raw !== 'string') return {};
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}
