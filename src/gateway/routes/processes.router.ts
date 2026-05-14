import express from 'express';
import { getProcessSupervisor } from '../process/supervisor';
import { validateShellRequest } from '../../tools/shell.js';

export const router = express.Router();

function normalizeLimit(value: unknown, fallback = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function normalizeMaxChars(value: unknown, fallback = 200_000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1000, Math.min(1_000_000, Math.floor(parsed)));
}

router.get('/api/processes', (req, res) => {
  const limit = normalizeLimit(req.query.limit);
  res.json({ runs: getProcessSupervisor().list(limit) });
});

router.post('/api/processes', async (req, res) => {
  try {
    const body = req.body || {};
    const validation = validateShellRequest({
      command: String(body.command || ''),
      cwd: body.cwd ? String(body.cwd) : undefined,
    });
    if (!validation.ok) {
      res.status(403).json({ error: validation.result.error || 'Command rejected by shell policy' });
      return;
    }
    const run = await getProcessSupervisor().spawn({
      command: validation.command,
      cwd: validation.cwd,
      mode: body.background === true || body.mode === 'background' ? 'background' : 'foreground',
      title: body.title ? String(body.title) : undefined,
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      taskId: body.taskId ? String(body.taskId) : undefined,
      codingSessionId: body.codingSessionId ? String(body.codingSessionId) : undefined,
      timeoutMs: body.timeoutMs == null ? undefined : Number(body.timeoutMs),
      noOutputTimeoutMs: body.noOutputTimeoutMs == null ? undefined : Number(body.noOutputTimeoutMs),
      stdinMode: body.stdinMode === 'pipe' ? 'pipe' : 'ignore',
      input: body.input == null ? undefined : String(body.input),
    });
    if (run.record.mode === 'foreground') {
      const exit = await run.wait();
      res.json({ run: getProcessSupervisor().get(run.runId), exit });
      return;
    }
    res.json({ run: run.record });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/processes/:runId', (req, res) => {
  const run = getProcessSupervisor().get(String(req.params.runId || ''));
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }
  res.json({ run });
});

router.get('/api/processes/:runId/log', (req, res) => {
  const maxChars = normalizeMaxChars(req.query.maxChars, 200_000);
  res.json(getProcessSupervisor().log(String(req.params.runId || ''), maxChars));
});

router.post('/api/processes/:runId/kill', (req, res) => {
  const ok = getProcessSupervisor().cancel(String(req.params.runId || ''));
  res.json({ ok });
});

router.post('/api/processes/:runId/write', (req, res) => {
  const ok = getProcessSupervisor().write(String(req.params.runId || ''), String(req.body?.data || ''), false);
  res.json({ ok });
});

router.post('/api/processes/:runId/submit', (req, res) => {
  const ok = getProcessSupervisor().write(String(req.params.runId || ''), String(req.body?.data || ''), true);
  res.json({ ok });
});

router.post('/api/processes/:runId/close', (req, res) => {
  const ok = getProcessSupervisor().closeStdin(String(req.params.runId || ''));
  res.json({ ok });
});
