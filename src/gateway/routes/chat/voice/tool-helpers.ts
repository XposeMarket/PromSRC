import {
  executeShoppingSearchProducts,
  executeWebSearch,
  executeWebFetch,
} from '../../../../tools/web';
import { executeWeatherLookup } from '../../../../tools/weather';
import { executeMarketLookup } from '../../../../tools/market';
import { executeStockLookup } from '../../../../tools/stocks';
import { executePolymarketLookup } from '../../../../tools/polymarket';
import { executeMapLookup } from '../../../../tools/mapcard';
import {
  collectRichArtifacts,
  extractVisualArtifactsFromMarkdown,
  normalizeProductArtifactItems,
  normalizeSourceArtifactItems,
  productCarouselToArtifact,
} from '../../../rich-artifacts';
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
import path from 'path';
import fs from 'fs';
import { ensurePrometheusThreadOpsForSupervision, getAgentTeamScheduleTools } from '../../../tools/defs/agent-team-schedule';
import { compactVoiceText } from './context';
import { broadcastVoiceScreenshotPreview } from './decision';
import { _skillsManager } from './dependencies';


export function buildVoiceTimeContext(clientTime?: any): Record<string, any> {
  const raw = clientTime && typeof clientTime === 'object' ? clientTime : {};
  const localIso = String(raw.localIso || raw.local_iso || raw.nowIso || raw.now_iso || '').trim();
  const parsedClientTime = localIso ? new Date(localIso) : null;
  const hasValidClientTime = !!(parsedClientTime && Number.isFinite(parsedClientTime.getTime()));
  const cleanTimezone = String(raw.timezone || raw.timeZone || raw.tz || '').trim();
  const cleanDateLabel = compactVoiceText(raw.dateLabel || raw.date_label || '', 120);
  const cleanTimeLabel = compactVoiceText(raw.timeLabel || raw.time_label || '', 80);
  const offsetMinutes = Number(raw.utcOffsetMinutes ?? raw.utc_offset_minutes);

  if (hasValidClientTime) {
    return {
      source: 'device',
      exactLocalTimeAvailable: true,
      nowIso: parsedClientTime!.toISOString(),
      timezone: cleanTimezone || 'device-local',
      utcOffsetMinutes: Number.isFinite(offsetMinutes) ? offsetMinutes : undefined,
      dateLabel: cleanDateLabel || parsedClientTime!.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      timeLabel: cleanTimeLabel || parsedClientTime!.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
      capturedAt: Number.isFinite(Number(raw.capturedAt || raw.captured_at)) ? Number(raw.capturedAt || raw.captured_at) : undefined,
      instruction: 'This came from the user device at Realtime voice bootstrap. You may answer local date/time questions from this value, while allowing for normal elapsed time since capture.',
    };
  }

  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'gateway-local';
  return {
    source: 'gateway_fallback',
    exactLocalTimeAvailable: false,
    nowIso: now.toISOString(),
    timezone,
    dateLabel: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    timeLabel: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    fallbackResponse: 'I do not have your exact device-local time available. Please check your device clock for the precise time.',
    instruction: 'This is gateway/server time, not verified user device time. Do not claim exact local time from it.',
  };
}

export function voiceToolResult(ok: boolean, summary: string, data: Record<string, any> = {}): string {
  return JSON.stringify({
    ok,
    summary: compactVoiceText(summary, 1200),
    ...data,
  }, null, 2);
}

export const VOICE_SHOW_ARTIFACT_TOOLS = new Set([
  'show_weather', 'show_market', 'show_stocks', 'show_prediction_market', 'show_map',
  'show_sources', 'show_comparison', 'show_chart', 'show_product_carousel', 'show_agent_work', 'show_run_result',
  'show_card_currency', 'show_card_clock', 'show_card_news', 'show_card_gallery', 'show_card_video', 'show_card_sports',
  'show_card_places', 'show_card_product',
]);

