import path from 'path';
import fs from 'fs';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../config/config';
import {
  captureModelUsageLogCursor,
  readModelUsageEventsForSession,
  readModelUsageEventsSince,
  getUsageCalibration,
  resolveProviderPromptTokens,
  type ModelUsageEvent,
} from '../../../providers/model-usage';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../session';
import { buildContextBudget, estimateMessageTokenBreakdownForModel, estimateMessagesTokensForModel, estimateTextTokensForModel, resolveActiveModelContextProfile } from '../../context/model-context';
import { deriveContextWindowUsage } from '../../context/context-window-usage';
import { createToolObservationsFromResults, formatToolStateSummaryForContext, persistToolResultsAsObservations, readToolObservationSnapshot, readToolObservations, type ToolObservation, type ToolObservationSnapshot } from '../../tool-observations';
import { buildCisContextBlock } from '../../business/cis-context-builder.js';
import { buildProjectContextBlock, findProjectBySessionId, listProjects, removeSessionFromProject } from '../../projects/project-store.js';
import { loadSoul } from '../../../config/soul-loader.js';
import {
	  buildTools as _buildTools,
	  getToolCategory,
	  isSchemaHiddenCompatToolName,
	  type BuildToolsDeps,
  type ToolResult,
  type TaskControlResponse,
  type ScheduleJobAction,
  normalizeScheduleJobAction,
  summarizeCronJob,
  normalizeDeliveryChannel,
  normalizeToolArgsForTool,
  parseJsonLike,
  toStringRecord,
  parseLooseMap,
} from '../../tool-builder';
import {
  // Core exports
  buildTools,
  executeTool,
  _dispatchToAgent,
  initChatHelpers,
  buildPersonalityContext,
  // Stats / maps
  getOrchestrationSessionStats,
  orchestrationSessionStats,
  recordOrchestrationEvent,
  ensureMultiAgentSkill,
  getPreemptSessionCount,
  incrementPreemptSessionCount,
  // Types
  type SubagentProfile,
  type HandleChatResult,
  type RuntimeProgressItem,
  // Skills
  resolveSkillsDir,
  configuredSkillsDir,
  fallbackSkillsDir,
  syncMissingSkills,
  migrateSkillsStateIfMissing,
  // Progress
  prettifyToolName,
  buildProgressItems,
  // Tool call helpers
  logToolCall,
  isBrowserToolName,
  isDesktopToolName,
  isDesktopVisualToolName,
  buildBrowserAck,
  wrapUntrustedBrowserToolContent,
  buildDesktopAck,
  buildDesktopScreenshotContent,
  buildVisionScreenshotMessage,
  // Chat intent classifiers
  isExecutionLikeRequest,
  isContinuationCue,
  hasPendingExecutionIntent,
  isHardBlockerReply,
  hasConcreteCompletion,
  autoActivateToolCategories,
  // File helpers
  isHighStakesFile,
  requestedFullTemplate,
  resolveWorkspaceFilePath,
  collectFileSnapshots,
  // Browser quality
  goalIsInteractiveAction,
  isBrowserHeavyResearchPage,
  goalLikelyNeedsTextInput,
  parseSnapshotDiagnostics,
  evaluateBrowserSnapshotQuality,
} from '../../chat/chat-helpers';
import { isPublicDistributionBuild } from '../../../runtime/distribution.js';
import {
  buildBootStartupSnapshot as _buildBootStartupSnapshot,
  loadFullMemoryProfile,
  loadWorkspaceFile,
  loadVoiceAgentMemory,
  readDailyMemoryContext,
  processIntradayNotes,
  processIntradayNotesForPrompt,
  isLowInformationAutomaticMemoryQuery,
  detectToolCategories,
  readMemoryCategories,
  readMemorySnippets,
  buildPersonalityContext as _buildPersonalityContext,
  buildToolsContext,
  TOOL_BLOCKS,
  TOOL_TO_MEMORY_CATS,
  type SkillWindow,
} from '../../prompt-context';
import { buildBrainCapsuleContextDetails } from '../../brain/brain-continuity.js';
import {
  formatMemoryAtomReferenceContext,
  formatMemoryAtomReferenceEntries,
  retrieveMemoryAtoms,
} from '../../memory-index/memory-atoms.js';
import type { SkillsManager } from '../../skills-runtime/skills-manager';

let _skillsManager: SkillsManager;
export function configureContextWindowDependencies(deps: { skillsManager: SkillsManager }): void {
  _skillsManager = deps.skillsManager;
}

export function estimateJsonTokensForModel(value: unknown, profile: { tokenizer: any }): number {
  try {
    return estimateTextTokensForModel(JSON.stringify(value || null), profile.tokenizer);
  } catch {
    return estimateTextTokensForModel(String(value || ''), profile.tokenizer);
  }
}

