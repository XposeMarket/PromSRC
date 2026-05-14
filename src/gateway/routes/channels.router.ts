// src/gateway/routes/channels.router.ts
// Channels (Telegram/Discord/WhatsApp), Agents, Dispatch routes
import { Router } from 'express';
import { getConfig, getAgents, getAgentById, ensureAgentWorkspace, resolveAgentWorkspace } from '../../config/config';
import { broadcastWS, broadcastTeamEvent, resolveChannelsConfig, normalizeTelegramConfig, normalizeDiscordConfig, normalizeWhatsAppConfig } from '../comms/broadcaster';
import { listManagedTeams, getManagedTeam, saveManagedTeam, deleteManagedTeam } from '../teams/managed-teams';
import { reloadAgentSchedules, recordAgentRun, getAgentRunHistory, getAgentLastRun } from '../../scheduler';
import { spawnAgent } from '../../agents/spawner';
import { inferAgentModelDefaultType, resolveConfiguredAgentModel } from '../../agents/model-routing.js';
import { appendSubagentChatMessage, getSubagentChatHistory } from '../agents-runtime/subagent-chat-store';
import { addMessage, getSession, setWorkspace } from '../session';
import * as fs from 'fs';
import * as path from 'path';
import { getTeamMemberAgentIds } from '../teams/managed-teams';
import { checkForTeamSuggestion } from '../teams/team-detector';
import { getTeamWorkspacePath } from '../teams/team-workspace';
import type { RuntimeVisionAttachment } from '../chat/attachment-context';

type DiscordChannelConfig = any;
type WhatsAppChannelConfig = any;

export const router = Router();

const getAttachmentContext = () => require('../chat/attachment-context') as typeof import('../chat/attachment-context');

let _cronScheduler: any;
let _telegramChannel: any;
let _telegramPersonaBots: any;
let _telegramTeamRoomBridge: any;


let _dispatchToAgent: (agentId: string, message: string, context: string | undefined, source: string) => Promise<any>;
let _runInteractiveTurn: (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  reasoningOptions?: any,
  attachments?: Array<{ base64: string; mimeType: string; name: string }>,
  modelOverride?: string,
) => Promise<{ type: string; text: string; thinking?: string }>;

export function initChannelsRouter(deps: {
  cronScheduler: any;
  telegramChannel: any;
  telegramPersonaBots?: any;
  telegramTeamRoomBridge?: any;
  dispatchToAgent: (agentId: string, message: string, context: string | undefined, source: string) => Promise<any>;
  runInteractiveTurn: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    reasoningOptions?: any,
    attachments?: Array<{ base64: string; mimeType: string; name: string }>,
    modelOverride?: string,
  ) => Promise<{ type: string; text: string; thinking?: string }>;
}): void {
  _cronScheduler = deps.cronScheduler;
  _telegramChannel = deps.telegramChannel;
  _telegramPersonaBots = deps.telegramPersonaBots;
  _telegramTeamRoomBridge = deps.telegramTeamRoomBridge;
  _dispatchToAgent = deps.dispatchToAgent;
  _runInteractiveTurn = deps.runInteractiveTurn;
}

// ─── Channels API ──────────────────────────────────────────────────────────────

async function testTelegramConfig(token: string): Promise<{ success: boolean; bot?: any; error?: string }> {
  if (!token) return { success: false, error: 'No Telegram bot token provided' };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: 'POST' });
    const data: any = await resp.json();
    if (!data.ok) return { success: false, error: data.description || 'Invalid token' };
    return { success: true, bot: { username: data.result.username, firstName: data.result.first_name, id: data.result.id } };
  } catch (err: any) {
    return { success: false, error: String(err?.message || err) };
  }
}

