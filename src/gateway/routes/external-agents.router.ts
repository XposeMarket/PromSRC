/**
 * Live connected agents (stage 3: Codex). Mounted with the same auth
 * middleware as imports.router.ts. No route reads an agent's auth files or
 * starts a login; enable/verify use the agent's own status answer.
 */
import { Router } from 'express';

import { listAgentGroups } from '../imports/import-agents';
import { isPickableAgentFolder } from '../external-agents/scratch-folders';
import { findProjectBySessionId, listProjects } from '../projects/project-store';
import { getConfig } from '../../config/config';
import {
  getExternalAgentAdapter,
  isExternalAgentUsable,
  disableExternalAgent,
  enableExternalAgent,
  getExternalAgentSnapshot,
  listExternalAgentSnapshots,
  parseExternalAgentId,
  verifyExternalAgent,
} from '../external-agents/registry';
import { listPendingRequests, respondToPendingRequest } from '../external-agents/pending-requests';
import { resolveExternalAgentCwd, bindExternalAgentForRequest, startFreshUpstreamSession } from '../external-agents/turn-runner';
import { getSessionExternalAgent, listSessionSummaries } from '../session';
import { DOTS_AGENT_ID, startDotsPoller, syncAllDots } from '../dots/dots-sync';

export const router = Router();

// OpenAI Dots: mirror each dot's one conversation in the background (no-op while Dots is off).
startDotsPoller();

function syncDotsSoon(id: string): void {
  if (id === DOTS_AGENT_ID) void syncAllDots(true).catch(() => undefined);
}

/** Pull new dot messages now (opening a dot chat, pull-to-refresh). */
router.post('/api/external-agents/openai-dots/sync', async (_req, res) => {
  try {
    res.json({ success: true, ...(await syncAllDots(true)) });
  } catch (error) {
    res.status(502).json({ success: false, error: errorMessage(error) });
  }
});

const IMPORT_SOURCE_AGENT: Record<string, string> = {
  codex: 'codex', 'codex-local': 'codex', openai_codex: 'codex',
  claude: 'claude-code', 'claude-code': 'claude-code', 'claude-code-local': 'claude-code',
  hermes: 'hermes', 'hermes-local': 'hermes', openclaw: 'openclaw', 'openclaw-local': 'openclaw',
  cursor: 'cursor', 'cursor-local': 'cursor',
};

/**
 * Which harness each chat belongs to, for the sidebar harness filter and the
 * per-harness project folders. Live chats use their binding; imported chats
 * use their import source. Chats not listed are Prometheus chats. Registered
 * before /api/external-agents/:id so the literal path wins.
 */
router.get('/api/external-agents/session-map', (_req, res) => {
  const sessions: Record<string, { agentId: string; cwd?: string; title: string; at: number; imported?: boolean; projectId?: string }> = {};
  try {
    for (const s of listSessionSummaries() as any[]) {
      if (!s?.id) continue;
      const at = Number(s.lastMessageAt || s.lastActiveAt || s.updatedAt || s.createdAt || 0) || 0;
      const title = String(s.title || 'New chat').slice(0, 200);
      if (s.externalAgent?.agentId) {
        // Chats filed in a Prometheus project show there, not in the harness section.
        let projectId = '';
        try { projectId = findProjectBySessionId(s.id)?.id || ''; } catch { projectId = ''; }
        sessions[s.id] = { agentId: String(s.externalAgent.agentId), cwd: String(s.externalAgent.cwd || ''), title, at, ...(projectId ? { projectId } : {}) };
        continue;
      }
      const src = s.externalImport?.source || {};
      const key = [src.adapter, src.provider].map((v: any) => String(v || '').trim().toLowerCase()).find((v: string) => IMPORT_SOURCE_AGENT[v]);
      if (key) {
        let projectId = '';
        try { projectId = findProjectBySessionId(s.id)?.id || ''; } catch { projectId = ''; }
        sessions[s.id] = { agentId: IMPORT_SOURCE_AGENT[key], title, at, imported: true, ...(projectId ? { projectId } : {}) };
      }
    }
  } catch {
    /* an unreadable index means an empty map, never a failed sidebar */
  }
  res.json({ success: true, sessions });
});