// Build a rich-artifact + spoken summary for a voice show_* tool call. The artifact
// is returned to the client (in the tool result) so it renders a card in chat while
// the realtime model speaks the summary. Read/fetch tools hit keyless APIs; the rest
// are assembled from the model-provided args.
export async function buildVoiceShowArtifact(name: string, args: Record<string, any>): Promise<{ ok: boolean; summary: string; artifact: any | null }> {
  const fromLookup = (tr: any, fallback: string) => ({
    ok: tr?.success !== false,
    summary: String(tr?.stdout || tr?.error || fallback),
    artifact: tr?.extra?.richArtifacts?.[0] || null,
  });
  if (name.startsWith('show_card_')) {
    const { UI_CARD_BUILDERS, buildProductCard } = await import('../../../../tools/ui-cards.js');
    const type = name.slice('show_card_'.length);
    const builder = type === 'product'
      ? (p: any) => buildProductCard(p, undefined, async (query) => {
        const tr: any = await executeShoppingSearchProducts({ query, max_results: 4, include_images: false });
        return tr?.extra?.richArtifacts?.[0]?.items || tr?.data?.items || [];
      })
      : UI_CARD_BUILDERS[type];
    if (!builder) return { ok: false, summary: 'Unknown card.', artifact: null };
    return fromLookup(await builder(args), 'Card unavailable.');
  }
  switch (name) {
    case 'show_weather':
      return fromLookup(await executeWeatherLookup({ location: args.location, latitude: args.latitude, longitude: args.longitude, unit: args.unit, days: args.days }), 'Weather unavailable.');
    case 'show_market':
      return fromLookup(await executeMarketLookup({ coins: args.coins ?? args.symbols ?? args.query, vs_currency: args.vs_currency, sparkline: args.sparkline }), 'Market data unavailable.');
    case 'show_stocks':
      return fromLookup(await executeStockLookup({ symbols: args.symbols ?? args.tickers ?? args.query, range: args.range }), 'Stock data unavailable.');
    case 'show_prediction_market':
      return fromLookup(await executePolymarketLookup({ query: args.query, slug: args.slug, limit: args.limit }), 'No prediction markets found.');
    case 'show_map':
      return fromLookup(await executeMapLookup({ markers: Array.isArray(args.markers) ? args.markers : [], center: args.center, zoom: args.zoom, title: args.title }), 'Map unavailable.');
    case 'show_product_carousel': {
      let normalized = normalizeProductArtifactItems(Array.isArray(args.items) ? args.items : []);
      const query = compactVoiceText(args.query || args.title || '', 220);
      let searchSource = String(args.source || '').trim();
      if (!normalized.length && query) {
        const search = await executeShoppingSearchProducts({
          query,
          merchant: String(args.merchant || '').trim() || undefined,
          max_results: Math.max(2, Math.min(10, Number(args.limit || args.max_results || 6) || 6)),
          // Match the worker's preferred-provider default. Multi-provider
          // shopping is still available when the caller explicitly asks for it.
          provider: args.provider ? String(args.provider).toLowerCase() as any : undefined,
          include_metadata: false,
          include_images: false,
        });
        normalized = normalizeProductArtifactItems(Array.isArray(search?.data?.products) ? search.data.products : []);
        searchSource = searchSource || 'shopping_search_products';
        if (!normalized.length) {
          return { ok: false, summary: String(search?.error || `No carousel-ready products found for "${query}".`), artifact: null };
        }
      }
      // Search results already contain the title, URL, price, and thumbnail
      // fields needed by the card. Do not synchronously revisit every merchant
      // URL from realtime voice; the worker can perform the richer metadata pass
      // when the user asks for deeper product research.
      const items = normalized
        .slice(0, 8)
        .map((item, index) => ({ id: `voice_product_${index + 1}`, ...item }));
      const artifact = productCarouselToArtifact({ title: args.title || query, source: searchSource, items });
      return { ok: !!artifact, summary: artifact ? `Showing ${artifact.items.length} product(s)${query ? ` for "${query}"` : ''}.` : (query ? `No products found for "${query}".` : 'A product query or product items are required.'), artifact };
    }
    case 'show_sources': {
      let normalized = normalizeSourceArtifactItems(Array.isArray(args.items) ? args.items : []);
      const query = compactVoiceText(args.query || '', 220) || 'latest news';
      if (!normalized.length) {
        const search = await executeWebSearch({
          query,
          max_results: Math.max(1, Math.min(10, Number(args.limit || args.max_results || 5) || 5)),
          ...(args.provider ? { provider: String(args.provider).toLowerCase() as any } : {}),
          ...(args.multi_engine === true ? { multi_engine: true } : {}),
          ...(args.provider_timeout_ms != null ? { provider_timeout_ms: Number(args.provider_timeout_ms) } : {}),
        });
        const rows = Array.isArray(search?.data?.results) ? search.data.results
          : Array.isArray(search?.data?.items) ? search.data.items
            : [];
        normalized = normalizeSourceArtifactItems(rows);
        if (!normalized.length) {
          return { ok: false, summary: String(search?.error || `No sources found for "${query}".`), artifact: null };
        }
      }
      // Search results already contain the title, URL, and snippet needed by
      // the card. Do not synchronously revisit every source URL from realtime
      // voice; the worker can perform the full metadata/image-cache pass.
      const items = normalized.slice(0, 8);
      if (!items.length) return { ok: false, summary: `No sources found for "${query}".`, artifact: null };
      return { ok: true, summary: `Showing ${items.length} source(s) for "${query}".`, artifact: { id: `sources-${Date.now()}`, type: 'sources', title: args.title || query, layout: args.layout === 'list' ? 'list' : 'cards', items } };
    }
    case 'show_comparison': {
      const columns = (Array.isArray(args.columns) ? args.columns : []).filter((c: any) => c && c.key);
      const rows = Array.isArray(args.rows) ? args.rows : [];
      if (!columns.length || !rows.length) return { ok: false, summary: 'Nothing to compare.', artifact: null };
      return { ok: true, summary: `Comparison of ${rows.length} item(s).`, artifact: { id: `comparison-${Date.now()}`, type: 'comparison', title: args.title, columns, rows, labelKey: args.labelKey, highlightColumn: args.highlightColumn } };
    }
    case 'show_chart': {
      const series = (Array.isArray(args.series) ? args.series : []).map((s: any) => ({
        ...s,
        points: (Array.isArray(s?.points) ? s.points : (Array.isArray(s?.data) ? s.data : []))
          .map((point: any, index: number) => ({ x: point?.x ?? point?.label ?? point?.date ?? point?.time ?? index + 1, y: Number(point?.y ?? point?.value) }))
          .filter((point: any) => Number.isFinite(point.y)),
      })).filter((s: any) => s.points.length);
      if (!series.length) return { ok: false, summary: 'No chart data.', artifact: null };
      return { ok: true, summary: 'Showing the chart.', artifact: { id: `chart-${Date.now()}`, type: 'chart', title: args.title, chartType: ['line', 'bar', 'area', 'scatter', 'pie', 'doughnut'].includes(args.chartType) ? args.chartType : 'line', series, xLabel: args.xLabel, yLabel: args.yLabel, unit: args.unit, stacked: args.stacked === true, source: args.source, updatedAt: args.updatedAt } };
    }
    case 'show_agent_work':
      return { ok: true, summary: 'Here is the snapshot.', artifact: { id: `agent_work-${Date.now()}`, type: 'agent_work', greeting: args.greeting, title: args.title, subtitle: args.subtitle, summaryRows: args.summaryRows, priorities: args.priorities, teams: args.teams, activeWork: args.activeWork } };
    case 'show_run_result':
      return { ok: true, summary: String(args.title || 'Task complete.'), artifact: { id: `run_result-${Date.now()}`, type: 'run_result', title: String(args.title || 'Task complete'), taskId: args.taskId, status: args.status, summary: args.summary, files: args.files, links: args.links } };
    default:
      return { ok: false, summary: 'Unknown card.', artifact: null };
  }
}