async function testDiscordConfig(dc: DiscordChannelConfig): Promise<{ success: boolean; bot?: any; error?: string }> {
  if (!dc.botToken) return { success: false, error: 'No Discord bot token provided' };
  try {
    const meResp = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${dc.botToken}` },
    });
    const meData: any = await meResp.json();
    if (!meResp.ok) return { success: false, error: meData?.message || `Discord API ${meResp.status}` };

    return {
      success: true,
      bot: { username: meData.username, id: meData.id, discriminator: meData.discriminator },
    };
  } catch (err: any) {
    return { success: false, error: String(err?.message || err) };
  }
}

async function testWhatsAppConfig(wa: WhatsAppChannelConfig): Promise<{ success: boolean; account?: any; error?: string }> {
  if (!wa.accessToken) return { success: false, error: 'No WhatsApp access token provided' };
  if (!wa.phoneNumberId) return { success: false, error: 'No WhatsApp phone number ID provided' };
  try {
    const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(wa.phoneNumberId)}?fields=id,display_phone_number,verified_name`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${wa.accessToken}` },
    });
    const data: any = await resp.json();
    if (!resp.ok) return { success: false, error: data?.error?.message || `WhatsApp API ${resp.status}` };
    return { success: true, account: data };
  } catch (err: any) {
    return { success: false, error: String(err?.message || err) };
  }
}

router.get('/api/channels/status', (_req, res) => {
  const runtimeTelegram = _telegramChannel.getStatus();
  const channels = resolveChannelsConfig();

  res.json({
    success: true,
    telegram: {
      ...runtimeTelegram,
      enabled: channels.telegram.enabled,
      hasToken: !!channels.telegram.botToken,
      allowedUserIds: channels.telegram.allowedUserIds,
      personaBots: _telegramPersonaBots?.getStatus ? _telegramPersonaBots.getStatus() : { enabled: false, accounts: [] },
      teamRooms: _telegramTeamRoomBridge?.getStatus ? _telegramTeamRoomBridge.getStatus() : { rooms: [] },
    },
    discord: {
      enabled: channels.discord.enabled,
      hasToken: !!channels.discord.botToken,
      hasWebhook: !!channels.discord.webhookUrl,
      applicationId: channels.discord.applicationId,
      guildId: channels.discord.guildId,
      channelId: channels.discord.channelId,
    },
    whatsapp: {
      enabled: channels.whatsapp.enabled,
      hasAccessToken: !!channels.whatsapp.accessToken,
      phoneNumberId: channels.whatsapp.phoneNumberId,
      businessAccountId: channels.whatsapp.businessAccountId,
      verifyTokenSet: !!channels.whatsapp.verifyToken,
      webhookSecretSet: !!channels.whatsapp.webhookSecret,
      testRecipient: channels.whatsapp.testRecipient,
    },
  });
});

router.post('/api/channels/config', async (req, res) => {
  const incoming = req.body?.channels || {};
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const existing = resolveChannelsConfig();

  const mergedTelegram = normalizeTelegramConfig({ ...existing.telegram, ...(incoming.telegram || {}) });
  const mergedDiscord = normalizeDiscordConfig({ ...existing.discord, ...(incoming.discord || {}) });
  const mergedWhatsApp = normalizeWhatsAppConfig({ ...existing.whatsapp, ...(incoming.whatsapp || {}) });

  const channels = {
    ...(current.channels || {}),
    telegram: mergedTelegram,
    discord: mergedDiscord,
    whatsapp: mergedWhatsApp,
  };

  // Keep legacy top-level telegram key in sync for backward compatibility.
  cm.updateConfig({
    channels,
    telegram: mergedTelegram,
  } as any);

  _telegramChannel.updateConfig(mergedTelegram);
  _telegramTeamRoomBridge?.updateConfig?.(mergedTelegram);
  await _telegramPersonaBots?.updateConfig?.(mergedTelegram);

  res.json({
    success: true,
    channels: {
      telegram: {
        enabled: mergedTelegram.enabled,
        hasToken: !!mergedTelegram.botToken,
        allowedUserIds: mergedTelegram.allowedUserIds,
        personas: Object.fromEntries(Object.entries(mergedTelegram.personas || {}).map(([accountId, persona]: [string, any]) => [accountId, {
          enabled: persona.enabled,
          agentId: persona.agentId,
          hasToken: !!persona.botToken,
          managedBotUserId: persona.managedBotUserId,
          botUsername: persona.botUsername,
          allowedUserIds: persona.allowedUserIds,
          groupChatIds: persona.groupChatIds,
          requireMentionInGroups: persona.requireMentionInGroups,
          streamMode: persona.streamMode,
        }])),
        teamRooms: Object.fromEntries(Object.entries(mergedTelegram.teamRooms || {}).map(([key, room]: [string, any]) => [key, {
          enabled: room.enabled,
          teamId: room.teamId,
          chatId: room.chatId,
          topicId: room.topicId,
          title: room.title,
          usePersonaIdentities: room.usePersonaIdentities,
        }])),
      },
      discord: { enabled: mergedDiscord.enabled, hasToken: !!mergedDiscord.botToken, hasWebhook: !!mergedDiscord.webhookUrl },
      whatsapp: { enabled: mergedWhatsApp.enabled, hasAccessToken: !!mergedWhatsApp.accessToken, phoneNumberId: mergedWhatsApp.phoneNumberId },
    },
  });
});

router.get('/api/channels/telegram/team-rooms/status', (_req, res) => {
  res.json({
    success: true,
    ...( _telegramTeamRoomBridge?.getStatus ? _telegramTeamRoomBridge.getStatus() : { rooms: [] } ),
  });
});

router.post('/api/channels/telegram/team-rooms/bind', async (req, res) => {
  const chatId = Number(req.body?.chatId);
  const topicId = Number(req.body?.topicId);
  const teamId = String(req.body?.teamId || '').trim();
  if (!Number.isFinite(chatId) || chatId === 0) return res.status(400).json({ success: false, error: 'chatId is required' });
  if (!teamId) return res.status(400).json({ success: false, error: 'teamId is required' });
  if (!getManagedTeam(teamId)) return res.status(404).json({ success: false, error: `Team "${teamId}" was not found` });

  const cm = getConfig();
  const current = cm.getConfig() as any;
  const existing = resolveChannelsConfig();
  const key = Number.isFinite(topicId) && topicId > 0 ? `${chatId}:topic:${topicId}` : String(chatId);
  const mergedTelegram = normalizeTelegramConfig({
    ...existing.telegram,
    teamRooms: {
      ...(existing.telegram.teamRooms || {}),
      [key]: {
        enabled: req.body?.enabled !== false,
        teamId,
        chatId,
        topicId: Number.isFinite(topicId) && topicId > 0 ? topicId : undefined,
        title: String(req.body?.title || '').trim() || undefined,
        usePersonaIdentities: req.body?.usePersonaIdentities !== false,
      },
    },
  });
  cm.updateConfig({
    channels: {
      ...(current.channels || {}),
      telegram: mergedTelegram,
      discord: existing.discord,
      whatsapp: existing.whatsapp,
    },
    telegram: mergedTelegram,
  } as any);
  _telegramChannel.updateConfig(mergedTelegram);
  _telegramTeamRoomBridge?.updateConfig?.(mergedTelegram);
  await _telegramPersonaBots?.updateConfig?.(mergedTelegram);
  res.json({ success: true, room: mergedTelegram.teamRooms[key], status: _telegramTeamRoomBridge?.getStatus?.() || null });
});

router.get('/api/channels/telegram/personas/status', (_req, res) => {
  res.json({
    success: true,
    ...( _telegramPersonaBots?.getStatus ? _telegramPersonaBots.getStatus() : { enabled: false, accounts: [] } ),
  });
});

router.post('/api/channels/telegram/personas/:accountId/test', async (req, res) => {
  const accountId = String(req.params.accountId || '').trim();
  try {
    if (!_telegramPersonaBots?.testAccount) {
      res.status(503).json({ success: false, error: 'Telegram persona bot manager is not initialized' });
      return;
    }
    const result = await _telegramPersonaBots.testAccount(accountId, req.body || undefined);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

function sanitizeTelegramBotUsernamePart(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function buildSuggestedBotUsername(prefix: string, accountId: string): string {
  const cleanPrefix = sanitizeTelegramBotUsernamePart(prefix || 'prometheus') || 'prometheus';
  const cleanAccount = sanitizeTelegramBotUsernamePart(accountId) || 'agent';
  const suffix = 'bot';
  const baseMax = 32 - suffix.length;
  const base = `${cleanPrefix}_${cleanAccount}`.slice(0, baseMax).replace(/_+$/g, '') || 'prometheus_agent';
  return `${base}${suffix}`;
}

function buildTelegramPersonaSetupPlan(opts?: { managerBotUsername?: string; prefix?: string; scope?: string }) {
  const channels = resolveChannelsConfig();
  const teams = listManagedTeams();
  const teamAgentIds = new Set<string>();
  for (const team of teams) {
    for (const agentId of Array.isArray(team.subagentIds) ? team.subagentIds : []) {
      const clean = _sanitizeAgentId(agentId);
      if (clean) teamAgentIds.add(clean);
    }
  }

  const scope = String(opts?.scope || 'teams').toLowerCase();
  const candidates = scope === 'all'
    ? getAgents().filter((agent: any) => agent?.id && agent.id !== 'main').map((agent: any) => _sanitizeAgentId(agent.id))
    : Array.from(teamAgentIds);
  const managerStatus = _telegramChannel?.getStatus ? _telegramChannel.getStatus() : {};
  const managerBotUsername = String(opts?.managerBotUsername || managerStatus?.username || '').replace(/^@/, '').trim();
  const prefix = String(opts?.prefix || 'prometheus').trim() || 'prometheus';

  const agents = candidates
    .map((agentId) => {
      const agent = getAgentById(agentId);
      if (!agent) return null;
      const existing = channels.telegram.personas?.[agentId];
      const suggestedUsername = existing?.botUsername || buildSuggestedBotUsername(prefix, agentId);
      const suggestedName = String((agent as any)?.name || agentId).slice(0, 64);
      const createUrl = managerBotUsername
        ? `https://t.me/newbot/${encodeURIComponent(managerBotUsername)}/${encodeURIComponent(suggestedUsername)}?name=${encodeURIComponent(suggestedName)}`
        : null;
      const teamNames = teams
        .filter((team) => Array.isArray(team.subagentIds) && team.subagentIds.includes(agentId))
        .map((team) => team.name || team.id);
      return {
        accountId: agentId,
        agentId,
        agentName: (agent as any)?.name || agentId,
        teams: teamNames,
        configured: !!existing,
        hasToken: !!existing?.botToken || !!existing?.managedBotUserId,
        managedBotUserId: existing?.managedBotUserId,
        botUsername: existing?.botUsername || null,
        suggestedUsername,
        suggestedName,
        createUrl,
      };
    })
    .filter(Boolean);

  return {
    managerBotUsername: managerBotUsername || null,
    managerHasToken: !!channels.telegram.botToken,
    managerCanGenerateLinks: !!managerBotUsername,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      subagentIds: Array.isArray(team.subagentIds) ? team.subagentIds : [],
    })),
    agents,
    nextSteps: [
      'Enable Bot Management Mode for the manager bot in BotFather.',
      'Save/apply this plan so Prometheus seeds persona entries for each team agent.',
      'Open each createUrl in Telegram and approve creating the managed bot.',
      'Copy each created bot user_id into the bind endpoint or config as managedBotUserId.',
      'Add all created bots to the same group, run /whereami, and put the group chatId in groupChatIds.',
    ],
  };
}

router.get('/api/channels/telegram/personas/setup-plan', (req, res) => {
  res.json({
    success: true,
    plan: buildTelegramPersonaSetupPlan({
      managerBotUsername: String(req.query.managerBotUsername || ''),
      prefix: String(req.query.prefix || ''),
      scope: String(req.query.scope || 'teams'),
    }),
  });
});

