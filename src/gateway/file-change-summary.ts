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
  baselineKind?: 'git-head' | 'turn-snapshot' | 'git-index' | 'none';
  baselineId?: string;
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
  'skill_manifest_write',
  'skill_update_metadata',
  'skill_resource_write',
  'skill_resource_delete',
  'prom_apply_dev_changes',
]);

// Unified workspace_edit wrapper: only these actions change files.
const WORKSPACE_EDIT_MUTATING_ACTIONS = new Set([
  'create', 'write', 'append', 'find_replace', 'replace_lines', 'insert_after', 'delete_lines',
  'delete_file', 'move', 'copy', 'move_directory', 'copy_directory', 'patchset', 'apply_patch',
]);

function isWorkspaceEditMutation(toolName: string, args: any): boolean {
  if (toolName !== 'workspace_edit') return false;
  const action = String(args?.action || '').trim().toLowerCase();
  if (!action || !WORKSPACE_EDIT_MUTATING_ACTIONS.has(action)) return false;
  if (args?.dry_run === true || args?.check === true) return false;
  return true;
}

function isTurnFileMutationTool(toolName: string, args?: any): boolean {
  const name = String(toolName || '').trim();
  if (!name) return false;
  if (name === 'workspace_edit') return args === undefined ? true : isWorkspaceEditMutation(name, args);
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

function expandRawPathCandidates(rawPath: any, toolName: string, args: any): string[] {
  const raw = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!raw) return [];
  const out = new Set<string>([raw]);
  const surfaces = Array.isArray(args?.changed_surfaces)
    ? args.changed_surfaces.map((surface: any) => String(surface || '').trim().toLowerCase())
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
  if (Array.isArray(safeArgs.edits)) {
    for (const edit of safeArgs.edits) {
      if (edit && typeof edit === 'object') {
        for (const key of ['path', 'file', 'filename']) if (edit[key] != null) candidates.push(edit[key]);
      }
    }
  }
  if ((toolName === 'apply_patch' || toolName === 'workspace_edit') && typeof safeArgs.patch === 'string') {
    candidates.push(...extractPatchTargetPaths(safeArgs.patch));
  }
  return Array.from(new Set(
    candidates
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .flatMap((item) => expandRawPathCandidates(item, toolName, safeArgs))
      .map((item) => resolveTurnFilePath(item, workspacePath))
      .filter(Boolean),
  ));
}

export function extractTouchedFilesFromToolResult(result: any, workspacePath: string): string[] {
  const toolName = String(result?.name || result?.toolName || '').trim();
  if (!isTurnFileMutationTool(toolName, result?.args ?? {})) return [];
  if (result?.error === true) return [];
  return collectCandidatePathsFromArgs(toolName, result?.args, workspacePath);
}

function isInsideWorkspace(workspacePath: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(workspacePath), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function extractExplicitTerminalChangesFromToolResult(result: any, workspacePath: string): TurnFileChange[] {
  const changes: TurnFileChange[] = [];
  const sources = [result?.extra, result?.data, result]
    .filter((source) => source && typeof source === 'object');
  for (const source of sources) {
    const rawChanges = source.workspaceChanges || source.workspace_changes;
    if (!Array.isArray(rawChanges)) continue;
    for (const raw of rawChanges) {
      if (!raw || typeof raw !== 'object') continue;
      const absolute = resolveTurnFilePath(raw.path || raw.absPath || raw.file || raw.displayPath, workspacePath);
      if (!absolute || !isInsideWorkspace(workspacePath, absolute)) continue;
      const status = String(raw.status || 'modified').trim().toLowerCase();
      if (!['added', 'modified', 'deleted', 'renamed'].includes(status)) continue;
      const rawOldPath = String(raw.oldPath || raw.old_path || '').trim();
      const oldPath = rawOldPath ? resolveTurnFilePath(rawOldPath, workspacePath) : '';
      changes.push({
        path: absolute,
        displayPath: String(raw.displayPath || normalizeDisplayPath(absolute, workspacePath)).replace(/\\/g, '/'),
        status: status as TurnFileChangeStatus,
        insertions: Math.max(0, Number(raw.insertions) || 0),
        deletions: Math.max(0, Number(raw.deletions) || 0),
        ...(oldPath && isInsideWorkspace(workspacePath, oldPath) ? { oldPath } : {}),
        ...(String(raw.diffPreview || '').trim() ? { diffPreview: String(raw.diffPreview).slice(0, 12_000) } : {}),
        ...(raw.binary === true ? { binary: true } : {}),
        ...(raw.baselineKind ? { baselineKind: raw.baselineKind } : {}),
        ...(String(raw.baselineId || '').trim() ? { baselineId: String(raw.baselineId).trim() } : {}),
      });
    }
  }
  return Array.from(new Map(changes.map((change) => [path.resolve(change.path).toLowerCase(), change])).values());
}

// ── Durable per-turn file touches ────────────────────────────────────────────
// The durable runtime snapshot keeps only a short text trace (no args), so a
// restart-resumed turn could not tell which files it had edited. This compact
// list (tool name + path-only args + workspaceChanges without diff bodies)
// is persisted with the checkpoint and inherited across every restart, so the
// end-of-turn diff can cover the whole turn.
export type TurnFileTouch = { name: string; args?: Record<string, any>; extra?: { workspaceChanges?: any[] } };
const TURN_FILE_TOUCH_ARG_KEYS = [
  'action', 'path', 'file', 'filename', 'name', 'target', 'target_path', 'targetPath',
  'old_path', 'oldPath', 'new_path', 'newPath', 'source', 'destination',
  'files', 'allowedFiles', 'affected_files', 'affectedFiles', 'changed_files', 'changedFiles', 'changed_surfaces',
];
const MAX_TURN_FILE_TOUCHES = 300;

function compactTouchArgs(args: any): Record<string, any> | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const out: Record<string, any> = {};
  for (const key of TURN_FILE_TOUCH_ARG_KEYS) {
    const value = args[key];
    if (value == null) continue;
    out[key] = Array.isArray(value) ? value.slice(0, 50).map((v) => String(v).slice(0, 400)) : (typeof value === 'object' ? undefined : String(value).slice(0, 400));
    if (out[key] === undefined) delete out[key];
  }
  if (Array.isArray(args.edits)) {
    out.edits = args.edits.slice(0, 50)
      .filter((edit: any) => edit && typeof edit === 'object')
      .map((edit: any) => ({ path: String(edit.path || edit.file || edit.filename || '').slice(0, 400) }))
      .filter((edit: any) => edit.path);
  }
  if (typeof args.patch === 'string') {
    const targets = extractPatchTargetPaths(args.patch).slice(0, 50);
    if (targets.length) out.edits = [...(out.edits || []), ...targets.map((p) => ({ path: p }))];
  }
  return Object.keys(out).length ? out : undefined;
}

