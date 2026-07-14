import type { RuntimePromptRole } from './prompt-manifest';
import type { Stage4InstructionIntents } from './instruction-intent-detector';

export const INSTRUCTION_SEGMENT_REGISTRY_VERSION = 1;
export const STAGE3_PILOT_CATEGORY_IDS = [
  'integration_admin',
  'social_intelligence',
  'proposal_admin',
  'model_management',
  'business',
] as const;
export type InstructionResolverMode = 'legacy' | 'shadow' | 'pilot';

export function getInstructionResolverMode(): InstructionResolverMode {
  const requested = String(process.env.PROMETHEUS_INSTRUCTION_RESOLVER_MODE || 'pilot').trim().toLowerCase();
  if (requested === 'legacy' || requested === 'shadow' || requested === 'pilot') return requested;
  return 'pilot';
}
const STAGE3_PILOT_CATEGORY_SET = new Set<string>(STAGE3_PILOT_CATEGORY_IDS);

export function resolveStage3PilotPolicyDecision(categoryInput: string, activeCategoriesInput: Iterable<string>): {
  pilotCategory: boolean;
  included: boolean;
  reason: string;
} {
  const category = String(categoryInput || '').trim();
  const active = new Set(Array.from(activeCategoriesInput, (value) => String(value || '').trim()).filter(Boolean));
  const pilotCategory = STAGE3_PILOT_CATEGORY_SET.has(category);
  return {
    pilotCategory,
    included: pilotCategory && active.has(category),
    reason: pilotCategory
      ? (active.has(category) ? `active_category=${category}` : `inactive_category=${category}`)
      : `not_stage3_pilot_category=${category}`,
  };
}

export type InstructionSegmentKind = 'instruction' | 'context' | 'schema' | 'wrapper' | 'provider';
export type InstructionSegmentOwner = 'core_runtime' | 'personality' | 'memory' | 'tool_menu' | 'category_policy' | 'skill_runtime' | 'caller' | 'provider_adapter' | 'voice_runtime' | 'compactor' | 'bootstrap' | 'result_wrapper' | 'tool_schema';
export type InstructionTriggerClass = 'always' | 'role' | 'capability' | 'state' | 'category' | 'tool_call' | 'provider' | 'caller' | 'voice' | 'compactor' | 'bootstrap';

export interface InstructionSegmentDefinition {
  id: string;
  order: number;
  kind: InstructionSegmentKind;
  owner: InstructionSegmentOwner;
  triggerClass: InstructionTriggerClass;
  estimatedTokens: number;
  safetyCritical: boolean;
  stage3Pilot: boolean;
  category?: string;
  source: string;
}

const IDS = [
  'core.identity.main', 'core.identity.worker', 'core.action_posture', 'core.visual_grounding.vision', 'core.visual_grounding.text', 'core.skills_recovery', 'core.team_routing', 'core.creative_routing', 'core.plan_protocol',
  'mode.background_task', 'mode.proposal_execution', 'mode.background_agent', 'mode.heartbeat', 'mode.cron', 'mode.team_subagent', 'mode.team_manager',
  'model.capabilities', 'model.current', 'onboarding.meet',
  'persona.prometheus_soul', 'persona.subagent_soul', 'runtime.prometheus_contract', 'persona.voice_soul', 'persona.user', 'persona.workspace_soul',
  'memory.workspace', 'memory.agent', 'memory.routing', 'memory.retrieved',
  'context.business', 'context.project', 'context.intraday', 'context.cis', 'context.reference_files', 'context.boot', 'context.self_index', 'context.self_voice', 'context.recent_tool_observations', 'context.browser_session', 'context.caller',
  'tools.menu.categories', 'tools.file_edit_routing', 'tools.run_command_routing', 'tools.proposal_lanes', 'tools.search_strategy', 'tools.write_note', 'tools.memory_continuity', 'tools.business_context', 'tools.teams_agents', 'tools.model_routing', 'tools.background_agents', 'skills.tool_block_always', 'tools.active_categories', 'tools.category_match',
  'tools.category.browser_automation', 'tools.category.desktop_automation', 'tools.category.workspace_write', 'tools.category.prometheus_source_read', 'tools.category.prometheus_source_write', 'tools.category.advanced_memory', 'tools.category.media_assets', 'tools.category.automations', 'tools.category.agents_and_teams', 'tools.category.external_apps', 'tools.category.integration_admin', 'tools.category.social_intelligence', 'tools.category.proposal_admin', 'tools.category.mcp_server_tools', 'tools.category.composite_tools', 'tools.category.creative_basic', 'tools.category.creative_image', 'tools.category.creative_video', 'tools.category.creative_hyperframes', 'tools.category.creative_quality', 'tools.category.skills', 'tools.category.model_management', 'tools.category.business',
  'skills.general', 'skills.matching', 'skills.active', 'skills.schema', 'skills.full_result',
  'wrapper.browser_untrusted', 'wrapper.goal_reminder', 'wrapper.dom_delta', 'wrapper.screenshot', 'wrapper.category_activated', 'schema.all_tools',
  'caller.standalone_role_file', 'caller.standalone_task', 'caller.direct_subagent_chat', 'caller.background_agent', 'caller.team_subagent', 'caller.team_direct_chat', 'caller.team_manager', 'caller.task_recovery', 'caller.goal_continuation',
  'provider.openai_codex', 'provider.anthropic_oauth', 'provider.local_primary',
  'voice.worker_full', 'voice.worker_light', 'voice.worker_handoff', 'voice.realtime_context_pack', 'voice.realtime_instructions', 'voice.realtime_continuity', 'voice.realtime_tool_routing', 'voice.realtime_action_truth', 'voice.realtime_boundaries', 'voice.runtime_state',
  'compactor.system', 'compactor.user_contract', 'bootstrap.identity_contract', 'bootstrap.workspace', 'bootstrap.explicit_skills',
] as const;

