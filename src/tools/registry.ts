import { ToolResult } from '../types.js';
import { shellTool } from './shell.js';
import { readTool, writeTool, editTool, listTool, deleteTool, renameTool, copyTool, mkdirTool, statTool, appendTool, applyPatchTool, grepFilesTool, grepFileTool, searchFilesTool, fileStatsTool } from './files.js';
import { webSearchTool, webFetchTool } from './web.js';
// skill tools are handled in subagent-executor.ts, not the registry
import { timeNowTool } from './time.js';
import { personaReadTool, personaUpdateTool } from './persona.js';
import { agentListTool, agentInfoTool } from './agent-control.js';
import { allDesktopTools } from './desktop.js';
import { scheduleMemoryTool } from './schedule-memory-tool.js';
import { talkToManagerTool, getTeamLogsTool, scheduleJobTool, manageTeamGoalTool, manageTeamContextRefTool } from './team-tools.js';
import { uploadImageTool, fetchImageTool } from './image-tools.js';
import { vercelDeployTool, vercelEnvTool } from './vercel-tools.js';
import { writeNoteTool } from './write-note.js';
import { deployAnalysisTeamTool, injectAnalysisTeamDeps } from './deploy-analysis-team.js';
import { viewConnectionsTool } from './view-connections.js';
import { isPublicDistributionBuild } from '../runtime/distribution.js';

// ── Phase 5: Policy engine + audit log ──────────────────────────────────────
import { getPolicyEngine } from '../gateway/policy.js';
import { appendAuditEntry, maybeRotateLog } from '../gateway/audit-log.js';

export interface Tool {
  name: string;
  description: string;
  execute: (args: any) => Promise<ToolResult>;
  schema: Record<string, string>;
  // Optional explicit OpenAPI-style JSON schema for native function-call parameters.
  // When provided, this is used instead of description-based type inference.
  jsonSchema?: Record<string, any>;
}

export type ToolProfile = 'minimal' | 'coding' | 'web' | 'full' | 'desktop';

/**
 * SUBAGENT_PROFILES — Step 23 (Phase 5)
 *
 * Maps SubagentProfile names (stored on TaskRecord.subagentProfile) to an
 * explicit allowlist of tool names that handleChat's executor will accept.
 *
 * Rules:
 *   - undefined entry → no filter → full access (same as 'full' ToolProfile)
 *   - Prefix '!' means exclude that pattern (e.g. '!browser_*', '!desktop_*')
 *   - These names must match the tool case labels in subagent-executor.ts
 *
 * When adding a new subagent profile type, add it here and BTR will
 * automatically pick it up — no changes needed elsewhere.
 */