export function safeTokenSessionFileName(sessionId: string): string {
  return String(sessionId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

export const rawToolTokenCache = new Map<string, { size: number; mtimeMs: number; tokens: number }>();

export function estimateToolObservationRawTokens(sessionId: string, profile: { tokenizer: any }): { tokens: number; bytes: number; files: number } {
  let tokens = 0;
  let bytes = 0;
  let files = 0;
  try {
    const dir = path.join(getConfig().getConfigDir(), 'tool-observations', 'raw', safeTokenSessionFileName(sessionId));
    if (!fs.existsSync(dir)) return { tokens, bytes, files };
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      files += 1;
      bytes += st.size;
      // Raw tool-result files are immutable once written; re-reading and
      // tokenizing every one on each context-window poll cost ~1s of main
      // thread per poll on long sessions. Cache by path + size + mtime.
      const cacheKey = `${full}\u0000${String(profile.tokenizer || '')}`;
      const cachedTokens = rawToolTokenCache.get(cacheKey);
      if (cachedTokens && cachedTokens.size === st.size && cachedTokens.mtimeMs === st.mtimeMs) {
        tokens += cachedTokens.tokens;
        continue;
      }
      let fileTokens = 0;
      try {
        fileTokens = estimateTextTokensForModel(fs.readFileSync(full, 'utf-8'), profile.tokenizer);
      } catch {
        fileTokens = Math.ceil(st.size / 3.5);
      }
      tokens += fileTokens;
      rawToolTokenCache.set(cacheKey, { size: st.size, mtimeMs: st.mtimeMs, tokens: fileTokens });
      if (rawToolTokenCache.size > 20_000) {
        const oldest = rawToolTokenCache.keys().next().value;
        if (oldest !== undefined) rawToolTokenCache.delete(oldest);
      }
    }
  } catch {}
  return { tokens, bytes, files };
}

export function estimateStoredThreadFootprint(
  sessionId: string,
  session: any,
  profile: { tokenizer: any },
  observationSnapshot: ToolObservationSnapshot = readToolObservationSnapshot(sessionId, 512, profile.tokenizer),
) {
  const history = Array.isArray(session?.history) ? session.history : [];
  let visibleChatTokens = 0;
  let processEntryTokens = 0;
  let legacyToolLogTokens = 0;
  let attachmentMetadataTokens = 0;
  for (const msg of history) {
    visibleChatTokens += estimateTextTokensForModel(msg?.content || '', profile.tokenizer);
    if (Array.isArray(msg?.processEntries)) processEntryTokens += estimateJsonTokensForModel(msg.processEntries, profile);
    if (msg?.toolLog) legacyToolLogTokens += estimateTextTokensForModel(msg.toolLog, profile.tokenizer);
    const attachmentBits = {
      artifacts: msg?.artifacts,
      generatedImages: msg?.generatedImages,
      generatedVideos: msg?.generatedVideos,
      attachmentPreviews: msg?.attachmentPreviews,
      canvasFiles: msg?.canvasFiles,
      fileChanges: msg?.fileChanges,
      productCarousel: msg?.productCarousel,
      richArtifacts: msg?.richArtifacts,
    };
    attachmentMetadataTokens += estimateJsonTokensForModel(attachmentBits, profile);
  }
  const sessionJsonTokens = estimateJsonTokensForModel(session, profile);
  const toolObservationStoredTokens = observationSnapshot.storedObservationTokens;
  const raw = estimateToolObservationRawTokens(sessionId, profile);
  return {
    visibleChatTokens,
    processEntryTokens,
    legacyToolLogTokens,
    attachmentMetadataTokens,
    sessionJsonTokens,
    toolObservationStoredTokens,
    rawToolResultTokens: raw.tokens,
    rawToolResultBytes: raw.bytes,
    rawToolResultFiles: raw.files,
    fullStoredThreadTokens: sessionJsonTokens + toolObservationStoredTokens + raw.tokens,
  };
}

export function aggregateModelUsageEvents(events: ModelUsageEvent[]) {
  const totals = {
    calls: events.length,
    providerReportedCalls: 0,
    estimatedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    estimatedMessageInputTokens: 0,
    estimatedSystemPromptTokens: 0,
    estimatedConversationTokens: 0,
    estimatedToolSchemaTokens: 0,
    estimatedProviderInputTokens: 0,
    lastCall: null as any,
    lastContextCall: null as any,
  };
  for (const event of events) {
    if (event.source === 'provider') totals.providerReportedCalls += 1;
    else totals.estimatedCalls += 1;
    totals.inputTokens += Number(event.inputTokens || 0);
    totals.outputTokens += Number(event.outputTokens || 0);
    totals.reasoningTokens += Number(event.reasoningTokens || 0);
    totals.cacheReadTokens += Number(event.cacheReadTokens || 0);
    totals.cacheWriteTokens += Number(event.cacheWriteTokens || 0);
    totals.totalTokens += Number(event.totalTokens || 0);
    totals.estimatedMessageInputTokens += Number((event as any).estimatedMessageInputTokens || 0);
    totals.estimatedSystemPromptTokens += Number((event as any).estimatedSystemPromptTokens || 0);
    totals.estimatedConversationTokens += Number((event as any).estimatedConversationTokens || 0);
    totals.estimatedToolSchemaTokens += Number((event as any).estimatedToolSchemaTokens || 0);
    totals.estimatedProviderInputTokens += Number((event as any).estimatedProviderInputTokens || 0);
    totals.lastCall = event;
    const eventProviderInput = Number((event as any).estimatedProviderInputTokens || 0);
    const isMainChatContext = event.callType === 'chat' && String(event.agentId || '') === 'main' && eventProviderInput > 0;
    const isFallbackChatContext = !totals.lastContextCall && event.callType === 'chat' && eventProviderInput > 0;
    if (isMainChatContext || isFallbackChatContext) totals.lastContextCall = event;
  }
  return totals;
}

export function aggregateSessionModelUsage(sessionId: string) {
  return aggregateModelUsageEvents(readModelUsageEventsForSession(sessionId));
}

export function summarizeTurnToolResultBudget(observations: ToolObservation[]) {
  const byTool = new Map<string, any>();
  let resultTokens = 0;
  let argsTokens = 0;
  let totalTokens = 0;
  let resultBytes = 0;
  let durationMsTotal = 0;
  let durationMsMax = 0;
  let durationCallCount = 0;
  for (const obs of observations || []) {
    const name = String(obs?.toolName || 'unknown_tool');
    const estimate = obs?.tokenEstimate || {} as any;
    const result = Math.max(0, Number((estimate as any).resultTokens || 0));
    const args = Math.max(0, Number((estimate as any).argsTokens || 0));
    const total = Math.max(0, Number((estimate as any).totalTokens || result + args));
    const bytes = Math.max(0, Number((estimate as any).resultBytes || 0));
    const obsDurationMs = Number((obs as any)?.durationMs);
    const hasDuration = Number.isFinite(obsDurationMs);
    const duration = hasDuration ? Math.max(0, Math.round(obsDurationMs)) : 0;
    resultTokens += result;
    argsTokens += args;
    totalTokens += total;
    resultBytes += bytes;
    if (hasDuration) {
      durationMsTotal += duration;
      durationMsMax = Math.max(durationMsMax, duration);
      durationCallCount += 1;
    }
    const row = byTool.get(name) || { tool: name, calls: 0, resultTokens: 0, argsTokens: 0, totalTokens: 0, resultBytes: 0, durationMsTotal: 0, durationMsMax: 0, durationCallCount: 0 };
    row.calls += 1;
    row.resultTokens += result;
    row.argsTokens += args;
    row.totalTokens += total;
    row.resultBytes += bytes;
    if (hasDuration) {
      row.durationMsTotal += duration;
      row.durationMsMax = Math.max(row.durationMsMax, duration);
      row.durationCallCount += 1;
    }
    byTool.set(name, row);
  }
  const tools = [...byTool.values()].map((row) => ({
    ...row,
    durationMsAvg: row.durationCallCount > 0 ? Math.round(row.durationMsTotal / row.durationCallCount) : 0,
  }));
  return {
    calls: observations.length,
    resultTokens,
    argsTokens,
    totalTokens,
    resultBytes,
    durationMsTotal,
    durationMsMax,
    durationMsAvg: durationCallCount > 0 ? Math.round(durationMsTotal / durationCallCount) : 0,
    tools: tools.sort((a, b) => b.resultTokens - a.resultTokens || b.durationMsMax - a.durationMsMax || b.calls - a.calls).slice(0, 20),
    slowestTools: [...tools].filter((row) => Number(row.durationMsMax || 0) > 0).sort((a, b) => b.durationMsMax - a.durationMsMax || b.durationMsTotal - a.durationMsTotal).slice(0, 20),
  };
}

export function buildActiveSkillsContextEstimate(sessionId: string, profile: { tokenizer: any }) {
  const children: ContextWindowRow[] = [];
  let text = '';
  try {
    const skillIds = Array.from(getActivatedSkillIds(sessionId));
    const lines: string[] = ['[ACTIVE_SKILLS]'];
    const activeLines: string[] = [];
    const resourceLines: string[] = [];
    const hintLines: string[] = [];
    for (const skillId of skillIds) {
      const skill = _skillsManager?.get?.(skillId);
      activeLines.push(`Recently used: ${skill?.id || skillId}.`);
      if (skill?.description) activeLines.push(`Skill Description: ${skill.description}`);
      const resources = getActivatedSkillResources(sessionId, skillId);
      if (resources.length) resourceLines.push(`Resources read for ${skill?.id || skillId}: ${resources.join(', ')}.`);
      hintLines.push(`Re-read with skill_read("${skill?.id || skillId}") if you need the full instructions.`);
    }
    lines.push(...activeLines, ...resourceLines, ...hintLines);
    text = lines.join('\n');
    const childSpecs = [
      { id: 'active_skill_reminders', label: 'Active skill reminders', lines: activeLines },
      { id: 'resource_reminders', label: 'Resource reminders', lines: resourceLines },
      { id: 'reread_hints', label: 'Re-read hints', lines: hintLines },
    ];
    for (const spec of childSpecs) {
      const body = spec.lines.join('\n').trim();
      const tokens = estimateTextTokensForModel(body, profile.tokenizer);
      if (tokens > 0) {
        children.push({
          id: `skills.${spec.id}`,
          label: spec.label,
          tokens,
          active: true,
          includedInContext: true,
          percentBasis: 'window',
          estimated: true,
        });
      }
    }
  } catch {
    text = '';
  }
  return {
    tokens: estimateTextTokensForModel(text, profile.tokenizer),
    children,
  };
}

export type ContextWindowRow = {
  id: string;
  label: string;
  tokens: number;
  active?: boolean;
  includedInContext?: boolean;
  outOfBand?: boolean;
  percentBasis?: string;
  percentLabel?: string;
  estimated?: boolean;
  children?: ContextWindowRow[];
};

export function allocateContextChildren(
  parentId: string,
  totalTokens: number,
  specs: Array<{ id: string; label: string; tokens?: number; weight?: number; estimated?: boolean }>,
): ContextWindowRow[] {
  const total = Math.max(0, Math.round(Number(totalTokens || 0)));
  if (total <= 0 || !specs.length) return [];
  const raw = specs.map((spec) => ({
    ...spec,
    rawTokens: Math.max(0, Number(spec.tokens ?? spec.weight ?? 0)),
  })).filter((spec) => spec.rawTokens > 0);
  const rawTotal = raw.reduce((sum, spec) => sum + spec.rawTokens, 0);
  if (rawTotal <= 0) return [];

  let remaining = total;
  return raw.map((spec, index) => {
    const tokens = index === raw.length - 1
      ? remaining
      : Math.max(0, Math.round((spec.rawTokens / rawTotal) * total));
    remaining = Math.max(0, remaining - tokens);
    return {
      id: `${parentId}.${spec.id}`,
      label: spec.label,
      tokens,
      active: tokens > 0,
      includedInContext: true,
      percentBasis: 'window',
      estimated: spec.estimated !== false,
    };
  }).filter((row) => row.tokens > 0);
}

export function friendlyContextToolCategory(category: string): string {
  const labels: Record<string, string> = {
    core: 'Core runtime tools',
    browser: 'Browser tools',
    browser_automation: 'Browser automation',
    desktop: 'Desktop tools',
    workspace_read: 'Workspace read tools',
    workspace_write: 'Workspace write tools',
    prometheus_source_read: 'Source read tools',
    prometheus_source_write: 'Source write tools',
    memory: 'Memory tools',
    skills: 'Skill tools',
    schedules: 'Schedule tools',
    tasks: 'Task tools',
    agents: 'Agent tools',
    team: 'Team tools',
    external_apps: 'External app tools',
    model_management: 'Model tools',
    business: 'Business tools',
    creative: 'Creative tools',
    media: 'Media tools',
    mcp: 'MCP tools',
    composite_tools: 'Composite tools',
  };
  return labels[category] || category.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export function estimateCurrentSystemToolSchemaTokens(sessionId: string, profile: { tokenizer: any }): number {
  try {
    return (buildTools(sessionId) || []).reduce((sum: number, tool: any) => sum + estimateJsonTokensForModel(tool, profile), 0);
  } catch {
    return 0;
  }
}

export function estimateCurrentSystemPromptTokens(sessionId: string, profile: { tokenizer: any }): number {
  try {
    return buildSystemPromptChildren(0, sessionId, profile)
      .reduce((sum, row) => sum + Math.max(0, Number(row.tokens || 0)), 0);
  } catch {
    return 0;
  }
}

export function buildSystemToolSchemaChildren(sessionId: string, profile: { tokenizer: any }, totalTokens: number): ContextWindowRow[] {
  let total = Math.max(0, Number(totalTokens || 0));
  const byCategory: Record<string, number> = {};
  try {
    for (const tool of buildTools(sessionId) || []) {
      const name = String((tool as any)?.function?.name || '');
      const category = getToolCategory(name) || 'core';
      byCategory[category] = (byCategory[category] || 0) + estimateJsonTokensForModel(tool, profile);
    }
  } catch {
    return [];
  }
  if (total <= 0) total = Object.values(byCategory).reduce((sum, tokens) => sum + Math.max(0, Number(tokens || 0)), 0);
  if (total <= 0) return [];
  return allocateContextChildren(
    'system_tools',
    total,
    Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([category, tokens]) => ({
        id: category,
        label: friendlyContextToolCategory(category),
        tokens,
        estimated: true,
      })),
  );
}

export function buildContextWindowSubagentsRosterEstimate(): string {
  try {
    const subs = getAgents().filter((agent: any) => agent && agent.default !== true && agent.id !== 'main');
    if (subs.length === 0) {
      return '[SUBAGENTS] You currently have 0 subagents configured (only the default agent exists). If asked "how many subagents / who are they," answer: none yet.';
    }
    const lines = subs.map((agent: any) => {
      const displayName = agent?.identity?.displayName || agent?.name || agent?.id;
      const desc = String(agent?.description || '').trim();
      const shortDesc = desc.length > 140 ? `${desc.slice(0, 137)}...` : desc;
      return `- ${displayName} (id: ${agent.id})${shortDesc ? ` - ${shortDesc}` : ''}`;
    });
    return [
      `[SUBAGENTS] You currently have ${subs.length} subagent${subs.length === 1 ? '' : 's'} configured. ALWAYS refer to each by their display name (not the technical id). When asked how many subagents exist or who they are, answer with this count and these names:`,
      ...lines,
    ].join('\n');
  } catch {
    return '';
  }
}

export function getLastUserContextText(sessionId: string): string {
  try {
    const history = Array.isArray(getSession(sessionId)?.history) ? getSession(sessionId).history : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const msg = history[i] as any;
      if (msg?.role !== 'user') continue;
      const content = String(msg?.content || '').trim();
      if (!content) continue;
      if (/^Before continuing: summarize the conversation so far into a compact context note\./i.test(content)) continue;
      if (/^Before continuing: preserve any durable user preferences/i.test(content)) continue;
      return content;
    }
  } catch {}
  return '';
}

