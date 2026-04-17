// src/gateway/routes/tasks.router.ts
// Tasks, Background Tasks, Schedules, Error Response routes
import { Router } from 'express';
// Proposal imports removed — all /api/proposals* routes live in proposals.router.ts
import { getConfig } from '../../config/config';
import { addMessage } from '../session';
import { broadcastWS } from '../comms/broadcaster';
import {
  loadTask, listTasks, deleteTask, updateTaskStatus,
  getEvidenceBusSnapshot, appendJournal,
} from '../tasks/task-store';
import { loadScheduleMemory, loadRunLog } from '../scheduling/schedule-memory';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import { backgroundStatus, backgroundProgress, backgroundJoin } from '../tasks/task-runner';
import { getCredentialHandler } from '../../security/credential-handler';
// setupErrorResponseEndpoint import removed (unused)
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspace } from '../session';
import { hookBus } from '../hooks';
import { updateResumeContext, type TaskStatus } from '../tasks/task-store';
import { getErrorAudit } from '../../security/error-audit';


export const router = Router();

// Server-v2 singletons injected at registration
let _cronScheduler: any;
let _telegramChannel: any;
let _handleChat: (...args: any[]) => Promise<any>;
let _heartbeatRunner: any;
let _CONFIG_DIR_PATH: string;

export function initTasksRouter(deps: {
  cronScheduler: any;
  telegramChannel: any;
  handleChat: (...args: any[]) => Promise<any>;
  heartbeatRunner: any;
  configDirPath: string;
}): void {
  _cronScheduler = deps.cronScheduler;
  _telegramChannel = deps.telegramChannel;
  _handleChat = deps.handleChat;
  _heartbeatRunner = deps.heartbeatRunner;
  _CONFIG_DIR_PATH = deps.configDirPath;
}

// ─── Tasks / Cron API ──────────────────────────────────────────────────────────

router.get('/api/tasks', (_req, res) => {
  res.json({ success: true, jobs: _cronScheduler.getJobs(), config: _cronScheduler.getConfig() });
});

router.post('/api/tasks', (req, res) => {
  const { name, prompt, type, schedule, tz, runAt, priority, sessionTarget, payloadKind, systemEventText, model, subagent_id } = req.body;
  if (!name || !prompt) { res.status(400).json({ success: false, error: 'name and prompt required' }); return; }
  if (type === 'heartbeat') {
    res.status(400).json({ success: false, error: 'Heartbeat is no longer a CronJob. Configure it in Settings > Heartbeat (/api/settings/heartbeat).' });
    return;
  }
  const job = _cronScheduler.createJob({
    name,
    prompt,
    type,
    schedule,
    tz,
    runAt,
    priority,
    sessionTarget,
    payloadKind,
    systemEventText,
    model,
    subagent_id,
  });
  res.json({ success: true, job });
});

router.put('/api/tasks/:id', (req, res) => {
  const job = _cronScheduler.updateJob(req.params.id, req.body);
  if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return; }
  res.json({ success: true, job });
});

router.delete('/api/tasks/:id', (req, res) => {
  const ok = _cronScheduler.deleteJob(req.params.id);
  if (!ok) { res.status(404).json({ success: false, error: 'Job not found' }); return; }
  res.json({ success: true });
});

router.post('/api/tasks/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) { res.status(400).json({ success: false, error: 'orderedIds array required' }); return; }
  _cronScheduler.reorderJobs(orderedIds);
  res.json({ success: true });
});

router.post('/api/tasks/:id/run', async (req, res) => {
  const jobs = _cronScheduler.getJobs();
  const job = jobs.find((j: any) => j.id === req.params.id);
  if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return; }
  res.json({ success: true, message: 'Job queued for immediate run' });
  _cronScheduler.runJobNow(req.params.id, { respectActiveHours: false }).catch(console.error);
});

router.get('/api/tasks/config', (_req, res) => {
  res.json({ success: true, config: _cronScheduler.getConfig() });
});

router.put('/api/tasks/config', (req, res) => {
  _cronScheduler.updateConfig(req.body);
  res.json({ success: true, config: _cronScheduler.getConfig() });
});

function getHeartbeatFilePath(): string {
  const workspacePath = getConfig().getWorkspacePath();
  return path.join(workspacePath, 'HEARTBEAT.md');
}

