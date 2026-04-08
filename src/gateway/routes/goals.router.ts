// src/gateway/routes/goals.router.ts
// Goals, Performance, Prompt Mutations, MCP, Webhooks, Shortcuts routes
import { Router } from 'express';
import { addMessage } from '../session';
import { broadcastWS } from '../comms/broadcaster';
import { getMCPManager } from '../mcp-manager';
import { resolveHookConfig, buildWebhookRouter } from '../comms/webhook-handler';
import { getAllShortcuts, saveSiteShortcut, deleteSiteShortcut } from '../site-shortcuts';
import {
  goalDecomposeTool, approveGoal, listGoals, loadGoal,
} from '../goal-decomposer';
import {
  runWeeklyPerformanceReview, loadSelfImprovementStore,
  approveSkillEvolution, formatPerformanceReport,
} from '../scheduling/self-improvement-engine';
import { analyzeRunForImprovement, applyPromptMutation } from '../scheduling/prompt-mutation';
import { hookBus } from '../hooks';
import { isModelBusy } from '../comms/broadcaster';
import * as path from 'path';

export const router = Router();

let _requireGatewayAuth: any;
let _cronScheduler: any;
let _telegramChannel: any;
let _handleChat: (...args: any[]) => Promise<any>;

export function initGoalsRouter(deps: {
  requireGatewayAuth: any;
  cronScheduler: any;
  telegramChannel: any;
  handleChat: (...args: any[]) => Promise<any>;
}): void {
  _requireGatewayAuth = deps.requireGatewayAuth;
  _cronScheduler = deps.cronScheduler;
  _telegramChannel = deps.telegramChannel;
  _handleChat = deps.handleChat;
}
const requireGatewayAuth = (...args: any[]) => _requireGatewayAuth?.(...args);

// ─── Goals API (Phase 3: Autonomous Goal Decomposition) ─────────────────────

