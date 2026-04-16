import fs from 'fs';
import path from 'path';

type StartAuditMaterializerOpts = {
  workspacePath: string;
  configDir: string;
  intervalMs?: number;
};

type MirrorFile = {
  srcAbs: string;
  destRel: string;
  domain: string;
};

type MirrorStats = {
  copied: number;
  skipped: number;
  errors: number;
};

type SessionPreview = {
  id: string;
  mtimeMs: number;
  lastActiveAt?: number;
  historyLength?: number;
  hasSummary: boolean;
};

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MIN_INTERVAL_MS = 5 * 60_000;
const INITIAL_DELAY_MS = 5 * 60_000;
const COUNT_CAP = 5_000;
const MAX_PREVIEW_ROWS = 80;

let _timer: NodeJS.Timeout | null = null;
let _running = false;
let _lastRunAt = 0;
let _intervalMs: number | null = null;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeJson(filePath: string, data: unknown): void {
  writeText(filePath, JSON.stringify(data, null, 2));
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeRel(absPath: string, root: string): string {
  const rel = path.relative(root, absPath).replace(/\\/g, '/');
  return rel.startsWith('../') ? path.basename(absPath) : rel;
}

function listFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  return out;
}

function normalizePathForCompare(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

function isExcludedSourcePath(absPath: string, workspacePath: string): boolean {
  const full = normalizePathForCompare(absPath);
  const excluded = [
    path.join(workspacePath, 'teams'),
    path.join(workspacePath, '.prometheus', 'subagents'),
  ].map(normalizePathForCompare);
  return excluded.some((prefix) => full === prefix || full.startsWith(`${prefix}/`));
}

function collectMirrorFiles(configDir: string, workspacePath: string): MirrorFile[] {
  const mirrors: MirrorFile[] = [];

  const pushFile = (srcAbs: string, destRel: string, domain: string): void => {
    if (!fs.existsSync(srcAbs)) return;
    if (isExcludedSourcePath(srcAbs, workspacePath)) return;
    mirrors.push({ srcAbs, destRel, domain });
  };

  const pushDir = (srcDir: string, destPrefix: string, domain: string): void => {
    if (!fs.existsSync(srcDir)) return;
    const files = listFilesRecursive(srcDir);
    for (const abs of files) {
      if (isExcludedSourcePath(abs, workspacePath)) continue;
      const rel = safeRel(abs, srcDir);
      pushFile(abs, path.posix.join(destPrefix, rel), domain);
    }
  };

  pushDir(path.join(configDir, 'sessions'), 'chats/sessions', 'chats');
  pushDir(path.join(configDir, 'projects'), 'projects/state', 'projects');
  pushDir(path.join(configDir, 'tasks'), 'tasks/state', 'tasks');
  pushDir(path.join(workspacePath, 'proposals'), 'proposals/state', 'proposals');

  pushFile(path.join(configDir, 'cron', 'jobs.json'), 'cron/jobs/jobs.json', 'cron');
  pushDir(path.join(configDir, 'cron', 'runs'), 'cron/runs', 'cron');

  pushDir(path.join(configDir, 'schedules'), 'schedules/state', 'schedules');

  pushFile(path.join(configDir, 'managed-teams.json'), 'teams/state/managed-teams.json', 'teams');
  pushDir(path.join(configDir, 'team-state'), 'teams/state/team-state', 'teams');

  pushFile(path.join(configDir, 'connections.json'), 'connections/state/connections.json', 'connections');
  pushFile(path.join(configDir, 'connections-activity.jsonl'), 'connections/state/connections-activity.jsonl', 'connections');
  pushFile(path.join(configDir, 'integrations-state.json'), 'connections/state/integrations-state.json', 'connections');

  pushFile(path.join(configDir, 'restart-context.json'), 'restarts/state/restart-context.json', 'restarts');
  pushFile(path.join(configDir, 'startup-notifications.json'), 'startup/state/startup-notifications.json', 'startup');
  pushFile(path.join(workspacePath, '.prometheus', 'boot-md-state.json'), 'startup/state/boot-md-state.json', 'startup');

  pushDir(path.join(workspacePath, 'memory'), 'memory/files', 'memory');
  pushFile(path.join(workspacePath, 'USER.md'), 'memory/root/USER.md', 'memory');
  pushFile(path.join(workspacePath, 'SOUL.md'), 'memory/root/SOUL.md', 'memory');
  pushFile(path.join(workspacePath, 'MEMORY.md'), 'memory/root/MEMORY.md', 'memory');

  pushFile(path.join(configDir, 'audit-log.jsonl'), 'system/audit/audit-log.jsonl', 'system');
  pushDir(path.join(configDir, 'logs'), 'system/logs', 'system');

  // System configs (avoid duplicating encrypted/secret vault material)
  const systemFiles = [
    'config.json',
    'mcp-servers.json',
    'policy-rules.json',
    'workspace_state.json',
    'site-shortcuts.json',
    'facts.json',
    'self_learning.json',
    'update_state.json',
  ];
  for (const file of systemFiles) {
    pushFile(path.join(configDir, file), `system/state/${file}`, 'system');
  }

  return mirrors;
}

function readManifest(manifestPath: string): Record<string, { mtimeMs: number; size: number }> {
  return readJson<Record<string, { mtimeMs: number; size: number }>>(manifestPath) || {};
}

function copyMirrors(auditRoot: string, mirrors: MirrorFile[], manifestPath: string): MirrorStats {
  const prev = readManifest(manifestPath);
  const next: Record<string, { mtimeMs: number; size: number }> = {};
  const stats: MirrorStats = { copied: 0, skipped: 0, errors: 0 };

  for (const item of mirrors) {
    try {
      const srcStat = fs.statSync(item.srcAbs);
      if (!srcStat.isFile()) continue;
      const key = item.srcAbs;
      next[key] = { mtimeMs: srcStat.mtimeMs, size: srcStat.size };

      const prevEntry = prev[key];
      const unchanged =
        prevEntry &&
        prevEntry.mtimeMs === srcStat.mtimeMs &&
        prevEntry.size === srcStat.size;

      const destAbs = path.join(auditRoot, item.destRel);
      if (unchanged && fs.existsSync(destAbs)) {
        stats.skipped += 1;
        continue;
      }

      ensureDir(path.dirname(destAbs));
      fs.copyFileSync(item.srcAbs, destAbs);
      stats.copied += 1;
    } catch {
      stats.errors += 1;
    }
  }

  writeJson(manifestPath, next);
  return stats;
}

function buildDirectoryScaffold(auditRoot: string): void {
  const dirs = [
    '_index',
    'chats/sessions',
    'chats/transcripts',
    'chats/compactions',
    'projects/state',
    'tasks/state',
    'background-tasks',
    'proposals/state',
    'cron/jobs',
    'cron/runs',
    'schedules/state',
    'teams/state',
    'connections/state',
    'restarts/state',
    'startup/state',
    'memory/files',
    'memory/root',
    'system/state',
    'system/audit',
    'system/logs',
  ];
  for (const rel of dirs) ensureDir(path.join(auditRoot, rel));
}

function buildAuditReadme(auditRoot: string): void {
  const lines = [
    '# Audit Directory',
    '',
    'This directory is a one-way materialized mirror for observability.',
    '',
    '- Canonical runtime stores remain in `.prometheus/` and `workspace/`.',
    '- Files under `workspace/audit/` are snapshots for debugging and review.',
    '- Team/subagent workspaces are intentionally not mirrored here.',
    '',
    '## Navigation',
    '',
    '- `_index/` global indexes and run metadata',
    '- `chats/` session snapshots, transcripts, compaction artifacts',
    '- `projects/` project state snapshots',
    '- `tasks/` task/background-task state snapshots',
    '- `proposals/` proposal timeline/state snapshots',
    '- `cron/` cron scheduler config and run history',
    '- `schedules/` schedule memory and per-run logs',
    '- `teams/` managed-team state and run metadata (not workspace files)',
    '- `connections/` connector state and activity logs',
    '- `restarts/` restart context snapshots',
    '- `startup/` startup-notification and boot state snapshots',
    '- `memory/` memory markdown snapshots (intraday + USER.md/SOUL.md/MEMORY.md root snapshots)',
    '- `system/` selected system config, audit, and logs',
  ];
  writeText(path.join(auditRoot, 'README.md'), `${lines.join('\n')}\n`);
}

function buildSessionPreview(configDir: string): SessionPreview[] {
  const sessionsDir = path.join(configDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];

  const files = fs
    .readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(sessionsDir, f));

  const withMtime = files
    .map((file) => {
      try {
        return { file, mtimeMs: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((v): v is { file: string; mtimeMs: number } => !!v)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_PREVIEW_ROWS);

  const out: SessionPreview[] = [];
  for (const item of withMtime) {
    const data = readJson<any>(item.file);
    out.push({
      id: path.basename(item.file, '.json'),
      mtimeMs: item.mtimeMs,
      lastActiveAt: Number(data?.lastActiveAt) || undefined,
      historyLength: Array.isArray(data?.history) ? data.history.length : undefined,
      hasSummary: !!String(data?.latestContextSummary || '').trim(),
    });
  }
  return out;
}

function buildTasksSummary(configDir: string): { total: number; byStatus: Record<string, number> } {
  const tasksDir = path.join(configDir, 'tasks');
  if (!fs.existsSync(tasksDir)) return { total: 0, byStatus: {} };
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json') && !f.endsWith('.bus.json') && f !== '_index.json');
  const byStatus: Record<string, number> = {};
  for (const file of files) {
    const data = readJson<any>(path.join(tasksDir, file));
    const status = String(data?.status || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return { total: files.length, byStatus };
}

function buildProposalsSummary(workspacePath: string): { total: number; byBucket: Record<string, number> } {
  const root = path.join(workspacePath, 'proposals');
  const buckets = ['pending', 'approved', 'denied', 'archive'];
  const byBucket: Record<string, number> = {};
  let total = 0;
  for (const bucket of buckets) {
    const dir = path.join(root, bucket);
    if (!fs.existsSync(dir)) {
      byBucket[bucket] = 0;
      continue;
    }
    const count = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
    byBucket[bucket] = count;
    total += count;
  }
  return { total, byBucket };
}

function buildTeamsSummary(configDir: string): { teamCount: number; totalRuns: number } {
  const data = readJson<any>(path.join(configDir, 'managed-teams.json'));
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  let totalRuns = 0;
  for (const t of teams) {
    totalRuns += Array.isArray(t?.runHistory) ? t.runHistory.length : 0;
  }
  return { teamCount: teams.length, totalRuns };
}

function countFiles(rootDir: string, cap = COUNT_CAP): number {
  if (!fs.existsSync(rootDir)) return 0;
  let count = 0;
  const stack = [rootDir];
  while (stack.length > 0 && count < cap) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (count >= cap) break;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function writeIndexes(auditRoot: string, configDir: string, workspacePath: string, mirrors: MirrorFile[], mirrorStats: MirrorStats): void {
  const nowIso = new Date().toISOString();
  const sessionPreview = buildSessionPreview(configDir);
  const tasksSummary = buildTasksSummary(configDir);
  const proposalsSummary = buildProposalsSummary(workspacePath);
  const teamsSummary = buildTeamsSummary(configDir);

  const byDomain: Record<string, number> = {};
  for (const item of mirrors) {
    byDomain[item.domain] = (byDomain[item.domain] || 0) + 1;
  }

  const globalIndex = {
    generatedAt: nowIso,
    materializer: {
      intervalMs: _intervalMs,
      lastRunAt: _lastRunAt,
      filesMirrored: mirrors.length,
      copied: mirrorStats.copied,
      skipped: mirrorStats.skipped,
      errors: mirrorStats.errors,
    },
    counts: {
      sessionsPreviewed: sessionPreview.length,
      tasks: tasksSummary.total,
      proposals: proposalsSummary.total,
      teams: teamsSummary.teamCount,
      teamRuns: teamsSummary.totalRuns,
      chatTranscripts: countFiles(path.join(auditRoot, 'chats', 'transcripts')),
      chatCompactions: countFiles(path.join(auditRoot, 'chats', 'compactions')),
    },
    byDomain,
  };

  writeJson(path.join(auditRoot, '_index', 'global.json'), globalIndex);
  writeJson(path.join(auditRoot, '_index', 'sessions-preview.json'), sessionPreview);
  writeJson(path.join(auditRoot, '_index', 'tasks-summary.json'), tasksSummary);
  writeJson(path.join(auditRoot, '_index', 'proposals-summary.json'), proposalsSummary);
  writeJson(path.join(auditRoot, '_index', 'teams-summary.json'), teamsSummary);

  const navLines = [
    '# Audit Index',
    '',
    `Generated: ${nowIso}`,
    '',
    '## Quick Links',
    '- chats/sessions/',
    '- chats/transcripts/',
    '- chats/compactions/',
    '- projects/state/',
    '- tasks/state/',
    '- proposals/state/',
    '- cron/jobs/ and cron/runs/',
    '- schedules/state/',
    '- teams/state/',
    '- connections/state/',
    '- restarts/state/',
    '- startup/state/',
    '- memory/files/',
    '- system/state/, system/audit/, system/logs/',
    '',
    '## Current Counts',
    `- mirrored files: ${mirrors.length}`,
    `- copied this run: ${mirrorStats.copied}`,
    `- skipped unchanged: ${mirrorStats.skipped}`,
    `- errors: ${mirrorStats.errors}`,
    `- tasks: ${tasksSummary.total}`,
    `- proposals: ${proposalsSummary.total}`,
    `- teams: ${teamsSummary.teamCount}`,
    `- transcript files: ${countFiles(path.join(auditRoot, 'chats', 'transcripts'))}`,
  ];
  writeText(path.join(auditRoot, '_index', 'README.md'), `${navLines.join('\n')}\n`);

  const chatsMd = [
    '# Chats Index',
    '',
    `Generated: ${nowIso}`,
    '',
    `- Sessions mirrored: ${byDomain.chats || 0}`,
    `- Transcript files: ${countFiles(path.join(auditRoot, 'chats', 'transcripts'))}`,
    `- Compaction artifacts: ${countFiles(path.join(auditRoot, 'chats', 'compactions'))}`,
    '',
    '## Recent Sessions',
    ...sessionPreview.map((s) => {
      const active = s.lastActiveAt ? new Date(s.lastActiveAt).toISOString() : 'unknown';
      const msgs = Number.isFinite(Number(s.historyLength)) ? String(s.historyLength) : 'n/a';
      return `- ${s.id} | messages=${msgs} | lastActive=${active} | summary=${s.hasSummary ? 'yes' : 'no'}`;
    }),
  ];
  writeText(path.join(auditRoot, 'chats', 'INDEX.md'), `${chatsMd.join('\n')}\n`);

  const tasksMd = [
    '# Tasks Index',
    '',
    `Generated: ${nowIso}`,
    '',
    `- Total task records: ${tasksSummary.total}`,
    '## By Status',
    ...Object.entries(tasksSummary.byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => `- ${status}: ${count}`),
  ];
  writeText(path.join(auditRoot, 'tasks', 'INDEX.md'), `${tasksMd.join('\n')}\n`);

  const propsMd = [
    '# Proposals Index',
    '',
    `Generated: ${nowIso}`,
    '',
    `- Total proposals: ${proposalsSummary.total}`,
    ...Object.entries(proposalsSummary.byBucket).map(([bucket, count]) => `- ${bucket}: ${count}`),
  ];
  writeText(path.join(auditRoot, 'proposals', 'INDEX.md'), `${propsMd.join('\n')}\n`);

  const teamsMd = [
    '# Teams Index',
    '',
    `Generated: ${nowIso}`,
    '',
    `- Managed teams: ${teamsSummary.teamCount}`,
    `- Recorded team runs: ${teamsSummary.totalRuns}`,
    '- Note: team/subagent workspace files are intentionally excluded from this audit mirror.',
  ];
  writeText(path.join(auditRoot, 'teams', 'INDEX.md'), `${teamsMd.join('\n')}\n`);
}

function runMaterialization(configDir: string, workspacePath: string): void {
  const auditRoot = path.join(workspacePath, 'audit');
  buildDirectoryScaffold(auditRoot);
  buildAuditReadme(auditRoot);

  const mirrors = collectMirrorFiles(configDir, workspacePath);
  const manifestPath = path.join(auditRoot, '_index', 'materializer-manifest.json');
  const mirrorStats = copyMirrors(auditRoot, mirrors, manifestPath);
  _lastRunAt = Date.now();
  writeIndexes(auditRoot, configDir, workspacePath, mirrors, mirrorStats);
}

export function startAuditMaterializer(opts: StartAuditMaterializerOpts): void {
  const intervalMs = Math.max(MIN_INTERVAL_MS, Number(opts.intervalMs || DEFAULT_INTERVAL_MS));
  if (_timer) return;
  _intervalMs = intervalMs;

  const runSafe = (): void => {
    if (_running) return;
    _running = true;
    try {
      runMaterialization(opts.configDir, opts.workspacePath);
    } catch (err: any) {
      console.warn('[AuditMaterializer] Sync failed:', String(err?.message || err));
    } finally {
      _running = false;
    }
  };

  const initialDelay = Math.min(INITIAL_DELAY_MS, intervalMs);
  const initialTimer = setTimeout(runSafe, initialDelay);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();
  _timer = setInterval(runSafe, intervalMs);
  if (typeof _timer.unref === 'function') _timer.unref();
  console.log(`[AuditMaterializer] Started (interval=${intervalMs}ms)`);
}

export function stopAuditMaterializer(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _intervalMs = null;
}
