/**
 * core/startup.ts — B4 Refactor
 *
 * All startup wiring that previously lived inside the server.listen() callback
 * in server-v2.ts. Extracted verbatim — zero logic changes.
 *
 * Called as: server.listen(PORT, HOST, () => runStartup(deps))
 *
 * Every singleton that the callback referenced is passed in via StartupDeps
 * so this module has no hidden imports from server-v2.ts.
 */

import path from 'path';
import fs from 'fs';
import { getConfig } from '../../config/config';
import { getAgentById } from '../../config/config';
import { spawnAgent } from '../../agents/spawner';
import { logGpuStatus } from '../gpu-detector';
import { getMCPManager } from '../mcp-manager';
import { hookBus } from '../hooks';
import { loadWorkspaceHooks } from '../hook-loader';
import {
  getManagedTeam,
  listManagedTeams,
  applyTeamChange,
  rejectTeamChange,
  appendTeamChat,
  appendManagerNote,
  listTeamContextReferences,
  addTeamContextReference,
  updateTeamContextReference,
  deleteTeamContextReference,
  getTeamRunHistory,
} from '../teams/managed-teams';
import { handleManagerConversation } from '../teams/team-manager-runner';
import { getWeeklyReviewJobDefinition } from '../scheduling/self-improvement-engine';
import { setTeamRunAgentFn } from '../teams/team-manager-runner';
import {
  createTask,
  updateTaskStatus,
  setTaskStepRunning,
  updateTaskRuntimeProgress,
  mutatePlan,
  appendJournal,
} from '../tasks/task-store';
import { setWorkspace } from '../session';
import { recordAgentRun } from '../../scheduler';
import { broadcastWS, broadcastTeamEvent } from '../comms/broadcaster';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import { setBackgroundAgentDeps } from '../tasks/task-runner';
import { listPendingStartupNotifications, markStartupNotificationDelivered } from '../lifecycle';
import { startAuditMaterializer } from '../audit/materializer';

// ─── Deps contract ────────────────────────────────────────────────────────────
// All singletons that live in server-v2.ts and are needed during startup wiring.

export interface StartupDeps {
  HOST: string;
  PORT: number;
  config: any;
  skillsManager: any;
  cronScheduler: any;
  heartbeatRunner: any;
  telegramChannel: any;
  handleChat: any;
  buildTools: () => any;
  runTeamAgentViaChat: any;
}

// ─── Main startup function ────────────────────────────────────────────────────