export function extractTurnFileTouches(entries: any[] | undefined): TurnFileTouch[] {
  const touches: TurnFileTouch[] = [];
  for (const result of synthesizeToolResultsFromProcessEntries(Array.isArray(entries) ? entries : [])) {
    if (result?.error === true) continue;
    const name = String(result?.name || '').trim();
    const rawChanges = result?.extra?.workspaceChanges || result?.extra?.workspace_changes;
    const workspaceChanges = Array.isArray(rawChanges)
      ? rawChanges.filter((c: any) => c && typeof c === 'object').slice(0, 100).map((c: any) => {
        const { diffPreview, ...rest } = c;
        return rest;
      })
      : [];
    const isMutation = isTurnFileMutationTool(name, result?.args ?? {});
    if (!isMutation && !workspaceChanges.length) continue;
    const args = isMutation ? compactTouchArgs(result?.args) : undefined;
    if (isMutation && !args) continue;
    touches.push({
      name,
      ...(args ? { args } : {}),
      ...(workspaceChanges.length ? { extra: { workspaceChanges } } : {}),
    });
  }
  return touches;
}

export function mergeTurnFileTouches(...lists: Array<TurnFileTouch[] | undefined>): TurnFileTouch[] {
  const seen = new Map<string, TurnFileTouch>();
  for (const list of lists) {
    for (const touch of Array.isArray(list) ? list : []) {
      if (!touch || typeof touch !== 'object' || !touch.name) continue;
      const key = JSON.stringify([touch.name, touch.args || null, touch.extra?.workspaceChanges?.map((c: any) => c?.path) || null]);
      if (!seen.has(key)) seen.set(key, touch);
    }
  }
  return Array.from(seen.values()).slice(-MAX_TURN_FILE_TOUCHES);
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
        extra: { ...(prior.extra || {}), ...extra },
      });
      continue;
    }
    if (extra.args && isTurnFileMutationTool(toolName)) {
      out.push({ name: toolName, args: extra.args, result: String(entry?.content || ''), error: entry?.type === 'error', extra });
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
    if (/^D|^.D/.test(status)) return 'deleted';
  } catch {}
  return 'modified';
}

export function collectTurnFileChanges(toolResults: any[] | undefined, workspacePath: string): TurnFileChanges | undefined {
  const explicit = Array.from(new Map(
    (Array.isArray(toolResults) ? toolResults : [])
      .flatMap((result) => extractExplicitTerminalChangesFromToolResult(result, workspacePath))
      .map((change) => [path.resolve(change.path).toLowerCase(), change] as const),
  ).values());
  const touched = Array.from(new Set(
    (Array.isArray(toolResults) ? toolResults : [])
      .flatMap((result) => extractTouchedFilesFromToolResult(result, workspacePath)),
  )).filter((filePath) => !explicit.some((change) => path.resolve(change.path).toLowerCase() === path.resolve(filePath).toLowerCase()));
  if (!touched.length && !explicit.length) return undefined;

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

    if (!fs.existsSync(absPath) && status !== 'deleted') continue;
    if (status === 'deleted' && insertions === 0 && deletions === 0 && !binary && !diffPreview) continue;
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

  const allChanges = Array.from(new Map(
    [...explicit, ...changes]
      .map((change) => [path.resolve(change.path).toLowerCase(), change] as const),
  ).values());
  if (!allChanges.length) return undefined;
  const insertions = allChanges.reduce((sum, file) => sum + Math.max(0, Number(file.insertions) || 0), 0);
  const deletions = allChanges.reduce((sum, file) => sum + Math.max(0, Number(file.deletions) || 0), 0);
  return {
    summary: {
      fileCount: allChanges.length,
      insertions,
      deletions,
    },
    files: allChanges.sort((a, b) => a.displayPath.localeCompare(b.displayPath)),
    generatedAt: Date.now(),
  };
}

export function collectTurnFileChangesFromProcessEntries(entries: any[] | undefined, workspacePath: string): TurnFileChanges | undefined {
  const toolResults = synthesizeToolResultsFromProcessEntries(Array.isArray(entries) ? entries : []);
  return collectTurnFileChanges(toolResults, workspacePath);
}
