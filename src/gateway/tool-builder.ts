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
import { getCompositeDefs, getCompositeManagementTools, loadComposites } from './tools/composite-tools';
import { getConnectorToolDefs, buildConnectorStatus } from './tools/defs/connector-tools';
import { getPublicBuildAllowedCategories } from '../runtime/distribution.js';

export interface BuildToolsDeps {
  getMCPManager: () => any;
}

// ─── Tool Category System ─────────────────────────────────────────────────────
// Tools split into: core (always injected) + on-demand categories.
// Categories are activated per-session via request_tool_category tool.

export const ALL_TOOL_CATEGORIES = ['browser', 'desktop', 'team_ops', 'source_write', 'integrations', 'connectors', 'composites'] as const;
export type ToolCategory = typeof ALL_TOOL_CATEGORIES[number];

export { buildConnectorStatus };

export function getRuntimeToolCategories(): ToolCategory[] {
  return getPublicBuildAllowedCategories(ALL_TOOL_CATEGORIES) as ToolCategory[];
}

// Explicit name lists for non-prefix categories
const TEAM_OPS_TOOL_NAMES = new Set([
  'spawn_subagent', 'delegate_to_specialist',
  'agent_list', 'agent_info', 'delete_agent',
  'message_subagent', 'talk_to_subagent', 'talk_to_manager', 'talk_to_teammate',
  'update_my_status', 'update_team_goal', 'team_manage',
  'dispatch_to_agent', 'dispatch_team_agent', 'get_agent_result',
  'post_to_team_chat', 'message_main_agent', 'reply_to_team',
  'manage_team_goal',
  // ask_team_coordinator intentionally excluded — it's a core tool (always available)
  // deploy_analysis_team intentionally excluded — user-facing tool, must always be available
]);

// schedule_job + parse_schedule_pattern are CORE — always injected so cron/heartbeat/subagent
// sessions can reschedule and manage jobs without needing category activation.
// background_spawn/status/progress/join are also CORE — always injected.

const SOURCE_WRITE_TOOL_NAMES = new Set([
  'find_replace_source', 'replace_lines_source', 'insert_after_source',
  'delete_lines_source', 'write_source',
  'find_replace_webui_source', 'replace_lines_webui_source', 'insert_after_webui_source',
  'delete_lines_webui_source', 'write_webui_source',
]);

const INTEGRATIONS_TOOL_NAMES = new Set([
  'mcp_server_manage', 'webhook_manage', 'integration_quick_setup',
  'social_intel', 'edit_proposal',
]);

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

export function getToolCategory(name: string): ToolCategory | null {
  // Keep these always available as core runtime tools.
  if (name === 'browser_send_to_telegram') return null;
  if (name === 'connector_list') return null; // core tool — always available
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('desktop_')) return 'desktop';
  if (name.startsWith('connector_')) return 'connectors';
  if (TEAM_OPS_TOOL_NAMES.has(name)) return 'team_ops';
  if (SOURCE_WRITE_TOOL_NAMES.has(name)) return 'source_write';
  if (INTEGRATIONS_TOOL_NAMES.has(name)) return 'integrations';
  if (COMPOSITE_MANAGEMENT_TOOL_NAMES.has(name) || isSavedCompositeToolName(name)) return 'composites';
  return null; // null = core tool, always included
}

export function buildTools(deps: BuildToolsDeps, activatedCategories?: Set<string>) {
  const { getMCPManager } = deps;

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
            visible: { type: 'boolean', description: 'If true, opens a visible terminal window instead of capturing output. Default: false (captured).' },
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
      return [{
        type: 'function' as const,
        function: {
          name: 'delegate_to_specialist',
          description:
            'Delegate a focused, self-contained subtask to a specialist sub-agent. ' +
            'Use for file edits, research lookups, or shell commands that are narrow and well-scoped. ' +
            'The current task pauses until the specialist completes.',
          parameters: {
            type: 'object',
            required: ['type', 'input'],
            properties: {
              type: {
                type: 'string',
                enum: ['file_editor', 'researcher', 'shell_runner', 'reader_only'],
                description: 'Specialist role',
              },
              input: { type: 'string', description: 'Precise instruction for the specialist' },
              context_snippet: { type: 'string', description: 'Relevant context the specialist needs (file content, URL, etc.)' },
              target_file: { type: 'string', description: 'File to operate on (for file_editor)' },
            },
          },
        },
      }];
    })(),
    // ── Agent, Team, and Schedule tools ──────────────────────────────────────
    ...getAgentTeamScheduleTools(),
    // ── CIS, System, and Self-improvement tools ───────────────────────────────
    ...getCisSystemTools(),
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
        'Use this before activating the connectors category to check what\'s available.',
      parameters: { type: 'object', required: [], properties: {} },
    },
  });

  // ── Connector tools (activated via connectors category) ───────────────────
  try {
    toolDefs.push(...getConnectorToolDefs());
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

  // ── Filter to core + activated categories ──────────────────────────────────
  // When activatedCategories is provided, only return core tools + those in active categories.
  // MCP tools (mcp__*) are always included since they're dynamically connected.
  if (activatedCategories !== undefined) {
    return toolDefs.filter((t: any) => {
      const name = String(t?.function?.name || '');
      if (name.startsWith('mcp__')) return true;
      const cat = getToolCategory(name);
      return cat === null || activatedCategories.has(cat);
    });
  }

  return toolDefs;
}

// ─── Tool Execution Helpers ────────────────────────────────────────────────────

export interface ToolResult {
  name: string;
  args: any;
  result: string;
  error: boolean;
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
    if (categories.includes(raw as ToolCategory)) return raw;
    const match = raw.match(/\b(browser|desktop|team_ops|source_write|integrations|connectors|composites)\b/);
    return match && categories.includes(match[1] as ToolCategory) ? match[1] : '';
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