export const SUBAGENT_PROFILES: Record<string, string[]> = {
  // File-only worker: read/write/edit files and run shell. No browser/desktop/web.
  file_editor: [
    'read_file', 'create_file', 'replace_lines', 'insert_after', 'delete_lines',
    'find_replace', 'delete_file', 'list_files', 'list_directory', 'mkdir',
    'run_command', 'write_note', 'memory_browse', 'memory_write', 'memory_read', 'memory_search', 'memory_read_record', 'memory_get_related', 'memory_graph_snapshot',
    'task_control', 'grep_files', 'grep_file', 'search_files', 'file_stats', 'source_stats', 'webui_source_stats',
  ],
  // Research worker: web search + read-only file access. No mutations, no browser UI.
  researcher: [
    'web_search', 'web_fetch', 'read_file', 'list_files', 'list_directory',
    'write_note', 'memory_browse', 'memory_write', 'memory_read', 'memory_search', 'memory_read_record', 'memory_get_related', 'memory_graph_snapshot', 'task_control',
  ],
  // Shell-only worker: run commands and read/write files.
  shell_runner: [
    'run_command', 'read_file', 'create_file', 'replace_lines', 'insert_after',
    'delete_lines', 'find_replace', 'delete_file', 'list_files', 'list_directory',
    'mkdir', 'write_note', 'memory_browse', 'memory_write', 'memory_search', 'memory_read_record', 'memory_index_refresh', 'task_control',
  ],
  // Read-only auditor: inspect files and memory, no writes.
  reader_only: [
    'read_file', 'list_files', 'list_directory', 'web_search', 'web_fetch',
    'memory_browse', 'memory_read', 'memory_search', 'memory_read_record', 'memory_get_related', 'memory_graph_snapshot', 'task_control', 'source_stats', 'webui_source_stats',
  ],
  // Code writer: full file + shell access, no browser/desktop.
  code_writer: [
    'read_file', 'create_file', 'replace_lines', 'insert_after', 'delete_lines',
    'find_replace', 'delete_file', 'list_files', 'list_directory', 'mkdir',
    'run_command', 'web_search', 'web_fetch', 'write_note',
    'memory_browse', 'memory_write', 'memory_read', 'memory_search', 'memory_read_record', 'memory_get_related', 'memory_graph_snapshot', 'memory_index_refresh', 'task_control', 'grep_files', 'grep_file', 'search_files', 'file_stats', 'source_stats', 'webui_source_stats',
  ],
  // Data analyst: read files + web, no writes or shell mutations.
  analyst: [
    'read_file', 'list_files', 'list_directory', 'web_search', 'web_fetch',
    'memory_browse', 'memory_write', 'memory_read', 'memory_search', 'memory_read_record', 'memory_get_related', 'memory_graph_snapshot', 'write_note', 'task_control',
  ],
  // Browser automation agent: full browser + file access, no desktop.
  web_agent: [
    'browser_open', 'browser_snapshot', 'browser_click', 'browser_fill',
    'browser_press_key', 'browser_wait', 'browser_scroll', 'browser_close',
    'browser_get_focused_item', 'browser_get_page_text',
    'browser_vision_screenshot', 'browser_vision_click', 'browser_vision_type',
    'browser_send_to_telegram',
    'web_search', 'web_fetch', 'read_file', 'create_file', 'list_files',
    'list_directory', 'write_note', 'memory_browse', 'memory_write', 'memory_search', 'memory_read_record', 'memory_graph_snapshot', 'task_control',
  ],
  // Scraper: browser + write output files.
  scraper: [
    'browser_open', 'browser_snapshot', 'browser_click', 'browser_fill',
    'browser_press_key', 'browser_wait', 'browser_scroll', 'browser_close',
    'browser_get_focused_item', 'browser_get_page_text', 'browser_send_to_telegram',
    'web_search', 'web_fetch', 'create_file', 'read_file', 'list_files',
    'list_directory', 'write_note', 'memory_browse', 'memory_write', 'memory_search', 'memory_read_record', 'memory_graph_snapshot', 'task_control',
  ],
};

/**
 * Returns the tool allowlist for a given subagent profile name.
 * Returns undefined (= no filter = full access) for unknown profiles.
 */
export function getSubagentToolFilter(profile: string | undefined): string[] | undefined {
  if (!profile) return undefined;
  return SUBAGENT_PROFILES[profile] ?? undefined;
}

const TOOL_PROFILE_TOOL_NAMES: Record<Exclude<ToolProfile, 'full'>, ReadonlySet<string>> = {
  desktop: new Set([
    'desktop_screenshot',
    'desktop_get_monitors',
    'desktop_window_screenshot',
    'desktop_find_window',
    'desktop_focus_window',
    'desktop_click',
    'desktop_drag',
    'desktop_wait',
    'desktop_type',
    'desktop_press_key',
    'desktop_get_clipboard',
    'desktop_set_clipboard',
    'desktop_launch_app',
    'desktop_close_app',
    'desktop_get_process_list',
    'desktop_wait_for_change',
    'desktop_diff_screenshot',
    'write_note',
    'time_now',
    'manage_team_goal',
    'manage_team_context_ref',
  ]),
  minimal: new Set([
    'write_note',
    'time_now',
    'manage_team_goal',
    'manage_team_context_ref',
  ]),
  coding: new Set([
    'shell',
    'read',
    'write',
    'edit',
    'list',
    'delete',
    'rename',
    'copy',
    'mkdir',
    'stat',
    'append',
    'apply_patch',
    'write_note',
    'manage_team_goal',
    'manage_team_context_ref',
  ]),
  web: new Set([
    'web_search',
    'web_fetch',
    'write_note',
    'manage_team_goal',
    'manage_team_context_ref',
  ]),
};

function isToolProfile(value: string): value is ToolProfile {
  return value === 'minimal' || value === 'coding' || value === 'web' || value === 'full' || value === 'desktop';
}

// ─── Policy execution context ─────────────────────────────────────────────────
// Allows the server-v2 chat handler to inject session/agent context so every
// tool call is stamped with the correct sessionId in the audit log.

let _currentSessionId: string = 'unknown';
let _currentAgentId: string | undefined = undefined;