router.post('/api/channels/telegram/personas/setup-plan/apply', async (req, res) => {
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const existing = resolveChannelsConfig();
  const plan = buildTelegramPersonaSetupPlan({
    managerBotUsername: String(req.body?.managerBotUsername || ''),
    prefix: String(req.body?.prefix || ''),
    scope: String(req.body?.scope || 'teams'),
  });
  const groupChatIds = Array.isArray(req.body?.groupChatIds)
    ? req.body.groupChatIds.map(Number).filter((n: number) => Number.isFinite(n) && n !== 0)
    : [];
  const personas: Record<string, any> = { ...(existing.telegram.personas || {}) };
  for (const agentPlan of plan.agents as any[]) {
    const accountId = String(agentPlan.accountId || '').trim();
    if (!accountId) continue;
    const currentPersona = personas[accountId] || {};
    personas[accountId] = {
      ...currentPersona,
      enabled: currentPersona.enabled !== false,
      agentId: agentPlan.agentId,
      botToken: currentPersona.botToken || '',
      managedBotUserId: currentPersona.managedBotUserId,
      botUsername: currentPersona.botUsername || agentPlan.suggestedUsername,
      allowedUserIds: Array.isArray(currentPersona.allowedUserIds) && currentPersona.allowedUserIds.length > 0
        ? currentPersona.allowedUserIds
        : [],
      groupChatIds: Array.isArray(currentPersona.groupChatIds) && currentPersona.groupChatIds.length > 0
        ? currentPersona.groupChatIds
        : groupChatIds,
      requireMentionInGroups: currentPersona.requireMentionInGroups !== false,
      streamMode: currentPersona.streamMode === 'partial' ? 'partial' : 'full',
    };
  }

  const mergedTelegram = normalizeTelegramConfig({
    ...existing.telegram,
    personas,
  });
  cm.updateConfig({
    channels: {
      ...(current.channels || {}),
      telegram: mergedTelegram,
      discord: existing.discord,
      whatsapp: existing.whatsapp,
    },
    telegram: mergedTelegram,
  } as any);
  _telegramChannel.updateConfig(mergedTelegram);
  _telegramTeamRoomBridge?.updateConfig?.(mergedTelegram);
  await _telegramPersonaBots?.updateConfig?.(mergedTelegram);

  res.json({
    success: true,
    plan: buildTelegramPersonaSetupPlan({
      managerBotUsername: plan.managerBotUsername || '',
      prefix: String(req.body?.prefix || ''),
      scope: String(req.body?.scope || 'teams'),
    }),
  });
});

router.post('/api/channels/telegram/personas/:accountId/bind-managed-bot', async (req, res) => {
  const accountId = _sanitizeAgentId(req.params.accountId);
  const userId = Number(req.body?.managedBotUserId || req.body?.userId || req.body?.botId);
  if (!accountId) return res.status(400).json({ success: false, error: 'accountId is required' });
  if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ success: false, error: 'managedBotUserId is required' });

  const cm = getConfig();
  const current = cm.getConfig() as any;
  const existing = resolveChannelsConfig();
  const currentPersona = existing.telegram.personas?.[accountId];
  if (!currentPersona) return res.status(404).json({ success: false, error: `Persona "${accountId}" is not configured. Apply a setup plan first.` });

  const personas = {
    ...(existing.telegram.personas || {}),
    [accountId]: {
      ...currentPersona,
      managedBotUserId: userId,
      botUsername: String(req.body?.botUsername || currentPersona.botUsername || '').replace(/^@/, '').trim() || currentPersona.botUsername,
    },
  };
  const mergedTelegram = normalizeTelegramConfig({
    ...existing.telegram,
    personas,
  });
  cm.updateConfig({
    channels: {
      ...(current.channels || {}),
      telegram: mergedTelegram,
      discord: existing.discord,
      whatsapp: existing.whatsapp,
    },
    telegram: mergedTelegram,
  } as any);
  _telegramChannel.updateConfig(mergedTelegram);
  _telegramTeamRoomBridge?.updateConfig?.(mergedTelegram);
  await _telegramPersonaBots?.updateConfig?.(mergedTelegram);

  res.json({ success: true, accountId, managedBotUserId: userId, status: _telegramPersonaBots?.getStatus?.() || null });
});

router.post('/api/channels/test/:channel', async (req, res) => {
  const channel = String(req.params.channel || '').toLowerCase();
  const channels = resolveChannelsConfig();

  if (channel === 'telegram') {
    const token = String(req.body?.botToken || channels.telegram.botToken || '');
    const result = await testTelegramConfig(token);
    res.json(result);
    return;
  }

  if (channel === 'discord') {
    const dc = normalizeDiscordConfig({ ...channels.discord, ...(req.body || {}) });
    const result = await testDiscordConfig(dc);
    res.json(result);
    return;
  }

  if (channel === 'whatsapp') {
    const wa = normalizeWhatsAppConfig({ ...channels.whatsapp, ...(req.body || {}) });
    const result = await testWhatsAppConfig(wa);
    res.json(result);
    return;
  }

  res.status(400).json({ success: false, error: `Unsupported channel: ${channel}` });
});

router.post('/api/channels/send-test/:channel', async (req, res) => {
  const channel = String(req.params.channel || '').toLowerCase();
  const channels = resolveChannelsConfig();

  if (channel === 'telegram') {
    try {
      await _telegramChannel.sendToAllowed('🦞 Prometheus test message - Telegram is connected!');
      res.json({ success: true });
    } catch (err: any) {
      res.json({ success: false, error: String(err?.message || err) });
    }
    return;
  }

  if (channel === 'discord') {
    const dc = normalizeDiscordConfig({ ...channels.discord, ...(req.body || {}) });
    const text = String(req.body?.text || '🦞 Prometheus test message - Discord is connected!');
    if (dc.webhookUrl) {
      try {
        const resp = await fetch(dc.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: text }),
        });
        if (!resp.ok) {
          const body = await resp.text();
          res.json({ success: false, error: body || `Discord webhook HTTP ${resp.status}` });
          return;
        }
        res.json({ success: true });
      } catch (err: any) {
        res.json({ success: false, error: String(err?.message || err) });
      }
      return;
    }
    if (!dc.botToken || !dc.channelId) {
      res.json({ success: false, error: 'Provide Discord webhook URL or bot token + channel ID' });
      return;
    }
    try {
      const resp = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(dc.channelId)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${dc.botToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ content: text }),
      });
      const data: any = await resp.json();
      if (!resp.ok) {
        res.json({ success: false, error: data?.message || `Discord API ${resp.status}` });
        return;
      }
      res.json({ success: true, messageId: data?.id });
    } catch (err: any) {
      res.json({ success: false, error: String(err?.message || err) });
    }
    return;
  }

  if (channel === 'whatsapp') {
    const wa = normalizeWhatsAppConfig({ ...channels.whatsapp, ...(req.body || {}) });
    const to = String(req.body?.to || wa.testRecipient || '').trim();
    const text = String(req.body?.text || 'Prometheus test message - WhatsApp is connected!');
    if (!wa.accessToken || !wa.phoneNumberId || !to) {
      res.json({ success: false, error: 'Provide WhatsApp access token, phone number ID, and test recipient number' });
      return;
    }
    try {
      const resp = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(wa.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${wa.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      });
      const data: any = await resp.json();
      if (!resp.ok) {
        res.json({ success: false, error: data?.error?.message || `WhatsApp API ${resp.status}` });
        return;
      }
      res.json({ success: true, messageId: data?.messages?.[0]?.id || null });
    } catch (err: any) {
      res.json({ success: false, error: String(err?.message || err) });
    }
    return;
  }

  res.status(400).json({ success: false, error: `Unsupported channel: ${channel}` });
});

export function sanitizeAgentId(value: any): string { return _sanitizeAgentId(value); }
export function normalizeAgentsForSave(agents: any[]): any[] { return _normalizeAgentsForSave(agents); }