export function isBrainMemoryContextSession(sessionId: string): boolean {
  return /^(?:brain_|auto_brain_)/i.test(String(sessionId || ''));
}

export function resolveContextWindowMemoryMode(sessionId: string): 'full' | 'compact' | 'atoms' {
  if (isBrainMemoryContextSession(sessionId)) return 'full';
  const configured = String(process.env.PROMETHEUS_MEMORY_PROMPT_MODE || '').trim().toLowerCase();
  if (configured === 'full' || configured === 'compact') return configured;
  return 'atoms';
}

export function buildContextWindowMemoryAtomEstimate(
  workspacePath: string,
  messageText: string,
  projectContext: string,
  profile: { tokenizer: any },
): {
  text: string;
  tokens: number;
  selectedCount: number;
  directCount: number;
  relatedCount: number;
  directTokens: number;
  relatedTokens: number;
  metadataTokens: number;
} {
  const empty = {
    text: '',
    tokens: 0,
    selectedCount: 0,
    directCount: 0,
    relatedCount: 0,
    directTokens: 0,
    relatedTokens: 0,
    metadataTokens: 0,
  };
  if (isLowInformationAutomaticMemoryQuery(String(messageText || ''))) return empty;
  const result = retrieveMemoryAtoms(workspacePath, messageText, { additionalContext: projectContext });
  if (!result.selected.length) return empty;
  const text = formatMemoryAtomReferenceContext(result);
  const selectedDirect = result.selected.filter((match) => match.relation === 'direct');
  const selectedRelated = result.selected.filter((match) => match.relation === 'related');
  const directText = formatMemoryAtomReferenceEntries(selectedDirect);
  const relatedText = formatMemoryAtomReferenceEntries(selectedRelated);
  const sharedHeader = [
    '[MEMORY_REFERENCE]',
    'Selected durable memory atoms from workspace/MEMORY.md. Preserve the cited meaning and prefer a directly matching atom over a weak association. The source file remains authoritative; use memory_read when the user asks for the complete file or exact historical evidence.',
    `atom_count=${result.selected.length} | source_atoms=${result.stats.atomCount}`,
  ].join('\n');
  const directTokens = selectedDirect.length
    ? estimateTextTokensForModel(`${sharedHeader}\n${directText}`, profile.tokenizer)
    : 0;
  const relatedTokens = selectedRelated.length
    ? estimateTextTokensForModel(relatedText, profile.tokenizer)
    : 0;
  const tokens = estimateTextTokensForModel(text, profile.tokenizer);
  return {
    text,
    tokens,
    selectedCount: result.selected.length,
    directCount: selectedDirect.length,
    relatedCount: selectedRelated.length,
    directTokens,
    relatedTokens,
    metadataTokens: Math.max(0, tokens - directTokens - relatedTokens),
  };
}