export const VOICE_SKILL_RESOURCE_MAX_CHARS = 5000;

export const VOICE_TOOL_EQUIVALENTS: Record<string, string> = {
  web_search: 'voice_ops action web_search',
  web_fetch: 'voice_ops action web_fetch',
  automation_dashboard: 'voice_ops action automation_dashboard',
  browser_open: 'voice_browser action open',
  browser_snapshot: 'voice_browser action snapshot',
  browser_screenshot: 'voice_browser action screenshot',
  browser_click: 'voice_browser action click',
  browser_vision_click: 'voice_browser action vision_click',
  browser_fill: 'voice_browser action fill',
  browser_type: 'voice_browser action type',
  browser_vision_type: 'voice_browser action vision_type',
  browser_press_key: 'voice_browser action press_key',
  browser_scroll: 'voice_browser action scroll',
  browser_wait: 'voice_browser action wait',
  desktop_screenshot: 'voice_desktop action screenshot',
  desktop_click: 'voice_desktop action click',
  desktop_window_control: 'voice_desktop action window_control',
  desktop_list_windows: 'voice_desktop action list_windows',
  desktop_focus_window: 'voice_desktop action focus_window',
  desktop_find_app: 'voice_desktop action find_app',
  desktop_launch_app: 'voice_desktop action launch_app',
  desktop_window_click: 'voice_desktop action window_click',
  desktop_window_type: 'voice_desktop action window_type',
  desktop_window_press_key: 'voice_desktop action window_press_key',
  desktop_window_scroll: 'voice_desktop action window_scroll',
  memory_search: 'voice_ops action memory_search',
  write_note: 'voice_ops action write_note',
};

export function voiceToolEquivalentForSkillTool(toolName: unknown): string {
  const tool = String(toolName || '').trim();
  if (!tool) return '';
  if (VOICE_TOOL_EQUIVALENTS[tool]) return VOICE_TOOL_EQUIVALENTS[tool];
  if (tool.startsWith('voice_')) return tool;
  if (tool.startsWith('browser_')) return 'voice_browser wrapper where available';
  if (tool.startsWith('desktop_')) return 'voice_desktop wrapper where available';
  return '';
}

export function buildVoiceSkillRuntimeGuidance(skill: any): string {
  const requiredTools = Array.isArray(skill?.requiredTools) ? skill.requiredTools : [];
  const equivalents = requiredTools
    .map((tool: unknown) => {
      const voiceTool = voiceToolEquivalentForSkillTool(tool);
      return voiceTool ? `${tool} -> ${voiceTool}` : '';
    })
    .filter(Boolean)
    .slice(0, 12);
  return [
    'Use this skill as workflow guidance inside Realtime voice.',
    'Call only provided voice_* tools and canonical read-only skill_* tools from this layer. Explicit user-authorized social posts/messages are allowed through voice browser/desktop UI tools when the content and destination are clear. If the skill needs files, shell commands, downloads/uploads, credentials, source edits, purchases/payments, account settings/security changes, destructive submits, or durable system changes, create or steer a first-class Prometheus thread with voice_thread_ops instead.',
    equivalents.length ? `Voice-safe tool equivalents: ${equivalents.join('; ')}.` : '',
  ].filter(Boolean).join(' ');
}

