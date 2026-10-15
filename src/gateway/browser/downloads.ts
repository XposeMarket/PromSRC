
/**
 * browser-tools.ts - Browser Automation for Prometheus
 *
 * Strategy: use the Electron in-house browser by default in the desktop app.
 * The Prometheus-owned Chrome/CDP lane and the user's Chrome extension remain
 * available as explicit secondary targets.
 * Background agents, tasks, and team agents get isolated persistent profiles
 * and CDP ports derived from their stable owner identity.
 *
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import fs from 'fs';
import path from 'path';

import { browserWorkspaceRoot } from './snapshot-format.js';
import { BrowserDownloadRecord, _lastBrowserDownload } from './state.js';
import { resolveSessionId } from './extraction.js';


export function sanitizeDownloadFilename(input: string): string {
  const base = path.basename(String(input || '').trim() || 'download');
  return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'download';
}

export function ensureBrowserWorkspacePath(targetPath: string): string {
  const workspaceRoot = browserWorkspaceRoot();
  const absPath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(path.join(workspaceRoot, targetPath));
  const rel = path.relative(workspaceRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${targetPath}" is outside workspace.`);
  }
  return absPath;
}

export function ensureBrowserOutputDir(outputDir?: string): { workspaceRoot: string; absDir: string; relDir: string } {
  const workspaceRoot = browserWorkspaceRoot();
  const absDir = ensureBrowserWorkspacePath(outputDir || 'downloads');
  const relDir = path.relative(workspaceRoot, absDir).replace(/\\/g, '/') || '.';
  return { workspaceRoot, absDir, relDir };
}

export function uniqueDownloadPath(absDir: string, filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  const ext = path.extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  let candidate = path.join(absDir, safe);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(absDir, `${stem}_${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

export async function persistBrowserDownload(
  sessionId: string,
  download: any,
  options?: { filename_hint?: string; output_dir?: string },
): Promise<BrowserDownloadRecord> {
  const { workspaceRoot, absDir } = ensureBrowserOutputDir(options?.output_dir);
  fs.mkdirSync(absDir, { recursive: true });
  const suggested = sanitizeDownloadFilename(
    String(options?.filename_hint || download?.suggestedFilename?.() || 'download'),
  );
  const absPath = uniqueDownloadPath(absDir, suggested);
  await download.saveAs(absPath);
  const stat = fs.statSync(absPath);
  const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  const record: BrowserDownloadRecord = {
    savedPath: absPath,
    relPath,
    suggestedFilename: suggested,
    url: String(download?.url?.() || ''),
    sizeBytes: stat.size,
    ts: Date.now(),
  };
  _lastBrowserDownload.set(resolveSessionId(sessionId), record);
  return record;
}

export function toUploadPaths(filePath?: string, filePaths?: string[]): string[] {
  return Array.from(
    new Set(
      [filePath, ...(Array.isArray(filePaths) ? filePaths : [])]
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .map((p) => ensureBrowserWorkspacePath(p)),
    ),
  );
}
