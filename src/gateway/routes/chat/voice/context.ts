import { getMainChatStream } from './dependencies';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../../config/config';
import { readAgentPromptFile } from '../../../../agents/agent-prompt-file.js';
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
} from '../../../prompt-context';
import {
  registerLiveRuntime,
  finishLiveRuntime,
  hasTerminalRuntimeCheckpoint,
  updateLiveRuntimeCheckpoint,
  markLiveRuntimeProgress,
  interruptLiveRuntimeForRecovery,
  listLiveRuntimes,
  listInterruptedRuntimes,
  getLiveRuntime,
  abortLiveRuntime,
  addPendingRuntimeSteer,
  consumePendingRuntimeSteersForSession,
  isSteerableChatRuntimeKind,
  stripInheritedRecoveryMarks,
  type RuntimeSteerEvent,
} from '../../../live-runtime-registry';
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
} from '../../../tool-builder';
import { createMainChatStreamStore, type MainChatStreamFrame, type MainChatStreamState } from '../../../chat/main-chat-stream-store';
import {
  browserOpen,
  browserSnapshot,
  browserSnapshotDelta,
  browserClick,
  browserFill,
  browserPressKey,
  browserType,
  browserWait,
  browserScroll,
  browserDrag,
  browserClose,
  formatBrowserInteractionContextBlock,
  browserVisionScreenshot,
  browserVisionClick,
  browserVisionType,
  browserPreviewScreenshot,
  browserGetFocusedItem,
  browserGetPageText,
  getLastBrowserScreenshot,
  getBrowserToolDefinitions,
  getBrowserSessionInfo,
  getBrowserAdvisorPacket,
  listBrowserSessions,
  type BrowserAdvisorPacket,
  type BrowserObserveMode,
  resolveBrowserObserveMode,
} from '../../../browser-tools';
import {
  desktopFindWindow,
  desktopFocusWindowVerified,
  desktopWindowControl,
  desktopClick,
  desktopDrag,
  desktopScroll,
  desktopWait,
  desktopType,
  desktopTypeRaw,
  desktopPressKey,
  desktopGetClipboard,
  desktopSetClipboard,
  // Phase 4
  desktopLaunchApp,
  desktopCloseApp,
  desktopGetProcessList,
  // Phase 3
  desktopWaitForChange,
  desktopDiffScreenshot,
  desktopScreenshotWithHistory,
  desktopWindowScreenshot,
  parseDesktopScreenshotToolArgs,
  parseDesktopPointerMonitorArgs,
  resolveDesktopActionPoint,
  getDesktopAdvisorPacketById,
  desktopGetActiveMonitorIndex,
  desktopGetMonitors,
  desktopGetMonitorsSummary,
  desktopFindInstalledApp,
  desktopListWindowsCanonical,
  desktopFocusWindowCanonical,
  desktopWindowClick,
  desktopWindowType,
  desktopWindowPressKey,
  desktopWindowScroll,
  getDesktopToolDefinitions,
  getDesktopAdvisorPacket,
} from '../../../desktop-tools';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import { getSubagentChatHistory } from '../../../agents-runtime/subagent-chat-store';
import crypto from 'crypto';
import { voiceContextRequestHash, voiceContextEntryMatches } from '../../../voice/context-cache-key';
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
} from '../../../chat/chat-helpers';
import { voiceNarrationTargetFromArgs, voiceNarrationClean } from './narrator';
import { buildVoiceTimeContext } from './tool-helpers';
import { ROLLING_COMPACTION_SUMMARY_PREFIX, LEGACY_COMPACTION_SUMMARY_PREFIX, summarizeMobileRuntime, _skillsManager } from './dependencies';


export type VoiceAgentAction =
  | 'answer_now'
  | 'steer_worker'
  | 'interrupt_worker'
  | 'handoff_new_work'
  | 'no_reply';

export type VoiceAgentTargetContext = {
  kind: 'main' | 'subagent';
  agentId?: string;
  label?: string;
};

export function normalizeVoiceAgentTarget(raw: any): VoiceAgentTargetContext {
  const source = raw?.voiceTarget || raw?.voice_target || raw?.target || raw?.selectedVoiceTarget || raw?.selected_voice_target || raw || {};
  const kind = String(source?.kind || source?.targetKind || source?.target_kind || '').trim().toLowerCase();
  const agentId = compactVoiceText(source?.agentId || source?.agent_id || source?.id || '', 120);
  const label = compactVoiceText(source?.label || source?.name || source?.alias || source?.friendlyName || source?.friendly_name || '', 160);
  if (kind === 'subagent' || agentId) {
    return { kind: 'subagent', agentId, label: label || agentId || 'Subagent' };
  }
  return { kind: 'main', label: 'Prometheus' };
}

export function normalizeVoiceRoomContext(raw: any): Record<string, any> | null {
  const source = raw?.voiceRoomContext || raw?.voice_room_context || raw?.voiceRoom || raw?.voice_room || null;
  if (!source || typeof source !== 'object' || source.enabled !== true) return null;
  const participants = (Array.isArray(source.participants) ? source.participants : [])
    .map((participant: any) => ({
      key: compactVoiceText(participant?.key || '', 180),
      kind: String(participant?.kind || '').trim() === 'subagent' ? 'subagent' : 'main',
      agentId: compactVoiceText(participant?.agentId || participant?.agent_id || '', 120),
      label: compactVoiceText(participant?.label || participant?.name || '', 120),
    }))
    .filter((participant: any) => participant.key && participant.label)
    .slice(0, 12);
  const transcript = (Array.isArray(source.transcript) ? source.transcript : [])
    .map((entry: any) => ({
      role: String(entry?.role || '').trim() === 'assistant' ? 'assistant' : 'user',
      speaker: compactVoiceText(entry?.speaker || '', 120),
      targetKey: compactVoiceText(entry?.targetKey || entry?.target_key || '', 180),
      text: compactVoiceText(entry?.text || entry?.content || '', 1200),
      at: Number(entry?.at || entry?.timestamp || 0) || null,
    }))
    .filter((entry: any) => entry.text)
    .slice(-48);
  return {
    enabled: participants.length > 1,
    activeKey: compactVoiceText(source.activeKey || source.active_key || '', 180),
    participants,
    transcript,
    transcriptText: transcript
      .slice(-32)
      .map((entry: any) => `${entry.speaker || (entry.role === 'assistant' ? 'Agent' : 'User')}: ${entry.text}`)
      .join('\n')
      .slice(-7000),
    updatedAt: Number(source.updatedAt || source.updated_at || transcript[transcript.length - 1]?.at || Date.now()) || Date.now(),
  };
}