export function buildContextWindowThoughtPacketEstimate(
  workspacePath: string,
  messageText: string,
  profile: { tokenizer: any },
) {
  const details = buildBrainCapsuleContextDetails(workspacePath, messageText);
  const tokens = estimateTextTokensForModel(details.text, profile.tokenizer);
  return {
    text: details.text,
    tokens,
    selectedCount: details.selected.length,
    relatedCount: details.relatedCount,
    fallbackCount: details.fallbackCount,
  };
}

export function buildSystemPromptChildren(totalTokens: number, sessionId: string, profile: { tokenizer: any }): ContextWindowRow[] {
  const rows: ContextWindowRow[] = [];
  const addText = (id: string, label: string, text: string, estimated = false) => {
    const tokens = estimateTextTokensForModel(text, profile.tokenizer);
    if (tokens <= 0) return;
    rows.push({
      id: `system_prompt.${id}`,
      label,
      tokens,
      active: true,
      includedInContext: true,
      percentBasis: 'window',
      estimated,
    });
  };

  try {
    const workspacePath = getConfig().getWorkspacePath();
    const activeCategories = getActivatedToolCategories(sessionId);
    const today = new Date().toISOString().split('T')[0];
    const intradayRaw = loadWorkspaceFile(workspacePath, path.join('memory', `${today}-intraday-notes.md`), 32_000);
    const intraday = processIntradayNotesForPrompt(workspacePath, intradayRaw);
    const business = isBusinessContextEnabled(sessionId) ? loadWorkspaceFile(workspacePath, 'BUSINESS.md', 4000) : '';
    const lastUserText = getLastUserContextText(sessionId);
    const cisContext = buildCisContextBlock(workspacePath, lastUserText, { force: isBusinessContextEnabled(sessionId) });
    const projectContext = findProjectBySessionId(sessionId) ? (buildProjectContextBlock(sessionId) || '') : '';
    const toolsBlock = buildToolsContext(activeCategories);
    const baseToolsBlock = buildToolsContext(new Set<string>());
    const toolsMenu = toolsBlock.startsWith(baseToolsBlock)
      ? baseToolsBlock
      : toolsBlock;
    const activeToolBlocks = toolsBlock.startsWith(baseToolsBlock)
      ? toolsBlock.slice(baseToolsBlock.length).trim()
      : Array.from(activeCategories)
        .map((category) => TOOL_BLOCKS[String(category || '')])
        .filter(Boolean)
        .join('\n\n');
    const skillsHint = _skillsManager?.buildTurnContext?.('') || '';
    const referenceHint = isPublicDistributionBuild()
      ? ''
      : '[REFERENCE_FILES] Architecture/debug context: self/index.md is the canonical workspace-root map; use workspace_read(action:"read", path:"self/index.md"). Follow its links to focused self/* subsystem files as needed.';
    const profileInfo = resolveActiveModelContextProfile();

    addText('base_identity', 'Base identity / execution mode', 'You are Prometheus. Follow the current execution mode, response style, safety, routing, memory, and tool-use rules.', true);
    addText('model_capabilities', 'Model capabilities', `[MODEL_CAPABILITIES]\nprovider=${profileInfo.providerId}\nmodel=${profileInfo.model}`, false);
    addText('prometheus_soul', '[PROMETHEUS_SOUL]', loadSoul());
    addText('user', '[USER]', loadWorkspaceFile(workspacePath, 'USER.md', 5000));
    addText('soul', '[SOUL]', loadWorkspaceFile(workspacePath, 'SOUL.md', 6000));
    const memoryMode = resolveContextWindowMemoryMode(sessionId);
    if (memoryMode === 'full' || memoryMode === 'compact') {
      addText(
        'memory',
        memoryMode === 'full' ? '[MEMORY]' : '[MEMORY] (compact)',
        loadFullMemoryProfile(workspacePath, 'MEMORY.md', memoryMode === 'compact' ? 8000 : undefined),
      );
    } else {
      const atomEstimate = buildContextWindowMemoryAtomEstimate(workspacePath, lastUserText, projectContext, profile);
      const atomLabel = atomEstimate.selectedCount > 0
        ? `Atomic memories (${atomEstimate.directCount} direct Â· ${atomEstimate.relatedCount} related)`
        : 'Atomic memories (none)';
      const atomChildren = atomEstimate.selectedCount > 0
        ? [
          {
            id: 'system_prompt.atomic_memory.direct',
            label: `Direct atoms (${atomEstimate.directCount})`,
            tokens: atomEstimate.directTokens,
            active: atomEstimate.directTokens > 0,
            includedInContext: true,
            percentBasis: 'window',
            estimated: true,
          },
          {
            id: 'system_prompt.atomic_memory.related',
            label: `Related atoms (${atomEstimate.relatedCount})`,
            tokens: atomEstimate.relatedTokens,
            active: atomEstimate.relatedTokens > 0,
            includedInContext: true,
            percentBasis: 'window',
            estimated: true,
          },
          ...(atomEstimate.metadataTokens > 0
            ? [{
              id: 'system_prompt.atomic_memory.reference_metadata',
              label: 'Reference metadata',
              tokens: atomEstimate.metadataTokens,
              active: true,
              includedInContext: true,
              percentBasis: 'window',
              estimated: true,
            }]
            : []),
        ]
        : undefined;
      rows.push({
        id: 'system_prompt.atomic_memory',
        label: atomLabel,
        tokens: atomEstimate.tokens,
        active: atomEstimate.tokens > 0,
        includedInContext: atomEstimate.tokens > 0,
        percentBasis: 'window',
        estimated: true,
        ...(atomChildren ? { children: atomChildren } : {}),
      });
    }
    addText('business', '[BUSINESS]', business);
    addText('cis_context', '[CIS_CONTEXT]', cisContext, true);
    addText('subagents', '[SUBAGENTS]', buildContextWindowSubagentsRosterEstimate(), true);
    addText('project_context', '[PROJECT_CONTEXT]', projectContext);
    addText('today_notes', '[TODAY_NOTES]', intraday);
    const thoughtEstimate = buildContextWindowThoughtPacketEstimate(workspacePath, lastUserText, profile);
    const thoughtLabel = thoughtEstimate.selectedCount > 0
      ? `Thought context packets (${thoughtEstimate.relatedCount} related${thoughtEstimate.fallbackCount ? ` Â· ${thoughtEstimate.fallbackCount} fallback` : ''})`
      : 'Thought context packets (none)';
    rows.push({
      id: 'system_prompt.thought_context_packets',
      label: thoughtLabel,
      tokens: thoughtEstimate.tokens,
      active: thoughtEstimate.tokens > 0,
      includedInContext: thoughtEstimate.tokens > 0,
      percentBasis: 'window',
      estimated: true,
    });
    addText('tools_menu', '[TOOLS] menu', toolsMenu, true);
    addText('activated_tool_blocks', 'Activated TOOL_BLOCKS.*', activeToolBlocks, true);
    addText('skills_hint', 'Skills hint / matching skills', skillsHint, true);
    addText('reference_hints', 'Reference hints', referenceHint, true);
  } catch {
    // Fall through to the total reconciliation below.
  }

  const total = Math.max(0, Math.round(Number(totalTokens || 0)));
  const rowTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.tokens || 0)), 0);
  if (total > 0 && rowTotal > total) {
    return allocateContextChildren(
      'system_prompt',
      total,
      rows.map((row) => ({
        id: row.id.replace(/^system_prompt\./, ''),
        label: row.label,
        tokens: row.tokens,
        estimated: row.estimated,
      })),
    );
  }
  if (total > rowTotal) {
    rows.push({
      id: 'system_prompt.runtime_context',
      label: 'Caller/browser/runtime context',
      tokens: total - rowTotal,
      active: true,
      includedInContext: true,
      percentBasis: 'window',
      estimated: true,
    });
  }
  return rows;
}