export type InstructionSegmentId = typeof IDS[number];

const TOKEN_ESTIMATES: Partial<Record<InstructionSegmentId, number>> = {
  'persona.prometheus_soul': 2397, 'persona.subagent_soul': 904, 'runtime.prometheus_contract': 300, 'persona.voice_soul': 430,
  'persona.user': 3820, 'persona.workspace_soul': 1668, 'memory.workspace': 2170, 'context.business': 813,
  'tools.menu.categories': 180, 'tools.file_edit_routing': 76, 'tools.run_command_routing': 80,
  'tools.proposal_lanes': 204, 'tools.search_strategy': 359, 'tools.write_note': 210,
  'tools.memory_continuity': 90, 'tools.business_context': 189, 'tools.teams_agents': 210,
  'tools.model_routing': 210, 'tools.background_agents': 390, 'skills.tool_block_always': 425,
  'tools.category.browser_automation': 967, 'tools.category.desktop_automation': 509,
  'tools.category.workspace_write': 1446, 'tools.category.prometheus_source_read': 146,
  'tools.category.prometheus_source_write': 1347, 'tools.category.advanced_memory': 420,
  'tools.category.media_assets': 149, 'tools.category.automations': 108,
  'tools.category.agents_and_teams': 426, 'tools.category.integration_admin': 65,
  'tools.category.social_intelligence': 45, 'tools.category.proposal_admin': 45,
  'tools.category.model_management': 55, 'tools.category.business': 55,
  'skills.general': 330, 'provider.openai_codex': 25, 'provider.anthropic_oauth': 12,
  'compactor.system': 20,
};

function segmentSource(id: string): string {
  if (id.startsWith('tools.category.') || id.startsWith('tools.') || id === 'skills.tool_block_always') return 'src/gateway/prompt-context.ts';
  if (id.startsWith('skills.')) return 'src/gateway/skills-runtime/skills-manager.ts';
  if (id.startsWith('provider.')) return 'src/providers';
  if (id.startsWith('voice.') || id.startsWith('core.') || id.startsWith('mode.') || id.startsWith('model.') || id.startsWith('compactor.')) return 'src/gateway/routes/chat.router.ts';
  if (id === 'runtime.prometheus_contract') return 'src/config/prometheus-runtime-contract.md';
  if (id.startsWith('persona.') || id.startsWith('memory.') || id.startsWith('context.')) return 'src/gateway/prompt-context.ts';
  if (id.startsWith('caller.')) return 'src/gateway/agents-runtime|teams';
  if (id.startsWith('wrapper.')) return 'src/gateway/chat/chat-helpers.ts';
  if (id.startsWith('schema.')) return 'src/gateway/tool-builder.ts';
  return 'src/config/soul-loader.ts';
}

