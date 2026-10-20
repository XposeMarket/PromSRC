import fs from 'fs';
import path from 'path';
import { normalizeDevSourcePatchsetArgs } from './../dev-source-patchset';
import { hasBrowserStructuredCollectionInput } from './../browser-tools';
import { type ToolResult } from './../tool-builder';
import { resolvePrometheusRoot } from './../../runtime/distribution.js';
import { getBgAgentResults, getCreativeAssets, FILE_TOOL_DEFAULT_BATCH_FILES, FILE_TOOL_DEFAULT_BATCH_LINES, FILE_TOOL_DEFAULT_TREE_DEPTH, FILE_TOOL_DEFAULT_TREE_ENTRIES, hasProvidedArg } from './subagent-executor';


export function normalizeTypeScriptModule(mod: any): typeof import('typescript') {
  return (mod?.default || mod) as typeof import('typescript');
}

export function validateSourceSyntaxBeforeWrite(absPath: string, content: string): string | null {
  const ext = path.extname(absPath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'].includes(ext)) return null;
  try {
    const ts = normalizeTypeScriptModule(require('typescript'));
    const scriptKind = ext === '.tsx'
      ? ts.ScriptKind.TSX
      : ext === '.jsx'
        ? ts.ScriptKind.JSX
        : ext === '.js'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const diagnostics = (sf as any).parseDiagnostics || [];
    if (diagnostics.length === 0) return null;
    return diagnostics.slice(0, 3).map((diag: any) => {
      const pos = typeof diag.start === 'number'
        ? sf.getLineAndCharacterOfPosition(diag.start)
        : { line: 0, character: 0 };
      const message = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
      return `${path.basename(absPath)}:${pos.line + 1}:${pos.character + 1} TS${diag.code}: ${message}`;
    }).join('\n');
  } catch {
    return null;
  }
}

export function rejectInvalidSourceEdit(toolName: string, args: any, absPath: string, content: string): ToolResult | null {
  const syntaxError = validateSourceSyntaxBeforeWrite(absPath, content);
  if (!syntaxError) return null;
  return {
    name: toolName,
    args,
    result:
      `EDIT REJECTED: proposed edit would make ${path.basename(absPath)} syntactically invalid.\n` +
      `${syntaxError}\n` +
      'No file was written. Re-read the surrounding lines and retry with a structurally complete edit, preferably find_replace_source with a larger exact anchor or write_source with full file content.',
    error: true,
  };
}

export function inferDevSourceSurface(args: any): 'src' | 'web-ui' | 'prom-root' {
  const surface = String(args?.surface || args?.root || '').trim().toLowerCase();
  if (['web-ui', 'webui', 'ui', 'frontend'].includes(surface)) return 'web-ui';
  if (['prom-root', 'prometheus-root', 'root', 'prom'].includes(surface)) return 'prom-root';
  const raw = String(args?.file || args?.filename || args?.path || args?.directory || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (raw === 'web-ui' || raw.startsWith('web-ui/')) return 'web-ui';
  if (raw.startsWith('prom-root/') || raw.startsWith('prom:/')) return 'prom-root';
  return 'src';
}

export function normalizeDevSourceFileArg(args: any, surface: 'src' | 'web-ui' | 'prom-root'): string {
  const raw = String(args?.file || args?.filename || args?.path || args?.name || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (surface === 'web-ui') return raw.replace(/^web-ui\/?/, '');
  if (surface === 'prom-root') return raw.replace(/^prom-root\/?/, '').replace(/^prom:\//, '');
  return raw.replace(/^src\/?/, '');
}

export function normalizeDevSourcePathArg(args: any, surface: 'src' | 'web-ui' | 'prom-root'): string {
  const raw = String(args?.path || args?.directory || args?.dir || args?.file || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (surface === 'web-ui') return raw.replace(/^web-ui\/?/, '');
  if (surface === 'prom-root') return raw.replace(/^prom-root\/?/, '').replace(/^prom:\//, '');
  return raw.replace(/^src\/?/, '');
}

export function normalizeDevSourceWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  if (name !== 'dev_source_read' && name !== 'dev_source_edit') return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!action) return { name, args, error: `${name} requires action` };
  delete args.action;
  const surface = inferDevSourceSurface(args);
  const file = normalizeDevSourceFileArg(args, surface);
  const pathArg = normalizeDevSourcePathArg(args, surface);

  if (name === 'dev_source_read') {
    if (action === 'batch_read' || action === 'read_batch') {
      const files = Array.isArray(args.files)
        ? args.files
        : (Array.isArray(args.paths) ? args.paths.map((p: any) => ({ file: String(p) })) : []);
      const readArgs = { ...args, files };
      if (!hasProvidedArg(readArgs, 'max_files')) readArgs.max_files = FILE_TOOL_DEFAULT_BATCH_FILES;
      if (!hasProvidedArg(readArgs, 'max_lines_per_file') && !hasProvidedArg(readArgs, 'num_lines')) {
        readArgs.max_lines_per_file = FILE_TOOL_DEFAULT_BATCH_LINES;
      }
      return { name: 'read_dev_sources', args: readArgs };
    }
    if (action === 'stats_batch') {
      const files = Array.isArray(args.files)
        ? args.files.map((entry: any) => typeof entry === 'string' ? entry : String(entry?.file || entry?.path || '')).filter(Boolean)
        : [];
      return { name: 'source_stats_batch', args: { ...args, files } };
    }
    if (action === 'list') {
      if (surface === 'web-ui') return { name: 'list_webui_source', args: { ...args, path: pathArg } };
      if (surface === 'prom-root') return { name: 'list_prom', args: { ...args, path: pathArg } };
      return { name: 'list_source', args: { ...args, path: pathArg } };
    }
    if (action === 'stats') {
      if (surface === 'web-ui') return { name: 'webui_source_stats', args: { ...args, file } };
      if (surface === 'prom-root') return { name: 'prom_file_stats', args: { ...args, file } };
      return { name: 'source_stats', args: { ...args, file } };
    }
    if (action === 'read') {
      if (surface === 'web-ui') return { name: 'read_webui_source', args: { ...args, file } };
      if (surface === 'prom-root') return { name: 'read_prom_file', args: { ...args, file } };
      return { name: 'read_source', args: { ...args, file } };
    }
    if (action === 'validate' || action === 'validate_syntax' || action === 'syntax') {
      if (surface === 'web-ui') return { name: 'validate_webui_source', args: { ...args, file } };
      if (surface === 'prom-root') return { name: 'validate_prom_file', args: { ...args, file } };
      return { name: 'validate_source', args: { ...args, file } };
    }
    if (action === 'grep' || action === 'search') {
      if (surface === 'web-ui') return { name: 'grep_webui_source', args: { ...args, path: pathArg } };
      if (surface === 'prom-root') return { name: 'grep_prom', args: { ...args, path: pathArg } };
      return { name: 'grep_source', args: { ...args, path: pathArg, root: args.root || 'src' } };
    }
    return { name, args: rawArgs, error: `Unsupported dev_source_read action "${action}".` };
  }

  if (surface === 'prom-root') {
    return { name, args: rawArgs, error: 'dev_source_edit supports approved src/ and web-ui/ edits only; prom-root writes are not available in this wrapper.' };
  }

  if (action === 'patchset') return { name: 'apply_dev_source_patchset', args: normalizeDevSourcePatchsetArgs(args) };
  if (action === 'await_files' || action === 'await_handoff') return { name: 'await_dev_edit_handoff', args };
  if (action === 'verify' || action === 'verify_only') return { name: 'prom_apply_dev_changes', args: { ...args, mode: 'verify_only' } };
  if (action === 'apply_live' || action === 'apply') return { name: 'prom_apply_dev_changes', args: { ...args, mode: 'apply_live' } };

  const writeTool = (srcBase: string, webUiBase: string) => {
    if (surface === 'web-ui') return { name: webUiBase, args: { ...args, file } };
    return { name: srcBase, args: { ...args, file } };
  };
  if (action === 'find_replace') return writeTool('find_replace_source', 'find_replace_webui_source');
  if (action === 'replace_lines') return writeTool('replace_lines_source', 'replace_lines_webui_source');
  if (action === 'insert_after') return writeTool('insert_after_source', 'insert_after_webui_source');
  if (action === 'delete_lines') return writeTool('delete_lines_source', 'delete_lines_webui_source');
  if (action === 'write' || action === 'create') return writeTool('write_source', 'write_webui_source');
  if (action === 'delete_file') return writeTool('delete_source', 'delete_webui_source');
  return { name, args: rawArgs, error: `Unsupported dev_source_edit action "${action}".` };
}

export function normalizeWorkspacePatchOp(value: unknown): string {
  const op = String(value || '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    create: 'create_file',
    create_file: 'create_file',
    write: 'write_file',
    write_file: 'write_file',
    overwrite: 'write_file',
    find_replace: 'find_replace',
    replace: 'find_replace',
    replace_text: 'find_replace',
    replace_lines: 'replace_lines',
    line_replace: 'replace_lines',
    insert_after: 'insert_after',
    insert: 'insert_after',
    delete_lines: 'delete_lines',
    delete: 'delete_lines',
    remove_lines: 'delete_lines',
    rename_file: 'rename_file',
    rename: 'rename_file',
  };
  return aliases[op] || op;
}

export function positiveNumberArg(value: unknown): number | undefined {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function hasNonEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value === true;
  return true;
}

export function copyIfPresent(target: Record<string, any>, source: Record<string, any>, keys: string[]): void {
  for (const key of keys) {
    if (hasNonEmptyValue(source[key])) target[key] = source[key];
  }
}

export function compactWorkspaceReadArgs(args: Record<string, any>, pathArg: any): Record<string, any> {
  const out: Record<string, any> = { filename: pathArg };
  const startLine = positiveNumberArg(args.start_line ?? args.startLine);
  const aroundLine = positiveNumberArg(args.around_line ?? args.aroundLine);
  const exactLine = positiveNumberArg(args.line ?? args.line_number ?? args.lineNumber ?? args.physical_line);
  if (startLine !== undefined) out.start_line = startLine;
  if (aroundLine !== undefined) {
    out.around_line = aroundLine;
    if (args.before !== undefined && Number.isFinite(Number(args.before))) out.before = Math.max(0, Math.floor(Number(args.before)));
    if (args.after !== undefined && Number.isFinite(Number(args.after))) out.after = Math.max(0, Math.floor(Number(args.after)));
  }
  if (exactLine !== undefined) out.line = exactLine;
  copyIfPresent(out, args, ['num_lines', 'max_lines', 'head', 'tail', 'char_window', 'max_result_tokens', 'hard_max_result_tokens']);
  if (positiveNumberArg(args.column) !== undefined) out.column = positiveNumberArg(args.column);
  if (args.full === true || args.full_file === true) out.full = true;
  if (args.full_line === true || args.fullLine === true) out.full_line = true;
  if (args.show_full_line === true || args.showFullLine === true) out.show_full_line = true;
  if (args.inline === true) out.inline = true;
  if (args.no_spool === true) out.no_spool = true;
  return out;
}

export function compactWorkspaceGrepArgs(args: Record<string, any>, pathArg: any): Record<string, any> {
  const out: Record<string, any> = pathArg ? { filename: pathArg } : {};
  copyIfPresent(out, args, ['pattern', 'glob', 'file_glob', 'directory', 'query', 'exclude']);
  copyIfPresent(out, args, ['max_results', 'context', 'context_lines', 'before', 'after', 'char_window', 'char_before', 'char_after', 'format']);
  if (args.regex === true) out.regex = true;
  if (args.literal === true) out.literal = true;
  if (args.case_insensitive === true) out.case_insensitive = true;
  if (args.include_lockfiles === true) out.include_lockfiles = true;
  if (args.gitignore === false) out.gitignore = false;
  if (args.respect_gitignore === false) out.respect_gitignore = false;
  return out;
}

export function compactWorkspaceBatchReadArgs(args: Record<string, any>): Record<string, any> {
  const files = Array.isArray(args.files) && args.files.length
    ? args.files.map((entry: any) => {
      const item = entry && typeof entry === 'object' ? entry : {};
      const out: Record<string, any> = { filename: item.filename ?? item.path ?? item.file };
      const startLine = positiveNumberArg(item.start_line ?? item.startLine);
      const numLines = positiveNumberArg(item.num_lines ?? item.numLines);
      if (startLine !== undefined) out.start_line = startLine;
      if (numLines !== undefined) out.num_lines = numLines;
      if (item.full === true || item.allow_large === true) out.full = true;
      return out;
    })
    : (Array.isArray(args.paths) ? args.paths.map((p: any) => ({ filename: String(p) })) : []);
  const out: Record<string, any> = { files };
  copyIfPresent(out, args, ['max_files', 'max_lines_per_file', 'num_lines', 'query', 'max_result_tokens', 'hard_max_result_tokens']);
  if (args.content !== undefined) out.content = args.content;
  if (args.include_content !== undefined) out.include_content = args.include_content;
  if (args.summary !== undefined) out.summary = args.summary;
  if (String(args.mode || '').trim()) out.mode = String(args.mode).trim();
  if (args.full === true || args.allow_large === true) out.full = true;
  if (args.inline === true) out.inline = true;
  return out;
}

export function compactWorkspaceEditArgs(args: Record<string, any>, pathArg: any, action: string): Record<string, any> {
  const out: Record<string, any> = {};
  if (pathArg !== undefined && pathArg !== null && String(pathArg).trim()) out.filename = pathArg;
  if (action === 'find_replace') {
    out.find = args.find ?? args.old_text ?? args.oldText;
    out.replace = args.replace ?? args.new_text ?? args.newText ?? '';
    if (args.replace_all === true || args.replaceAll === true) out.replace_all = true;
  } else if (action === 'replace_lines') {
    out.start_line = args.start_line;
    out.end_line = args.end_line;
    out.new_content = args.new_content ?? args.content ?? '';
  } else if (action === 'insert_after') {
    out.after_line = args.after_line;
    out.content = args.content ?? args.new_content ?? '';
  } else if (action === 'delete_lines') {
    out.start_line = args.start_line;
    out.end_line = args.end_line;
  } else if (action === 'create' || action === 'write' || action === 'append') {
    out.content = args.content ?? '';
    if (args.overwrite === true) out.overwrite = true;
    if (args.create_dirs === true) out.create_dirs = true;
  } else {
    copyIfPresent(out, args, ['source', 'destination', 'patch', 'check', 'dry_run', 'max_entries']);
  }
  return out;
}

export function inferWorkspacePatchOp(edit: any): string | undefined {
  // Callers frequently omit `op` and let the field shape imply it. Infer the
  // obvious cases so a patchset that clearly says "find X, replace with Y"
  // does not bounce with "filename and op are required".
  if (!edit || typeof edit !== 'object') return undefined;
  const has = (k: string) => edit[k] !== undefined && edit[k] !== null;
  if (has('find') || has('old_text') || has('oldText')) return 'find_replace';
  if (has('after_line') || has('afterLine')) return 'insert_after';
  if ((has('start_line') || has('startLine')) && (has('new_content') || has('content'))) return 'replace_lines';
  if (has('start_line') || has('startLine')) return 'delete_lines';
  return undefined;
}

/**
 * Batch read/stat accept `files`, but models also send `paths`, `filenames`, or a
 * JSON-string list (seen 2026-09-25: workspace_read batch_read with paths:[...]).
 */
export function coerceBatchFileList(args: any): any[] {
  let raw = args?.files ?? args?.paths ?? args?.filenames ?? args?.file_paths;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('[')) { try { raw = JSON.parse(text); } catch { /* ignore */ } }
    else if (text) raw = [text];
  }
  return Array.isArray(raw) ? raw.filter((entry) => entry !== undefined && entry !== null && entry !== '') : [];
}

export function normalizeWorkspacePatchsetArgs(rawArgs: any): any {
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  // Models sometimes send `edits` as a JSON string ("[{...}]") or a single object.
  if (typeof args.edits === 'string') {
    try { args.edits = JSON.parse(args.edits); } catch { /* leave as-is; empty-edits error explains */ }
  }
  if (args.edits && typeof args.edits === 'object' && !Array.isArray(args.edits)) args.edits = [args.edits];
  const rawEdits = Array.isArray(args.edits) ? args.edits : [];
  // A single-file patchset may carry the target once at the top level
  // (`path`/`filename`/`file`) instead of repeating it per edit.
  const sharedFilename = args.filename ?? args.path ?? args.file ?? args.name;
  return {
    ...args,
    edits: rawEdits.map((entry: any) => {
      const edit = entry && typeof entry === 'object' ? { ...entry } : {};
      const op = normalizeWorkspacePatchOp(edit.op ?? edit.action ?? edit.type ?? inferWorkspacePatchOp(edit));
      const filename = edit.filename ?? edit.path ?? edit.file ?? edit.name ?? sharedFilename;
      if (op === 'find_replace') {
        return {
          filename,
          op,
          find: edit.find ?? edit.old_text ?? edit.oldText,
          replace: edit.replace ?? edit.new_text ?? edit.newText ?? '',
          ...(edit.replace_all === true || edit.replaceAll === true ? { replace_all: true } : {}),
        };
      }
      if (op === 'replace_lines') {
        return {
          filename,
          op,
          start_line: edit.start_line ?? edit.startLine,
          end_line: edit.end_line ?? edit.endLine,
          new_content: edit.new_content ?? edit.content ?? '',
        };
      }
      if (op === 'insert_after') {
        return {
          filename,
          op,
          after_line: edit.after_line ?? edit.afterLine,
          content: edit.content ?? edit.new_content ?? '',
        };
      }
      if (op === 'delete_lines') {
        return {
          filename,
          op,
          start_line: edit.start_line ?? edit.startLine,
          end_line: edit.end_line ?? edit.endLine,
        };
      }
      if (op === 'write_file' || op === 'create_file') {
        return {
          filename,
          op,
          content: edit.content ?? edit.new_content ?? '',
        };
      }
      return {
        ...edit,
        filename,
        op,
      };
    }),
  };
}

export function isWorkspacePrometheusSourceCopyPath(rawPath: unknown): boolean {
  const normalized = String(rawPath || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  return /^(?:workspace\/)?repos\/promsrc(?:[-_/].*)?(?:\/|$)/i.test(normalized);
}

export function normalizeWorkspaceWrapperTool(name: string, rawArgs: any, workspacePath = ''): { name: string; args: any; error?: string } | null {
  if (!/^workspace_(read|edit|run|git|safety|code_nav)$/.test(name)) return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!action) return { name, args, error: `${name} requires action` };
  delete args.action;

  const normalizeSearchArgs = () => {
    const out = { ...args };
    const rawGlob = String(out.file_glob ?? out.glob ?? '').trim().replace(/\\/g, '/');
    const rawDirectory = String(out.directory ?? out.path ?? '').trim().replace(/\\/g, '/');
    if (rawGlob.includes('/')) {
      const globDir = path.posix.dirname(rawGlob);
      const globBase = path.posix.basename(rawGlob);
      if (!rawDirectory || rawDirectory === '.') out.directory = globDir;
      else if (rawGlob.startsWith(`${rawDirectory.replace(/\/$/, '')}/`)) out.file_glob = globBase;
      if (out.file_glob == null || out.file_glob === out.glob) out.file_glob = globBase;
    } else {
      out.directory = out.directory ?? out.path ?? '.';
      out.file_glob = out.file_glob ?? out.glob;
    }
    delete out.glob;
    return out;
  };

  const pathArg = args.path ?? args.filename ?? args.file ?? args.name;

  if (name === 'workspace_read') {
    const normalizedRequestedPath = String(pathArg || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (isWorkspacePrometheusSourceCopyPath(normalizedRequestedPath) && args.allow_source_copy !== true) {
      return {
        name,
        args,
        error: 'This path is a workspace copy of Prometheus source, not the live product tree. Use dev_source_read for current src/web-ui files. Set allow_source_copy=true only when the user explicitly asked to inspect or compare that copy.',
      };
    }
    const explicitlyWorkspaceScoped = /^(?:workspace\/|repos\/|oss agents\/|games\/|scratch\/|temp\/)/i.test(normalizedRequestedPath);
    if (!explicitlyWorkspaceScoped && normalizedRequestedPath) {
      const projectRoot = resolvePrometheusRoot();
      const workspaceCandidate = path.resolve(workspacePath || '.', normalizedRequestedPath);
      const sourceCandidate = normalizedRequestedPath.startsWith('src/')
        ? path.resolve(projectRoot, normalizedRequestedPath)
        : path.resolve(projectRoot, 'src', normalizedRequestedPath);
      const webUiCandidate = normalizedRequestedPath.startsWith('web-ui/')
        ? path.resolve(projectRoot, normalizedRequestedPath)
        : path.resolve(projectRoot, 'web-ui', normalizedRequestedPath);
      const workspaceHasTarget = fs.existsSync(workspaceCandidate);
      const sourceHasTarget = fs.existsSync(sourceCandidate);
      const webUiHasTarget = fs.existsSync(webUiCandidate);
      if (!workspaceHasTarget && (sourceHasTarget || webUiHasTarget)) {
        const sourcePath = sourceHasTarget
          ? (normalizedRequestedPath.startsWith('src/') ? normalizedRequestedPath : `src/${normalizedRequestedPath}`)
          : (normalizedRequestedPath.startsWith('web-ui/') ? normalizedRequestedPath : `web-ui/${normalizedRequestedPath}`);
        const routed = normalizeDevSourceWrapperTool('dev_source_read', {
          ...rawArgs,
          action,
          file: sourcePath,
          path: sourcePath,
        });
        if (routed) return routed;
      }
    }
    if (action === 'tree') {
      const treeArgs: Record<string, any> = { path: pathArg };
      copyIfPresent(treeArgs, args, ['glob', 'exclude', 'max_result_tokens', 'hard_max_result_tokens']);
      if (!hasProvidedArg(treeArgs, 'max_depth')) treeArgs.max_depth = FILE_TOOL_DEFAULT_TREE_DEPTH;
      if (!hasProvidedArg(treeArgs, 'max_entries')) treeArgs.max_entries = FILE_TOOL_DEFAULT_TREE_ENTRIES;
      return { name: 'file_tree', args: treeArgs };
    }
    if (action === 'list') {
      const listArgs: Record<string, any> = { path: pathArg };
      copyIfPresent(listArgs, args, ['glob', 'exclude']);
      if (!hasProvidedArg(listArgs, 'max_depth')) listArgs.max_depth = 1;
      if (!hasProvidedArg(listArgs, 'max_entries')) listArgs.max_entries = 250;
      return { name: 'list_directory', args: listArgs };
    }
    if (action === 'list_files') return { name: 'list_files', args: { path: pathArg } };
    if (action === 'exists') return { name: 'path_exists', args: { path: pathArg } };
    if (action === 'stats') return { name: 'file_stats', args: { filename: pathArg } };
    if (action === 'read') return { name: 'read_file', args: compactWorkspaceReadArgs(args, pathArg) };
    if (action === 'validate' || action === 'validate_syntax' || action === 'syntax') return { name: 'validate_file', args: { filename: pathArg } };
    if (action === 'batch_read') {
      const readArgs = compactWorkspaceBatchReadArgs(args);
      if (!hasProvidedArg(readArgs, 'max_files')) readArgs.max_files = FILE_TOOL_DEFAULT_BATCH_FILES;
      if (!hasProvidedArg(readArgs, 'max_lines_per_file') && !hasProvidedArg(readArgs, 'num_lines')) {
        readArgs.max_lines_per_file = FILE_TOOL_DEFAULT_BATCH_LINES;
      }
      return { name: 'read_files_batch', args: readArgs };
    }
    if (action === 'grep') {
      if (pathArg) {
        // grep_file only accepts a single file. When the caller passes a directory
        // (workspace_read grep on "src/gateway"), route to search_files with that
        // directory instead of returning `"<dir>" is not a file`.
        let isDirectory = false;
        try {
          const candidate = path.isAbsolute(String(pathArg))
            ? String(pathArg)
            : path.resolve(workspacePath || '.', String(pathArg));
          isDirectory = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
        } catch { /* fall through to grep_file */ }
        if (!isDirectory) return { name: 'grep_file', args: compactWorkspaceGrepArgs(args, pathArg) };
        const searchArgs = normalizeSearchArgs();
        searchArgs.directory = String(pathArg);
        delete searchArgs.path;
        delete searchArgs.filename;
        delete searchArgs.file;
        delete searchArgs.name;
        return { name: 'search_files', args: searchArgs };
      }
      return { name: 'search_files', args: normalizeSearchArgs() };
    }
    if (action === 'search') {
      return { name: 'search_files', args: normalizeSearchArgs() };
    }
    return { name, args: rawArgs, error: `Unsupported workspace_read action "${action}".` };
  }

  if (name === 'workspace_edit') {
    if (action === 'create') return { name: 'create_file', args: compactWorkspaceEditArgs(args, pathArg, action) };
    if (action === 'write') return { name: 'write_file', args: compactWorkspaceEditArgs(args, pathArg, action) };
    if (action === 'append') return { name: 'append_file', args: compactWorkspaceEditArgs(args, pathArg, action) };
    if (action === 'find_replace') return { name: 'find_replace', args: compactWorkspaceEditArgs(args, pathArg, action) };
    if (action === 'replace_lines') return { name: 'replace_lines', args: compactWorkspaceEditArgs(args, pathArg, action) };
    if (action === 'insert_after') return { name: 'insert_after', args: compactWorkspaceEditArgs(args, pathArg, action) };
    if (action === 'delete_lines') return { name: 'delete_lines', args: compactWorkspaceEditArgs(args, pathArg, action) };
    if (action === 'delete_file') return { name: 'delete_file', args: { filename: pathArg } };
    if (action === 'mkdir') return { name: 'mkdir', args: { path: pathArg } };
    if (action === 'move') return { name: 'move_file', args };
    if (action === 'copy') return { name: 'copy_file', args };
    if (action === 'move_directory') return { name: 'move_directory', args };
    if (action === 'copy_directory') return { name: 'copy_directory', args };
    if (action === 'patchset') return { name: 'apply_workspace_patchset', args: normalizeWorkspacePatchsetArgs(args) };
    if (action === 'preview_patch') return { name: 'preview_patch', args };
    if (action === 'apply_patch') return { name: 'apply_patch', args };
    return { name, args: rawArgs, error: `Unsupported workspace_edit action "${action}".` };
  }

  if (name === 'workspace_run') {
    if (action === 'telemetry' || action === 'benchmark_summary') return { name: 'tool_benchmark_summary', args };
    if (['run', 'start', 'status', 'log', 'wait', 'kill', 'submit'].includes(action)) {
      const runArgs = {
        ...args,
        action,
        runId: args.runId ?? args.process_id,
        maxChars: args.maxChars ?? args.max_chars,
        timeoutMs: args.timeoutMs ?? args.timeout_ms,
      };
      if (action === 'start') {
        const rawNoOutput = runArgs.noOutputTimeoutMs ?? runArgs.no_output_timeout_ms;
        if (rawNoOutput == null || rawNoOutput === '') {
          runArgs.noOutputTimeoutMs = 0;
        } else {
          const parsedNoOutput = Number(rawNoOutput);
          if (Number.isFinite(parsedNoOutput) && parsedNoOutput > 0 && parsedNoOutput < 300_000) {
            runArgs.noOutputTimeoutMs = 300_000;
          }
        }
      }
      return { name: 'terminal', args: runArgs };
    }
    if (action === 'test') return { name: 'run_tests', args };
    if (action === 'lint') return { name: 'run_linter', args };
    if (action === 'format') return { name: 'run_formatter', args };
    if (action === 'typecheck') return { name: 'run_typecheck', args };
    return { name, args: rawArgs, error: `Unsupported workspace_run action "${action}".` };
  }

  if (name === 'workspace_git') {
    if (action === 'status') return { name: 'git_status', args };
    if (action === 'diff') return { name: 'git_diff', args };
    if (action === 'log') return { name: 'git_log', args };
    if (action === 'branch') return { name: 'git_branch', args };
    if (action === 'commit') return { name: 'git_commit', args };
    if (action === 'push') return { name: 'git_push', args };
    if (action === 'open_pr') return { name: 'open_pr', args };
    return { name, args: rawArgs, error: `Unsupported workspace_git action "${action}".` };
  }

  if (name === 'workspace_safety') {
    if (action === 'snapshot') return { name: 'snapshot_workspace', args };
    if (action === 'restore') return { name: 'restore_snapshot', args };
    if (action === 'revert_last') return { name: 'revert_last_tool_change', args };
    if (action === 'scan_secrets') return { name: 'scan_secrets', args };
    if (action === 'scan_large_files') return { name: 'scan_large_files', args };
    if (action === 'operation_plan') return { name: 'operation_plan', args };
    if (action === 'preview_patch') return { name: 'preview_patch', args };
    return { name, args: rawArgs, error: `Unsupported workspace_safety action "${action}".` };
  }

  if (name === 'workspace_code_nav') {
    if (action === 'outline') return { name: 'code_outline', args };
    if (action === 'symbols') return { name: 'get_symbols', args };
    if (action === 'definition') return { name: 'go_to_definition', args };
    if (action === 'references') return { name: 'find_references', args };
    return { name, args: rawArgs, error: `Unsupported workspace_code_nav action "${action}".` };
  }

  return null;
}

export function normalizeBrowserWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  if (!['browser_session', 'browser_observe', 'browser_act', 'browser_extract'].includes(name)) return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!action) return { name, args, error: `${name} requires action` };
  delete args.action;

  if (name === 'browser_session') {
    if (action === 'doctor') return { name: 'browser_doctor', args };
    if (action === 'set_profile_target') return { name: 'browser_set_profile_target', args };
    if (action === 'open') return { name: 'browser_open', args };
    if (action === 'list_tabs') return { name: 'browser_list_tabs', args };
    if (action === 'select_tab') return { name: 'browser_select_tab', args };
    if (action === 'new_tab') return { name: 'browser_new_tab', args };
    if (action === 'close_tab') return { name: 'browser_close_tab', args };
    if (action === 'close') return { name: 'browser_close', args };
    if (action === 'chrome_accounts') return { name: 'browser_chrome_accounts', args };
    return { name, args: rawArgs, error: `Unsupported browser_session action "${action}".` };
  }

  if (name === 'browser_observe') {
    if (action === 'snapshot') return { name: 'browser_snapshot', args };
    if (action === 'snapshot_delta' || action === 'delta') return { name: 'browser_snapshot_delta', args };
    if (action === 'screenshot' || action === 'vision_screenshot') return { name: 'browser_vision_screenshot', args };
    if (action === 'page_text' || action === 'text') return { name: 'browser_get_page_text', args };
    if (action === 'focused_item' || action === 'focus') return { name: 'browser_get_focused_item', args };
    if (action === 'wait') return { name: 'browser_wait', args };
    if (action === 'element_watch' || action === 'watch') return { name: 'browser_element_watch', args };
    return { name, args: rawArgs, error: `Unsupported browser_observe action "${action}".` };
  }

  if (name === 'browser_act') {
    if (args.fast === true && args.observe == null) args.observe = 'none';
    if (action === 'click') return { name: 'browser_click', args };
    if (action === 'fill') return { name: 'browser_fill', args };
    if (action === 'type') return { name: 'browser_type', args };
    if (action === 'key' || action === 'press_key') return { name: 'browser_press_key', args };
    if (action === 'upload_file' || action === 'upload') return { name: 'browser_upload_file', args };
    if (action === 'scroll') return { name: 'browser_scroll', args };
    if (action === 'drag') return { name: 'browser_drag', args };
    if (action === 'click_and_download' || action === 'download') return { name: 'browser_click_and_download', args };
    if (action === 'vision_click') return { name: 'browser_vision_click', args };
    if (action === 'vision_type') return { name: 'browser_vision_type', args };
    return { name, args: rawArgs, error: `Unsupported browser_act action "${action}".` };
  }

  if (name === 'browser_extract') {
    if (action === 'scroll_collect') return { name: 'browser_scroll_collect', args };
    if (action === 'scroll_collect_structured' || action === 'scroll_collect_v2' || action === 'collect_structured') {
      if (!hasBrowserStructuredCollectionInput(args)) {
        return {
          name,
          args: rawArgs,
          error: 'browser_extract action="scroll_collect_structured" requires schema_name/use_schema, or fields plus container_selector/item_root. For schema-free text collection, use action="scroll_collect".',
        };
      }
      return { name: 'browser_scroll_collect_v2', args };
    }
    if (action === 'extract_structured' || action === 'structured') return { name: 'browser_extract_structured', args };
    if (action === 'run_js' || action === 'js') return { name: 'browser_run_js', args };
    if (action === 'network' || action === 'intercept_network') {
      if (args.network_action != null && args.action == null) args.action = args.network_action;
      delete args.network_action;
      return { name: 'browser_intercept_network', args };
    }
    if (action === 'console' || action === 'inspect_console') {
      if (args.console_action != null && args.action == null) args.action = args.console_action;
      delete args.console_action;
      return { name: 'inspect_console', args };
    }
    if (action === 'accessibility' || action === 'a11y') return { name: 'run_accessibility_check', args };
    if (action === 'smoke_test' || action === 'smoke') return { name: 'browser_smoke_test', args };
    if (action === 'teach_verify') return { name: 'browser_teach_verify', args };
    return { name, args: rawArgs, error: `Unsupported browser_extract action "${action}".` };
  }

  return null;
}

export function copyVercelWrapperAlias(args: Record<string, any>, target: string, ...aliases: string[]): void {
  if (args[target] == null) {
    for (const alias of aliases) {
      if (args[alias] != null) {
        args[target] = args[alias];
        break;
      }
    }
  }
  for (const alias of aliases) delete args[alias];
}

export function normalizeVercelWrapperRecord(value: unknown): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, any>) };
  copyVercelWrapperAlias(record, 'repoId', 'repo_id');
  copyVercelWrapperAlias(record, 'prId', 'pr_id');
  copyVercelWrapperAlias(record, 'productionBranch', 'production_branch');
  copyVercelWrapperAlias(record, 'buildCommand', 'build_command');
  copyVercelWrapperAlias(record, 'installCommand', 'install_command');
  copyVercelWrapperAlias(record, 'outputDirectory', 'output_directory');
  copyVercelWrapperAlias(record, 'rootDirectory', 'root_directory');
  copyVercelWrapperAlias(record, 'gitBranch', 'git_branch');
  copyVercelWrapperAlias(record, 'customEnvironmentId', 'custom_environment_id');
  return record;
}