export function voiceAgentTargetIdentity(target?: VoiceAgentTargetContext) {
  const normalized = normalizeVoiceAgentTarget(target || {});
  const isSubagent = normalized.kind === 'subagent';
  const label = compactVoiceText(normalized.label || normalized.agentId || (isSubagent ? 'Subagent' : 'Prometheus'), 120);
  return {
    target: normalized,
    isSubagent,
    label,
    speakerName: isSubagent ? label : 'Prometheus',
    workerLabel: isSubagent ? label : 'Prometheus worker',
    identityLine: isSubagent
      ? `You are ${label}, a standalone subagent running under Prometheus. You are speaking through your own voice interface. You are not Prometheus and must not claim to be Prometheus.`
      : 'You are Prometheus speaking through the user\'s voice interface.',
    roleLine: isSubagent
      ? `You are not merely a voice layer, narrator, assistant voice, or provider voice. You are the subagent ${label} in live voice form. When work needs the durable worker path, phrase it as your own work: "I am on it", "I will handle that", or similar. Do not say you will get the worker, ask Prometheus, or hand it to Prometheus.`
      : 'You have Prometheus\'s identity, memory, preferences, user knowledge, and current task context.',
    handoffLine: isSubagent
      ? `For handoffs, the app routes the request into this selected subagent chat (${label}) rather than the main Prometheus chat. The technical worker/tool wording is implementation detail; do not expose it.`
      : 'When the user requests work requiring tools outside the voice_* and skill_* set, files, non-voice browser/desktop capabilities, coding, scheduling beyond voice_timer, memory mutation beyond voice_write_note, or long reasoning, acknowledge naturally first, then dispatch to the Prometheus worker.',
  };
}

export function resolveSubagentVoiceWorkspace(target?: VoiceAgentTargetContext): { workspacePath: string; agent: any; agentId: string; label: string } | null {
  const normalized = normalizeVoiceAgentTarget(target || {});
  const agentId = compactVoiceText(normalized.agentId || '', 120);
  if (normalized.kind !== 'subagent' || !agentId) return null;
  const agent = getAgentById(agentId);
  if (!agent) return null;
  const workspacePath = resolveAgentWorkspace(agent as any) || ensureAgentWorkspace(agent as any);
  const label = compactVoiceText(normalized.label || agent?.name || (agent as any)?.alias || agentId, 160) || agentId;
  return { workspacePath, agent, agentId, label };
}

export function buildSubagentVoiceContextOverlay(target?: VoiceAgentTargetContext): string {
  const resolved = resolveSubagentVoiceWorkspace(target);
  if (!resolved) return '';
  const { workspacePath, agent, agentId, label } = resolved;
  const identityPrompt = String(readAgentPromptFile(workspacePath, { migrateLegacy: true })?.content || '').slice(0, 10000).trim();
  const bits = [
    '[SUBAGENT_VOICE_IDENTITY]',
    `You are ${label}, the selected standalone subagent. The voice interface is only how the user is talking to you.`,
    'Prometheus is the host/orchestrator/runtime around you; Prometheus is not your identity. You are a subagent under Prometheus, not a generic voice agent.',
    'If asked who you are, say you are this subagent and describe your subagent role. Do not identify as "the live conversational voice agent" or "the voice layer".',
    'Speak in first person as this subagent. For durable work, phrase the handoff as your own action, not as asking Prometheus or getting a worker.',
    `Subagent id: ${agentId}`,
    `Subagent configured name: ${compactVoiceText(agent?.name || label, 160)}`,
    `Subagent workspace: ${workspacePath}`,
    '',
    identityPrompt ? `[SUBAGENT_AGENT_MD]\n${identityPrompt}` : '',
  ].filter(Boolean);
  return bits.join('\n\n').trim();
}

export function applyVoiceTargetContextBlock(contextBlock: string, target?: VoiceAgentTargetContext): string {
  const normalized = normalizeVoiceAgentTarget(target || {});
  if (normalized.kind !== 'subagent') return contextBlock;
  const overlay = buildSubagentVoiceContextOverlay(normalized);
  if (!overlay) return contextBlock;
  return `${overlay}\n\n${String(contextBlock || '').trim()}`.trim();
}

export function loadVoiceAgentMemoryForTarget(target?: VoiceAgentTargetContext): string {
  const resolved = resolveSubagentVoiceWorkspace(target);
  if (resolved) return '';
  return loadVoiceAgentMemory(getConfig().getWorkspacePath());
}

export const voiceAgentNarrationState = new Map<string, { signature: string; at: number; text?: string }>();
export const voiceAgentWorkerHandoffSessions = new Map<string, { at: number; transcript: string; eventId: string }>();
export const VOICE_AGENT_HANDOFF_SESSION_TTL_MS = 90 * 1000;

export function hasRecentVoiceAgentWorkerHandoff(sessionId: string): boolean {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  const entry = voiceAgentWorkerHandoffSessions.get(sid);
  if (!entry) return false;
  if (Date.now() - Number(entry.at || 0) > VOICE_AGENT_HANDOFF_SESSION_TTL_MS) {
    voiceAgentWorkerHandoffSessions.delete(sid);
    return false;
  }
  return true;
}

export function findActiveMainChatRuntimeForSession(sessionId: string, expectedRuntimeId = ''): any | null {
  const sid = String(sessionId || '').trim();
  const expected = String(expectedRuntimeId || '').trim();
  return listLiveRuntimes()
    .filter((runtime) => (
      isSteerableChatRuntimeKind(runtime.kind)
      && String(runtime.sessionId || '') === sid
      && (!expected || runtime.id === expected)
    ))
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0] || null;
}

