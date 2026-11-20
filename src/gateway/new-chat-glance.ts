// New-chat landing "glance" (F2): what is running, what needs the user, and
// how much plan usage is left. One small payload shared by desktop and mobile,
// so neither client has to pull the full /api/bg-tasks list on every new chat.
import * as fs from 'fs';
import * as path from 'path';

/** A task counts as running only if it reported progress recently; older "running" rows are stale leftovers. */
export const GLANCE_RUNNING_FRESH_MS = 20 * 60_000;
const MAX_RUNNING = 3;
const MAX_USAGE = 3;

export interface GlanceRunning { id: string; title: string; provider: string; lastProgressAt: number }
export interface GlanceUsage { provider: string; label: string; leftPercent: number; resetAt: string }
export interface NewChatGlance {
  name: string;
  running: GlanceRunning[];
  runningCount: number;
  needsYou: { count: number; oldestAt: number; firstLabel: string };
  usage: GlanceUsage[];
  /** Most recently active project, for the quiet-day "Working on X?" prompt. */
  recentProject: { id: string; name: string } | null;
}

const USAGE_LABELS: Record<string, string> = { anthropic: 'Claude', openai_codex: 'ChatGPT', openai: 'OpenAI', xai: 'Grok' };

function timeOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
}

function cleanTitle(value: unknown): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 70 ? `${text.slice(0, 67).trimEnd()}…` : text || 'Untitled task';
}

export function buildGlanceRunning(tasks: any[], now = Date.now()): { items: GlanceRunning[]; count: number } {
  const fresh = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => String(task?.status || '') === 'running')
    .map((task) => ({
      id: String(task.id || ''),
      title: cleanTitle(task.title),
      provider: String(task.modelRef?.providerId || task.provider || ''),
      lastProgressAt: Math.max(timeOf(task.lastProgressAt), timeOf(task.updatedAt), timeOf(task.startedAt)),
    }))
    .filter((task) => task.id && now - task.lastProgressAt <= GLANCE_RUNNING_FRESH_MS)
    .sort((a, b) => b.lastProgressAt - a.lastProgressAt);
  return { items: fresh.slice(0, MAX_RUNNING), count: fresh.length };
}

export function buildGlanceNeedsYou(items: any[]): NewChatGlance['needsYou'] {
  const list = Array.isArray(items) ? items : [];
  const times = list.map((item) => timeOf(item?.createdAt)).filter((t) => t > 0);
  const first = list[0] || {};
  return {
    count: list.length,
    oldestAt: times.length ? Math.min(...times) : 0,
    firstLabel: list.length ? cleanTitle(first.source || first.payload?.teamName || first.kind || '') : '',
  };
}

/** Percent left per provider, using each provider's most-constrained window (same rule as the model badge). */
export function buildGlanceUsage(rows: any[]): GlanceUsage[] {
  const byProvider = new Map<string, any>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const provider = String(row?.provider || '');
    if (!provider || !Array.isArray(row?.windows) || !row.windows.length) continue;
    const current = byProvider.get(provider);
    if (!current || (String(row.account_id || '') === 'default' && String(current.account_id || '') !== 'default')) byProvider.set(provider, row);
  }
  const out: GlanceUsage[] = [];
  for (const [provider, row] of byProvider) {
    const windows = row.windows.filter((w: any) => Number.isFinite(Number(w?.used_percent)));
    if (!windows.length) continue;
    const worst = windows.reduce((a: any, b: any) => (Number(b.used_percent) > Number(a.used_percent) ? b : a));
    const label = USAGE_LABELS[provider] || String(row.label || provider).split('·').pop()!.trim() || provider;
    out.push({
      provider,
      label,
      leftPercent: Math.max(0, Math.min(100, Math.round(100 - Number(worst.used_percent)))),
      resetAt: String(worst.reset_at || ''),
    });
  }
  return out.slice(0, MAX_USAGE);
}

/** The user's preferred name from USER.md ("Preferred name" from onboarding, else "Name"), or ''. */
export function readGlanceName(workspacePath: string): string {
  let text = '';
  try { text = fs.readFileSync(path.join(workspacePath, 'USER.md'), 'utf8'); } catch { return ''; }
  for (const key of ['Preferred name', 'Name']) {
    const match = text.match(new RegExp(`^[ \\t]*[-*][ \\t]*(?:\\[m:[^\\]]+\\][ \\t]*)?(?:\\*\\*)?${key}(?:\\*\\*)?[ \\t]*:(?:\\*\\*)?[ \\t]*([^\\n<\\[]+)`, 'im'));
    const name = String(match?.[1] || '').replace(/\*+/g, '').trim();
    if (name && name.length <= 40) return name;
  }
  return '';
}

/** The project with the latest activity (its own update or its newest chat), or null. */
export function buildGlanceRecentProject(projects: any[]): NewChatGlance['recentProject'] {
  let best: { id: string; name: string; at: number } | null = null;
  for (const project of Array.isArray(projects) ? projects : []) {
    const id = String(project?.id || '');
    const name = String(project?.name || '').replace(/\s+/g, ' ').trim();
    if (!id || !name) continue;
    const sessions = Array.isArray(project.sessions) ? project.sessions : [];
    const at = Math.max(timeOf(project.updatedAt), ...sessions.map((s: any) => timeOf(s?.updatedAt)));
    if (!best || at > best.at) best = { id, name: name.length > 40 ? `${name.slice(0, 39).trimEnd()}…` : name, at };
  }
  return best ? { id: best.id, name: best.name } : null;
}

export function buildNewChatGlance(input: { name?: string; tasks: any[]; needsYou: any[]; usage: any[]; projects?: any[]; now?: number }): NewChatGlance {
  const running = buildGlanceRunning(input.tasks, input.now);
  return {
    name: String(input.name || ''),
    running: running.items,
    runningCount: running.count,
    needsYou: buildGlanceNeedsYou(input.needsYou),
    usage: buildGlanceUsage(input.usage),
    recentProject: buildGlanceRecentProject(input.projects || []),
  };
}