export function summarizeVoiceSkill(skill: any): Record<string, any> {
  const promptSignals = skill?.promptSignals || {};
  return {
    id: skill?.id || '',
    name: skill?.name || skill?.id || '',
    description: compactVoiceText(skill?.description || skill?.instructions || '', 260),
    triggers: Array.isArray(skill?.triggers) ? skill.triggers.slice(0, 8) : [],
    promptSignals: {
      phrases: Array.isArray(promptSignals.phrases) ? promptSignals.phrases.slice(0, 8) : [],
      allOf: Array.isArray(promptSignals.allOf) ? promptSignals.allOf.slice(0, 4) : [],
      anyOf: Array.isArray(promptSignals.anyOf) ? promptSignals.anyOf.slice(0, 8) : [],
      noneOf: Array.isArray(promptSignals.noneOf) ? promptSignals.noneOf.slice(0, 8) : [],
      minScore: promptSignals.minScore,
    },
    requiredTools: Array.isArray(skill?.requiredTools) ? skill.requiredTools.slice(0, 10) : [],
    status: skill?.status || '',
    eligibility: skill?.eligibility?.status || '',
    riskLevel: skill?.riskLevel || '',
  };
}

export function buildRealtimeSkillContextForTranscript(transcript: string, maxChars = 4200): { context: string; skills: Record<string, any>[] } {
  const text = String(transcript || '').trim();
  if (!text || !_skillsManager) return { context: '', skills: [] };
  _skillsManager.scanSkillsIfStale?.();
  const routing = _skillsManager.resolveRuntimeRouting(text);
  const matchedCandidates = routing.candidates.slice(0, 5);
  const matched = matchedCandidates.map((item: any) => item.id)
    .map((id: string) => _skillsManager.get(id))
    .filter(Boolean)
    .slice(0, 5);
  if (!matched.length && !routing.discoveryRecommended) return { context: '', skills: [] };
  const skillLines = matched.map((skill: any) => {
    const candidate = matchedCandidates.find((item: any) => item.id === skill.id);
    const matchedSignals = Array.isArray(candidate?.promptSignalEvidence) && candidate.promptSignalEvidence.length
      ? ` Matched prompt signals: ${candidate.promptSignalEvidence.slice(0, 4).join(', ')}.`
      : '';
    const triggers = Array.isArray(skill.triggers) && skill.triggers.length
      ? ` Triggers: ${skill.triggers.slice(0, 6).join(', ')}.`
      : '';
    const required = Array.isArray(skill.requiredTools) && skill.requiredTools.length
      ? ` Required tools: ${skill.requiredTools.slice(0, 8).join(', ')}.`
      : '';
    const status = skill?.eligibility?.status && skill.eligibility.status !== 'ready'
      ? ` Eligibility: ${skill.eligibility.status}.`
      : '';
    return `- ${skill.id} [CANDIDATE ONLY] (${skill.name || skill.id}): ${compactVoiceText(skill.description || '', 180)}.${matchedSignals}${triggers}${required}${status}`;
  });
  const context = [
    '## Realtime Skill Trigger Update',
    'The just-completed spoken turn was evaluated by the canonical deterministic skill resolver.',
    'This is metadata for the current audio turn only, not a second user message or a transcript repeat.',
    routing.candidates.length ? 'Compare the candidates against the full spoken request. Call skill_read for every candidate that covers part of the task, together, before acting; skip candidates that only share words with the request.' : '',
    routing.discoveryRecommended ? 'This is an actionable task and no installed skill matched by trigger. Call skill_list with a concise query, then skill_read every strong result that covers part of the task. Continue without a skill if nothing strong exists.' : '',
    ...skillLines,
    'Use skill guidance only through voice_* tools and canonical read-only skill_* tools. Explicit user-authorized social posts/messages are allowed through voice browser/desktop UI tools when the content and destination are clear. Dispatch to the Prometheus worker for non-voice tools, files, shell, uploads/downloads, credentials, purchases/payments, account settings/security changes, destructive submits, or durable changes.',
  ].join('\n');
  return {
    context: compactVoiceText(context, maxChars),
    skills: matched.map(summarizeVoiceSkill),
  };
}

export async function captureVoiceBrowserObservation(
  sessionId: string,
  tool: string,
  includeScreenshot: boolean = true,
): Promise<Record<string, any>> {
  if (includeScreenshot === false) {
    await broadcastVoiceBrowserStatus(sessionId, tool, null).catch(() => {});
    return {};
  }
  const shot = await browserVisionScreenshot(sessionId).catch(() => null);
  await broadcastVoiceBrowserStatus(sessionId, tool, shot).catch(() => {});
  if (!shot?.base64) return {};
  broadcastVoiceScreenshotPreview(sessionId, 'browser', tool, shot);
  return { width: shot.width, height: shot.height, mimeType: shot.mimeType || 'image/png' };
}

