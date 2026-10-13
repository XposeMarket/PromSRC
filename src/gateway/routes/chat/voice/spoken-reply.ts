import crypto from 'crypto';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../../config/config';
import { compactVoiceText, friendlyVoiceToolName } from './context';


export function persistVoiceAgentVisibleTurn(sessionId: string, transcript: string, voiceReply: string, action: string, eventId: string, processEntries: any[], richArtifacts: any[] = []): string {
  const rawSid = String(sessionId || '').trim();
  const userText = compactVoiceText(transcript || '', 1200);
  const replyText = String(voiceReply || '').trim();
  const id = String(eventId || '').trim();
  if (!rawSid || !userText || !replyText) return rawSid;
  // A voice-first new chat on mobile can still be sitting on the throwaway
  // 'mobile_default' draft slot when the realtime handoff posts here. The
  // mobile drawer never lists 'mobile_default', so persisting a durable turn
  // under it orphans the whole conversation (works live, vanishes on nav).
  // Rotate to a real mobile_<id> session and register it as channel 'mobile'
  // so it surfaces in the session list exactly like a text-first chat does.
  let sid = rawSid;
  if (rawSid === 'mobile_default') {
    sid = `mobile_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
    try {
      // Register the real session as channel 'mobile' so the drawer lists it.
      // Do not seed a title message here: the user turn added below becomes
      // the first message and the drawer derives the title from history,
      // which avoids a duplicate user bubble.
      touchSession(sid, { channel: 'mobile' });
      flushSession(sid);
    } catch (registerErr: any) {
      console.warn('[voice-agent] failed to register rotated mobile voice session:', registerErr?.message || registerErr);
    }
  }
  try {
    const session = getSession(sid);
    const history = Array.isArray(session.history) ? session.history : [];
    if (id && history.some((msg: any) => String(msg?.voiceInterruptionEventId || '') === id && String(msg?.content || '').trim() === replyText)) {
      return sid;
    }
    const groupId = `voice_workflow_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const now = Date.now();
    addMessage(sid, {
      role: 'user',
      content: userText,
      timestamp: now,
      channel: 'voice',
      channelLabel: 'voice',
      workflowGroupId: groupId,
      workflowPart: 'interruption',
      workflowLabel: action === 'handoff_new_work' ? 'Voice request' : 'Voice interruption',
      voiceInterruptionEventId: id || undefined,
    } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    addMessage(sid, {
      role: 'assistant',
      content: replyText,
      timestamp: now + 1,
      source: 'voice_agent',
      processEntries: Array.isArray(processEntries) ? processEntries : [],
      workflowGroupId: groupId,
      workflowPart: action === 'interrupt_worker' ? 'abort_response' : 'interruption_response',
      workflowLabel: action === 'interrupt_worker' ? 'Abort response' : 'Interruption response',
      voiceInterruptionEventId: id || undefined,
      richArtifacts: Array.isArray(richArtifacts) && richArtifacts.length ? richArtifacts : undefined,
    } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    flushSession(sid);
  } catch (err: any) {
    console.warn('[voice-agent] failed to persist visible voice turn:', err?.message || err);
  }
  return sid;
}

export function hasRecentVoiceWorkflowUserMessage(sessionId: string, message: string, maxAgeMs = 180000): boolean {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!sessionId || !text) return false;
  try {
    const history = Array.isArray(getSession(sessionId).history) ? getSession(sessionId).history : [];
    const now = Date.now();
    return history.some((msg: any) => {
      if (msg?.role !== 'user') return false;
      if (!String(msg?.voiceInterruptionEventId || '').trim() && !String(msg?.workflowGroupId || '').trim()) return false;
      if (String(msg?.content || '').replace(/\s+/g, ' ').trim() !== text) return false;
      const ts = Number(msg?.timestamp || 0);
      return !Number.isFinite(ts) || ts <= 0 || now - ts <= maxAgeMs;
    });
  } catch {
    return false;
  }
}

export function buildFastRouteSpokenReply(toolName: string, toolResult: any): string {
  const ok = toolResult?.ok !== false;
  const summary = compactVoiceText(toolResult?.summary || toolResult?.stdout || toolResult?.error || '', 600);
  if (!ok) return `${friendlyVoiceToolName(toolName)} failed${summary ? `: ${summary}` : '.'}`;
  switch (toolName) {
    case 'voice_web_search': return summary ? `Here's what I found: ${summary}` : 'Search complete.';
    case 'voice_web_fetch': return summary ? `Here's the content: ${summary}` : 'Fetched.';
    case 'voice_memory_search': return summary ? `From memory: ${summary}` : 'Nothing found in memory.';
    case 'voice_agent_memory': return summary || 'Voice agent memory updated.';
    case 'skill_list':
    case 'voice_skill_lookup': return summary ? `Available workflows: ${summary}` : 'No matching skills found.';
    case 'skill_read':
    case 'voice_skill_read': return summary || 'Skill loaded.';
    case 'skill_resource_list': return summary || 'Skill resources listed.';
    case 'skill_resource_read':
    case 'voice_skill_resource_read': return summary || 'Skill resource loaded.';
    case 'voice_write_note': return summary || 'Note saved.';
    case 'voice_set_wake_phrase': return summary || 'Wake phrase updated.';
    case 'voice_enter_quiet_mode': return summary || 'Quiet mode is ready.';
    case 'voice_set_quiet_until': return summary || 'Quiet mode is ready.';
    case 'voice_timer': return summary || 'Timer set.';
    case 'voice_automation_dashboard': return summary || 'Automation snapshot loaded.';
    case 'voice_browser_open': return summary || 'Browser opened.';
    case 'voice_browser_scroll': return summary || 'Browser scrolled.';
    case 'voice_browser_screenshot': return summary || 'Browser screenshot captured.';
    case 'voice_desktop_screenshot': return summary || 'Desktop captured.';
    case 'voice_desktop_focus_window': return summary || 'Window focused.';
    case 'voice_desktop_launch_app': return summary || 'App launched.';
    case 'voice_send_screenshot': return summary || 'Screenshot sent.';
    default: return summary || `${friendlyVoiceToolName(toolName)} complete.`;
  }
}

export function getVoiceAgentSynthModel(): string | undefined {
  try {
    const raw = (getConfig() as any).getConfig() as any;
    const configured = String(raw?.voice?.agent?.synth_model || raw?.agent_model_defaults?.voice_agent_synth || '').trim();
    if (configured) return configured;
    const active: string = String(raw?.llm?.provider || 'ollama').trim();
    const miniDefaults: Record<string, string> = {
      openai: 'gpt-4o-mini',
      openai_codex: 'gpt-4o-mini',
      anthropic: 'claude-haiku-4-5-20251001',
      gemini: 'gemini-2.0-flash-lite',
      xai: 'grok-3-mini-fast',
    };
    return miniDefaults[active];
  } catch {
    return undefined;
  }
}

export function buildDeterministicHandoffAck(transcript: string): string {
  const text = String(transcript || '').trim().toLowerCase();
  const verbGerunds: Array<[RegExp, string]> = [
    [/\brun(ning)?\b/, 'Running that'],
    [/\btest(ing)?\b/, 'Testing that'],
    [/\bbuild(ing)?\b/, 'Building that'],
    [/\bsearch(ing|ed)?\b/, 'Searching now'],
    [/\bfind\b|\bfinding\b/, 'Finding that'],
    [/\bwrit(e|ing)\b/, 'Writing that'],
    [/\bedit(ing)?\b/, 'Editing that'],
    [/\bfix(ing)?\b/, 'Fixing that'],
    [/\bopen(ing)?\b/, 'Opening that'],
    [/\bcreat(e|ing)\b/, 'Creating that'],
    [/\bcheck(ing)?\b/, 'Checking that'],
    [/\binstall(ing)?\b/, 'Installing that'],
    [/\bgenerat(e|ing)\b/, 'Generating that'],
    [/\banalyz(e|ing)\b/, 'Analyzing that'],
    [/\bstart(ing)?\b/, 'Starting that'],
    [/\bupdat(e|ing)\b/, 'Updating that'],
    [/\bdebu(g|gging)\b/, 'Debugging that'],
    [/\bsend(ing)?\b/, 'Sending that'],
    [/\bdownload(ing)?\b/, 'Downloading that'],
    [/\bnavigate|navigating\b/, 'Navigating there'],
    [/\blaunch(ing)?\b/, 'Launching that'],
    [/\bcompil(e|ing)\b/, 'Compiling that'],
    [/\bdeploy(ing)?\b/, 'Deploying that'],
    [/\bscreenshot\b/, 'Capturing that'],
    [/\bremind(er)?\b|\btimer\b/, 'Setting that timer'],
    [/\bremember\b|\bjot\b|\bnote\b/, 'Saving that note'],
  ];
  for (const [pattern, ack] of verbGerunds) {
    if (pattern.test(text)) return `${ack} now.`;
  }
  return 'On it.';
}

// Plain-text streaming sentence flusher â€” feed raw token chunks, get sentence
// callbacks. Used for synthesis passes that return plain text (not JSON-wrapped).
export function createPlainTextSentenceStreamer(onSentence: (text: string) => void) {
  let pending = '';
  let totalChars = 0;
  const MAX_PENDING_NO_PUNCT = 140;
  const SENTENCE_END_RE = /[.!?]["')\]]*\s|[.!?]["')\]]*$|;\s/;
  function flush(final = false) {
    if (!pending) return;
    while (true) {
      const m = pending.match(SENTENCE_END_RE);
      if (!m) break;
      const end = (m.index ?? 0) + m[0].length;
      const sentence = pending.slice(0, end).trim();
      pending = pending.slice(end);
      if (sentence) onSentence(sentence);
    }
    if (!final && pending.length >= MAX_PENDING_NO_PUNCT) {
      const lastSpace = pending.lastIndexOf(' ', MAX_PENDING_NO_PUNCT);
      const cut = lastSpace > 40 ? lastSpace : MAX_PENDING_NO_PUNCT;
      const sentence = pending.slice(0, cut).trim();
      pending = pending.slice(cut).replace(/^\s+/, '');
      if (sentence) onSentence(sentence);
    }
    if (final && pending.trim()) {
      onSentence(pending.trim());
      pending = '';
    }
  }
  return {
    feed(chunk: string) {
      if (!chunk) return;
      pending += chunk;
      totalChars += chunk.length;
      if (totalChars > 4000) { flush(true); return; }
      flush(false);
    },
    finish() { flush(true); },
  };
}

// Stream parser: extracts characters from the value of "spokenReply" in a JSON
// object as model tokens arrive. Handles JSON string escapes and key variants.
// Emits sentence-sized chunks to onSentence as they complete.
export function createSpokenReplyStreamer(onSentence: (text: string) => void) {
  type State =
    | 'find_key'
    | 'after_key'
    | 'expect_colon'
    | 'expect_quote'
    | 'in_value'
    | 'in_value_escape'
    | 'done';
  let state: State = 'find_key';
  let buf = '';                    // rolling buffer for key detection
  let valueAccum = '';             // accumulated decoded characters of spokenReply
  let pending = '';                // characters not yet emitted as a sentence
  let totalChars = 0;
  const KEY_PATTERNS = [/"spokenReply"\s*:/i, /"voiceReply"\s*:/i, /"spoken_reply"\s*:/i];
  const MAX_PENDING_NO_PUNCT = 140;   // flush if too long without sentence-end
  const SENTENCE_END_RE = /[.!?]["')\]]*\s|[.!?]["')\]]*$|;\s/;

  function flushSentences(final = false) {
    if (!pending) return;
    while (true) {
      const m = pending.match(SENTENCE_END_RE);
      if (!m) break;
      const end = (m.index ?? 0) + m[0].length;
      const sentence = pending.slice(0, end).trim();
      pending = pending.slice(end);
      if (sentence) onSentence(sentence);
    }
    if (!final && pending.length >= MAX_PENDING_NO_PUNCT) {
      // emit as a soft chunk at a space boundary if possible
      const lastSpace = pending.lastIndexOf(' ', MAX_PENDING_NO_PUNCT);
      const cut = lastSpace > 40 ? lastSpace : MAX_PENDING_NO_PUNCT;
      const sentence = pending.slice(0, cut).trim();
      pending = pending.slice(cut).replace(/^\s+/, '');
      if (sentence) onSentence(sentence);
    }
    if (final && pending.trim()) {
      onSentence(pending.trim());
      pending = '';
    }
  }

  function decodeEscape(ch: string): string {
    switch (ch) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '';
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '';
      case 'f': return '';
      default: return ch;
    }
  }

  function feedValueChar(ch: string) {
    valueAccum += ch;
    pending += ch;
    totalChars += 1;
    if (totalChars > 4000) {
      // safety cap; stop accumulating
      state = 'done';
      flushSentences(true);
      return;
    }
    flushSentences(false);
  }

  return {
    feed(chunk: string) {
      if (state === 'done' || !chunk) return;
      let i = 0;
      while (i < chunk.length) {
        const ch = chunk[i];
        if (state === 'find_key') {
          buf += ch;
          if (buf.length > 4096) buf = buf.slice(-2048);
          for (const re of KEY_PATTERNS) {
            const m = buf.match(re);
            if (m) {
              state = 'expect_quote';
              buf = '';
              break;
            }
          }
          i++;
          continue;
        }
        if (state === 'expect_quote') {
          if (ch === '"') {
            state = 'in_value';
            i++;
            continue;
          }
          if (/\s/.test(ch)) { i++; continue; }
          // unexpected â€” bail
          state = 'done';
          flushSentences(true);
          return;
        }
        if (state === 'in_value') {
          if (ch === '\\') {
            state = 'in_value_escape';
            i++;
            continue;
          }
          if (ch === '"') {
            state = 'done';
            flushSentences(true);
            return;
          }
          feedValueChar(ch);
          i++;
          continue;
        }
        if (state === 'in_value_escape') {
          if (ch === 'u') {
            // unicode escape \uXXXX â€” consume 4 hex chars
            const hex = chunk.slice(i + 1, i + 5);
            if (hex.length === 4) {
              try {
                const code = parseInt(hex, 16);
                if (!Number.isNaN(code)) feedValueChar(String.fromCharCode(code));
              } catch {}
              i += 5;
            } else {
              // need more data â€” break and wait for next feed
              return;
            }
            state = 'in_value';
            continue;
          }
          feedValueChar(decodeEscape(ch));
          state = 'in_value';
          i++;
          continue;
        }
        i++;
      }
    },
    finish() {
      if (state !== 'done') {
        state = 'done';
        flushSentences(true);
      }
    },
    getAccumulated(): string {
      return valueAccum;
    },
    isComplete(): boolean {
      return state === 'done';
    },
  };
}