export function normalizeVercelWrapperArgs(action: string, rawArgs: any): any {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {};
  copyVercelWrapperAlias(args, 'teamId', 'team_id');
  copyVercelWrapperAlias(args, 'projectId', 'project_id');
  copyVercelWrapperAlias(args, 'projectIds', 'project_ids');
  copyVercelWrapperAlias(args, 'deploymentId', 'deployment_id');
  copyVercelWrapperAlias(args, 'withGitRepoInfo', 'with_git_repo_info');
  copyVercelWrapperAlias(args, 'withLatestCommit', 'with_latest_commit');
  copyVercelWrapperAlias(args, 'forceNew', 'force_new');
  copyVercelWrapperAlias(args, 'buildId', 'build_id');
  copyVercelWrapperAlias(args, 'redirectStatusCode', 'redirect_status_code');
  copyVercelWrapperAlias(args, 'gitProvider', 'git_provider');
  copyVercelWrapperAlias(args, 'gitOrg', 'git_org');
  copyVercelWrapperAlias(args, 'gitRepo', 'git_repo');
  copyVercelWrapperAlias(args, 'gitRef', 'git_ref');
  copyVercelWrapperAlias(args, 'gitSha', 'git_sha');
  copyVercelWrapperAlias(args, 'gitRepoId', 'git_repo_id');
  copyVercelWrapperAlias(args, 'gitPrId', 'git_pr_id');
  copyVercelWrapperAlias(args, 'gitMetadata', 'git_metadata');
  copyVercelWrapperAlias(args, 'projectSettings', 'project_settings');
  copyVercelWrapperAlias(args, 'customEnvironmentSlugOrId', 'custom_environment_slug_or_id');
  copyVercelWrapperAlias(args, 'customEnvironmentId', 'custom_environment_id');
  copyVercelWrapperAlias(args, 'productionBranch', 'production_branch');
  copyVercelWrapperAlias(args, 'buildCommand', 'build_command');
  copyVercelWrapperAlias(args, 'installCommand', 'install_command');
  copyVercelWrapperAlias(args, 'outputDirectory', 'output_directory');
  copyVercelWrapperAlias(args, 'rootDirectory', 'root_directory');
  copyVercelWrapperAlias(args, 'gitBranch', 'git_branch');
  copyVercelWrapperAlias(args, 'gitRepository', 'git_repository');
  copyVercelWrapperAlias(args, 'gitSource', 'git_source');
  if (args.gitRepository !== undefined) args.gitRepository = normalizeVercelWrapperRecord(args.gitRepository);
  if (args.gitSource !== undefined) args.gitSource = normalizeVercelWrapperRecord(args.gitSource);
  if (args.settings !== undefined) args.settings = normalizeVercelWrapperRecord(args.settings);

  if (action === 'list_projects') {
    copyVercelWrapperAlias(args, 'search', 'project_name');
  } else if (action === 'create_project' || action === 'create_deployment') {
    copyVercelWrapperAlias(args, 'name', 'project_name');
  } else {
    copyVercelWrapperAlias(args, 'projectId', 'project_name');
  }
  if (action === 'env' || action === 'manage_project_domain') copyVercelWrapperAlias(args, 'action', 'action_type');
  if (action === 'get_deployment' || action === 'deployment_events' || action === 'cancel_deployment' || action === 'delete_deployment' || action === 'assign_alias') {
    copyVercelWrapperAlias(args, 'deployment', 'deploymentId');
  }
  return args;
}