export async function broadcastVoiceBrowserStatus(sessionId: string, tool: string, shot?: any): Promise<void> {
  const info = getBrowserSessionInfo(sessionId);
  if (!info?.active) return;
  const payload = {
    type: 'browser:status',
    sessionId,
    tool,
    active: true,
    url: info.url || '',
    title: info.title || '',
    statusLabel: tool === 'voice_browser_open' ? 'Browser opened.' : 'Voice browser action complete.',
    mode: info.mode || 'agent',
    captured: info.captured === true,
    controlOwner: info.controlOwner || 'agent',
    streamActive: info.streamActive === true,
    streamTransport: info.streamTransport || '',
    streamFocus: info.streamFocus || 'passive',
    browserTarget: info.browserTarget || '',
    profileKind: info.profileKind || '',
    profileLabel: info.profileLabel || '',
    profileDir: info.profileDir || '',
    debugPort: info.debugPort || 0,
    frameBase64: shot?.base64 || '',
    frameWidth: Number(shot?.width || 0),
    frameHeight: Number(shot?.height || 0),
    frameFormat: shot?.base64 ? 'png' : '',
    browserOwnerType: 'main',
    browserOwnerId: '',
    browserLabel: 'Voice Agent browser',
    browserTaskPrompt: '',
    browserSpawnerSessionId: '',
    timestamp: Date.now(),
  };
  broadcastWS(payload);
  if (tool === 'voice_browser_open' || tool === 'voice_browser_snapshot') {
    broadcastWS({ ...payload, type: 'browser:open' });
  }
}

export function voiceDesktopWindowSelector(args: Record<string, any>): { window_token?: string; window_id?: string; window_handle?: number; app_id?: string; title?: string } {
  return {
    window_token: args?.window_token == null && args?.windowToken == null ? undefined : String(args.window_token ?? args.windowToken),
    window_id: args?.window_id == null ? undefined : String(args.window_id),
    window_handle: args?.window_handle == null && args?.handle == null ? undefined : Number(args.window_handle ?? args.handle),
    app_id: args?.app_id == null && args?.appId == null ? undefined : String(args.app_id ?? args.appId),
    title: args?.title == null && args?.name == null ? undefined : String(args.title ?? args.name),
  };
}

export async function captureVoiceDesktopWindowObservation(
  sessionId: string,
  tool: string,
  args: Record<string, any>,
  includeScreenshot: boolean = true,
): Promise<Record<string, any>> {
  if (includeScreenshot === false) return {};
  const selector = voiceDesktopWindowSelector(args);
  const handle = Number(selector.window_handle || 0);
  const title = String(selector.title || '').trim();
  const appId = String(selector.app_id || '').trim();
  await desktopWindowScreenshot(sessionId, {
    ...(selector.window_token ? { window_token: selector.window_token } : {}),
    ...(selector.window_id ? { window_id: selector.window_id } : {}),
    ...(Number.isFinite(handle) && handle > 0 ? { handle } : {}),
    ...(Number.isFinite(handle) && handle > 0 ? { window_handle: handle } : {}),
    ...(appId ? { app_id: appId } : {}),
    ...(title ? { name: title } : {}),
    ...(!title && !(Number.isFinite(handle) && handle > 0) && appId ? { name: appId } : {}),
    active: !title && !(Number.isFinite(handle) && handle > 0) && !appId,
    focus_first: false,
    skipOcr: true,
  }).catch(() => '');
  const packet = getDesktopAdvisorPacket(sessionId);
  if (packet?.screenshotBase64) {
    broadcastVoiceScreenshotPreview(sessionId, 'desktop', tool, {
      base64: packet.screenshotBase64,
      mimeType: packet.screenshotMime || 'image/png',
      width: packet.width,
      height: packet.height,
    });
  }
  const target = packet?.targetWindow;
  return packet ? {
    screenshotId: packet.screenshotId,
    width: packet.width,
    height: packet.height,
    targetWindow: target ? {
      title: target.title,
      processName: target.processName,
      handle: target.handle,
    } : undefined,
  } : {};
}

export async function captureVoiceDesktopObservation(
  sessionId: string,
  tool: string,
  includeScreenshot: boolean = true,
): Promise<Record<string, any>> {
  if (includeScreenshot === false) return {};
  const result = await desktopScreenshotWithHistory(sessionId, { capture: 'all', skipOcr: true }).catch(() => '');
  const packet = getDesktopAdvisorPacket(sessionId);
  if (packet?.screenshotBase64) {
    broadcastVoiceScreenshotPreview(sessionId, 'desktop', tool, {
      base64: packet.screenshotBase64,
      mimeType: packet.screenshotMime || 'image/png',
      width: packet.width,
      height: packet.height,
    });
  }
  return packet ? {
    screenshotId: packet.screenshotId,
    width: packet.width,
    height: packet.height,
    observation: compactVoiceText(result, 5000),
  } : {};
}

