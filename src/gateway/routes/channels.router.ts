// src/gateway/routes/channels.router.ts
// Channels (Telegram/Discord/WhatsApp), Agents, Dispatch routes
import { Router } from 'express';
import { getConfig, getAgents, getAgentById, ensureAgentWorkspace, resolveAgentWorkspace } from '../../config/config';
import { broadcastWS, broadcastTeamEvent, resolveChannelsConfig, normalizeTelegramConfig, normalizeDiscordConfig, normalizeWhatsAppConfig } from '../comms/broadcaster';
import { listManagedTeams, saveManagedTeam, deleteManagedTeam } from '../teams/managed-teams';
import { reloadAgentSchedules, recordAgentRun, getAgentRunHistory, getAgentLastRun } from '../../scheduler';
import { spawnAgent } from '../../agents/spawner';
import * as fs from 'fs';
import * as path from 'path';
import { getTeamMemberAgentIds } from '../teams/managed-teams';
import { checkForTeamSuggestion } from '../teams/team-detector';

type DiscordChannelConfig = any;
type WhatsAppChannelConfig = any;

export const router = Router();

let _cronScheduler: any;
let _telegramChannel: any;


let _dispatchToAgent: (agentId: string, message: string, context: string | undefined, source: string) => Promise<any>;

export function initChannelsRouter(deps: {
  cronScheduler: any;
  telegramChannel: any;
  dispatchToAgent: (agentId: string, message: string, context: string | undefined, source: string) => Promise<any>;
}): void {
  _cronScheduler = deps.cronScheduler;
  _telegramChannel = deps.telegramChannel;
  _dispatchToAgent = deps.dispatchToAgent;
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

  res.json({
    success: true,
    channels: {
      telegram: { enabled: mergedTelegram.enabled, hasToken: !!mergedTelegram.botToken, allowedUserIds: mergedTelegram.allowedUserIds },
      discord: { enabled: mergedDiscord.enabled, hasToken: !!mergedDiscord.botToken, hasWebhook: !!mergedDiscord.webhookUrl },
      whatsapp: { enabled: mergedWhatsApp.enabled, hasAccessToken: !!mergedWhatsApp.accessToken, phoneNumberId: mergedWhatsApp.phoneNumberId },
    },
  });
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
      await _telegramChannel.sendToAllowed('🦞 SmallClaw test message - Telegram is connected!');
      res.json({ success: true });
    } catch (err: any) {
      res.json({ success: false, error: String(err?.message || err) });
    }
    return;
  }

  if (channel === 'discord') {
    const dc = normalizeDiscordConfig({ ...channels.discord, ...(req.body || {}) });
    const text = String(req.body?.text || '🦞 SmallClaw test message - Discord is connected!');
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
    const text = String(req.body?.text || 'SmallClaw test message - WhatsApp is connected!');
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

type AgentToolProfile = 'minimal' | 'coding' | 'web' | 'full';

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
  const profile = String(raw?.tools?.profile || '').trim();
  const normalized: any = {
    id,
    name: String(raw?.name || id || 'Agent').trim() || 'Agent',
  };
  if (raw?.description !== undefined) normalized.description = String(raw.description || '').trim();
  if (raw?.emoji !== undefined) normalized.emoji = String(raw.emoji || '').trim();
  if (raw?.workspace !== undefined) normalized.workspace = String(raw.workspace || '').trim();
  if (raw?.model !== undefined) normalized.model = String(raw.model || '').trim();
  if (typeof raw?.minimalPrompt === 'boolean') normalized.minimalPrompt = raw.minimalPrompt;
  if (typeof raw?.default === 'boolean') normalized.default = raw.default;
  if (typeof raw?.canSpawn === 'boolean') normalized.canSpawn = raw.canSpawn;
  if (raw?.cronSchedule !== undefined) normalized.cronSchedule = String(raw.cronSchedule || '').trim();
  if (raw?.maxSteps !== undefined) {
    const n = Number(raw.maxSteps);
    if (Number.isFinite(n) && n > 0) normalized.maxSteps = Math.floor(n);
  }
  if (Array.isArray(raw?.spawnAllowlist)) {
    normalized.spawnAllowlist = raw.spawnAllowlist
      .map((v: any) => _sanitizeAgentId(v))
      .filter((v: string) => !!v);
  }
  if (raw?.tools && typeof raw.tools === 'object') {
    normalized.tools = {};
    if (Array.isArray(raw.tools.allow)) normalized.tools.allow = raw.tools.allow.map((s: any) => String(s || '').trim()).filter(Boolean);
    if (Array.isArray(raw.tools.deny)) normalized.tools.deny = raw.tools.deny.map((s: any) => String(s || '').trim()).filter(Boolean);
    if (['minimal', 'coding', 'web', 'full'].includes(profile)) normalized.tools.profile = profile as AgentToolProfile;
    if (!normalized.tools.allow && !normalized.tools.deny && !normalized.tools.profile) delete normalized.tools;
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
  if (out.length > 0 && !out.some(a => a.default === true)) out[0].default = true;
  if (out.filter(a => a.default === true).length > 1) {
    let found = false;
    for (const a of out) {
      if (a.default === true && !found) { found = true; continue; }
      if (a.default === true) a.default = false;
    }
  }
  return out;
}

function findLastCronRunAt(agentId: string): number | null {
  const entries = getAgentRunHistory(agentId, 100);
  const hit = entries.find((e) => e.trigger === 'cron');
  return hit ? hit.finishedAt : null;
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
    return {
      ...agent,
      workspaceResolved: workspace,
      workspaceExists: fs.existsSync(workspace),
      isSynthetic: agent.id === 'main' && !explicitAgents.some((a: any) => _sanitizeAgentId(a.id) === 'main'),
      lastRun: lastRun || null,
      lastHeartbeatAt: findLastCronRunAt(agent.id),
      isTeamMember: teamMemberIds.has(agent.id),
      isTeamManager: isManager,
      teamId: teamInfo?.teamId || null,
      teamName: teamInfo?.teamName || null,
      teamEmoji: teamInfo?.teamEmoji || null,
    };
  });
  const defaultAgent = agents.find((a) => a.default) || agents[0] || null;
  res.json({ success: true, agents, defaultAgentId: defaultAgent?.id || null, teamMemberIds: Array.from(teamMemberIds) });
});