export function normalizeExternalAppWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  const actionMaps: Record<string, Record<string, string>> = {
    x_search_ops: {
      x_search: 'x_search',
      search_recent: 'x_api_search_recent',
      search_all: 'x_api_search_all',
      search_spaces: 'x_api_search_spaces',
      get_trends: 'x_api_get_trends',
      get_personalized_trends: 'x_api_get_personalized_trends',
      get_space: 'x_api_get_space',
    },
    x_posts: {
      get_post: 'x_api_get_post',
      get_posts: 'x_api_get_posts',
      create_post: 'x_api_create_post',
      delete_post: 'x_api_delete_post',
      create_bookmark: 'x_api_create_bookmark',
      delete_bookmark: 'x_api_delete_bookmark',
      get_bookmarks: 'x_api_get_bookmarks',
      like: 'x_api_like_post',
      unlike: 'x_api_unlike_post',
      get_liked_posts: 'x_api_get_liked_posts',
      get_liking_users: 'x_api_get_liking_users',
      repost: 'x_api_repost',
      unrepost: 'x_api_unrepost',
      get_reposted_by: 'x_api_get_reposted_by',
      get_reposts_of_me: 'x_api_get_reposts_of_me',
    },
    x_users: {
      me: 'x_api_me',
      get_user: 'x_api_get_user',
      get_user_by_username: 'x_api_get_user_by_username',
      get_user_posts: 'x_api_get_user_posts',
      get_user_mentions: 'x_api_get_user_mentions',
      get_followers: 'x_api_get_followers',
      get_following: 'x_api_get_following',
      follow: 'x_api_follow_user',
      unfollow: 'x_api_unfollow_user',
      mute: 'x_api_mute_user',
      unmute: 'x_api_unmute_user',
      block: 'x_api_block_user',
      unblock: 'x_api_unblock_user',
    },
    x_lists: {
      get_list: 'x_api_get_list',
      get_owned_lists: 'x_api_get_owned_lists',
      get_list_posts: 'x_api_get_list_posts',
      create_list: 'x_api_create_list',
      update_list: 'x_api_update_list',
      delete_list: 'x_api_delete_list',
      add_member: 'x_api_add_list_member',
      remove_member: 'x_api_remove_list_member',
      follow_list: 'x_api_follow_list',
      unfollow_list: 'x_api_unfollow_list',
      pin_list: 'x_api_pin_list',
      unpin_list: 'x_api_unpin_list',
    },
    x_dm: {
      send: 'x_api_send_dm',
      get_events: 'x_api_get_dm_events',
    },
    x_admin: {
      request: 'x_api_request',
      get_usage: 'x_api_get_usage',
    },
    vercel_ops: {
      status: 'connector_vercel_status',
      list_teams: 'connector_vercel_list_teams',
      list_projects: 'connector_vercel_list_projects',
      get_project: 'connector_vercel_get_project',
      create_project: 'connector_vercel_create_project',
      update_project: 'connector_vercel_update_project',
      delete_project: 'connector_vercel_delete_project',
      list_deployments: 'connector_vercel_list_deployments',
      get_deployment: 'connector_vercel_get_deployment',
      create_deployment: 'connector_vercel_create_deployment',
      redeploy: 'connector_vercel_redeploy',
      deployment_events: 'connector_vercel_deployment_events',
      cancel_deployment: 'connector_vercel_cancel_deployment',
      delete_deployment: 'connector_vercel_delete_deployment',
      list_aliases: 'connector_vercel_list_aliases',
      assign_alias: 'connector_vercel_assign_alias',
      env: 'connector_vercel_env',
      domains: 'connector_vercel_domains',
      get_project_domain: 'connector_vercel_get_project_domain',
      manage_project_domain: 'connector_vercel_manage_project_domain',
      api_request: 'connector_vercel_api_request',
    },
  };
  const map = actionMaps[name];
  if (!map) return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!action) return { name, args, error: `${name} requires action` };
  delete args.action;
  const target = map[action];
  if (!target) return { name, args: rawArgs, error: `Unsupported ${name} action "${action}".` };
  return { name: target, args: name === 'vercel_ops' ? normalizeVercelWrapperArgs(action, args) : args };
}

