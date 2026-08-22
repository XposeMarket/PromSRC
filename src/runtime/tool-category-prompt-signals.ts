import {
  evaluatePromptSignals,
  isMeaningQuestion,
  type PromptSignalConfig,
} from './prompt-signal-matcher';

export type PromptSignalToolCategory =
  | 'automation_scheduling'
  | 'automation_tasks'
  | 'automation_recovery'
  | 'automation_sessions'
  | 'runtime_admin'
  | 'integration_admin'
  | 'mcp_server_tools'
  | 'agents_and_teams'
  | 'proposal_admin'
  | 'composite_tools'
  | 'model_management';

/**
 * Declarative natural-language activation for native, on-demand tool packs.
 *
 * Keep these signals domain-specific. `phrases` are strong matches (4 points),
 * each `allOf` group is an alternative conjunction (2 points per term), and
 * `anyOf` terms are weak evidence (1 point each). `noneOf` is a hard exclusion.
 * A score of 4 is intentionally the normal threshold so a generic single noun
 * does not expose a large tool surface.
 */
export const TOOL_CATEGORY_PROMPT_SIGNALS: Readonly<Record<PromptSignalToolCategory, PromptSignalConfig>> = Object.freeze({
  automation_scheduling: {
    phrases: [
      'schedule a job', 'schedule job', 'scheduled job', 'recurring job', 'cron job',
      'set a reminder', 'remind me', 'remind us', 'schedule this', 'every weekday', 'run every day', 'run every weekday',
      'run every week', 'run daily', 'run weekly', 'run monthly',
      'schedule job detail', 'schedule job history', 'schedule job logs',
      'schedule job outputs', 'schedule job patch', 'schedule job stuck control',
      'schedule_job', 'schedule_job_detail', 'schedule_job_history',
      'schedule_job_log_search', 'schedule_job_outputs', 'schedule_job_patch',
      'schedule_job_stuck_control',
    ],
    allOf: [
      ['schedule', 'create'], ['schedule', 'update'], ['schedule', 'pause'],
      ['schedule', 'resume'], ['schedule', 'delete'], ['schedule', 'inspect'],
      ['schedule', 'list'], ['schedule', 'weekday'], ['schedule', 'reminder'], ['recurring', 'schedule'],
      ['cron', 'schedule'], ['reminder', 'set'],
    ],
    anyOf: ['schedule', 'scheduled', 'recurring', 'cron', 'reminder'],
    noneOf: ['what is a schedule', 'schedule in general'],
    minScore: 4,
  },

  automation_tasks: {
    phrases: [
      'background task', 'background run', 'running tasks', 'tasks are currently running',
      'queued tasks', 'task status', 'task output', 'task outputs', 'run this task now',
      'automation dashboard', 'task_control', 'run_task_now', 'internal_watch',
    ],
    allOf: [
      ['task', 'run'], ['task', 'watch'], ['task', 'monitor'], ['task', 'status'],
      ['task', 'output'], ['task', 'cancel'], ['task', 'retry'], ['task', 'inspect'],
      ['task', 'list'], ['tasks', 'running'], ['tasks', 'outputs'],
      ['execution', 'status'], ['execution', 'output'],
    ],
    anyOf: ['task', 'tasks', 'execution', 'executions', 'queue', 'queued'],
    noneOf: ['what is a task', 'task in general'],
    minScore: 4,
  },

  automation_recovery: {
    phrases: [
      'request got cut off', 'request was cut off', 'recover the existing run',
      'recover the interrupted request', 'resume the original request',
      'failed request', 'pending approval', 'crash recovery', 'recover failed work',
      'prometheus_request_ops', 'prometheus_audit_ops',
    ],
    allOf: [
      ['recover', 'request'], ['recover', 'run'], ['recover', 'approval'],
      ['resume', 'request'], ['resume', 'run'], ['retry', 'request'], ['retry', 'run'],
      ['interrupted', 'request'], ['failed', 'request'],
      ['cut off', 'request'], ['retry', 'original'],
    ],
    anyOf: ['recover', 'recovery', 'interrupted', 'stalled', 'cut off', 'failed'],
    noneOf: [
      'data recovery', 'file recovery', 'account recovery', 'disaster recovery',
      'explain crash recovery', 'explain what crash recovery', 'what is crash recovery',
    ],
    minScore: 4,
  },

  automation_sessions: {
    phrases: [
      'other chat', 'another chat', 'previous chat', 'previous conversation',
      'find our discussion', 'where did we leave off', 'send this to the other chat',
      'continue the previous conversation', 'thread history', 'prometheus thread',
      'prometheus session', 'thread ops', 'prometheus_thread_ops',
    ],
    allOf: [
      ['chat', 'send'], ['chat', 'steer'], ['chat', 'continue'], ['chat', 'find'],
      ['conversation', 'find'], ['conversation', 'continue'], ['conversation', 'history'],
      ['thread', 'create'], ['thread', 'list'], ['thread', 'inspect'], ['thread', 'steer'],
      ['thread', 'history'], ['session', 'create'], ['session', 'list'], ['session', 'steer'],
    ],
    anyOf: ['chat', 'conversation', 'thread', 'session'],
    noneOf: ['browser session', 'desktop session', 'terminal session'],
    minScore: 4,
  },

  runtime_admin: {
    phrases: [
      'diagnostic packet', 'system diagnostics', 'runtime diagnostics',
      'gateway restart', 'restart prometheus', 'restart the gateway',
      'runtime admin', 'diagnostic_packet', 'system_diagnostics', 'gateway_restart',
    ],
    allOf: [
      ['gateway', 'restart'], ['prometheus', 'restart'], ['gateway', 'diagnostics'],
      ['runtime', 'diagnostics'], ['system', 'diagnostics'],
    ],
    anyOf: ['gateway', 'runtime', 'diagnostics', 'restart', 'incident'],
    noneOf: ['restart the dev server', 'restart dev server', 'restart my server', 'what is a gateway'],
    minScore: 4,
  },

  integration_admin: {
    phrases: [
      'integration setup', 'integration admin', 'connect a service', 'connect an app',
      'connect a connector', 'configure a connector', 'install a connector',
      'install a plugin', 'configure a webhook', 'webhook setup', 'oauth setup',
      'connection_ops', 'mcp_server_manage', 'webhook_manage', 'integration_quick_setup',
    ],
    allOf: [
      ['connect', 'oauth'], ['configure', 'oauth'], ['authorize', 'oauth'],
      ['connect', 'connector'], ['configure', 'connector'], ['authorize', 'connector'],
      ['oauth', 'connector'], ['setup', 'connector'], ['install', 'connector'],
      ['connect', 'plugin'], ['configure', 'plugin'], ['install', 'plugin'],
      ['configure', 'webhook'], ['setup', 'webhook'], ['manage', 'webhook'],
      ['connect', 'mcp'], ['configure', 'mcp'], ['setup', 'mcp'],
    ],
    anyOf: ['integration', 'connector', 'plugin', 'oauth', 'webhook', 'mcp'],
    minScore: 4,
  },

  mcp_server_tools: {
    phrases: [
      'mcp tool', 'connected mcp tool', 'call an mcp', 'call the mcp',
      'list mcp tools', 'mcp server tool', 'mcp_server_tools',
    ],
    allOf: [
      ['mcp', 'call'], ['mcp', 'use'], ['mcp', 'invoke'], ['mcp', 'tool'],
    ],
    anyOf: ['mcp', 'tool', 'server'],
    noneOf: ['configure', 'setup', 'authorize', 'install'],
    minScore: 4,
  },

  agents_and_teams: {
    phrases: [
      'ask an agent', 'ask the agent', 'spawn a subagent', 'message the subagent',
      'delegate to an agent', 'dispatch to an agent', 'managed team', 'team coordinator',
      'talk to the agent', 'talk to the team', 'agent_ops', 'agent_chat_ops',
      'agent_run_ops', 'team_ops_wrapper', 'team_collab_ops',
    ],
    allOf: [
      ['agent', 'ask'], ['agent', 'message'], ['agent', 'spawn'], ['agent', 'delegate'],
      ['agent', 'dispatch'], ['agent', 'steer'], ['agent', 'manage'], ['agent', 'list'],
      ['subagent', 'message'], ['subagent', 'chat'], ['subagent', 'steer'],
      ['team', 'create'], ['team', 'manage'], ['team', 'dispatch'], ['team', 'coordinate'],
      ['teammate', 'message'],
    ],
    anyOf: ['agent', 'subagent', 'team', 'teammate', 'worker'],
    noneOf: ['what is an agent', 'what is a team'],
    minScore: 4,
  },

  proposal_admin: {
    phrases: [
      'pending proposal', 'write a proposal', 'create a proposal', 'edit the proposal',
      'update the proposal', 'revise the proposal', 'approve the proposal',
      'edit_proposal', 'write_proposal',
    ],
    allOf: [
      ['proposal', 'write'], ['proposal', 'create'], ['proposal', 'edit'],
      ['proposal', 'update'], ['proposal', 'revise'], ['proposal', 'approve'],
      ['proposal', 'submit'], ['proposal', 'file'], ['proposal', 'pending'],
    ],
    anyOf: ['proposal', 'pending'],
    noneOf: ['sales proposal', 'marketing proposal', 'business proposal'],
    minScore: 4,
  },

  composite_tools: {
    phrases: [
      'composite tool', 'saved tool', 'multi step tool', 'multi-step tool',
      'saved workflow', 'composite workflow', 'create composite', 'edit composite',
      'delete composite', 'list composites', 'inspect composite', 'run composite',
      'create_composite', 'get_composite', 'edit_composite', 'delete_composite', 'list_composites',
    ],
    allOf: [
      ['composite', 'create'], ['composite', 'edit'], ['composite', 'delete'],
      ['composite', 'list'], ['composite', 'inspect'], ['composite', 'run'],
      ['workflow', 'save'], ['workflow', 'reuse'],
    ],
    anyOf: ['composite', 'workflow', 'saved'],
    minScore: 4,
  },

  model_management: {
    phrases: [
      'agent model', 'agent models', 'model template', 'model templates',
      'agent routing', 'executor route', 'set agent model', 'save model template',
      'get_agent_models', 'set_agent_model', 'list_agent_model_templates',
      'save_agent_model_template', 'update_agent_model_template',
      'apply_agent_model_template', 'select_agent_model_template', 'delete_agent_model_template',
    ],
    allOf: [
      ['agent', 'model'], ['model', 'template'], ['agent', 'routing'],
      ['executor', 'route'],
    ],
    anyOf: ['agent', 'model', 'template', 'routing'],
    noneOf: ['what is a model', 'model in general'],
    minScore: 4,
  },
});

