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
  wss as _wssRef, setWss,
  broadcastWS,
  broadcastTeamEvent,
  addTeamSseClient,
  removeTeamSseClient,
  sendTeamNotificationToChannels,
  sendDiscordNotification,
  sendWhatsAppNotification,
  resolveChannelsConfig,
  setTelegramChannelForBroadcaster,
  isModelBusy, setModelBusy,
  getLastMainSessionId, setLastMainSessionId,
  setSessionChannelHint,
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type ChannelsConfig,
  normalizeTelegramConfig,
  normalizeDiscordConfig,
  normalizeWhatsAppConfig,
  isGatewayDraining,
} from '../../../comms/broadcaster';
import { classifyVoiceInterruption, VoiceInterruptionIntent } from './narrator';
import { VoiceAgentAction, compactVoiceText, friendlyVoiceToolName } from './context';
import { parseVoiceToolResult } from './fallback';
import { normalizeVoiceAgentWrapperTool, voiceRuntimeDirectiveFromToolResult } from './tool-helpers';
import { executeVoiceAgentTool } from './tool-executor';


export function isVoiceStatusQuestion(text: string): boolean {
  const value = String(text || '').toLowerCase();
  return /\b(what are you doing|what're you doing|what is happening|what's happening|status|where are we|where are you|what step|what stage|what did you do|what have you done|what do you see|what are you seeing|what's on screen|what is on screen)\b/.test(value);
}

export function isVoiceWakeOrSmallTalk(text: string): boolean {
  const value = String(text || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (/^(hey|hi|hello|yo|ok|okay)?\s*prometheus$/.test(value)) return true;
  if (/^(hey|hi|hello|yo)\s+prometheus\s+(are you there|you there|can you hear me|hello|hi|hey)?$/.test(value)) return true;
  if (/^(hey|hi|hello|yo|good morning|good afternoon|good evening|what's up|whats up|what is up|sup|you there|are you there|can you hear me|testing|test)$/.test(value)) return true;
  if (/^(?:hey\s+)?prometheus\s+(?:how(?:'s|s| is)\s+it\s+going|how\s+are\s+you|what's\s+up|whats\s+up|what\s+is\s+up)$/.test(value)) return true;
  if (/^(?:it'?s\s+)?(?:going\s+)?(?:pretty\s+)?(?:good|great|well|okay|ok|fine)(?:\s+so\s+far)?(?:\s+everything\s+(?:is\s+)?good)?$/.test(value)) return true;
  if (/^(thanks|thank you|cool|awesome|nice|perfect|great|sounds good|got it|okay|ok)$/.test(value)) return true;
  if (/^(what can you do|what do you do|who are you|what are you|tell me what you can do|help)$/.test(value)) return true;
  return false;
}

export function deterministicVoiceSmallTalkReply(transcript: string, contextPacket: Record<string, any>): string {
  const value = String(transcript || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value || !isVoiceWakeOrSmallTalk(value)) return '';
  if (/\b(can you hear me|are you there|you there|testing|test)\b/.test(value)) {
    return 'I can hear you. Voice mode is working.';
  }
  if (/\b(what can you do|what do you do|who are you|what are you|help)\b/.test(value)) {
    return 'I can answer quickly here, steer active work, or hand bigger tasks to Prometheus.';
  }
  if (/\b(thanks|thank you)\b/.test(value)) return 'Anytime.';
  if (/\b(cool|awesome|nice|perfect|great|sounds good|got it|okay|ok)\b/.test(value)) return 'Sounds good.';
  if (/\b(how are you|how is it going|how s it going|how's it going|what's up|whats up|what is up|sup)\b/.test(value)) {
    return contextPacket?.active
      ? 'Going well. I am keeping the current run moving.'
      : 'Going strong, keeping projects moving. Whatâ€™s up with you?';
  }
  if (/^(?:it'?s\s+)?(?:going\s+)?(?:pretty\s+)?(?:good|great|well|okay|ok|fine)/.test(value)) {
    return 'Glad itâ€™s going well. Anything you want to tweak or dig into next?';
  }
  return contextPacket?.active ? 'Iâ€™m here, and the current run is still in view.' : 'Iâ€™m here.';
}

export function isVoiceWorkerRequest(text: string): boolean {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (value.length < 10 && !/\b(open|make|build|create|search|find|check|fix|run|send|write|edit|look up)\b/.test(value)) return false;
  if (/\b(can you hear me|are you there|what's up|whats up|what is up|how are you|thank you|thanks|what can you do|what do you do|who are you|what are you)\b/.test(value)) return false;
  return /\b(open|make|build|create|generate|write|edit|update|change|fix|debug|test|run|execute|install|start|stop|restart|search|find|look up|research|analyze|inspect|check|review|read|summarize|compare|calculate|schedule|remind|send|email|message|post|tweet|download|upload|move|copy|delete|save|export|render|record|capture|screenshot|browse|click|type|fill|go to|navigate|use|turn on|turn off|set up)\b/.test(value);
}

export function decideVoiceAgentAction(transcript: string, classification: ReturnType<typeof classifyVoiceInterruption>, contextPacket: Record<string, any>): VoiceAgentAction {
  const text = String(transcript || '').trim();
  if (!text) return 'no_reply';
  if (isVoiceWakeOrSmallTalk(text)) return 'answer_now';
  if (classification.shouldAbortOriginalRun) return 'interrupt_worker';
  if (classification.shouldPauseOriginalRun) return 'answer_now';
  if (!contextPacket.active) {
    return isVoiceWorkerRequest(text) ? 'handoff_new_work' : 'answer_now';
  }
  if (classification.intent === 'continue') return 'no_reply';
  if (classification.intent === 'question' || isVoiceStatusQuestion(text)) return 'answer_now';
  if (classification.intent === 'unknown') return 'answer_now';
  return 'steer_worker';
}

export function voiceSteerKindFromIntent(intent: VoiceInterruptionIntent): RuntimeSteerEvent['kind'] {
  if (intent === 'course_correction') return 'correction';
  if (intent === 'question') return 'question';
  if (intent === 'cancel') return 'cancel';
  if (intent === 'pause') return 'pause';
  if (intent === 'continue') return 'continue';
  if (intent === 'clarification') return 'clarification';
  return 'unknown';
}

export function normalizeVoiceCommandText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function exactActiveWorkerVoiceCommand(value: string): '' | 'stop' | 'pause' | 'status' {
  const text = normalizeVoiceCommandText(value);
  if (!text) return '';
  if (/^(?:stop|cancel|abort|kill|stop task|stop this|stop this task|stop the task|stop working|nevermind|never mind|forget it|scratch that)$/.test(text)) return 'stop';
  if (/^(?:pause|wait|hold on|wait a second|wait a sec|give me a second|give me a sec)$/.test(text)) return 'pause';
  if (/^(?:status|what is the status|what's the status|whats the status|what are you doing|what is it doing|what's it doing|whats it doing|what do you see|what are you seeing)$/.test(text)) return 'status';
  return '';
}

export function buildVoiceContextSummaryForSteer(contextPacket: Record<string, any>): string {
  return [
    contextPacket.currentGoal ? `Goal: ${compactVoiceText(contextPacket.currentGoal, 500)}` : '',
    contextPacket.currentPhase ? `Phase: ${compactVoiceText(contextPacket.currentPhase, 100)}` : '',
    contextPacket.activeToolName ? `Active tool: ${compactVoiceText(contextPacket.activeToolName, 100)}` : '',
    contextPacket.activeToolLabel ? `Latest update: ${compactVoiceText(contextPacket.activeToolLabel, 300)}` : '',
    Array.isArray(contextPacket.processEntries) && contextPacket.processEntries.length
      ? `Recent process: ${contextPacket.processEntries.slice(-4).map((entry: any) => compactVoiceText(entry.content || entry.toolName || entry.event || '', 180)).filter(Boolean).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n');
}

export type VoiceAgentDecision = {
  action: VoiceAgentAction;
  spokenReply: string;
  workerInstruction?: string;
  needsWorkerResponse?: boolean;
  reason?: string;
  runtimeDirectives?: Array<Record<string, any>>;
  richArtifacts?: any[];
};

export type VoiceAgentProcessEntry = {
  ts: string;
  type: string;
  content: string;
  actor?: string;
  extra?: Record<string, any>;
};

export function pushVoiceAgentProcessEntry(trace: VoiceAgentProcessEntry[] | undefined, type: string, content: string, extra: Record<string, any> = {}): void {
  if (!Array.isArray(trace)) return;
  const text = compactVoiceText(content, 900);
  if (!text) return;
  const actor = type === 'user' ? 'User' : 'Voice Agent';
  const entry: VoiceAgentProcessEntry = {
    ts: new Date().toLocaleTimeString(),
    type,
    content: text,
    actor,
    extra: { actor, source: type === 'user' ? 'user_voice' : 'voice_agent', ...extra },
  };
  const prev = trace[trace.length - 1];
  if (prev && prev.type === entry.type && prev.content === entry.content) return;
  trace.push(entry);
}

export function voiceAgentToolResultSummary(raw: string): { ok: boolean; summary: string } {
  const parsed = parseVoiceToolResult(raw);
  const ok = parsed?.ok !== false;
  const summary = compactVoiceText(parsed?.summary || parsed?.stdout || parsed?.text || parsed?.error || raw, 500);
  return { ok, summary };
}

export function broadcastVoiceAgentToolEvent(sessionId: string, event: 'tool_call' | 'tool_result', data: Record<string, any>): void {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  broadcastWS({
    type: 'voice_agent_tool_event',
    sessionId: sid,
    event,
    data: {
      actor: 'Voice Agent',
      source: 'voice_agent',
      ...data,
    },
    at: Date.now(),
  });
}

// Last voice-agent screenshot preview per session. The realtime-tool HTTP endpoint
// reads this so the mobile orb can overlay the capture directly from the response it
// already awaits â€” independent of the broadcastWS relay reaching the mobile client.
export const lastVoiceScreenshotPreview = new Map<string, { dataUrl: string; mimeType: string; width?: number; height?: number; source: string; tool: string; at: number; emittedAt?: number }>();

export function takeLastVoiceScreenshotPreview(sessionId: string, expectedTool = ''): { dataUrl: string; mimeType: string; width?: number; height?: number; source: string } | null {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const entry = lastVoiceScreenshotPreview.get(sid);
  if (!entry) return null;
  lastVoiceScreenshotPreview.delete(sid);
  if (expectedTool && entry.tool !== String(expectedTool || '').trim()) return null;
  // Ignore stale captures (>30s) that weren't from this tool call.
  if (Date.now() - entry.at > 30_000) return null;
  const { dataUrl, mimeType, width, height, source } = entry;
  return { dataUrl, mimeType, width, height, source };
}

export function broadcastVoiceScreenshotPreview(
  sessionId: string,
  source: 'browser' | 'desktop',
  tool: string,
  shot: { base64?: string; mimeType?: string; width?: number; height?: number } | null | undefined,
): void {
  const sid = String(sessionId || '').trim();
  const base64 = String(shot?.base64 || '').trim();
  if (!sid || !base64) return;
  const mimeType = String(shot?.mimeType || 'image/png').trim() || 'image/png';
  lastVoiceScreenshotPreview.set(sid, {
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    width: Number(shot?.width || 0) || undefined,
    height: Number(shot?.height || 0) || undefined,
    source,
    tool: String(tool || '').trim(),
    at: Date.now(),
  });
}

export function emitLastVoiceScreenshotPreview(sessionId: string, tool: string): void {
  const sid = String(sessionId || '').trim();
  const entry = lastVoiceScreenshotPreview.get(sid);
  const action = String(tool || '').trim();
  if (!sid || !entry || entry.emittedAt || entry.tool !== action || Date.now() - entry.at > 30_000) return;
  entry.emittedAt = Date.now();
  broadcastWS({
    type: 'vision_injected',
    sessionId: sid,
    source: entry.source,
    tool: action,
    preview: {
      dataUrl: entry.dataUrl,
      mimeType: entry.mimeType,
      width: entry.width,
      height: entry.height,
    },
    timestamp: Date.now(),
  });
}

/**
 * Realtime voice is vision-first, just like the canonical desktop wrappers.
 * OCR is an explicit opt-in because the OCR child process has a 15s timeout and
 * a screenshot already arrives as an image for the realtime model.
 */
export function voiceDesktopSkipOcr(args: Record<string, any> = {}): boolean {
  return !(
    args.ocr === true
    || args.include_ocr === true
    || args.includeOcr === true
    || args.skip_ocr === false
    || args.skipOcr === false
  );
}

/** Match the worker wrapper contract: post-action captures are opt-in. */
export function voiceDesktopCaptureAfter(args: Record<string, any> = {}): boolean {
  return args.capture_after === true
    || args.captureAfter === true
    || args.include_screenshot === true
    || args.includeScreenshot === true;
}

export async function executeVoiceAgentToolWithTrace(sessionId: string, name: string, args: Record<string, any>, trace?: VoiceAgentProcessEntry[]): Promise<string> {
  const requestedAction = String(name || '').trim();
  const requestedArgs = args && typeof args === 'object' ? args : {};
  const normalized = normalizeVoiceAgentWrapperTool(requestedAction, requestedArgs);
  const action = normalized.name;
  const cleanArgs = normalized.args && typeof normalized.args === 'object' ? normalized.args : {};
  broadcastVoiceAgentToolEvent(sessionId, 'tool_call', { action, args: cleanArgs });
  pushVoiceAgentProcessEntry(trace, action.startsWith('voice_skill_') || action.startsWith('skill_') ? 'skill' : 'tool', `Using ${friendlyVoiceToolName(action)}...`, { action, args: cleanArgs });
  const startedAt = Date.now();
  const raw = await executeVoiceAgentTool(sessionId, action, cleanArgs);
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const summary = voiceAgentToolResultSummary(raw);
  broadcastVoiceAgentToolEvent(sessionId, 'tool_result', {
    action,
    result: summary.summary,
    error: !summary.ok,
    elapsedMs,
  });
  // Captures are staged while the tool runs, then emitted only after its result
  // so every client receives tool -> result -> screenshot in the tool stream.
  emitLastVoiceScreenshotPreview(sessionId, action);
  const parsedResult = parseVoiceToolResult(raw);
  const runtimeDirective = voiceRuntimeDirectiveFromToolResult(parsedResult);
  pushVoiceAgentProcessEntry(trace, summary.ok ? 'result' : 'error', `${friendlyVoiceToolName(action)} ${summary.ok ? 'complete' : 'failed'}${summary.summary ? ` => ${summary.summary}` : ''}`, { action, result: summary.summary, error: !summary.ok, elapsedMs, ...(runtimeDirective ? { runtimeDirective } : {}) });
  return raw;
}