export async function runStartup(deps: StartupDeps): Promise<void> {
  const {
    HOST, PORT, config, skillsManager,
    cronScheduler, heartbeatRunner, telegramChannel,
    handleChat, buildTools, runTeamAgentViaChat,
  } = deps;

  // Detect GPU hardware once — caches result for /api/system-stats, no repeated probes.
  logGpuStatus();

  const liveConfig = getConfig().getConfig();
  const searchCfg = (liveConfig as any).search || {};
  // HIGH-03: resolve vault references before checking presence — never log the key value itself
  const cm = getConfig();
  const tavilyKey = cm.resolveSecret(searchCfg.tavily_api_key);
  const googleKey = cm.resolveSecret(searchCfg.google_api_key);
  const hasSearch = tavilyKey ? '✓ Tavily' : googleKey ? '✓ Google' : '✗ None (configure in Settings → Search)';

  // Build GPU display string from cached detection
  const { detectGpu } = require('../gpu-detector') as typeof import('../gpu-detector');
  const gpuInfo = detectGpu();
  let gpuDisplay = 'CPU only';
  if (gpuInfo.backend === 'nvidia')             gpuDisplay = `${gpuInfo.name ?? 'NVIDIA'} (CUDA)`;
  else if (gpuInfo.backend === 'amd')           gpuDisplay = `${gpuInfo.name ?? 'AMD'} (ROCm)`;
  else if (gpuInfo.backend === 'apple-silicon') gpuDisplay = 'Apple Silicon (Metal)';

  // Notify the terminal UI — triggers Phase 2 (status board) + Phase 3 (menu)
  try {
    const { notifyServerReady } = require('../terminal-ui') as typeof import('../terminal-ui');
    notifyServerReady({
      host: HOST,
      port: PORT,
      model: liveConfig.models.primary,
      workspace: liveConfig.workspace.path,
      skillsTotal: skillsManager.getAll().length,
      skillsEnabled: skillsManager.getEnabledSkills().length,
      searchStatus: hasSearch,
      memoryFiles: 'SOUL.md + USER.md',
      gpuInfo: gpuDisplay,
      cronJobCount: cronScheduler.getJobs().length,
    });
  } catch {
    // terminal-ui not loaded (e.g. called without CLI wrapper) — fall back to plain log
    console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
    console.log(`║              Prometheus Gateway              ║`);
    console.log(`╠════════════════════════════════════════════════════════════════╣`);
    console.log(`║  Web UI:    http://${HOST}:${PORT}                                    ║`);
    console.log(`║  Model:     ${liveConfig.models.primary}`);
    console.log(`╚════════════════════════════════════════════════════════════════╝\n`);
  }

  // Auto-connect enabled MCP servers
  getMCPManager().startEnabledServers().catch((err: any) => console.warn('[MCP] Startup error:', err?.message));

  cronScheduler.start();
  console.log('[CronScheduler] Tick loop started.');

  // Wire handleChat into background agent executor so spawned bg agents run full tool loop
  try {
    setBackgroundAgentDeps({ handleChat, broadcastWS });
  } catch (e: any) {
    console.warn('[BackgroundAgent] Could not wire background agent deps:', e?.message);
  }

  // Inject full handleChat-based agent runner into team-manager-runner
  try {
    setTeamRunAgentFn(runTeamAgentViaChat);
    console.log('[Teams] Team run agent fn wired (full handleChat pipeline).');
  } catch (e: any) {
    console.warn('[Teams] Could not set team run agent fn:', e.message);
  }

  // Inject team tool dependencies into the tool registry
  try {
    const { injectTeamToolDeps } = require('../../tools/team-tools.js');
    injectTeamToolDeps({
      handleManagerConversation,
      getManagedTeam,
      listManagedTeams,
      broadcast: broadcastWS,
      cronScheduler,
      spawnAgent,
      listTeamContextReferences,
      addTeamContextReference,
      updateTeamContextReference,
      deleteTeamContextReference,
    });
    console.log('[TeamTools] Team tool deps injected (talk_to_manager, get_team_logs, schedule_job, manage_team_goal, manage_team_context_ref).');
  } catch (e: any) {
    console.warn('[TeamTools] Could not inject team tool deps:', e.message);
  }

  // CIS Phase 2: Inject analysis team deps
  try {
    const { injectAnalysisTeamDeps } = require('../../tools/deploy-analysis-team.js');
    injectAnalysisTeamDeps({
      workspacePath: config.workspace.path,
      broadcast: broadcastWS,
    });
    console.log('[AnalysisTeam] deploy_analysis_team deps injected.');
  } catch (e: any) {
    console.warn('[AnalysisTeam] Could not inject analysis team deps:', e.message);
  }

  // CIS Phase 3: Inject social intel deps
  try {
    const { injectSocialScraperDeps } = require('../../tools/social-scraper.js');
    const cm2 = getConfig();
    injectSocialScraperDeps({
      workspacePath: config.workspace.path,
      resolveSecret: async (ref: string) => {
        try { return cm2.resolveSecret(ref) ?? null; } catch { return null; }
      },
      broadcast: broadcastWS,
    });
    console.log('[SocialIntel] social_intel deps injected.');
  } catch (e: any) {
    console.warn('[SocialIntel] Could not inject social intel deps:', e.message);
  }

  // CIS Phase 4: Init OAuth connector registry
  try {
    const { initConnectorRegistry } = require('../../integrations/connector-registry.js') as any;
    initConnectorRegistry(path.join(process.cwd(), '.prometheus'));
  } catch (e: any) {
    console.warn('[Connectors] Could not init connector registry:', e.message);
  }

  // Inject team deps into Telegram channel so /teams command works
  try {
    const applyTeamChangeViaTelegram = async (teamId: string, changeId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const team = getManagedTeam(teamId);
        if (!team) return { success: false, error: 'Team not found' };
        const pending = team.pendingChanges.find(c => c.id === changeId);
        if (!pending) return { success: false, error: 'Change not found' };
        if (pending.type === 'schedule_one_off') {
          const targetAgentId = String(pending.targetSubagentId || '').trim();
          if (!targetAgentId) return { success: false, error: 'schedule_one_off requires targetSubagentId' };
          if (!team.subagentIds.includes(targetAgentId)) return { success: false, error: 'Target agent is not a member of this team' };
          const after = pending?.diff?.after;
          const runAtRaw = typeof after === 'object' && after
            ? String((after as any).runAt || (after as any).run_at || '').trim()
            : String(after || '').trim();
          const taskText = typeof after === 'object' && after
            ? String((after as any).task || (after as any).prompt || pending.description || '').trim()
            : String(pending.description || '').trim();
          if (!runAtRaw) return { success: false, error: 'schedule_one_off requires diff.after.runAt (ISO datetime)' };
          if (!taskText) return { success: false, error: 'schedule_one_off requires diff.after.task' };
          const parsed = new Date(runAtRaw);
          if (!Number.isFinite(parsed.getTime())) return { success: false, error: `Invalid runAt value: "${runAtRaw}"` };
          if (parsed.getTime() <= Date.now()) return { success: false, error: 'runAt must be in the future' };
          const job = cronScheduler.createJob({
            name: `Team one-off: ${targetAgentId}`,
            prompt: taskText,
            type: 'one-shot',
            runAt: parsed.toISOString(),
            sessionTarget: 'isolated',
            subagent_id: targetAgentId,
          } as any);
          appendTeamChat(teamId, {
            from: 'manager',
            fromName: 'Manager',
            content: `One-off run scheduled for ${targetAgentId} at ${new Date(job.runAt || parsed.toISOString()).toLocaleString()}.`,
          });
        } else {
          const targetAgentId = String(pending.targetSubagentId || '').trim();
          if (pending.type !== 'modify_context') {
            if (!targetAgentId) return { success: false, error: 'Change requires targetSubagentId' };
            if (!team.subagentIds.includes(targetAgentId)) return { success: false, error: 'Target agent is not a member of this team' };
          }
          const { applyChangeToAgent } = await import('../teams/team-manager-runner');
          const applied = await applyChangeToAgent(pending, teamId);
          if (!applied) return { success: false, error: 'Change could not be applied (invalid or unsafe)' };
        }
        const appliedChange = applyTeamChange(teamId, changeId);
        if (appliedChange) {
          const targetAgentId = String(appliedChange.targetSubagentId || '').trim();
          const targetName = targetAgentId ? (getAgentById(targetAgentId)?.name || targetAgentId) : 'team';
          appendTeamChat(teamId, {
            from: 'user',
            fromName: 'Owner (Telegram)',
            content: `Approved and applied: ${appliedChange.description} (target: ${targetName})`,
          });
          appendManagerNote(teamId, {
            type: 'decision',
            content: `Owner approved and applied change ${appliedChange.id} (${appliedChange.type}) for ${targetName}: ${appliedChange.description}`,
          });
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    };

    telegramChannel.setTeamDeps({
      getManagedTeam,
      listManagedTeams,
      handleManagerConversation,
      spawnAgent,
      applyTeamChange: applyTeamChangeViaTelegram,
      rejectTeamChange: (teamId: string, changeId: string) => {
        const change = rejectTeamChange(teamId, changeId);
        if (!change) return { success: false, error: 'Change not found' };
        const targetAgentId = String(change.targetSubagentId || '').trim();
        const targetName = targetAgentId ? (getAgentById(targetAgentId)?.name || targetAgentId) : 'team';
        appendTeamChat(teamId, {
          from: 'user',
          fromName: 'Owner (Telegram)',
          content: `Rejected: ${change.description} (target: ${targetName})`,
        });
        appendManagerNote(teamId, {
          type: 'decision',
          content: `Owner rejected change ${change.id} (${change.type}) for ${targetName}: ${change.description}`,
        });
        return { success: true };
      },
      getCronJobs: () => cronScheduler.getJobs(),
      runCronJobNow: async (jobId: string) => { await cronScheduler.runJobNow(jobId, { respectActiveHours: false }); },
      updateCronJob: (jobId: string, partial: any) => cronScheduler.updateJob(jobId, partial),
      deleteCronJob: (jobId: string) => cronScheduler.deleteJob(jobId),
    });
    console.log('[Telegram] Team deps injected (/teams command active).');
  } catch (e: any) {
    console.warn('[Telegram] Could not inject team deps:', e.message);
  }

  // Wire repair proposal hook so propose_repair sends Telegram buttons automatically
  try {
    const { setRepairProposalHook } = require('../../tools/self-repair.js');
    setRepairProposalHook((repairId: string) => {
      const telegramCfg = getConfig().getConfig() as any;
      const tgEnabled =
        telegramCfg?.channels?.telegram?.enabled ||
        telegramCfg?.telegram?.enabled;
      if (!tgEnabled) return;
      const allowedIds: number[] =
        telegramCfg?.channels?.telegram?.allowedUserIds ||
        telegramCfg?.telegram?.allowedUserIds ||
        [];
      for (const userId of allowedIds) {
        telegramChannel.sendRepairWithButtons(userId, repairId).catch((err: any) =>
          console.warn('[Telegram] Could not send repair buttons:', err?.message)
        );
      }
    });
    console.log('[SelfRepair] Telegram button hook wired — propose_repair will send ✅/❌ buttons.');
  } catch (e: any) {
    console.warn('[SelfRepair] Could not wire repair proposal hook:', e.message);
  }

  // Wire setDispatchDeps so team-dispatch-runtime has all it needs to run agents
  try {
    const { setDispatchDeps } = require('../teams/team-dispatch-runtime.js');
    const { listWorkspaceFiles, recordFileWrite } = require('../teams/team-workspace.js');
    setDispatchDeps({
      handleChat,
      broadcastTeamEvent,
      getMCPManager,
      buildTools: () => buildTools(),
      createTask,
      updateTaskStatus,
      setTaskStepRunning,
      updateTaskRuntimeProgress,
      mutatePlan,
      appendJournal,
      setWorkspace,
      recordAgentRun,
      recordFileWrite,
      listWorkspaceFiles,
    });
    console.log('[TeamDispatch] setDispatchDeps wired — runTeamAgentViaChat ready.');
  } catch (e: any) {
    console.warn('[TeamDispatch] Could not wire dispatch deps:', e.message);
  }

  const coordinatorCompletionDedup = new Set<string>();

  // Wire coordinator deps — main agent acts as team manager
  try {
    const { setCoordinatorDeps } = require('../teams/team-coordinator.js');
    setCoordinatorDeps({
      handleChat,
      broadcastTeamEvent,
      onCoordinatorDone: async ({ teamId, reason, turns, managerMessage }: { teamId: string; reason: string; turns: number; managerMessage: string }) => {
        if (reason !== 'goal_complete') return;

        const normalizedManagerMessage = String(managerMessage || '').trim();
        const dedupKey = `${teamId}:${turns}:${normalizedManagerMessage.slice(0, 240)}`;
        if (coordinatorCompletionDedup.has(dedupKey)) {
          console.log(`[TeamCoordinator] Duplicate goal_complete callback skipped for team ${teamId}`);
          return;
        }
        coordinatorCompletionDedup.add(dedupKey);

        const team = getManagedTeam(teamId) || listManagedTeams().find(t => t.id === teamId);
        const teamName = team?.name || teamId;
        const sessionId = `cron_team_goal_complete_${teamId}_${Date.now()}`;

        const recentRuns = getTeamRunHistory(teamId, 12);
        const recentRunsBlock = recentRuns.length > 0
          ? recentRuns.slice(-12).map((run: any, idx: number) => {
            const ts = run?.timestamp ? new Date(run.timestamp).toISOString() : 'unknown-time';
            const agent = String(run?.agentName || run?.agentId || 'unknown-agent');
            const status = String(run?.status || 'unknown-status');
            const summary = String(run?.summary || run?.result || '').replace(/\s+/g, ' ').slice(0, 220);
            return `${idx + 1}. [${ts}] ${agent} — ${status}${summary ? ` — ${summary}` : ''}`;
          }).join('\n')
          : '(No recent team run history found.)';

        const managerExcerpt = normalizedManagerMessage.slice(0, 1200) || '(No manager completion message provided.)';

        const prompt = [
          'You are Prometheus main agent. A managed team coordinator has just signaled [GOAL_COMPLETE].',
          '',
          `Team ID: ${teamId}`,
          `Team Name: ${teamName}`,
          `Coordinator turns used: ${turns}`,
          '',
          'Latest manager completion message:',
          managerExcerpt,
          '',
          'Recent team run history snapshot:',
          recentRunsBlock,
          '',
          'Produce a concise owner-facing post-run analysis in markdown with these sections:',
          '1) Team mission/current focus/completed work/milestones (load latest team state and summarize).',
          '2) Manager completion summary (what was achieved, based on the message above).',
          '3) Recent agent execution recap (use available run history; call tools if needed).',
          '4) Tool-usage synopsis from recent relevant tasks/journals (focus on meaningful patterns, not noise).',
          '5) Risks, open items, and clear recommendations for next actions.',
          '',
          'Constraints:',
          '- Keep it concise, specific, and owner-readable.',
          '- Mention uncertainties explicitly instead of guessing.',
          '- Do not ask the user for input in this auto-summary.',
          '- End with a short "Bottom line" paragraph.',
        ].join('\n');

        const task = createTask({
          sessionId,
          title: `Team Goal Complete Analysis: ${teamName}`,
          prompt,
          channel: 'web',
          plan: [
            { index: 0, description: 'Load team state and completion context.', status: 'pending' },
            { index: 1, description: 'Summarize recent runs and tool usage patterns.', status: 'pending' },
            { index: 2, description: 'Write concise owner-facing recommendations.', status: 'pending' },
          ],
        });

        const makeTaskBroadcast = (data: any) => {
          const payload = data && typeof data === 'object' ? { ...data } : { message: String(data ?? '') };
          if (!payload.taskId) payload.taskId = task.id;
          broadcastWS(payload);
        };

        makeTaskBroadcast({
          type: 'bg_task_created',
          taskId: task.id,
          title: task.title,
          sessionId,
          source: 'team_goal_complete',
          teamId,
          teamName,
        });

        const runner = new BackgroundTaskRunner(task.id, handleChat, makeTaskBroadcast, telegramChannel);
        runner.start().catch((err: any) => {
          console.error(`[TeamCoordinator] Goal-complete analysis task failed to start for ${teamId}:`, err?.message || err);
        });
      },
    });
    console.log('[TeamCoordinator] Main-agent coordinator deps wired.');
  } catch (e: any) {
    console.warn('[TeamCoordinator] Could not wire coordinator deps:', e.message);
  }

  // Auto-register weekly performance review job (idempotent — won't duplicate)
  try {
    const weeklyJobDef = getWeeklyReviewJobDefinition();
    const existingJobs = cronScheduler.getJobs();
    const weeklyExists = existingJobs.some((j: any) => j.name === weeklyJobDef.name);
    if (!weeklyExists) {
      cronScheduler.createJob(weeklyJobDef);
      console.log('[WeeklyReview] Registered weekly performance review job (fires Sundays at 9am).');
    } else {
      console.log('[WeeklyReview] Weekly performance review job already exists — skipping.');
    }
  } catch (weeklyErr: any) {
    console.warn('[WeeklyReview] Could not register weekly review job:', weeklyErr.message);
  }

  // Intelligence pipeline jobs are managed via cron/jobs.json — not hardcoded here.

  heartbeatRunner.start();
  console.log('[HeartbeatRunner] Started — interval:', heartbeatRunner.getConfig().intervalMinutes, 'min');

  telegramChannel.start().then(() => {
    // Deliver any queued startup/hot-restart notices that target Telegram.
    try {
      const pending = listPendingStartupNotifications().filter((n) =>
        !n.delivered?.telegram && n.telegram?.enabled,
      );
      for (const item of pending) {
        const chatId = Number(item.telegram?.chatId || 0);
        const text = item.text || item.automatedSession?.history?.[0]?.content || '';
        if (!text) continue;
        if (chatId > 0 && typeof telegramChannel.sendMessage === 'function') {
          telegramChannel.sendMessage(chatId, text)
            .then(() => markStartupNotificationDelivered(item.id, 'telegram'))
            .catch((err: any) => console.warn('[Telegram] Startup notification delivery failed:', err?.message));
        } else {
          telegramChannel.sendToAllowed(text)
            .then(() => markStartupNotificationDelivered(item.id, 'telegram'))
            .catch((err: any) => console.warn('[Telegram] Startup notification broadcast failed:', err?.message));
        }
      }
    } catch (err: any) {
      console.warn('[Gateway] Could not process startup notification queue for Telegram:', err?.message);
    }

    // Check if we just restarted after a self-update
    const selfUpdateStatusFile = path.join(require('os').homedir(), '.prometheus', 'last_self_update.txt');
    if (fs.existsSync(selfUpdateStatusFile)) {
      try {
        const statusContent = fs.readFileSync(selfUpdateStatusFile, 'utf-8').trim();
        fs.unlinkSync(selfUpdateStatusFile); // consume it — only notify once
        if (statusContent.startsWith('UPDATE_SUCCESS')) {
          const lines = statusContent.split('\n');
          const timestamp = lines[1] || '';
          const msg = `✅ Prometheus self-update complete!\n\nI ran the update, rebuilt, and have restarted the gateway. I'm back online and up to date.\n\n🕐 Updated at: ${timestamp.trim()}`;
          setTimeout(() => telegramChannel.sendToAllowed(msg).catch(() => {}), 3000);
          console.log('[Gateway] Post-update Telegram notification queued.');
        } else if (statusContent.startsWith('UPDATE_FAILED')) {
          const lines = statusContent.split('\n');
          const timestamp = lines[1] || '';
          const msg = `❌ Prometheus self-update failed.\n\nThe update process encountered an error. Gateway has restarted with the previous version. Check the terminal for details.\n\n🕐 Attempted at: ${timestamp.trim()}`;
          setTimeout(() => telegramChannel.sendToAllowed(msg).catch(() => {}), 3000);
          console.log('[Gateway] Post-update failure Telegram notification queued.');
        }
      } catch (e: any) {
        console.warn('[Gateway] Could not read self-update status file:', e.message);
      }
    }
  }).catch((err: any) => console.error('[Telegram] Start failed:', err.message));

  const bootWorkspace = getConfig().getWorkspacePath() || (getConfig().getConfig() as any).workspace?.path || '';
  if (bootWorkspace) {
    try {
      startAuditMaterializer({
        workspacePath: bootWorkspace,
        configDir: getConfig().getConfigDir(),
        intervalMs: 30_000,
      });
    } catch (err: any) {
      console.warn('[AuditMaterializer] Could not start:', err?.message || err);
    }

    loadWorkspaceHooks(bootWorkspace);
    hookBus
      .fire({ type: 'gateway:startup', workspacePath: bootWorkspace })
      .catch((err: any) => console.warn('[hooks] gateway:startup error:', err?.message || err));
  }
}
