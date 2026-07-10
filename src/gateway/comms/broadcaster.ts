// src/gateway/broadcaster.ts
// WebSocket broadcast, team SSE registry, notification channels — extracted from server-v2.ts (Step 15.1, Phase 3).
// Exports: wss, broadcastWS, broadcastTeamEvent, addTeamSseClient, removeTeamSseClient,
//          sendTeamNotificationToChannels, resolveChannelsConfig,
//          isModelBusy, setModelBusy, lastMainSessionId, setLastMainSessionId,
//          TelegramChannelConfig, DiscordChannelConfig, WhatsAppChannelConfig, ChannelsConfig

import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { getTeamNotificationTargets } from '../teams/managed-teams';
import { triggerManagerReview } from '../teams/team-manager-runner';

// ─── Model-Busy Guard ──────────────────────────────────────────────────────────
// Prevents cron scheduler from firing while user chat is in-flight.

function readPersistedLastMainSessionId(): string {
  try {
    const p = path.join(getConfig().getConfigDir(), 'gateway-runtime-status.json');
    if (!fs.existsSync(p)) return 'default';
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return String(parsed?.lastMainSessionId || '').trim() || 'default';
  } catch {
    return 'default';
  }
}

let _modelBusyCount = 0;
let _lastMainSessionId = readPersistedLastMainSessionId();
let _runtimeHeartbeatTimer: NodeJS.Timeout | null = null;
let _modelBusySince = 0;
let _lastHeartbeatAt = 0;
let _maxHeartbeatDriftMs = 0;
let _lastHeartbeatDriftEventAt = 0;
let _lastHeartbeatDriftEventMs = 0;
let _lastRestartableHeartbeatDriftAt = 0;
let _lastRestartableHeartbeatDriftMs = 0;
let _eventLoopStallRestartScheduled = false;

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

const EVENT_LOOP_STALL_RESTART_MS = parseNonNegativeIntEnv('PROMETHEUS_GATEWAY_STALL_RESTART_MS', 45_000);
const EVENT_LOOP_STALL_RESTART_MIN_UPTIME_MS = parseNonNegativeIntEnv('PROMETHEUS_GATEWAY_STALL_RESTART_MIN_UPTIME_MS', 120_000);
const EVENT_LOOP_STALL_AUTORESTART_ENABLED =
  process.env.PROMETHEUS_GATEWAY_STALL_AUTORESTART === '1'
  || process.env.PROMETHEUS_GATEWAY_STALL_AUTORESTART === 'true';

function maybeScheduleEventLoopStallRecovery(heartbeatDriftMs: number, now: number): void {
  if (!EVENT_LOOP_STALL_AUTORESTART_ENABLED) return;
  if (EVENT_LOOP_STALL_RESTART_MS <= 0) return;
  if (heartbeatDriftMs < EVENT_LOOP_STALL_RESTART_MS) return;
  if (process.uptime() * 1000 < EVENT_LOOP_STALL_RESTART_MIN_UPTIME_MS) return;
  if (_eventLoopStallRestartScheduled) return;
  _eventLoopStallRestartScheduled = true;

  const seconds = Math.round(heartbeatDriftMs / 1000);
  console.error(`[GatewayRuntime] Event loop stalled for ${seconds}s. Scheduling gateway recovery restart...`);
  const timer = setTimeout(async () => {
    try {
      const { gracefulRestart } = await import('../lifecycle.js');
      await gracefulRestart({
        reason: 'repair',
        timestamp: now,
        previousSessionId: _lastMainSessionId,
        originChannel: _lastMainSessionId.startsWith('mobile_') || _lastMainSessionId === 'mobile_default' ? 'mobile' : 'web',
        title: 'Gateway event-loop stall recovery',
        summary: `Gateway event loop stopped responding for ${seconds}s, so Prometheus restarted itself to recover mobile/web connectivity.`,
      });
    } catch (err: any) {
      console.error('[GatewayRuntime] Event-loop stall recovery restart failed:', err?.message || err);
      process.exit(1);
    }
  }, 250);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();
}