function readHeartbeatInstructions(): string {
  const heartbeatPath = getHeartbeatFilePath();
  try {
    if (!fs.existsSync(heartbeatPath)) return '';
    return fs.readFileSync(heartbeatPath, 'utf-8');
  } catch {
    return '';
  }
}

function writeHeartbeatInstructions(content: string): string {
  const heartbeatPath = getHeartbeatFilePath();
  fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
  fs.writeFileSync(heartbeatPath, String(content || ''), 'utf-8');
  return heartbeatPath;
}

function normalizeHeartbeatUpdate(body: any): {
  enabled?: boolean;
  intervalMinutes?: number;
  model?: string;
  reviewTeamsAfterRun?: boolean;
} {
  const next: {
    enabled?: boolean;
    intervalMinutes?: number;
    model?: string;
    reviewTeamsAfterRun?: boolean;
  } = {};
  if (typeof body?.enabled === 'boolean') next.enabled = body.enabled;

  const rawInterval = Number(body?.interval_minutes ?? body?.intervalMinutes);
  if (Number.isFinite(rawInterval)) {
    next.intervalMinutes = Math.max(1, Math.min(1440, Math.floor(rawInterval)));
  }

  if (typeof body?.model === 'string') next.model = body.model.trim();

  const reviewFlag = body?.review_teams_after_run ?? body?.reviewTeamsAfterRun;
  if (typeof reviewFlag === 'boolean') next.reviewTeamsAfterRun = reviewFlag;

  return next;
}

function buildHeartbeatSettingsPayload(): {
  enabled: boolean;
  interval_minutes: number;
  model: string;
  review_teams_after_run: boolean;
  instructions: string;
  path: string;
} {
  const cfg = _heartbeatRunner.getConfig();
  const instructions = readHeartbeatInstructions();
  return {
    enabled: cfg.enabled,
    interval_minutes: cfg.intervalMinutes,
    model: cfg.model || '',
    review_teams_after_run: cfg.reviewTeamsAfterRun === true,
    instructions,
    path: getHeartbeatFilePath(),
  };
}

router.get('/api/settings/heartbeat', (_req, res) => {
  res.json({ success: true, heartbeat: buildHeartbeatSettingsPayload() });
});