function ownerFor(id: string): InstructionSegmentOwner {
  if (id.startsWith('core.') || id.startsWith('mode.') || id.startsWith('model.') || id === 'runtime.prometheus_contract' || id === 'onboarding.meet') return 'core_runtime';
  if (id.startsWith('persona.')) return 'personality';
  if (id.startsWith('memory.') || id.startsWith('context.')) return 'memory';
  if (id.startsWith('tools.category.')) return 'category_policy';
  if (id.startsWith('tools.')) return 'tool_menu';
  if (id.startsWith('skills.')) return 'skill_runtime';
  if (id.startsWith('caller.')) return 'caller';
  if (id.startsWith('provider.')) return 'provider_adapter';
  if (id.startsWith('voice.')) return 'voice_runtime';
  if (id.startsWith('compactor.')) return 'compactor';
  if (id.startsWith('bootstrap.')) return 'bootstrap';
  if (id.startsWith('wrapper.')) return 'result_wrapper';
  return 'tool_schema';
}

function triggerFor(id: string): InstructionTriggerClass {
  if (id === 'runtime.prometheus_contract') return 'role';
  if (id.startsWith('mode.')) return 'role';
  if (id.startsWith('tools.category.')) return 'category';
  if (id.startsWith('provider.')) return 'provider';
  if (id.startsWith('voice.')) return 'voice';
  if (id.startsWith('compactor.')) return 'compactor';
  if (id.startsWith('bootstrap.')) return 'bootstrap';
  if (id.startsWith('caller.')) return 'caller';
  if (id.startsWith('wrapper.') || id === 'skills.full_result') return 'tool_call';
  if (id.includes('visual_grounding')) return 'capability';
  if (id.startsWith('context.') || id.startsWith('memory.') || id.startsWith('persona.') || id.startsWith('skills.')) return 'state';
  return 'always';
}

function kindFor(id: string): InstructionSegmentKind {
  if (id.startsWith('context.') || id.startsWith('memory.') || id.startsWith('persona.')) return 'context';
  if (id.startsWith('wrapper.')) return 'wrapper';
  if (id === 'schema.all_tools' || id === 'skills.schema') return 'schema';
  if (id.startsWith('provider.')) return 'provider';
  return 'instruction';
}

const PILOT_SET = new Set<string>(STAGE3_PILOT_CATEGORY_IDS.map((category) => `tools.category.${category}`));

export const INSTRUCTION_SEGMENT_REGISTRY: readonly InstructionSegmentDefinition[] = Object.freeze(
  IDS.map((id, index) => {
    const category = id.startsWith('tools.category.') ? id.slice('tools.category.'.length) : undefined;
    return Object.freeze({
      id,
      order: (index + 1) * 10,
      kind: kindFor(id),
      owner: ownerFor(id),
      triggerClass: triggerFor(id),
      estimatedTokens: TOKEN_ESTIMATES[id] || 40,
      safetyCritical: id === 'core.action_posture' || id === 'core.identity.main' || id === 'core.identity.worker' || id === 'voice.realtime_boundaries',
      stage3Pilot: PILOT_SET.has(id),
      category,
      source: segmentSource(id),
    });
  }),
);

export const INSTRUCTION_SEGMENT_BY_ID: Readonly<Record<string, InstructionSegmentDefinition>> = Object.freeze(
  Object.fromEntries(INSTRUCTION_SEGMENT_REGISTRY.map((segment) => [segment.id, segment])),
);

export interface InstructionResolverFacts {
  runtimeRole: RuntimePromptRole | string;
  executionMode?: string;
  personalityProfile?: string;
  surface?: string;
  provider?: string;
  capabilities?: Record<string, string | number | boolean | null>;
  activeToolCategories?: string[];
  exposedToolCategories?: string[];
  actualSegmentIds?: string[];
  toolNames?: string[];
  callerContextPresent?: boolean;
  instructionIntents?: Stage4InstructionIntents;
}

export interface InstructionSegmentDecision {
  id: string;
  order: number;
  included: boolean;
  currentlyIncluded: boolean;
  reason: string;
  estimatedTokens: number;
  stage3Pilot: boolean;
}

export interface InstructionResolutionReport {
  version: number;
  mode: InstructionResolverMode;
  selectedSegmentIds: string[];
  excludedSegmentIds: string[];
  decisions: InstructionSegmentDecision[];
  currentEstimatedTokens: number;
  shadowEstimatedTokens: number;
  estimatedSavedTokens: number;
  missingRequiredSegmentIds: string[];
  stage3Pilot: {
    enabled: boolean;
    categoryIds: string[];
    readySegmentIds: string[];
  };
}