function writeRuntimeStatus(reason = 'heartbeat'): void {
  try {
    const now = Date.now();
    const expectedIntervalMs = 5000;
    const heartbeatDriftMs = _lastHeartbeatAt > 0
      ? Math.max(0, now - _lastHeartbeatAt - expectedIntervalMs)
      : 0;
    _lastHeartbeatAt = now;
    _maxHeartbeatDriftMs = Math.max(_maxHeartbeatDriftMs, heartbeatDriftMs);
    if (heartbeatDriftMs >= 1000) {
      _lastHeartbeatDriftEventAt = now;
      _lastHeartbeatDriftEventMs = heartbeatDriftMs;
    }
    if (EVENT_LOOP_STALL_RESTART_MS > 0 && heartbeatDriftMs >= EVENT_LOOP_STALL_RESTART_MS) {
      _lastRestartableHeartbeatDriftAt = now;
      _lastRestartableHeartbeatDriftMs = heartbeatDriftMs;
    }
    const configDir = getConfig().getConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'gateway-runtime-status.json'), JSON.stringify({
      pid: process.pid,
      timestamp: now,
      reason,
      modelBusy: _modelBusyCount > 0,
      modelBusyCount: _modelBusyCount,
      modelBusySince: _modelBusySince || undefined,
      modelBusyAgeMs: _modelBusyCount > 0 && _modelBusySince > 0 ? now - _modelBusySince : 0,
      lastMainSessionId: _lastMainSessionId,
      heartbeatDriftMs,
      maxHeartbeatDriftMs: _maxHeartbeatDriftMs,
      lastHeartbeatDriftAt: _lastHeartbeatDriftEventAt || undefined,
      lastHeartbeatDriftMs: _lastHeartbeatDriftEventMs || 0,
      lastRestartableHeartbeatDriftAt: _lastRestartableHeartbeatDriftAt || undefined,
      lastRestartableHeartbeatDriftMs: _lastRestartableHeartbeatDriftMs || 0,
      eventLoopStallRestartThresholdMs: EVENT_LOOP_STALL_RESTART_MS,
      eventLoopStallAutoRestartEnabled: EVENT_LOOP_STALL_AUTORESTART_ENABLED,
      eventLoopStallRestartScheduled: _eventLoopStallRestartScheduled,
    }), 'utf-8');
    maybeScheduleEventLoopStallRecovery(heartbeatDriftMs, now);
  } catch {}
}

export function isModelBusy(): boolean { return _modelBusyCount > 0; }
export function setModelBusy(v: boolean): void {
  const wasBusy = _modelBusyCount > 0;
  _modelBusyCount = v ? _modelBusyCount + 1 : Math.max(0, _modelBusyCount - 1);
  const isBusyNow = _modelBusyCount > 0;
  if (!wasBusy && isBusyNow) _modelBusySince = Date.now();
  if (!isBusyNow) _modelBusySince = 0;
  writeRuntimeStatus(_modelBusyCount > 0 ? 'model_busy' : 'model_idle');
}
export function getLastMainSessionId(): string { return _lastMainSessionId; }
export function setLastMainSessionId(v: string): void {
  _lastMainSessionId = v;
  writeRuntimeStatus('session_activity');
}
export function startRuntimeHeartbeat(): void {
  if (_runtimeHeartbeatTimer) return;
  writeRuntimeStatus('startup');
  _runtimeHeartbeatTimer = setInterval(() => writeRuntimeStatus('heartbeat'), 5000);
  if (typeof (_runtimeHeartbeatTimer as any).unref === 'function') (_runtimeHeartbeatTimer as any).unref();
}

// ─── Telegram ↔ Session Bridge ─────────────────────────────────────────────────
// Maps a Telegram userId to the session that last communicated outbound to them.
// When the user replies on Telegram, we route through this linked session so
// the AI sees the full conversation history (web UI, cron, task — whatever sent
// the Telegram message). The link updates every time send_telegram fires from
// a new session, so Telegram always continues the most recent conversation.

const _telegramSessionBridge = new Map<number, string>(); // telegramUserId → sessionId
const _sessionChannelHints = new Map<string, SessionChannelHint & { timestamp: number }>();

/** Record that `sessionId` just sent an outbound Telegram message to `telegramUserId`. */
export function linkTelegramSession(telegramUserId: number, sessionId: string): void {
  _telegramSessionBridge.set(telegramUserId, sessionId);
  console.log(`[TelegramBridge] Linked user ${telegramUserId} → session ${sessionId}`);
}

