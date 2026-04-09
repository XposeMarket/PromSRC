/**
 * agent-control.ts — Prometheus Agent Inspection & Control Tools
 *
 * Gives the AI the ability to:
 *   - List all defined agents (agent_list)
 *   - Get details about a specific agent (agent_info)
 *
 * The spawn_agent tool (in registry.ts) handles *running* agents.
 * These tools handle *knowing what agents exist*.
 */

import { ToolResult } from '../types.js';
import { getConfig } from '../config/config.js';

// ── agent_list ────────────────────────────────────────────────────────────────

export async function executeAgentList(_args: any): Promise<ToolResult> {
  let config: any;
  try {
    config = getConfig();
  } catch (err: any) {
    return { success: false, error: `Could not load config: ${err?.message ?? err}` };
  }

  const agents: any[] = config?.agents ?? [];

  if (agents.length === 0) {
    return {
      success: true,
      stdout: 'No agents are defined in config. You are running in single-agent mode.\n\nTo add agents, edit .prometheus/config.json and add an "agents" array with AgentDefinition objects.',
      data: { agents: [], mode: 'single-agent' },
    };
  }

  const lines: string[] = [`${agents.length} agent(s) configured:\n`];
  for (const agent of agents) {
    const tags: string[] = [];
    if (agent.default) tags.push('DEFAULT');
    if (agent.cronSchedule) tags.push(`CRON: ${agent.cronSchedule}`);
    if (agent.canSpawn) tags.push('CAN-SPAWN');
    if (agent.minimalPrompt === false) tags.push('FULL-PROMPT');

    const tagStr = tags.length ? `  [${tags.join(' | ')}]` : '';
    lines.push(`• ${agent.emoji ?? '🤖'} ${agent.name} (id: ${agent.id})${tagStr}`);
    if (agent.description) lines.push(`  ${agent.description}`);
    if (agent.model) lines.push(`  Model: ${agent.model}`);
    if (agent.workspace) lines.push(`  Workspace: ${agent.workspace}`);
    if (agent.bindings?.length) {
      const bindingStr = agent.bindings
        .map((b: any) => `${b.channel}${b.peerId ? `:${b.peerId}` : ''}`)
        .join(', ');
      lines.push(`  Bindings: ${bindingStr}`);
    }
    if (agent.spawnAllowlist?.length) {
      lines.push(`  Can spawn: ${agent.spawnAllowlist.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('Use spawn_agent(agentId, task) to run any agent.');

  return {
    success: true,
    stdout: lines.join('\n'),
    data: { agents, mode: 'multi-agent' },
  };
}

export const agentListTool = {
  name: 'agent_list',
  description:
    'List all configured agents. Use this to see what sub-agents are available, ' +
    'their IDs, descriptions, schedules, and capabilities. ' +
    'Call this when the user asks about agents, sub-agents, or available workers.',
  execute: executeAgentList,
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

// ── agent_info ────────────────────────────────────────────────────────────────

export async function executeAgentInfo(args: any): Promise<ToolResult> {
  const agentId = String(args?.agentId ?? args?.id ?? '').trim();
  if (!agentId) {
    return { success: false, error: 'agentId is required. Use agent_list to see available agent IDs.' };
  }

  let config: any;
  try {
    config = getConfig();
  } catch (err: any) {
    return { success: false, error: `Could not load config: ${err?.message ?? err}` };
  }

  const agents: any[] = config?.agents ?? [];
  const agent = agents.find((a: any) => a.id === agentId);

  if (!agent) {
    const ids = agents.map((a: any) => a.id).join(', ');
    return {
      success: false,
      error: `Agent "${agentId}" not found. Available agent IDs: ${ids || 'none (single-agent mode)'}`,
    };
  }

  const lines: string[] = [
    `${agent.emoji ?? '🤖'} Agent: ${agent.name}`,
    `ID: ${agent.id}`,
  ];
  if (agent.description)   lines.push(`Description: ${agent.description}`);
  if (agent.model)         lines.push(`Model: ${agent.model}`);
  if (agent.workspace)     lines.push(`Workspace: ${agent.workspace}`);
  if (agent.maxSteps)      lines.push(`Max Steps: ${agent.maxSteps}`);
  if (agent.cronSchedule)  lines.push(`Cron: ${agent.cronSchedule}`);
  if (agent.canSpawn)      lines.push(`Can Spawn: yes`);
  if (agent.minimalPrompt !== undefined) lines.push(`Minimal Prompt: ${agent.minimalPrompt}`);
  if (agent.bindings?.length) {
    lines.push(`Bindings:`);
    for (const b of agent.bindings) {
      lines.push(`  - channel: ${b.channel}${b.accountId ? `, account: ${b.accountId}` : ''}${b.peerId ? `, peer: ${b.peerId}` : ''}`);
    }
  }
  if (agent.tools) {
    lines.push(`Tool Policy:`);
    if (agent.tools.profile) lines.push(`  Profile: ${agent.tools.profile}`);
    if (agent.tools.allow?.length) lines.push(`  Allow: ${agent.tools.allow.join(', ')}`);
    if (agent.tools.deny?.length)  lines.push(`  Deny: ${agent.tools.deny.join(', ')}`);
  }
  if (agent.spawnAllowlist?.length) {
    lines.push(`Spawn Allowlist: ${agent.spawnAllowlist.join(', ')}`);
  }

  return {
    success: true,
    stdout: lines.join('\n'),
    data: { agent },
  };
}

export const agentInfoTool = {
  name: 'agent_info',
  description:
    'Get detailed information about a specific agent by its ID. ' +
    'Returns config, model, workspace, bindings, tool policy, and cron schedule.',
  execute: executeAgentInfo,
  schema: {
    agentId: 'ID of the agent to inspect (from agent_list)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'ID of the agent to inspect (from agent_list)' },
    },
    required: ['agentId'],
    additionalProperties: false,
  },
};
