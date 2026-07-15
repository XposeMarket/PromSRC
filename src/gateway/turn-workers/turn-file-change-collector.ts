import { execFile } from 'child_process';
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

export const FILE_MUTATION_TOOL_NAMES = new Set([
  'create_file',
  'write',
  'write_file',
  'append_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'apply_patchset',
  'apply_workspace_patchset',
  'workspace_edit',
  'rename_file',
  'delete_file',
  'copy_file',
  'move_file',
  'mkdir',
  'apply_patch',
  'write_source',
  'find_replace_source',
  'apply_dev_source_patchset',
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
  'skill_manifest_write',
  'skill_update_metadata',
  'skill_resource_write',
  'skill_resource_delete',
  'prom_apply_dev_changes',
]);

export function isTurnFileMutationTool(toolName: string): boolean {
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

function resolveTurnFilePath(rawPath: unknown, workspacePath: string): string {
  const value = String(rawPath || '').trim();
  if (!value || value === '.' || value === '/dev/null') return '';
  try {
    if (path.isAbsolute(value)) return path.resolve(value);
    const normalized = value.replace(/\\/g, '/').replace(/^\.?\//, '');
    const workspaceAbs = path.resolve(path.join(workspacePath, normalized));
    if (fs.existsSync(workspaceAbs)) return workspaceAbs;
    if (/^(src|web-ui)\//i.test(normalized)) {
      const projectRoot = path.resolve(workspacePath, '..');
      const projectAbs = path.resolve(path.join(projectRoot, normalized));
      if (
        fs.existsSync(path.join(projectRoot, 'package.json'))
        && fs.existsSync(path.join(projectRoot, 'src'))
        && fs.existsSync(path.join(projectRoot, 'web-ui'))
      ) {
        return projectAbs;
      }
    }
    return workspaceAbs;
  } catch {
    return '';
  }
}

function expandRawPathCandidates(rawPath: unknown, toolName: string, args: Record<string, unknown>): string[] {
  const raw = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!raw) return [];
  const out = new Set<string>([raw]);
  const surfaces = Array.isArray(args?.changed_surfaces)
    ? args.changed_surfaces.map((surface: unknown) => String(surface || '').trim().toLowerCase())
    : [];
  const isDevApply = toolName === 'prom_apply_dev_changes';
  const isMobileish = surfaces.includes('mobile') || /^src\/mobile\//i.test(raw) || /^mobile\//i.test(raw);
  if (isMobileish && /^src\/mobile\//i.test(raw)) out.add(`web-ui/${raw}`);
  if (isMobileish && /^mobile\//i.test(raw)) out.add(`web-ui/src/${raw}`);
  if (isDevApply && /^src\/(pages|styles|components|mobile|utils|app\.js|ws\.js)/i.test(raw)) out.add(`web-ui/${raw}`);
  return Array.from(out);
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

function extractTouchedFilesFromToolResult(result: unknown, workspacePath: string): string[] {
  const record = result && typeof result === 'object' ? result as Record<string, any> : {};
  const toolName = String(record.name || record.toolName || '').trim();
  if (!isTurnFileMutationTool(toolName)) return [];
  if (record.error === true) return [];
  const args = record.args && typeof record.args === 'object' ? record.args as Record<string, any> : {};
  const candidates: unknown[] = [];
  for (const source of [record.extra, record.data, record]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of [
      'touchedFiles', 'changedFiles', 'affectedFiles', 'files',
      'touched_files', 'changed_files', 'affected_files',
    ]) {
      if ((source as Record<string, unknown>)[key] != null) candidates.push((source as Record<string, unknown>)[key]);
    }
  }
  for (const key of [
    'path', 'file', 'filename', 'name', 'target', 'target_path', 'targetPath',
    'old_path', 'oldPath', 'new_path', 'newPath', 'source', 'destination',
    'files', 'allowedFiles', 'affected_files', 'affectedFiles', 'changed_files', 'changedFiles',
  ]) {
    if (args[key] != null) candidates.push(args[key]);
  }
  if (toolName.includes('webui_source')) {
    candidates.push(...candidates.map((item) => {
      const value = String(item || '').trim();
      return value && !/^web-ui[\\/]/i.test(value) ? path.join('web-ui', value) : value;
    }));
  } else if (/_source$/.test(toolName) && !toolName.includes('webui')) {
    candidates.push(...candidates.map((item) => {
      const value = String(item || '').trim();
      return value && !/^src[\\/]/i.test(value) ? path.join('src', value) : value;
    }));
  }
  if (toolName === 'apply_patch' && typeof args.patch === 'string') {
    candidates.push(...extractPatchTargetPaths(args.patch));
  }
  return Array.from(new Set(
    candidates
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .flatMap((item) => expandRawPathCandidates(item, toolName, args))
      .map((item) => resolveTurnFilePath(item, workspacePath))
      .filter(Boolean),
  ));
}

function runGitText(cwd: string, args: string[], maxBuffer = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer,
      timeout: 15_000,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout || ''));
    });
  });
}