export function compactVoiceText(value: unknown, max = 500): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

export function friendlyVoiceToolName(value: unknown): string {
  return compactVoiceText(value, 120).replace(/_/g, ' ').trim();
}

export function isVoiceContextNoiseText(value: unknown): boolean {
  const text = compactVoiceText(value, 240).toLowerCase();
  if (!text) return true;
  return /^(?:request received|preparing prometheus runtime|preparing chat context|building model context|classifying (?:the )?request|thinking|processing|working|responding|preparing tool|tool complete|complete|done|step[_\s-]*done|step[_\s-]*complete|plan:|plan update:|reset\b|compacting (?:the )?thread|saving (?:important )?memory|checking paused task follow-up|building context|building prometheus runtime|tool schemas refreshed(?: for this turn)?\.?)\b/.test(text);
}

export function isVoiceContextNoiseEvent(value: unknown): boolean {
  return /^(?:heartbeat|token|thinking|thinking_delta|reasoning_summary_delta|ui_preflight|voice_milestone|model_stream_event)$/i.test(String(value || '').trim());
}

export function summarizeVoiceToolActivity(toolName: unknown, args: any, eventType = '', data: any = {}): string {
  const tool = String(toolName || '').trim();
  const friendly = friendlyVoiceToolName(tool || 'tool');
  const target = voiceNarrationTargetFromArgs(args);
  const failed = data?.error === true || /^ERROR:/i.test(String(data?.result || data?.message || ''));
  if (!tool) return failed ? 'A step hit an issue.' : '';
  if (tool === 'skill_list') return '';
  if (tool === 'skill_read') return target ? `Read skill: ${target}` : 'Read a skill.';
  if (/^(read_file|file_read|source_read)$/i.test(tool)) return target ? `Read file: ${target}` : 'Read a file.';
  if (/^(list_files|search_files|grep|find_files)$/i.test(tool)) return target ? `Searched: ${target}` : 'Searched the workspace.';
  if (/^(write_file|edit_file|create_file|patch_file|apply_patch|replace_file|delete_file)$/i.test(tool)) return target ? `Edited file: ${target}` : 'Edited files.';
  if (/^(run_command|shell_command|terminal_run)$/i.test(tool)) {
    const command = compactVoiceText(args?.command || args?.cmd || target, 140);
    return command ? `Ran command: ${command}` : 'Ran a command.';
  }
  if (tool.startsWith('browser_')) return target ? `Used browser: ${target}` : `Used ${friendly}.`;
  if (tool.startsWith('desktop_')) return target ? `Used desktop tool: ${target}` : `Used ${friendly}.`;
  if (/memory/i.test(tool)) return '';
  if (/approval/i.test(tool)) return failed ? 'Approval step hit an issue.' : 'Checked an approval step.';
  if (failed) return `${friendly || 'Tool'} hit an issue.`;
  if (String(eventType || '').toLowerCase() === 'tool_call') return target ? `Using ${friendly}: ${target}` : `Using ${friendly}.`;
  return `${friendly || 'Tool'} completed.`;
}

export function voiceNarrationLineFromActivity(text: unknown): string {
  const value = compactVoiceText(text, 260);
  if (!value || isVoiceContextNoiseText(value)) return '';
  const skill = value.match(/^Read skill:\s*(.+)$/i)?.[1];
  if (skill) return `I checked the ${skill} guidance and I'm applying it now.`;
  const fileRead = value.match(/^Read file:\s*(.+)$/i)?.[1];
  if (fileRead) return `I checked ${fileRead}; now I'm using that to make the next move cleanly.`;
  const searched = value.match(/^Searched:\s*(.+)$/i)?.[1];
  if (searched) return `I searched ${searched} and I'm narrowing it down from there.`;
  const edited = value.match(/^Edited file:\s*(.+)$/i)?.[1];
  if (edited) return `I updated ${edited}; now I'm checking that it holds together.`;
  const command = value.match(/^Ran command:\s*(.+)$/i)?.[1];
  if (command) {
    if (/test|check|tsc|lint|build|vitest|jest|pytest|node --check/i.test(command)) return "I'm running verification now so I can catch anything before I call it done.";
    return "I ran the command and I'm reading the result before I move again.";
  }
  if (/^Used browser:/i.test(value)) return "I've got the browser context now and I'm using it to decide the next step.";
  if (/^Used desktop tool:/i.test(value)) return "I've checked the desktop state and I'm using that context now.";
  if (/ completed\.?$/i.test(value) && !/^skill read completed/i.test(value)) return '';
  if (/ hit an issue\.?$/i.test(value)) return "That step hit an issue, so I'm adjusting the route instead of pushing forward blindly.";
  return value.length > 12 ? value : '';
}

export function summarizeUnlockedToolCategories(names: string[], requestedCategory = ''): string {
  const categories = new Set<string>();
  const requested = compactVoiceText(requestedCategory, 120);
  if (requested) categories.add(requested);
  for (const name of names || []) {
    const category = getToolCategory(String(name || '').trim());
    if (category) categories.add(String(category));
  }
  const labels = Array.from(categories)
    .map((category) => friendlyVoiceToolName(category))
    .filter(Boolean);
  if (!labels.length) return 'Tool category unlocked for this turn.';
  return `Newly unlocked tool category: ${labels.join(', ')}.`;
}

