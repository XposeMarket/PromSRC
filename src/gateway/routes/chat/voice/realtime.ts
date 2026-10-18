import type { Router, RequestHandler } from 'express';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../../config/config';
import {
  buildCodexCloudflareHeaders,
  getValidToken as getOpenAiCodexToken,
  loadTokens as loadOpenAiCodexTokens,
  refreshTokens as refreshOpenAiCodexTokens,
} from '../../../../auth/openai-oauth.js';
import { VoiceAgentTargetContext, normalizeVoiceAgentTarget, voiceAgentTargetIdentity, loadVoiceAgentMemoryForTarget, voiceAgentWorkerHandoffSessions, findActiveMainChatRuntimeForSession, compactVoiceText, summarizeUnlockedToolCategories, buildVoiceConversationTranscript, buildVoiceCompactionSummaryBlock, buildVoiceRecentToolLog, buildVoiceWorkerContextPacket, getReusableVoiceContextPacket, getVoiceAgentContextBlock } from './context';
import { buildVoiceToolDefinitions } from './tool-definitions';
import { buildVoicePrometheusToolsDefinition, VOICE_TOOLS_SUPERSEDED_BY_CORE, voiceCoreToolSurface, toRealtimeFunctionTool, voiceCoreSurfaceSignature } from './core-tools';
import { buildVoiceTimeContext, buildRealtimeSkillContextForTranscript, voiceRuntimeDirectiveFromToolResult, parseVoiceToolArgs, cleanVoiceWakePhrase } from './tool-helpers';
import { assertSafeStorageId, isStorageBoundaryError } from '../../../storage/storage-paths.js';
import { parseVoiceToolResult, voiceRuntimeContextText } from './fallback';
import crypto from 'crypto';
import { getCustomVoiceProvider } from '../../../voice/voice-provider-registry';
import { router, storageAwareStatus } from './dependencies';


// ============================================================================
// REALTIME VOICE AGENT â€” full audio-in / audio-out via OpenAI Realtime API.
// When voice mode is "openai_realtime" end-to-end, the browser opens a single
// Realtime session whose system instructions and function tools come from
// this bootstrap. The reasoning model is gpt-realtime (not the primary). All
// voice_* and skill_* tools route through /api/voice-agent/realtime-tool, and worker
// handoff/steer/interrupt are signalled as function calls back to the browser.
// ============================================================================

export const REALTIME_AGENT_CLIENT_SECRETS_ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';
export const DEFAULT_REALTIME_AGENT_MODEL = 'gpt-realtime-2';
export const DEFAULT_REALTIME_AGENT_VOICE = 'marin';
export const DEFAULT_REALTIME_AGENT_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';
export const PUBLIC_REALTIME_AGENT_VOICE_IDS = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);
export const REALTIME_AGENT_INSTRUCTIONS_MAX = Math.max(4000, Number(process.env.OPENAI_REALTIME_INSTRUCTIONS_MAX_CHARS) || 36000);
export const realtimeAgentCallTokens = new Map<string, {
  clientSecret: string;
  sourceToken: string;
  provider?: string;
  baseUrl?: string;
  auth: RealtimeAgentAuthCandidate['auth'];
  model: string;
  createdAt: number;
  expiresAt: number;
}>();

export function getRealtimeAgentApiKey(): string {
  const cfg = getConfig().getConfig() as any;
  const providers = cfg?.llm?.providers && typeof cfg.llm.providers === 'object' ? cfg.llm.providers : {};
  const openAiKey = typeof providers?.openai?.api_key === 'string'
    ? String(getConfig().resolveSecret(providers.openai.api_key) || '').trim()
    : '';
  return String(
    process.env.OPENAI_REALTIME_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.VOICE_TOOLS_OPENAI_KEY
    || openAiKey
    || ''
  ).trim();
}

export type RealtimeAgentAuthCandidate = { token: string; auth: 'api_key' | 'openai_codex_oauth_api_key' | 'openai_codex_oauth' };