export function voiceRuntimeDirectiveFromToolResult(result: any): Record<string, any> | null {
  if (!result?.runtimeAction) return null;
  const directive: Record<string, any> = {
    action: String(result.runtimeAction || ''),
  };
  const wakePhrase = cleanVoiceWakePhrase(result.wakePhrase);
  if (wakePhrase) directive.wakePhrase = wakePhrase;
  if (result.activateAfterReply === true || result.activate_after_reply === true) directive.activateAfterReply = true;
  if (result.requiresWakePhrase === true || result.requires_wake_phrase === true) directive.requiresWakePhrase = true;
  if (Array.isArray(result.realtimeTools)) directive.tools = result.realtimeTools;
  return directive.action ? directive : null;
}

export function parseVoiceToolArgs(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function isVoiceFetchEscalationUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return /(^|\.)x\.com$|(^|\.)twitter\.com$|(^|\.)tiktok\.com$|(^|\.)instagram\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)facebook\.com$|(^|\.)threads\.net$/i.test(host);
  } catch {
    return false;
  }
}

export function summarizeVoiceSearchResult(result: any): Record<string, any> {
  const stdout = compactVoiceText(result?.stdout || result?.data?.answer || result?.error || '', 1800);
  const rows = Array.isArray(result?.data?.results) ? result.data.results
    : Array.isArray(result?.data?.items) ? result.data.items
      : [];
  const results = rows.slice(0, 5).map((row: any) => ({
    title: compactVoiceText(row?.title || row?.name || '', 160),
    url: compactVoiceText(row?.url || row?.link || '', 240),
    snippet: compactVoiceText(row?.snippet || row?.content || row?.description || '', 260),
  })).filter((row: any) => row.title || row.url || row.snippet);
  return { stdout, results };
}

export function summarizeVoiceMemorySearch(raw: any): Record<string, any> {
  const hits = Array.isArray(raw?.hits) ? raw.hits
    : Array.isArray(raw?.results) ? raw.results
      : Array.isArray(raw?.records) ? raw.records
        : [];
  return {
    count: hits.length,
    hits: hits.slice(0, 5).map((hit: any) => ({
      recordId: compactVoiceText(hit?.recordId || hit?.record_id || hit?.id || '', 120),
      title: compactVoiceText(hit?.title || hit?.canonicalKey || hit?.sourceTitle || hit?.source || '', 180),
      why: compactVoiceText(hit?.whyMatched || hit?.summary || hit?.snippet || hit?.text || hit?.content || '', 360),
      source: compactVoiceText(hit?.sourceType || hit?.source_type || hit?.layer || '', 80),
    })),
  };
}

export function summarizeVoiceAutomationDashboard(data: any): Record<string, any> {
  const counts = data?.counts && typeof data.counts === 'object' ? data.counts : {};
  const jobs = Array.isArray(data?.scheduledJobs) ? data.scheduledJobs : [];
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const watches = Array.isArray(data?.internalWatches) ? data.internalWatches : [];
  const events = Array.isArray(data?.eventQueue) ? data.eventQueue : [];
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const agents = Array.isArray(data?.agents) ? data.agents : [];
  const attentionJobs = jobs
    .filter((job: any) => !['healthy', 'running'].includes(String(job?.health?.state || '').toLowerCase()))
    .slice(0, 5)
    .map((job: any) => ({
      id: compactVoiceText(job?.id || '', 120),
      name: compactVoiceText(job?.name || job?.id || '', 180),
      state: compactVoiceText(job?.health?.state || job?.status || '', 80),
      nextRun: job?.nextRun || null,
      blocker: compactVoiceText(job?.health?.blockerReason || job?.pausedReason || '', 240),
    }));
  const activeTasks = tasks
    .filter((task: any) => /queued|running|paused|stalled|needs_assistance|awaiting_user_input|waiting_subagent/i.test(String(task?.status || '')))
    .slice(0, 6)
    .map((task: any) => ({
      id: compactVoiceText(task?.id || '', 120),
      title: compactVoiceText(task?.title || task?.id || '', 220),
      status: compactVoiceText(task?.status || '', 80),
      step: task?.step || null,
      total_steps: task?.total_steps || null,
      agentId: compactVoiceText(task?.agentId || '', 120),
    }));
  const activeWatches = watches
    .filter((watch: any) => String(watch?.status || '').toLowerCase() === 'active')
    .slice(0, 5)
    .map((watch: any) => ({
      id: compactVoiceText(watch?.id || '', 120),
      label: compactVoiceText(watch?.label || watch?.id || '', 220),
      target: watch?.target || null,
      expiresAt: watch?.expiresAt || null,
    }));
  const agentHighlights = agents.slice(0, 6).map((agent: any) => ({
    id: compactVoiceText(agent?.id || '', 120),
    name: compactVoiceText(agent?.name || agent?.id || '', 140),
    jobs: Number(agent?.jobCount || 0),
    tasks: Number(agent?.taskCount || 0),
    lastOutput: compactVoiceText(agent?.lastOutput || '', 300),
  }));
  return {
    generatedAt: data?.generatedAt || '',
    depth: data?.depth || 'summary',
    counts,
    jobsByHealth: counts.jobsByHealth || {},
    tasksByStatus: counts.tasksByStatus || {},
    attentionJobs,
    activeTasks,
    activeWatches,
    pendingEventCount: events.length,
    teamCount: teams.length,
    agentHighlights,
  };
}