export const TEAM_GOAL_SUBACTIONS = new Set([
  'set_focus', 'update_focus', 'set_goal',
  'log_completed', 'log_completion', 'log_complete', 'log_completed_work',
  'pause_agent', 'unpause_agent',
]);

export function normalizeAgentTeamWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  const actionMaps: Record<string, Record<string, string>> = {
    agent_ops: {
      spawn: 'spawn_subagent',
      list: 'agent_list',
      info: 'agent_info',
      update: 'agent_update',
      delete: 'delete_agent',
      deploy_analysis_team: 'deploy_analysis_team',
    },
    agent_chat_ops: {
      chat: 'chat_with_subagent',
      delegate: 'message_subagent',
      steer: 'agent_run_ops',
      send_mailbox: 'agent_message_send',
      talk: 'chat_with_subagent',
      message: 'message_subagent',
      send: 'agent_message_send',
      turn_request: 'agent_turn_request',
      reply_wait: 'agent_reply_wait',
      thread_watch: 'agent_thread_watch',
    },
    team_ops_wrapper: {
      manage: 'team_manage',
      delete: 'team_manage',
      manage_goal: 'manage_team_goal',
      manage_context_ref: 'manage_team_context_ref',
      update_goal: 'update_team_goal',
      reply: 'reply_to_team',
      post_chat: 'post_to_team_chat',
      message_main: 'message_main_agent',
      // Generic team dispatch must stay on the team-aware execution path.
      // Routing this alias through dispatch_to_agent creates a standalone task
      // with no team/session binding, so talk_to_manager cannot identify the
      // team and the result never reaches the team room.
      dispatch: 'dispatch_team_agent',
      dispatch_team_agent: 'dispatch_team_agent',
      request_member_turn: 'request_team_member_turn',
      get_agent_result: 'get_agent_result',
    },
    team_collab_ops: {
      talk_manager: 'talk_to_manager',
      request_context: 'request_context',
      request_manager_help: 'request_manager_help',
      talk_teammate: 'talk_to_teammate',
      share_artifact: 'share_artifact',
      update_status: 'update_my_status',
    },
  };
  const map = actionMaps[name];
  if (!map) return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!action) return { name, args, error: `${name} requires action` };
  delete args.action;
  let target = map[action];
  if (!target) return { name, args: rawArgs, error: `Unsupported ${name} action "${action}".` };
  // Strict-schema models fill every optional field with "" or []. Treat those as
  // absent; otherwise `team_action: ""` overrode real values (manager goal calls
  // failed with "requires team_id and action") and empty arrays looked like
  // explicit clears.
  // Scoped to the team wrappers: agent_ops intentionally uses "" to clear fields
  // such as reasoning_effort.
  if (name === 'team_ops_wrapper' || name === 'team_collab_ops') {
    for (const key of Object.keys(args)) {
      const value = args[key];
      if (value === '' || value === null || (Array.isArray(value) && value.length === 0)) delete args[key];
    }
  }
  // Managers send goal actions through manage (team_action:"log_completed"),
  // which team_manage rejected as unsupported. Route them to manage_team_goal.
  if (target === 'team_manage' && TEAM_GOAL_SUBACTIONS.has(String(args.team_action ?? '').trim().toLowerCase())) {
    target = 'manage_team_goal';
  }
  // Teams v7: manage + team_action:"get_agent_result" (or another wrapper action)
  // hit team_manage and failed. Route known wrapper actions to their own tool.
  if (target === 'team_manage' && name === 'team_ops_wrapper') {
    const sub = String(args.team_action ?? '').trim().toLowerCase();
    const passthrough = sub && sub !== 'manage' && sub !== 'delete' ? map[sub] : undefined;
    if (passthrough && passthrough !== 'team_manage') {
      target = passthrough;
      delete args.team_action;
    }
  }
  if (name === 'agent_chat_ops') {
    if (args.agent_id == null && args.subagent_id != null) args.agent_id = args.subagent_id;
    if (args.assignment == null && args.task_prompt != null) args.assignment = args.task_prompt;
    if (target === 'message_subagent' && args.assignment != null) args.message = args.assignment;
    if (args.message == null && args.task_prompt != null) args.message = args.task_prompt;
    if (target === 'agent_run_ops') args.action = 'steer';
  }
  if (target === 'agent_update') {
    const nestedPatch = isPlainObjectArg(args.patch) ? args.patch : {};
    delete args.patch;
    Object.assign(args, nestedPatch);
    if (args.agent_id == null && args.subagent_id != null) args.agent_id = args.subagent_id;
    if (args.max_steps == null && args.maxSteps != null) args.max_steps = args.maxSteps;
    if (args.timeout_ms == null && args.timeoutMs != null) args.timeout_ms = args.timeoutMs;
    delete args.maxSteps;
    delete args.timeoutMs;
  }
  // manage_goal / update_goal handlers read `action`, but the wrapper consumed it
  // and the schema documents team_action. Without this every manager goal call
  // failed with "requires team_id and action".
  if (target === 'manage_team_goal' || target === 'update_team_goal') {
    if (args.action == null && args.team_action != null) args.action = args.team_action;
    if (args.action == null && args.goal_action != null) args.action = args.goal_action;
    if (args.team_id == null && args.teamId != null) args.team_id = args.teamId;
    if (args.value == null && args.goal != null) args.value = args.goal;
    if (args.value == null && args.message != null) args.value = args.message;
    delete args.team_action;
  }
  if (target === 'team_manage') {
    if (args.team_action != null && args.action == null) args.action = args.team_action;
    if (action === 'delete' && args.action == null) args.action = 'delete';
    if (args.team_context == null && args.teamContext != null) args.team_context = args.teamContext;
    if (args.team_context == null && args.context != null) args.team_context = args.context;
    if (args.subagent_ids == null && Array.isArray(args.subagentIds)) args.subagent_ids = args.subagentIds;
    delete args.team_action;
  }
  // spawn_subagent requires subagent_id OR create_if_missing. The agent_ops schema
  // advertises from_role/specialization as a standalone shorthand, so hydrate an
  // implicit create_if_missing envelope instead of rejecting the documented call.
  if (target === 'spawn_subagent') {
    if (args.subagent_id == null && args.agent_id != null) args.subagent_id = args.agent_id;
    const hasRoleShorthand = args.from_role != null || args.specialization != null;
    if (args.subagent_id == null && hasRoleShorthand && !isPlainObjectArg(args.create_if_missing)) {
      args.create_if_missing = {
        ...(args.from_role != null ? { from_role: args.from_role } : {}),
        ...(args.specialization != null ? { specialization: args.specialization } : {}),
        ...(args.name != null ? { name: args.name } : {}),
        ...(args.description != null ? { description: args.description } : {}),
        ...(args.model != null ? { model: args.model } : {}),
        ...(args.reasoning_effort != null ? { reasoning_effort: args.reasoning_effort } : {}),
      };
    }
  }
  // Wrapper schemas expose friendly parameter names that the underlying handlers do
  // not read. Without these aliases a schema-conformant call fails validation, and
  // agents burn steps guessing the handler's private parameter name.
  if (name === 'team_ops_wrapper') {
    if (args.team_id == null && args.teamId != null) args.team_id = args.teamId;
    if (target === 'post_to_team_chat' || target === 'reply_to_team' || target === 'message_main_agent') {
      if (args.message == null && args.content != null) args.message = args.content;
    }
    if (target === 'dispatch_team_agent') {
      if (args.task_prompt == null && args.task != null) args.task_prompt = args.task;
      if (args.agent_id == null && args.subagent_id != null) args.agent_id = args.subagent_id;
    }
    // get_agent_result needs a task_id. Managers usually only know the member,
    // so resolve that member's most recent background dispatch in this team.
    if (target === 'get_agent_result' && args.task_id == null) {
      if (args.taskId != null) args.task_id = args.taskId;
      const memberId = String(args.agent_id || args.subagent_id || '').trim();
      if (args.task_id == null && memberId) {
        const teamId = String(args.team_id || '').trim();
        let best: { id: string; startedAt: number } | null = null;
        for (const [id, entry] of getBgAgentResults().entries()) {
          if (entry.agentId !== memberId) continue;
          if (teamId && entry.teamId !== teamId) continue;
          if (!best || entry.startedAt > best.startedAt) best = { id, startedAt: entry.startedAt };
        }
        if (best) args.task_id = best.id;
      }
    }
  }
  if (name === 'team_collab_ops') {
    // talk_teammate documents teammate_id; the handler reads agent_id.
    if (target === 'talk_to_teammate' && args.agent_id == null && args.teammate_id != null) {
      args.agent_id = args.teammate_id;
    }
    // request_context documents context/request; the handler reads question.
    if (target === 'request_context' && args.question == null) {
      if (args.request != null) args.question = args.request;
      else if (args.message != null) args.question = args.message;
      else if (args.context != null) args.question = args.context;
    }
    // request_manager_help / talk_to_manager document request; the handler reads message.
    if ((target === 'request_manager_help' || target === 'talk_to_manager') && args.message == null) {
      if (args.request != null) args.message = args.request;
      else if (args.context != null) args.message = args.context;
    }
    // update_status documents status; the handler reads phase/current_task.
    if (target === 'update_my_status') {
      if (args.phase == null && args.status != null) args.phase = args.status;
      if (args.current_task == null && args.message != null) args.current_task = args.message;
    }
  }
  return { name: target, args };
}

