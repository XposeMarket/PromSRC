/**
 * hub.router.ts — Hub page (usage tracker)
 *
 * Endpoints:
 *   GET /api/hub/skills/usage?range=day|week|month
 *   GET /api/hub/tools/heatmap?year=YYYY&month=MM   (1-12)
 *   GET /api/hub/skills/:id/content                 (read-only SKILL.md content)
 *   GET /api/hub/achievements                       (stub, returns [])
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { SkillsManager } from '../skills-runtime/skills-manager';
import { getConfig } from '../../config/config.js';
import { readModelUsageEvents } from '../../providers/model-usage.js';
import { getAllMainChatGoalRecords } from '../main-chat-goals';
import {
  applySkillCuratorSuggestion,
  listSkillCuratorSuggestions,
  rejectSkillCuratorSuggestion,
  runSkillCurator,
  type SkillCuratorMode,
} from '../skills-runtime/skill-curator';

export const router = Router();

let _sm: InstanceType<typeof SkillsManager>;
export function setHubRouterDeps(deps: { skillsManager: InstanceType<typeof SkillsManager> }): void {
  _sm = deps.skillsManager;
}

function getAuditLogPath(): string {
  try {
    return path.join(getConfig().getConfigDir(), 'audit-log.jsonl');
  } catch {
    const dataDir = process.env.PROMETHEUS_DATA_DIR;
    if (dataDir) return path.join(dataDir, '.prometheus', 'audit-log.jsonl');
    return path.join(process.cwd(), '.prometheus', 'audit-log.jsonl');
  }
}

function rangeStart(range: string): number {
  const now = Date.now();
  if (range === 'day')   return now - 24 * 3600 * 1000;
  if (range === 'month') return now - 30 * 24 * 3600 * 1000;
  return now - 7 * 24 * 3600 * 1000; // week (default)
}

function readAuditLines(): string[] {
  const p = getAuditLogPath();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.trim());
}

/**
 * Latest mtime found by walking `dir` up to `maxDepth` levels.
 * Returns null if dir is unreadable.
 */
function latestMtimeInDir(dir: string, maxDepth = 3): Date | null {
  let latest: Date | null = null;
  function walk(p: string, depth: number) {
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { return; }
    if (!latest || st.mtime > latest) latest = st.mtime;
    if (!st.isDirectory() || depth >= maxDepth) return;
    let entries: string[];
    try { entries = fs.readdirSync(p); } catch { return; }
    for (const name of entries) {
      if (name === '.git' || name === 'node_modules') continue;
      walk(path.join(p, name), depth + 1);
    }
  }
  walk(dir, 0);
  return latest;
}

function localDateKey(iso: string): string {
  // YYYY-MM-DD in local time
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localHourKey(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return -1;
  return d.getHours();
}

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeWindow(rawRange: string, timestamps: string[]): { range: 'all' | '30d' | '7d'; sinceMs: number; heatmapStartMs: number; untilMs: number } {
  const range = rawRange === 'all' || rawRange === '30d' || rawRange === '7d' ? rawRange : 'all';
  const today = dayStart(new Date());
  const untilMs = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const earliestMs = timestamps
    .map((ts) => Date.parse(ts || ''))
    .filter((t) => Number.isFinite(t))
    .reduce((min, t) => Math.min(min, t), untilMs);
  if (range === '7d') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { range, sinceMs: start.getTime(), heatmapStartMs: start.getTime(), untilMs };
  }
  if (range === '30d') {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { range, sinceMs: start.getTime(), heatmapStartMs: start.getTime(), untilMs };
  }
  const allStart = Number.isFinite(earliestMs) ? dayStart(new Date(earliestMs)) : today;
  const heatmapStart = new Date(today);
  heatmapStart.setDate(heatmapStart.getDate() - 364);
  return { range, sinceMs: allStart.getTime(), heatmapStartMs: Math.max(allStart.getTime(), heatmapStart.getTime()), untilMs };
}