export function resolveVoiceAgentMemoryFilePath(workspacePath: string): string {
  const canonical = path.join(workspacePath, 'VOICEAGENT.md');
  if (fs.existsSync(canonical)) return canonical;
  const lower = path.join(workspacePath, 'voiceagent.md');
  if (fs.existsSync(lower)) return lower;
  return canonical;
}

export function readVoiceAgentMemoryFile(workspacePath: string): { filePath: string; content: string } {
  const filePath = resolveVoiceAgentMemoryFilePath(workspacePath);
  if (!fs.existsSync(filePath)) return { filePath, content: '' };
  return { filePath, content: fs.readFileSync(filePath, 'utf-8') };
}

export function formatVoiceAgentMemoryAppend(content: string, category = ''): string {
  const text = String(content || '').trim();
  if (!text) return '';
  const date = new Date().toISOString().slice(0, 10);
  const tag = compactVoiceText(category || 'voice', 60).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'voice';
  return `- ${text} [${date}; ${tag}]`;
}

export function cleanVoiceWakePhrase(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;"'!?-]+|[\s,.:;"'!?-]+$/g, '')
    .trim()
    .slice(0, 80);
}

export const VOICE_WRAPPER_TOOL_NAMES = new Set([
  'voice_browser',
  'voice_desktop',
  'voice_ops',
  'show_ui',
]);

export const VOICE_HIDDEN_COMPAT_TOOL_NAMES = new Set([
  'voice_web_search',
  'voice_web_fetch',
  'voice_write_note',
  'voice_agent_memory',
  'voice_set_wake_phrase',
  'voice_enter_quiet_mode',
  'voice_set_quiet_until',
  'voice_memory_search',
  'voice_timer',
  'voice_browser_screenshot',
  'voice_browser_open',
  'voice_browser_scroll',
  'voice_browser_snapshot',
  'voice_browser_click',
  'voice_browser_vision_click',
  'voice_browser_fill',
  'voice_browser_type',
  'voice_browser_vision_type',
  'voice_browser_press_key',
  'voice_browser_wait',
  'voice_desktop_screenshot',
  'voice_desktop_click',
  'voice_desktop_window_control',
  'voice_desktop_focus_window',
  'voice_desktop_launch_app',
  'voice_desktop_find_app',
  'voice_desktop_list_windows',
  'voice_desktop_window_click',
  'voice_desktop_window_type',
  'voice_desktop_window_press_key',
  'voice_desktop_window_scroll',
  'voice_automation_dashboard',
  'voice_worker_status',
  'voice_task_control',
  'voice_task_directory',
  'voice_task_watch',
  'voice_agent_directory',
  'voice_agent_control',
  'voice_send_screenshot',
  'voice_generate_image',
  'voice_generate_video',
  'show_weather',
  'show_market',
  'show_stocks',
  'show_prediction_market',
  'show_map',
  'show_sources',
  'show_comparison',
  'show_chart',
  'show_product_carousel',
  'show_agent_work',
  'show_run_result',
  'show_card_currency', 'show_card_clock', 'show_card_news', 'show_card_gallery', 'show_card_video', 'show_card_sports',
  'show_card_places', 'show_card_product',
]);

export function stripVoiceWrapperArgs(args: Record<string, any>): Record<string, any> {
  const { action: _action, operation: _operation, op: _op, ...rest } = args || {};
  return rest;
}