router.get('/api/goals', (_req, res) => {
  try {
    res.json({ success: true, goals: listGoals() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/goals/:id', (req, res) => {
  try {
    const goal = loadGoal(req.params.id);
    if (!goal) { res.status(404).json({ success: false, error: 'Goal not found' }); return; }
    res.json({ success: true, goal });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/goals/:id/approve', requireGatewayAuth, (req, res) => {
  try {
    const result = approveGoal(
      req.params.id,
      (jobDef) => _cronScheduler.createJob(jobDef),
      req.body?.subTaskIds, // optional: approve only specific sub-tasks
    );
    if (!result) { res.status(404).json({ success: false, error: 'Goal not found' }); return; }
    broadcastWS({ type: 'goal_approved', goalId: result.goal.id, jobCount: result.createdJobs.length });
    _telegramChannel.sendToAllowed(`✅ Goal approved: "${result.goal.title}"\n${result.createdJobs.length} scheduled task(s) created.`).catch(() => {});
    res.json({ success: true, goal: result.goal, jobsCreated: result.createdJobs.length, jobIds: result.createdJobs.map(j => j.id) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/goals/:id/reject', requireGatewayAuth, (req, res) => {
  try {
    const { saveGoal } = require('./goal-decomposer');
    const goal = loadGoal(req.params.id);
    if (!goal) { res.status(404).json({ success: false, error: 'Goal not found' }); return; }
    goal.status = 'archived';
    saveGoal(goal);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Handle Telegram approve_goal broadcast from telegram-channel.ts
// (Telegram sends a broadcast signal because it can't directly access cronScheduler)
hookBus.register('gateway:approve_goal', ({ goalId, chatId }: any) => {
  try {
    const result = approveGoal(goalId, (jobDef) => _cronScheduler.createJob(jobDef));
    if (!result) {
      _telegramChannel.sendToAllowed(`❌ Goal <code>${goalId}</code> not found.`).catch(() => {});
      return;
    }
    broadcastWS({ type: 'goal_approved', goalId: result.goal.id, jobCount: result.createdJobs.length });
    _telegramChannel.sendToAllowed(`✅ Goal approved: "${result.goal.title}"\n${result.createdJobs.length} scheduled task(s) created and queued.`).catch(() => {});
  } catch (err: any) {
    _telegramChannel.sendToAllowed(`❌ Goal approval failed: ${err.message}`).catch(() => {});
  }
});

// ─── Self-Improvement API (Phase 7: Continuous Self-Improvement Engine) ──────

router.get('/api/performance', (_req, res) => {
  try {
    const store = loadSelfImprovementStore();
    res.json({ success: true, store });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/performance/latest', (_req, res) => {
  try {
    const store = loadSelfImprovementStore();
    if (!store.reports.length) { res.json({ success: true, report: null }); return; }
    const latest = store.reports[store.reports.length - 1];
    res.json({ success: true, report: latest, formatted: formatPerformanceReport(latest) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/performance/review', requireGatewayAuth, async (req, res) => {
  try {
    res.json({ success: true, message: 'Weekly performance review triggered in background' });
    // Run in background so the HTTP response doesn't time out
    setImmediate(async () => {
      try {
        const jobs = _cronScheduler.getJobs();
        const report = await runWeeklyPerformanceReview(
          jobs,
          _handleChat,
          (r) => {
            broadcastWS({ type: 'performance_report_ready', reportId: r.id, weekOf: r.periodEnd, score: r.overallSuccessRate });
            _telegramChannel.sendToAllowed(formatPerformanceReport(r)).catch(() => {});
          },
        );
      } catch (reviewErr: any) {
        console.error('[Performance] Manual review failed:', reviewErr.message);
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/performance/approve-skill/:id', requireGatewayAuth, (req, res) => {
  try {
    const result = approveSkillEvolution(req.params.id);
    if (result.success) {
      broadcastWS({ type: 'skill_evolution_approved', evolutionId: req.params.id, skillPath: result.skillPath });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Prompt Mutation API ──────────────────────────────────────────────────────

router.get('/api/prompt-mutations/:jobId', (req, res) => {
  try {
    const { loadMutationState } = require('./prompt-mutation');
    const state = loadMutationState(req.params.jobId);
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── MCP API ──────────────────────────────────────────────────────────────────

router.get('/api/mcp/servers', (_req, res) => {
  try {
    const mgr = getMCPManager();
    const configs = mgr.getConfigs();
    const status = mgr.getStatus();
    const merged = configs.map(cfg => {
      const s = status.find(x => x.id === cfg.id);
      return { ...cfg, status: s?.status || 'disconnected', toolCount: s?.tools || 0, toolNames: s?.toolNames || [], error: s?.error };
    });
    res.json({ success: true, servers: merged });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/mcp/servers', (req, res) => {
  try {
    const mgr = getMCPManager();
    const cfg = req.body;
    if (!cfg.id || !cfg.name) { res.status(400).json({ success: false, error: 'id and name are required' }); return; }
    if (!cfg.id.match(/^[a-z0-9_-]+$/i)) { res.status(400).json({ success: false, error: 'id must be alphanumeric/underscore/dash only' }); return; }
    mgr.upsertConfig(cfg);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/mcp/servers/:id', (req, res) => {
  try {
    const mgr = getMCPManager();
    const deleted = mgr.deleteConfig(req.params.id);
    res.json({ success: deleted, error: deleted ? undefined : 'Server not found' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/mcp/servers/:id/connect', async (req, res) => {
  try {
    const mgr = getMCPManager();
    const result = await mgr.connect(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/mcp/servers/:id/disconnect', async (req, res) => {
  try {
    const mgr = getMCPManager();
    await mgr.disconnect(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/mcp/tools', (_req, res) => {
  try {
    const mgr = getMCPManager();
    res.json({ success: true, tools: mgr.getAllTools() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Webhook Routes ──────────────────────────────────────────────────────────
// Mounted dynamically so the path is always read fresh from config.
// Must be registered BEFORE the SPA catch-all below.
(() => {
  const hookCfg = resolveHookConfig();
  if (!hookCfg.enabled) {
    console.log('[Webhooks] Disabled — set hooks.enabled=true in config to activate.');
    return;
  }
  if (!hookCfg.token) {
    console.warn('[Webhooks] hooks.enabled=true but no hooks.token set — webhooks will be disabled until a token is configured.');
    return;
  }
  const webhookRouter = buildWebhookRouter({
    handleChat: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode) =>
      _handleChat(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode),
    addMessage,
    getIsModelBusy: isModelBusy,
    broadcast: broadcastWS,
    deliverTelegram: (text: string) => _telegramChannel.sendToAllowed(text),
  });
  router.use(hookCfg.path, webhookRouter);
  console.log(`[Webhooks] Listening at ${hookCfg.path} (wake, agent, status)`);
})();

// ─── Internal Agent Task endpoint (called by Agent Builder for AI-authoring nodes)
// Localhost-only unless SMALLCLAW_INTERNAL_TOKEN is set.
// NOTE: /internal/agent-task is mounted globally in server-v2.ts

// ── Site Shortcuts API ─────────────────────────────────────────────────────────
// MUST be registered BEFORE the SPA catch-all router.get('*') below.
// GET /api/shortcuts  — return all known sites + their shortcuts
router.get('/api/shortcuts', (_req: any, res: any) => {
  try {
    res.json({ success: true, shortcuts: getAllShortcuts() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// POST /api/shortcuts  — add or update a shortcut
router.post('/api/shortcuts', (req: any, res: any) => {
  const { hostname, key, action, context, preferred_for_compose, siteDescription, notes } = req.body || {};
  if (!hostname || !key || !action) {
    return res.status(400).json({ success: false, error: 'hostname, key, and action are required' });
  }
  try {
    saveSiteShortcut(
      String(hostname).trim(),
      { key: String(key).trim(), action: String(action).trim(), context: context || undefined, preferred_for_compose: !!preferred_for_compose },
      siteDescription ? String(siteDescription).trim() : undefined,
      notes ? String(notes).trim() : undefined,
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// DELETE /api/shortcuts  — remove one shortcut by hostname + key
router.delete('/api/shortcuts', (req: any, res: any) => {
  const { hostname, key } = req.body || {};
  if (!hostname || !key) {
    return res.status(400).json({ success: false, error: 'hostname and key are required' });  
  }
  try {
    const deleted = deleteSiteShortcut(String(hostname).trim(), String(key).trim());
    res.json({ success: true, deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