function buildDailySeries(startMs: number, untilMs: number, counts: Record<string, number>): Array<{ date: string; count: number }> {
  const out: Array<{ date: string; count: number }> = [];
  const cursor = dayStart(new Date(startMs));
  const end = dayStart(new Date(untilMs - 1));
  while (cursor.getTime() <= end.getTime()) {
    const key = dateKeyFromDate(cursor);
    out.push({ date: key, count: counts[key] || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function streaksFromCounts(counts: Record<string, number>): { current: number; longest: number } {
  const today = dayStart(new Date());
  let current = 0;
  const cursor = new Date(today);
  while ((counts[dateKeyFromDate(cursor)] || 0) > 0) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const days = Object.keys(counts).sort();
  let longest = 0;
  let run = 0;
  let prevMs = 0;
  for (const day of days) {
    if ((counts[day] || 0) <= 0) continue;
    const ms = new Date(`${day}T00:00:00`).getTime();
    run = prevMs && ms - prevMs === 24 * 3600 * 1000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevMs = ms;
  }
  return { current, longest };
}

function formatHour(hour: number): string {
  if (hour < 0) return '—';
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h} ${suffix}`;
}

function topEntry<T extends string | number>(map: Map<T, number>): { key: T | ''; value: number } {
  let key: T | '' = '';
  let value = 0;
  for (const [k, v] of map.entries()) {
    if (v > value) { key = k; value = v; }
  }
  return { key, value };
}

router.get('/api/hub/skills/usage', (req: Request, res: Response) => {
  try {
    const range = String(req.query.range || 'week');
    const since = rangeStart(range);

    // skill_read counts + lastUsed
    const counts = new Map<string, number>();
    const lastUsedMs = new Map<string, number>();
    for (const line of readAuditLines()) {
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.toolName !== 'skill_read') continue;
      const t = Date.parse(e.timestamp || '');
      if (!isFinite(t)) continue;
      const args = e.toolArgs || {};
      const id = String(args.id || args.skill_id || args.name || '').trim();
      if (!id) continue;

      // lastUsed is global (across all time), count is range-bound
      const prev = lastUsedMs.get(id) || 0;
      if (t > prev) lastUsedMs.set(id, t);

      if (t >= since) counts.set(id, (counts.get(id) || 0) + 1);
    }

    if (_sm && (req.query.refresh === '1' || req.query.refresh === 'true')) _sm.scanSkills();
    const all = _sm ? _sm.getAll() : [];
    const skills = all.map(s => {
      // Latest mtime across the whole skill folder so editing any resource
      // (not just SKILL.md) is reflected in "last modified".
      let lastModified: string | null = null;
      try {
        if (s.rootDir && fs.existsSync(s.rootDir)) {
          const m = latestMtimeInDir(s.rootDir);
          if (m) lastModified = m.toISOString();
        } else if (s.filePath && fs.existsSync(s.filePath)) {
          lastModified = fs.statSync(s.filePath).mtime.toISOString();
        }
      } catch { /* noop */ }
      const lastMs = lastUsedMs.get(s.id) || 0;
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        status: s.status,
        lifecycle: s.lifecycle,
        ownership: s.ownership,
        manifestSource: s.manifestSource,
        safety: s.safety,
        eligibility: s.eligibility,
        assignment: s.assignment,
        toolBinding: s.toolBinding,
        recentChanges: _sm.listChangeLedger(s.id, 3),
        count: counts.get(s.id) || 0,
        lastUsed: lastMs ? new Date(lastMs).toISOString() : null,
        lastModified,
      };
    });

    // Sort: count desc, then name asc
    skills.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));

    res.json({ success: true, range, skills });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/skills/review', (_req: Request, res: Response) => {
  try {
    const workspacePath = getConfig().getWorkspacePath();
    const suggestions = listSkillCuratorSuggestions(workspacePath);
    res.json({
      success: true,
      suggestions,
      pending: suggestions.filter((s) => s.status === 'pending').length,
      quarantined: suggestions.filter((s) => s.status === 'quarantined').length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/api/hub/skills/review/run', (req: Request, res: Response) => {
  try {
    if (!_sm) { res.status(500).json({ success: false, error: 'skills manager not initialized' }); return; }
    const rawMode = String(req.body?.mode || 'pending').trim();
    const mode: SkillCuratorMode = rawMode === 'dry-run' || rawMode === 'auto-safe' ? rawMode : 'pending';
    const result = runSkillCurator({
      workspacePath: getConfig().getWorkspacePath(),
      skillsManager: _sm,
      mode,
    });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/api/hub/skills/review/:id/apply', (req: Request, res: Response) => {
  try {
    if (!_sm) { res.status(500).json({ success: false, error: 'skills manager not initialized' }); return; }
    const suggestion = applySkillCuratorSuggestion(getConfig().getWorkspacePath(), _sm, req.params.id);
    if (!suggestion) { res.status(404).json({ success: false, error: 'Suggestion not found' }); return; }
    res.json({ success: true, suggestion });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/api/hub/skills/review/:id/reject', (req: Request, res: Response) => {
  try {
    const suggestion = rejectSkillCuratorSuggestion(getConfig().getWorkspacePath(), req.params.id);
    if (!suggestion) { res.status(404).json({ success: false, error: 'Suggestion not found' }); return; }
    res.json({ success: true, suggestion });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/tools/overview', (req: Request, res: Response) => {
  try {
    const rawEvents: any[] = [];
    for (const line of readAuditLines()) {
      try {
        const e = JSON.parse(line);
        if (e?.actionType === 'tool_call') rawEvents.push(e);
      } catch { /* skip malformed */ }
    }

    const window = rangeWindow(String(req.query.range || 'all'), rawEvents.map((e) => e.timestamp));
    const inRange = rawEvents.filter((e) => {
      const t = Date.parse(e.timestamp || '');
      return Number.isFinite(t) && t >= window.sinceMs && t < window.untilMs;
    });

    const dayCounts: Record<string, number> = {};
    const heatmapCounts: Record<string, number> = {};
    const sessions = new Set<string>();
    const tools = new Map<string, number>();
    const hours = new Map<number, number>();
    let readCalls = 0;
    let writeCalls = 0;
    let failedCalls = 0;

    for (const e of inRange) {
      const key = localDateKey(e.timestamp);
      if (!key) continue;
      dayCounts[key] = (dayCounts[key] || 0) + 1;
      const t = Date.parse(e.timestamp || '');
      if (t >= window.heatmapStartMs) heatmapCounts[key] = (heatmapCounts[key] || 0) + 1;
      const sessionId = String(e.sessionId || '').trim();
      if (sessionId && sessionId !== 'unknown') sessions.add(sessionId);
      const toolName = String(e.toolName || 'unknown').trim() || 'unknown';
      tools.set(toolName, (tools.get(toolName) || 0) + 1);
      const hour = localHourKey(e.timestamp);
      if (hour >= 0) hours.set(hour, (hours.get(hour) || 0) + 1);
      if (e.error) failedCalls++;
      if (e.policyTier === 'read') readCalls++; else writeCalls++;
    }

    const topTool = topEntry(tools);
    const peakHour = topEntry(hours);
    const streaks = streaksFromCounts(dayCounts);
    const activeDays = Object.values(dayCounts).filter((count) => count > 0).length;
    const total = inRange.length;
    const daily = buildDailySeries(window.heatmapStartMs, window.untilMs, heatmapCounts);
    const topTools = [...tools.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    res.json({
      success: true,
      range: window.range,
      stats: {
        sessions: sessions.size,
        messages: total,
        total,
        activeDays,
        currentStreak: streaks.current,
        longestStreak: streaks.longest,
        peakHour: peakHour.value > 0 ? formatHour(Number(peakHour.key)) : '—',
        favorite: topTool.key || '—',
        readCalls,
        writeCalls,
        failedCalls,
      },
      daily,
      topTools,
      summary: total > 0
        ? `You've used ${total.toLocaleString()} tool call${total === 1 ? '' : 's'} across ${activeDays.toLocaleString()} active day${activeDays === 1 ? '' : 's'}.`
        : 'No tool calls recorded for this range yet.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/models/overview', (req: Request, res: Response) => {
  try {
    const rawEvents = readModelUsageEvents();
    const window = rangeWindow(String(req.query.range || 'all'), rawEvents.map((e) => e.timestamp));
    const inRange = rawEvents.filter((e) => {
      const t = Date.parse(e.timestamp || '');
      return Number.isFinite(t) && t >= window.sinceMs && t < window.untilMs;
    });

    const dayTokens: Record<string, number> = {};
    const heatmapTokens: Record<string, number> = {};
    const sessions = new Set<string>();
    const models = new Map<string, number>();
    const providers = new Map<string, number>();
    const hours = new Map<number, number>();
    const byDayModel = new Map<string, number>();
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cacheTokens = 0;

    for (const e of inRange) {
      const totalTokens = Number(e.totalTokens || 0);
      const key = localDateKey(e.timestamp);
      if (!key) continue;
      dayTokens[key] = (dayTokens[key] || 0) + totalTokens;
      const t = Date.parse(e.timestamp || '');
      if (t >= window.heatmapStartMs) heatmapTokens[key] = (heatmapTokens[key] || 0) + totalTokens;
      const sessionId = String(e.sessionId || '').trim();
      if (sessionId && sessionId !== 'unknown') sessions.add(sessionId);
      const provider = String(e.provider || 'unknown');
      const model = String(e.model || 'unknown');
      providers.set(provider, (providers.get(provider) || 0) + totalTokens);
      models.set(model, (models.get(model) || 0) + totalTokens);
      byDayModel.set(`${key}|${provider}|${model}`, (byDayModel.get(`${key}|${provider}|${model}`) || 0) + totalTokens);
      const hour = localHourKey(e.timestamp);
      if (hour >= 0) hours.set(hour, (hours.get(hour) || 0) + 1);
      inputTokens += Number(e.inputTokens || 0);
      outputTokens += Number(e.outputTokens || 0);
      reasoningTokens += Number(e.reasoningTokens || 0);
      cacheTokens += Number(e.cacheReadTokens || 0) + Number(e.cacheWriteTokens || 0);
    }

    const totalTokens = inputTokens + outputTokens + reasoningTokens + cacheTokens;
    const favoriteModel = topEntry(models);
    const peakHour = topEntry(hours);
    const streaks = streaksFromCounts(dayTokens);
    const activeDays = Object.values(dayTokens).filter((count) => count > 0).length;
    const daily = buildDailySeries(window.heatmapStartMs, window.untilMs, heatmapTokens);
    const topModels = [...models.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, tokens]) => ({ name, tokens }));
    const topProviders = [...providers.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([name, tokens]) => ({ name, tokens }));
    const dailyModels = [...byDayModel.entries()]
      .map(([compound, tokens]) => {
        const [date, provider, model] = compound.split('|');
        return { date, provider, model, tokens };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.tokens - a.tokens)
      .slice(0, 40);

    res.json({
      success: true,
      range: window.range,
      stats: {
        sessions: sessions.size,
        messages: inRange.length,
        total: totalTokens,
        totalTokens,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheTokens,
        activeDays,
        currentStreak: streaks.current,
        longestStreak: streaks.longest,
        peakHour: peakHour.value > 0 ? formatHour(Number(peakHour.key)) : '—',
        favorite: favoriteModel.key || '—',
      },
      daily,
      topModels,
      topProviders,
      dailyModels,
      summary: totalTokens > 0
        ? `You've used ${totalTokens.toLocaleString()} token${totalTokens === 1 ? '' : 's'} across ${inRange.length.toLocaleString()} model call${inRange.length === 1 ? '' : 's'}.`
        : 'No model usage recorded yet. New model calls will start filling this tracker.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/tools/heatmap', (req: Request, res: Response) => {
  try {
    const now = new Date();
    const year = parseInt(String(req.query.year || now.getFullYear()), 10);
    const month = parseInt(String(req.query.month || (now.getMonth() + 1)), 10); // 1-12

    const start = new Date(year, month - 1, 1).getTime();
    const end = new Date(year, month, 1).getTime();

    const buckets: Record<string, number> = {};
    for (const line of readAuditLines()) {
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.actionType !== 'tool_call') continue;
      const t = Date.parse(e.timestamp || '');
      if (!isFinite(t) || t < start || t >= end) continue;
      const key = localDateKey(e.timestamp);
      if (!key) continue;
      buckets[key] = (buckets[key] || 0) + 1;
    }

    res.json({ success: true, year, month, counts: buckets });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/skills/:id/content', (req: Request, res: Response) => {
  try {
    if (!_sm) { res.status(500).json({ success: false, error: 'skills manager not initialized' }); return; }
    const skill = _sm.get(req.params.id);
    if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
    let content = '';
    try {
      if (skill.filePath && fs.existsSync(skill.filePath)) {
        content = fs.readFileSync(skill.filePath, 'utf-8');
      }
    } catch { /* noop */ }
    res.json({
      success: true,
      skill: {
        id: skill.id,
        name: skill.name,
        version: skill.version,
        description: skill.description,
        status: skill.status,
        lifecycle: skill.lifecycle,
        ownership: skill.ownership,
        manifestSource: skill.manifestSource,
        safety: skill.safety,
        eligibility: skill.eligibility,
        assignment: skill.assignment,
        toolBinding: skill.toolBinding,
        recentChanges: _sm.listChangeLedger(skill.id, 12),
        filePath: skill.filePath,
        content,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/goals', (_req: Request, res: Response) => {
  try {
    const goals = getAllMainChatGoalRecords();
    const counts = goals.reduce((acc: Record<string, number>, goal: any) => {
      const key = String(goal.status || 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    res.json({ success: true, goals, counts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/achievements', (_req: Request, res: Response) => {
  try {
    const goals = getAllMainChatGoalRecords();
    res.json({ success: true, achievements: [], goals });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});