function _sanitizeAgentId(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeAgentDefinition(raw: any, fallbackId?: string): any {
  const id = _sanitizeAgentId(raw?.id || fallbackId || '');
  const normalized: any = {
    id,
    name: String(raw?.name || id || 'Agent').trim() || 'Agent',
  };
  if (raw?.description !== undefined) normalized.description = String(raw.description || '').trim();
  if (raw?.emoji !== undefined) normalized.emoji = String(raw.emoji || '').trim();
  if (raw?.identity && typeof raw.identity === 'object') normalized.identity = raw.identity;
  if (raw?.roleType !== undefined) normalized.roleType = String(raw.roleType || '').trim();
  if (raw?.teamRole !== undefined) normalized.teamRole = String(raw.teamRole || '').trim();
  if (raw?.teamAssignment !== undefined) normalized.teamAssignment = String(raw.teamAssignment || '').trim();
  if (raw?.workspace !== undefined) normalized.workspace = String(raw.workspace || '').trim();
  if (raw?.model !== undefined) normalized.model = String(raw.model || '').trim();
  if (typeof raw?.default === 'boolean') normalized.default = raw.default;
  if (raw?.maxSteps !== undefined) {
    const n = Number(raw.maxSteps);
    if (Number.isFinite(n) && n > 0) normalized.maxSteps = Math.floor(n);
  }
  if (raw?.tools && typeof raw.tools === 'object') {
    normalized.tools = {};
    if (Array.isArray(raw.tools.allow)) normalized.tools.allow = raw.tools.allow.map((s: any) => String(s || '').trim()).filter(Boolean);
    if (Array.isArray(raw.tools.deny)) normalized.tools.deny = raw.tools.deny.map((s: any) => String(s || '').trim()).filter(Boolean);
    if (!normalized.tools.allow && !normalized.tools.deny) delete normalized.tools;
  }
  if (Array.isArray(raw?.bindings)) {
    normalized.bindings = raw.bindings
      .filter((b: any) => b && ['telegram', 'discord', 'whatsapp'].includes(String(b.channel || '')))
      .map((b: any) => ({
        channel: String(b.channel),
        ...(b.accountId ? { accountId: String(b.accountId) } : {}),
        ...(b.peerId ? { peerId: String(b.peerId) } : {}),
      }));
  }
  // Preserve dynamic subagent metadata so it survives round-trips through the settings UI
  if (raw?.subagentType !== undefined) normalized.subagentType = raw.subagentType;
  if (raw?.scheduleId !== undefined) normalized.scheduleId = String(raw.scheduleId || '').trim();
  if (raw?.scheduleName !== undefined) normalized.scheduleName = String(raw.scheduleName || '').trim();
  if (raw?.createdAt !== undefined) normalized.createdAt = raw.createdAt;
  if (raw?.createdBy !== undefined) normalized.createdBy = raw.createdBy;
  if (Array.isArray(raw?.allowed_tools)) normalized.allowed_tools = raw.allowed_tools;
  if (Array.isArray(raw?.forbidden_tools)) normalized.forbidden_tools = raw.forbidden_tools;
  if (Array.isArray(raw?.constraints)) normalized.constraints = raw.constraints;
  if (raw?.system_instructions !== undefined) normalized.system_instructions = String(raw.system_instructions || '').trim();
  if (raw?.success_criteria !== undefined) normalized.success_criteria = String(raw.success_criteria || '').trim();
  // Preserve isTeamManager flag
  if (typeof raw?.isTeamManager === 'boolean') normalized.isTeamManager = raw.isTeamManager;
  return normalized;
}

function _normalizeAgentsForSave(incomingAgents: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const raw of incomingAgents || []) {
    const n = normalizeAgentDefinition(raw);
    if (!n.id || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  const explicitMain = out.find((a) => a.id === 'main');
  if (explicitMain) {
    for (const a of out) a.default = a.id === 'main';
  } else {
    // When config does not define an explicit main agent, the synthetic main
    // agent returned by getAgents() owns the default role. No standalone/team
    // subagent should be marked default in persisted config.
    for (const a of out) {
      if (a.default === true) delete a.default;
    }
  }
  return out;
}

function findLastCronRunAt(agentId: string): number | null {
  const entries = getAgentRunHistory(agentId, 100);
  const hit = entries.find((e) => e.trigger === 'cron');
  return hit ? hit.finishedAt : null;
}

function resolveEffectiveAgentModel(cfg: any, agent: any, isManager: boolean, isTeamMember: boolean): { model: string; source: string } {
  return resolveConfiguredAgentModel(cfg, agent, {
    isManager,
    isTeamMember,
    fallbackToPrimary: true,
  });
}

function getSubagentChatSessionId(agentId: string): string {
  return `subagent_chat_${_sanitizeAgentId(agentId)}`;
}

function getChannelSubagentChatSessionId(channel: string, accountId: string, agentId: string, peerId?: string): string {
  const bits = [
    'subagent_chat',
    _sanitizeAgentId(channel),
    _sanitizeAgentId(accountId),
    _sanitizeAgentId(agentId),
    peerId ? String(peerId).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) : '',
  ].filter(Boolean);
  return bits.join('_');
}

function loadAgentIdentityPrompt(agentWorkspace: string): string {
  const candidates = [
    path.join(agentWorkspace, 'system_prompt.md'),
    path.join(agentWorkspace, 'AGENTS.md'),
    path.join(agentWorkspace, 'HEARTBEAT.md'),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const content = fs.readFileSync(candidate, 'utf-8').trim();
      if (content) return content;
    } catch {
      // Ignore unreadable prompt file and keep falling back.
    }
  }
  return '';
}

function buildSubagentCallerContext(agentId: string, agent: any, mainWorkspace: string, artifactWorkspace: string): string {
  const identityPrompt = loadAgentIdentityPrompt(artifactWorkspace);
  const intro = [
    '[SUBAGENT CHAT CONTEXT]',
    `You are chatting directly with the user as the configured agent "${agent?.name || agentId}" (id: ${agentId}).`,
    'This is a normal conversational thread using the main Prometheus chat runtime, not a one-off task dispatch.',
    'Treat greetings, check-ins, and small talk conversationally. Do not start with a filesystem scan unless the user asks for work or you genuinely need context.',
    'You still have your normal tools and can use them whenever they are useful or requested.',
    `Main workspace: ${mainWorkspace}`,
    `Subagent artifact workspace: ${artifactWorkspace}`,
    'Keep your own notes, scratch files, and subagent-specific artifacts in the artifact workspace when practical.',
  ];
  if (!identityPrompt) {
    intro.push('No subagent identity file was found. Use the configured agent name, description, and current user request as your guide.');
    intro.push('[/SUBAGENT CHAT CONTEXT]');
    return intro.join('\n');
  }
  return [
    ...intro,
    '',
    'Your configured identity prompt follows. Keep this role and scope, but stay conversational unless the user is asking you to execute.',
    '',
    identityPrompt,
    '[/SUBAGENT CHAT CONTEXT]',
  ].join('\n');
}

function seedSubagentSessionFromChatStore(agentId: string, sessionId: string, workspacePath: string): void {
  setWorkspace(sessionId, workspacePath);
  const session = getSession(sessionId);
  if (Array.isArray(session.history) && session.history.length > 0) return;

  const prior = getSubagentChatHistory(agentId, 80);
  for (const msg of prior) {
    if (msg.role !== 'user' && msg.role !== 'agent') continue;
    addMessage(sessionId, {
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: String(msg.content || ''),
      timestamp: Number(msg.ts || Date.now()) || Date.now(),
      channel: 'web',
    }, {
      disableCompactionCheck: true,
      disableMemoryFlushCheck: true,
    });
  }
}