/** Get the linked session for an inbound Telegram message, or null if none. */
export function getLinkedSession(telegramUserId: number): string | null {
  return _telegramSessionBridge.get(telegramUserId) || null;
}

/** Clear the bridge for a user (e.g. on /clear). */
export function unlinkTelegramSession(telegramUserId: number): void {
  _telegramSessionBridge.delete(telegramUserId);
}

export type SessionChannelHint = {
  channel: 'terminal' | 'telegram' | 'web' | 'mobile' | 'discord' | 'whatsapp';
  chatId?: number;
  userId?: number;
  timestamp?: number;
};

export function setSessionChannelHint(
  sessionId: string,
  hint: SessionChannelHint,
): void {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  _sessionChannelHints.set(sid, {
    channel: hint.channel,
    chatId: Number.isFinite(Number(hint.chatId)) ? Number(hint.chatId) : undefined,
    userId: Number.isFinite(Number(hint.userId)) ? Number(hint.userId) : undefined,
    timestamp: Number.isFinite(Number(hint.timestamp)) ? Number(hint.timestamp) : Date.now(),
  });
}

export function getSessionChannelHint(sessionId: string): (SessionChannelHint & { timestamp: number }) | null {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  return _sessionChannelHints.get(sid) || null;
}

// ─── WebSocket Broadcast ───────────────────────────────────────────────────────

export let wss: WebSocketServer | undefined;
const wssInstances = new Set<WebSocketServer>();
export function setWss(instance: WebSocketServer): void {
  wss = instance;
  wssInstances.add(instance);
  instance.on('close', () => wssInstances.delete(instance));
}

export function getWebSocketClientCount(): number {
  let count = 0;
  wssInstances.forEach((server) => {
    server.clients.forEach((client: any) => {
      if (client.readyState === 1) count += 1;
    });
  });
  return count;
}

export function broadcastWS(data: object): void {
  const msg = JSON.stringify(data);
  wssInstances.forEach((server) => {
    server.clients.forEach((client: any) => {
      if (client.readyState === 1) {
        try {
          const buffered = Number(client.bufferedAmount || 0);
          if (buffered > 5 * 1024 * 1024) {
            try { client.terminate?.(); } catch {}
            return;
          }
          if (buffered > 1024 * 1024) return;
          client.send(msg);
        } catch {}
      }
    });
  });
}

// ─── Channel Config Types & Resolution ────────────────────────────────────────

export type TelegramChannelConfig = {
  enabled: boolean;
  botToken: string;
  allowedUserIds: number[];
  streamMode: 'full' | 'partial';
  personas: Record<string, TelegramPersonaConfig>;
  teamRooms: Record<string, TelegramTeamRoomConfig>;
  completionNotifications: ChannelCompletionNotificationConfig;
};

export type TelegramPersonaConfig = {
  enabled: boolean;
  agentId: string;
  botToken: string;
  managedBotUserId?: number;
  botUsername?: string;
  allowedUserIds: number[];
  groupChatIds: number[];
  requireMentionInGroups: boolean;
  streamMode: 'full' | 'partial';
};

export type TelegramTeamRoomConfig = {
  enabled: boolean;
  teamId: string;
  chatId: number;
  topicId?: number;
  title?: string;
  usePersonaIdentities: boolean;
};

export type DiscordChannelConfig = {
  enabled: boolean;
  botToken: string;
  applicationId: string;
  guildId: string;
  channelId: string;
  webhookUrl: string;
  completionNotifications: ChannelCompletionNotificationConfig;
};

export type WhatsAppChannelConfig = {
  enabled: boolean;
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  verifyToken: string;
  webhookSecret: string;
  testRecipient: string;
  completionNotifications: ChannelCompletionNotificationConfig;
};

export type ChannelsConfig = {
  telegram: TelegramChannelConfig;
  discord: DiscordChannelConfig;
  whatsapp: WhatsAppChannelConfig;
};

export type ChannelCompletionNotificationConfig = {
  enabled: boolean;
  desktop: boolean;
  mobile: boolean;
  includeSummary: boolean;
  includeLink: boolean;
  summaryMaxChars: number;
};

function resolveToken(raw: string | undefined): string {
  if (!raw) return '';
  return getConfig().resolveSecret(raw) || '';
}

