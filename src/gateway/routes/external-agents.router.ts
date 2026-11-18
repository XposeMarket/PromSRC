/**
 * Live connected agents (stage 3: Codex). Mounted with the same auth
 * middleware as imports.router.ts. No route reads an agent's auth files or
 * starts a login; enable/verify use the agent's own status answer.
 */
import { Router } from 'express';

import { listAgentGroups } from '../imports/import-agents';
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

export const router = Router();

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
  const sessions: Record<string, { agentId: string; cwd?: string; title: string; at: number; imported?: boolean }> = {};
  try {
    for (const s of listSessionSummaries() as any[]) {
      if (!s?.id) continue;
      const at = Number(s.lastMessageAt || s.lastActiveAt || s.updatedAt || s.createdAt || 0) || 0;
      const title = String(s.title || 'New chat').slice(0, 200);
      if (s.externalAgent?.agentId) {
        sessions[s.id] = { agentId: String(s.externalAgent.agentId), cwd: String(s.externalAgent.cwd || ''), title, at };
        continue;
      }
      const src = s.externalImport?.source || {};
      const key = [src.adapter, src.provider].map((v: any) => String(v || '').trim().toLowerCase()).find((v: string) => IMPORT_SOURCE_AGENT[v]);
      if (key) sessions[s.id] = { agentId: IMPORT_SOURCE_AGENT[key], title, at, imported: true };
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
    res.json({ success: true, agent: await enableExternalAgent(id) });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

router.post('/api/external-agents/:id/verify', async (req, res) => {
  const id = requireAgentId(req, res);
  if (!id) return;
  try {
    res.json({ success: true, agent: await verifyExternalAgent(id) });
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

/** Recent folders for the cwd picker, from the agent's own chat groups (import discovery). */
router.get('/api/external-agents/:id/folders', (req, res) => {
  const id = requireAgentId(req, res);
  if (!id) return;
  try {
    const groups = listAgentGroups(id === 'claude-code' ? 'claude' : id).groups
      .filter((group) => group.path)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map((group) => ({ path: group.path, label: group.label, chatCount: group.chatCount, updatedAt: group.updatedAt }));
    res.json({ success: true, folders: groups });
  } catch {
    res.json({ success: true, folders: [] });
  }
});