function createSSESender(res: any): (event: string, data: any) => void {
  return (type: string, data: any) => {
    try {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch {
      // Ignore broken pipe / closed client writes.
    }
  };
}

async function runSubagentChatTurn(
  agentId: string,
  agent: any,
  message: string,
  timeoutMs: number,
  sendSSE?: (event: string, data: any) => void,
  externalAbortSignal?: { aborted: boolean },
  visionAttachments?: RuntimeVisionAttachment[],
  options?: {
    sessionIdOverride?: string;
    source?: string;
    seedFromSharedChatStore?: boolean;
  },
): Promise<{ result: { type: string; text: string; thinking?: string }; historyEntry: any; messages: any[] }> {
  const startedAt = Date.now();
  const cfg = getConfig().getConfig() as any;
  const teamMemberIds = getTeamMemberAgentIds();
  const allTeams = listManagedTeams();
  const isManager = !!(agent as any)?.isTeamManager || allTeams.some((team: any) => String(team?.managerAgentId || '').trim() === agentId);
  const effectiveModel = resolveEffectiveAgentModel(cfg, agent, isManager, teamMemberIds.has(agentId));
  const mainWorkspace = getConfig().getWorkspacePath();
  const artifactWorkspace = ensureAgentWorkspace(agent);
  const sessionId = options?.sessionIdOverride || getSubagentChatSessionId(agentId);
  if (options?.seedFromSharedChatStore !== false) {
    seedSubagentSessionFromChatStore(agentId, sessionId, mainWorkspace);
  } else {
    setWorkspace(sessionId, mainWorkspace);
  }
  const callerContext = buildSubagentCallerContext(agentId, agent, mainWorkspace, artifactWorkspace);
  const abortSignal = externalAbortSignal || { aborted: false };
  const baseEmit = sendSSE || (() => {});

  let timeoutHandle: NodeJS.Timeout | undefined;
  let settled = false;
  let rejectTimeout: ((reason?: any) => void) | undefined;
  const clearInactivityTimeout = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };
  const resetInactivityTimeout = () => {
    if (settled) return;
    clearInactivityTimeout();
    timeoutHandle = setTimeout(() => {
      if (settled) return;
      abortSignal.aborted = true;
      rejectTimeout?.(new Error(`Subagent chat timeout after ${timeoutMs}ms of inactivity`));
    }, timeoutMs);
    if (typeof (timeoutHandle as any)?.unref === 'function') (timeoutHandle as any).unref();
  };
  const timeoutErr = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const emit = (event: string, data: any) => {
    resetInactivityTimeout();
    baseEmit(event, data);
  };

  try {
    resetInactivityTimeout();
    const result = await Promise.race([
      _runInteractiveTurn(
        message,
        sessionId,
        emit,
        undefined,
        abortSignal,
        callerContext,
        undefined,
        Array.isArray(visionAttachments) && visionAttachments.length > 0 ? visionAttachments : undefined,
        effectiveModel.model || undefined,
      ),
      timeoutErr,
    ]).finally(() => {
      settled = true;
      clearInactivityTimeout();
    });

    if (abortSignal.aborted) {
      throw new Error('Subagent chat stopped.');
    }

    const finishedAt = Date.now();
    const reply = String(result?.text || '').trim() || '(No response text returned.)';
    const agentMessage = appendSubagentChatMessage(agentId, {
      role: 'agent',
      content: reply,
      metadata: {
        source: 'subagent_chat',
        channelSource: options?.source,
        success: true,
        mode: result?.type || 'chat',
        durationMs: finishedAt - startedAt,
        model: effectiveModel.model,
        modelSource: effectiveModel.source,
      },
    });
    broadcastWS({ type: 'subagent_chat_message', agentId, message: agentMessage });

    const historyEntry = recordAgentRun({
      agentId,
      agentName: agent.name || agentId,
      trigger: 'manual',
      success: true,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      stepCount: undefined,
      error: undefined,
      resultPreview: reply,
    });

    return {
      result,
      historyEntry,
      messages: getSubagentChatHistory(agentId, 100),
    };
  } catch (err: any) {
    if (abortSignal.aborted) {
      throw err;
    }
    const agentMessage = appendSubagentChatMessage(agentId, {
      role: 'agent',
      content: `Error: ${err.message}`,
      metadata: { source: 'subagent_chat', channelSource: options?.source, success: false },
    });
    broadcastWS({ type: 'subagent_chat_message', agentId, message: agentMessage });
    throw err;
  }
}

