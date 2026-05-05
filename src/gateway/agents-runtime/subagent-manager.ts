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
import { TaskRecord, createTask, loadTask } from '../tasks/task-store';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import { ensureAgentWorkspace, getAgentById, getConfig } from '../../config/config.js';
import { appendSubagentChatMessage } from './subagent-chat-store';
import type { AgentIdentity, AgentPersonality } from '../../types.js';
import { buildAgentIdentity, renderIdentityPrompt } from '../../agents/identity-generator.js';

export interface SubagentDefinition {
  id: string;
  name: string;
  description: string;
  
  // Execution constraints
  max_steps: number;
  timeout_ms: number;
  model?: string;  // Override from main config
  executionWorkspace?: string;
  allowedWorkPaths?: string[];
  
  // Capabilities
  // Runtime access is full standard core + category tool access.
  // The remaining lists are legacy metadata only.
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
  identity?: AgentIdentity;        // Name/personality layer used in prompts and UI
  
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
  delivery_mode?: 'notify_main' | 'task_panel_only';
  
  // Create new subagent if doesn't exist
  create_if_missing?: {
    name?: string;              // Display name (falls back to first line of description)
    description: string;
    // Legacy: individual tool names (metadata only)
    allowed_tools?: string[];
    forbidden_tools?: string[];
    executionWorkspace?: string;
    execution_workspace?: string;
    allowedWorkPaths?: string[];
    allowed_work_paths?: string[];
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
    identity?: Partial<AgentIdentity> & { personality?: Partial<AgentPersonality> };
    personality_style?: string;
    name_style?: string;
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

function normalizePathForCompare(p: string): string {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = normalizePathForCompare(basePath);
  const target = normalizePathForCompare(targetPath);
  if (!base || !target) return false;
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export class SubagentManager {
  private workspacePath: string;
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
    this.workspacePath = workspacePath;
    this.storePath = path.join(workspacePath, SUBAGENT_STORE_DIR);
    this.broadcastFn = broadcastFn;
    this.handleChatFn = handleChatFn;
    this.telegramChannelRef = telegramChannelRef ?? null;
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath, { recursive: true });
    }
  }

  private normalizeWorkPath(raw: unknown): string {
    const value = String(raw || '').trim();
    if (!value) return '';
    return path.resolve(path.isAbsolute(value) ? value : path.join(this.workspacePath, value));
  }