export function summarizeVoiceContextEntry(entry: any): Record<string, any> | null {
  const event = compactVoiceText(entry?.extra?.event || entry?.event || '', 80);
  const toolName = compactVoiceText(entry?.extra?.toolName || entry?.toolName || entry?.action || '', 120);
  const args = entry?.extra?.args || entry?.args;
  const type = String(entry?.type || 'info');
  if (toolName === 'skill_list') return null;
  if (isVoiceContextNoiseEvent(event) && type !== 'error' && type !== 'warn') return null;
  let content = '';
  if (event === 'tool_call' || event === 'tool_result' || toolName) {
    content = summarizeVoiceToolActivity(toolName, args, event, {
      error: entry?.extra?.error === true || type === 'error',
      result: entry?.content || entry?.result,
      message: entry?.message,
    });
  } else {
    content = compactVoiceText(entry?.content || entry?.message || entry?.summary || '', type === 'error' || type === 'warn' ? 260 : 420);
  }
  if (!content || (type !== 'error' && type !== 'warn' && isVoiceContextNoiseText(content))) return null;
  return {
    type: type === 'think' ? 'info' : type,
    actor: compactVoiceText(entry?.actor || 'Prom', 80) || 'Prom',
    content,
    toolName: toolName === 'skill_list' ? '' : toolName,
    event,
    ts: compactVoiceText(entry?.ts || entry?.at || '', 80),
  };
}

export function summarizeVoiceProcessEntries(entries: any[], limit = 10): Array<Record<string, any>> {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => summarizeVoiceContextEntry(entry))
    .filter((entry): entry is Record<string, any> => !!entry && !!(entry.content || entry.toolName || entry.event))
    .slice(-limit);
}

export function summarizeVoiceStreamEvents(stream: MainChatStreamState | null, limit = 12): Array<Record<string, any>> {
  const summarized: Array<Record<string, any> | null> = (stream?.events || [])
    .map((frame) => {
      const type = compactVoiceText(frame?.type || '', 80);
      const data = frame?.data || {};
      const action = compactVoiceText(data?.action || data?.name || data?.toolName || '', 120);
      const error = data?.error === true || type === 'error';
      if (action === 'skill_list') return null;
      if (isVoiceContextNoiseEvent(type) && !error && type !== 'warn') return null;
      let message = '';
      if (type === 'tool_call' || type === 'tool_result' || action) {
        message = summarizeVoiceToolActivity(action, data?.args, type, data);
      } else {
        message = compactVoiceText(data?.message || data?.text || data?.summary || (error ? data?.result : ''), error ? 260 : 420);
      }
      if (!message || (!error && isVoiceContextNoiseText(message))) return null;
      return {
        seq: frame.seq,
        type,
        at: frame.at,
        message,
        action,
        error,
      };
    });
  return summarized
    .filter((frame): frame is Record<string, any> => !!frame && !!(frame.message || frame.action || frame.type))
    .slice(-limit);
}

export function summarizeVoiceObservation(sessionId: string): Record<string, any> {
  let browser: Record<string, any> | null = null;
  let desktop: Record<string, any> | null = null;
  try {
    const packet: any = getBrowserAdvisorPacket(sessionId);
    if (packet) {
      browser = {
        title: compactVoiceText(packet.title || packet.pageTitle || packet.tabTitle || '', 180),
        url: compactVoiceText(packet.url || '', 220),
        summary: compactVoiceText(packet.summary || packet.pageSummary || packet.observation || packet.text || '', 700),
        updatedAt: Number(packet.updatedAt || packet.at || 0) || null,
      };
    }
  } catch {}
  try {
    const packet: any = getDesktopAdvisorPacket(sessionId);
    if (packet) {
      desktop = {
        activeWindow: packet.activeWindow ? {
          processName: compactVoiceText(packet.activeWindow.processName || '', 120),
          title: compactVoiceText(packet.activeWindow.title || '', 220),
        } : null,
        summary: compactVoiceText(packet.summary || packet.observation || packet.ocrText || packet.text || '', 700),
        updatedAt: Number(packet.updatedAt || packet.at || 0) || null,
      };
    }
  } catch {}
  return { browser, desktop };
}

export function cleanVoiceCompactionSummaryText(value: unknown, maxChars = 4000): string {
  let summary = String(value || '').trim();
  if (!summary) return '';
  if (summary.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX)) {
    summary = summary.slice(ROLLING_COMPACTION_SUMMARY_PREFIX.length).trim();
  } else if (summary.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX)) {
    summary = summary.slice(LEGACY_COMPACTION_SUMMARY_PREFIX.length).trim();
  }
  return voiceNarrationClean(summary, maxChars);
}

export function subagentVoiceTargetId(target?: VoiceAgentTargetContext): string {
  const normalized = normalizeVoiceAgentTarget(target || {});
  return normalized.kind === 'subagent' ? compactVoiceText(normalized.agentId || '', 120) : '';
}

export function subagentVoiceTargetLabel(target?: VoiceAgentTargetContext): string {
  const normalized = normalizeVoiceAgentTarget(target || {});
  if (normalized.kind !== 'subagent') return 'Prometheus';
  const agent = normalized.agentId ? getAgentById(normalized.agentId) : null;
  return compactVoiceText(normalized.label || agent?.name || (agent as any)?.alias || normalized.agentId || 'Subagent', 160) || 'Subagent';
}