export function normalizeCompletionNotificationConfig(raw: any): ChannelCompletionNotificationConfig {
  const maxChars = Number(raw?.summaryMaxChars);
  return {
    enabled: raw?.enabled === true,
    desktop: raw?.desktop === true,
    mobile: raw?.mobile === true,
    includeSummary: raw?.includeSummary !== false,
    includeLink: raw?.includeLink === true,
    summaryMaxChars: Number.isFinite(maxChars) ? Math.max(80, Math.min(1200, Math.floor(maxChars))) : 420,
  };
}

export function normalizeTelegramConfig(raw: any): TelegramChannelConfig {
  const personas: Record<string, TelegramPersonaConfig> = {};
  const rawPersonas = raw?.personas && typeof raw.personas === 'object' ? raw.personas : {};
  for (const [key, value] of Object.entries(rawPersonas)) {
    const accountId = String(key || '').trim();
    if (!accountId) continue;
    const persona = value as any;
    personas[accountId] = {
      enabled: persona?.enabled !== false,
      agentId: String(persona?.agentId || accountId).trim(),
      botToken: resolveToken(persona?.botToken),
      managedBotUserId: Number.isFinite(Number(persona?.managedBotUserId)) && Number(persona?.managedBotUserId) > 0
        ? Number(persona?.managedBotUserId)
        : undefined,
      botUsername: String(persona?.botUsername || '').replace(/^@/, '').trim() || undefined,
      allowedUserIds: Array.isArray(persona?.allowedUserIds)
        ? persona.allowedUserIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
        : [],
      groupChatIds: Array.isArray(persona?.groupChatIds)
        ? persona.groupChatIds.map(Number).filter((n: number) => Number.isFinite(n) && n !== 0)
        : [],
      requireMentionInGroups: persona?.requireMentionInGroups !== false,
      streamMode: persona?.streamMode === 'partial' ? 'partial' : 'full',
    };
  }

  const teamRooms: Record<string, TelegramTeamRoomConfig> = {};
  const rawTeamRooms = raw?.teamRooms && typeof raw.teamRooms === 'object' ? raw.teamRooms : {};
  for (const [key, value] of Object.entries(rawTeamRooms)) {
    const room = value as any;
    const chatId = Number(room?.chatId ?? key);
    if (!Number.isFinite(chatId) || chatId === 0) continue;
    const topicId = Number(room?.topicId);
    const normalizedKey = Number.isFinite(topicId) && topicId > 0 ? `${chatId}:topic:${topicId}` : String(chatId);
    teamRooms[normalizedKey] = {
      enabled: room?.enabled !== false,
      teamId: String(room?.teamId || '').trim(),
      chatId,
      topicId: Number.isFinite(topicId) && topicId > 0 ? topicId : undefined,
      title: String(room?.title || '').trim() || undefined,
      usePersonaIdentities: room?.usePersonaIdentities !== false,
    };
  }

  return {
    enabled: raw?.enabled === true,
    botToken: resolveToken(raw?.botToken),
    allowedUserIds: Array.isArray(raw?.allowedUserIds) ? raw.allowedUserIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : [],
    streamMode: raw?.streamMode === 'partial' ? 'partial' : 'full',
    personas,
    teamRooms,
    completionNotifications: normalizeCompletionNotificationConfig(raw?.completionNotifications),
  };
}

export function normalizeDiscordConfig(raw: any): DiscordChannelConfig {
  return {
    enabled: raw?.enabled === true,
    botToken: resolveToken(raw?.botToken),
    applicationId: String(raw?.applicationId || ''),
    guildId: String(raw?.guildId || ''),
    channelId: String(raw?.channelId || ''),
    webhookUrl: resolveToken(raw?.webhookUrl) || String(raw?.webhookUrl || ''),
    completionNotifications: normalizeCompletionNotificationConfig(raw?.completionNotifications),
  };
}

export function normalizeWhatsAppConfig(raw: any): WhatsAppChannelConfig {
  return {
    enabled: raw?.enabled === true,
    accessToken: resolveToken(raw?.accessToken),
    phoneNumberId: String(raw?.phoneNumberId || ''),
    businessAccountId: String(raw?.businessAccountId || ''),
    verifyToken: resolveToken(raw?.verifyToken) || String(raw?.verifyToken || ''),
    webhookSecret: resolveToken(raw?.webhookSecret) || String(raw?.webhookSecret || ''),
    testRecipient: String(raw?.testRecipient || ''),
    completionNotifications: normalizeCompletionNotificationConfig(raw?.completionNotifications),
  };
}