router.get('/api/external-agents/:id/models', async (req, res) => {
  const id = parseExternalAgentId(req.params.id);
  const adapter = id && getExternalAgentAdapter(id);
  if (!id || !adapter || !isExternalAgentUsable(id).ok) { res.status(409).json({ success: false, error: 'Agent is not connected.' }); return; }
  const sessionId = String(req.query.sessionId || '');
  const binding = sessionId ? getSessionExternalAgent(sessionId) : null;
  if (binding && binding.agentId !== id) { res.status(409).json({ success: false, error: 'This chat belongs to another agent.' }); return; }
  const cwd = resolveExternalAgentCwd(sessionId, binding?.cwd || String(req.query.cwd || ''));
  if (!cwd.ok) { res.status(400).json({ success: false, error: cwd.error }); return; }
  try {
    const catalog = await adapter.listModels?.({ cwd: cwd.cwd, upstreamSessionId: binding?.upstreamSessionId });
    res.json({ success: true, ...(catalog || { models: [], unavailableReason: 'This agent does not expose model choices.' }), ...(binding?.selectedModel || binding?.currentModel ? { currentModel: binding.selectedModel || binding.currentModel } : {}) });
  } catch { res.status(502).json({ success: false, error: 'Could not read the agent model choices. Check its connection.' }); }
});

router.put('/api/external-agents/sessions/:sessionId/model', async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const binding = getSessionExternalAgent(sessionId);
  if (!binding || !isExternalAgentUsable(binding.agentId).ok) { res.status(409).json({ success: false, error: 'No connected agent owns this chat.' }); return; }
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const effort = typeof req.body?.effort === 'string' ? req.body.effort.trim().toLowerCase() : '';
  try {
    const catalog = await getExternalAgentAdapter(binding.agentId)?.listModels?.({ cwd: binding.cwd, upstreamSessionId: binding.upstreamSessionId });
    const entry = model ? catalog?.models.find(item => item.id === model) : undefined;
    if (!entry) { res.status(400).json({ success: false, error: 'Choose a model reported by this agent.' }); return; }
    if (effort && !(entry.efforts || []).includes(effort)) { res.status(400).json({ success: false, error: 'This model does not offer that reasoning level.' }); return; }
    if (!isExternalAgentUsable(binding.agentId).ok) { res.status(409).json({ success: false, error: 'Agent was disconnected.' }); return; }
    const result = bindExternalAgentForRequest(sessionId, { id: binding.agentId, model, effort });
    if (!result.ok) { res.status(result.status).json({ success: false, error: result.error }); return; }
    res.json({ success: true, model, ...(effort ? { effort } : {}) });
  } catch { res.status(502).json({ success: false, error: 'Could not validate the agent model.' }); }
});

function errorMessage(error: unknown): string {
  return String((error as any)?.message || error || 'Unknown error').slice(0, 300);
}

function requireAgentId(req: any, res: any) {
  const id = parseExternalAgentId(req.params.id);
  if (!id) {
    res.status(404).json({ success: false, error: 'Unknown agent.' });
    return null;
  }
  return id;
}