export function getJwtExpiryMs(token: string): number {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    const exp = Number(payload?.exp || 0);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export async function loadRealtimeAgentOpenAiCodexTokens(configDir: string) {
  let tokens = loadOpenAiCodexTokens(configDir);
  if (!tokens) return null;
  const hasApiKey = !!String(tokens.api_key || '').trim();
  const idTokenExpiryMs = getJwtExpiryMs(String(tokens.id_token || ''));
  const idTokenExpired = !idTokenExpiryMs || Date.now() > idTokenExpiryMs - 60_000;
  if (!hasApiKey && idTokenExpired) {
    try {
      tokens = await refreshOpenAiCodexTokens(configDir);
      console.log('[voice-agent-realtime] refreshed Codex OAuth for realtime auth', {
        hasExchangedApiKey: !!String(tokens?.api_key || '').trim(),
      });
    } catch (err: any) {
      console.warn('[voice-agent-realtime] Codex OAuth refresh for realtime auth failed', {
        message: String(err?.message || err || ''),
      });
    }
  }
  return loadOpenAiCodexTokens(configDir) || tokens;
}

// Resolve every usable OpenAI credential for the Realtime client_secret mint, in
// priority order. This mirrors realtime.router's getRealtimeAuthCandidates so the
// end-to-end agent authenticates the same way regular OpenAI STT/TTS (and Codex
// OAuth image gen) does â€” a raw API key OR the connected Codex OAuth account.
export async function getRealtimeAgentAuthCandidates(): Promise<RealtimeAgentAuthCandidate[]> {
  const candidates: RealtimeAgentAuthCandidate[] = [];
  const seen = new Set<string>();
  const push = (token: string, auth: RealtimeAgentAuthCandidate['auth']) => {
    const value = String(token || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push({ token: value, auth });
  };
  const apiKey = getRealtimeAgentApiKey();
  push(apiKey, 'api_key');

  try {
    const configDir = getConfig().getConfigDir();
    if (loadOpenAiCodexTokens(configDir) !== null) {
      const tokens = await loadRealtimeAgentOpenAiCodexTokens(configDir);
      push(String(tokens?.api_key || '').trim(), 'openai_codex_oauth_api_key');
      const token = await getOpenAiCodexToken(configDir);
      push(token, 'openai_codex_oauth');
    }
  } catch {
    // Fall through â€” the caller reports when no usable auth was found.
  }

  return candidates;
}

export function sanitizeRealtimeAgentVoice(value: unknown): string {
  const voice = String(value || DEFAULT_REALTIME_AGENT_VOICE).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(voice) ? voice : DEFAULT_REALTIME_AGENT_VOICE;
}

export function sanitizePublicRealtimeAgentVoice(value: unknown): string {
  const voice = sanitizeRealtimeAgentVoice(value).toLowerCase();
  return PUBLIC_REALTIME_AGENT_VOICE_IDS.has(voice) ? voice : DEFAULT_REALTIME_AGENT_VOICE;
}

export function sanitizeRealtimeAgentModel(value: unknown): string {
  const model = String(value || DEFAULT_REALTIME_AGENT_MODEL).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(model) ? model : DEFAULT_REALTIME_AGENT_MODEL;
}

export function sanitizeRealtimeAgentSpeed(value: unknown): number {
  const speed = Number(value || 1);
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.25, Math.min(1.5, Math.round(speed * 100) / 100));
}

export function clampRealtimeInstructions(value: string, max = REALTIME_AGENT_INSTRUCTIONS_MAX): string {
  const text = String(value || '').trim();
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 18)).trimEnd()}\n...[truncated]`;
}


/** Budget disposable sections before touching personal context or continuity. */
export function budgetRealtimeInstructions(value: string, max = REALTIME_AGENT_INSTRUCTIONS_MAX): string {
  let text = String(value || '').trim();
  const trimSection = (start: string, end: string) => {
    if (text.length <= max) return;
    const from = text.indexOf(start);
    if (from < 0) return;
    const next = end ? text.indexOf(end, from + start.length) : -1;
    const to = next < 0 ? text.length : next;
    const remove = Math.min(to - from, text.length - max);
    text = text.slice(0, to - remove) + text.slice(to);
  };
  trimSection('## Worker context packet', '## Current time');
  trimSection('## When to call which tool', '## End tool-routing guidance');
  trimSection('### Recent messages', '### End recent messages');
  trimSection('## Shared Voice Room transcript', '## End shared voice room transcript');
  if (text.length <= max) return text;
  // Fail explicitly rather than silently losing identity, personal memory, skills,
  // or continuity when the caller supplies more protected text than the cap.
  throw new Error(`Realtime personal context and continuity exceed the ${max}-character instruction budget. Increase OPENAI_REALTIME_INSTRUCTIONS_MAX_CHARS.`);
}

// Convert the chat-completions style Voice definitions to Realtime format. The
// canonical voice_thread_ops tool is intentionally included in this set so the
// realtime coordinator creates first-class Prometheus threads directly rather
// than delegating through a separate worker-group transport.
export function buildRealtimeVoiceAgentTools(voiceTarget?: VoiceAgentTargetContext, voiceRoom?: Record<string, any> | null, sessionId = ''): any[] {
  const identity = voiceAgentTargetIdentity(voiceTarget);
  const withCore = !identity.isSubagent && !!sessionId;
  const chatTools = buildVoiceToolDefinitions().filter((tool: any) => {
    const name = String(tool?.function?.name || tool?.name || '');
    if (identity.isSubagent && name === 'voice_thread_ops') return false;
    return !(withCore && VOICE_TOOLS_SUPERSEDED_BY_CORE.has(name));
  });
  const realtimeTools: any[] = chatTools.map((tool: any) => ({
    type: 'function',
    name: tool.function?.name || tool.name,
    description: tool.function?.description || tool.description,
    parameters: tool.function?.parameters || tool.parameters,
  }));
  if (withCore) {
    const taken = new Set(realtimeTools.map((tool: any) => tool.name));
    for (const tool of voiceCoreToolSurface(sessionId)) {
      const realtimeTool = toRealtimeFunctionTool(tool);
      if (realtimeTool.name && !taken.has(realtimeTool.name)) {
        taken.add(realtimeTool.name);
        realtimeTools.push(realtimeTool);
      }
    }
  }
  if (!identity.isSubagent) {
    realtimeTools.push(buildVoicePrometheusToolsDefinition());
    realtimeTools.push({
      type: 'function',
      name: 'restart_gateway_quick',
      description: 'Quickly restart the Prometheus gateway directly from voice without creating a thread and without running npm build. First speak a short acknowledgement such as "All right, restarting the gateway now." Then call this function. The connection will close during restart; after the replacement gateway is healthy, the normal hot-restart notification will confirm success aloud.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short user-facing reason for the restart.' },
        },
        additionalProperties: false,
      },
    });
    realtimeTools.push({
      type: 'function',
      name: 'steer_active_worker',
      description: 'Steer an active Prometheus worker run mid-execution. Use ONLY when the worker context shows a worker is currently active and the user is clearly correcting, adjusting, pausing, or changing the active work. Do NOT use for normal conversation, status/progress/update questions, or "what are you doing"; use voice_worker_status for those. For abort intent, use interrupt_active_worker instead.',
      parameters: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', description: 'The steering message for the worker â€” the user\'s correction or new direction.' },
        },
        additionalProperties: false,
      },
    });
    realtimeTools.push({
      type: 'function',
      name: 'interrupt_active_worker',
      description: 'Abort the currently active Prometheus worker run. Use ONLY for explicit cancel/stop/abort intent from the user. Call this function immediately; do not wait for a separate acknowledgement path. After the function output returns, speak one very short confirmation.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Brief reason for the abort.' },
        },
        additionalProperties: false,
      },
    });
  }
  const roomParticipants = voiceRoom?.enabled === true && Array.isArray(voiceRoom?.participants)
    ? voiceRoom.participants
      .map((participant: any) => ({
        key: compactVoiceText(participant?.key || '', 180),
        label: compactVoiceText(participant?.label || participant?.name || '', 120),
      }))
      .filter((participant: any) => participant.key && participant.label)
    : [];
  if (roomParticipants.length > 1) {
    const roster = roomParticipants.map((participant: any) => `${participant.label} (${participant.key})`).join(', ');
    realtimeTools.push({
      type: 'function',
      name: 'voice_room_handoff',
      description: `Safety fallback for a host-routed Voice Room. Use ONLY when the user is clearly addressing another listed participant and you are still receiving the turn instead of the host switching first. Call it immediately and remain silent; never merely say that the turn is for someone else. Valid room participants: ${roster}.`,
      parameters: {
        type: 'object',
        required: ['agent_key', 'user_request'],
        properties: {
          agent_key: {
            type: 'string',
            enum: roomParticipants.map((participant: any) => participant.key),
            description: 'Exact Voice Room participant key to activate.',
          },
          user_request: {
            type: 'string',
            description: 'The user\'s complete original spoken request, preserving enough wording for the newly active participant to answer.',
          },
        },
        additionalProperties: false,
      },
    });
  }
  return realtimeTools;
}

export function buildRealtimeVoiceAgentInstructions(args: {
  contextBlock: string;
  contextPacket: Record<string, any>;
  voiceAgentMemory?: string;
  voiceRuntime?: string;
  cameraRuntime?: string;
  wakePhrase?: string;
  conversationTranscript?: string;
  conversationSummary?: string;
  recentToolLog?: string;
  currentTime?: Record<string, any>;
  voiceTarget?: VoiceAgentTargetContext;
}): string {
  const currentTime = args.currentTime || buildVoiceTimeContext();
  const identity = voiceAgentTargetIdentity(args.voiceTarget);
  // Personal context comes first; continuity stays above optional tool guidance.
  // Explicit section boundaries let budgeting discard only lower-priority text.
  const continuityLines: string[] = [];
  if (args.cameraRuntime) {
    continuityLines.push(
      '## Mobile camera runtime (highest priority)',
      args.cameraRuntime,
      '',
    );
  }
  const voiceRoomTranscript = compactVoiceText(args.contextPacket?.voiceRoom?.transcriptText || '', 7000);
  if (voiceRoomTranscript) {
    continuityLines.push(
      '## Shared Voice Room transcript',
      'These are recent turns from the current multi-agent Voice Room, including turns spoken to other participants. Treat them as discussion you witnessed. Use them to resolve references such as "that", "what they said", and "what do you think about that"; do not claim every line was addressed to you.',
      voiceRoomTranscript,
      '## End shared voice room transcript',
      '',
    );
  }
  if (args.conversationSummary || args.conversationTranscript || args.recentToolLog) {
    continuityLines.push(
      '## This conversation so far (you are joining a chat already in progress â€” continue from here, do NOT restart or re-introduce yourself)',
      'The user just turned voice on mid-conversation. Pick up exactly where this left off: reference what was already said and done, and do not ask what they need from scratch.',
    );
    if (args.conversationSummary) {
      continuityLines.push(
        '',
        '### Earlier in this conversation (summary)',
        'Older context from this same thread was compacted into this summary. Treat it as things you already know and discussed.',
        args.conversationSummary,
      );
    }
    if (args.conversationTranscript) {
      continuityLines.push(
        '',
        '### Recent messages',
        args.conversationTranscript,
        '### End recent messages',
      );
    }
    if (args.recentToolLog) {
      continuityLines.push(
        '',
        '### Recent work completed in this thread',
        args.recentToolLog,
      );
    }
    continuityLines.push('');
  }
  const lines = [
    identity.isSubagent
      ? `You are ${identity.label}, a standalone subagent under Prometheus, speaking in Realtime mode through your own voice interface. You are not Prometheus and must not claim to be Prometheus.`
      : 'You are Prometheus speaking through the user\'s voice interface in OpenAI Realtime mode.',
    identity.isSubagent
      ? `Your identity is the subagent ${identity.label}; the Realtime voice layer is only the transport. You are not a generic live conversational voice agent. For small talk, status answers, fast voice_* tools, canonical read-only skill_* tools, and hand-offs, speak as ${identity.label} from this subagent's role.`
      : 'You are the live conversational voice agent: small talk, status answers, fast voice_* tools, canonical read-only skill_* tools, and worker hand-offs all flow through you. You ARE Prometheus on voice â€” speak with that identity.',
    identity.isSubagent
      ? `If the user asks "who are you?", answer that you are ${identity.label}, a standalone subagent under Prometheus, then summarize your configured subagent role from the context below. Do not answer that you are a voice layer, voice interface, realtime voice, or provider voice.`
      : '',
    identity.isSubagent
      ? `Your direct subagent voice stays scoped to its own work. The main Prometheus voice session owns cross-thread orchestration.`
      : '',
    'Your audio voice label or provider voice name, such as Eve, Marin, Alloy, or any similar setting, is only the sound used for speech output. It is never your name, persona, identity, role, or agent name. If asked who you are, answer from the identity above.',
    '',
    '## Prometheus personal context',
    args.contextBlock || '(no extended context available)',
    ...continuityLines,
    'Personality: warm, direct, technically sharp, playful when natural, deeply aligned with the user. Use the user name only when it is known and natural. Avoid generic acknowledgements like "I am here" or "How can I help" â€” answer what they actually said.',
    '',
    'Response style: speak naturally and conversationally, as if on a phone call. Keep replies tight unless he wants depth. No bullet points or markdown â€” this is audio.',
    'Speak only normal words and numbers. Never vocalize punctuation marks, symbols, emoji, markdown, bullets, dashes, or standalone characters; if a candidate reply has no word, stay silent.',
    'Time/date rule: use ## Current time only when exactLocalTimeAvailable is true or source is device. If it is gateway_fallback, say you do not have the exact device-local time and tell the user to check their device clock for the precise time.',
    '',
    args.voiceAgentMemory ? '## Voice agent memory' : '',
    args.voiceAgentMemory ? args.voiceAgentMemory : '',
    args.voiceAgentMemory ? '' : '',
    '## When to call which tool',
    args.contextPacket?.voiceRoom?.enabled === true
      ? '- voice_room_handoff: Voice Room safety fallback. The host normally switches participants from the transcript before you receive a turn. If you still receive a turn that clearly addresses another named room participant, call voice_room_handoff immediately with that participant\'s exact agent_key and the user\'s complete request. Stay silent; do not merely say "that\'s for Victor" or announce a handoff. Do not use it for third-person mentions, ordinary discussion about another agent, or a participant who is already active.'
      : '',
    identity.isSubagent
      ? `- voice_ops agent_control is your worker path. For a request that needs ${identity.label}'s full worker capabilities, call voice_ops with action agent_control, agent_action chat, and the complete message. agent_id defaults to your own subagent id. The call waits for your worker's real response and returns it to this same ${identity.label} Voice/Live session; then summarize the result as yourself.`
      : '- voice_thread_ops: the first-class Prometheus thread control plane. List/find/search include active and settled threads by default and mark settled state; pass state=active or state=settled to narrow, and use reopen (open/unsettle aliases) to return a settled thread to the active view without changing history. For every new thread choose launch_mode ping, forget, or supervise. Use ping for a detached completion notification, forget when no owner update is wanted, and supervise for a hidden review loop that checks reasoning, tool findings, runtime state, and artifacts while the target works. Default new threads to the current Main Chat route. Use create_many only for genuinely independent work; there are no Voice worker groups.',
    '- voice_ops: unified quick voice operations. It also provides task_directory for global task discovery, task_control for existing-task operations, task_watch for explicit opt-in notifications, agent_directory for subagent discovery, and agent_control for standalone-subagent chat/dispatch/run recovery. Controlling an outside task never tracks it automatically.',
    '- Visual cards use the show_ui wrapper (render a card in the app while you speak the gist â€” keep speech short, the card carries the detail). Actions: weather (forecast), market (crypto/memecoins), stocks (equities/ETFs), prediction_market (Polymarket odds), map (places/locations), sources (news/citations), comparison (side-by-side table), chart (line/bar/area from numbers), product_carousel (products), agent_work (operator snapshot â€” gather via voice_ops action automation_dashboard first), and run_result (finished-task summary). For sources or product_carousel, pass the user\'s query directly; show_ui searches and assembles the items, so do not call it first with an empty items array and do not separately call voice_ops web_search unless show_ui reports a search failure. If the user asks for unspecified news sources, use query "latest news". All are keyless and read-only; call show_ui directly instead of dispatching the Worker for these.',
    '- skill_list: canonical skill discovery. Use it to inspect available workflows, structured prompt-signal evidence, legacy triggers, categories, and required tools for multi-step or unfamiliar workflows. Do not call skill_list for direct live UI control; use voice_browser or voice_desktop. Use totalInstalled, matchedCount, returnedCount, and truncated exactly; do not infer that the returned array length is the total skill count.',
    '- skill_read / skill_resource_list / skill_resource_read: canonical skill tools. Load relevant workflow instructions before browser/desktop/tool actions when skill trigger context points to them. Follow skill instructions only through voice_* tools; explicit user-authorized social posts/messages are allowed when content and destination are clear. Hand off to Worker if they require files, shell, uploads/downloads, credentials, purchases/payments, account settings/security changes, destructive submits, or durable changes.',
    '- voice_browser uses the same Prometheus browser runtime as regular chat. Use action open, snapshot, screenshot, page_text, focused_item, click, vision_click, fill, type, vision_type, press_key, scroll, drag, wait, or close for live browser work. Hand off only for file transfer, credentials, purchases/payments, destructive actions, account settings/security changes, or durable work.',
    '- voice_desktop uses the same Prometheus desktop runtime as regular chat. Use action screenshot, monitors, list_windows, focus_window, window_control, find_app, launch_app, click, drag, scroll, type, type_raw, press_key, wait, get_clipboard, set_clipboard, window_click, window_type, window_press_key, or window_scroll. For window_control include window_action minimize/maximize/restore/close. Use fresh screenshots and the same coordinate/SOM targeting rules as regular Prometheus.',
    '- Desktop screenshots are vision-first and skip OCR by default. Input actions do not take a second screenshot unless capture_after=true (include_screenshot=true is the compatibility alias); ask for OCR explicitly only when text extraction is needed. Focus may return one verification image.',
    '- voice_ops web_search and show_ui sources/products use the configured preferred provider and compact result set by default for realtime latency. Use mode="multi", provider="multi", or multi_engine=true only when wide provider fan-out is explicitly wanted; deeper URL metadata/image enrichment belongs to Worker.',
    '- Screenshot ownership: screenshot capture and screenshot sending stay in the voice layer. Do not create a thread for ordinary browser, desktop, app, window, or active-window screenshots; call voice_browser action screenshot, voice_desktop action screenshot, or voice_ops action send_screenshot.',
    '- steer_active_worker / interrupt_active_worker: ONLY when a live foreground worker runtime is currently active (check the worker context below) AND the user is correcting, changing, pausing, or cancelling that active runtime. If the worker status says tasks are paused, stalled, awaiting input, failed, or paused after gateway restart, use voice_ops action task_control instead.',
    '',
    '## Routing decisions you make implicitly',
    '- If the user asks something answerable from your context (memory, identity, recall, small talk) â€” answer directly, no tool.',
    '- If the user asks for brainstorming, prioritization, judgment, a recommendation, or an interactive plan, stay in this voice conversation. Do not create a thread merely because the request uses a tool.',
    '- If the user asks for status/progress/context about the active live run â€” call voice_ops action worker_status, then use recentActivity, lastToolCall, runtimeProgress, and progressAgeMs to say what it is actually doing. Do not merely repeat the plan step, and do not send the status question to the thread as a steer.',
    '- If the main Prometheus user asks only to restart/reboot the gateway without a build or additional work, speak one short acknowledgement and call restart_gateway_quick. Do not create a thread for a plain quick restart. The restarted gateway will provide the success confirmation.',
    '- When a managed thread updates, translate only the meaningful outcome: what changed, why it matters, and the next decision if one exists. Do not narrate logs, tool names, IDs, or routine internal transitions.',
    '- A managed_thread_turn_complete update is the completion signal for the specific turn. Do not infer it from a successful create, create_many, send, or steer tool return. Until that update or a fresh read/status, say the response is pending.',
    '- Skill scout rule: use skill_list for multi-step workflows or unfamiliar app/site procedures. Do NOT run skill scout for direct live UI control like open, screenshot, click, scroll, press key, type, focus, maximize, minimize, restore, or close; call voice_browser or voice_desktop immediately.',
    '- If the user wants quick voice-scope work â€” call voice_ops, voice_browser, voice_desktop, or skill_* as appropriate, then narrate the result. For automation/operator status snapshots, call voice_ops action automation_dashboard.',
    '- If the user asks you to remember a rule specifically for the live voice agent, update VOICEAGENT.md with voice_ops action agent_memory instead of voice_ops action write_note.',
    identity.isSubagent
      ? ''
      : '- You are Prometheus with a voice: your function list IS the Prometheus core tool set (web_search, web_fetch, memory, write_note, delivery_send, background_ops, chatgpt_sandbox, request_tool_category, tool_search/tool_call for connected apps, etc.), plus voice extras (voice_thread_ops, voice_ops, voice_browser, voice_desktop, show_ui, quiet mode). Call them directly, exactly like main chat. When you need a category (workspace_write for files/shell/git, browser_automation, desktop_automation, agents_and_teams, media_generation...), call request_tool_category; on OpenAI and xAI voice the new tools appear in your function list on your next step. Categories also auto-activate from what the user says. If a tool you need is not in your function list (Codex voice keeps a fixed list for the whole call), call it immediately with prometheus_tools action=call, tool=<name>, args={...} (action=describe first if unsure of its arguments). Never tell the user a tool is unavailable without trying prometheus_tools. Keep long multi-step coding or research in voice_thread_ops so voice stays responsive.',
    identity.isSubagent
      ? `- For work needing files, shell, coding, long research, or a durable artifact, call voice_ops action agent_control with agent_action chat so ${identity.label}'s own worker performs it. Wait for the returned reply and summarize it in this same voice. Use agent_action dispatch only when the user explicitly requests background execution and does not expect an immediate result.`
      : '- For heavy or durable work outside voice scope, call voice_thread_ops action=create immediately with an explicit launch_mode. Use supervise when the user expects ongoing verification/steering, ping for a one-shot completion notification, and forget when they do not want a notification. For several independent work items, call create_many with a route on each item. Keep user choices, approvals, and interactive judgment here in Voice.',
    identity.isSubagent
      ? '- For your existing worker run, use voice_ops agent_control run_status, run_message, run_resume, run_pause, run_rerun, or run_cancel. Do not call Prometheus thread operations.'
      : '- For existing thread work, call voice_thread_ops list/find/search/read/status, including settled state when needed, then use reopen (open/unsettle aliases) before sending or steering a settled thread when you want it back in the active view. Use follow only as a legacy compatibility alias; for new threads choose launch_mode supervise when the user asks for ongoing supervision. Do not create a duplicate thread.',
    identity.isSubagent
      ? ''
      : '- For a correction to an active current runtime, steer_active_worker remains available as a compatibility control. Prefer voice_thread_ops steer for an identified first-class thread.',
    '- Use agent_directory before agent_control when a standalone subagent id is unknown. agent_control chat is persistent conversation, dispatch starts new background work, and run_* operates an existing agent-owned task. Managed-team members are intentionally excluded from this standalone tool.',
    '- If the user interrupts an active live runtime with an actual correction, new constraint, pause, or direction change â€” call steer_active_worker. Do not use steer_active_worker for paused background tasks.',
    '- If the user explicitly cancels/stops/aborts â€” call interrupt_active_worker.',
    '',
    '## Tool calls are REAL actions â€” never fake them',
    '- Tool authority: the provided voice_* tools, canonical read-only skill_* tools, and explicit realtime control tools are your entire action surface. Never call native Codex shell, filesystem, browser, desktop, or worker tools from Voice. Use the matching voice_* tool, and use voice_thread_ops only when the request genuinely needs a first-class Prometheus thread.',
    '- A tool only runs if you actually emit the function call. Saying "on it", "handing that off", "I started the worker", or "let me search" does NOT run anything by itself.',
    identity.isSubagent
      ? `- CRITICAL for subagent work: when the user asks ${identity.label} to have "your agent", "the agent", or "your worker" investigate, plan, create a file, or perform substantial work, call voice_ops action agent_control with agent_action chat in the same turn. Its returned reply belongs to this same ${identity.label} voice session.`
      : '- CRITICAL for hand-offs: when the user wants durable or blocking work, emit voice_thread_ops action=create (or create_many only for genuinely independent work) in the same turn. Speaking an acknowledgement WITHOUT creating or steering the thread is a failure because the work never starts.',
    '- CRITICAL for live UI control: when the user asks you to click, scroll, press a key, type, fill, focus, maximize, minimize, restore, close, open, or screenshot the current browser/desktop, your next action must be voice_browser or voice_desktop with the matching action. Do not say you will do it without the function call.',
    '- CRITICAL for screenshot delivery: when the user asks to send/share/show/deliver a screenshot, call voice_ops action send_screenshot. Do not create a thread for ordinary screenshot delivery while this tool exists.',
    '- If a browser/desktop target is ambiguous, first call voice_browser action snapshot or voice_desktop action screenshot with mode som, then call the action tool from the returned refs/coordinates.',
    identity.isSubagent
      ? '- CRITICAL for status: use voice_ops agent_control run_status for your worker status. Do not message or restart the worker merely to ask its status.'
      : '- CRITICAL for status: never say you messaged, asked, notified, or sent something to a thread when the user only asked a status/update question. Call voice_thread_ops action=status or read and answer from the returned context instead.',
    '- Likewise, never claim a search/note/screenshot/timer happened unless you actually called the matching voice_* tool and received its result; never claim skill counts or skill instructions unless skill_list, skill_read, skill_resource_list, or skill_resource_read returned them.',
    '- After you say you are doing something, the corresponding function call MUST be in your output.',
    '',
    '## Hard boundaries',
    '- Never claim you changed files/accounts from the voice layer unless the relevant direct tool or Prometheus thread result confirms it. Skill_* results only confirm skill discovery or skill instruction reads.',
    '- Never narrate that you are calling a tool ("let me search for that" means just call voice_ops action web_search and report the result).',
    '- Screenshot tools provide fresh visual context. Browser/desktop UI control is allowed through voice_browser and voice_desktop, including explicit user-authorized social posts/messages when content and destination are clear. Durable/file/account settings/security/destructive work must go to a first-class Prometheus thread.',
    '',

  ];
  lines.push('## End tool-routing guidance');
  if (args.voiceRuntime) {
    lines.push('', '## Voice runtime state', args.voiceRuntime);
  }
  if (args.wakePhrase) {
    lines.push('', `## Wake phrase: "${args.wakePhrase}"`, 'If quiet mode is active, stay silent until this phrase is heard.');
  }
  lines.push('', '## Worker context packet', JSON.stringify(args.contextPacket, null, 2));
  lines.push('', '## Current time', JSON.stringify(currentTime, null, 2));
  return budgetRealtimeInstructions(lines.filter(Boolean).join('\n'));
}