export function isPlainObjectArg(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function normalizeCreativeImageSourceCandidate(args: Record<string, any>): string {
  const inputs = isPlainObjectArg(args.inputs) ? args.inputs : {};
  const options = isPlainObjectArg(args.options) ? args.options : {};
  return firstNonEmptyString(
    args.source,
    args.path,
    args.url,
    args.sourceImage,
    args.source_image,
    args.image,
    args.imagePath,
    args.image_path,
    args.assetPath,
    args.asset_path,
    args.file,
    args.filename,
    inputs.source,
    inputs.path,
    inputs.url,
    inputs.sourceImage,
    inputs.source_image,
    inputs.image,
    inputs.imagePath,
    inputs.image_path,
    options.source,
    options.path,
    options.url,
    options.sourceImage,
    options.source_image,
    options.image,
    options.imagePath,
    options.image_path,
  );
}

export function normalizeCreativeAssetIdCandidate(args: Record<string, any>): string {
  const inputs = isPlainObjectArg(args.inputs) ? args.inputs : {};
  const options = isPlainObjectArg(args.options) ? args.options : {};
  return firstNonEmptyString(
    args.assetId,
    args.asset_id,
    inputs.assetId,
    inputs.asset_id,
    options.assetId,
    options.asset_id,
  );
}

export function normalizeCreativeWrapperArgs(target: string, rawArgs: Record<string, any>): Record<string, any> {
  const inputs = isPlainObjectArg(rawArgs.inputs) ? rawArgs.inputs : {};
  const options = isPlainObjectArg(rawArgs.options) ? rawArgs.options : {};
  const args = { ...inputs, ...options, ...rawArgs };
  if (target === 'creative_import_asset'
    || target === 'creative_analyze_asset'
    || target === 'creative_extract_layers'
    || target === 'creative_extract_layers_for_generation') {
    if (!String(args.source ?? '').trim()) {
      const source = normalizeCreativeImageSourceCandidate(rawArgs);
      if (source) args.source = source;
    }
    if (!String(args.assetId ?? args.asset_id ?? '').trim()) {
      const assetId = normalizeCreativeAssetIdCandidate(rawArgs);
      if (assetId) args.assetId = assetId;
    }
  }
  return args;
}

export function resolveCreativeToolSource(storage: any, args: Record<string, any>, toolName: string, label: string): { source: string; error?: string } {
  const source = normalizeCreativeImageSourceCandidate(args);
  if (source) return { source };
  const assetId = normalizeCreativeAssetIdCandidate(args);
  if (assetId) {
    const index = getCreativeAssets().readCreativeAssetIndex(storage);
    const asset = index.assets.find((item: any) => item?.id === assetId || item?.name === assetId || item?.path === assetId || item?.relativePath === assetId);
    const assetSource = firstNonEmptyString(asset?.absPath, asset?.path, asset?.relativePath, asset?.source);
    if (assetSource) return { source: assetSource };
    return {
      source: '',
      error: `${toolName} could not find assetId "${assetId}" in the Creative asset index. Pass source, path, url, inputs.sourceImage, inputs.image, or a valid assetId.`,
    };
  }
  return {
    source: '',
    error: `${toolName} requires a ${label}. Pass source, path, url, inputs.sourceImage, inputs.image, or assetId.`,
  };
}

export function normalizeCreativeWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  const actionMaps: Record<string, Record<string, string>> = {
    creative_project: {
      get_mode: 'get_creative_mode',
      switch_mode: 'switch_creative_mode',
      list_references: 'creative_list_references',
      get_state: 'creative_get_state',
      create_project: 'creative_create_project',
      project_history: 'creative_project_history',
      create_storyboard: 'creative_create_storyboard',
      storyboard_history: 'creative_storyboard_history',
      save_scene: 'creative_save_scene',
      export: 'creative_export',
      export_trace: 'creative_export_trace',
      checkpoint: 'creative_checkpoint',
      history_status: 'creative_history_status',
      undo: 'creative_undo',
      redo: 'creative_redo',
      reset_scene: 'creative_reset_scene',
      purge_scene: 'creative_purge_scene',
      create_library_pack: 'creative_create_library_pack',
      list_library_packs: 'creative_list_library_packs',
      toggle_library_pack: 'creative_toggle_library_pack',
    },
    creative_scene: {
      apply_ops: 'creative_apply_ops',
      set_canvas: 'creative_set_canvas',
      add_element: 'creative_add_element',
      update_element: 'creative_update_element',
      delete_element: 'creative_delete_element',
      select_element: 'creative_select_element',
      element_inventory: 'creative_element_inventory',
      apply_animation: 'creative_apply_animation',
      arrange: 'creative_arrange',
      apply_style: 'creative_apply_style',
      apply_template: 'creative_apply_template',
      add_effect: 'creative_add_effect',
      add_mask: 'creative_add_mask',
      set_blend_mode: 'creative_set_blend_mode',
      apply_brand_kit: 'creative_apply_brand_kit',
      search_animations: 'creative_search_animations',
      chain_scene: 'creative_chain_scene',
    },
    creative_image_ops: {
      add_asset: 'creative_add_asset',
      import_asset: 'creative_import_asset',
      analyze_asset: 'creative_analyze_asset',
      extract_layers: 'creative_extract_layers',
      extract_layers_for_generation: 'creative_extract_layers_for_generation',
      model_status: 'creative_model_status',
      search_assets: 'creative_search_assets',
      generate_asset: 'creative_generate_asset',
      register_generation: 'creative_register_generation',
      generation_history: 'creative_generation_history',
      fit_asset: 'creative_fit_asset',
      search_icons: 'creative_search_icons',
      render_ascii_asset: 'creative_render_ascii_asset',
      normalize_layer_specs: 'creative_normalize_layer_specs',
    },
    creative_video_ops: {
      write_shot_prompt: 'creative_write_shot_prompt',
      extract_video_frame: 'creative_extract_video_frame',
      extract_video_frames: 'creative_extract_video_frames',
      generate_image_shot: 'creative_generate_image_shot',
      generate_video_shot: 'creative_generate_video_shot',
      refine_video_shot: 'creative_refine_video_shot',
      generate_sequence: 'creative_generate_sequence',
      pick_continuity_frame: 'creative_pick_continuity_frame',
      wrap_video_as_html_motion_clip: 'creative_wrap_video_as_html_motion_clip',
      add_generated_clip_to_composition: 'creative_add_generated_clip_to_composition',
      render_generated_sequence: 'creative_render_generated_sequence',
      stitch_clips: 'creative_stitch_clips',
      auto_assemble_rough_cut: 'creative_auto_assemble_rough_cut',
      import_audio: 'creative_import_audio',
      download_audio: 'creative_download_audio',
      extract_audio_from_video: 'creative_extract_audio_from_video',
      generate_voiceover: 'creative_generate_voiceover',
      transcribe_audio: 'creative_transcribe_audio',
      sync_captions_to_audio: 'creative_sync_captions_to_audio',
      add_audio_track: 'creative_add_audio_track',
      mix_audio_tracks: 'creative_mix_audio_tracks',
      add_music_bed: 'creative_add_music_bed',
      add_sound_effects: 'creative_add_sound_effects',
      generate_motion_graphics_layer: 'creative_generate_motion_graphics_layer',
      composite_video_layers: 'creative_composite_video_layers',
      attach_audio_from_file: 'creative_attach_audio_from_file',
      attach_audio_from_url: 'creative_attach_audio_from_url',
      trim_clip: 'creative_trim_clip',
      list_motion_templates: 'creative_list_motion_templates',
      preview_motion_template: 'creative_preview_motion_template',
      apply_motion_template: 'creative_apply_motion_template',
      generate_motion_variants: 'creative_generate_motion_variants',
      composition_get: 'creative_composition_get',
      composition_save: 'creative_composition_save',
      composition_add_track: 'creative_composition_add_track',
      composition_add_clip: 'creative_composition_add_clip',
      composition_select_clip: 'creative_composition_select_clip',
      composition_move_clip: 'creative_composition_move_clip',
      composition_trim_clip: 'creative_composition_trim_clip',
      composition_split_at: 'creative_composition_split_at',
      composition_set_transition: 'creative_composition_set_transition',
      composition_delete_clip: 'creative_composition_delete_clip',
      composition_render: 'creative_composition_render',
      timeline: 'creative_timeline',
      render_snapshot: 'creative_render_snapshot',
    },
    creative_hyperframes_ops: {
      browse_catalog: 'hyperframes_browse_catalog',
      insert_clip: 'hyperframes_insert_clip',
      apply_patch: 'hyperframes_apply_patch',
      set_text: 'hyperframes_set_text',
      set_color: 'hyperframes_set_color',
      set_timing: 'hyperframes_set_timing',
      set_variable: 'hyperframes_set_variable',
      set_asset: 'hyperframes_set_asset',
      add_animation: 'hyperframes_add_animation',
      lint: 'hyperframes_lint',
      qa: 'hyperframes_qa',
      materialize: 'hyperframes_materialize',
      export: 'hyperframes_export',
      list_components: 'creative_list_hyperframes_components',
      import_component: 'creative_import_hyperframes_component',
      sync_catalog: 'creative_sync_hyperframes_catalog',
      apply_component: 'creative_apply_hyperframes_component',
      overlay_on_video: 'creative_overlay_hyperframes_on_video',
      list_templates: 'creative_list_html_motion_templates',
      apply_template: 'creative_apply_html_motion_template',
      create_clip: 'creative_create_html_motion_clip',
      save_template: 'creative_save_html_motion_template',
      save_block: 'creative_save_html_motion_block',
      promote_scene_to_template: 'creative_promote_scene_to_template',
      list_blocks: 'creative_list_html_motion_blocks',
      render_block: 'creative_render_html_motion_block',
      read_clip: 'creative_read_html_motion_clip',
      patch_clip: 'creative_patch_html_motion_clip',
      restore_revision: 'creative_restore_html_motion_revision',
      render_snapshot: 'creative_render_html_motion_snapshot',
      export_clip: 'creative_export_html_motion_clip',
    },
    creative_quality_ops: {
      quality_report: 'creative_quality_report',
      validate_layout: 'creative_validate_layout',
      validate_composition_layers: 'creative_validate_composition_layers',
      preflight_overlay: 'creative_preflight_overlay',
      sample_composite_frames: 'creative_sample_composite_frames',
      frame_trace: 'creative_frame_trace',
      frame_diff: 'creative_frame_diff',
      analyze_generated_video: 'creative_analyze_generated_video',
      compare_shots: 'creative_compare_shots',
      select_best_take: 'creative_select_best_take',
      retry_shot_until_pass: 'creative_retry_shot_until_pass',
      lint_html_motion_clip: 'creative_lint_html_motion_clip',
      measure_text: 'creative_measure_text',
      text_fit_report: 'creative_text_fit_report',
      composition_lint: 'creative_composition_lint',
      image_get_element_at_point: 'image_get_element_at_point',
      image_get_overlaps: 'image_get_overlaps',
      image_get_bounds_summary: 'image_get_bounds_summary',
      image_check_text_overflow: 'image_check_text_overflow',
      image_check_contrast: 'image_check_contrast',
      image_detect_empty_regions: 'image_detect_empty_regions',
      video_render_frame: 'video_render_frame',
      video_render_contact_sheet: 'video_render_contact_sheet',
      video_analyze_frame: 'video_analyze_frame',
      video_analyze_timeline: 'video_analyze_timeline',
      video_check_keyframes: 'video_check_keyframes',
      video_check_caption_timing: 'video_check_caption_timing',
      video_check_audio_sync: 'video_check_audio_sync',
      video_extract_clip_frames: 'video_extract_clip_frames',
      video_analyze_imported_video: 'video_analyze_imported_video',
    },
  };
  const map = actionMaps[name];
  if (!map) return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!action) return { name, args, error: `${name} requires action` };
  delete args.action;
  const target = map[action];
  if (!target) return { name, args: rawArgs, error: `Unsupported ${name} action "${action}".` };
  return { name: target, args: normalizeCreativeWrapperArgs(target, args) };
}