export async function runSubagentChatTurnFromChannel(params: {
  agentId: string;
  message: string;
  source: string;
  accountId?: string;
  peerId?: string;
  userLabel?: string;
  timeoutMs?: number;
  sessionId?: string;
  seedFromSharedChatStore?: boolean;
}): Promise<{ result: { type: string; text: string; thinking?: string }; historyEntry: any; messages: any[] }> {
  const agentId = _sanitizeAgentId(params.agentId);
  const agent = getAgentById(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found`);
  if (!_runInteractiveTurn) throw new Error('Subagent chat runtime is not initialized');

  const message = String(params.message || '').trim();
  if (!message) throw new Error('message is required');

  const timeoutMs = Number.isFinite(Number(params.timeoutMs)) && Number(params.timeoutMs) > 0
    ? Math.floor(Number(params.timeoutMs))
    : 300000;
  const source = String(params.source || 'external_subagent_chat').trim() || 'external_subagent_chat';
  const accountId = String(params.accountId || 'default').trim() || 'default';
  const peerId = params.peerId ? String(params.peerId) : undefined;
  const sessionId = params.sessionId || getChannelSubagentChatSessionId(source, accountId, agentId, peerId);
  const content = params.userLabel ? `[${params.userLabel}]\n${message}` : message;

  const userMessage = appendSubagentChatMessage(agentId, {
    role: 'user',
    content,
    metadata: {
      source,
      accountId,
      peerId,
    },
  });
  broadcastWS({ type: 'subagent_chat_message', agentId, message: userMessage });

  return runSubagentChatTurn(
    agentId,
    agent,
    content,
    timeoutMs,
    undefined,
    undefined,
    undefined,
    {
      sessionIdOverride: sessionId,
      source,
      seedFromSharedChatStore: params.seedFromSharedChatStore,
    },
  );
}

router.get('/api/agents', (_req, res) => {
  const cfg = getConfig().getConfig() as any;
  const explicitAgents = Array.isArray(cfg.agents) ? cfg.agents : [];
  const teamMemberIds = getTeamMemberAgentIds();
  const allTeams = listManagedTeams();

  // Member map: agentId -> first team that lists them in subagentIds[]
  const agentTeamMap = new Map<string, { teamId: string; teamName: string; teamEmoji: string }>();
  for (const team of allTeams) {
    for (const subId of team.subagentIds || []) {
      if (!agentTeamMap.has(subId)) {
        agentTeamMap.set(subId, { teamId: team.id, teamName: team.name, teamEmoji: team.emoji || '\uD83C\uDFE0' });
      }
    }
  }

  // Manager map: find agents with isTeamManager=true and match them to a team by id convention.
  // Convention: <keyword>_manager matches team whose id contains that keyword.
  // e.g. intel_manager -> team_intel, trading_manager -> team_trade_*
  const managerTeamMap = new Map<string, { teamId: string; teamName: string; teamEmoji: string }>();
  for (const agentDef of explicitAgents) {
    if (!(agentDef as any).isTeamManager) continue;
    const agentId = _sanitizeAgentId((agentDef as any).id);
    if (!agentId || managerTeamMap.has(agentId)) continue;
    const keyword = agentId.replace(/_manager$/, '');
    const matched = allTeams.find(t =>
      t.id.replace(/^team_/, '').startsWith(keyword) ||
      t.id.includes(keyword) ||
      t.name.toLowerCase().replace(/\s+/g, '_').includes(keyword)
    );
    if (matched) {
      managerTeamMap.set(agentId, { teamId: matched.id, teamName: matched.name, teamEmoji: matched.emoji || '\uD83C\uDFE0' });
    }
  }

  const agents = getAgents().map((agent) => {
    const workspace = resolveAgentWorkspace(agent as any);
    const lastRun = getAgentLastRun(agent.id);
    const isManager = !!(agent as any).isTeamManager || managerTeamMap.has(agent.id);
	    const teamInfo = agentTeamMap.get(agent.id) || managerTeamMap.get(agent.id);
	    const effectiveModel = resolveEffectiveAgentModel(cfg, agent, isManager, teamMemberIds.has(agent.id));
      const teamWorkspacePath = teamInfo?.teamId ? getTeamWorkspacePath(teamInfo.teamId) : null;
	    return {
	      ...agent,
	      workspaceResolved: workspace,
        workspaceDefault: teamWorkspacePath || workspace,
        teamWorkspacePath,
	      workspaceExists: fs.existsSync(workspace),
      isSynthetic: agent.id === 'main' && !explicitAgents.some((a: any) => _sanitizeAgentId(a.id) === 'main'),
      lastRun: lastRun || null,
      lastHeartbeatAt: findLastCronRunAt(agent.id),
      isTeamMember: teamMemberIds.has(agent.id),
      isTeamManager: isManager,
      teamId: teamInfo?.teamId || null,
      teamName: teamInfo?.teamName || null,
      teamEmoji: teamInfo?.teamEmoji || null,
      effectiveModel: effectiveModel.model,
      effectiveModelSource: effectiveModel.source,
    };
  });
  const defaultAgent = agents.find((a) => a.id === 'main') || agents.find((a) => a.default) || agents[0] || null;
  res.json({ success: true, agents, defaultAgentId: defaultAgent?.id || null, teamMemberIds: Array.from(teamMemberIds) });
});

router.get('/api/agents/history', (req, res) => {
  const agentId = String(req.query.agentId || '').trim() || undefined;
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  res.json({ success: true, history: getAgentRunHistory(agentId, limit) });
});

router.get('/api/agents/:id/chat', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  res.json({ success: true, messages: getSubagentChatHistory(agentId, limit) });
});

router.post('/api/agents/:id/chat', async (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  if (!_runInteractiveTurn) return res.status(503).json({ success: false, error: 'Subagent chat runtime is not initialized' });

  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'message is required' });

  const userMessage = appendSubagentChatMessage(agentId, {
    role: 'user',
    content: message,
    metadata: {
      source: 'subagent_chat',
      attachmentPreviews: Array.isArray(req.body?.attachmentPreviews) ? req.body.attachmentPreviews : undefined,
    },
  });
  broadcastWS({ type: 'subagent_chat_message', agentId, message: userMessage });

  const timeoutMs = Number.isFinite(Number(req.body?.timeoutMs)) && Number(req.body.timeoutMs) > 0
    ? Math.floor(Number(req.body.timeoutMs))
    : 300000;

  try {
    const attachmentContext = await getAttachmentContext().buildAttachmentRuntimeContext(req.body?.attachmentPreviews);
    const runtimeMessage = getAttachmentContext().appendAttachmentContextToMessage(message, attachmentContext.block);
    const payload = await runSubagentChatTurn(
      agentId,
      agent,
      runtimeMessage,
      timeoutMs,
      undefined,
      undefined,
      attachmentContext.visionAttachments,
    );
    res.json({ success: true, ...payload });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, messages: getSubagentChatHistory(agentId, 100) });
  }
});

router.post('/api/agents/:id/chat/stream', async (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  if (!_runInteractiveTurn) return res.status(503).json({ success: false, error: 'Subagent chat runtime is not initialized' });

  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'message is required' });

  const timeoutMs = Number.isFinite(Number(req.body?.timeoutMs)) && Number(req.body.timeoutMs) > 0
    ? Math.floor(Number(req.body.timeoutMs))
    : 300000;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendSSE = createSSESender(res);
  sendSSE('progress_state', { source: 'none', reason: 'request_start', activeIndex: -1, total: 0, items: [] });
  const heartbeat = setInterval(() => sendSSE('heartbeat', { state: 'processing' }), 5000);
  const abortSignal = { aborted: false };
  let requestCompleted = false;
  req.on('aborted', () => {
    if (!requestCompleted) {
      abortSignal.aborted = true;
    }
  });
  res.on('close', () => {
    if (!requestCompleted && !res.writableEnded) {
      abortSignal.aborted = true;
    }
  });

  const userMessage = appendSubagentChatMessage(agentId, {
    role: 'user',
    content: message,
    metadata: {
      source: 'subagent_chat',
      attachmentPreviews: Array.isArray(req.body?.attachmentPreviews) ? req.body.attachmentPreviews : undefined,
    },
  });
  broadcastWS({ type: 'subagent_chat_message', agentId, message: userMessage });

  try {
    const attachmentContext = await getAttachmentContext().buildAttachmentRuntimeContext(req.body?.attachmentPreviews);
    const runtimeMessage = getAttachmentContext().appendAttachmentContextToMessage(message, attachmentContext.block);
    const payload = await runSubagentChatTurn(
      agentId,
      agent,
      runtimeMessage,
      timeoutMs,
      sendSSE,
      abortSignal,
      attachmentContext.visionAttachments,
    );
    if (!abortSignal.aborted) {
      sendSSE('final', { text: payload.result?.text || '' });
      sendSSE('done', {
        reply: payload.result?.text || '',
        thinking: payload.result?.thinking || '',
        historyEntry: payload.historyEntry,
      });
    }
  } catch (err: any) {
    if (!abortSignal.aborted) {
      sendSSE('error', { message: err.message || 'Unknown error' });
    }
  } finally {
    requestCompleted = true;
    clearInterval(heartbeat);
    res.end();
  }
});

// Returns the next N scheduled run times for an agent (based on its cronSchedule).
router.get('/api/agents/:id/workspace/notes', (req, res) => {
  try {
    const agent = getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
    const workspacePath = resolveAgentWorkspace(agent);
    const notesDir = path.join(workspacePath, 'memory');
    if (!fs.existsSync(notesDir)) return res.json({ success: true, notes: '' });
    const candidates = fs
      .readdirSync(notesDir)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort()
      .reverse();
    const latest = candidates[0];
    if (!latest) return res.json({ success: true, notes: '' });
    const notes = fs.readFileSync(path.join(notesDir, latest), 'utf-8');
    res.json({ success: true, notes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/agents/:id/next-runs', (req, res) => {
  try {
    const agentId = _sanitizeAgentId(req.params.id);
    const agent = getAgentById(agentId);
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
    const count = Math.min(10, Math.max(1, Number(req.query.count) || 3));
    const cronExpr = String((agent as any).cronSchedule || '').trim();
    if (!cronExpr) return res.json({ success: true, nextRuns: [] });
    try {
      const { Cron } = require('croner');
      const job = new Cron(cronExpr, { paused: true, maxRuns: count });
      const runs: number[] = [];
      let next: Date | null = new Date();
      for (let i = 0; i < count; i++) {
        next = job.nextRun(next || undefined);
        if (!next) break;
        runs.push(next.getTime());
        next = new Date(next.getTime() + 1000); // advance 1s past that time
      }
      job.stop();
      return res.json({ success: true, nextRuns: runs });
    } catch {
      return res.json({ success: true, nextRuns: [] });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/agents', (req, res) => {
  const incoming = req.body?.agent || req.body || {};
  const normalized = normalizeAgentDefinition(incoming);
  if (!normalized.id) {
    res.status(400).json({ success: false, error: 'agent.id is required' });
    return;
  }
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const explicitAgents = Array.isArray(current.agents) ? current.agents : [];
  const idx = explicitAgents.findIndex((a: any) => _sanitizeAgentId(a.id) === normalized.id);
  const next = idx >= 0
    ? explicitAgents.map((a: any, i: number) => (i === idx ? { ...a, ...normalized } : a))
    : [...explicitAgents, normalized];
  const finalAgents = _normalizeAgentsForSave(next);
  cm.updateConfig({ agents: finalAgents } as any);
  const saved = finalAgents.find(a => a.id === normalized.id);
  if (saved) ensureAgentWorkspace(saved as any);
  reloadAgentSchedules();
  // Check if a team should be suggested after adding this agent
  const suggestion = checkForTeamSuggestion(normalized.id);
  if (suggestion) {
    broadcastWS({ type: 'team_suggestion', suggestion });
  }
  res.json({ success: true, agent: saved || normalized, created: idx < 0 });
});

router.put('/api/agents/:id', (req, res) => {
  const targetId = _sanitizeAgentId(req.params.id);
  if (!targetId) {
    res.status(400).json({ success: false, error: 'Invalid agent id' });
    return;
  }
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const explicitAgents = Array.isArray(current.agents) ? current.agents : [];
  const idx = explicitAgents.findIndex((a: any) => _sanitizeAgentId(a.id) === targetId);
  if (idx < 0) {
    res.status(404).json({ success: false, error: `Agent "${targetId}" not found in config` });
    return;
  }
  const merged = normalizeAgentDefinition({ ...explicitAgents[idx], ...(req.body?.agent || req.body || {}), id: targetId }, targetId);
  const next = explicitAgents.map((a: any, i: number) => (i === idx ? merged : a));
  const finalAgents = _normalizeAgentsForSave(next);
  cm.updateConfig({ agents: finalAgents } as any);
  ensureAgentWorkspace(merged as any);
  reloadAgentSchedules();
  res.json({ success: true, agent: merged });
});

router.delete('/api/agents/:id', (req, res) => {
  const targetId = _sanitizeAgentId(req.params.id);
  const cm = getConfig();
  const current = cm.getConfig() as any;
  const explicitAgents = Array.isArray(current.agents) ? current.agents : [];
  // Protect the main agent — it must always exist
  const target = explicitAgents.find((a: any) => _sanitizeAgentId(a.id) === targetId);
  if (targetId === 'main') {
    res.status(403).json({ success: false, error: 'Cannot delete the main agent.' });
    return;
  }
  const next = explicitAgents.filter((a: any) => _sanitizeAgentId(a.id) !== targetId);
  if (next.length === explicitAgents.length) {
    res.status(404).json({ success: false, error: `Agent "${targetId}" not found` });
    return;
  }
  const finalAgents = _normalizeAgentsForSave(next);
  cm.updateConfig({ agents: finalAgents } as any);

  // Remove this agent from managed team membership and pending changes.
  const affectedTeams: Array<{ id: string; name: string; removedFromMembers: boolean; removedTeam: boolean }> = [];
  for (const team of listManagedTeams()) {
    let touched = false;
    const beforeCount = (team.subagentIds || []).length;
    team.subagentIds = (team.subagentIds || []).filter(id => _sanitizeAgentId(id) !== targetId);
    if (team.subagentIds.length !== beforeCount) touched = true;

    const pendingBefore = (team.pendingChanges || []).length;
    team.pendingChanges = (team.pendingChanges || []).filter(c => _sanitizeAgentId(c.targetSubagentId || '') !== targetId);
    if (team.pendingChanges.length !== pendingBefore) touched = true;

    const historyBefore = (team.changeHistory || []).length;
    team.changeHistory = (team.changeHistory || []).filter(c => _sanitizeAgentId(c.targetSubagentId || '') !== targetId);
    if (team.changeHistory.length !== historyBefore) touched = true;

    if (team.manager?.savedSchedules && Object.prototype.hasOwnProperty.call(team.manager.savedSchedules, targetId)) {
      const copy = { ...(team.manager.savedSchedules || {}) };
      delete copy[targetId];
      team.manager = { ...team.manager, savedSchedules: copy };
      touched = true;
    }

    if (!touched) continue;
    if ((team.subagentIds || []).length === 0) {
      deleteManagedTeam(team.id);
      affectedTeams.push({ id: team.id, name: team.name, removedFromMembers: true, removedTeam: true });
      broadcastTeamEvent({ type: 'team_deleted', teamId: team.id, teamName: team.name });
    } else {
      saveManagedTeam(team);
      affectedTeams.push({ id: team.id, name: team.name, removedFromMembers: true, removedTeam: false });
      broadcastTeamEvent({ type: 'team_updated', teamId: team.id, teamName: team.name });
    }
  }

  // Delete one-shot/recurring scheduler jobs bound to this subagent.
  let deletedScheduledJobs = 0;
  for (const job of _cronScheduler.getJobs()) {
    if (_sanitizeAgentId((job as any).subagent_id || '') !== targetId) continue;
    if (_cronScheduler.deleteJob(job.id)) deletedScheduledJobs++;
  }

  // Hard-delete generated subagent directories for this agent.
  const cfgWorkspace = getConfig().getWorkspacePath() || process.cwd();
  const candidateDirs = new Set<string>([
    path.join(cfgWorkspace, '.prometheus', 'subagents', targetId),
    path.join(process.cwd(), '.prometheus', 'subagents', targetId),
  ]);
  if (target?.workspace) candidateDirs.add(String(target.workspace));

  const safeSuffixes = [
    `/.prometheus/subagents/${targetId}`.toLowerCase(),
    `/subagents/${targetId}`.toLowerCase(),
  ];
  const removedPaths: string[] = [];
  for (const dir of candidateDirs) {
    try {
	      const resolved = path.resolve(dir);
	      const normalized = resolved.replace(/\\/g, '/').toLowerCase();
	      const underWorkspace = normalized.startsWith(path.resolve(cfgWorkspace).replace(/\\/g, '/').toLowerCase() + '/');
	      if (!underWorkspace || !safeSuffixes.some((suffix) => normalized.endsWith(suffix))) continue;
      if (!fs.existsSync(resolved)) continue;
      fs.rmSync(resolved, { recursive: true, force: true });
      removedPaths.push(resolved);
    } catch {}
  }

  reloadAgentSchedules();
  res.json({
    success: true,
    agentId: targetId,
    removedPaths,
    deletedScheduledJobs,
    affectedTeams,
  });
});

// Helper: resolve the correct workspace for an agent, preferring the registered
// workspace field. Standalone agents live in workspace/.prometheus/subagents/<id>;
// team agents live in workspace/teams/<teamId>/subagents/<id>.
function resolveAgentWorkspaceSafe(agent: any): string {
  if (agent.workspace) return agent.workspace;
  // Fallback: check workspace/.prometheus/subagents/<id> for standalone agents.
  const subagentPath = path.join(getConfig().getWorkspacePath(), '.prometheus', 'subagents', agent.id);
  if (fs.existsSync(subagentPath)) return subagentPath;
  // Final fallback: standard ensureAgentWorkspace path
  return ensureAgentWorkspace(agent);
}

router.get('/api/agents/:id/agents-md', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
    return;
  }
  const workspace = resolveAgentWorkspaceSafe(agent);
  fs.mkdirSync(workspace, { recursive: true });
  const filePath = path.join(workspace, 'AGENTS.md');
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  res.json({ success: true, agentId, path: filePath, content });
});

router.put('/api/agents/:id/agents-md', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
    return;
  }
  const content = String(req.body?.content || '');
  const workspace = resolveAgentWorkspaceSafe(agent);
  fs.mkdirSync(workspace, { recursive: true });
  const filePath = path.join(workspace, 'AGENTS.md');
  fs.writeFileSync(filePath, content, 'utf-8');
  res.json({ success: true, path: filePath });
});

// Heartbeat instructions file (always HEARTBEAT.md)
router.get('/api/agents/:id/heartbeat-md', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  const workspace = resolveAgentWorkspaceSafe(agent);
  const heartbeatPath = path.join(workspace, 'HEARTBEAT.md');
  const filePath = heartbeatPath;
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  res.json({ success: true, agentId, path: filePath, content });
});

router.put('/api/agents/:id/heartbeat-md', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  const content = String(req.body?.content || '');
  const workspace = resolveAgentWorkspaceSafe(agent);
  const heartbeatPath = path.join(workspace, 'HEARTBEAT.md');
  const filePath = heartbeatPath;
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  res.json({ success: true, path: filePath });
});

// Task prompt file for subagents/system-managed agents.
router.get('/api/agents/:id/system-prompt-md', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  const workspace = resolveAgentWorkspaceSafe(agent);
  const filePath = path.join(workspace, 'system_prompt.md');
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  res.json({ success: true, agentId, path: filePath, content });
});

router.put('/api/agents/:id/system-prompt-md', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  const content = String(req.body?.content || '');
  const workspace = resolveAgentWorkspaceSafe(agent);
  const filePath = path.join(workspace, 'system_prompt.md');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  res.json({ success: true, path: filePath });
});

// GET /api/agents/:id/subagent-config — read src_read_access + can_propose from workspace config.json
router.get('/api/agents/:id/subagent-config', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  const workspace = resolveAgentWorkspaceSafe(agent);
  const cfgPath = path.join(workspace, 'config.json');
  let config: any = {};
  try { if (fs.existsSync(cfgPath)) config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch {}
  res.json({ success: true, src_read_access: config.src_read_access === true, can_propose: config.can_propose === true });
});

// PUT /api/agents/:id/subagent-config — write src_read_access + can_propose to workspace config.json
router.put('/api/agents/:id/subagent-config', (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
  const workspace = resolveAgentWorkspaceSafe(agent);
  fs.mkdirSync(workspace, { recursive: true });
  const cfgPath = path.join(workspace, 'config.json');
  let existing: any = {};
  try { if (fs.existsSync(cfgPath)) existing = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch {}
  const updated = {
    ...existing,
    src_read_access: req.body?.src_read_access === true,
    can_propose: req.body?.can_propose === true,
  };
  fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), 'utf-8');
  res.json({ success: true, config: updated });
});

// ─── Agent Context References ────────────────────────────────────────────────

function loadAgentContextRefs(workspace: string): any[] {
  const p = path.join(workspace, 'context-refs.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')).refs || []; } catch { return []; }
}

function saveAgentContextRefs(workspace: string, refs: any[]): void {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'context-refs.json'), JSON.stringify({ refs }, null, 2), 'utf-8');
}

router.get('/api/agents/:id/context-refs', (req, res) => {
  const agent = getAgentById(_sanitizeAgentId(req.params.id));
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
  const workspace = resolveAgentWorkspaceSafe(agent);
  res.json({ success: true, refs: loadAgentContextRefs(workspace) });
});

router.post('/api/agents/:id/context-refs', (req, res) => {
  const agent = getAgentById(_sanitizeAgentId(req.params.id));
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '').trim();
  if (!title || !content) return res.status(400).json({ success: false, error: 'title and content are required' });
  const workspace = resolveAgentWorkspaceSafe(agent);
  const refs = loadAgentContextRefs(workspace);
  const ref = { id: `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`, title, content, createdAt: Date.now(), updatedAt: Date.now() };
  refs.push(ref);
  saveAgentContextRefs(workspace, refs);
  res.json({ success: true, ref });
});

router.put('/api/agents/:id/context-refs/:refId', (req, res) => {
  const agent = getAgentById(_sanitizeAgentId(req.params.id));
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
  const workspace = resolveAgentWorkspaceSafe(agent);
  const refs = loadAgentContextRefs(workspace);
  const idx = refs.findIndex(r => r.id === req.params.refId);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Ref not found' });
  if (req.body?.title !== undefined) refs[idx].title = String(req.body.title).trim();
  if (req.body?.content !== undefined) refs[idx].content = String(req.body.content).trim();
  refs[idx].updatedAt = Date.now();
  saveAgentContextRefs(workspace, refs);
  res.json({ success: true, ref: refs[idx] });
});

router.delete('/api/agents/:id/context-refs/:refId', (req, res) => {
  const agent = getAgentById(_sanitizeAgentId(req.params.id));
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
  const workspace = resolveAgentWorkspaceSafe(agent);
  const refs = loadAgentContextRefs(workspace);
  const filtered = refs.filter(r => r.id !== req.params.refId);
  if (filtered.length === refs.length) return res.status(404).json({ success: false, error: 'Ref not found' });
  saveAgentContextRefs(workspace, filtered);
  res.json({ success: true });
});

// POST /api/agents/:id/context-files — upload a file to the agent's context-files dir
// Body: { filename, content (text or base64), encoding?: 'base64'|'text', title? }
router.post('/api/agents/:id/context-files', (req, res) => {
  const agent = getAgentById(_sanitizeAgentId(req.params.id));
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
  const rawFilename = String(req.body?.filename || '').trim();
  if (!rawFilename) return res.status(400).json({ success: false, error: 'filename is required' });
  const safeFilename = path.basename(rawFilename).replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 120);
  const content = String(req.body?.content || '');
  const encoding = String(req.body?.encoding || 'text');
  const title = String(req.body?.title || safeFilename).trim().slice(0, 120);
  const workspace = resolveAgentWorkspaceSafe(agent);
  const filesDir = path.join(workspace, 'context-files');
  fs.mkdirSync(filesDir, { recursive: true });
  const filePath = path.join(filesDir, safeFilename);
  if (encoding === 'base64') {
    fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
  } else {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  // Add a context ref pointing to this file
  const refs = loadAgentContextRefs(workspace);
  const relPath = `context-files/${safeFilename}`;
  const ref = {
    id: `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
    title,
    content: `File uploaded for context: ${relPath}\nRead this file before performing tasks that may relate to its content.`,
    filePath: relPath,
    isFile: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  refs.push(ref);
  saveAgentContextRefs(workspace, refs);
  res.json({ success: true, ref, filePath: relPath });
});