export function mobileCameraRuntimeContextText(value: unknown): string {
  if (!value || typeof value !== 'object' || (value as any).active !== true) return '';
  const runtime = value as any;
  const feedOpen = runtime.feedOpen === true;
  const pendingImageCount = Math.max(0, Number(runtime.pendingImageCount || 0) || 0);
  const attachmentLine = pendingImageCount === 1
    ? 'Live camera image attached.'
    : pendingImageCount > 1
      ? `Multiple live camera images attached (${pendingImageCount}). Treat them as sequential current camera context.`
      : 'The live camera feed is open; use the next live camera frame as visual context when it arrives.';
  return [
    '[MOBILE_CAMERA_RUNTIME]',
    feedOpen
      ? 'The mobile camera live feed is open and is the primary visual source for this voice conversation.'
      : 'A live camera image captured while the mobile camera was open is attached to the current voice turn.',
    attachmentLine,
    'When the user asks what they are showing you, inspect the attached live camera image or images directly.',
    'Do not call voice_desktop or voice_browser to obtain a screenshot for a camera-relative request. Never substitute a desktop screenshot for the mobile camera.',
    'Treat this block as runtime metadata for the next spoken request; do not answer this metadata item separately.',
    '[/MOBILE_CAMERA_RUNTIME]',
  ].join('\n');
}
export function registerRealtimeVoiceRoutes(router: Router, requireSafeSessionParam: RequestHandler) {

router.post('/api/voice-agent/realtime-bootstrap', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const voiceTarget = normalizeVoiceAgentTarget(body);
    const activeRuntime = findActiveMainChatRuntimeForSession(sessionId, String(body.expectedRuntimeId || body.runtimeId || body.activeRunId || ''));
    const contextPacket = getReusableVoiceContextPacket(sessionId, body, activeRuntime);
    const voiceRuntimeContext = voiceRuntimeContextText(body.voiceRuntime || body.voice_runtime);
    const cameraRuntimeContext = mobileCameraRuntimeContextText(body.cameraRuntime || body.camera_runtime);
    if (voiceRuntimeContext) contextPacket.voiceRuntime = voiceRuntimeContext;
    const currentTime = buildVoiceTimeContext(body.deviceTime || body.device_time || body.clientTime || body.client_time);
    contextPacket.currentTime = currentTime;
    const originalPrompt = String(body.originalUserPrompt || '').trim();
    let contextBlockResult: { contextBlock: string; elapsedMs?: number; cacheHit?: boolean };
    try {
      contextBlockResult = await getVoiceAgentContextBlock(sessionId, originalPrompt, { voiceTarget });
    } catch (err: any) {
      console.warn('[voice-agent-realtime] context block failed; starting with worker packet only:', err?.message || err);
      contextBlockResult = { contextBlock: '' };
    }
    const voiceAgentMemory = loadVoiceAgentMemoryForTarget(voiceTarget);
    const runtimeBody = body?.voiceRuntime && typeof body.voiceRuntime === 'object'
      ? body.voiceRuntime
      : (body?.voice_runtime && typeof body.voice_runtime === 'object' ? body.voice_runtime : {});
    const wakePhrase = cleanVoiceWakePhrase(runtimeBody?.wakePhrase || runtimeBody?.wake_phrase || '');
    const wakeGateActive = runtimeBody?.wakeGateActive === true || runtimeBody?.wake_gate_active === true;

    const instructions = buildRealtimeVoiceAgentInstructions({
      contextBlock: contextBlockResult.contextBlock,
      contextPacket,
      voiceAgentMemory,
      voiceRuntime: voiceRuntimeContext,
      cameraRuntime: cameraRuntimeContext,
      wakePhrase,
      conversationTranscript: buildVoiceConversationTranscript(sessionId, 24, 600, voiceTarget),
      conversationSummary: buildVoiceCompactionSummaryBlock(sessionId, 4000, voiceTarget),
      recentToolLog: buildVoiceRecentToolLog(sessionId, 8, voiceTarget),
      currentTime,
      voiceTarget,
    });
    const tools = buildRealtimeVoiceAgentTools(voiceTarget, contextPacket.voiceRoom || null, sessionId);

    const provider = String(body.provider || 'openai');
    if (provider !== 'openai' && !provider.startsWith('custom:')) {
      res.status(400).json({ ok: false, success: false, error: 'Unsupported realtime provider. Use the xAI bootstrap for xai.' });
      return;
    }
    const customProvider = provider.startsWith('custom:') ? await getCustomVoiceProvider(getConfig().getConfig(), provider) : null;
    if (provider.startsWith('custom:') && !customProvider) {
      res.status(400).json({ ok: false, success: false, error: 'Custom realtime provider is not configured or enabled.' });
      return;
    }
    const protocol = customProvider ? 'openai_realtime_compatible' : 'openai_realtime';
    const baseUrl = customProvider ? customProvider.baseUrl.replace(/\/$/, '') : 'https://api.openai.com/v1';
    const model = customProvider ? String(body.model || customProvider.model) : sanitizeRealtimeAgentModel(body.model);
    // AVAS voices (for example `juniper`) are valid only when this route is
    // context-only for the Codex app-server bridge. A public V2 session must
    // use a voice accepted by the public Realtime endpoint.
    const voice = customProvider ? String(body.voice || customProvider.voices?.[0] || '') : body.contextOnly === true
      ? sanitizeRealtimeAgentVoice(body.voice)
      : sanitizePublicRealtimeAgentVoice(body.voice);
    const speed = sanitizeRealtimeAgentSpeed(body.speed);
    if (body.contextOnly === true) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        success: true,
        contextOnly: true,
        provider,
        protocol,
        model,
        voice,
        speed,
        instructions,
        tools,
        toolCount: tools.length,
      });
      return;
    }

    const authCandidates: RealtimeAgentAuthCandidate[] = customProvider
      ? [{ token: customProvider.apiKey || '', auth: 'api_key' }]
      : await getRealtimeAgentAuthCandidates();
    if (!authCandidates.length) {
      res.status(400).json({ ok: false, success: false, error: 'OpenAI Realtime requires OPENAI_API_KEY, OPENAI_REALTIME_API_KEY, or a connected OpenAI Codex OAuth account.' });
      return;
    }

    // gpt-realtime session config â€” audio.input MUST include turn_detection
    // (server VAD) and transcription so the model autoresponds when the user
    // stops speaking and the user-side transcript surfaces in events.
    const sessionConfig: any = {
      session: {
        type: 'realtime',
        model,
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            transcription: { model: DEFAULT_REALTIME_AGENT_TRANSCRIPTION_MODEL },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
              create_response: !(wakeGateActive && !!wakePhrase),
            },
          },
          output: { voice, speed },
        },
        instructions,
        tools,
        tool_choice: 'auto',
      },
    };
    const noSpeedSessionConfig = JSON.parse(JSON.stringify(sessionConfig));
    try { delete noSpeedSessionConfig.session.audio.output.speed; } catch {}
    const leanSessionConfig: any = {
      session: {
        type: 'realtime',
        model,
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            transcription: { model: DEFAULT_REALTIME_AGENT_TRANSCRIPTION_MODEL },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
              create_response: !(wakeGateActive && !!wakePhrase),
            },
          },
          output: { voice },
        },
        instructions: budgetRealtimeInstructions(instructions, REALTIME_AGENT_INSTRUCTIONS_MAX),
      },
    };
    const sessionConfigVariants = [
      { name: 'full', config: sessionConfig },
      { name: 'no_speed', config: noSpeedSessionConfig },
      { name: 'lean', config: leanSessionConfig },
    ];

    // Try each credential in turn. 401/403 means "wrong key" â€” fall through to the
    // next candidate (e.g. API key absent â†’ Codex OAuth). Any other failure is real.
    let data: any = null;
    let usedAuth: RealtimeAgentAuthCandidate['auth'] | null = null;
    let usedSourceToken = '';
    let usedVariant = '';
    let lastFailure: { status: number; data: any; variant: string; auth: RealtimeAgentAuthCandidate['auth'] } | null = null;
    for (const candidate of authCandidates) {
      for (const variant of sessionConfigVariants) {
        const upstream = await fetch(`${baseUrl}/realtime/client_secrets`, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${candidate.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(variant.config),
        });
        const text = await upstream.text();
        let parsed: any = null;
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        if (upstream.ok) {
          data = parsed;
          usedAuth = candidate.auth;
          usedSourceToken = candidate.token;
          usedVariant = variant.name;
          break;
        }
        lastFailure = { status: upstream.status, data: parsed, variant: variant.name, auth: candidate.auth };
        if (upstream.status !== 401 && upstream.status !== 403) {
          console.warn('[voice-agent-realtime] client_secret variant failed', {
            status: upstream.status,
            auth: candidate.auth,
            variant: variant.name,
            error: parsed?.error?.message || parsed?.error || parsed?.raw || '',
          });
        }
        const isAuthFailure = upstream.status === 401 || upstream.status === 403;
        if (isAuthFailure) break;
      }
      if (data) break;
      if (lastFailure?.status !== 401 && lastFailure?.status !== 403) continue;
    }

    if (!data) {
      res.status(lastFailure?.status || 502).json({
        ok: false,
        success: false,
        error: customProvider ? `Custom Realtime returned ${lastFailure?.status || 502}` : lastFailure?.data?.error?.message || lastFailure?.data?.error || `OpenAI Realtime returned ${lastFailure?.status || 502}`,
        ...(customProvider ? {} : { details: lastFailure?.data }),
        variant: lastFailure?.variant || null,
        auth: lastFailure?.auth || null,
      });
      return;
    }
    const clientSecret = String(data?.client_secret?.value || data?.value || data?.client_secret || '').trim();
    if (!clientSecret) {
      res.status(502).json({ ok: false, success: false, error: 'Realtime client_secret was not returned.', ...(customProvider ? {} : { details: data }) });
      return;
    }
    const callToken = crypto.randomUUID();
    const expiresAtRaw = Number(data?.client_secret?.expires_at || data?.expires_at || 0);
    const expiresAtMs = Number.isFinite(expiresAtRaw) && expiresAtRaw > 0
      ? (expiresAtRaw < 10_000_000_000 ? expiresAtRaw * 1000 : expiresAtRaw)
      : Date.now() + 10 * 60 * 1000;
    realtimeAgentCallTokens.set(callToken, {
      clientSecret,
      sourceToken: usedSourceToken,
      provider,
      baseUrl,
      auth: usedAuth || 'openai_codex_oauth',
      model,
      createdAt: Date.now(),
      expiresAt: expiresAtMs,
    });
    console.log('[voice-agent-realtime] client_secret ready', {
      auth: usedAuth,
      variant: usedVariant,
      model,
      voice,
      instructionsLength: instructions.length,
      toolCount: tools.length,
    });
    res.json({
      ok: true,
      success: true,
      ...(customProvider ? {} : { clientSecret }),
      callToken,
      provider,
      protocol,
      auth: usedAuth,
      variant: usedVariant,
      model,
      voice,
      speed,
      contextPacket,
      instructions,
      tools,
      instructionsLength: instructions.length,
      toolCount: tools.length,
      expiresAt: data?.client_secret?.expires_at || data?.expires_at || null,
      sessionConfig: { type: 'realtime', model, voice, speed },
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/realtime-call', async (req, res) => {
  try {
    const body = req.body || {};
    const callToken = String(body.callToken || body.call_token || '').trim();
    let sdp = String(body.sdp || '');
    if (!sdp.endsWith('\r\n')) sdp = `${sdp.replace(/\s+$/g, '')}\r\n`;
    const diagnostics = {
      sdpLength: sdp.length,
      startsWithV: sdp.startsWith('v='),
      hasAudio: /\r?\nm=audio\s/i.test(sdp),
      firstLine: sdp.split(/\r?\n/, 1)[0] || '',
    };
    if (!callToken) {
      res.status(400).json({ ok: false, success: false, error: 'Realtime call token is required.', ...diagnostics });
      return;
    }
    const entry = realtimeAgentCallTokens.get(callToken);
    if (!entry || Date.now() > entry.expiresAt) {
      realtimeAgentCallTokens.delete(callToken);
      res.status(401).json({ ok: false, success: false, error: 'Realtime call token is expired. Restart realtime voice.', ...diagnostics });
      return;
    }
    if (!diagnostics.startsWithV || !diagnostics.hasAudio) {
      res.status(400).json({ ok: false, success: false, error: 'Valid Realtime SDP audio offer is required.', ...diagnostics });
      return;
    }

    if (body.provider && String(body.provider) !== (entry.provider || 'openai')) {
      res.status(400).json({ ok: false, success: false, error: 'Realtime call provider does not match its bootstrap token.' });
      return;
    }
    const callUrlNoModel = `${entry.baseUrl || 'https://api.openai.com/v1'}/realtime/calls`;
    const callUrlWithModel = `${callUrlNoModel}?model=${encodeURIComponent(entry.model)}`;
    const attempts = [
      { label: 'ephemeral', token: entry.clientSecret, url: callUrlNoModel, auth: 'ephemeral' },
      { label: 'ephemeral_model', token: entry.clientSecret, url: callUrlWithModel, auth: 'ephemeral' },
      { label: `source_${entry.auth}`, token: entry.sourceToken, url: callUrlWithModel, auth: entry.auth },
    ].filter(attempt => attempt.token);

    let lastFailure: { status: number; label: string; error: string } | null = null;
    for (const attempt of attempts) {
      const upstream = await fetch(attempt.url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${attempt.token}`,
          'Content-Type': 'application/sdp',
          ...(attempt.auth === 'openai_codex_oauth' ? buildCodexCloudflareHeaders(attempt.token) : {}),
        },
        body: sdp,
      });
      const answer = await upstream.text();
      if (upstream.ok) {
        console.log('[voice-agent-realtime] call exchange ready', {
          auth: entry.auth,
          attempt: attempt.label,
          model: entry.model,
          ...diagnostics,
        });
        realtimeAgentCallTokens.delete(callToken);
        res.type('application/sdp').send(answer);
        return;
      }
      lastFailure = { status: upstream.status, label: attempt.label, error: answer.slice(0, 500) };
      console.warn('[voice-agent-realtime] call exchange failed', {
        auth: entry.auth,
        attempt: attempt.label,
        status: upstream.status,
        model: entry.model,
        error: answer.slice(0, 500),
        ...diagnostics,
      });
      if (upstream.status !== 500 && upstream.status !== 502 && upstream.status !== 503) continue;
    }
    res.status(lastFailure?.status || 502).json({
      ok: false,
      success: false,
      error: entry.provider?.startsWith('custom:') ? `Custom Realtime call exchange failed (${lastFailure?.status || 502})` : lastFailure?.error || `Realtime call exchange failed (${lastFailure?.status || 502})`,
      attempt: lastFailure?.label || null,
      ...diagnostics,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});
}