async function findGitRootForPath(filePath: string, workspacePath: string): Promise<string | null> {
  const cwd = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
    ? filePath
    : (fs.existsSync(filePath) ? path.dirname(filePath) : workspacePath);
  try {
    return path.resolve((await runGitText(cwd, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    try {
      return path.resolve((await runGitText(workspacePath, ['rev-parse', '--show-toplevel'])).trim());
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

async function inferGitStatus(root: string, relPath: string): Promise<TurnFileChangeStatus> {
  try {
    const status = (await runGitText(root, ['status', '--porcelain', '--', relPath])).trim();
    if (/^R/.test(status)) return 'renamed';
    if (/^\?\?/.test(status) || /^A/.test(status)) return 'added';
    if (/^D|^.D/.test(status)) return 'deleted';
  } catch {}
  return 'modified';
}

/**
 * Exact implementation of the finalization file-change scan. Keep this pure
 * from gateway state so it can run in a child process or as the failure-only
 * in-process fallback without changing the returned shape.
 */
export async function collectTurnFileChangesDirect(
  toolResults: unknown[] | undefined,
  workspacePath: string,
): Promise<TurnFileChanges | undefined> {
  const touched = Array.from(new Set(
    (Array.isArray(toolResults) ? toolResults : [])
      .flatMap((result) => extractTouchedFilesFromToolResult(result, workspacePath)),
  ));
  if (!touched.length) return undefined;

  const candidates = touched.slice(0, 40);
  const collected: Array<TurnFileChange | undefined> = new Array(candidates.length);
  let nextIndex = 0;
  const collectOne = async (absPath: string): Promise<TurnFileChange | undefined> => {
    const gitRoot = await findGitRootForPath(absPath, workspacePath);
    let insertions = 0;
    let deletions = 0;
    let status: TurnFileChangeStatus = fs.existsSync(absPath) ? 'modified' : 'deleted';
    let diffPreview = '';
    let binary = false;

    if (gitRoot) {
      const relPath = path.relative(gitRoot, absPath).replace(/\\/g, '/');
      status = await inferGitStatus(gitRoot, relPath);
      try {
        const numstat = (await runGitText(gitRoot, ['diff', '--numstat', '--', relPath])).trim().split(/\r?\n/).filter(Boolean)[0] || '';
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
        diffPreview = (await runGitText(gitRoot, ['diff', '--unified=2', '--', relPath], 512 * 1024)).slice(0, 12000);
      } catch {}
    } else if (fs.existsSync(absPath)) {
      insertions = countTextFileLines(absPath);
      status = 'added';
    }

    if (!fs.existsSync(absPath) && status !== 'deleted') return undefined;
    if (status === 'deleted' && insertions === 0 && deletions === 0 && !binary && !diffPreview) return undefined;
    if (insertions === 0 && deletions === 0 && !binary && status === 'modified' && !diffPreview) return undefined;
    return {
      path: absPath,
      displayPath: normalizeDisplayPath(absPath, workspacePath),
      status,
      insertions,
      deletions,
      diffPreview: diffPreview || undefined,
      binary: binary || undefined,
    };
  };
  const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      collected[index] = await collectOne(candidates[index]);
    }
  });
  await Promise.all(workers);
  const changes = collected.filter((change): change is TurnFileChange => !!change);

  if (!changes.length) return undefined;
  const insertions = changes.reduce((sum, file) => sum + Math.max(0, Number(file.insertions) || 0), 0);
  const deletions = changes.reduce((sum, file) => sum + Math.max(0, Number(file.deletions) || 0), 0);
  return {
    summary: { fileCount: changes.length, insertions, deletions },
    files: changes,
    generatedAt: Date.now(),
  };
}
