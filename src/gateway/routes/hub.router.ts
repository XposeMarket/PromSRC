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

    if (_sm) _sm.scanSkills();
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
        emoji: s.emoji,
        description: s.description,
        version: s.version,
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
        emoji: skill.emoji,
        version: skill.version,
        description: skill.description,
        filePath: skill.filePath,
        content,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/api/hub/achievements', (_req: Request, res: Response) => {
  // Server-side achievements stub — definitions live in the UI for now.
  res.json({ success: true, achievements: [] });
});
