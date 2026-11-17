/**
 * Live connected agents (stage 3: Codex). Mounted with the same auth
 * middleware as imports.router.ts. No route reads an agent's auth files or
 * starts a login; enable/verify use the agent's own status answer.
 */
import { Router } from 'express';

import { listAgentGroups } from '../imports/import-agents';
import {
  disableExternalAgent,
  enableExternalAgent,
  getExternalAgentSnapshot,
  listExternalAgentSnapshots,
  parseExternalAgentId,
  verifyExternalAgent,
} from '../external-agents/registry';
import { listPendingRequests, respondToPendingRequest } from '../external-agents/pending-requests';
import { startFreshUpstreamSession } from '../external-agents/turn-runner';
import { getSessionExternalAgent } from '../session';

export const router = Router();

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