router.post('/api/settings/heartbeat', (req, res) => {
  try {
    const update = normalizeHeartbeatUpdate(req.body || {});
    _heartbeatRunner.updateConfig(update);
    if (typeof req.body?.instructions === 'string') {
      writeHeartbeatInstructions(req.body.instructions);
    }
    res.json({ success: true, heartbeat: buildHeartbeatSettingsPayload() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to save heartbeat settings' });
  }
});

router.get('/api/heartbeat/config', (_req, res) => {
  res.json({ success: true, config: _heartbeatRunner.getConfig() });
});

router.put('/api/heartbeat/config', (req, res) => {
  const cfg = _heartbeatRunner.updateConfig(normalizeHeartbeatUpdate(req.body || {}));
  res.json({ success: true, config: cfg });
});

// ─── Background Task Kanban API ─────────────────────────────────────────────────

function buildHeartbeatCompatConfig(): {
  enabled: boolean;
  interval_minutes: number;
  model: string;
  review_teams_after_run: boolean;
} {
  const cfg = _heartbeatRunner.getConfig();
  return {
    enabled: cfg.enabled,
    interval_minutes: cfg.intervalMinutes,
    model: cfg.model || '',
    review_teams_after_run: cfg.reviewTeamsAfterRun === true,
  };
}

router.get('/api/bg-tasks/heartbeat/config', (_req, res) => {
  res.json({ success: true, config: buildHeartbeatCompatConfig() });
});

router.put('/api/bg-tasks/heartbeat/config', (req, res) => {
  const update = normalizeHeartbeatUpdate(req.body || {});
  const cfg = _heartbeatRunner.updateConfig(update);
  if (typeof req.body?.instructions === 'string') {
    writeHeartbeatInstructions(req.body.instructions);
  }
  res.json({
    success: true,
    config: {
      enabled: cfg.enabled,
      interval_minutes: cfg.intervalMinutes,
      model: cfg.model || '',
      review_teams_after_run: cfg.reviewTeamsAfterRun === true,
    },
    heartbeat: buildHeartbeatSettingsPayload(),
  });
});

// ─── Per-Agent Heartbeat API ─────────────────────────────────────────────────

router.get('/api/heartbeat/agents', (_req, res) => {
  try {
    const agents = _heartbeatRunner.listAgentConfigs();
    res.json({ success: true, agents });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

router.get('/api/heartbeat/agents/:agentId', (req, res) => {
	try {
	    const agentId = String(req.params.agentId || '').trim();
	    if (!agentId) { res.status(400).json({ success: false, error: 'agentId required' }); return; }
	    const config = _heartbeatRunner.getAgentConfig(agentId);
	    res.json({ success: true, agentId, config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

router.put('/api/heartbeat/agents/:agentId', (req, res) => {
	try {
	    const agentId = String(req.params.agentId || '').trim();
	    if (!agentId) { res.status(400).json({ success: false, error: 'agentId required' }); return; }
	    const body = req.body || {};
    const partial: Record<string, any> = {};
    if (typeof body.enabled === 'boolean') partial.enabled = body.enabled;
    const rawInterval = Number(body.interval_minutes ?? body.intervalMinutes);
    if (Number.isFinite(rawInterval)) partial.intervalMinutes = Math.max(1, Math.min(1440, Math.floor(rawInterval)));
    if (typeof body.model === 'string') partial.model = body.model.trim();
    const config = _heartbeatRunner.updateAgentConfig(agentId, partial);

    // Optionally also register the agent if not already registered
    // (handles UI enabling an agent that wasn't registered at startup)
    const workspacePath = (() => {
      try {
        const subagentPath = path.join(getConfig().getWorkspacePath(), '.prometheus', 'subagents', agentId);
        if (fs.existsSync(subagentPath)) return subagentPath;
        return getConfig().getWorkspacePath();
      } catch { return getConfig().getWorkspacePath(); }
    })();
    _heartbeatRunner.registerAgent(agentId, workspacePath);

    broadcastWS({ type: 'heartbeat_agent_config_updated', agentId, config });
    res.json({ success: true, agentId, config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

router.post('/api/heartbeat/agents/:agentId/tick', async (req, res) => {
	try {
	    const agentId = String(req.params.agentId || '').trim();
	    if (!agentId) { res.status(400).json({ success: false, error: 'agentId required' }); return; }
	    res.json({ success: true, message: `Heartbeat tick queued for "${agentId}"` });
    _heartbeatRunner.tick(agentId).catch((err: any) =>
      console.warn(`[HeartbeatRunner] Manual tick failed for "${agentId}":`, err?.message)
    );
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
router.get('/api/bg-tasks', (_req, res) => {
  const tasks = listTasks();
  res.json({ success: true, tasks });
});

router.get('/api/bg-tasks/:id', (req, res) => {
  const task = loadTask(req.params.id);
  if (!task) { res.status(404).json({ success: false, error: 'Task not found' }); return; }
  // Include evidence bus snapshot if available
  const evidenceBus = getEvidenceBusSnapshot(req.params.id);
  res.json({ success: true, task, evidenceBus });
});

// Evidence bus endpoint — returns the live bus for a task
router.get('/api/bg-tasks/:id/evidence', (req, res) => {
  const bus = getEvidenceBusSnapshot(req.params.id);
  if (!bus) { res.json({ success: true, entries: [], taskId: req.params.id }); return; }
  res.json({ success: true, taskId: bus.taskId, entries: bus.entries, updatedAt: bus.updatedAt });
});

// Schedule memory endpoint — returns persistent memory for a schedule
router.get('/api/schedules/:scheduleId/memory', (req, res) => {
  const mem = loadScheduleMemory(req.params.scheduleId);
  if (!mem) { res.json({ success: true, memory: null, scheduleId: req.params.scheduleId }); return; }
  res.json({ success: true, memory: mem });
});

// Schedule run log endpoint
router.get('/api/schedules/:scheduleId/run-log', (req, res) => {
  const log = loadRunLog(req.params.scheduleId);
  res.json({ success: true, scheduleId: req.params.scheduleId, runs: log.runs });
});

// Ephemeral one-shot background executions (additive)
router.get('/api/background/:id/status', (req, res) => {
  const status = backgroundStatus(String(req.params.id || ''));
  if (!status) { res.status(404).json({ success: false, error: 'Background task not found' }); return; }
  res.json({ success: true, status });
});

router.get('/api/background/:id/progress', (req, res) => {
  const status = backgroundProgress(String(req.params.id || ''));
  if (!status) { res.status(404).json({ success: false, error: 'Background task not found' }); return; }
  res.json({ success: true, status });
});

router.post('/api/background/:id/join', async (req, res) => {
  const joinPolicy = String(req.body?.join_policy || req.body?.joinPolicy || '').trim();
  const timeoutRaw = Number(req.body?.timeout_ms ?? req.body?.timeoutMs);
  const joined = await backgroundJoin({
    backgroundId: String(req.params.id || ''),
    joinPolicy: (joinPolicy === 'wait_all' || joinPolicy === 'wait_until_timeout' || joinPolicy === 'best_effort_merge')
      ? (joinPolicy as any)
      : undefined,
    timeoutMs: Number.isFinite(timeoutRaw) ? timeoutRaw : undefined,
  });
  if (!joined) { res.status(404).json({ success: false, error: 'Background task not found' }); return; }
  res.json({ success: true, joined });
});

router.delete('/api/bg-tasks/:id', (req, res) => {
  const ok = deleteTask(req.params.id);
  if (!ok) { res.status(404).json({ success: false, error: 'Task not found' }); return; }
  res.json({ success: true });
});

router.post('/api/bg-tasks/:id/pause', (req, res) => {
  const task = updateTaskStatus(req.params.id, 'paused', { pauseReason: 'user_pause' });
  if (!task) { res.status(404).json({ success: false, error: 'Task not found' }); return; }
  BackgroundTaskRunner.requestPause(req.params.id);
  const sid = task.sessionId || 'default';
  const ws = getWorkspace(sid) || (getConfig().getConfig() as any).workspace?.path || '';
  if (ws) {
    hookBus.fire({
      type: 'command:stop',
      sessionId: sid,
      workspacePath: ws,
      timestamp: Date.now(),
    }).catch((err: any) => console.warn('[hooks] command:stop error:', err?.message || err));
  }
  res.json({ success: true });
});

router.post('/api/bg-tasks/:id/resume', (req, res) => {
  const task = loadTask(req.params.id);
  if (!task) { res.status(404).json({ success: false, error: 'Task not found' }); return; }
  const resumableStatuses: TaskStatus[] = ['paused', 'queued', 'stalled', 'needs_assistance', 'awaiting_user_input', 'running', 'failed'];
  if (resumableStatuses.includes(task.status as TaskStatus)) {
    // If status is 'running' but no active runner exists, the runner died without cleanup.
    // Treat it as resumable — reset to queued and start a fresh runner.
    if (task.status === 'running' && BackgroundTaskRunner.isRunning(task.id)) {
      res.json({ success: false, error: 'Task is already actively running.' });
      return;
    }
    // Status is 'running' but runner is dead — clear any ghost activeRunners entry before relaunching
    if (task.status === 'running') {
      BackgroundTaskRunner.forceRelease(task.id);
    }
    updateTaskStatus(task.id, 'queued');
    const runner = new BackgroundTaskRunner(task.id, _handleChat, _makeBroadcastForTask(task.id), _telegramChannel);
    runner.start().catch(err => console.error(`[BackgroundTaskRunner] Resume ${task.id} error:`, err.message));
    res.json({ success: true });
  } else {
    res.json({ success: false, error: `Task status is ${task.status}, cannot resume` });
  }
});

// ─── Error Response Endpoint ────────────────────────────────────────────────
// Receives structured user response to a task error, injects it as a resume
// instruction, and relaunches the task runner so the agent acts on it.
router.post('/api/bg-tasks/:id/error-response', async (req: any, res: any) => {
  const task = loadTask(req.params.id);
  if (!task) { res.status(404).json({ success: false, error: 'Task not found' }); return; }

  const { action, category, inputs } = req.body || {};
  if (!action) { res.status(400).json({ success: false, error: 'action is required' }); return; }

  // Build a clear natural-language injection the agent will see on its next round
  let instruction = '';

  if (action === 'cancel') {
    // User wants to stop — mark failed and return
    updateTaskStatus(task.id, 'failed', { pauseReason: undefined });
    appendJournal(task.id, { type: 'status_push', content: 'User cancelled task via error response.' });
    res.json({ success: true, resumed: false });
    return;
  }

  if (action === 'credentials' && inputs?.email) {
    instruction = [
      `CRITICAL INSTRUCTION (from user — error response):`,
      `The user has provided login credentials to resolve the authentication error.`,
      `Email: ${inputs.email}`,
      `Password: [PROVIDED — use the credential ID to retrieve it]`,
      ``,
      `Your next steps:`,
      `1. Return to the login form on the page`,
      `2. Fill the email field with: ${inputs.email}`,
      `3. Fill the password field with the provided password`,
      `4. Click the login/submit button`,
      `5. If a 2FA/verification code is requested next, pause and ask the user`,
      `6. Do NOT retry with the same credentials if login fails — pause and ask user instead`,
    ].join('\n');

    // Store credentials securely if credential handler is available
    try {
      const credHandler = getCredentialHandler();
      const credId = credHandler.store(task.id, 'auth', { email: inputs.email, password: inputs.password || '' });
      instruction += `\nCredential ID (for secure retrieval): ${credId}`;
      getErrorAudit(path.join(_CONFIG_DIR_PATH, 'logs', 'audit.log')).logCredentialProvided(task.id, 'auth');
    } catch {}

  } else if (action === 'verification_code' && inputs?.code) {
    instruction = [
      `CRITICAL INSTRUCTION (from user — error response):`,
      `The user has provided the verification/2FA code: ${inputs.code}`,
      ``,
      `Your next steps:`,
      `1. Find the verification code input field on the page`,
      `2. Fill it with: ${inputs.code}`,
      `3. Submit/confirm the code`,
      `4. Continue the original task after successful verification`,
    ].join('\n');

  } else if (action === 'manual_complete') {
    instruction = [
      `CRITICAL INSTRUCTION (from user — error response):`,
      `The user has manually completed the CAPTCHA or challenge.`,
      `The page should now be accessible. Continue from where you left off.`,
      `Take a fresh browser_snapshot() to see the current page state before proceeding.`,
    ].join('\n');

  } else if (action === 'retry_now' || action === 'retry_delay') {
    const delayMs = action === 'retry_delay' ? 30000 : 0;
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    instruction = [
      `CRITICAL INSTRUCTION (from user — error response):`,
      `The user has requested a retry after the network/service error.`,
      `Retry the last failed operation. If it fails again, pause for assistance.`,
    ].join('\n');

  } else if (action === 'skip_content' || action === 'skip_step' || action === 'skip') {
    instruction = [
      `CRITICAL INSTRUCTION (from user — error response):`,
      `The user has chosen to skip this step/content.`,
      `Do not attempt this step again. Move on to the next task step.`,
      `Mark this step as skipped and continue.`,
    ].join('\n');

  } else if (action === 'grant_permission') {
    instruction = [
      `CRITICAL INSTRUCTION (from user — error response):`,
      `The user has granted permission or resolved the access issue.`,
      `Retry the operation that was blocked. If still denied, skip and continue.`,
    ].join('\n');

  } else if (action === 'google' || action === 'oauth') {
    const provider = inputs?.provider || 'Google';
    instruction = [
      `CRITICAL INSTRUCTION (from user — error response):`,
      `The user wants to use ${provider} OAuth sign-in.`,
      `Find and click the "Sign in with ${provider}" button on the page.`,
      `The browser will handle the OAuth redirect. Wait for it to complete and return to the original page.`,
      `If a verification code or additional step is needed after OAuth, pause and ask the user.`,
    ].join('\n');

  } else {
    // Generic fallback — pass raw action as instruction
    instruction = [
      `CRITICAL INSTRUCTION (from user — error response):`,
      `User action: ${action}`,
      inputs ? `Additional context: ${JSON.stringify(inputs)}` : '',
      `Proceed accordingly. If unsure, take a fresh browser_snapshot() and reassess.`,
    ].filter(Boolean).join('\n');
  }

  // Inject instruction into resume context so the runner sees it immediately
  updateResumeContext(task.id, { onResumeInstruction: instruction });
  appendJournal(task.id, {
    type: 'status_push',
    content: `Error response received: action=${action} category=${category || 'unknown'}. Resuming task.`,
  });

  // Requeue and relaunch
  updateTaskStatus(task.id, 'queued', { pauseReason: undefined });
  const runner = new BackgroundTaskRunner(task.id, _handleChat, _makeBroadcastForTask(task.id), _telegramChannel);
  runner.start().catch((err: any) => console.error(`[ErrorResponse] Task ${task.id} resume error:`, err.message));

  res.json({ success: true, resumed: true, action });
});

// Inject a user message into the task's session — lets the web UI chat directly with the task agent.
// If the task is paused/needs_assistance, it also resumes it so the agent sees and responds to the message.
router.post('/api/bg-tasks/:id/message', async (req: any, res: any) => {
  const task = loadTask(req.params.id);
  if (!task) { res.status(404).json({ success: false, error: 'Task not found' }); return; }
  const userMessage = String(req.body?.message || '').trim();
  if (!userMessage) { res.status(400).json({ success: false, error: 'message is required' }); return; }

  // Inject the message into the task session so the agent sees it on the next round.
  const sessionId = `task_${task.id}`;
  addMessage(sessionId, { role: 'user', content: userMessage, timestamp: Date.now() });
  appendJournal(task.id, { type: 'status_push', content: `User replied via task panel: ${userMessage.slice(0, 200)}` });

  // If the task is waiting for guidance, resume it so it processes the message.
  const needsResume = task.status === 'needs_assistance' || task.status === 'paused' || task.status === 'stalled';
  if (needsResume) {
    updateTaskStatus(task.id, 'queued');
    const runner = new BackgroundTaskRunner(task.id, _handleChat, _makeBroadcastForTask(task.id), _telegramChannel);
    runner.start().catch((err: any) => console.error(`[BackgroundTaskRunner] MessageResume ${task.id} error:`, err.message));
  }

  res.json({ success: true, resumed: needsResume });
});

// SSE stream for live task updates
router.get('/api/bg-tasks/:id/stream', (req, res) => {
  const taskId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data: any) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  // Send current state immediately
  const task = loadTask(taskId);
  if (task) send({ type: 'snapshot', task });

  // Poll task file every 2s for updates
  let lastJournalLen = task?.journal?.length || 0;
  const poll = setInterval(() => {
    const t = loadTask(taskId);
    if (!t) { clearInterval(poll); send({ type: 'error', message: 'Task not found' }); res.end(); return; }
    if (t.journal.length !== lastJournalLen) {
      lastJournalLen = t.journal.length;
      send({ type: 'update', task: t });
    }
    if (t.status === 'complete' || t.status === 'failed') {
      send({ type: 'final', task: t });
      clearInterval(poll);
      res.end();
    }
  }, 2000);

  req.on('close', () => clearInterval(poll));
});

// Per-task followup timers fired when a step completes to resume quickly
// instead of waiting the full heartbeat interval.
const taskFollowupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleTaskFollowup(taskId: string, delayMs: number): void {
  // Cancel any existing followup for this task
  const existing = taskFollowupTimers.get(taskId);
  if (existing) clearTimeout(existing);
  console.log(`[TaskFollowup] Scheduling quick resume for task ${taskId} in ${Math.round(delayMs / 1000)}s`);
  const t = setTimeout(async () => {
    taskFollowupTimers.delete(taskId);
    const task = loadTask(taskId);
    if (!task || task.status === 'complete' || task.status === 'failed' || task.status === 'running') return;
    console.log(`[TaskFollowup] Quick-resuming task ${taskId}: ${task.title}`);
    updateTaskStatus(taskId, 'queued');
    appendJournal(taskId, { type: 'heartbeat', content: 'Quick follow-up resume triggered after step completion.' });
    const runner = new BackgroundTaskRunner(taskId, _handleChat, _makeBroadcastForTask(taskId), _telegramChannel);
    runner.start().catch(err => console.error(`[TaskFollowup] Runner error:`, err.message));
    broadcastWS({ type: 'task_heartbeat_resumed', taskId, rationale: 'Quick step follow-up' });
  }, delayMs);
  if (t && typeof (t as any).unref === 'function') (t as any).unref();
  taskFollowupTimers.set(taskId, t);
}

// Broadcast interceptor for BackgroundTaskRunner — catches internal signals
// that need server-side action (like scheduling a quick step follow-up)
// while still forwarding all events to WS clients.
export function makeBroadcastForTask(taskId: string): (data: object) => void { return _makeBroadcastForTask(taskId); }

function _makeBroadcastForTask(taskId: string): (data: object) => void {
  return (data: object) => {
    const d = data as any;
    if (d.type === 'task_step_followup_needed' && d.taskId === taskId) {
      scheduleTaskFollowup(taskId, d.delayMs || 120_000);
      return;
    }
    broadcastWS(data);
  };
}

// ─── Proposals API removed from this router ──────────────────────────────────
// All /api/proposals* routes are handled exclusively by proposals.router.ts.
// Having them here too caused duplicate route registration where the first
// router registered in Express would silently shadow the other, creating
// inconsistent approval/dispatch behavior depending on Express mount order.