/**
 * Detect the native categories that have migrated to declarative prompt signals.
 * Meaning/definition questions are suppressed centrally so each category does
 * not need to reproduce the old router's ad-hoc question guards.
 */
export function detectPromptSignalToolCategories(input: string): Set<PromptSignalToolCategory> {
  const categories = new Set<PromptSignalToolCategory>();
  const text = String(input || '').trim();
  if (!text || isMeaningQuestion(text)) return categories;

  for (const [category, signals] of Object.entries(TOOL_CATEGORY_PROMPT_SIGNALS) as Array<[PromptSignalToolCategory, PromptSignalConfig]>) {
    if (evaluatePromptSignals(signals, text).matched) categories.add(category);
  }

  // Clock-only scheduling language is grammatical rather than lexical (for
  // example, "start the report at 5:30 PM"). Keep this narrow structural rule
  // beside the declarative matcher instead of weakening `anyOf` with "at".
  if (/\b(?:start|run|send|execute|launch|begin|fire|remind)\b[^.!?]{0,80}\bat\s+(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}\s*o['’]?clock|noon|midnight)\b/i.test(text)) {
    categories.add('automation_scheduling');
  }

  // Dynamic MCP function names are self-identifying and should not require a
  // hand-maintained phrase for each connected server/tool pair.
  if (/\bmcp__[\w-]+__[\w-]+\b/i.test(text) && !/\b(?:configure|setup|authorize|install)\b/i.test(text)) {
    categories.add('mcp_server_tools');
  }

  return categories;
}