export function normalizeVoiceAgentWrapperTool(name: string, args: Record<string, any>): { name: string; args: Record<string, any> } {
  const action = String(args?.action || args?.operation || args?.op || '').trim().toLowerCase();
  const innerArgs = stripVoiceWrapperArgs(args || {});
  if (name === 'show_ui') {
    const target = ({
      weather: 'show_weather',
      market: 'show_market',
      stocks: 'show_stocks',
      prediction_market: 'show_prediction_market',
      map: 'show_map',
      sources: 'show_sources',
      comparison: 'show_comparison',
      chart: 'show_chart',
      product_carousel: 'show_product_carousel',
      products: 'show_product_carousel',
      agent_work: 'show_agent_work',
      run_result: 'show_run_result',
      currency: 'show_card_currency', clock: 'show_card_clock', news: 'show_card_news', gallery: 'show_card_gallery', images: 'show_card_gallery',
      video: 'show_card_video', sports: 'show_card_sports', places: 'show_card_places', product: 'show_card_product',
    } as Record<string, string>)[action.replace(/^show_/, '')];
    return target ? { name: target, args: innerArgs } : { name, args };
  }
  if (name === 'voice_browser') {
    const target = ({
      screenshot: 'voice_browser_screenshot',
      open: 'voice_browser_open',
      scroll: 'voice_browser_scroll',
      snapshot: 'voice_browser_snapshot',
      page_text: 'voice_browser_get_page_text',
      focused_item: 'voice_browser_get_focused_item',
      click: 'voice_browser_click',
      vision_click: 'voice_browser_vision_click',
      fill: 'voice_browser_fill',
      type: 'voice_browser_type',
      vision_type: 'voice_browser_vision_type',
      press_key: 'voice_browser_press_key',
      drag: 'voice_browser_drag',
      wait: 'voice_browser_wait',
      close: 'voice_browser_close',
    } as Record<string, string>)[action];
    return target ? { name: target, args: innerArgs } : { name, args };
  }
  if (name === 'voice_desktop') {
    const target = ({
      screenshot: 'voice_desktop_screenshot',
      click: 'voice_desktop_click',
      drag: 'voice_desktop_drag',
      scroll: 'voice_desktop_scroll',
      type: 'voice_desktop_type',
      type_raw: 'voice_desktop_type_raw',
      press_key: 'voice_desktop_press_key',
      wait: 'voice_desktop_wait',
      get_clipboard: 'voice_desktop_get_clipboard',
      set_clipboard: 'voice_desktop_set_clipboard',
      monitors: 'voice_desktop_get_monitors',
      window_control: 'voice_desktop_window_control',
      focus_window: 'voice_desktop_focus_window',
      launch_app: 'voice_desktop_launch_app',
      find_app: 'voice_desktop_find_app',
      list_windows: 'voice_desktop_list_windows',
      window_click: 'voice_desktop_window_click',
      window_type: 'voice_desktop_window_type',
      window_press_key: 'voice_desktop_window_press_key',
      window_scroll: 'voice_desktop_window_scroll',
    } as Record<string, string>)[action];
    if (target === 'voice_desktop_window_control' && innerArgs.action == null) {
      const innerAction = args?.window_action ?? args?.windowAction ?? args?.control ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    return target ? { name: target, args: innerArgs } : { name, args };
  }
  if (name === 'voice_ops') {
    const target = ({
      web_search: 'voice_web_search',
      web_fetch: 'voice_web_fetch',
      write_note: 'voice_write_note',
      agent_memory: 'voice_agent_memory',
      set_wake_phrase: 'voice_set_wake_phrase',
      enter_quiet_mode: 'voice_enter_quiet_mode',
      set_quiet_until: 'voice_set_quiet_until',
      memory_search: 'voice_memory_search',
      timer: 'voice_timer',
      automation_dashboard: 'voice_automation_dashboard',
      worker_status: 'voice_worker_status',
      agent_directory: 'voice_agent_directory',
      agent_control: 'voice_agent_control',
      send_screenshot: 'voice_send_screenshot',
      generate_image: 'voice_generate_image',
      generate_video: 'voice_generate_video',
    } as Record<string, string>)[action];
    if (target === 'voice_agent_memory' && innerArgs.action == null) {
      const innerAction = args?.memory_action ?? args?.memoryAction ?? args?.tool_action ?? args?.toolAction ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    if (target === 'voice_timer' && innerArgs.action == null) {
      const innerAction = args?.timer_action ?? args?.timerAction ?? args?.tool_action ?? args?.toolAction ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    if (target === 'voice_task_control' && innerArgs.action == null) {
      const innerAction = args?.task_action ?? args?.taskAction ?? args?.tool_action ?? args?.toolAction ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    if (target === 'voice_task_watch' && innerArgs.action == null) {
      const innerAction = args?.watch_action ?? args?.watchAction ?? args?.tool_action ?? args?.toolAction ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    if (target === 'voice_agent_control' && innerArgs.action == null) {
      const innerAction = args?.agent_action ?? args?.agentAction ?? args?.tool_action ?? args?.toolAction ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    return target ? { name: target, args: innerArgs } : { name, args };
  }
  return { name, args };
}

/**
 * Voice owns the conversation, but thread lifecycle work belongs to the same
 * first-class peer-session control plane used by main Prometheus. Reuse its
 * schema verbatim so Voice never drifts into a second, reduced thread system.
 */
export function buildVoiceThreadOpsDefinition(): any {
  const canonical = getAgentTeamScheduleTools()
    .find((tool: any) => String(tool?.function?.name || tool?.name || '') === 'prometheus_thread_ops');
  if (!canonical?.function) throw new Error('prometheus_thread_ops tool definition is unavailable.');
  return {
    ...canonical,
    function: {
      ...canonical.function,
      name: 'voice_thread_ops',
      description: 'Voice-native control plane for first-class Prometheus chat threads. List/find/search include active and settled chats by default and mark settled results; use state=active or state=settled to narrow results, and action=reopen (open/unsettle aliases) to return a settled chat to the active view without changing its history. For creation choose launch_mode ping (notify when the detached turn completes), forget (no completion notification), or supervise (hidden persistent review loop with terminal verification); action aliases create_and_ping/create_and_forget/create_and_supervise are also valid. Voice remains the user-facing coordinator; threads perform independent or blocking mechanics. Creation only confirms acceptance/queueing, never a target reply, completion, or verification. This is the only Voice delegation path: never create a voice worker group or background task group.',
    },
  };
}