router.get('/api/agents/history', (req, res) => {
  const agentId = String(req.query.agentId || '').trim() || undefined;
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  res.json({ success: true, history: getAgentRunHistory(agentId, limit) });
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
  // Protect the default (main) agent — it must always exist
  const target = explicitAgents.find((a: any) => _sanitizeAgentId(a.id) === targetId);
  if (target?.default === true) {
    res.status(403).json({ success: false, error: 'Cannot delete the default agent. Reassign default to another agent first.' });
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

  const safeSuffix = `/.prometheus/subagents/${targetId}`.toLowerCase();
  const removedPaths: string[] = [];
  for (const dir of candidateDirs) {
    try {
      const resolved = path.resolve(dir);
      const normalized = resolved.replace(/\\/g, '/').toLowerCase();
      if (!normalized.endsWith(safeSuffix)) continue;
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
// workspace field (which points to workspace/.prometheus/subagents/<id> for subagents)
// over the CONFIG_DIR fallback which points to the wrong .prometheus/agents dir.
function resolveAgentWorkspaceSafe(agent: any): string {
  if (agent.workspace) return agent.workspace;
  // Fallback: check workspace/.prometheus/subagents/<id> first (team subagents)
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
  const context = req.body?.context !== undefined ? String(req.body.context) : undefined;
  const maxStepsRaw = req.body?.maxSteps;
  const maxSteps = Number.isFinite(Number(maxStepsRaw)) && Number(maxStepsRaw) > 0
    ? Math.floor(Number(maxStepsRaw))
    : undefined;
  const timeoutRaw = req.body?.timeoutMs;
  const timeoutMs = Number.isFinite(Number(timeoutRaw)) && Number(timeoutRaw) > 0
    ? Math.floor(Number(timeoutRaw))
    : 120000;

  const startedAt = Date.now();
  const result = await spawnAgent({
    agentId,
    task,
    context,
    maxSteps,
    timeoutMs,
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