// Recent back-and-forth of the actual chat, so the voice agent picks up the
// ongoing conversation instead of acting like a fresh session. The worker
// context packet only carries the single latest user/assistant turn plus run
// status; this gives the realtime agent the recent dialogue window.
export function buildVoiceConversationTranscript(sessionId: string, maxTurns = 24, maxCharsPerTurn = 600, target?: VoiceAgentTargetContext): string {
  try {
    const agentId = subagentVoiceTargetId(target);
    if (agentId) {
      const label = subagentVoiceTargetLabel(target);
      const session = getSession(sessionId);
      const sessionSummary = cleanVoiceCompactionSummaryText((session as any)?.latestContextSummary || '', 4000);
      const sessionHistory = Array.isArray(session?.history) ? session.history : [];
      const sourceHistory = sessionSummary && sessionHistory.length
        ? getActiveHistoryForPersistence(sessionId, Math.max(80, maxTurns * 3)).map((entry: any) => ({
          role: String(entry?.role || '') === 'assistant' || String(entry?.role || '') === 'ai' ? 'agent' : entry?.role,
          content: entry?.content || entry?.body?.text || '',
          metadata: entry?.metadata || {},
        }))
        : getSubagentChatHistory(agentId, Math.max(80, maxTurns * 3));
      const turns = sourceHistory
        .filter((msg: any) => {
          const role = String(msg?.role || '');
          if (role !== 'user' && role !== 'agent') return false;
          const text = String(msg?.content || '').trim();
          if (!text) return false;
          if (text.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX) || text.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX)) return false;
          if (String(msg?.metadata?.source || '').toLowerCase().includes('compaction')) return false;
          return true;
        })
        .slice(-maxTurns)
        .map((msg: any) => {
          const speaker = String(msg?.role || '') === 'user' ? 'User' : label;
          const text = voiceNarrationClean(msg?.content || '', maxCharsPerTurn);
          return text ? `${speaker}: ${text}` : '';
        })
        .filter(Boolean);
      return turns.join('\n');
    }
    const session = getSession(sessionId);
    const history = Array.isArray(session?.history) ? session.history : [];
    const turns = history
      .filter((msg: any) => {
        const role = String(msg?.role || '');
        if (role !== 'user' && role !== 'assistant' && role !== 'ai') return false;
        const text = String(msg?.content || msg?.body?.text || '').trim();
        if (!text) return false;
        // Skip injected rolling-compaction summaries and system-style scaffolding.
        if (text.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX) || text.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX)) return false;
        return true;
      })
      .slice(-maxTurns)
      .map((msg: any) => {
        const speaker = String(msg?.role || '') === 'user' ? 'User' : 'Prometheus';
        const text = voiceNarrationClean(msg?.content || msg?.body?.text || '', maxCharsPerTurn);
        return text ? `${speaker}: ${text}` : '';
      })
      .filter(Boolean);
    return turns.join('\n');
  } catch {
    return '';
  }
}

// The latest rolling-compaction summary for this thread. On a compacted thread
// everything before the summary boundary lives ONLY here, so voice must include
// it or the agent loses all earlier context (the "fresh chat" amnesia).
export function buildVoiceCompactionSummaryBlock(sessionId: string, maxChars = 4000, target?: VoiceAgentTargetContext): string {
  try {
    const agentId = subagentVoiceTargetId(target);
    if (agentId) {
      const session = getSession(sessionId);
      const sessionSummary = cleanVoiceCompactionSummaryText((session as any)?.latestContextSummary || '', maxChars);
      if (sessionSummary) return sessionSummary;
      const history = getSubagentChatHistory(agentId, 500);
      const latestSummaryMsg = [...history].reverse().find((msg: any) => {
        const text = String(msg?.content || '').trim();
        const source = String(msg?.metadata?.source || '').toLowerCase();
        return !!text && (
          text.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX)
          || text.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX)
          || source.includes('compaction')
          || source.includes('context_summary')
        );
      });
      return cleanVoiceCompactionSummaryText(latestSummaryMsg?.content || '', maxChars);
    }
    const session = getSession(sessionId);
    let summary = String((session as any)?.latestContextSummary || '').trim();
    return cleanVoiceCompactionSummaryText(summary, maxChars);
  } catch {
    return '';
  }
}

// Compact recent tool-result log mirroring what main chat carries, so the voice
// agent knows what was actually done (not just what was said) in this thread.
export function buildVoiceRecentToolLog(sessionId: string, maxEntries = 8, target?: VoiceAgentTargetContext): string {
  try {
    const agentId = subagentVoiceTargetId(target);
    if (agentId) {
      const lines = getSubagentChatHistory(agentId, 120)
        .filter((msg: any) => {
          if (String(msg?.role || '') !== 'agent') return false;
          const md = msg?.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
          return md.success === true || md.taskId || md.durationMs || md.stepCount || String(md.source || '').includes('dispatch');
        })
        .map((msg: any) => String(msg?.content || '').trim())
        .filter(Boolean)
        .slice(-maxEntries);
      return lines.length ? lines.map((l: string) => `- ${voiceNarrationClean(l, 420)}`).join('\n') : '';
    }
    const packet = buildVoiceWorkerContextPacket(sessionId);
    const done = Array.isArray((packet as any)?.doneAlready) ? (packet as any).doneAlready : [];
    const lines = done
      .map((entry: any) => String(entry || '').trim())
      .filter(Boolean)
      .slice(-maxEntries);
    return lines.length ? lines.map((l: string) => `- ${l}`).join('\n') : '';
  } catch {
    return '';
  }
}

export function voiceRequestTimeInput(source: Record<string, any> = {}): any {
  if (!source || typeof source !== 'object') return undefined;
  return source.deviceTime || source.device_time || source.clientTime || source.client_time;
}