export function setToolExecutionContext(sessionId: string, agentId?: string): void {
  _currentSessionId = sessionId || 'unknown';
  _currentAgentId = agentId;
}

export function clearToolExecutionContext(): void {
  _currentSessionId = 'unknown';
  _currentAgentId = undefined;
}

class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  private registerSafe(tool: Tool): void {
    try {
      this.register(tool);
    } catch (err: any) {
      const label = tool?.name || 'unknown_tool';
      const message = String(err?.message || err || 'unknown error');
      console.warn(`[tools] Failed to register "${label}": ${message}`);
    }
  }

  constructor() {
    // Core filesystem + shell
    this.registerSafe(shellTool);
    this.registerSafe(readTool);
    this.registerSafe(writeTool);
    this.registerSafe(editTool);
    this.registerSafe(listTool);
    this.registerSafe(deleteTool);
    // Additional filesystem utilities
    this.registerSafe(renameTool);
    this.registerSafe(copyTool);
    this.registerSafe(mkdirTool);
    this.registerSafe(statTool);
    this.registerSafe(appendTool);
    this.registerSafe(applyPatchTool);
    this.registerSafe(grepFilesTool);
    this.registerSafe(grepFileTool);
    this.registerSafe(searchFilesTool);
    this.registerSafe(fileStatsTool);
    // Web tools
    this.registerSafe(webSearchTool);
    this.registerSafe(webFetchTool);
    // Memory tools are provided by the subagent runtime executor
    // (memory_browse, memory_write, memory_read over USER.md/SOUL.md/MEMORY.md).
    // Time tool (system clock — no network)
    this.registerSafe(timeNowTool);
    // Skills tools (list/enable/disable/create — executed via subagent-executor, not registry)
    if (!isPublicDistributionBuild()) {
      const { selfUpdateTool } = require('./self-update.js');
      const { readSourceTool, listSourceTool, sourceStatsTool, webUiSourceStatsTool } = require('./source-access.js');
      const { proposeRepairTool } = require('./self-repair.js');
      // Self-update tool
      this.registerSafe(selfUpdateTool);
      // Self-repair tools (source read + repair proposal)
      this.registerSafe(readSourceTool);
      this.registerSafe(listSourceTool);
      this.registerSafe(sourceStatsTool);
      this.registerSafe(webUiSourceStatsTool);
      this.registerSafe(proposeRepairTool);
    }
    // Persona / memory growth tools
    this.registerSafe(personaReadTool);
    this.registerSafe(personaUpdateTool);
    // Intraday notes tool (for subagents and scheduled jobs)
    this.registerSafe(writeNoteTool);
    // Agent inspection tools
    this.registerSafe(agentListTool);
    this.registerSafe(agentInfoTool);
    // Schedule memory update tool (for post-task memory extraction)
    this.registerSafe(scheduleMemoryTool);
    // Team management tools
    this.registerSafe(talkToManagerTool);
    this.registerSafe(getTeamLogsTool);
    this.registerSafe(scheduleJobTool);
    this.registerSafe(manageTeamGoalTool);
    this.registerSafe(manageTeamContextRefTool);
    // Image tools (Supabase Storage upload)
    this.registerSafe(uploadImageTool);
    this.registerSafe(fetchImageTool);
    // Vercel deployment tools
    this.registerSafe(vercelDeployTool);
    this.registerSafe(vercelEnvTool);
    this.registerSafe(deployAnalysisTeamTool);
    this.registerSafe(viewConnectionsTool);
    // Desktop automation tools (Phase 2 — ToolRegistry integration)
    for (const tool of allDesktopTools) {
      this.registerSafe(tool);
    }
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  private listByProfile(profile: ToolProfile = 'full'): Tool[] {
    if (profile === 'full') return this.list();
    const toolNames = TOOL_PROFILE_TOOL_NAMES[profile];
    return this.list().filter((tool) => toolNames.has(tool.name));
  }

  resolveToolProfile(profile?: string | null): ToolProfile {
    const normalized = String(profile || '').trim().toLowerCase();
    return isToolProfile(normalized) ? normalized : 'full';
  }

  /**
   * Phase 5 policy-gated execute().
   *
   * Tier routing:
   *   READ   → execute immediately, log as 'auto'
   *   PROPOSE → return a proposal draft (ToolResult with data.proposal),
   *             do NOT execute. The caller must present this to the user and
   *             re-call executeBypass() after approval.
   *   COMMIT  → route to the existing approval flow via getVerificationFlowManager()
   *             (returns needs_approval ToolResult, waits for WebSocket approval).
   */
  async execute(toolName: string, args: any): Promise<ToolResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}. Available tools: ${Array.from(this.tools.keys()).join(', ')}`
      };
    }

    // ── Policy evaluation ──────────────────────────────────────────────────
    let policy;
    try {
      policy = getPolicyEngine().evaluateAction(_currentAgentId || 'main', toolName, args || {});
    } catch {
      policy = { tier: 'read' as const, riskScore: 0, reason: 'policy engine unavailable', affectedSystems: [], matchedRule: null };
    }

    const tier = policy.tier;

    // ── Audit: record the intent ───────────────────────────────────────────
    appendAuditEntry({
      sessionId: _currentSessionId,
      agentId: _currentAgentId,
      actionType: 'tool_call',
      toolName,
      toolArgs: args,
      policyTier: tier,
      approvalStatus: tier === 'read' ? 'auto' : 'pending',
    });

    // ── Rotate log occasionally ────────────────────────────────────────────
    // Do it asynchronously so we don't slow down tool execution
    setImmediate(() => { try { maybeRotateLog(); } catch { /* best-effort */ } });

    // ── READ tier: just execute ────────────────────────────────────────────
    if (tier === 'read') {
      return this._runTool(tool, args, toolName);
    }

    // ── PROPOSE tier: return a draft without executing ────────────────────
    if (tier === 'propose') {
      const proposalResult: ToolResult = {
        success: true,
        data: {
          _proposalPending: true,
          toolName,
          args,
          policyTier: 'propose',
          riskScore: policy.riskScore,
          reason: policy.reason,
          affectedSystems: policy.affectedSystems,
          summary: policy.proposalSummary,
        },
        stdout: `[PROPOSE] "${toolName}" requires review before execution.\n` +
                `Risk score: ${policy.riskScore}/10\n` +
                `Reason: ${policy.reason}\n` +
                `Affected: ${policy.affectedSystems.join(', ') || 'none'}\n\n` +
                `The action has been staged as a proposal. Approve it in the Proposals panel.`,
      };

      // Auto-create a lightweight proposal record
      try {
        const { createProposal } = await import('../gateway/proposals/proposal-store.js');
        createProposal({
          type: 'task_trigger',
          priority: policy.riskScore >= 7 ? 'high' : policy.riskScore >= 4 ? 'medium' : 'low',
          title: `Tool call: ${toolName}`,
          summary: policy.proposalSummary || `"${toolName}" wants to run`,
          details: `**Tool:** \`${toolName}\`\n\n**Args:**\n\`\`\`json\n${JSON.stringify(args, null, 2)}\`\`\`\n\n**Policy reason:** ${policy.reason}`,
          sourceAgentId: _currentAgentId || 'main',
          sourceSessionId: _currentSessionId || undefined,
          affectedFiles: [],
          requiresBuild: false,
        });
      } catch { /* proposal store optional */ }

      appendAuditEntry({
        sessionId: _currentSessionId,
        agentId: _currentAgentId,
        actionType: 'approval_requested',
        toolName,
        toolArgs: args,
        policyTier: 'propose',
        approvalStatus: 'pending',
        resultSummary: 'Staged as proposal',
      });

      return proposalResult;
    }

    // ── COMMIT tier: route to existing verification flow ──────────────────
    // Return a needs_approval result; the server-v2 approval handler will
    // present this to the user via the existing approval card UI.
    appendAuditEntry({
      sessionId: _currentSessionId,
      agentId: _currentAgentId,
      actionType: 'approval_requested',
      toolName,
      toolArgs: args,
      policyTier: 'commit',
      approvalStatus: 'pending',
      resultSummary: 'Awaiting user approval',
    });

    return {
      success: false,
      error: `[APPROVAL REQUIRED] "${toolName}" is a COMMIT-tier action and requires explicit user approval.\n` +
             `Risk score: ${policy.riskScore}/10\n` +
             `Reason: ${policy.reason}\n` +
             `Affected systems: ${policy.affectedSystems.join(', ') || 'none'}\n\n` +
             `Check the approval panel to approve or reject this action.`,
      data: {
        _needsApproval: true,
        toolName,
        args,
        policyTier: 'commit',
        riskScore: policy.riskScore,
        reason: policy.reason,
        affectedSystems: policy.affectedSystems,
      },
    };
  }

  /**
   * Execute a tool bypassing policy checks (used after approval is granted).
   * This is intentionally separate so call sites are explicit about bypassing.
   */
  async executeBypass(toolName: string, args: any): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolName}` };
    }

    const result = await this._runTool(tool, args, toolName);

    appendAuditEntry({
      sessionId: _currentSessionId,
      agentId: _currentAgentId,
      actionType: 'tool_call',
      toolName,
      toolArgs: args,
      policyTier: 'commit',
      approvalStatus: 'approved',
      resultSummary: result.success
        ? String(result.stdout || result.data || 'ok').slice(0, 200)
        : undefined,
      error: result.success ? undefined : String(result.error || '').slice(0, 200),
    });

    return result;
  }

  /** Internal: actually run the tool, wrap errors */
  private async _runTool(tool: Tool, args: any, toolName: string): Promise<ToolResult> {
    try {
      const result = await tool.execute(args);

      // Audit the result
      appendAuditEntry({
        sessionId: _currentSessionId,
        agentId: _currentAgentId,
        actionType: 'tool_call',
        toolName,
        policyTier: 'read',
        approvalStatus: 'auto',
        resultSummary: result.success
          ? String(result.stdout || result.data || 'ok').slice(0, 200)
          : undefined,
        error: result.success ? undefined : String(result.error || '').slice(0, 200),
      });

      return result;
    } catch (error: any) {
      const errMsg = `Tool execution failed: ${error.message}`;

      appendAuditEntry({
        sessionId: _currentSessionId,
        agentId: _currentAgentId,
        actionType: 'tool_call',
        toolName,
        policyTier: 'read',
        approvalStatus: 'auto',
        error: errMsg.slice(0, 200),
      });

      return { success: false, error: errMsg };
    }
  }

  getToolSchemas(profile: ToolProfile = 'full'): string {
    const tools = this.listByProfile(profile);
    return tools.map(tool => {
      const schemaStr = Object.entries(tool.schema)
        .map(([key, desc]) => `  - ${key}: ${desc}`)
        .join('\n');

      return `${tool.name}: ${tool.description}\n${schemaStr}`;
    }).join('\n\n');
  }

  getToolDefinitionsForChat(profile: ToolProfile = 'full'): any[] {
    const tools = this.listByProfile(profile);
    const inferParamSchema = (key: string, desc: string): any => {
      const k = String(key || '').toLowerCase();
      const d = String(desc || '').toLowerCase();
      if (/\b(true|false|boolean)\b/.test(d) || /\b(force|strict|recursive|enabled|disabled|stream|dry_run|dry run)\b/.test(k)) {
        return { type: 'boolean', description: String(desc || '') };
      }
      if (
        /\b(integer|number|count|max|min|limit|timeout|ms|seconds?|minutes?|days?)\b/.test(d)
        || /(max|min|count|limit|timeout|num|days|hours|minutes|seconds|retries|offset|line|chars|size|port)$/.test(k)
      ) {
        return { type: 'number', description: String(desc || '') };
      }
      if (/\bjson\b/.test(d) || /(args|params|options|payload|values)_?json$/.test(k)) {
        return {
          anyOf: [
            { type: 'object' },
            { type: 'array' },
            { type: 'string' },
          ],
          description: String(desc || ''),
        };
      }
      return { type: 'string', description: String(desc || '') };
    };
    const buildInferredParameters = (tool: Tool): Record<string, any> => {
      const properties: Record<string, any> = {};
      for (const [key, desc] of Object.entries(tool.schema || {})) {
        properties[key] = inferParamSchema(key, String(desc || ''));
      }
      return {
        type: 'object',
        properties,
        additionalProperties: true,
      };
    };
    const normalizeExplicitParameters = (tool: Tool): Record<string, any> | null => {
      const raw = tool.jsonSchema;
      if (!raw || typeof raw !== 'object') return null;
      const normalized: Record<string, any> = { ...raw };
      if (normalized.type == null) normalized.type = 'object';
      if (normalized.properties == null) normalized.properties = {};
      if (normalized.additionalProperties == null) normalized.additionalProperties = true;
      return normalized;
    };
    return tools.map((tool) => {
      const explicitParameters = normalizeExplicitParameters(tool);
      const inferredParameters = buildInferredParameters(tool);
      const parameters = explicitParameters || inferredParameters;
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters,
        },
      };
    });
  }

  isToolEnabled(toolName: string, enabledTools: string[]): boolean {
    return enabledTools.includes(toolName);
  }
}

// Singleton instance
let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}
