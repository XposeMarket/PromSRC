import fs from 'fs';
import path from 'path';
import { ensureAgentWorkspace, getAgentById, getConfig } from '../../config/config';

export interface EnsureScheduleOwnerAgentOptions {
  scheduleId: string;
  scheduleName: string;
  prompt: string;
  model?: string;
}

export interface ScheduleOwnerAgentResult {
  agentId: string;
  created: boolean;
}

function sanitizeAgentId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 5) || '0';
}

function writeFileIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

function ensureSubagentRuntimeFiles(agent: any, prompt: string): void {
  const workspace = getConfig().getWorkspacePath();
  const subagentRoot = path.join(workspace, '.prometheus', 'subagents', agent.id);
  fs.mkdirSync(subagentRoot, { recursive: true });

  const now = Date.now();
  const runtimeConfig = {
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    max_steps: Number(agent.maxSteps || 20),
    timeout_ms: 300000,
    model: agent.model || undefined,
    allowed_tools: [],
    forbidden_tools: [],
    mcp_servers: [],
    system_instructions: [
      `You own the scheduled job "${agent.scheduleName || agent.name}".`,
      'Keep durable context about prior runs, failures, fixes, source files, and user preferences.',
      'When scheduled, execute the job prompt carefully and write useful outputs to the workspace.',
      'When Raul chats with you from the Subagents page, explain past runs and help repair or improve the schedule.',
    ].join('\n'),
    constraints: [
      'Do not invent results for missing source files or failed tools.',
      'Summarize blockers clearly so the next run and chat follow-up have continuity.',
      'Treat external side effects as requiring explicit user permission unless the schedule prompt allows them.',
    ],
    success_criteria: 'The scheduled job is completed, verified where possible, and the run outcome is understandable from this agent history.',
    roleType: 'operator',
    created_at: agent.createdAt || now,
    modified_at: now,
    created_by: 'ai',
    version: '1.0',
  };

  writeFileIfMissing(
    path.join(subagentRoot, 'config.json'),
    JSON.stringify(runtimeConfig, null, 2),
  );

  writeFileIfMissing(
    path.join(subagentRoot, 'system_prompt.md'),
    [
      `# ${agent.name}`,
      '',
      runtimeConfig.system_instructions,
      '',
      '## Schedule Ownership',
      `Schedule ID: ${agent.scheduleId || 'unknown'}`,
      `Schedule name: ${agent.scheduleName || agent.name}`,
      '',
      '## Operating Rules',
      ...runtimeConfig.constraints.map((line) => `- ${line}`),
      '',
      '## Success Criteria',
      runtimeConfig.success_criteria,
    ].join('\n'),
  );

  writeFileIfMissing(
    path.join(subagentRoot, 'HEARTBEAT.md'),
    [
      `# HEARTBEAT.md - ${agent.name}`,
      '',
      '## Owned Scheduled Job',
      `Schedule ID: ${agent.scheduleId || 'unknown'}`,
      `Schedule name: ${agent.scheduleName || agent.name}`,
      '',
      '## Current Job Prompt',
      prompt || '(empty)',
      '',
      '## Run Follow-up',
      '- Review recent failed or blocked runs before repeating the same approach.',
      '- Keep notes about durable fixes, source paths, and user feedback.',
      '- If nothing is actionable outside the scheduled run, reply with HEARTBEAT_OK.',
    ].join('\n'),
  );

  const memoryDir = path.join(subagentRoot, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  writeFileIfMissing(
    path.join(memoryDir, 'schedule-memory.md'),
    [
      `# Schedule Memory - ${agent.name}`,
      '',
      'Durable notes for this scheduled-job owner.',
      '',
      'Use this for recurring blockers, source paths, fixes, user feedback, and decisions that should survive across runs.',
    ].join('\n'),
  );
}

export function ensureScheduleOwnerAgent(options: EnsureScheduleOwnerAgentOptions): ScheduleOwnerAgentResult {
  const scheduleId = sanitizeAgentId(options.scheduleId);
  const baseName = String(options.scheduleName || 'Scheduled Job').trim() || 'Scheduled Job';
  const baseSlug = sanitizeAgentId(baseName).slice(0, 42) || 'scheduled-job';
  const agentId = `schedule_${baseSlug}_${shortHash(scheduleId || baseName)}`;
  const existing = getAgentById(agentId);
  if (existing) {
    ensureSubagentRuntimeFiles(existing as any, options.prompt);
    ensureAgentWorkspace(existing as any);
    return { agentId, created: false };
  }

  const cm = getConfig();
  const current = cm.getConfig() as any;
  const explicitAgents = Array.isArray(current.agents) ? current.agents : [];
  const workspace = path.join(cm.getWorkspacePath(), '.prometheus', 'subagents', agentId);
  const now = Date.now();
  const agent: any = {
    id: agentId,
    name: `${baseName} Owner`.slice(0, 80),
    description: `Dedicated owner for scheduled job "${baseName}". Tracks run history, failures, logs, context, and chat follow-up from the Subagents page.`,
    roleType: 'operator',
    workspace,
    maxSteps: 20,
    subagentType: 'schedule_owner',
    scheduleId: options.scheduleId,
    scheduleName: baseName,
    createdAt: now,
    createdBy: 'ai',
    ...(options.model ? { model: options.model } : {}),
  };

  cm.updateConfig({ agents: [...explicitAgents, agent] } as any);
  ensureAgentWorkspace(agent);
  ensureSubagentRuntimeFiles(agent, options.prompt);
  return { agentId, created: true };
}

export function ensureScheduleRuntimeForAgent(agentId: string, options: EnsureScheduleOwnerAgentOptions): void {
  const agent = getAgentById(agentId);
  if (!agent) return;
  ensureAgentWorkspace(agent as any);
  ensureSubagentRuntimeFiles({
    ...(agent as any),
    scheduleId: options.scheduleId,
    scheduleName: options.scheduleName,
  }, options.prompt);
}
