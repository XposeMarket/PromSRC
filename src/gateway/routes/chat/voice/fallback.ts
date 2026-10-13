
import { VoiceAgentProcessEntry, pushVoiceAgentProcessEntry, executeVoiceAgentToolWithTrace, VoiceAgentDecision } from './decision';
import { compactVoiceText, VoiceAgentAction, VoiceAgentTargetContext, voiceAgentTargetIdentity } from './context';
import { cleanVoiceWakePhrase, buildVoiceTimeContext } from './tool-helpers';


export function parseVoiceToolResult(raw: string): any {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export const voiceAutomationSkillScoutCache = new Map<string, { query: string; ts: number }>();
export const VOICE_AUTOMATION_SKILL_SCOUT_CACHE_MS = 120000;

export function isVoiceBrowserDesktopAutomationTool(toolName: string): boolean {
  const name = String(toolName || '').trim();
  return /^voice_(?:browser|desktop)_/.test(name);
}

export function isDirectVoiceUiControlTool(toolName: string): boolean {
  return [
    'voice_browser',
    'voice_desktop',
    'voice_browser_open',
    'voice_browser_snapshot',
    'voice_browser_get_page_text',
    'voice_browser_get_focused_item',
    'voice_browser_screenshot',
    'voice_browser_click',
    'voice_browser_vision_click',
    'voice_browser_fill',
    'voice_browser_type',
    'voice_browser_vision_type',
    'voice_browser_press_key',
    'voice_browser_scroll',
    'voice_browser_wait',
    'voice_browser_drag',
    'voice_browser_close',
    'voice_desktop_screenshot',
    'voice_desktop_click',
    'voice_desktop_drag',
    'voice_desktop_scroll',
    'voice_desktop_type',
    'voice_desktop_type_raw',
    'voice_desktop_press_key',
    'voice_desktop_wait',
    'voice_desktop_get_clipboard',
    'voice_desktop_set_clipboard',
    'voice_desktop_get_monitors',
    'voice_desktop_window_control',
    'voice_desktop_list_windows',
    'voice_desktop_focus_window',
    'voice_desktop_find_app',
    'voice_desktop_launch_app',
    'voice_desktop_window_click',
    'voice_desktop_window_type',
    'voice_desktop_window_press_key',
    'voice_desktop_window_scroll',
  ].includes(String(toolName || '').trim());
}

export function isVoiceRuntimeControlTool(toolName: string): boolean {
  return [
    'voice_set_wake_phrase',
    'voice_enter_quiet_mode',
    'voice_set_quiet_until',
  ].includes(String(toolName || '').trim());
}

export async function runVoiceAutomationSkillScout(
  sessionId: string,
  transcript: string,
  toolName: string,
  trace?: VoiceAgentProcessEntry[],
  seen?: Set<string>,
): Promise<void> {
  if (!isVoiceBrowserDesktopAutomationTool(toolName)) return;
  if (isDirectVoiceUiControlTool(toolName)) return;
  const request = compactVoiceText(String(transcript || '').trim(), 500);
  if (!request) return;
  const key = `${sessionId || 'voice'}:${toolName}:${request.toLowerCase()}`;
  if (seen?.has(key)) return;
  seen?.add(key);
  const cacheKey = String(sessionId || 'voice').trim() || 'voice';
  const cached = voiceAutomationSkillScoutCache.get(cacheKey);
  if (cached && cached.query === request && Date.now() - cached.ts < VOICE_AUTOMATION_SKILL_SCOUT_CACHE_MS) return;
  voiceAutomationSkillScoutCache.set(cacheKey, { query: request, ts: Date.now() });
  pushVoiceAgentProcessEntry(trace, 'skill', 'Skill scout before voice browser/desktop automation...', {
    actor: 'Voice Agent',
    tool: toolName,
    query: request,
  });
  const listRaw = await executeVoiceAgentToolWithTrace(sessionId, 'skill_list', { query: request, limit: 12 }, trace);
  const listResult = parseVoiceToolResult(listRaw);
  if (listResult?.ok === false) return;
  const skills = Array.isArray(listResult?.skills) ? listResult.skills : [];
  if (Number(listResult?.matchedCount || skills.length || 0) <= 0) return;
  pushVoiceAgentProcessEntry(trace, 'skill', 'Skill candidates found; leaving relevance choice to the voice model instead of auto-reading the first match.', {
    actor: 'Voice Agent',
    candidates: skills.slice(0, 5).map((skill: any) => String(skill?.id || '')).filter(Boolean),
  });
}

export function extractFirstVoiceUrl(text: string): string {
  return String(text || '').match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/g, '') || '';

}