export function resolveChannelsConfig(): ChannelsConfig {
  const cfg = getConfig().getConfig() as any;
  const channels = cfg.channels || {};
  const legacyTelegram = cfg.telegram || {};
  return {
    telegram: normalizeTelegramConfig({ ...(channels.telegram || {}), ...legacyTelegram }),
    discord: normalizeDiscordConfig(channels.discord || {}),
    whatsapp: normalizeWhatsAppConfig(channels.whatsapp || {}),
  };
}

// ─── Notification Senders ─────────────────────────────────────────────────────

export async function sendDiscordNotification(text: string): Promise<void> {
  const dc = resolveChannelsConfig().discord;
  if (!dc.enabled) return;
  const content = String(text || '').trim();
  if (!content) return;

  if (dc.webhookUrl) {
    try {
      await fetch(dc.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, 1800) }),
      });
    } catch {}
    return;
  }

  if (!dc.botToken || !dc.channelId) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(dc.channelId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${dc.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: content.slice(0, 1800) }),
    });
  } catch {}
}

export async function sendWhatsAppNotification(text: string): Promise<void> {
  const wa = resolveChannelsConfig().whatsapp;
  if (!wa.enabled) return;
  if (!wa.accessToken || !wa.phoneNumberId || !wa.testRecipient) return;
  const body = String(text || '').trim();
  if (!body) return;

  try {
    await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(wa.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${wa.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: wa.testRecipient,
        type: 'text',
        text: { body: body.slice(0, 900) },
      }),
    });
  } catch {}
}

// telegramChannel is a server-v2 singleton — injected at init time
let _telegramChannel: any = null;
export function setTelegramChannelForBroadcaster(tc: any): void { _telegramChannel = tc; }

export async function sendTelegramNotification(text: string): Promise<void> {
  const content = String(text || '').trim();
  if (!content) return;
  await _telegramChannel?.sendToAllowed(content);
}

export function sendTeamNotificationToChannels(text: string, teamId?: string): void {
  const content = String(text || '').trim();
  if (!content) return;
  const targets = teamId ? getTeamNotificationTargets(teamId, 'telegram') : [];
  if (targets.length > 0) {
    for (const t of targets) {
      const chatId = Number(String(t.peerId || '').trim());
      if (Number.isFinite(chatId) && chatId > 0) {
        _telegramChannel?.sendMessage(chatId, content).catch(() => {});
      }
    }
  } else {
    _telegramChannel?.sendToAllowed(content).catch(() => {});
  }
  sendDiscordNotification(content).catch(() => {});
  sendWhatsAppNotification(content).catch(() => {});
}

// ─── Team SSE Client Registry ─────────────────────────────────────────────────

const teamSseClients = new Map<string, Set<(data: object) => void>>();
let _teamEventMirror: ((data: object) => void | Promise<void>) | null = null;

export function setTeamEventMirror(fn: ((data: object) => void | Promise<void>) | null): void {
  _teamEventMirror = fn;
}

export function addTeamSseClient(teamId: string, send: (data: object) => void): void {
  if (!teamSseClients.has(teamId)) teamSseClients.set(teamId, new Set());
  teamSseClients.get(teamId)!.add(send);
}

export function removeTeamSseClient(teamId: string, send: (data: object) => void): void {
  teamSseClients.get(teamId)?.delete(send);
}

