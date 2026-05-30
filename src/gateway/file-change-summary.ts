import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export type TurnFileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export type TurnFileChange = {
  path: string;
  displayPath: string;
  status: TurnFileChangeStatus;
  insertions: number;
  deletions: number;
  oldPath?: string;
  diffPreview?: string;
  binary?: boolean;
};

export type TurnFileChanges = {
  summary: {
    fileCount: number;
    insertions: number;
    deletions: number;
  };
  files: TurnFileChange[];
  generatedAt: number;
};

const FILE_MUTATION_TOOL_NAMES = new Set([
  'create_file',
  'write_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'rename_file',
  'delete_file',
  'copy_file',
  'move_file',
  'apply_patch',
  'write_source',
  'find_replace_source',
  'replace_lines_source',
  'insert_after_source',
  'delete_lines_source',
  'delete_source',
  'write_webui_source',
  'find_replace_webui_source',
  'replace_lines_webui_source',
  'insert_after_webui_source',
  'delete_lines_webui_source',
  'delete_webui_source',
  'write_prom_file',
  'find_replace_prom',
  'replace_lines_prom',
  'insert_after_prom',
  'delete_lines_prom',
  'delete_prom_file',
  'skill_resource_write',
  'skill_resource_delete',
  'prom_apply_dev_changes',
]);

function isTurnFileMutationTool(toolName: string): boolean {
  const name = String(toolName || '').trim();
  if (!name) return false;
  if (FILE_MUTATION_TOOL_NAMES.has(name)) return true;
  if (/^(write|delete|find_replace|replace_lines|insert_after)_/.test(name) && /(source|webui|prom|file)$/.test(name)) return true;
  return false;
}

function normalizeDisplayPath(filePath: string, workspacePath: string): string {
  const value = String(filePath || '').trim();
  if (!value) return '';
  try {
    const abs = path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspacePath, value);
    const rel = path.relative(workspacePath, abs).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
    return abs.replace(/\\/g, '/');
  } catch {
    return value.replace(/\\/g, '/');
  }
}

function resolveTurnFilePath(rawPath: any, workspacePath: string): string {
  const value = String(rawPath || '').trim();
  if (!value || value === '.' || value === '/dev/null') return '';
  try {
    return path.resolve(path.isAbsolute(value) ? value : path.join(workspacePath, value));
  } catch {
    return '';
  }
}

function extractPatchTargetPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const rawLine of String(patchText || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('diff --git ')) {
      const parts = line.split(/\s+/).slice(2, 4).map((part) => part.replace(/^"|"$/g, ''));
      for (let item of parts) {
        if (item.startsWith('a/') || item.startsWith('b/')) item = item.slice(2);
        if (item && item !== '/dev/null') paths.add(item);
      }
    } else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      let item = line.slice(4).trim().replace(/^"|"$/g, '').split(/\s+/)[0] || '';
      if (item.startsWith('a/') || item.startsWith('b/')) item = item.slice(2);
      if (item && item !== '/dev/null') paths.add(item);
    } else if (line.startsWith('rename from ')) {
      paths.add(line.slice('rename from '.length).trim());
    } else if (line.startsWith('rename to ')) {
      paths.add(line.slice('rename to '.length).trim());
    }
  }
  return Array.from(paths);
}

function collectCandidatePathsFromArgs(toolName: string, args: any, workspacePath: string): string[] {
  const candidates: any[] = [];
  const safeArgs = args && typeof args === 'object' ? args : {};
  for (const key of [
    'path', 'file', 'filename', 'name', 'target', 'target_path', 'targetPath',
    'old_path', 'oldPath', 'new_path', 'newPath', 'source', 'destination',
    'files', 'allowedFiles', 'affected_files', 'affectedFiles', 'changed_files', 'changedFiles',
  ]) {
    if (safeArgs[key] != null) candidates.push(safeArgs[key]);
  }
  if (toolName.includes('webui_source')) {
    candidates.push(...candidates.map((item) => {
      const s = String(item || '').trim();
      return s && !/^web-ui[\\/]/i.test(s) ? path.join('web-ui', s) : s;
    }));
  } else if (/_source$/.test(toolName) && !toolName.includes('webui')) {
    candidates.push(...candidates.map((item) => {
      const s = String(item || '').trim();
      return s && !/^src[\\/]/i.test(s) ? path.join('src', s) : s;
    }));
  }
  if (toolName === 'apply_patch' && typeof safeArgs.patch === 'string') {
    candidates.push(...extractPatchTargetPaths(safeArgs.patch));
  }
  return Array.from(new Set(
    candidates
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .map((item) => resolveTurnFilePath(item, workspacePath))
      .filter(Boolean),
  ));
}

export function extractTouchedFilesFromToolResult(result: any, workspacePath: string): string[] {
  const toolName = String(result?.name || result?.toolName || '').trim();
  if (!isTurnFileMutationTool(toolName)) return [];
  if (result?.error === true) return [];
  return collectCandidatePathsFromArgs(toolName, result?.args, workspacePath);
}

