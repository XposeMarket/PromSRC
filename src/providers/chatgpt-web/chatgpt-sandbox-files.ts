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