export function normalizeMediaGenerateWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  if (name !== 'media_generate') return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || args.kind || args.type || '').trim().toLowerCase();
  if (!action) return { name, args, error: 'media_generate requires action "image" or "video".' };
  delete args.action;
  delete args.kind;
  delete args.type;
  if (action === 'image' || action === 'images') return { name: 'generate_image', args };
  if (action === 'video' || action === 'videos') return { name: 'generate_video', args };
  return { name, args: rawArgs, error: `Unsupported media_generate action "${action}".` };
}

export function normalizePromRepoOpsWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  if (name !== 'prom_repo_ops') return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || args.operation || args.mode || '').trim().toLowerCase();
  if (!action) return { name, args, error: 'prom_repo_ops requires action "push", "pull", or "sync".' };
  delete args.action;
  delete args.operation;
  delete args.mode;
  if (action === 'push') return { name: 'prom_repo_push', args };
  if (action === 'pull') return { name: 'prom_repo_pull', args };
  if (action === 'sync') return { name: 'prom_repo_sync', args };
  return { name, args: rawArgs, error: `Unsupported prom_repo_ops action "${action}".` };
}

export function normalizeBackgroundOpsWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  if (name !== 'background_ops') return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || args.operation || args.mode || '').trim().toLowerCase();
  if (!action) return { name, args, error: 'background_ops requires action "spawn", "steer", "status", "progress", "wait", or "join".' };
  delete args.action;
  delete args.operation;
  delete args.mode;
  if (action === 'spawn' || action === 'start') return { name: 'background_spawn', args };
  if (action === 'steer' || action === 'message') return { name: 'background_steer', args };
  if (action === 'status') return { name: 'background_status', args };
  if (action === 'progress') return { name: 'background_progress', args };
  if (action === 'wait') return { name: 'background_wait', args };
  if (action === 'join') return { name: 'background_join', args };
  return { name, args: rawArgs, error: `Unsupported background_ops action "${action}".` };
}