export function buildProviderUsageGroup(id: string, label: string, usage: any, percentLabel = 'total'): ContextWindowRow | null {
  const inputTokens = Math.max(0, Number(usage?.inputTokens || 0));
  const outputTokens = Math.max(0, Number(usage?.outputTokens || 0));
  const reasoningTokens = Math.max(0, Number(usage?.reasoningTokens || 0));
  const cacheReadTokens = Math.max(0, Number(usage?.cacheReadTokens || 0));
  const cacheWriteTokens = Math.max(0, Number(usage?.cacheWriteTokens || 0));
  const totalTokens = Math.max(0, Number(usage?.totalTokens || 0))
    || inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;
  if (totalTokens <= 0) return null;
  const children: ContextWindowRow[] = [
    { id: `${id}_input`, label: 'Input', tokens: inputTokens, active: inputTokens > 0, includedInContext: false, outOfBand: true, percentLabel },
    { id: `${id}_output`, label: 'Output', tokens: outputTokens, active: outputTokens > 0, includedInContext: false, outOfBand: true, percentLabel },
    { id: `${id}_reasoning`, label: 'Reasoning', tokens: reasoningTokens, active: reasoningTokens > 0, includedInContext: false, outOfBand: true, percentLabel },
    { id: `${id}_cache_read`, label: 'Cache read', tokens: cacheReadTokens, active: cacheReadTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'saved' },
    { id: `${id}_cache_write`, label: 'Cache write', tokens: cacheWriteTokens, active: cacheWriteTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'stored' },
  ].filter((row) => row.active);
  return { id, label, tokens: totalTokens, active: true, includedInContext: false, outOfBand: true, percentLabel, children };
}