router.get('/api/external-agents', async (_req, res) => {
  try {
    res.json({ success: true, agents: await listExternalAgentSnapshots() });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

router.get('/api/external-agents/requests', (req, res) => {
  const sessionId = String(req.query.sessionId || '').trim();
  if (!sessionId) {
    res.status(400).json({ success: false, error: 'sessionId is required.' });
    return;
  }
  res.json({ success: true, requests: listPendingRequests(sessionId) });
});

router.post('/api/external-agents/requests/:requestId/respond', (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  const binding = sessionId ? getSessionExternalAgent(sessionId) : undefined;
  if (!sessionId || !binding) {
    res.status(404).json({ success: false, error: 'Unknown request.' });
    return;
  }
  // Answers go ONLY to the upstream request. Nothing is written to any
  // Prometheus approval, permission or trusted-command store.
  const outcome = respondToPendingRequest(String(req.params.requestId || ''), {
    optionId: String(req.body?.optionId || ''),
    ...(req.body?.answers && typeof req.body.answers === 'object' ? { answers: req.body.answers } : {}),
    ...(typeof req.body?.text === 'string' ? { text: req.body.text } : {}),
  }, { sessionId, agentId: binding.agentId });
  if (!outcome.ok) {
    res.status(outcome.status).json({ success: false, error: outcome.error });
    return;
  }
  res.json({ success: true });
});

/** Which agent runs this chat (summary only; nothing from the agent's auth). */
router.get('/api/external-agents/sessions/:sessionId', (req, res) => {
  const binding = getSessionExternalAgent(String(req.params.sessionId || ''));
  res.json({
    success: true,
    externalAgent: binding
      ? {
          agentId: binding.agentId,
          cwd: binding.cwd,
          hasUpstream: !!binding.upstreamSessionId,
          currentModel: binding.currentModel,
          selectedModel: binding.selectedModel,
          selectedEffort: binding.selectedEffort,
          ...(binding.lastTurn?.status ? { lastTurnStatus: binding.lastTurn.status } : {}),
          upstreamMissing: binding.lastTurn?.upstreamMissing === true || (binding.lastTurn?.status === 'failed' && /can't find this session/i.test(String(binding.lastTurn?.error || ''))),
        }
      : null,
  });
});

router.post('/api/external-agents/sessions/:sessionId/new-upstream', (req, res) => {
  const binding = startFreshUpstreamSession(String(req.params.sessionId || ''));
  if (!binding) {
    res.status(404).json({ success: false, error: 'This chat is not run by a connected agent.' });
    return;
  }
  res.json({ success: true, externalAgent: { agentId: binding.agentId, cwd: binding.cwd, hasUpstream: false } });
});

router.post('/api/external-agents/:id/enable', async (req, res) => {
  const id = requireAgentId(req, res);
  if (!id) return;
  try {
    const agent = await enableExternalAgent(id);
    syncDotsSoon(id);
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

router.post('/api/external-agents/:id/verify', async (req, res) => {
  const id = requireAgentId(req, res);
  if (!id) return;
  try {
    const agent = await verifyExternalAgent(id);
    syncDotsSoon(id);
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

router.post('/api/external-agents/:id/disable', async (req, res) => {
  const id = requireAgentId(req, res);
  if (!id) return;
  try {
    res.json({ success: true, agent: await disableExternalAgent(id) });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

router.get('/api/external-agents/:id', async (req, res) => {
  const id = requireAgentId(req, res);
  if (!id) return;
  res.json({ success: true, agent: await getExternalAgentSnapshot(id) });
});

// A cold scan blocks ~2s per harness on a big history, so rescans stay rare.
const FOLDER_SCAN_TTL_MS = 5 * 60_000;
const folderScanCache = new Map<string, { at: number; groups: ReturnType<typeof listAgentGroups>['groups'] }>();

/** Recent folders for the cwd picker, from the agent's own chat groups (import discovery). */
router.get('/api/external-agents/:id/folders', (req, res) => {
  const id = requireAgentId(req, res);
  if (!id) return;
  try {
    let workspacePath = '';
    try { workspacePath = getConfig().getWorkspacePath(); } catch { /* picker still filters OS temp */ }
    const norm = (p: string) => String(p || '').trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
    // Scanning a harness's history is synchronous and slow for big histories (Codex: 1000+
    // chats). Pickers and sidebars poll this, so reuse the scan for a minute; project links
    // below are computed fresh every time (cheap).
    const scanKey = id === 'claude-code' ? 'claude' : id;
    let cached = folderScanCache.get(scanKey);
    if (!cached || Date.now() - cached.at > FOLDER_SCAN_TTL_MS) {
      cached = { at: Date.now(), groups: listAgentGroups(scanKey).groups };
      folderScanCache.set(scanKey, cached);
    }
    const folders: Array<{ path: string; label: string; chatCount?: number; updatedAt?: number; projectId?: string; projectName?: string }> =
      cached.groups
        .filter((group) => group.path && isPickableAgentFolder(group.path, { workspacePath }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20)
        .map((group) => ({ path: group.path as string, label: group.label, chatCount: group.chatCount, updatedAt: group.updatedAt }));
    // One project, any agent: Prometheus projects with a linked folder are offered first,
    // whether or not this harness has worked there before.
    const linked: typeof folders = [];
    try {
      for (const project of listProjects()) {
        const folder = String(project.workspacePath || '').trim();
        if (!folder || !isPickableAgentFolder(folder, { workspacePath: '' })) continue;
        const hit = folders.findIndex((f) => norm(f.path) === norm(folder));
        const base = hit >= 0 ? folders.splice(hit, 1)[0] : { path: folder, label: folder };
        linked.push({ ...base, projectId: project.id, projectName: project.name });
      }
    } catch { /* projects unavailable: harness folders only */ }
    res.json({ success: true, folders: [...linked, ...folders] });
  } catch {
    res.json({ success: true, folders: [] });
  }
});
