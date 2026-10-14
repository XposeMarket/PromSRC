import fs from 'fs';
import path from 'path';
import { getSessionStorageDirectory } from '../session';
import { scrubContextText } from '../../runtime/context-receipt';
import { sha } from '../learning/turn-recorder';
import type { RoutingOriginal } from './skill-curator';

/** Resolve real requests from authoritative local history, never caller-provided text. */
export function resolveRoutingOriginal(sessionId: string, requestHash: string): RoutingOriginal | null {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) return null;
  try {
    const file = path.join(getSessionStorageDirectory(), `${sessionId}.json`);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) return null;
    const history = JSON.parse(fs.readFileSync(file, 'utf8')).history;
    if (!Array.isArray(history)) return null;
    const text = (row: any): string => typeof row.content === 'string' ? row.content : Array.isArray(row.content) ? row.content.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('\n') : '';
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]?.role !== 'user') continue;
      const request = text(history[i]);
      if (sha(request.trim()) !== requestHash) continue;
      return { request, contextHash: sha(JSON.stringify(history.slice(0, i + 1))), context: JSON.stringify(history.slice(0, i + 1).filter((row: any) => ['user', 'assistant'].includes(row?.role)).map((row: any) => ({ role: row.role, content: scrubContextText(text(row)) }))) };
    }
  } catch {}
  return null;
}