export function isVoiceBrowserLaunchText(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  return /\b(?:https?:\/\/|www\.|\.com\b|\.org\b|\.net\b|\.io\b|\.dev\b|website|web\s*site|browser|chrome|chromium|edge|url|page|tab|search\s+(?:for|web)|google|bing|duckduckgo)\b/i.test(text);
}

export function isDangerousVoiceLaunchText(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  return /\b(?:install\s+additional\s+tools|native\s+modules?|node-gyp|visual\s+studio\s+build\s+tools|windows\s+build\s+tools|chocolatey)\b/i.test(text);
}

export function extractVoiceLaunchAppName(text: string): string {
  const quoted = String(text || '').match(/["'â€œâ€â€˜â€™]([^"'â€œâ€â€˜â€™]{2,80})["'â€œâ€â€˜â€™]/);
  if (quoted?.[1]) return compactVoiceText(quoted[1].trim(), 80);
  const match = String(text || '').match(/\b(?:open|launch|start)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application))?(?:\s+(?:right now|now|please))?$/i);
  let candidate = String(match?.[1] || '').trim();
  candidate = candidate.replace(/\b(?:right now|now|please|app|application)\b/ig, ' ');
  candidate = candidate.replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
  return compactVoiceText(candidate, 80);
}

export function cleanVoiceSearchFallbackQuery(text: string): string {
  let value = String(text || '').trim();
  value = value.replace(/https?:\/\/[^\s"'<>]+/ig, ' ');
  value = value.replace(/\b(?:don't|do not|dont)\s+(?:hand|send|pass)\s+(?:it\s+)?(?:off|over)?\s*(?:to\s+)?(?:the\s+)?worker\b/ig, ' ');
  value = value.replace(/\bwithout\s+(?:the\s+)?worker\b/ig, ' ');
  value = value.replace(/\bas\s+(?:a\s+)?voice\s+agent\b/ig, ' ');
  value = value.replace(/\b(?:can you|could you|please|go ahead and|test out|try out|your new|new|features?|web search|search feature|voice agent)\b/ig, ' ');
  value = value.replace(/\b(?:look up|search for|search|find|tell me about)\b/ig, ' ');
  value = value.replace(/[^\w\s'"-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value || /^(?:test|smoke test|quick test|it|that|this)$/i.test(value)) return 'OpenAI Realtime API voice tools';
  return compactVoiceText(value, 180);
}

export function extractVoiceScreenshotWindowName(transcript: string): string {
  const text = String(transcript || '').trim();
  if (!text || /\b(browser|chrome|tab|page|website|site)\b/i.test(text)) return '';
  const quoted = text.match(/["'â€œâ€â€˜â€™]([^"'â€œâ€â€˜â€™]{2,80})["'â€œâ€â€˜â€™]/);
  if (quoted?.[1]) return compactVoiceText(quoted[1].trim(), 80);
  const patterns = [
    /\b(?:send|share|show|deliver)\s+(?:me\s+)?(?:a\s+)?(?:screenshot|screen\s*shot|screen grab|screengrab|capture)\s+(?:of|from)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|window))?(?:\s+(?:right now|now|please))?$/i,
    /\b(?:screenshot|screen\s*shot|screen grab|screengrab|capture)\s+(?:of|from)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|window))?(?:\s+(?:right now|now|please))?$/i,
    /\b(?:of|from)\s+(?:the\s+)?(.+?)\s+(?:app|application|window)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    let candidate = String(match?.[1] || '').trim();
    candidate = candidate.replace(/\b(?:right now|now|please|app|application|window|desktop|screen|monitor|computer|pc)\b/ig, ' ');
    candidate = candidate.replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (candidate && !/^(?:the|my|a|an|entire|whole|full|current|active)$/i.test(candidate)) {
      return compactVoiceText(candidate, 80);
    }
  }
  if (/\bactive\s+(?:app|application|window)\b|\bcurrent\s+(?:app|application|window)\b/i.test(text)) return '__active__';
  return '';
}

export function findVoiceToolFallbackRequest(transcript: string): { name: string; args: Record<string, any> } | null {
  const text = String(transcript || '').trim();
  const lower = text.toLowerCase();
  if (!text) return null;
  const wakePhraseMatch = text.match(/\b(?:set|change|make)\s+(?:my\s+|the\s+)?wake\s+(?:phrase|word)\s+(?:to|as)\s+(.+)$/i)
    || text.match(/\b(?:my\s+|the\s+)?wake\s+(?:phrase|word)\s+(?:is|should\s+be)\s+(.+)$/i);
  if (wakePhraseMatch) {
    const phrase = cleanVoiceWakePhrase(wakePhraseMatch[1] || '');
    if (phrase) return { name: 'voice_set_wake_phrase', args: { phrase } };
  }
  const quietUntilMatch = text.match(/\b(?:don't|do not|dont|stop|quit|avoid|hold off on|stay|remain|keep|be)\s+(?:talking|speaking|responding|answering|replying|listening|saying anything|active|awake|quiet)?[\s,]*(?:until|unless)\s+(?:i\s+)?(?:say|tell you|use)\s+(.+)$/i)
    || text.match(/\b(?:be|go|stay|remain|keep)\s+quiet\s+(?:until|unless)\s+(?:i\s+)?(?:say|tell you|use)\s+(.+)$/i)
    || text.match(/\b(?:don't|do not|dont)\s+say\s+anything\s+(?:until|unless)\s+(?:i\s+)?(?:say|tell you|use)\s+(.+)$/i);
  if (quietUntilMatch) {
    const phrase = cleanVoiceWakePhrase(quietUntilMatch[1] || '');
    if (phrase) return { name: 'voice_set_quiet_until', args: { phrase } };
  }
  const mentionsQuietAsExample = /\b(?:if|when|example|debug|debugging|test|testing|phrase|called|means|about|talk(?:ing)? about|say(?:ing)? something like)\b/i.test(text);
  const endsWithQuietRequest = /(?:^|(?:,|;|\band\b|\bthen\b)\s+)(?:now\s+)?(?:please\s+)?(?:prometheus\s+quiet|quiet\s+prometheus|prometheus\s+(?:be\s+quiet|go\s+quiet|sleep|stop\s+listening)|be\s+quiet|go\s+quiet|stay\s+quiet)$/i.test(lower);
  if (endsWithQuietRequest && !mentionsQuietAsExample) {
    return { name: 'voice_enter_quiet_mode', args: { reason: 'User asked Prometheus to go quiet at the end of a voice turn.' } };
  }
  if (/\b(?:automation|operator|agent|agents?|task|tasks?|schedule|scheduled|jobs?|priorit(?:y|ies)|what'?s going on|morning|daily)\b/i.test(text)
    && /\b(?:dashboard|snapshot|status|overview|summary|priorit(?:y|ies)|what'?s going on|what has everyone done|what are.*doing|running|active|stuck|blocked)\b/i.test(text)) {
    return {
      name: 'voice_automation_dashboard',
      args: {
        limit: /\b(full|deep|detail|detailed|everything|all)\b/i.test(text) ? 25 : 12,
        depth: /\b(full|deep|detail|detailed|everything|all)\b/i.test(text) ? 'full' : 'summary',
        include_done: /\b(done|completed|finished|cancelled|canceled|history|all)\b/i.test(text),
      },
    };
  }
  if (/\b(?:scroll|move)\s+(?:the\s+)?(?:browser|page|website|site|tab)?\s*(up|down)\b/i.test(text)) {
    const dir = (text.match(/\b(up|down)\b/i)?.[1] || 'down').toLowerCase();
    return { name: 'voice_browser_scroll', args: { direction: dir === 'up' ? 'up' : 'down', include_screenshot: true } };
  }
  if (/\b(?:focus|bring up|switch to)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|window))?(?:\s+(?:right now|now|please))?$/i.test(text)) {
    const quoted = text.match(/["'â€œâ€â€˜â€™]([^"'â€œâ€â€˜â€™]{2,80})["'â€œâ€â€˜â€™]/);
    const focusMatch = text.match(/\b(?:focus|bring up|switch to)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|window))?(?:\s+(?:right now|now|please))?$/i);
    const target = compactVoiceText(String(quoted?.[1] || focusMatch?.[1] || '').replace(/\b(?:app|application|window|right now|now|please)\b/ig, ' ').replace(/\s+/g, ' ').trim(), 80);
    if (target && target !== '__active__') return { name: 'voice_desktop_focus_window', args: { name: target } };
  }
  const browserOpenUrl = /\b(?:open|launch|start|pull up|go to)\b/i.test(text)
    ? extractFirstVoiceUrl(text)
    : '';
  if (browserOpenUrl) {
    return { name: 'voice_browser_open', args: { url: browserOpenUrl, include_screenshot: true } };
  }
  if (/\b(?:open|launch|start|pull up|bring up)\s+(?:the\s+)?(?:browser|chrome|chromium|edge)(?:\s+(?:right now|now|please))?$/i.test(text)) {
    return { name: 'voice_browser_open', args: { url: 'https://www.google.com', include_screenshot: true } };
  }
  if (/\b(?:open|launch|start)\b/i.test(text) && /\b(?:app|application)\b/i.test(text) && !/\b(?:browser|chrome|website|site|url|page|tab)\b/i.test(text)) {
    const app = extractVoiceLaunchAppName(text);
    if (app) return { name: 'voice_desktop_launch_app', args: { app } };
  }
  const wantsSendScreenshot = /\b(send|share|show|deliver)\b/i.test(text) && /\b(screenshot|screen\s*shot|screen grab|screengrab|capture)\b/i.test(text);
  const wantsScreenshot = /\b(screenshot|screen\s*shot|screen grab|screengrab|capture)\b/i.test(text);
  if (wantsSendScreenshot || wantsScreenshot) {
    const browser = /\b(browser|chrome|tab|page|website|site)\b/i.test(text);
    const desktop = /\b(desktop|screen|monitor|computer|pc)\b/i.test(text) || !browser;
    const windowName = extractVoiceScreenshotWindowName(text);
    const windowArgs = windowName
      ? (windowName === '__active__' ? { active: true } : { name: windowName })
      : {};
    const source = browser ? (wantsSendScreenshot ? 'browser_new' : '') : (wantsSendScreenshot ? 'desktop_new' : '');
    if (wantsSendScreenshot) {
      return {
        name: 'voice_send_screenshot',
        args: {
          source: source || (desktop ? 'desktop_new' : 'browser_new'),
          target: /\btelegram\b/i.test(text) ? 'telegram' : /\bmobile|phone\b/i.test(text) ? 'mobile' : 'origin',
          caption: browser ? 'Browser screenshot' : (windowName && windowName !== '__active__' ? `${windowName} screenshot` : 'Desktop screenshot'),
          ...windowArgs,
        },
      };
    }
    return browser
      ? { name: 'voice_browser_screenshot', args: { include_summary: true } }
      : { name: 'voice_desktop_screenshot', args: { capture: /\bprimary|main screen\b/i.test(text) ? 'primary' : 'all', include_summary: true, ...windowArgs } };
  }

  const url = extractFirstVoiceUrl(text);
  if (url && /\b(fetch|read|open|summari[sz]e|check)\b/i.test(text)) {
    return { name: 'voice_web_fetch', args: { url, max_chars: 4000 } };
  }
  // Web search â€” only match explicit imperative search phrases, never bare nouns like
  // "current", "news", "latest" which appear in everyday conversation.
  const searchVerbMatch = text.match(/\b(?:web\s+)?search\s+(?:the\s+(?:web|internet)\s+)?(?:for\s+)?(.+)$/i)
    || text.match(/\blook\s+up\s+(.+)$/i)
    || text.match(/\bgoogle\s+(.+)$/i)
    || text.match(/\bsearch\s+(?:everywhere|the\s+(?:web|internet))\s+(?:for\s+)?(.+)$/i)
    || text.match(/\bfind\s+(?:out\s+)?(?:info(?:rmation)?\s+(?:on|about)\s+|info\s+on\s+)(.+)$/i);
  if (searchVerbMatch) {
    const rawQuery = (searchVerbMatch[1] || text).trim();
    const query = cleanVoiceSearchFallbackQuery(rawQuery);
    const mode = /\b(compare|versus|vs|search everywhere)\b/i.test(text) ? 'multi' : 'single';
    return {
      name: 'voice_web_search',
      args: {
        query,
        mode,
        max_results: mode === 'multi' ? 5 : 3,
      },
    };
  }
  if (/\b(?:voice\s+agent|voiceagent|realtime\s+voice|live\s+voice)\b/i.test(text) && /\b(?:memory|remember|note|rule|routing|behavior|behaviour|always|prefer|use|update|add|change|view|show|read)\b/i.test(text)) {
    if (/\b(?:view|show|read|what(?:'s| is)?\s+in)\b/i.test(text) && !/\b(?:add|append|remember|note|write|change|update|replace)\b/i.test(text)) {
      return { name: 'voice_agent_memory', args: { action: 'read' } };
    }
    const content = text.replace(/^(?:prometheus[, ]*)?(?:please\s*)?(?:remember|jot down|make a note(?: that)?|write down|log that|save a note(?: that)?|add|update)\s*/i, '').trim();
    return { name: 'voice_agent_memory', args: { action: 'append', content: content || text, category: 'voice' } };
  }
  if (/\b(remember|jot|note|write down|log that|save a note|make a note)\b/i.test(text)) {
    if (/\bwake\s+(?:phrase|word)\b/i.test(text)) return null;
    const content = text.replace(/^(?:prometheus[, ]*)?(?:please\s*)?(?:remember|jot down|make a note(?: that)?|write down|log that|save a note(?: that)?)\s*/i, '').trim();
    return { name: 'voice_write_note', args: { content: content || text, tag: 'voice' } };
  }
  if (/\b(skill|workflow|playbook|guidance)\b/i.test(text)) {
    return { name: 'skill_list', args: { query: text, limit: 40 } };
  }
  if (/\b(what did we decide|what did i say|last time|previously|do you remember|memory|recall)\b/i.test(text)) {
    return { name: 'voice_memory_search', args: { query: text, mode: 'quick', limit: 5 } };
  }
  const minuteMatch = text.match(/\bin\s+(\d{1,4})\s*(seconds?|minutes?|hours?)\b/i);
  if (/\b(timer|remind|reminder|in \d{1,4} (?:seconds?|minutes?|hours?))\b/i.test(text) && minuteMatch) {
    const amount = Math.max(1, Number(minuteMatch[1]) || 1);
    const unit = minuteMatch[2].toLowerCase();
    const multiplier = unit.startsWith('hour') ? 3600 : unit.startsWith('minute') ? 60 : 1;
    const instruction = text.replace(minuteMatch[0], '').replace(/\b(?:set|create)?\s*(?:a\s*)?(?:timer|reminder|remind me)\b/ig, '').trim() || text;
    return {
      name: 'voice_timer',
      args: {
        action: 'create',
        delay_seconds: amount * multiplier,
        instruction,
        delivery: {
          origin: true,
          voice_if_active: true,
          telegram: /\btelegram\b/i.test(text),
        },
      },
    };
  }
  return null;
}

export function safeParseVoiceAgentJson(raw: string): any | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const candidates = [
    text,
    text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
    (text.match(/\{[\s\S]*\}/)?.[0] || '').trim(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

export function normalizeVoiceAgentDecision(raw: any, fallback: VoiceAgentDecision): VoiceAgentDecision {
  const allowed = new Set<VoiceAgentAction>(['answer_now', 'steer_worker', 'interrupt_worker', 'handoff_new_work', 'no_reply']);
  const action = allowed.has(String(raw?.action || '') as VoiceAgentAction)
    ? String(raw.action) as VoiceAgentAction
    : fallback.action;
  return {
    action,
    spokenReply: compactVoiceText(raw?.spokenReply || raw?.voiceReply || fallback.spokenReply || '', 900),
    workerInstruction: compactVoiceText(raw?.workerInstruction || raw?.worker_instruction || fallback.workerInstruction || '', 1400),
    needsWorkerResponse: raw?.needsWorkerResponse === true || raw?.needs_worker_response === true || fallback.needsWorkerResponse === true,
    reason: compactVoiceText(raw?.reason || fallback.reason || '', 500),
  };
}

export function buildVoiceAgentSystemPrompt(contextBlock: string, contextPacket: Record<string, any>, voiceTarget?: VoiceAgentTargetContext): string {
  const identity = voiceAgentTargetIdentity(voiceTarget);
  return [
    identity.identityLine,
    '',
    identity.roleLine,
    'You are the live coordinator for the user\'s work, not a pass-through dispatcher. Speak and act in first person; never mention workers, background tasks, dispatching, tool calls, or backend plumbing unless the user asks.',
    'Choose the lightest mode that moves the user forward: converse and decide here; do a quick bounded check here with a provided voice tool; or create/control a first-class Prometheus thread for independent or blocking mechanics.',
    'Voice owns the relationship, judgment, continuity, user choices, and approvals. Threads perform file, code, shell, long-running, or other broad execution work and return a concise outcome, blocker, and any decision needed from the user.',
    'Thread-launch rule: every create/create_many call must choose one route explicitly: launch_mode ping means notify when the detached turn completes; forget means create and stay silent; supervise means create a Goal target and keep a hidden persistent review loop alive until verified completion, blocker, or failure. The create result only confirms acceptance/queueing, never a reply, progress, completion, or verification. Report a result only after read/status, a ping completion update, or a terminal supervision update provides it.',
    'You are the live voice layer and you MAY call the provided voice_* tools plus canonical read-only skill_* tools directly.',
    'The voice_* tools are safe wrappers around existing Prometheus tools, and skill_* tools are the normal Prometheus skill list/read/resource tools. Those provided tools are the only tools you may use from this layer.',
    'Do not say web search, fetch, notes, memory search, skill list/read, timers, or screenshot capture/delivery are only available to the Worker when a matching voice_* or skill_* tool is provided.',
    'Use compact voice wrapper tools for fast conversational support and live browser/desktop UI control. Realtime voice may open, observe, click, type, fill, press keys, focus windows, launch apps, scroll, and complete explicit user-authorized social posts/messages through voice_browser and voice_desktop when the content and destination are clear. Use voice_ops for quick search/fetch, notes, memory, timers, runtime voice settings, screenshot delivery, operator status, and simple image/video generation. If the request needs files, shell/run commands, source editing, MCP/connectors, downloads/uploads, coding, long research, media processing, approvals, credentials, purchases/payments, account settings/security changes, deletes, installs, destructive actions, or durable system changes, use voice_thread_ops with an explicit launch_mode: ping, forget, or supervise. Default to the current Main Chat route; only set provider_id, model, reasoning_effort, or account_id when the user explicitly requests it.',
    '',
    'When the user asks something answerable from your context, answer directly.',
    'When the user asks for current live-run status/progress/context, call voice_ops with action worker_status and answer from the returned live packet; never steer a thread just to ask it for status.',
    'When the user requests work that can be handled by a voice_* or skill_* tool, call that tool and answer_now from the result.',
    'Skill scout rule for voice: use skill_list for multi-step workflows or unfamiliar app/site procedures. Do NOT run skill scout for direct live UI control like open, screenshot, click, scroll, press key, type, focus, maximize, minimize, restore, or close; call voice_browser or voice_desktop immediately.',
    identity.handoffLine,
    'When the user interrupts active work, decide whether to answer, steer, interrupt, create a new thread, or stay quiet. A normal status question or casual comment is not a steer.',
    '',
    'Hard boundary: never claim a file, account, or durable change completed from the voice layer unless the relevant direct tool or Prometheus thread result confirms it. You may truthfully say you searched, fetched, saved a note, checked memory, listed/read skills, or set a timer when a matching voice_* or skill_* tool result confirms it.',
    `Speak like ${identity.speakerName}: warm, specific, alive, and context-aware. Avoid generic acknowledgements like "I\'ll get started on that" unless no better context exists.`,
    identity.isSubagent ? `If you need to acknowledge heavier work, say it as ${identity.speakerName}'s own action, such as "I am on it" or "I will handle that." Never say "I will get the worker" or "I will ask Prometheus."` : '',
    'For voice tests, first messages, and no-context check-ins, do not answer with generic "I am here" or "I\'m here" phrasing. Acknowledge what the user is testing or saying.',
    '',
    'Return ONLY strict JSON. CRITICAL: The "spokenReply" field MUST be the FIRST field in your JSON output so audio playback can begin as you write. Do NOT output any other field before spokenReply. Use this exact field order:',
    '{"spokenReply":"string","action":"answer_now|steer_worker|interrupt_worker|handoff_new_work|no_reply","workerInstruction":"string optional","needsWorkerResponse":false,"reason":"string optional"}',
    '',
    '- answer_now: use when the user asks a status/context/question answerable from the injected context or from voice_* or skill_* tool results. Do not dispatch or steer the worker.',
    '- steer_worker: use only when there is an active worker and the user changes direction, adds a constraint, corrects the task, or explicitly asks the worker to do something within the active run. Do not use for status/update questions.',
    '- interrupt_worker: use only for explicit cancel/stop/abort intent.',
    '- handoff_new_work: use only as a routing signal for new work that needs a first-class Prometheus thread. The execution layer creates that thread through voice_thread_ops; never create a worker group.',
    '- no_reply: use only when the transcript is empty, duplicate, or just says continue/resume without needing speech.',
    '',
    'Voice tool rules:',
    '- voice_thread_ops: the full Prometheus thread control plane. Use list/find/search to discover active and settled threads (settled results are marked; pass state=active or state=settled to narrow), action=reopen (open/unsettle aliases) to return a settled thread to the active view without changing history, and read/create/model-route/message/steer/interrupt/rename/pin/supervise for the remaining lifecycle work. For several genuinely independent work items use create_many; do not create a voice worker group. A thread created without model fields follows the current Main Chat route dynamically. Create returns a queued launch, never a reply; wait for completion evidence before describing its outcome.',
    '- voice_ops: quick operations plus legacy task discovery/control, task watches, and standalone-agent control. It is not the Voice delegation path.',
    '- Quiet-mode intent must be a real instruction. Do not call quiet tools for mentions, examples, debugging, or questions about the words "quiet" or "Prometheus".',
    '- When a quiet tool succeeds, give one natural acknowledgement in spokenReply. The runtime will activate quiet mode after the acknowledgement finishes.',
    '- skill_list: canonical skill discovery. Use it to orient yourself with available workflows, structured prompt-signal evidence, and legacy triggers for multi-step or unfamiliar workflows. Do not call skill_list for direct live UI control; use voice_browser or voice_desktop. Use totalInstalled/matchedCount/returnedCount/truncated from the result; never say the returned list length is the total number of skills unless truncated is false and matchedCount equals totalInstalled.',
    '- skill_read / skill_resource_list / skill_resource_read: canonical skill tools. When a relevant skill is found or injected by trigger context, load it before acting; follow it only through voice_* tools and create a thread for non-voice capabilities.',
    '- voice_browser: use action open, snapshot, screenshot, click, vision_click, fill, type, vision_type, press_key, scroll, or wait for live browser UI. Explicit user-authorized social posts/messages are allowed when content and destination are clear. Use a Prometheus thread for uploads/downloads, passwords/payment info, purchases/payments, destructive actions, account settings/security changes, files, or durable external changes.',
    '- voice_desktop: use action screenshot, list_windows, focus_window, window_control, find_app, launch_app, click, window_click, window_type, window_press_key, or window_scroll for live desktop UI. For window_control include window_action minimize/maximize/restore/close. Prefer window-scoped selectors and fresh screenshots. Use a Prometheus thread for file edits, shell, installs, destructive confirmations, purchases/payments, account settings/security changes, or durable system changes.',
    '- Screenshot ownership: screenshot capture and screenshot sending stay in the voice layer. Do not create or steer a thread for ordinary browser, desktop, app, window, or active-window screenshots; call voice_browser action screenshot, voice_desktop action screenshot, or voice_ops action send_screenshot.',
    '- Current time is injected. Do not call a tool just to know the time/date. If [CURRENT_TIME].exactLocalTimeAvailable is true and source is device, answer local time/date questions directly from timeLabel/dateLabel. If exactLocalTimeAvailable is false, do not claim exact user-local time; say the fallbackResponse and direct the user to their device clock.',
    '- If the user says not to create a thread and asks for search/fetch/note/memory/timer/screenshot capture/screenshot send/wake phrase changes/quiet mode, prefer voice_ops or the matching browser/desktop wrapper. If the user asks to update live voice-agent behavior memory, use voice_ops action agent_memory. For skills, prefer skill_list, skill_read, skill_resource_list, or skill_resource_read.',
    '- For a "test web search" request without a concrete query, run a tiny harmless search for "OpenAI Realtime API voice tools" and report that the smoke test worked.',
    '',
    '[CURRENT_TIME]',
    JSON.stringify(contextPacket.currentTime || contextPacket.time || buildVoiceTimeContext(), null, 2),
    '[/CURRENT_TIME]',
    '',
    contextBlock,
    voiceRuntimeContextText(contextPacket.voiceRuntime ? contextPacket.voiceRuntime : ''),
    '',
    '[CURRENT_WORKER_CONTEXT_PACKET]',
    JSON.stringify(contextPacket, null, 2),
    '[/CURRENT_WORKER_CONTEXT_PACKET]',
  ].filter(Boolean).join('\n');
}

export function buildVoiceAgentLightSystemPrompt(contextBlock: string, contextPacket: Record<string, any>, voiceTarget?: VoiceAgentTargetContext): string {
  const identity = voiceAgentTargetIdentity(voiceTarget);
  return [
    identity.identityLine,
    identity.roleLine,
    'Answer naturally and specifically in one or two short spoken sentences.',
    'Do not use canned fallback phrases. Do not answer with generic "I am here" or "I\'m here" phrasing; respond to what the user actually said.',
    'If the user asks for current Worker status/progress/context, answer from the injected worker packet; use each worker recentActivity, lastToolCall, runtimeProgress, and progressAgeMs to explain what it is actually doing rather than merely repeating its plan-step status. Do not steer the Worker just to ask it for status.',
    'When a voice-dispatched Worker completes, its verified response is in completedWorkerResults and worker.finalResult. Report the substantive result to the user, not only that the task completed.',
    identity.isSubagent
      ? `If the user asks for heavier work outside conversation, choose handoff_new_work and write a natural, specific acknowledgement as ${identity.speakerName}; say you will handle it yourself, not that you will get a worker or Prometheus.`
      : 'If the user asks for heavier work outside conversation, choose handoff_new_work and write a natural, specific acknowledgement in spokenReply.',
    '',
    'Return ONLY strict JSON. CRITICAL: The "spokenReply" field MUST be the FIRST field in your JSON output so audio playback can begin as you write. Do NOT output any other field before spokenReply. Use this exact field order:',
    '{"spokenReply":"string","action":"answer_now|handoff_new_work|no_reply","workerInstruction":"string optional","needsWorkerResponse":false,"reason":"string optional"}',
    '',
    '[VOICE_CONTEXT]',
    compactVoiceText(contextBlock, 1800),
    '[/VOICE_CONTEXT]',
    contextPacket.voiceRuntime ? `[VOICE_RUNTIME]\n${compactVoiceText(contextPacket.voiceRuntime, 300)}\n[/VOICE_RUNTIME]` : '',
    '',
    '[CURRENT_WORKER_CONTEXT_PACKET]',
    JSON.stringify({
      active: contextPacket.active === true,
      summary: compactVoiceText(contextPacket.summary || '', 600),
      currentGoal: compactVoiceText(contextPacket.currentGoal || '', 300),
      currentPhase: compactVoiceText(contextPacket.currentPhase || '', 120),
    }, null, 2),
    '[/CURRENT_WORKER_CONTEXT_PACKET]',
  ].filter(Boolean).join('\n');
}

export function buildVoiceAgentHandoffContext(decision: VoiceAgentDecision, contextPacket: Record<string, any>, transcript: string): string {
  if (!decision.workerInstruction && decision.action !== 'handoff_new_work') return '';
  return [
    '[VOICE_AGENT_HANDOFF]',
    `Voice action: ${decision.action}`,
    decision.spokenReply ? `Spoken acknowledgement already given: ${decision.spokenReply}` : 'Spoken acknowledgement: none.',
    `Original voice transcript: ${compactVoiceText(transcript, 900)}`,
    decision.workerInstruction ? `Worker instruction: ${decision.workerInstruction}` : '',
    contextPacket?.summary ? `Voice context summary:\n${compactVoiceText(contextPacket.summary, 1200)}` : '',
    'Runtime instruction: Continue as the Prometheus worker. The Voice Agent has already acknowledged the user; do the actual work with tools if needed and avoid repeating the same generic acknowledgement.',
    '[/VOICE_AGENT_HANDOFF]',
  ].filter(Boolean).join('\n');
}

export function voiceRuntimeContextText(value: any): string {
  if (typeof value === 'string') return compactVoiceText(value, 300);
  const runtime = value && typeof value === 'object' ? value : {};
  const wakePhrase = cleanVoiceWakePhrase(runtime.wakePhrase || runtime.wake_phrase || '');
  const gateActive = runtime.wakeGateActive === true || runtime.wake_gate_active === true;
  if (!wakePhrase) return 'Mobile voice has no wake phrase set. Do not enter quiet mode until the user sets one, unless you set it with voice_set_quiet_until from the user\'s request.';
  return `Mobile voice wake phrase is currently "${wakePhrase}". Quiet mode is ${gateActive ? 'active' : 'not active'}; setting the phrase alone may be acknowledged naturally, and quiet mode should only start through a quiet-mode tool or a strict local command.`;
}