function roleModeSegment(role: string): string | null {
  const map: Record<string, string> = {
    background_task: 'mode.background_task', proposal_execution: 'mode.proposal_execution',
    background_agent: 'mode.background_agent', heartbeat: 'mode.heartbeat', cron: 'mode.cron',
    team_subagent: 'mode.team_subagent', team_manager: 'mode.team_manager',
  };
  return map[role] || null;
}

function isWorkerRole(role: string): boolean {
  return ['direct_subagent', 'background_agent', 'team_subagent'].includes(role);
}

function recommendedDecision(segment: InstructionSegmentDefinition, facts: InstructionResolverFacts, actual: Set<string>, active: Set<string>): { included: boolean; reason: string } {
  const role = String(facts.runtimeRole || 'unknown');
  if (segment.id === 'core.identity.main') return { included: !isWorkerRole(role) && role !== 'context_compactor', reason: `runtime_role=${role}` };
  if (segment.id === 'core.identity.worker') return { included: isWorkerRole(role), reason: `worker_role=${role}` };
  if (segment.id === 'runtime.prometheus_contract') return { included: isWorkerRole(role) || role === 'team_manager', reason: `distinct_actor_role=${role}` };
  if (segment.id === 'memory.agent') return { included: isWorkerRole(role) || role === 'team_manager', reason: `personal_memory_role=${role}` };
  if (segment.id === 'core.action_posture' || segment.id === 'core.plan_protocol') return { included: role !== 'context_compactor', reason: `primary_runtime_role=${role}` };
  if (segment.id === 'core.visual_grounding.vision') return { included: facts.capabilities?.vision === true, reason: `vision=${facts.capabilities?.vision === true}` };
  if (segment.id === 'core.visual_grounding.text') return { included: facts.capabilities?.vision !== true, reason: `vision=${facts.capabilities?.vision === true}` };
  if (segment.id.startsWith('mode.')) return { included: roleModeSegment(role) === segment.id, reason: `runtime_role=${role}` };
  if (segment.id === 'model.capabilities' || segment.id === 'model.current') return { included: role !== 'context_compactor', reason: `model_facts_for_role=${role}` };
  if (segment.id.startsWith('tools.category.')) {
    const category = segment.category || '';
    return { included: active.has(category), reason: active.has(category) ? `active_category=${category}` : `inactive_category=${category}` };
  }
  if (segment.id === 'tools.file_edit_routing') return { included: facts.instructionIntents?.file_edit_intent === true || active.has('workspace_write') || active.has('prometheus_source_write'), reason: facts.instructionIntents?.file_edit_intent ? 'file_edit_intent=true' : 'write category state' };
  if (segment.id === 'tools.run_command_routing') return { included: facts.instructionIntents?.command_execution_intent === true || active.has('workspace_write'), reason: facts.instructionIntents?.command_execution_intent ? 'command_execution_intent=true' : 'workspace category state' };
  if (segment.id === 'tools.proposal_lanes') return { included: facts.instructionIntents?.proposal_workflow_intent === true || active.has('proposal_admin') || role === 'proposal_execution', reason: facts.instructionIntents?.proposal_workflow_intent ? 'proposal_workflow_intent=true' : 'proposal category or execution role' };
  if (segment.id === 'tools.search_strategy') return { included: facts.instructionIntents?.web_research_intent === true, reason: `web_research_intent=${facts.instructionIntents?.web_research_intent === true}` };
  if (segment.id === 'tools.memory_continuity') return { included: actual.has('memory.routing') || actual.has('memory.retrieved'), reason: 'memory continuity context present' };
  if (segment.id === 'tools.business_context') return { included: facts.instructionIntents?.business_context_intent === true || active.has('business') || actual.has('context.business'), reason: facts.instructionIntents?.business_context_intent ? 'business_context_intent=true' : 'business category or context present' };
  if (segment.id === 'tools.teams_agents' || segment.id === 'tools.background_agents') return { included: active.has('agents_and_teams'), reason: 'agents_and_teams category state' };
  if (segment.id === 'skills.tool_block_always' || segment.id === 'skills.general') return { included: actual.has('skills.matching') || actual.has('skills.active'), reason: 'matching or active skill context' };
  if (segment.id === 'schema.all_tools') return { included: (facts.toolNames?.length || 0) > 0, reason: `tool_count=${facts.toolNames?.length || 0}` };
  if (segment.id.startsWith('provider.')) {
    const provider = String(facts.provider || '').toLowerCase();
    if (segment.id === 'provider.openai_codex') return { included: provider.includes('openai') && provider.includes('codex'), reason: `provider=${provider}` };
    if (segment.id === 'provider.anthropic_oauth') return { included: provider.includes('anthropic'), reason: `provider=${provider}` };
    return { included: role === 'local_primary', reason: `runtime_role=${role}` };
  }
  if (segment.id.startsWith('voice.')) return { included: role === 'voice_agent' && actual.has(segment.id), reason: `voice_role=${role}; observed=${actual.has(segment.id)}` };
  if (segment.id.startsWith('compactor.')) return { included: role === 'context_compactor', reason: `runtime_role=${role}` };
  if (segment.id.startsWith('caller.')) return { included: facts.callerContextPresent === true && actual.has(segment.id), reason: `caller_context=${facts.callerContextPresent === true}; observed=${actual.has(segment.id)}` };
  if (segment.triggerClass === 'tool_call' || segment.triggerClass === 'bootstrap') return { included: actual.has(segment.id), reason: `observed_current=${actual.has(segment.id)}` };
  if (segment.id === 'tools.menu.categories' || segment.id === 'tools.write_note' || segment.id === 'tools.model_routing') return { included: role !== 'context_compactor' && role !== 'voice_agent', reason: `primary_tool_runtime=${role}` };
  return { included: actual.has(segment.id), reason: `observed_current=${actual.has(segment.id)}` };
}

