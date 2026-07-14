import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PROMPT_CACHE_MARKER } from '../providers/LLMProvider';
import { estimateMessagesTokens, estimateTextTokens, estimateToolSchemaTokens } from '../providers/model-usage';
import {
  resolveInstructionSegmentsShadow,
  type InstructionResolutionReport,
} from './instruction-segment-registry';
import {
  buildStage4InstructionRoutingReport,
  type Stage4InstructionIntents,
  type Stage4InstructionRoutingReport,
} from './instruction-intent-detector';
import { getSkillRoutingReport, type SkillRoutingReport } from './skill-routing-resolver';

export const RUNTIME_PROMPT_MANIFEST_VERSION = 4;

export type RuntimePromptRole =
  | 'main'
  | 'local_primary'
  | 'direct_subagent'
  | 'background_agent'
  | 'team_subagent'
  | 'team_manager'
  | 'background_task'
  | 'proposal_execution'
  | 'cron'
  | 'heartbeat'
  | 'voice_agent'
  | 'context_compactor'
  | 'unknown';

export interface RuntimePromptManifestContext {
  runtimeRole?: RuntimePromptRole | string;
  executionMode?: string;
  personalityProfile?: string;
  surface?: string;
  promptVariant?: string;
  activeToolCategories?: string[];
  exposedToolCategories?: string[];
  declaredPolicyIds?: string[];
  declaredSystemSegmentIds?: string[];
  capabilities?: Record<string, string | number | boolean | null | undefined>;
  callerContextPresent?: boolean;
  instructionIntents?: Stage4InstructionIntents;
  skillRouting?: SkillRoutingReport;
}
export interface RuntimePromptManifestInput {
  callType: 'chat' | 'generate';
  provider: string;
  model: string;
  role?: string;
  sessionId?: string;
  agentId?: string;
  messages?: Array<any>;
  system?: string;
  prompt?: string;
  tools?: Array<any>;
  context?: RuntimePromptManifestContext;
  timestamp?: string;
}

export interface RuntimePromptSystemMessageSummary {
  index: number;
  chars: number;
  estimatedTokens: number;
  hash: string;
  stablePrefixChars: number;
  volatileTailChars: number;
  cacheMarkerPresent: boolean;
}

export interface RuntimePromptManifest {
  version: number;
  id: string;
  hash: string;
  timestamp: string;
  callType: 'chat' | 'generate';
  provider: string;
  model: string;
  role: string;
  sessionId?: string;
  agentId?: string;
  runtimeRole: RuntimePromptRole | string;
  executionMode: string;
  personalityProfile: string;
  surface: string;
  promptVariant: string;
  capabilities: Record<string, string | number | boolean | null>;
  systemSegmentIds: string[];
  policyIds: string[];
  instructionResolution: InstructionResolutionReport;
  stage4InstructionRouting: Stage4InstructionRoutingReport;
  skillRouting?: SkillRoutingReport;
  systemMessages: RuntimePromptSystemMessageSummary[];
  messageSurface: {
    count: number;
    systemCount: number;
    userCount: number;
    assistantCount: number;
    toolResultCount: number;
    serializedChars: number;
    estimatedTokens: number;
    hash: string;
  };
  toolSurface: {
    count: number;
    names: string[];
    activeCategories: string[];
    exposedCategories: string[];
    schemaChars: number;
    estimatedSchemaTokens: number;
    hash: string;
  };
}