export function buildVoiceWorkerContextPacket(sessionId: string, options: Record<string, any> = {}): Record<string, any> {
  const sid = String(sessionId || 'default').trim() || 'default';
  const voiceTarget = normalizeVoiceAgentTarget(options?.voiceTarget || options?.voice_target || options?.target || options || {});
  const subagentId = subagentVoiceTargetId(voiceTarget);
  const subagentLabel = subagentVoiceTargetLabel(voiceTarget);
  const voiceRoom = normalizeVoiceRoomContext(options);
  const activeRuntime = findActiveMainChatRuntimeForSession(sid, String(options.expectedRuntimeId || options.runtimeId || ''));
  const currentTime = buildVoiceTimeContext(voiceRequestTimeInput(options));
  const checkpoint = activeRuntime?.checkpoint && typeof activeRuntime.checkpoint === 'object' ? activeRuntime.checkpoint : {};
  const subagentHistory = subagentId ? getSubagentChatHistory(subagentId, 120) : [];
  const session = getSession(sid);
  const history = subagentId
    ? subagentHistory.map((entry: any) => ({
      role: entry.role === 'agent' ? 'assistant' : entry.role,
      content: entry.content,
      body: { text: entry.content },
      timestamp: entry.ts,
      metadata: entry.metadata,
    }))
    : (Array.isArray(session?.history) ? session.history : []);
  const latestUser: any = [...history].reverse().find((entry: any) => String(entry?.role || '') === 'user') || null;
  const latestAssistant: any = [...history].reverse().find((entry: any) => ['assistant', 'ai'].includes(String(entry?.role || ''))) || null;
  const stream = getMainChatStream(sid);
  const processEntries = summarizeVoiceProcessEntries(checkpoint.processEntries || [], 12);
  const recentEvents = summarizeVoiceStreamEvents(stream, 16);
  const currentGoal = compactVoiceText(
    options.originalUserPrompt
      || activeRuntime?.recoveryData?.message
      || activeRuntime?.detail
      || latestUser?.content
      || latestUser?.body?.text
      || '',
    900,
  );
  const activeToolName = compactVoiceText(checkpoint.toolName || '', 120);
  const checkpointEvent = compactVoiceText(checkpoint.event || '', 120);
  const checkpointLabel = compactVoiceText(checkpoint.message || checkpoint.result || '', 500);
  const activeToolLabel = checkpointLabel && !isVoiceContextNoiseText(checkpointLabel)
    ? (activeToolName ? summarizeVoiceToolActivity(activeToolName, checkpoint.args, checkpointEvent, checkpoint) || checkpointLabel : checkpointLabel)
    : '';
  const currentPhase = checkpointEvent && !isVoiceContextNoiseEvent(checkpointEvent) && !isVoiceContextNoiseText(checkpointEvent)
    ? checkpointEvent
    : stream?.active
      ? 'running'
      : '';
  const completed = processEntries
    .filter((entry) => entry.type === 'result' || entry.event === 'tool_result')
    .slice(-5)
    .map((entry) => entry.toolName ? `${friendlyVoiceToolName(entry.toolName)}: ${entry.content}` : entry.content)
    .filter(Boolean);
  if (subagentId && completed.length < 5) {
    const threadWork = subagentHistory
      .filter((msg: any) => String(msg?.role || '') === 'agent' && String(msg?.content || '').trim())
      .filter((msg: any) => {
        const md = msg?.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
        return md.success === true || md.taskId || md.durationMs || md.stepCount || String(md.source || '').includes('dispatch');
      })
      .map((msg: any) => voiceNarrationClean(msg.content, 260))
      .filter(Boolean)
      .slice(-(5 - completed.length));
    completed.push(...threadWork);
  }
  const displayPhase = currentPhase && currentPhase !== 'running' ? currentPhase : '';
  const displayTool = activeToolName && activeToolName !== 'skill_list' ? friendlyVoiceToolName(activeToolName) : '';
  // Historical workgroup files are intentionally not loaded into live Voice
  // context. New Voice work is represented by first-class thread supervision.
  const voiceWorkgroups: any[] = [];
  /* retired workgroup context mapper retained temporarily for migration review
  const legacyVoiceWorkgroups = subagentId ? [] : listVoiceWorkgroupsForSession(sid).slice(0, 4).map((workgroup) => {
    const workers = workgroup.workers.map((worker) => {
      const task = loadTask(worker.taskId);
      const status = String(task?.status || worker.status || 'queued');
      const runtimeItems = Array.isArray(task?.runtimeProgress?.items) ? task.runtimeProgress.items : [];
      const runtimeActiveIndex = Number(task?.runtimeProgress?.activeIndex ?? -1);
      const runtimeCurrent = runtimeItems[runtimeActiveIndex]
        || runtimeItems.find((item: any) => item?.status === 'in_progress' || item?.status === 'pending');
      const recentActivity = (Array.isArray(task?.journal) ? task.journal : [])
        .filter((entry: any) => ['tool_call', 'tool_result', 'write_note', 'error', 'pause', 'resume', 'plan_mutation'].includes(String(entry?.type || '')))
        .slice(-8)
        .map((entry: any) => ({
          at: Number(entry?.t || 0) || null,
          type: String(entry?.type || ''),
          detail: compactVoiceText(entry?.content || entry?.detail || '', 360),
        }))
        .filter((entry: any) => entry.detail);
      const currentStep = compactVoiceText(
        runtimeCurrent?.text
          || task?.plan?.[Math.max(0, Number(task.currentStepIndex || 0))]?.description
          || '',
        300,
      );
      const finalResult = status === 'complete'
        ? compactVoiceText(task?.finalSummary || '', 1800)
        : '';
      return {
        taskId: worker.taskId,
        title: task?.title || worker.title,
        status,
        currentStep,
        runtimeProgress: task?.runtimeProgress ? {
          source: task.runtimeProgress.source,
          activeIndex: runtimeActiveIndex,
          updatedAt: Number(task.runtimeProgress.updatedAt || 0) || null,
          items: runtimeItems.slice(0, 12).map((item: any) => ({
            text: compactVoiceText(item?.text || '', 240),
            status: String(item?.status || 'pending'),
          })),
        } : null,
        lastToolCall: compactVoiceText(task?.lastToolCall || '', 300),
        lastToolCallAt: Number(task?.lastToolCallAt || 0) || null,
        lastProgressAt: Number(task?.lastProgressAt || 0) || null,
        progressAgeMs: task?.lastProgressAt ? Math.max(0, Date.now() - Number(task.lastProgressAt)) : null,
        recentActivity,
        finalResult,
        // Backward-compatible alias for clients that already read this field.
        finalSummary: finalResult,
      };
    });
    const activeWorkers = workers.filter((worker) => !['complete', 'failed'].includes(worker.status));
    const completedWorkers = workers.filter((worker) => worker.status === 'complete');
    const failedWorkers = workers.filter((worker) => worker.status === 'failed');
    const status = activeWorkers.length > 0
      ? 'running'
      : failedWorkers.length > 0 && completedWorkers.length > 0
        ? 'partially_complete'
        : failedWorkers.length > 0
          ? 'failed'
          : completedWorkers.length === workers.length && workers.length > 0
            ? 'complete'
            : workgroup.status;
    return {
      id: workgroup.id,
      status,
      workerCount: workers.length,
      activeCount: activeWorkers.length,
      completedCount: completedWorkers.length,
      failedCount: failedWorkers.length,
      delivery: workgroup.delivery,
      mode: workgroup.mode,
      workers,
    };
  }); */
  const activeVoiceWorkgroups = voiceWorkgroups.filter((workgroup) => !['complete', 'failed'].includes(workgroup.status));
  const completedWorkerResults = voiceWorkgroups.flatMap((workgroup: any) => workgroup.workers
    .filter((worker: any) => worker.status === 'complete' && worker.finalResult)
    .map((worker: any) => ({
      workgroupId: workgroup.id,
      taskId: worker.taskId,
      title: worker.title,
      result: worker.finalResult,
    })));
  const voiceWorkgroupLines = voiceWorkgroups.slice(0, 2).map((workgroup: any) => {
    const workerBits = workgroup.workers.slice(0, 5)
      .map((worker: any) => {
        const latestActivity = worker.recentActivity[worker.recentActivity.length - 1]?.detail || worker.lastToolCall;
        const detail = latestActivity || worker.currentStep;
        return `${worker.title} (${worker.status}${detail ? `: ${compactVoiceText(detail, 160)}` : ''})`;
      })
      .join('; ');
    return `Voice workgroup ${workgroup.id}: ${workgroup.status}; ${workgroup.completedCount}/${workgroup.workerCount} complete${workerBits ? `; ${workerBits}` : ''}`;
  }).filter(Boolean);
  const effectiveCurrentGoal = currentGoal || (activeVoiceWorkgroups[0]?.workers || [])
    .map((worker: any) => worker.title)
    .filter(Boolean)
    .slice(0, 3)
    .join('; ');
  const recentSummaryLines = [
    subagentId ? `Voice target: ${subagentLabel} subagent` : '',
    effectiveCurrentGoal ? `Goal: ${effectiveCurrentGoal}` : '',
    displayPhase ? `Current phase: ${displayPhase}` : '',
    displayTool ? `Active step: ${displayTool}` : '',
    activeToolLabel ? `Latest update: ${activeToolLabel}` : '',
    completed.length ? `Recent completed work: ${completed.join(' | ')}` : '',
    completedWorkerResults.length ? `Completed worker results: ${completedWorkerResults.map((entry) => `${entry.title}: ${compactVoiceText(entry.result, 700)}`).join(' | ')}` : '',
    voiceWorkgroupLines.length ? `Voice-dispatched workers: ${voiceWorkgroupLines.join(' | ')}` : '',
  ].filter(Boolean);
  const active = !!activeRuntime || activeVoiceWorkgroups.length > 0;
  return {
    id: `voice_ctx_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    sessionId: sid,
    target: subagentId ? { kind: 'subagent', agentId: subagentId, label: subagentLabel } : { kind: 'main', label: 'Prometheus' },
    active,
    activeRun: activeRuntime ? summarizeMobileRuntime(activeRuntime) : null,
    trigger: activeRuntime ? {
      source: compactVoiceText(activeRuntime.source || '', 120),
      detail: compactVoiceText(activeRuntime.detail || activeRuntime.recoveryData?.message || '', 900),
      taskId: activeRuntime.taskId ? String(activeRuntime.taskId) : '',
      teamId: activeRuntime.teamId ? String(activeRuntime.teamId) : '',
      agentId: activeRuntime.agentId ? String(activeRuntime.agentId) : '',
      scheduleId: activeRuntime.scheduleId ? String(activeRuntime.scheduleId) : '',
      startedAt: Number(activeRuntime.startedAt || 0) || null,
    } : activeVoiceWorkgroups[0] ? {
      source: 'voice_workgroup',
      detail: effectiveCurrentGoal,
      workgroupId: activeVoiceWorkgroups[0].id,
      startedAt: null,
    } : null,
    currentGoal: effectiveCurrentGoal,
    currentPhase: displayPhase || (activeVoiceWorkgroups.length ? 'running_voice_workgroup' : ''),
    activeToolName: displayTool,
    activeToolLabel: activeToolLabel || (activeVoiceWorkgroups.length ? `${activeVoiceWorkgroups.length} voice workgroup${activeVoiceWorkgroups.length === 1 ? '' : 's'} active` : ''),
    pendingSteerCount: Number(checkpoint.pendingSteerCount || 0) || 0,
    lastSteer: checkpoint.lastSteer || null,
    lastVoiceInterruption: checkpoint.voiceInterruptionEvent || null,
    latestUser: latestUser ? compactVoiceText(latestUser.content || latestUser.body?.text || '', 700) : '',
    latestAssistant: latestAssistant ? compactVoiceText(latestAssistant.content || latestAssistant.body?.text || '', 700) : '',
    thread: subagentId ? {
      kind: 'subagent',
      agentId: subagentId,
      label: subagentLabel,
      messageCount: subagentHistory.length,
      compactionSummary: buildVoiceCompactionSummaryBlock(sid, 1200, voiceTarget),
      recentTranscript: buildVoiceConversationTranscript(sid, 8, 360, voiceTarget),
    } : undefined,
    voiceRoom: voiceRoom || undefined,
    time: currentTime,
    currentTime,
    processEntries,
    recentEvents,
    observations: summarizeVoiceObservation(sid),
    voiceWorkgroups,
    completedWorkerResults,
    doneAlready: [
      ...completed,
      ...completedWorkerResults.map((entry) => `${entry.title}: ${entry.result}`),
      ...voiceWorkgroupLines,
    ],
    currentlyDoing: activeToolLabel || displayTool || displayPhase || voiceWorkgroupLines[0] || '',
    summary: recentSummaryLines.join('\n'),
  };
}

export function getReusableVoiceContextPacket(sessionId: string, body: Record<string, any>, activeRuntime: any): Record<string, any> {
  const provided = body?.contextPacket;
  const sid = String(sessionId || 'default').trim() || 'default';
  if (provided && typeof provided === 'object') {
    const packetSessionId = String(provided.sessionId || '').trim();
    const packetAgeMs = Date.now() - Number(provided.createdAt || 0);
    const expectedRuntimeId = String(body.expectedRuntimeId || body.runtimeId || body.activeRunId || activeRuntime?.id || '').trim();
    const packetRuntimeId = String(provided.activeRun?.id || '').trim();
    const packetMatchesRuntime = expectedRuntimeId ? packetRuntimeId === expectedRuntimeId : true;
    if (
      packetSessionId === sid
      && Number.isFinite(packetAgeMs)
      && packetAgeMs >= 0
      && packetAgeMs <= 10_000
      && packetMatchesRuntime
    ) {
      const freshTime = buildVoiceTimeContext(voiceRequestTimeInput(body));
      if (freshTime.exactLocalTimeAvailable === true || !provided.currentTime) {
        provided.currentTime = freshTime;
        provided.time = freshTime;
      }
      const voiceRoom = normalizeVoiceRoomContext(body);
      if (voiceRoom) provided.voiceRoom = voiceRoom;
      return provided;
    }
  }
  return buildVoiceWorkerContextPacket(sid, {
    ...body,
    expectedRuntimeId: activeRuntime?.id || body.expectedRuntimeId || body.runtimeId || body.activeRunId,
    originalUserPrompt: body.originalUserPrompt,
  });
}

export type VoiceAgentContextBlockCacheEntry = {
  sessionId: string;
  workspacePath: string;
  historyLength: number;
  targetKey: string;
  requestHash: string;
  contextBlock: string;
  createdAt: number;
};

export const VOICE_AGENT_CONTEXT_BLOCK_TTL_MS = 30_000;
export const voiceAgentContextBlockCache = new Map<string, VoiceAgentContextBlockCacheEntry>();
export const voiceAgentContextBlockPending = new Map<string, Promise<VoiceAgentContextBlockCacheEntry>>();

export function getVoiceAgentContextBlockCacheKey(sessionId: string, voiceTarget?: VoiceAgentTargetContext): string {
  const sid = String(sessionId || 'default').trim() || 'default';
  const target = normalizeVoiceAgentTarget(voiceTarget || {});
  if (target.kind === 'subagent') {
    return `${sid}::subagent:${compactVoiceText(target.agentId || target.label || 'unknown', 160) || 'unknown'}`;
  }
  return `${sid}::main`;
}

export function invalidateVoiceAgentContextBlockCache(sessionId?: string): void {
  const sid = String(sessionId || '').trim();
  if (sid) {
    const prefix = `${sid}::`;
    for (const key of Array.from(voiceAgentContextBlockCache.keys())) {
      if (key === sid || key.startsWith(prefix)) voiceAgentContextBlockCache.delete(key);
    }
    for (const key of Array.from(voiceAgentContextBlockPending.keys())) {
      if (key === sid || key.startsWith(prefix)) voiceAgentContextBlockPending.delete(key);
    }
    return;
  }
  voiceAgentContextBlockCache.clear();
  voiceAgentContextBlockPending.clear();
}

export async function getVoiceAgentContextBlock(sessionId: string, transcript: string, options: Record<string, any> = {}): Promise<{ contextBlock: string; elapsedMs: number; cacheHit: boolean }> {
  const voiceTarget = normalizeVoiceAgentTarget(options?.voiceTarget || options?.voice_target || options?.target || {});
  const sid = String(sessionId || 'default').trim() || 'default';
  const cacheKey = getVoiceAgentContextBlockCacheKey(sid, voiceTarget);
  const startedAt = Date.now();
  const workspacePath = getConfig().getWorkspacePath();
  const session = getSession(sid);
  const targetAgentId = subagentVoiceTargetId(voiceTarget);
  const history = targetAgentId ? getSubagentChatHistory(targetAgentId, 500) : (Array.isArray(session?.history) ? session.history : []);
  const historyLength = history.length;
  const targetKey = voiceTarget.kind === 'subagent' ? `subagent:${voiceTarget.agentId || voiceTarget.label || 'unknown'}` : 'main';
  const requestHash = voiceContextRequestHash(transcript);
  const contextRequest = { workspacePath, historyLength, targetKey, requestHash };
  const cached = voiceAgentContextBlockCache.get(cacheKey);
  const ageMs = cached ? Date.now() - Number(cached.createdAt || 0) : Number.POSITIVE_INFINITY;
  if (
    cached
    && voiceContextEntryMatches(cached, contextRequest)
    && Number.isFinite(ageMs)
    && ageMs >= 0
    && ageMs <= VOICE_AGENT_CONTEXT_BLOCK_TTL_MS
  ) {
    return { contextBlock: cached.contextBlock, elapsedMs: Date.now() - startedAt, cacheHit: true };
  }

  const pending = voiceAgentContextBlockPending.get(cacheKey);
  if (pending) {
    const entry = await pending;
    if (voiceContextEntryMatches(entry, contextRequest)) {
      return { contextBlock: entry.contextBlock, elapsedMs: Date.now() - startedAt, cacheHit: true };
    }
  }

  const buildPromise = (async (): Promise<VoiceAgentContextBlockCacheEntry> => {
    const baseContextBlock = await buildPersonalityContext(
      sid,
      workspacePath,
      transcript,
      'interactive',
      historyLength,
      _skillsManager,
      undefined,
      { profile: targetAgentId ? 'direct_subagent' : 'voice_agent' },
    );
    const contextBlock = applyVoiceTargetContextBlock(baseContextBlock, voiceTarget);
    const entry = { sessionId: sid, workspacePath, historyLength, targetKey, requestHash, contextBlock, createdAt: Date.now() };
    voiceAgentContextBlockCache.set(cacheKey, entry);
    return entry;
  })();
  voiceAgentContextBlockPending.set(cacheKey, buildPromise);
  try {
    const entry = await buildPromise;
    return { contextBlock: entry.contextBlock, elapsedMs: Date.now() - startedAt, cacheHit: false };
  } finally {
    if (voiceAgentContextBlockPending.get(cacheKey) === buildPromise) voiceAgentContextBlockPending.delete(cacheKey);
  }
}

export function prewarmVoiceAgentContextBlock(sessionId: string, transcript: string, options: Record<string, any> = {}): void {
  getVoiceAgentContextBlock(sessionId, transcript, options).catch((err) => {
    if (options.log !== false) console.warn('[voice-agent] context prewarm failed:', err?.message || err);
  });
}