export function resolveInstructionSegmentsShadow(facts: InstructionResolverFacts): InstructionResolutionReport {
  const resolverMode = getInstructionResolverMode();
  const actual = new Set((facts.actualSegmentIds || []).map(String));
  const active = new Set((facts.activeToolCategories || []).map(String));
  const toolsMenuObserved = actual.has('tools.menu') || actual.has('tools.menu.categories');
  const currentExpanded = new Set(actual);
  if (toolsMenuObserved) {
    ['tools.menu.categories', 'tools.file_edit_routing', 'tools.run_command_routing', 'tools.proposal_lanes', 'tools.search_strategy', 'tools.write_note', 'tools.memory_continuity', 'tools.business_context', 'tools.teams_agents', 'tools.model_routing', 'tools.background_agents', 'skills.tool_block_always'].forEach((id) => currentExpanded.add(id));
  }
  for (const category of active) currentExpanded.add(`tools.category.${category}`);
  if ((facts.toolNames?.length || 0) > 0) currentExpanded.add('schema.all_tools');

  const decisions = INSTRUCTION_SEGMENT_REGISTRY.map((segment) => {
    const decision = recommendedDecision(segment, facts, actual, active);
    return {
      id: segment.id,
      order: segment.order,
      included: decision.included,
      currentlyIncluded: currentExpanded.has(segment.id),
      reason: decision.reason,
      estimatedTokens: segment.estimatedTokens,
      stage3Pilot: segment.stage3Pilot,
    };
  }).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const currentEstimatedTokens = decisions.filter((item) => item.currentlyIncluded).reduce((sum, item) => sum + item.estimatedTokens, 0);
  const shadowEstimatedTokens = decisions.filter((item) => item.included).reduce((sum, item) => sum + item.estimatedTokens, 0);
  const requiredIds = new Set<string>();
  const role = String(facts.runtimeRole || 'unknown');
  if (role !== 'context_compactor') {
    requiredIds.add(isWorkerRole(role) ? 'core.identity.worker' : 'core.identity.main');
    requiredIds.add('core.action_posture');
  }
  if (role === 'voice_agent' && actual.has('voice.realtime_boundaries')) requiredIds.add('voice.realtime_boundaries');
  return {
    version: INSTRUCTION_SEGMENT_REGISTRY_VERSION,
    mode: resolverMode,
    selectedSegmentIds: decisions.filter((item) => item.included).map((item) => item.id),
    excludedSegmentIds: decisions.filter((item) => !item.included).map((item) => item.id),
    decisions,
    currentEstimatedTokens,
    shadowEstimatedTokens,
    estimatedSavedTokens: Math.max(0, currentEstimatedTokens - shadowEstimatedTokens),
    missingRequiredSegmentIds: Array.from(requiredIds).filter((id) => !decisions.find((item) => item.id === id)?.included).sort(),
    stage3Pilot: {
      enabled: resolverMode === 'pilot',
      categoryIds: [...STAGE3_PILOT_CATEGORY_IDS],
      readySegmentIds: decisions.filter((item) => item.stage3Pilot).map((item) => item.id),
    },
  };
}
