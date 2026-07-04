/**
 * hub.router.ts — Hub page (usage tracker)
 *
 * Endpoints:
 *   GET /api/hub/skills/usage?range=day|week|month
 *   GET /api/hub/tokens/activity                    (daily token activity from first detected use)
 *   GET /api/hub/tools/heatmap?year=YYYY&month=MM   (legacy monthly tool calls)
 *   GET /api/hub/skills/:id/content                 (read-only SKILL.md content)
 *   GET /api/hub/achievements                       (stub, returns [])
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { SkillsManager } from '../skills-runtime/skills-manager';
import { getConfig } from '../../config/config.js';
import { readModelUsageEvents } from '../../providers/model-usage.js';
import { estimateModelUsageCost, resolveModelPricing } from '../../providers/model-pricing.js';
import { readAllToolObservations } from '../tool-observations';
import { getAllMainChatGoalRecords } from '../main-chat-goals';
import { listSessionSummaries, type SessionSummary } from '../session';
import {
  applySkillCuratorSuggestion,
  listSkillCuratorActivity,
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

let _auditCachePath = '';
let _auditCacheMtimeMs = 0;
let _auditCacheSize = 0;
let _auditCacheLines: string[] = [];

function readAuditLinesCached(): string[] {
  const p = getAuditLogPath();
  let st: fs.Stats;
  try { st = fs.statSync(p); } catch { return []; }
  if (
    p === _auditCachePath
    && st.mtimeMs === _auditCacheMtimeMs
    && st.size === _auditCacheSize
  ) {
    return _auditCacheLines;
  }
  const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.trim());
  _auditCachePath = p;
  _auditCacheMtimeMs = st.mtimeMs;
  _auditCacheSize = st.size;
  _auditCacheLines = lines;
  return lines;
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

type HubStatsRange = 'all' | '30d' | '7d' | '1d';

function normalizeHubStatsRange(rawRange: string): HubStatsRange {
  const value = String(rawRange || '').trim().toLowerCase();
  if (value === 'all') return 'all';
  if (value === '30d' || value === 'month') return '30d';
  if (value === '7d' || value === 'week') return '7d';
  if (value === '1d' || value === 'day' || value === '24h') return '1d';
  return 'all';
}

function rangeWindow(rawRange: string, timestamps: string[]): { range: HubStatsRange; sinceMs: number; heatmapStartMs: number; untilMs: number } {
  const range = normalizeHubStatsRange(rawRange);
  const today = dayStart(new Date());
  const untilMs = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const earliestMs = timestamps
    .map((ts) => Date.parse(ts || ''))
    .filter((t) => Number.isFinite(t))
    .reduce((min, t) => Math.min(min, t), untilMs);
  if (range === '1d') {
    return { range, sinceMs: today.getTime(), heatmapStartMs: today.getTime(), untilMs };
  }
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

function normalizeCostMicros(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function modelUsageCost(event: any) {
  const estimated = estimateModelUsageCost({
    provider: event?.provider,
    model: event?.model,
    inputTokens: event?.inputTokens,
    outputTokens: event?.outputTokens,
    reasoningTokens: event?.reasoningTokens,
    cacheReadTokens: event?.cacheReadTokens,
    cacheWriteTokens: event?.cacheWriteTokens,
  });
  return {
    inputCostMicros: normalizeCostMicros(event?.inputCostMicros ?? estimated.inputCostMicros),
    outputCostMicros: normalizeCostMicros(event?.outputCostMicros ?? estimated.outputCostMicros),
    reasoningCostMicros: normalizeCostMicros(event?.reasoningCostMicros ?? estimated.reasoningCostMicros),
    cacheReadCostMicros: normalizeCostMicros(event?.cacheReadCostMicros ?? estimated.cacheReadCostMicros),
    cacheWriteCostMicros: normalizeCostMicros(event?.cacheWriteCostMicros ?? estimated.cacheWriteCostMicros),
    totalCostMicros: normalizeCostMicros(event?.totalCostMicros ?? estimated.totalCostMicros),
    pricingSource: event?.pricingSource || estimated.pricingSource,
    pricingVersion: event?.pricingVersion || estimated.pricingVersion,
  };
}

function formatUsdFromMicros(value: unknown): string {
  const micros = normalizeCostMicros(value);
  const usd = micros / 1_000_000;
  if (usd <= 0) return '$0';
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(5)}`;
}

function primaryPricingContext(): { provider: string; model: string } {
  try {
    const cfg = getConfig().getConfig() as any;
    const provider = String(cfg?.llm?.provider || '').trim() || 'unknown';
    const model = String(cfg?.llm?.providers?.[provider]?.model || cfg?.models?.primary || '').trim() || 'unknown';
    return { provider, model };
  } catch {
    return { provider: 'unknown', model: 'unknown' };
  }
}

function contextMicrosPerTokenFromModelEvents(events: any[]): number {
  let inputCostMicros = 0;
  let inputishTokens = 0;
  for (const event of events) {
    const cost = modelUsageCost(event);
    const tokens = Math.max(
      0,
      Number(event?.estimatedProviderInputTokens || 0)
      || Number(event?.inputTokens || 0)
      || Number(event?.estimatedMessageInputTokens || 0),
    );
    if (tokens <= 0) continue;
    inputCostMicros += cost.inputCostMicros + cost.cacheReadCostMicros + cost.cacheWriteCostMicros;
    inputishTokens += tokens;
  }
  if (inputishTokens > 0) return inputCostMicros / inputishTokens;
  const primary = primaryPricingContext();
  return resolveModelPricing(primary.provider, primary.model).inputMicrosPerToken;
}

function isUserChatSessionSummary(summary: SessionSummary): boolean {
  const id = String(summary.id || '').trim();
  if (!id) return false;
  if (summary.channel === 'system') return false;
  if (/^(auto_|task_|cron_|brain_|subagent_|subagent-chat_|team_|proposal_|dispatch_)/i.test(id)) return false;
  return true;
}

function getChatSessionStats(): { sessions: number; messages: number } {
  const summaries = listSessionSummaries().filter(isUserChatSessionSummary);
  return {
    sessions: summaries.length,
    messages: summaries.reduce((sum, summary) => sum + (Number(summary.messageCount) || 0), 0),
  };
}

function sessionSummaryTimestamp(summary: any): string {
  const candidates = [
    summary?.createdAt,
    summary?.updatedAt,
    summary?.lastMessageAt,
    summary?.lastActivityAt,
    summary?.timestamp,
    summary?.mtime,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
    const text = String(value || '').trim();
    if (text && Number.isFinite(Date.parse(text))) return text;
  }
  return '';
}

function addTokenBucket(buckets: Record<string, number>, timestamp: string, tokens: number): void {
  const key = localDateKey(timestamp);
  const n = Math.max(0, Number(tokens || 0));
  if (!key || n <= 0) return;
  buckets[key] = (buckets[key] || 0) + n;
}

router.get('/api/hub/tokens/activity', (_req: Request, res: Response) => {
  try {
    const modelEvents = readModelUsageEvents();
    const observations = readAllToolObservations(100_000);
    const auditTimestamps: string[] = [];
    for (const line of readAuditLinesCached()) {
      try {
        const e = JSON.parse(line);
        if (e?.timestamp) auditTimestamps.push(String(e.timestamp));
      } catch { /* skip malformed */ }
    }
    const sessionTimestamps = listSessionSummaries()
      .filter(isUserChatSessionSummary)
      .map((summary: any) => sessionSummaryTimestamp(summary))
      .filter(Boolean);

    const allTimestamps = [
      ...modelEvents.map((e) => String(e.timestamp || '')),
      ...observations.map((obs) => Number(obs.createdAt || 0) > 0 ? new Date(Number(obs.createdAt)).toISOString() : ''),
      ...auditTimestamps,
      ...sessionTimestamps,
    ].filter(Boolean);
    const window = rangeWindow('all', allTimestamps);
    const buckets: Record<string, number> = {};
    let modelTokens = 0;
    let toolContextTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cacheTokens = 0;

    for (const e of modelEvents) {
      const t = Date.parse(e.timestamp || '');
      if (!Number.isFinite(t) || t < window.sinceMs || t >= window.untilMs) continue;
      const total = Math.max(0, Number(e.totalTokens || 0));
      modelTokens += total;
      inputTokens += Math.max(0, Number(e.inputTokens || 0));
      outputTokens += Math.max(0, Number(e.outputTokens || 0));
      reasoningTokens += Math.max(0, Number(e.reasoningTokens || 0));
      cacheTokens += Math.max(0, Number(e.cacheReadTokens || 0)) + Math.max(0, Number(e.cacheWriteTokens || 0));
      addTokenBucket(buckets, e.timestamp, total);
    }

    for (const obs of observations) {
      const t = Number(obs.createdAt || 0);
      if (!Number.isFinite(t) || t < window.sinceMs || t >= window.untilMs) continue;
      const estimate = (obs?.tokenEstimate || {}) as any;
      const tokens = Math.max(0, Number(estimate.totalTokens || 0))
        || Math.max(0, Number(estimate.argsTokens || 0)) + Math.max(0, Number(estimate.resultTokens || 0));
      toolContextTokens += tokens;
      addTokenBucket(buckets, new Date(t).toISOString(), tokens);
    }

    const daily = buildDailySeries(window.sinceMs, window.untilMs, buckets).map((row) => ({
      date: row.date,
      tokens: row.count,
      count: row.count,
    }));
    const stats = {
      firstDate: daily[0]?.date || dateKeyFromDate(new Date()),
      lastDate: daily[daily.length - 1]?.date || dateKeyFromDate(new Date()),
      totalTokens: modelTokens + toolContextTokens,
      modelTokens,
      toolContextTokens,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheTokens,
      activeDays: daily.filter((row) => row.tokens > 0).length,
      days: daily.length,
      peakTokens: daily.reduce((max, row) => Math.max(max, row.tokens), 0),
      ...streaksFromCounts(buckets),
    };
    res.json({ success: true, daily, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/skills/usage', (req: Request, res: Response) => {
  try {
    const range = String(req.query.range || 'week');
    const since = rangeStart(range);

    // skill_read counts + lastUsed
    const counts = new Map<string, number>();
    const lastUsedMs = new Map<string, number>();
    for (const line of readAuditLinesCached()) {
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
    const recentChangesBySkill = new Map<string, any[]>();
    if (_sm) {
      for (const entry of _sm.listChangeLedger(undefined, 500)) {
        const id = String(entry.skillId || '').trim();
        if (!id) continue;
        const bucket = recentChangesBySkill.get(id) || [];
        if (bucket.length < 3) {
          bucket.push(entry);
          recentChangesBySkill.set(id, bucket);
        }
      }
    }
    const skills = all.map(s => {
      let lastModified: string | null = null;
      try {
        if (s.filePath && fs.existsSync(s.filePath)) {
          lastModified = fs.statSync(s.filePath).mtime.toISOString();
        } else if (s.rootDir && fs.existsSync(s.rootDir)) {
          lastModified = fs.statSync(s.rootDir).mtime.toISOString();
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
        recentChanges: recentChangesBySkill.get(s.id) || [],
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
    const activity = _sm ? listSkillCuratorActivity(workspacePath, _sm, { days: 14, limit: 180 }) : [];
    res.json({
      success: true,
      suggestions,
      activity,
      pending: suggestions.filter((s) => s.status === 'pending').length,
      quarantined: suggestions.filter((s) => s.status === 'quarantined').length,
      appliedActivity: activity.filter((item) => item.status === 'applied').length,
      observedActivity: activity.filter((item) => item.status === 'observed').length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/api/hub/skills/review/run', (req: Request, res: Response) => {
  try {
    if (!_sm) { res.status(500).json({ success: false, error: 'skills manager not initialized' }); return; }
    const rawMode = String(req.body?.mode || 'auto-safe').trim();
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
    const chatStats = getChatSessionStats();
    const rawEvents: any[] = [];
    for (const line of readAuditLinesCached()) {
      try {
        const e = JSON.parse(line);
        if (e?.actionType === 'tool_call') rawEvents.push(e);
      } catch { /* skip malformed */ }
    }

    const observations = readAllToolObservations(100_000);
    const observationTimestamps = observations
      .map((obs) => Number(obs.createdAt || 0))
      .filter((t) => Number.isFinite(t) && t > 0)
      .map((t) => new Date(t).toISOString());
    const window = rangeWindow(String(req.query.range || 'all'), rawEvents.map((e) => e.timestamp).concat(observationTimestamps));
    const inRange = rawEvents.filter((e) => {
      const t = Date.parse(e.timestamp || '');
      return Number.isFinite(t) && t >= window.sinceMs && t < window.untilMs;
    });
    const inRangeObservations = observations.filter((obs) => {
      const t = Number(obs.createdAt || 0);
      return Number.isFinite(t) && t >= window.sinceMs && t < window.untilMs;
    });
    const modelEventsInRange = readModelUsageEvents().filter((e) => {
      const t = Date.parse(e.timestamp || '');
      return Number.isFinite(t) && t >= window.sinceMs && t < window.untilMs;
    });
    const contextMicrosPerToken = contextMicrosPerTokenFromModelEvents(modelEventsInRange);

    const dayCounts: Record<string, number> = {};
    const heatmapCounts: Record<string, number> = {};
    const sessions = new Set<string>();
    const tools = new Map<string, any>();
    const hours = new Map<number, number>();
    let readCalls = 0;
    let writeCalls = 0;
    let failedCalls = 0;
    let observedErrorCalls = 0;
    let argsTokens = 0;
    let resultTokens = 0;
    let contextTokens = 0;
    let resultBytes = 0;
    let durationMsTotal = 0;
    let durationMsMax = 0;
    let durationCallCount = 0;
    let contextCostMicros = 0;
    let directCostMicros = 0;

    for (const e of inRange) {
      const key = localDateKey(e.timestamp);
      if (!key) continue;
      dayCounts[key] = (dayCounts[key] || 0) + 1;
      const t = Date.parse(e.timestamp || '');
      if (t >= window.heatmapStartMs) heatmapCounts[key] = (heatmapCounts[key] || 0) + 1;
      const sessionId = String(e.sessionId || '').trim();
      if (sessionId && sessionId !== 'unknown') sessions.add(sessionId);
      const toolName = String(e.toolName || 'unknown').trim() || 'unknown';
      const row = tools.get(toolName) || {
        name: toolName,
        count: 0,
        observedCalls: 0,
        argsTokens: 0,
        resultTokens: 0,
        contextTokens: 0,
        resultBytes: 0,
        durationMsTotal: 0,
        durationMsMax: 0,
        durationCallCount: 0,
        contextCostMicros: 0,
        directCostMicros: 0,
        totalCostMicros: 0,
        errorCount: 0,
      };
      row.count += 1;
      if (e.error) row.errorCount += 1;
      tools.set(toolName, row);
      const hour = localHourKey(e.timestamp);
      if (hour >= 0) hours.set(hour, (hours.get(hour) || 0) + 1);
      if (e.error) failedCalls++;
      if (e.policyTier === 'read') readCalls++; else writeCalls++;
    }

    for (const obs of inRangeObservations) {
      const toolName = String(obs?.toolName || 'unknown').trim() || 'unknown';
      const row = tools.get(toolName) || {
        name: toolName,
        count: 0,
        observedCalls: 0,
        argsTokens: 0,
        resultTokens: 0,
        contextTokens: 0,
        resultBytes: 0,
        durationMsTotal: 0,
        durationMsMax: 0,
        durationCallCount: 0,
        contextCostMicros: 0,
        directCostMicros: 0,
        totalCostMicros: 0,
        errorCount: 0,
      };
      const estimate = (obs?.tokenEstimate || {}) as any;
      const obsArgsTokens = Math.max(0, Number(estimate.argsTokens || 0));
      const obsResultTokens = Math.max(0, Number(estimate.resultTokens || 0));
      const obsContextTokens = Math.max(0, Number(estimate.totalTokens || obsArgsTokens + obsResultTokens));
      const obsBytes = Math.max(0, Number(estimate.resultBytes || 0));
      const obsDuration = Number(obs?.durationMs || 0);
      const obsContextCost = normalizeCostMicros(estimate.contextCostMicros)
        || normalizeCostMicros(Math.round(obsContextTokens * contextMicrosPerToken));
      const obsDirectCost = normalizeCostMicros(estimate.directCostMicros);
      row.observedCalls += 1;
      row.count = Math.max(row.count, row.observedCalls);
      row.argsTokens += obsArgsTokens;
      row.resultTokens += obsResultTokens;
      row.contextTokens += obsContextTokens;
      row.resultBytes += obsBytes;
      row.contextCostMicros += obsContextCost;
      row.directCostMicros += obsDirectCost;
      row.totalCostMicros += obsContextCost + obsDirectCost;
      if (Number.isFinite(obsDuration) && obsDuration > 0) {
        const duration = Math.round(obsDuration);
        row.durationMsTotal += duration;
        row.durationMsMax = Math.max(row.durationMsMax, duration);
        row.durationCallCount += 1;
        durationMsTotal += duration;
        durationMsMax = Math.max(durationMsMax, duration);
        durationCallCount += 1;
      }
      if (obs.status === 'error') {
        row.errorCount += row.count > row.observedCalls ? 0 : 1;
        observedErrorCalls += 1;
      }
      argsTokens += obsArgsTokens;
      resultTokens += obsResultTokens;
      contextTokens += obsContextTokens;
      resultBytes += obsBytes;
      contextCostMicros += obsContextCost;
      directCostMicros += obsDirectCost;
      tools.set(toolName, row);
    }

    const toolCounts = new Map<string, number>();
    for (const [name, row] of tools.entries()) toolCounts.set(name, Number(row.count || 0));
    const topTool = topEntry(toolCounts);
    const peakHour = topEntry(hours);
    const streaks = streaksFromCounts(dayCounts);
    const activeDays = Object.values(dayCounts).filter((count) => count > 0).length;
    const total = Math.max(inRange.length, [...tools.values()].reduce((sum, row) => sum + Number(row.count || 0), 0));
    const daily = buildDailySeries(window.heatmapStartMs, window.untilMs, heatmapCounts);
    const toolRows = [...tools.values()].map((row) => ({
      ...row,
      durationMsAvg: Number(row.durationCallCount || 0) > 0
        ? Math.round(Number(row.durationMsTotal || 0) / Number(row.durationCallCount || 0))
        : 0,
      totalCostMicros: normalizeCostMicros(row.totalCostMicros) || normalizeCostMicros(row.contextCostMicros) + normalizeCostMicros(row.directCostMicros),
    }));
    const topTools = toolRows
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.name).localeCompare(String(b.name)))
      .slice(0, 10)
      .map((row) => ({ ...row }));
    const expensiveTools = [...toolRows]
      .sort((a, b) => Number(b.totalCostMicros || 0) - Number(a.totalCostMicros || 0) || Number(b.contextTokens || 0) - Number(a.contextTokens || 0))
      .slice(0, 10);
    const slowestTools = [...toolRows]
      .filter((row) => Number(row.durationMsMax || 0) > 0)
      .sort((a, b) => Number(b.durationMsMax || 0) - Number(a.durationMsMax || 0) || Number(b.durationMsTotal || 0) - Number(a.durationMsTotal || 0))
      .slice(0, 10);
    const totalCostMicros = contextCostMicros + directCostMicros;

    res.json({
      success: true,
      range: window.range,
      stats: {
        sessions: chatStats.sessions,
        messages: chatStats.messages,
        chatSessions: chatStats.sessions,
        toolSessions: sessions.size,
        toolCalls: total,
        total,
        activeDays,
        currentStreak: streaks.current,
        longestStreak: streaks.longest,
        peakHour: peakHour.value > 0 ? formatHour(Number(peakHour.key)) : '—',
        favorite: topTool.key || '—',
        readCalls,
        writeCalls,
        failedCalls: failedCalls || observedErrorCalls,
        observedToolCalls: inRangeObservations.length,
        argsTokens,
        resultTokens,
        contextTokens,
        resultBytes,
        durationMsTotal,
        durationMsMax,
        durationMsAvg: durationCallCount > 0 ? Math.round(durationMsTotal / durationCallCount) : 0,
        contextCostMicros,
        directCostMicros,
        totalCostMicros,
        contextMicrosPerToken,
      },
      daily,
      topTools,
      expensiveTools,
      slowestTools,
      summary: total > 0
        ? `You've used ${total.toLocaleString()} tool call${total === 1 ? '' : 's'} across ${activeDays.toLocaleString()} active day${activeDays === 1 ? '' : 's'}; observed tool context is ${contextTokens.toLocaleString()} tokens (${formatUsdFromMicros(totalCostMicros)} est.).`
        : 'No tool calls recorded for this range yet.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/models/overview', (req: Request, res: Response) => {
  try {
    const chatStats = getChatSessionStats();
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
    const modelCosts = new Map<string, number>();
    const modelCalls = new Map<string, number>();
    const providers = new Map<string, number>();
    const providerCosts = new Map<string, number>();
    const hours = new Map<number, number>();
    const byDayModel = new Map<string, number>();
    const byDayModelCosts = new Map<string, number>();
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cacheTokens = 0;
    let totalTokens = 0;
    let inputCostMicros = 0;
    let outputCostMicros = 0;
    let reasoningCostMicros = 0;
    let cacheCostMicros = 0;
    let totalCostMicros = 0;

    for (const e of inRange) {
      const eventTotalTokens = Number(e.totalTokens || 0);
      const cost = modelUsageCost(e);
      const eventCacheCostMicros = cost.cacheReadCostMicros + cost.cacheWriteCostMicros;
      const key = localDateKey(e.timestamp);
      if (!key) continue;
      dayTokens[key] = (dayTokens[key] || 0) + eventTotalTokens;
      const t = Date.parse(e.timestamp || '');
      if (t >= window.heatmapStartMs) heatmapTokens[key] = (heatmapTokens[key] || 0) + eventTotalTokens;
      const sessionId = String(e.sessionId || '').trim();
      if (sessionId && sessionId !== 'unknown') sessions.add(sessionId);
      const provider = String(e.provider || 'unknown');
      const model = String(e.model || 'unknown');
      providers.set(provider, (providers.get(provider) || 0) + eventTotalTokens);
      providerCosts.set(provider, (providerCosts.get(provider) || 0) + cost.totalCostMicros);
      models.set(model, (models.get(model) || 0) + eventTotalTokens);
      modelCosts.set(model, (modelCosts.get(model) || 0) + cost.totalCostMicros);
      modelCalls.set(model, (modelCalls.get(model) || 0) + 1);
      const dayModelKey = `${key}|${provider}|${model}`;
      byDayModel.set(dayModelKey, (byDayModel.get(dayModelKey) || 0) + eventTotalTokens);
      byDayModelCosts.set(dayModelKey, (byDayModelCosts.get(dayModelKey) || 0) + cost.totalCostMicros);
      const hour = localHourKey(e.timestamp);
      if (hour >= 0) hours.set(hour, (hours.get(hour) || 0) + 1);
      inputTokens += Number(e.inputTokens || 0);
      outputTokens += Number(e.outputTokens || 0);
      reasoningTokens += Number(e.reasoningTokens || 0);
      cacheTokens += Number(e.cacheReadTokens || 0) + Number(e.cacheWriteTokens || 0);
      totalTokens += eventTotalTokens;
      inputCostMicros += cost.inputCostMicros;
      outputCostMicros += cost.outputCostMicros;
      reasoningCostMicros += cost.reasoningCostMicros;
      cacheCostMicros += eventCacheCostMicros;
      totalCostMicros += cost.totalCostMicros;
    }

    const favoriteModel = topEntry(models);
    const favoriteModelByCalls = topEntry(modelCalls);
    const peakHour = topEntry(hours);
    const streaks = streaksFromCounts(dayTokens);
    const activeDays = Object.values(dayTokens).filter((count) => count > 0).length;
    const daily = buildDailySeries(window.heatmapStartMs, window.untilMs, heatmapTokens);
    const topModels = [...models.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, tokens]) => ({
        name,
        tokens,
        calls: modelCalls.get(name) || 0,
        costMicros: normalizeCostMicros(modelCosts.get(name)),
      }));
    const topProviders = [...providers.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([name, tokens]) => ({ name, tokens, costMicros: normalizeCostMicros(providerCosts.get(name)) }));
    const dailyModels = [...byDayModel.entries()]
      .map(([compound, tokens]) => {
        const [date, provider, model] = compound.split('|');
        return { date, provider, model, tokens, costMicros: normalizeCostMicros(byDayModelCosts.get(compound)) };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.tokens - a.tokens)
      .slice(0, 40);

    res.json({
      success: true,
      range: window.range,
      stats: {
        sessions: sessions.size,
        messages: inRange.length,
        chatSessions: chatStats.sessions,
        chatMessages: chatStats.messages,
        modelSessions: sessions.size,
        modelCalls: inRange.length,
        total: totalTokens,
        totalTokens,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheTokens,
        inputCostMicros,
        outputCostMicros,
        reasoningCostMicros,
        cacheCostMicros,
        totalCostMicros,
        activeDays,
        currentStreak: streaks.current,
        longestStreak: streaks.longest,
        peakHour: peakHour.value > 0 ? formatHour(Number(peakHour.key)) : '—',
        favorite: favoriteModel.key || '—',
        favoriteByTokens: favoriteModel.key || '—',
        favoriteByCalls: favoriteModelByCalls.key || '—',
      },
      daily,
      topModels,
      topProviders,
      dailyModels,
      summary: totalTokens > 0
        ? `You've used ${totalTokens.toLocaleString()} token${totalTokens === 1 ? '' : 's'} across ${inRange.length.toLocaleString()} model call${inRange.length === 1 ? '' : 's'} (${formatUsdFromMicros(totalCostMicros)} est.).`
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
    for (const line of readAuditLinesCached()) {
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
        kind: skill.kind,
        resources: skill.resources,
        recentChanges: _sm.listChangeLedger(skill.id, 12),
        filePath: skill.filePath,
        content,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/skills/:id/resources/content', (req: Request, res: Response) => {
  try {
    if (!_sm) { res.status(500).json({ success: false, error: 'skills manager not initialized' }); return; }
    const relPath = String(req.query.path || '');
    const result = _sm.readResource(req.params.id, relPath, 120_000);
    if (!result.ok) { res.status(400).json({ success: false, error: result.error }); return; }
    res.json({ success: true, resource: result });
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
