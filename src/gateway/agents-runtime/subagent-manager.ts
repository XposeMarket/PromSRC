/**
 * subagent-manager.ts — Modular Dynamic Subagent System
 *
 * Allows primary agents to spawn/manage specialized subagents with:
 * - Dynamic tool sets
 * - Custom constraints and instructions
 * - Persistent config files user can edit
 * - Call-time or create-time parameters
 */

import fs from 'fs';
import path from 'path';
import { TaskRecord, createTask } from '../tasks/task-store';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import { getConfig } from '../../config/config.js';

export interface SubagentDefinition {
  id: string;
  name: string;
  description: string;
  
  // Execution constraints
  max_steps: number;
  timeout_ms: number;
  model?: string;  // Override from main config
  
  // Capabilities
  // Preferred: category-based access — pre-activates full tool categories on the session.
  // Valid values: 'browser' | 'desktop' | 'team_ops' | 'source_write' | 'integrations'
  // Core tools (file ops, web, shell, memory, send_telegram) are always available regardless.
  // request_tool_category is always available as a last-resort escape hatch.
  allowed_categories?: string[];
  // Legacy: individual tool names — still supported but superseded by allowed_categories.
  allowed_tools: string[];  // Legacy metadata only. Team dispatch runtime does not restrict by this list.
  forbidden_tools: string[];  // Explicit blacklist
  mcp_servers?: string[];    // Piece 4: MCP server IDs this subagent can use
  
  // Behavior
  system_instructions: string;    // Detailed personality/rules
  constraints: string[];          // "Do not hallucinate", "Return ONLY facts", etc.
  success_criteria: string;       // "When to stop and return results"
  roleType?: string;              // Base preset role, e.g. researcher, analyst, operator
  teamRole?: string;              // Team-specific role title, e.g. Website/SEO Qualifier
  teamAssignment?: string;        // Team-specific job/mission for this agent
  baseRolePrompt?: string;        // Original preset prompt used to create this agent
  
  // Metadata
  created_at: number;
  modified_at: number;
  created_by: 'user' | 'ai';
  version: string;
}

export interface SubagentCallRequest {
  // Identify or create subagent
  subagent_id: string;            // e.g., "news_researcher_v1"
  subagent_name?: string;         // If different from ID
  
  // Task for this subagent
  task_prompt: string;            // "Extract headlines from these 3 Reuters pages"
  context_data?: Record<string, any>;  // Snapshots, URLs, etc.
  run_now?: boolean;              // default true; set false to create/ensure without executing
  
  // Create new subagent if doesn't exist
  create_if_missing?: {
    name?: string;              // Display name (falls back to first line of description)
    description: string;
    // Preferred: category names to pre-activate ('browser', 'desktop', 'team_ops', etc.)
    allowed_categories?: string[];
    // Legacy: individual tool names (still supported)
    allowed_tools?: string[];
    forbidden_tools?: string[];
    mcp_servers?: string[];  // Piece 4
    system_instructions: string;
    heartbeat_instructions?: string;  // Written to HEARTBEAT.md
    constraints: string[];
    success_criteria: string;
    max_steps?: number;
    timeout_ms?: number;
    model?: string;
    roleType?: string;          // Set when created from_role — drives model resolution
    teamRole?: string;
    teamAssignment?: string;
    baseRolePrompt?: string;
    is_team_manager?: boolean;  // If true, marks as team manager in config.json
  };
}

export interface SubagentResult {
  subagent_id: string;
  task_id: string;
  status: 'running' | 'complete' | 'failed' | 'paused' | 'spawned' | 'created';
  result_text: string;
  extracted_data?: Record<string, any>;
  error?: string;
}

const SUBAGENT_STORE_DIR = '.prometheus/subagents';

export class SubagentManager {
  private storePath: string;
  private broadcastFn?: (data: any) => void;
  // Piece 3: references for launching real BackgroundTaskRunner
  private handleChatFn?: (...args: any[]) => Promise<any>;
  private telegramChannelRef?: any;