const SEGMENT_MARKERS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'mode.background_task', pattern: /EXECUTION MODE: Autonomous background task\./ },
  { id: 'mode.proposal_execution', pattern: /EXECUTION MODE: Approved proposal execution\./ },
  { id: 'mode.background_agent', pattern: /EXECUTION MODE: Background agent \(parallel worker\)\./ },
  { id: 'mode.heartbeat', pattern: /EXECUTION MODE: Heartbeat check\./ },
  { id: 'mode.cron', pattern: /EXECUTION MODE: Scheduled cron task\./ },
  { id: 'mode.team_subagent', pattern: /EXECUTION MODE: Team subagent task\./ },
  { id: 'mode.team_manager', pattern: /EXECUTION MODE: Team manager\./ },
  { id: 'core.identity.worker', pattern: /You are (?:a distinct|an? temporary|[^\n.]+, (?:a distinct|the manager)).*operating inside Prometheus/ },
  { id: 'core.identity.main', pattern: /You are Prom, a local AI assistant running inside Prometheus\./ },
  { id: 'model.capabilities', pattern: /\[MODEL_CAPABILITIES\]/ },
  { id: 'model.current', pattern: /\[CURRENT_MODEL\]/ },
  { id: 'context.recent_tool_observations', pattern: /\[RECENT_TOOL_OBSERVATIONS\]/ },
  { id: 'context.browser_session', pattern: /\[BROWSER SESSION ACTIVE:/ },
  { id: 'persona.prometheus_soul', pattern: /\[PROMETHEUS_SOUL\]/ },
  { id: 'persona.subagent_soul', pattern: /\[SUBAGENT_SOUL\]/ },
  { id: 'runtime.prometheus_contract', pattern: /\[PROMETHEUS_RUNTIME_CONTRACT\]/ },
  { id: 'persona.voice_soul', pattern: /\[VOICE_SOUL\]/ },
  { id: 'persona.user', pattern: /\[USER\]/ },
  { id: 'persona.workspace_soul', pattern: /\[SOUL\]/ },
  { id: 'memory.workspace', pattern: /\[MEMORY\]/ },
  { id: 'memory.agent', pattern: /\[AGENT_MEMORY/ },
  { id: 'memory.routing', pattern: /\[MEMORY_SEARCH_ROUTING\]/ },
  { id: 'memory.retrieved', pattern: /\[MEMORY_RETRIEVED\]/ },
  { id: 'context.business', pattern: /\[BUSINESS\]/ },
  { id: 'context.cis', pattern: /\[CIS_CONTEXT\]/ },
  { id: 'context.project', pattern: /\[PROJECT_CONTEXT\]/ },
  { id: 'context.intraday', pattern: /\[TODAY_NOTES/ },
  { id: 'context.reference_files', pattern: /\[REFERENCE_FILES\]/ },
  { id: 'context.boot', pattern: /\[BOOT_MD/ },
  { id: 'context.self_index', pattern: /\[SELF_INDEX\]/ },
  { id: 'context.self_voice', pattern: /\[SELF_VOICE_SECTION\]/ },
  { id: 'tools.menu.categories', pattern: /\[TOOLS\]/ },
  { id: 'tools.active_categories', pattern: /\[ACTIVE_TOOL_CATEGORIES\]/ },
  { id: 'tools.category_match', pattern: /\[TOOL_CATEGORY_MATCH\]/ },
  { id: 'skills.general', pattern: /\[SKILLS\]/ },
  { id: 'skills.matching', pattern: /\[MATCHING_SKILLS\]/ },
  { id: 'skills.active', pattern: /\[ACTIVE_SKILLS\]/ },
  { id: 'skills.full_result', pattern: /\[ACTIVATED_SKILL\s/ },
  { id: 'skills.matching', pattern: /\[SKILL_ADVISORY\]/ },
  { id: 'onboarding.meet', pattern: /\[ONBOARDING MEET & GREET MODE\]/ },
  { id: 'caller.team_manager', pattern: /\[TEAM MANAGER/ },
  { id: 'caller.team_subagent', pattern: /\[(?:TEAM DISPATCH|TEAM MEMBER|YOUR ROLE ON THIS TEAM)/ },
  { id: 'caller.standalone_task', pattern: /\[SUBAGENT:|\[SUBAGENT_SYSTEM_PROMPT\]/ },
  { id: 'voice.worker_handoff', pattern: /\[VOICE_AGENT_HANDOFF\]/ },
];

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function uniqueSorted(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort();
}

function contentToText(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => part?.type === 'text' ? String(part.text || '') : '').filter(Boolean).join('\n');
}

function normalizeCapabilities(value: RuntimePromptManifestContext['capabilities']): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, entry == null ? null : entry]),
  );
}

function summarizeSystemMessage(content: string, index: number): RuntimePromptSystemMessageSummary {
  const markerIndex = content.indexOf(PROMPT_CACHE_MARKER);
  const stablePrefixChars = markerIndex >= 0 ? markerIndex : content.length;
  const volatileTailChars = markerIndex >= 0 ? Math.max(0, content.length - markerIndex - PROMPT_CACHE_MARKER.length) : 0;
  return {
    index,
    chars: content.length,
    estimatedTokens: estimateTextTokens(content),
    hash: sha256(content),
    stablePrefixChars,
    volatileTailChars,
    cacheMarkerPresent: markerIndex >= 0,
  };
}

function detectSystemSegmentIds(systemText: string, declared: string[] | undefined, callerContextPresent: boolean | undefined): string[] {
  const ids = new Set<string>(uniqueSorted(declared));
  for (const marker of SEGMENT_MARKERS) {
    if (marker.pattern.test(systemText)) ids.add(marker.id);
  }
  if (callerContextPresent) ids.add('caller.context');
  if (systemText.trim() && ids.size === 0) ids.add('system.unclassified');
  return Array.from(ids).sort();
}

export function resolveRuntimePromptRole(input: {
  executionMode?: string;
  personalityProfile?: string;
  agentId?: string;
}): RuntimePromptRole {
  const profile = String(input.personalityProfile || '').trim();
  const mode = String(input.executionMode || '').trim();
  const agentId = String(input.agentId || '').trim();
  if (profile === 'local_llm') return 'local_primary';
  if (profile === 'direct_subagent') return 'direct_subagent';
  if (profile === 'voice_agent' || agentId === 'voice_agent') return 'voice_agent';
  if (agentId === 'context_compactor') return 'context_compactor';
  if (mode === 'background_agent') return 'background_agent';
  if (mode === 'team_subagent') return 'team_subagent';
  if (mode === 'team_manager') return 'team_manager';
  if (mode === 'background_task') return 'background_task';
  if (mode === 'proposal_execution') return 'proposal_execution';
  if (mode === 'cron') return 'cron';
  if (mode === 'heartbeat') return 'heartbeat';
  if (mode === 'interactive' || !mode) return 'main';
  return 'unknown';
}

export function buildRuntimePromptManifest(input: RuntimePromptManifestInput): RuntimePromptManifest {
  const context = input.context || {};
  const messages = Array.isArray(input.messages)
    ? input.messages
    : [
        ...(input.system ? [{ role: 'system', content: input.system }] : []),
        ...(input.prompt ? [{ role: 'user', content: input.prompt }] : []),
      ];
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const serializedMessages = JSON.stringify(messages);
  const systemEntries = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message?.role === 'system')
    .map(({ message, index }) => summarizeSystemMessage(contentToText(message?.content), index));
  const systemText = messages
    .filter((message) => message?.role === 'system')
    .map((message) => contentToText(message?.content))
    .join('\n\n');
  const toolNames = tools
    .map((tool) => String(tool?.function?.name || tool?.name || '').trim())
    .filter(Boolean)
    .sort();
  const schemaText = JSON.stringify(tools);
  const runtimeRole = context.runtimeRole || resolveRuntimePromptRole({
    executionMode: context.executionMode,
    personalityProfile: context.personalityProfile,
    agentId: input.agentId,
  });
  const activeCategories = uniqueSorted(context.activeToolCategories);
  const exposedCategories = uniqueSorted(context.exposedToolCategories);
  const capabilities = normalizeCapabilities(context.capabilities);
  const systemSegmentIds = detectSystemSegmentIds(
    systemText,
    context.declaredSystemSegmentIds,
    context.callerContextPresent,
  );
  const policyIds = uniqueSorted(context.declaredPolicyIds);
  const instructionResolution = resolveInstructionSegmentsShadow({
    runtimeRole,
    executionMode: context.executionMode,
    personalityProfile: context.personalityProfile,
    surface: context.surface,
    provider: input.provider,
    capabilities,
    activeToolCategories: activeCategories,
    exposedToolCategories: exposedCategories,
    actualSegmentIds: systemSegmentIds,
    toolNames,
    callerContextPresent: context.callerContextPresent,
    instructionIntents: context.instructionIntents,
  });
  const stage4InstructionRouting = buildStage4InstructionRoutingReport(context.instructionIntents || {
    file_edit_intent: false,
    command_execution_intent: false,
    proposal_workflow_intent: false,
    web_research_intent: false,
    business_context_intent: false,
    reasons: {},
  });
  const skillRouting = context.skillRouting || getSkillRoutingReport(input.sessionId);
  const stableIdentity = JSON.stringify({
    version: RUNTIME_PROMPT_MANIFEST_VERSION,
    callType: input.callType,
    provider: input.provider,
    model: input.model,
    role: input.role || '',
    runtimeRole,
    executionMode: context.executionMode || '',
    personalityProfile: context.personalityProfile || '',
    surface: context.surface || '',
    promptVariant: context.promptVariant || '',
    capabilities,
    messageHash: sha256(serializedMessages),
    systemHashes: systemEntries.map((entry) => entry.hash),
    systemSegmentIds,
    policyIds,
    activeCategories,
    exposedCategories,
    skillRouting: skillRouting ? {
      mode: skillRouting.mode,
      candidates: skillRouting.candidates.map((item) => item.id),
      discoveryRecommended: skillRouting.discoveryRecommended,
    } : undefined,
    toolHash: sha256(schemaText),
  });
  const hash = sha256(stableIdentity);
  const timestamp = input.timestamp || new Date().toISOString();
  const compactTimestamp = timestamp.replace(/[^0-9]/g, '').slice(0, 17);
  return {
    version: RUNTIME_PROMPT_MANIFEST_VERSION,
    id: `rpm_${compactTimestamp}_${hash.slice(0, 16)}_${crypto.randomBytes(3).toString('hex')}`,
    hash,
    timestamp,
    callType: input.callType,
    provider: String(input.provider || 'unknown'),
    model: String(input.model || 'unknown'),
    role: String(input.role || 'unknown'),
    sessionId: input.sessionId,
    agentId: input.agentId,
    runtimeRole,
    executionMode: String(context.executionMode || ''),
    personalityProfile: String(context.personalityProfile || ''),
    surface: String(context.surface || ''),
    promptVariant: String(context.promptVariant || ''),
    capabilities,
    systemSegmentIds,
    policyIds,
    instructionResolution,
    stage4InstructionRouting,
    skillRouting,
    systemMessages: systemEntries,
    messageSurface: {
      count: messages.length,
      systemCount: messages.filter((message) => message?.role === 'system').length,
      userCount: messages.filter((message) => message?.role === 'user').length,
      assistantCount: messages.filter((message) => message?.role === 'assistant').length,
      toolResultCount: messages.filter((message) => message?.role === 'tool').length,
      serializedChars: serializedMessages.length,
      estimatedTokens: estimateMessagesTokens(messages),
      hash: sha256(serializedMessages),
    },
    toolSurface: {
      count: tools.length,
      names: toolNames,
      activeCategories,
      exposedCategories,
      schemaChars: schemaText.length,
      estimatedSchemaTokens: estimateToolSchemaTokens(tools),
      hash: sha256(schemaText),
    },
  };
}

function promptManifestLogPath(): string {
  try {
    // Keep the pure manifest builder import-safe. Config and extension discovery
    // are needed only when a live runtime call actually persists telemetry.
    const { getConfig } = require('../config/config') as typeof import('../config/config');
    return path.join(getConfig().getConfigDir(), 'prompt-manifests.jsonl');
  } catch {
    return path.join(process.cwd(), '.prometheus', 'prompt-manifests.jsonl');
  }
}

export function appendRuntimePromptManifest(manifest: RuntimePromptManifest): void {
  try {
    const filePath = promptManifestLogPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(manifest)}\n`, 'utf-8');
  } catch {
    // Prompt observability must never break a model call.
  }
}

export function captureRuntimePromptManifest(input: RuntimePromptManifestInput): RuntimePromptManifest {
  const manifest = buildRuntimePromptManifest(input);
  appendRuntimePromptManifest(manifest);
  return manifest;
}
