// Hard reset: wipes the user's workspace memory, chats, projects, scheduled
// tasks, and teams; rebuilds the public-workspace scaffold from scratch; clears
// the user's onboarding state so the controller restarts at step 1.
//
// KEEPS intentionally: model config + API keys, credentials vault, OAuth
// connections, audit logs, installed apps/skills. Re-onboarding should not
// force the user to re-auth Gmail or re-enter their model API keys.

import * as fs from 'fs';
import * as path from 'path';
import { ensurePublicWorkspaceScaffold } from '../../config/public-workspace';
import { reset as resetOnboardingRecord } from './onboarding-store';

function rmrf(p: string): void {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {
    console.warn('[onboarding/redo] failed to remove', p, e);
  }
}

function rmFile(p: string): void {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.warn('[onboarding/redo] failed to remove file', p, e);
  }
}

function workspaceDir(): string {
  return process.env.PROMETHEUS_WORKSPACE_DIR || path.join(process.cwd(), 'workspace');
}

function dataDir(): string {
  return process.env.PROMETHEUS_DATA_DIR || path.join(process.cwd(), '.prometheus');
}

export interface RedoResult {
  removed: string[];
  errors: string[];
}

export function redoOnboarding(userId: string): RedoResult {
  const ws  = workspaceDir();
  const cfg = dataDir();
  const removed: string[] = [];
  const errors: string[] = [];

  // 1. Wipe memory files in workspace (USER, BUSINESS, MEMORY, TOOLS, SOUL).
  //    The scaffold rebuilds defaults afterwards.
  for (const f of ['USER.md', 'BUSINESS.md', 'MEMORY.md', 'TOOLS.md', 'SOUL.md']) {
    const fp = path.join(ws, f);
    if (fs.existsSync(fp)) { rmFile(fp); removed.push(fp); }
  }

  // 2. Wipe user-generated workspace content. Whitelist of subdirs we know
  //    are user data; anything else is left alone defensively.
  const wsWipeDirs = [
    'projects', 'creative-projects', 'creatives', 'canvas',
    'analysis', 'audit', 'downloads', 'entities', 'events',
    'generated', 'integrations', 'opportunity-radar',
    'memory', 'Brain',
  ];
  for (const d of wsWipeDirs) {
    const dp = path.join(ws, d);
    if (fs.existsSync(dp)) { rmrf(dp); removed.push(dp); }
  }

  // 3. Wipe heartbeat history file (kept the directory alive via scaffold).
  for (const f of ['HEARTBEAT.md', 'BOOT.md', 'AGENTS.md']) {
    const fp = path.join(ws, f);
    if (fs.existsSync(fp)) { rmFile(fp); removed.push(fp); }
  }

  // 4. Wipe chat history, scheduled tasks, teams, heartbeat runs.
  const cfgWipePaths = [
    path.join(cfg, 'sessions'),         // chat history
    path.join(cfg, 'cron'),              // scheduled tasks
    path.join(cfg, 'schedules'),         // schedule memory
    path.join(cfg, 'tasks'),             // background task journals
    path.join(cfg, 'team-state'),        // team runtime state
    path.join(cfg, 'heartbeat'),         // heartbeat run history
    path.join(cfg, 'managed-teams.json'),
    path.join(cfg, 'timers'),
    path.join(cfg, 'self-improvement'),
    path.join(cfg, 'proposal-workspaces'),
    path.join(cfg, 'fileop_checkpoints'),
    path.join(cfg, 'workspace_state.json'),
    path.join(cfg, 'startup-notifications.json'),
    path.join(cfg, 'self_learning.json'),
    path.join(cfg, 'facts.json'),
    path.join(cfg, 'integrations-state.json'),
  ];
  for (const p of cfgWipePaths) {
    if (!fs.existsSync(p)) continue;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) rmrf(p); else rmFile(p);
    removed.push(p);
  }

  // 5. Reset the user's onboarding record — controller restarts at step 1.
  resetOnboardingRecord(userId);
  removed.push(path.join(cfg, `onboarding.json#${userId}`));

  // 6. Rebuild the public-workspace scaffold so memory files exist with
  //    defaults again. ensurePublicWorkspaceScaffold is idempotent and
  //    only writes files that don't exist after our wipe.
  try {
    ensurePublicWorkspaceScaffold(ws);
  } catch (e: any) {
    errors.push('scaffold_rebuild: ' + (e?.message || e));
  }

  return { removed, errors };
}