export function buildToolUsageGroup(toolUsage: any): ContextWindowRow | null {
  const argsTokens = Math.max(0, Number(toolUsage?.argsTokens || 0));
  const resultTokens = Math.max(0, Number(toolUsage?.resultTokens || 0));
  const totalTokens = Math.max(0, Number(toolUsage?.totalTokens || argsTokens + resultTokens));
  if (totalTokens <= 0) return null;
  const children: ContextWindowRow[] = [
    { id: 'thread_tool_input', label: 'Tool input', tokens: argsTokens, active: argsTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'total' },
    { id: 'thread_tool_output', label: 'Tool output', tokens: resultTokens, active: resultTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'total' },
  ].filter((row) => row.active);
  return {
    id: 'tool_usage_thread_total',
    label: 'Tool I/O Â· thread total',
    tokens: totalTokens,
    active: true,
    includedInContext: false,
    outOfBand: true,
    percentLabel: 'total',
    children,
  };
}

export function buildContextWindowCurrentState(input: {
  sessionId: string;
  profile: { contextWindowTokens: number; tokenizer: any };
  currentInputTokens: number;
  messageTokens: number;
  historyMessages: number;
  recentToolTokens: number;
  inputBudgetTokens: number;
  compactionTriggerTokens: number;
  storedThread: any;
  modelUsage: any;
  toolUsage?: any;
}) {
  const lastCall = input.modelUsage?.lastContextCall || input.modelUsage?.lastCall || {};
  // A newly-created web/mobile draft can have no current history but still
  // share a session/model telemetry cache with the previous visible chat.
  // Recorded prompt numbers are only authoritative once this session has
  // current messages; otherwise they make the popover open with stale totals.
  const hasCurrentHistory = Math.max(0, Number(input.historyMessages || 0)) > 0;
  const latestMessageInputTokens = hasCurrentHistory
    ? Math.max(0, Number(lastCall.estimatedMessageInputTokens || 0))
    : 0;
  const latestSystemPromptTokens = hasCurrentHistory
    ? Math.max(0, Number(lastCall.estimatedSystemPromptTokens || 0))
    : 0;
  const recordedToolSchemaTokens = hasCurrentHistory
    ? Math.max(0, Number(lastCall.estimatedToolSchemaTokens || 0))
    : 0;
  const latestToolSchemaTokens = Math.max(
    0,
    recordedToolSchemaTokens || estimateCurrentSystemToolSchemaTokens(input.sessionId, input.profile),
  );
  const latestProviderInputTokens = hasCurrentHistory
    ? Math.max(0, Number(lastCall.estimatedProviderInputTokens || 0))
    : 0;
  // Anthropic reports `input_tokens` as the uncached remainder only; the cached
  // prefix it actually processed lands in cache read/write. Reading inputTokens
  // directly made a warm 140k-token Claude turn report ~2 tokens, pinning the
  // context bar at 0% on both mobile and desktop. resolveProviderPromptTokens
  // normalizes this per provider (and must not add cache for OpenAI-style
  // usage, where cached_tokens is a subset of the reported input).
  const latestProviderReportedInputTokens = hasCurrentHistory && lastCall.source === 'provider'
    ? Math.max(0, resolveProviderPromptTokens(lastCall))
    : 0;
  const activeSkillEstimate = buildActiveSkillsContextEstimate(input.sessionId, input.profile);
  const activeSkillTokens = activeSkillEstimate.tokens;
  const legacySystemPromptEstimate = hasCurrentHistory
    ? Math.max(0, latestMessageInputTokens - input.currentInputTokens - activeSkillTokens)
    : 0;
  const systemPromptTokens = latestSystemPromptTokens > 0
    ? Math.max(0, latestSystemPromptTokens - activeSkillTokens)
    : (legacySystemPromptEstimate || estimateCurrentSystemPromptTokens(input.sessionId, input.profile));
  const systemToolChildren = buildSystemToolSchemaChildren(input.sessionId, input.profile, latestToolSchemaTokens);
  const systemPromptChildren = buildSystemPromptChildren(systemPromptTokens, input.sessionId, input.profile);
  const skillChildren = activeSkillEstimate.children;
  const contextWindowTokens = Math.max(0, Number(input.profile.contextWindowTokens || 0));
  const inputBudgetTokens = Math.max(0, Number(input.inputBudgetTokens || 0));
  const compactionTriggerTokens = Math.max(0, Number(input.compactionTriggerTokens || 0));
  // Cache reads are the tokens reused from the provider cache. Cache writes
  // are storage activity, not cached context already available to the model.
  const cachedTokens = hasCurrentHistory
    ? Math.max(0, Number(input.modelUsage?.cacheReadTokens || 0))
    : 0;
  // This is the aggregate persisted footprint of the thread, not the latest
  // message estimate shown in the current-context rows.
  const totalThreadTokens = Math.max(0, Number(input.storedThread?.fullStoredThreadTokens || 0));
  const contextLimitTokens = contextWindowTokens || inputBudgetTokens || compactionTriggerTokens;
  const inContextRows: ContextWindowRow[] = [
    { id: 'messages', label: 'Messages', tokens: Math.max(0, input.messageTokens), active: input.messageTokens > 0 },
    { id: 'system_tools', label: 'System tools', tokens: latestToolSchemaTokens, active: latestToolSchemaTokens > 0, children: systemToolChildren },
    { id: 'system_prompt', label: 'System prompt', tokens: systemPromptTokens, active: systemPromptTokens > 0, children: systemPromptChildren },
    { id: 'skills', label: 'Skills', tokens: activeSkillTokens, active: activeSkillTokens > 0, children: skillChildren, estimated: activeSkillTokens > 0 },
    { id: 'tool_observations', label: 'Tool observations', tokens: Math.max(0, input.recentToolTokens), active: input.recentToolTokens > 0 },
  ].map((row) => ({ ...row, includedInContext: true, percentBasis: 'window' }));
  const inContextRowTotal = inContextRows.reduce((sum, row) => sum + Math.max(0, Number(row.tokens || 0)), 0);
  const runtimeOverheadBasis = latestSystemPromptTokens > 0
    ? latestMessageInputTokens + latestToolSchemaTokens
    : inContextRowTotal;
  // Provider input_tokens is the actual context submitted on the latest call.
  // Prefer it over the locally reconstructed estimate, which can omit restored
  // tool/reasoning history after reconnect or compaction.
  const authoritativeProviderInputTokens = latestProviderReportedInputTokens || latestProviderInputTokens;
  const runtimeOverheadTokens = Math.max(0, authoritativeProviderInputTokens - runtimeOverheadBasis);
  const runtimeOverheadRow = runtimeOverheadTokens > 0
    ? [{ id: 'runtime_overhead', label: 'Runtime overhead', tokens: runtimeOverheadTokens, active: true, includedInContext: true, percentBasis: 'window' }]
    : [];
  const currentStateTokens = authoritativeProviderInputTokens > 0
    ? authoritativeProviderInputTokens
    : inContextRowTotal;
  const contextUsage = deriveContextWindowUsage(currentStateTokens, contextLimitTokens);
  const freeSpaceTokens = Math.max(0, contextLimitTokens - currentStateTokens);
  const providerUsageRow = buildProviderUsageGroup('provider_session_total', 'Model usage Â· thread total', input.modelUsage, 'total');
  const toolUsageRow = buildToolUsageGroup(input.toolUsage);
  return {
    currentStateTokens,
    contextUsage,
    contextLimitTokens,
    contextWindowTokens,
    compactionTriggerTokens,
    cachedTokens,
    totalThreadTokens,
    latestProviderInputTokens,
    latestProviderReportedInputTokens,
    nextCallEstimateTokens: input.currentInputTokens,
    freeSpaceTokens,
    rows: [
      ...inContextRows,
      ...runtimeOverheadRow,
      { id: 'compaction_trigger', label: 'Compaction trigger', tokens: compactionTriggerTokens, active: false, includedInContext: false, outOfBand: true, percentBasis: 'window', percentLabel: 'trigger' },
      ...(providerUsageRow ? [providerUsageRow] : []),
      ...(toolUsageRow ? [toolUsageRow] : []),
    ],
  };
}