export function normalizeSkillOpsWrapperTool(name: string, rawArgs: any): { name: string; args: any; error?: string } | null {
  if (name !== 'skill_ops') return null;
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || args.operation || args.mode_action || '').trim().toLowerCase();
  if (!action) return { name, args, error: 'skill_ops requires an action.' };
  delete args.action;
  delete args.operation;
  delete args.mode_action;
  const map: Record<string, string> = {
    inspect: 'skill_inspect',
    resource_list: 'skill_resource_list',
    list_resources: 'skill_resource_list',
    resource_read: 'skill_resource_read',
    read_resource: 'skill_resource_read',
    resource_write: 'skill_resource_write',
    write_resource: 'skill_resource_write',
    resource_delete: 'skill_resource_delete',
    delete_resource: 'skill_resource_delete',
    update_metadata: 'skill_update_metadata',
    metadata_update: 'skill_update_metadata',
    manifest_write: 'skill_manifest_write',
    write_manifest: 'skill_manifest_write',
    import_bundle: 'skill_import_bundle',
    import: 'skill_import_bundle',
    export_bundle: 'skill_export_bundle',
    export: 'skill_export_bundle',
    update_from_source: 'skill_update_from_source',
    refresh_from_source: 'skill_update_from_source',
    create: 'skill_create',
    create_bundle: 'skill_create_bundle',
    audit_all: 'skill_audit_all',
    audit: 'skill_audit_all',
    repair_metadata: 'skill_repair_metadata',
    repair: 'skill_repair_metadata',
  };
  const target = map[action];
  if (!target) return { name, args: rawArgs, error: `Unsupported skill_ops action "${action}".` };
  return { name: target, args };
}

export function collectDeliveryFilePaths(args: Record<string, any>): string[] {
  const rows: string[] = [];
  const add = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    if (value && typeof value === 'object') {
      add((value as any).path ?? (value as any).filename ?? (value as any).file ?? (value as any).attachmentPath);
      return;
    }
    const text = String(value ?? '').trim();
    if (text) rows.push(text);
  };
  add(args.paths);
  add(args.files);
  add(args.attachmentPaths);
  add(args.path);
  add(args.filename);
  add(args.attachmentPath);
  return Array.from(new Set(rows));
}