router.post('/api/agents/:id/spawn', async (req, res) => {
  const agentId = _sanitizeAgentId(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
    return;
  }
  const task = String(req.body?.task || '').trim();
  if (!task) {
    res.status(400).json({ success: false, error: 'task is required' });
    return;
  }
  // Inject context refs into the context block
  const workspace = resolveAgentWorkspaceSafe(agent);
  const refs = loadAgentContextRefs(workspace);
  let contextRefsBlock = '';
  if (refs.length > 0) {
    const lines = refs.map(r => `- **${r.title}**: ${r.content}`).join('\n');
    contextRefsBlock = `[CONTEXT REFERENCES]\n${lines}\n`;
  }
  const rawContext = req.body?.context !== undefined ? String(req.body.context) : undefined;
  const context = contextRefsBlock
    ? [contextRefsBlock, rawContext].filter(Boolean).join('\n\n')
    : rawContext;
  const maxStepsRaw = req.body?.maxSteps;
  const maxSteps = Number.isFinite(Number(maxStepsRaw)) && Number(maxStepsRaw) > 0
    ? Math.floor(Number(maxStepsRaw))
    : undefined;
  const timeoutRaw = req.body?.timeoutMs;
  const timeoutMs = Number.isFinite(Number(timeoutRaw)) && Number(timeoutRaw) > 0
    ? Math.floor(Number(timeoutRaw))
    : 120000;
  const teamMemberIds = getTeamMemberAgentIds();
  const allTeams = listManagedTeams();
  const isManager = !!(agent as any)?.isTeamManager || allTeams.some((team: any) => String(team?.managerAgentId || '').trim() === agentId);
  const agentType = inferAgentModelDefaultType(agent, {
    isManager,
    isTeamMember: teamMemberIds.has(agentId),
  });

  const startedAt = Date.now();
  const result = await spawnAgent({
    agentId,
    task,
    context,
    maxSteps,
    timeoutMs,
    agentType,
  });
  const finishedAt = Date.now();
  const historyEntry = recordAgentRun({
    agentId: result.agentId,
    agentName: result.agentName,
    trigger: 'manual',
    success: result.success,
    startedAt,
    finishedAt,
    durationMs: result.durationMs,
    stepCount: result.stepCount,
    error: result.error,
    resultPreview: result.success ? String(result.result || '') : undefined,
  });
  res.json({ success: result.success, result, historyEntry });
});

// ─── Piece 5: dispatch_to_agent Webhook ───────────────────────────────────────────
// POST /api/dispatch  — route a task to a named agent from external systems
router.post('/api/dispatch', async (req: any, res: any) => {
  const agentId = String(req.body?.agent_id || req.body?.agentId || '').trim();
  const message = String(req.body?.message || req.body?.task || '').trim();
  const context = req.body?.context !== undefined ? String(req.body.context) : undefined;

  if (!agentId) {
    return res.status(400).json({ success: false, error: 'agent_id is required' });
  }
  if (!message) {
    return res.status(400).json({ success: false, error: 'message (or task) is required' });
  }

  try {
    const result = await _dispatchToAgent(agentId, message, context, 'webhook');
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
