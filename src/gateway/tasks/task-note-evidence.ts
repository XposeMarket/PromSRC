import fs from 'node:fs/promises';
import path from 'node:path';
import { parseNotes } from '../memory/intraday-notes';

interface Run { id: string; sessionId?: string; createdAt?: number; startedAt?: number; completedAt?: number; updatedAt?: number; status?: string }
/** Read-only projection of existing notes. Never guess ownership from a thread/title. */
export async function readTaskNoteEvidence(directory: string, run: Run, siblings: Run[] = [], now = Date.now()) {
  const start = Number(run.startedAt || run.createdAt);
  const terminal = /^(complete|completed|done|failed|cancelled|interrupted)$/.test(run.status || '');
  const end = terminal ? Number(run.completedAt || run.updatedAt) : now;
  if (!run.sessionId || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const matchesSession = (source: string) => source.replace(/^_Source:\s*/, '').replace(/_$/, '').split(';').some(part => part.trim() === `session: ${run.sessionId}`);
  const entries: any[] = [];
  let names: string[];
  try { names = await fs.readdir(directory); } catch { return []; }
  const firstDay = new Date(start).toISOString().slice(0, 10), lastDay = new Date(end).toISOString().slice(0, 10);
  for (const name of names.filter(n => /^\d{4}-\d{2}-\d{2}-intraday-notes\.md$/.test(n) && n.slice(0, 10) >= firstDay && n.slice(0, 10) <= lastDay).sort()) {
    try {
      const filename = path.join(directory, name);
      if ((await fs.stat(filename)).size > 8 * 1024 * 1024) continue;
      for (const note of parseNotes(await fs.readFile(filename, 'utf8'))) {
        const t = Date.parse(note.timestamp);
        if (!matchesSession(note.source) || t < start || t > end || !Number.isFinite(t)) continue;
        // Legacy metadata has session, not runtime identity. Overlapping runs are ambiguous.
        if (siblings.some(other => other.id !== run.id && other.sessionId === run.sessionId && t >= Number(other.startedAt || other.createdAt) && t <= Number(other.completedAt || (/^(complete|completed|done|failed|cancelled|interrupted)$/.test(other.status || '') ? other.updatedAt : now)))) continue;
        entries.push({ id: note.id || `${name}:${t}`, category: 'note', title: 'Run note', t, content: note.body, value: note.body });
      }
    } catch { /* Missing/unreadable notes do not break Tasks. */ }
  }
  return entries.sort((a, b) => a.t - b.t);
}

/** Task journals already retain write_note content with exact task ownership. */
export function taskJournalNoteEvidence(task: { journal?: any[] }) {
  return (task.journal || []).filter(entry => entry.type === 'write_note').map((entry, i) => ({ id: 'journal-note:' + i, category: 'note', title: 'Run note', t: entry.t || entry.timestamp, content: String(entry.detail || entry.content || ''), value: String(entry.detail || entry.content || '') }));
}