export function synthesizeToolResultsFromProcessEntries(entries: any[]): any[] {
  const out: any[] = [];
  const callsByStep = new Map<string, any>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    const event = String(extra.event || entry?.event || '').trim();
    const toolName = String(extra.toolName || entry?.toolName || '').trim();
    if (!toolName) continue;
    const stepKey = String(extra.stepNum || `${toolName}:${out.length}`);
    if (event === 'tool_call') {
      callsByStep.set(stepKey, { name: toolName, args: extra.args || {}, result: '', error: false });
      continue;
    }
    if (event === 'tool_result') {
      const prior = callsByStep.get(stepKey) || { name: toolName, args: extra.args || {}, result: '', error: false };
      out.push({
        ...prior,
        name: toolName,
        result: String(entry?.content || ''),
        error: extra.error === true || entry?.type === 'error',
      });
      continue;
    }
    if (extra.args && isTurnFileMutationTool(toolName)) {
      out.push({ name: toolName, args: extra.args, result: String(entry?.content || ''), error: entry?.type === 'error' });
    }
  }
  return out;
}

function runGitText(cwd: string, args: string[], maxBuffer = 2 * 1024 * 1024): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer,
  } as any).toString();
}

function findGitRootForPath(filePath: string, workspacePath: string): string | null {
  const cwd = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
    ? filePath
    : (fs.existsSync(filePath) ? path.dirname(filePath) : workspacePath);
  try {
    return path.resolve(runGitText(cwd, ['rev-parse', '--show-toplevel']).trim());
  } catch {
    try {
      return path.resolve(runGitText(workspacePath, ['rev-parse', '--show-toplevel']).trim());
    } catch {
      return null;
    }
  }
}

function countTextFileLines(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1_000_000) return 0;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('\0')) return 0;
    return content.length ? content.split(/\r?\n/).length : 0;
  } catch {
    return 0;
  }
}

function inferGitStatus(root: string, relPath: string, absPath: string): TurnFileChangeStatus {
  try {
    const status = runGitText(root, ['status', '--porcelain', '--', relPath]).trim();
    if (/^R/.test(status)) return 'renamed';
    if (/^\?\?/.test(status) || /^A/.test(status)) return 'added';
    if (/^D|^.D/.test(status) || !fs.existsSync(absPath)) return 'deleted';
  } catch {}
  return fs.existsSync(absPath) ? 'modified' : 'deleted';
}

export function collectTurnFileChanges(toolResults: any[] | undefined, workspacePath: string): TurnFileChanges | undefined {
  const touched = Array.from(new Set(
    (Array.isArray(toolResults) ? toolResults : [])
      .flatMap((result) => extractTouchedFilesFromToolResult(result, workspacePath)),
  ));
  if (!touched.length) return undefined;

  const changes: TurnFileChange[] = [];
  for (const absPath of touched.slice(0, 80)) {
    const gitRoot = findGitRootForPath(absPath, workspacePath);
    let insertions = 0;
    let deletions = 0;
    let status: TurnFileChangeStatus = fs.existsSync(absPath) ? 'modified' : 'deleted';
    let diffPreview = '';
    let binary = false;

    if (gitRoot) {
      const relPath = path.relative(gitRoot, absPath).replace(/\\/g, '/');
      status = inferGitStatus(gitRoot, relPath, absPath);
      try {
        const numstat = runGitText(gitRoot, ['diff', '--numstat', '--', relPath]).trim().split(/\r?\n/).filter(Boolean)[0] || '';
        const parts = numstat.split(/\s+/);
        if (parts[0] === '-' || parts[1] === '-') {
          binary = true;
        } else {
          insertions = Math.max(0, Number(parts[0]) || 0);
          deletions = Math.max(0, Number(parts[1]) || 0);
        }
      } catch {}
      if (status === 'added' && insertions === 0 && deletions === 0 && fs.existsSync(absPath)) {
        insertions = countTextFileLines(absPath);
      }
      try {
        diffPreview = runGitText(gitRoot, ['diff', '--unified=2', '--', relPath], 512 * 1024).slice(0, 12000);
      } catch {}
    } else if (fs.existsSync(absPath)) {
      insertions = countTextFileLines(absPath);
      status = 'added';
    }

    if (insertions === 0 && deletions === 0 && !binary && status === 'modified' && !diffPreview) continue;
    changes.push({
      path: absPath,
      displayPath: normalizeDisplayPath(absPath, workspacePath),
      status,
      insertions,
      deletions,
      diffPreview: diffPreview || undefined,
      binary: binary || undefined,
    });
  }

  if (!changes.length) return undefined;
  const insertions = changes.reduce((sum, file) => sum + Math.max(0, Number(file.insertions) || 0), 0);
  const deletions = changes.reduce((sum, file) => sum + Math.max(0, Number(file.deletions) || 0), 0);
  return {
    summary: {
      fileCount: changes.length,
      insertions,
      deletions,
    },
    files: changes.sort((a, b) => a.displayPath.localeCompare(b.displayPath)),
    generatedAt: Date.now(),
  };
}

export function collectTurnFileChangesFromProcessEntries(entries: any[] | undefined, workspacePath: string): TurnFileChanges | undefined {
  const toolResults = synthesizeToolResultsFromProcessEntries(Array.isArray(entries) ? entries : []);
  return collectTurnFileChanges(toolResults, workspacePath);
}