  private normalizeAllowedWorkPaths(rawPaths?: unknown): string[] {
    const values = Array.isArray(rawPaths) ? rawPaths : [];
    const roots = [path.resolve(this.workspacePath)];
    for (const raw of values) {
      const resolved = this.normalizeWorkPath(raw);
      if (resolved) roots.push(resolved);
    }
    const seen = new Set<string>();
    return roots.filter((resolved) => {
      const key = normalizePathForCompare(resolved);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private normalizeExecutionWorkspace(rawPath: unknown, allowedWorkPaths: string[]): string {
    const resolved = this.normalizeWorkPath(rawPath) || path.resolve(this.workspacePath);
    if (!allowedWorkPaths.some((allowed) => isPathInside(allowed, resolved))) {
      throw new Error(`executionWorkspace must be inside allowedWorkPaths. Requested: ${resolved}. Allowed: ${allowedWorkPaths.join(', ')}`);
    }
    return resolved;
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

    let agentArtifactWorkspace: string | undefined;
    try {
      const agentDef = getAgentById(subagentId);
      if (agentDef) agentArtifactWorkspace = ensureAgentWorkspace(agentDef);
    } catch { /* non-fatal */ }
    if (!agentArtifactWorkspace) {
      agentArtifactWorkspace = path.join(this.storePath, subagentId);
    }

    const allowedWorkPaths = this.normalizeAllowedWorkPaths(definition.allowedWorkPaths);
    const executionWorkspace = this.normalizeExecutionWorkspace(definition.executionWorkspace, allowedWorkPaths);

    // Build task for this subagent. Standalone subagents use a declared
    // allowlist for project edits, while their own subagent directory is the
    // artifact/memory/log home.
    const subagentPrompt = this.buildSubagentPrompt(definition, taskPrompt, request.context_data, {
      mainWorkspace: executionWorkspace,
      artifactWorkspace: agentArtifactWorkspace,
      allowedWorkPaths,
    });
    const agentWorkspace = executionWorkspace;
    const parentTask = loadTask(parentTaskId);
    const parentTaskLink = parentTask ? parentTaskId : undefined;
    const originatingSessionId = parentTask ? undefined : parentTaskId;

    const subagentSessionId = `subagent_${subagentId}_${Date.now()}`;
    const subagentTask = createTask({
      title: `[Subagent] ${definition.name}`,
      prompt: subagentPrompt,
      sessionId: subagentSessionId,
      channel: 'web',
      subagentProfile: definition.id,  // Mark as a standalone subagent runtime.
      parentTaskId: parentTaskLink,
      originatingSessionId,
      suppressOriginDelivery: request.delivery_mode === 'task_panel_only',
      agentWorkspace,
      agentAllowedWorkPaths: allowedWorkPaths,
      plan: this.buildDefaultPlan(definition),
    });

    const shouldMirrorPromptToChat = String((request.context_data as any)?.trigger || '').toLowerCase() !== 'cron';
    if (shouldMirrorPromptToChat) {
      const chatMessage = appendSubagentChatMessage(subagentId, {
        role: 'user',
        content: taskPrompt,
        metadata: {
          source: 'main_agent_dispatch',
          taskId: subagentTask.id,
          parentTaskId: parentTaskLink,
          originatingSessionId,
        },
      });
      try {
        this.broadcastFn?.({
          type: 'subagent_chat_message',
          agentId: subagentId,
          message: chatMessage,
        });
      } catch {}
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
    const allowedWorkPaths = this.normalizeAllowedWorkPaths(params.allowedWorkPaths ?? params.allowed_work_paths);
    const executionWorkspace = this.normalizeExecutionWorkspace(params.executionWorkspace ?? params.execution_workspace, allowedWorkPaths);

    const identity = buildAgentIdentity({
      id,
      explicitName: params.name,
      description: params.description,
      roleType: params.roleType,
      teamRole: params.teamRole,
      teamAssignment: params.teamAssignment,
      identity: params.identity,
      personalityStyle: params.personality_style,
      nameStyle: params.name_style,
    });

    const definition: SubagentDefinition = {
      id,
      name: identity.displayName,
      description: params.description,
      max_steps: params.max_steps ?? 20,
      timeout_ms: params.timeout_ms ?? 300_000,
      model: params.model,
      executionWorkspace,
      allowedWorkPaths,
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
      identity,
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

    // Keep a legacy HEARTBEAT.md instructions file for schedule-job previews and imports.
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

    const memoryPath = path.join(agentDir, 'MEMORY.md');
    if (!fs.existsSync(memoryPath)) {
      fs.writeFileSync(memoryPath, [
        `# MEMORY.md - ${definition.name}`,
        '',
        'Persistent notes for this standalone subagent.',
        '',
        'Use this for durable observations, decisions, open threads, and follow-up context that belongs to this subagent.',
      ].join('\n'), 'utf-8');
    }

    // Register into config.json agents array so agent_list() can see it
    this.registerInConfig(definition, { isTeamManager: params.is_team_manager === true });

    console.log(`[SubagentManager] Created new subagent: ${id}`);
    return definition;
  }

  /**
   * Build system prompt file that user can edit
   */
  private buildSystemPromptFile(def: SubagentDefinition): string {
    const hasTeamAssignment = !!(def.teamRole || def.teamAssignment);
    const identityBlock = hasTeamAssignment
      ? [
          `## Team-Specific Role`,
          def.teamRole || '(not recorded)',
          ``,
          `## Team-Specific Assignment`,
          def.teamAssignment || '(not recorded)',
        ]
      : [
          `## Standalone Subagent Identity`,
          `You are a standalone one-off subagent, not a member of a managed team.`,
          `You are main-chat-like in capability: use the normal runtime, tools, memory context, and workspace access.`,
          `Your difference from main chat is assignment and ownership: you answer as this named subagent, keep your own durable notes in this subagent workspace, and keep generated support artifacts separated there when practical.`,
        ];

    return [
      `# ${def.name}`,
      ``,
      def.description,
      ``,
      renderIdentityPrompt(def.identity),
      ``,
      `## Base Preset Role`,
      def.roleType ? `Role: ${def.roleType}` : '(not recorded)',
      def.baseRolePrompt ? `\nPreset prompt:\n${def.baseRolePrompt}` : '',
      ``,
      ...identityBlock,
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
	      `Full standard core + category tool access. Commit-tier actions still require approval.`,
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
    workspaceInfo?: { mainWorkspace: string; artifactWorkspace: string; allowedWorkPaths?: string[] },
  ): string {
    const contextSection = contextData
      ? `\n\nCONTEXT DATA:\n${JSON.stringify(contextData, null, 2)}`
      : '';

    return [
      `[SUBAGENT: ${def.name}]`,
      ``,
      `IDENTITY: You are a standalone subagent unless this prompt explicitly says you are serving inside a managed team. You keep your own artifacts and MEMORY.md in your subagent workspace, but you may read/edit project files in the main workspace when the task requires it.`,
      def.identity ? `\n${renderIdentityPrompt(def.identity)}` : '',
      ``,
      `SYSTEM INSTRUCTIONS:`,
      def.system_instructions,
      ``,
      workspaceInfo
        ? [
            `WORKSPACE RULES:`,
            `- Default execution workspace: ${workspaceInfo.mainWorkspace}`,
            `- Allowed work paths:`,
            ...(workspaceInfo.allowedWorkPaths || [workspaceInfo.mainWorkspace]).map((p) => `  - ${p}`),
            `- Subagent artifact workspace for your own outputs, notes, logs, scratch files, and MEMORY.md updates: ${workspaceInfo.artifactWorkspace}`,
            `- File tools and run_command must stay inside the allowed work paths.`,
            ``,
          ].join('\n')
        : '',
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
	        description: `Execute ${def.name}`,
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
        executionWorkspace: def.executionWorkspace || this.workspacePath,
        allowedWorkPaths: this.normalizeAllowedWorkPaths(def.allowedWorkPaths),
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
      if (def.identity) entry.identity = def.identity;
	      agents.push(entry);
      configManager.updateConfig({ agents } as any);
      console.log(`[SubagentManager] Registered "${def.id}" into config.json (isTeamManager=${!!opts.isTeamManager})`);
    } catch (err: any) {
      console.warn(`[SubagentManager] Could not register "${def.id}" in config:`, err?.message ?? err);
    }
  }

  /**
   * Directly update a dynamic subagent profile and keep its persisted files plus
   * global config entry in sync. This is the API counterpart to spawn_subagent.
   */
  updateSubagent(id: string, patch: Record<string, any>): SubagentDefinition {
    const safeId = String(id || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(safeId)) {
      throw new Error('agent_id must contain only letters, numbers, underscores, or hyphens');
    }

    const existing = this.loadSubagent(safeId);
    if (!existing) {
      throw new Error(`Dynamic subagent "${safeId}" not found. Call agent_list first to confirm the ID.`);
    }

    const next: SubagentDefinition = { ...existing };
    const stringFields: Array<keyof SubagentDefinition> = [
      'description',
      'system_instructions',
      'success_criteria',
      'teamRole',
      'teamAssignment',
      'model',
      'executionWorkspace',
    ];

    if (patch.name !== undefined) {
      const newName = String(patch.name || '').trim();
      if (!newName) throw new Error('name cannot be empty');
      next.name = newName.slice(0, 80);
    }

    for (const field of stringFields) {
      if (patch[field] !== undefined) {
        const value = String(patch[field] ?? '').trim();
        if (field === 'model' && !value) {
          delete (next as any).model;
        } else {
          (next as any)[field] = value;
        }
      }
    }

	    const arrayFields = ['allowed_tools', 'forbidden_tools', 'constraints'] as const;
    for (const field of arrayFields) {
      if (patch[field] !== undefined) {
        if (!Array.isArray(patch[field])) throw new Error(`${field} must be an array`);
        (next as any)[field] = patch[field].map((v: any) => String(v).trim()).filter(Boolean);
      }
    }

    if (patch.max_steps !== undefined) {
      const value = Math.max(1, Math.min(200, Math.floor(Number(patch.max_steps) || 0)));
      if (!value) throw new Error('max_steps must be a positive number');
      next.max_steps = value;
    }

    if (patch.timeout_ms !== undefined) {
      const value = Math.max(1_000, Math.min(86_400_000, Math.floor(Number(patch.timeout_ms) || 0)));
      if (!value) throw new Error('timeout_ms must be a positive number');
      next.timeout_ms = value;
    }

    const identityPatch = patch.identity && typeof patch.identity === 'object' ? patch.identity : undefined;
    const shouldRefreshIdentity = !!identityPatch
      || patch.personality_style !== undefined
      || patch.name_style !== undefined
      || patch.name !== undefined
      || patch.description !== undefined
      || patch.teamRole !== undefined
      || patch.teamAssignment !== undefined;
    if (shouldRefreshIdentity) {
      const mergedIdentity: any = identityPatch ? { ...(next.identity || {}), ...identityPatch } : { ...(next.identity || {}) };
      if (patch.name !== undefined && !identityPatch?.displayName) {
        mergedIdentity.displayName = next.name;
        mergedIdentity.shortName = next.name;
      }
      next.identity = buildAgentIdentity({
        id: next.id,
        explicitName: next.name,
        description: next.description,
        roleType: next.roleType,
        teamRole: next.teamRole,
        teamAssignment: next.teamAssignment,
        identity: mergedIdentity,
        personalityStyle: patch.personality_style,
        nameStyle: patch.name_style,
      });
      next.name = next.identity.displayName;
    }

    if (patch.allowedWorkPaths !== undefined || patch.allowed_work_paths !== undefined) {
      next.allowedWorkPaths = this.normalizeAllowedWorkPaths(patch.allowedWorkPaths ?? patch.allowed_work_paths);
    } else {
      next.allowedWorkPaths = this.normalizeAllowedWorkPaths(next.allowedWorkPaths);
    }
    if (patch.executionWorkspace !== undefined || patch.execution_workspace !== undefined || !next.executionWorkspace) {
      next.executionWorkspace = this.normalizeExecutionWorkspace(patch.executionWorkspace ?? patch.execution_workspace ?? next.executionWorkspace, next.allowedWorkPaths);
    } else {
      next.executionWorkspace = this.normalizeExecutionWorkspace(next.executionWorkspace, next.allowedWorkPaths);
    }

    next.modified_at = Date.now();

    const agentDir = path.join(this.storePath, safeId);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'config.json'), JSON.stringify(next, null, 2), 'utf-8');
    fs.writeFileSync(path.join(agentDir, 'system_prompt.md'), this.buildSystemPromptFile(next), 'utf-8');

    if (patch.heartbeat_instructions !== undefined) {
      const heartbeat = String(patch.heartbeat_instructions || '').trim();
      fs.writeFileSync(path.join(agentDir, 'HEARTBEAT.md'), heartbeat || `# HEARTBEAT.md - ${next.name}\n`, 'utf-8');
    }

    const configManager = getConfig();
    const config = configManager.getConfig();
    const agents: any[] = Array.isArray(config.agents) ? [...config.agents] : [];
    const idx = agents.findIndex((a: any) => a.id === safeId);
    const entryPatch: any = {
      name: next.name,
      description: next.description,
      model: next.model,
      maxSteps: next.max_steps,
      subagentType: 'dynamic',
      executionWorkspace: next.executionWorkspace,
      allowedWorkPaths: next.allowedWorkPaths,
      modifiedAt: next.modified_at,
	      teamRole: next.teamRole,
      teamAssignment: next.teamAssignment,
      identity: next.identity,
    };
    if (idx >= 0) {
      agents[idx] = { ...agents[idx], ...entryPatch };
    } else {
      agents.push({
        id: next.id,
        workspace: path.join(this.storePath, next.id),
        executionWorkspace: next.executionWorkspace,
        allowedWorkPaths: next.allowedWorkPaths,
        createdAt: next.created_at,
        createdBy: next.created_by,
        ...entryPatch,
      });
    }
    configManager.updateConfig({ agents } as any);

    console.log(`[SubagentManager] Updated subagent: ${safeId}`);
    return next;
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
    'Create a specialized sub-agent for a specific task (research, analysis, etc). The subagent runs as a full agent with explicit role guidance and constraints. Perfect for delegating work while maintaining quality control.',
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
      personality_style: {
        type: 'string',
        description: 'Optional personality preset for newly created agents: steady, spark, austere, mentor, operator, critic, creative.',
      },
      name_style: {
        type: 'string',
        description: 'Optional naming hint for newly created agents. Keep names grounded and non-gimmicky.',
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
          name: {
            type: 'string',
            description: 'Optional display name. If omitted, Prometheus generates a tasteful human name.',
          },
          identity: {
            type: 'object',
            description: 'Optional explicit name/personality identity block.',
          },
          personality_style: {
            type: 'string',
            description: 'Optional personality preset: steady, spark, austere, mentor, operator, critic, creative.',
          },
          name_style: {
            type: 'string',
            description: 'Optional naming hint. Keep names grounded and non-gimmicky.',
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
            description: 'Legacy metadata only. Subagents receive the full standard tool surface at runtime.',
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
