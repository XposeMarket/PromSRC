/**
 * chatgpt-sandbox-files.ts
 *
 * Files ChatGPT's own python tool writes live in its cloud sandbox
 * (/mnt/data) and are only reachable through chatgpt.com. The adapter
 * downloads the ones an answer links to and stores them here, inside the
 * Prometheus workspace, so the user actually gets the deliverable.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';

export const CHATGPT_FILES_DIR = 'chatgpt-files';

/**
 * Most recent saved copy of `fileName` under chatgpt-files/ written within
 * `maxAgeMs`. Returns the workspace-relative path or null.
 */
export function findRecentChatGPTSandboxFile(fileName: string, maxAgeMs = 30 * 60_000, workspaceRoot?: string): string | null {
  const name = String(fileName || '').trim();
  if (!name || /[\\/]/.test(name)) return null;
  const root = workspaceRoot || getConfig().getWorkspacePath();
  const base = path.join(root, CHATGPT_FILES_DIR);
  let best: { rel: string; mtime: number } | null = null;
  let folders: string[] = [];
  try { folders = fs.readdirSync(base); } catch { return null; }
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (const folder of folders) {
    let files: string[] = [];
    try { files = fs.readdirSync(path.join(base, folder)); } catch { continue; }
    for (const file of files) {
      if (file !== name && !(file.startsWith(`${stem}-`) && file.endsWith(ext))) continue;
      try {
        const st = fs.statSync(path.join(base, folder, file));
        if (!st.isFile() || Date.now() - st.mtimeMs > maxAgeMs) continue;
        if (!best || st.mtimeMs > best.mtime) best = { rel: [CHATGPT_FILES_DIR, folder, file].join('/'), mtime: st.mtimeMs };
      } catch { /* skip */ }
    }
  }
  return best ? best.rel : null;
}

function safeSegment(value: string, fallback: string): string {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Save into <workspace>/chatgpt-files/<conversation-prefix>/<name>. Never
 * overwrites: a clash gets a numeric suffix. Returns the workspace-relative
 * path with forward slashes.
 */
export async function saveChatGPTSandboxFile(conversationId: string, fileName: string, data: Buffer, workspaceRoot?: string): Promise<string> {
  const root = workspaceRoot || getConfig().getWorkspacePath();
  const folder = safeSegment(String(conversationId || '').slice(0, 8), 'chat');
  const dir = path.join(root, CHATGPT_FILES_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = safeSegment(fileName, 'file');
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length) || 'file';
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base}-${i}${ext}`;
  const full = path.join(dir, candidate);
  if (!full.startsWith(dir)) throw new Error('Refusing to write outside the chatgpt-files folder.');
  await fs.promises.writeFile(full, data);
  return path.relative(root, full).split(path.sep).join('/');
}