function formatTeamEventNotification(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const type = String((data as any).type || '').trim();
  const teamName = String((data as any).teamName || '').trim();
  const teamId = String((data as any).teamId || '').trim();

  if (type === 'team_created') {
    const members = Array.isArray((data as any).subagentIds) ? (data as any).subagentIds.join(', ') : '';
    return `👥 Team created: ${teamName || teamId}${members ? `\nMembers: ${members}` : ''}`;
  }
  if (type === 'team_deleted') return `🗑️ Team deleted: ${teamName || teamId}`;
  if (type === 'team_updated') return `🛠️ Team updated: ${teamName || teamId}`;
  if (type === 'team_manager_review_done') {
    const proposed = Number((data as any).changesProposed || 0);
    const applied = Number((data as any).changesAutoApplied || 0);
    return `🧠 Team review complete: ${teamName || teamId}\nChanges proposed: ${proposed}, auto-applied: ${applied}`;
  }
  if (type === 'team_dispatch_complete') {
    const agentId = String((data as any).agentId || '').trim();
    const success = (data as any).success === true;
    const preview = String((data as any).resultPreview || '').trim();
    return `${success ? '✅' : '❌'} Team dispatch ${success ? 'complete' : 'failed'}: ${teamName || teamId} → ${agentId}${preview ? `\n${preview.slice(0, 500)}` : ''}`;
  }
  if (type === 'team_dispatch') {
    const agentId = String((data as any).agentId || '').trim();
    const task = String((data as any).task || '').trim();
    return `📋 Team dispatch: ${teamName || teamId} → ${agentId}${task ? `\n${task.slice(0, 400)}` : ''}`;
  }
  if (type === 'team_change_proposed') {
    const change = (data as any).change || {};
    return `⚠️ Team change proposed: ${teamName || teamId}\n${String(change.description || '').slice(0, 500)}`;
  }
  if (type === 'team_subagent_completed') {
    const agentName = String((data as any).agentName || (data as any).agentId || '').trim();
    const success = (data as any).success === true;
    return `${success ? '✅' : '❌'} Team member run ${success ? 'complete' : 'failed'}: ${teamName || teamId} → ${agentName}`;
  }
  if (type === 'team_paused') {
    const reason = String((data as any).reason || '').trim();
    return `⏸️ Team paused: ${teamName || teamId}${reason ? `\nReason: ${reason}` : ''}`;
  }
  if (type === 'team_resumed') return `▶️ Team resumed: ${teamName || teamId}`;
  if (type === 'team_chat_message') {
    const msg = String(
      typeof (data as any).message === 'string'
        ? (data as any).message
        : (data as any).text || (data as any).chatMessage?.content || '',
    ).trim();
    if (!msg) return null;
    return `💬 Team update (${teamName || teamId}): ${msg.slice(0, 500)}`;
  }
  if (type === 'team_main_agent_message') {
    const msg = String((data as any).message || '').trim();
    const msgType = String((data as any).messageType || 'planning');
    const prefix = msgType === 'error' ? '🚨' : msgType === 'status' ? '📊' : '💬';
    return `${prefix} Team coordinator → Main Agent (${teamName || teamId}): ${msg.slice(0, 500)}`;
  }
  if (type === 'team_main_agent_reply') {
    const msg = String((data as any).message || '').trim();
    return `💬 Main Agent → Team coordinator (${teamName || teamId}): ${msg.slice(0, 500)}`;
  }
  return null;
}

export function broadcastTeamEvent(data: object): void {
  broadcastWS(data);
  const teamId = String((data as any)?.teamId || '').trim();
  const targets = new Set<(d: object) => void>();
  if (teamId) {
    for (const fn of (teamSseClients.get(teamId) || [])) targets.add(fn);
  }
  for (const fn of (teamSseClients.get('*') || [])) targets.add(fn);
  for (const fn of targets) {
    try { fn(data); } catch {}
  }
  if (_teamEventMirror) {
    try {
      Promise.resolve(_teamEventMirror(data)).catch(() => {});
    } catch {}
  }
  try {
    const evt: any = data as any;
    const type = String(evt?.type || '').trim();
    if (type === 'team_change_proposed') {
      const evtTeamId = String(evt?.teamId || '').trim();
      const evtTeamName = String(evt?.teamName || evtTeamId).trim();
      const change = evt?.change || {};
      const changeId = String(change?.id || '').trim();
      if (evtTeamId && changeId) {
        const tgTargets = getTeamNotificationTargets(evtTeamId, 'telegram');
        if (tgTargets.length > 0) {
          for (const t of tgTargets) {
            const chatId = Number(String(t.peerId || '').trim());
            if (Number.isFinite(chatId) && chatId > 0) {
              _telegramChannel?.sendTeamChangeProposal(chatId, {
                teamId: evtTeamId,
                teamName: evtTeamName,
                changeId,
                description: String(change?.description || '').slice(0, 900),
                riskLevel: String(change?.riskLevel || ''),
              }).catch(() => {});
            }
          }
          return;
        }
      }
    }
    const text = formatTeamEventNotification(data as any);
    if (text) sendTeamNotificationToChannels(text, teamId || undefined);
  } catch {}
}