  constructor(
    workspacePath: string,
    broadcastFn?: (data: any) => void,
    handleChatFn?: (...args: any[]) => Promise<any>,
    telegramChannelRef?: any,
  ) {
    this.storePath = path.join(workspacePath, SUBAGENT_STORE_DIR);
    this.broadcastFn = broadcastFn;
    this.handleChatFn = handleChatFn;
    this.telegramChannelRef = telegramChannelRef ?? null;
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath, { recursive: true });
    }
  }

  /**
   * Get or create a subagent and spawn it with a task
   */
  async callSubagent(
    request: SubagentCallRequest,
    parentTaskId: string,
  ): Promise<SubagentResult> {
    const subagentId = request.subagent_id;
    const runNow = request.run_now !== false;
    
    // Load existing or create new
    let definition = this.loadSubagent(subagentId);
    if (!definition && request.create_if_missing) {
      definition = this.createSubagent(subagentId, request.create_if_missing);
    }
    
    if (!definition) {
      throw new Error(`Subagent "${subagentId}" not found and no create_if_missing provided`);
    }

    // Create/ensure-only mode: do not enqueue or run anything.
    if (!runNow) {
      return {
        subagent_id: subagentId,
        task_id: '',
        status: 'created',
        result_text: `Subagent "${subagentId}" is ready (not executed).`,
        extracted_data: undefined,
      };
    }

    const taskPrompt = String(request.task_prompt || '').trim();
    if (!taskPrompt) {
      throw new Error('task_prompt is required when run_now=true');
    }

    // Build task for this subagent
    const subagentPrompt = this.buildSubagentPrompt(definition, taskPrompt, request.context_data);

    // Resolve this subagent's dedicated workspace so BackgroundTaskRunner
    // can scope all file tool calls to it via workspace-context.ts.
    let agentWorkspace: string | undefined;
    try {
      const { getAgentById, ensureAgentWorkspace } = require('../../config/config');
      const agentDef = getAgentById(subagentId);
      if (agentDef) agentWorkspace = ensureAgentWorkspace(agentDef);
    } catch { /* non-fatal */ }
    // Fallback: derive from the store path (matches registerInConfig logic)
    if (!agentWorkspace) {
      agentWorkspace = path.join(this.storePath, subagentId);
    }

    const subagentSessionId = `subagent_${subagentId}_${Date.now()}`;
    const subagentTask = createTask({
      title: `[Subagent] ${definition.name}`,
      prompt: subagentPrompt,
      sessionId: subagentSessionId,
      channel: 'web',
      subagentProfile: definition.id,  // Mark as subagent with restrictions
      parentTaskId,  // Link to parent
      agentWorkspace,                   // Workspace isolation — scopes file tools
      plan: this.buildDefaultPlan(definition),
    });

    // Pre-activate tool categories on this session so the subagent sees them from turn 1.
    // Core tools (file ops, web, shell, send_telegram) are always available.
    // request_tool_category remains available as last-resort escape hatch.
    const cats: string[] = Array.isArray((definition as any).allowed_categories)
      ? (definition as any).allowed_categories
      : [];
    if (cats.length > 0) {
      try {
        const { activateToolCategory } = require('../session');
        for (const cat of cats) {
          activateToolCategory(subagentSessionId, cat);
        }
      } catch (err: any) {
        console.warn(`[SubagentManager] Failed to pre-activate categories: ${err?.message}`);
      }
    }

    // Broadcast agent_spawned event to UI
    if (this.broadcastFn) {
      this.broadcastFn({
        type: 'agent_spawned',
        serverAgentId: subagentTask.id,
        name: definition.name,
        task: taskPrompt,
        isSubagent: true,
      });
    }

    // Piece 3: Actually launch BackgroundTaskRunner if handleChatFn is available
    if (this.handleChatFn) {
      const runner = new BackgroundTaskRunner(
        subagentTask.id,
        this.handleChatFn as any,
        this.broadcastFn ?? (() => {}),
        this.telegramChannelRef,
      );
      runner.start().catch((err: any) =>
        console.error(`[SubagentManager] Runner error for ${subagentTask.id}:`, err?.message)
      );

      return {
        subagent_id: subagentId,
        task_id: subagentTask.id,
        status: 'running',
        result_text: 'Subagent launched and running',
        extracted_data: undefined,
      };
    }

    // Fallback: no handleChatFn provided — task is queued for heartbeat pickup
    return {
      subagent_id: subagentId,
      task_id: subagentTask.id,
      status: 'spawned',
      result_text: 'Subagent queued for execution',
      extracted_data: undefined,
    };
  }

  /**
   * Load subagent definition from disk
   */
  private loadSubagent(id: string): SubagentDefinition | null {
    const configPath = path.join(this.storePath, id, 'config.json');
    try {
      if (!fs.existsSync(configPath)) return null;
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      console.error(`[SubagentManager] Failed to load ${id}:`, err);
      return null;
    }
  }

  /**
   * Create and persist a new subagent definition
   */
  private createSubagent(id: string, params: SubagentCallRequest['create_if_missing']): SubagentDefinition {
    if (!params) throw new Error('create_if_missing required');

    const definition: SubagentDefinition = {
      id,
      name: params.name ? String(params.name).slice(0, 80) : params.description.split('\n')[0].slice(0, 80),
      description: params.description,
      max_steps: params.max_steps ?? 20,
      timeout_ms: params.timeout_ms ?? 300_000,
      model: params.model,
      allowed_categories: params.allowed_categories ?? [],
      allowed_tools: params.allowed_tools ?? [],
      forbidden_tools: params.forbidden_tools ?? [],
      mcp_servers: params.mcp_servers ?? [],
      system_instructions: params.system_instructions,
      constraints: params.constraints,
      success_criteria: params.success_criteria,
      roleType: params.roleType,
      teamRole: params.teamRole,
      teamAssignment: params.teamAssignment,
      baseRolePrompt: params.baseRolePrompt,
      created_at: Date.now(),
      modified_at: Date.now(),
      created_by: 'ai',
      version: '1.0',
    } as any;

    // Persist
    const agentDir = path.join(this.storePath, id);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'config.json'),
      JSON.stringify(definition, null, 2),
    );

    // Write editable system prompt file
    fs.writeFileSync(
      path.join(agentDir, 'system_prompt.md'),
      this.buildSystemPromptFile(definition),
    );

    // Always create HEARTBEAT.md so heartbeat tooling can manage this subagent.
    const heartbeatPath = path.join(agentDir, 'HEARTBEAT.md');
    const heartbeatContent = params.heartbeat_instructions
      ? String(params.heartbeat_instructions).trim()
      : [
          `# HEARTBEAT.md - ${definition.name}`,
          '',
          '## Heartbeat Checklist',
          '- Review queued one-off tasks (if any).',
          '- Perform only clearly actionable work from this role.',
          '- Write outputs to files in this workspace.',
          '- If nothing is actionable, reply with HEARTBEAT_OK.',
        ].join('\n');
    fs.writeFileSync(heartbeatPath, heartbeatContent, 'utf-8');

    // Register into config.json agents array so agent_list() can see it
    this.registerInConfig(definition, { isTeamManager: params.is_team_manager === true });

    // New subagents should start with heartbeat disabled until explicitly enabled.
    // This avoids newly-created agents running autonomously before they are configured.
    try {
      // Late import avoids direct startup coupling and circular init concerns.
      const { getHeartbeatRunnerInstance } = require('../scheduling/heartbeat-runner.js');
      const runner = getHeartbeatRunnerInstance?.();
      if (runner) {
        runner.registerAgent(id, agentDir);
        runner.updateAgentConfig(id, { enabled: false });
      }
    } catch { /* non-fatal */ }

    console.log(`[SubagentManager] Created new subagent: ${id}`);
    return definition;
  }

  /**
   * Build system prompt file that user can edit
   */
  private buildSystemPromptFile(def: SubagentDefinition): string {
    return [
      `# ${def.name}`,
      ``,
      def.description,
      ``,
      `## Base Preset Role`,
      def.roleType ? `Role: ${def.roleType}` : '(not recorded)',
      def.baseRolePrompt ? `\nPreset prompt:\n${def.baseRolePrompt}` : '',
      ``,
      `## Team-Specific Role`,
      def.teamRole || '(not recorded)',
      ``,
      `## Team-Specific Assignment`,
      def.teamAssignment || '(not recorded)',
      ``,
      `## Instructions`,
      def.system_instructions,
      ``,
      `## Constraints (DO NOT VIOLATE)`,
      def.constraints.map(c => `- ${c}`).join('\n'),
      ``,
      `## Success Criteria`,
      def.success_criteria,
      ``,
      `## Tool Access`,
      (def as any).allowed_categories?.length
        ? `Categories: ${(def as any).allowed_categories.join(', ')} (+ core tools always available)`
        : def.allowed_tools?.length
          ? def.allowed_tools.map((t: string) => `- ${t}`).join('\n')
          : '(core tools only)',
      ``,
      `## Forbidden Tools`,
      def.forbidden_tools?.map((t: string) => `- ${t}`).join('\n') || '(none)',
      ``,
      `## Configuration`,
      `- Max steps: ${def.max_steps}`,
      `- Timeout: ${def.timeout_ms}ms`,
      `- Model override: ${def.model || '(use default)'}`,
      ``,
      `---`,
      `**Note:** Edit this file to modify the subagent. Changes take effect on next call.`,
    ].join('\n');
  }

  /**
   * Build the task prompt that includes context data
   */
  private buildSubagentPrompt(
    def: SubagentDefinition,
    taskPrompt: string,
    contextData?: Record<string, any>,
  ): string {
    const contextSection = contextData
      ? `\n\nCONTEXT DATA:\n${JSON.stringify(contextData, null, 2)}`
      : '';

    return [
      `[SUBAGENT: ${def.name}]`,
      ``,
      `TASK: ${taskPrompt}`,
      contextSection,
      ``,
      `CONSTRAINTS:`,
      def.constraints.map(c => `• ${c}`).join('\n'),
      ``,
      `SUCCESS CRITERIA: ${def.success_criteria}`,
    ].join('\n');
  }

  /**
   * Build a default plan for subagent execution
   */
  private buildDefaultPlan(def: SubagentDefinition): any[] {
    return [
      {
        index: 0,
        description: `Execute ${def.name}${(def as any).allowed_categories?.length ? ` [categories: ${(def as any).allowed_categories.join(', ')}]` : def.allowed_tools?.length ? ` [tools: ${def.allowed_tools.join(', ')}]` : ''}`,
        status: 'pending',
      },
      {
        index: 1,
        description: `Validate results against success criteria`,
        status: 'pending',
      },
      {
        index: 2,
        description: `Return extracted data to parent task`,
        status: 'pending',
      },
    ];
  }

  /**
   * Register a subagent definition into the global config.json agents array.
   * This keeps spawn_subagent and agent_list in sync.
   */
  private registerInConfig(def: SubagentDefinition, opts: { isTeamManager?: boolean } = {}): void {
    try {
      const configManager = getConfig();
      const config = configManager.getConfig();
      const agents: any[] = Array.isArray(config.agents) ? [...config.agents] : [];

      // Skip if already registered (idempotent)
      if (agents.some((a: any) => a.id === def.id)) return;

      const entry: any = {
        id: def.id,
        name: def.name,
        description: def.description,
        workspace: path.join(this.storePath, def.id),
        model: def.model,
        maxSteps: def.max_steps,
        subagentType: 'dynamic',
        createdAt: def.created_at,
        createdBy: def.created_by,
      };

      if (opts.isTeamManager) entry.isTeamManager = true;
      if (def.roleType) entry.roleType = def.roleType;
      if (def.teamRole) entry.teamRole = def.teamRole;
      if (def.teamAssignment) entry.teamAssignment = def.teamAssignment;
      if ((def as any).allowed_categories) entry.allowed_categories = (def as any).allowed_categories;

      agents.push(entry);
      configManager.updateConfig({ agents } as any);
      console.log(`[SubagentManager] Registered "${def.id}" into config.json (isTeamManager=${!!opts.isTeamManager})`);
    } catch (err: any) {
      console.warn(`[SubagentManager] Could not register "${def.id}" in config:`, err?.message ?? err);
    }
  }

  /**
   * List all available subagents
   */
  listSubagents(): Array<{ id: string; name: string; description: string }> {
    try {
      if (!fs.existsSync(this.storePath)) return [];
      const dirs = fs.readdirSync(this.storePath);
      return dirs
        .map(dir => {
          const config = this.loadSubagent(dir);
          return config
            ? { id: config.id, name: config.name, description: config.description }
            : null;
        })
        .filter(Boolean) as any;
    } catch {
      return [];
    }
  }

  /**
   * Delete a subagent
   */
  deleteSubagent(id: string): boolean {
    try {
      const agentDir = path.join(this.storePath, id);
      if (fs.existsSync(agentDir)) {
        fs.rmSync(agentDir, { recursive: true });
        console.log(`[SubagentManager] Deleted subagent: ${id}`);
        return true;
      }
      return false;
    } catch (err) {
      console.error(`[SubagentManager] Failed to delete ${id}:`, err);
      return false;
    }
  }

  /**
   * Reload a subagent config from disk (for user edits)
   */
  reloadSubagent(id: string): SubagentDefinition | null {
    return this.loadSubagent(id);
  }

  /**
   * Emit a log event from a subagent to the UI
   * Called by background task runner or subagent itself
   */
  emitAgentLog(serverAgentId: string, logType: string, content: string): void {
    if (this.broadcastFn) {
      this.broadcastFn({
        type: 'agent_log',
        serverAgentId,
        logType,
        content,
      });
    }
  }

  /**
   * Emit a completion event for a subagent
   */
  emitAgentCompleted(serverAgentId: string): void {
    if (this.broadcastFn) {
      this.broadcastFn({
        type: 'agent_completed',
        serverAgentId,
      });
    }
  }

  /**
   * Emit a pause/error event for a subagent
   */
  emitAgentPaused(serverAgentId: string, reason: string): void {
    if (this.broadcastFn) {
      this.broadcastFn({
        type: 'agent_paused',
        serverAgentId,
        reason,
      });
    }
  }
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const subagentSpawnTool = {
  name: 'spawn_subagent',
  description:
    'Create a specialized sub-agent for a specific task (research, analysis, etc). The subagent gets a restricted tool set and explicit constraints. Perfect for delegating work while maintaining quality control.',
  schema: {
    type: 'object',
    required: ['subagent_id'],
    properties: {
      subagent_id: {
        type: 'string',
        description: 'Identifier for this subagent. Use persistent names like "news_researcher_v1" so you can call it again later.',
      },
      task_prompt: {
        type: 'string',
        description: 'The task for this subagent to complete. Required when run_now is true.',
      },
      run_now: {
        type: 'boolean',
        description: 'If false, only create/ensure the subagent definition and do not execute a task (default true).',
      },
      context_data: {
        type: 'object',
        description: 'Optional data to pass: snapshots, URLs, extracted text, etc.',
      },
      create_if_missing: {
        type: 'object',
        description: 'If subagent does not exist, create it with these parameters.',
        properties: {
          description: {
            type: 'string',
            description: 'What this subagent does',
          },
          teamRole: {
            type: 'string',
            description: 'Team-specific role title, e.g. "Website/SEO Qualifier" or "Lead Enricher".',
          },
          teamAssignment: {
            type: 'string',
            description: 'Concrete team-specific mission for this agent. This is persisted into system_prompt.md alongside the base preset role.',
          },
          allowed_tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Legacy metadata only. Prefer allowed_categories; team dispatches no longer restrict runtime access by this list.',
          },
          mcp_servers: {
            type: 'array',
            items: { type: 'string' },
            description: 'MCP server IDs this subagent can use (e.g., ["github", "brave_search"]). Tools from these servers will be injected as mcp__serverId__toolName.',
          },
          system_instructions: {
            type: 'string',
            description: 'Detailed instructions for how to behave and think',
          },
          constraints: {
            type: 'array',
            items: { type: 'string' },
            description: 'Hard rules: "extract ONLY facts", "no hallucination", "return max 5 items"',
          },
          success_criteria: {
            type: 'string',
            description: 'When to stop and return results',
          },
          max_steps: {
            type: 'number',
            description: 'Maximum tool calls before stopping (default 20)',
          },
        },
        required: ['description', 'system_instructions', 'constraints', 'success_criteria'],
      },
    },
  },
};
