import { buildToolOutputArtifactPreview } from './../tool-result-model-context';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getConfig, getResolvedConfigDir } from './../../config/config';
import { getToolPermissionMode } from './../tool-approval-mode';
import { getActiveAllowedWorkspaces, hasActiveWorkspaceScope } from './../../tools/workspace-context';
import { isCanonicalPathInsideSync } from './../../tools/workspace-boundary';
import { findPathSuggestions } from './workspace-path-recovery';
import { createWorkspaceSnapshot, toSnapshotRef } from './../../workspace-history';
import { formatPhysicalLineWindow, formatSyntaxValidationResult, resolvePositiveLineArg, resolveResultCharBudget, validateFileSyntax } from './../../tools/file-intelligence';
import { applyLineEndingTolerantFindReplace, splitLinesEolSafe } from './../dev-source-patchset';
import { normalizeWorkspaceAliasPath } from './../scheduled-output-guard';
import { getBrowserSessionInfo } from './../browser-tools';
import { getDesktopActiveWindowInfo } from './../desktop-tools';
import { type ToolResult } from './../tool-builder';
import { getSessionMutationScope } from './../session';
import { classifyCommandTermination } from './../process/command-outcome';
import { getTaskSessionLookupRevision } from './../tasks/task-store';
import { resolvePrometheusRoot } from './../../runtime/distribution.js';
import { type ToolPermissionCandidate } from './../command-permissions';
import { isSessionAllowedPath } from './../path-permissions';
import { DEV_SRC_SELF_EDIT_MODE, DEV_SRC_SELF_EDIT_REPAIR_MODE } from './../proposals/dev-src-self-edit.js';
import { getDevSourceEditGrant, hasDevSourceEditGrant } from './../dev-source-approvals.js';
import { claimCoordinatedDevEditFile } from './../dev-edit-coordinator.js';
import { FILE_TOOL_DEFAULT_READ_LINES, FILE_TOOL_READ_INLINE_LIMIT_CHARS, trimReturnedFileLine, commandContainsBlockedPattern, isProposalLikeSourceSessionId, isProposalExecutionSession, resolveTaskForSession, normalizeTypeScriptModule } from './subagent-executor';
import type { ExecuteToolDeps } from './subagent-executor';
export interface WorkspaceHelperContext { name: string; args: Parameters<typeof import('./subagent-executor').executeTool>[1]; workspacePath: string; deps: ExecuteToolDeps; sessionId: string; allowWorkspaceSourceCopy: boolean; __dirname: string; updateArgs: (args: WorkspaceHelperContext['args']) => void; }

let cachedSourceAccessRoot: { workspace: string; sessionId: string; taskRevision: number; root: string } | null = null;
export function createWorkspaceHelpers(ctx: WorkspaceHelperContext) {
 let { name, args, workspacePath, deps, sessionId, allowWorkspaceSourceCopy, __dirname } = ctx;


	  const _isProposalSession = isProposalExecutionSession(sessionId);
  function hasPrometheusSourceShape(candidateRoot: string): boolean {
    const root = path.resolve(String(candidateRoot || ''));
    return fs.existsSync(path.join(root, 'package.json'))
      && fs.existsSync(path.join(root, 'src'))
      && fs.existsSync(path.join(root, 'web-ui'));
  }
  function candidateProjectRootsFromAllowedWorkspaces(configuredWorkspace: string): string[] {
    if (!hasActiveWorkspaceScope()) return [];
    const roots = getActiveAllowedWorkspaces(configuredWorkspace, []);
    const candidates: string[] = [];
    for (const rawRoot of roots) {
      const allowedRoot = path.resolve(String(rawRoot || ''));
      if (!allowedRoot) continue;
      candidates.push(allowedRoot);
      const base = path.basename(allowedRoot).toLowerCase();
      if (base === 'src' || base === 'web-ui') {
        candidates.push(path.dirname(allowedRoot));
      }
    }
    return candidates;
  }
	  function resolveProjectRootForSourceAccess(): string {
      const configuredWorkspace = path.resolve(getConfig().getWorkspacePath() || workspacePath);
      const workspaceRoot = path.resolve(workspacePath);
      // In the normal main-chat path this is stable for the lifetime of a
      // workspace. Check this before any task/proposal lookup: otherwise a
      // tiny source read used to deserialize every historical task first.
      if (!hasActiveWorkspaceScope() && cachedSourceAccessRoot?.workspace === configuredWorkspace
        && cachedSourceAccessRoot.sessionId === sessionId
        && cachedSourceAccessRoot.taskRevision === getTaskSessionLookupRevision()
        && hasPrometheusSourceShape(cachedSourceAccessRoot.root)) {
        return cachedSourceAccessRoot.root;
      }
      const proposalTask = resolveProposalExecutionTask();
      const explicitProjectRoot = String(proposalTask?.proposalExecution?.projectRoot || '').trim();
      if (explicitProjectRoot) {
        return path.resolve(explicitProjectRoot);
      }
      const scopedCandidates = candidateProjectRootsFromAllowedWorkspaces(configuredWorkspace);
      const candidates = hasActiveWorkspaceScope()
        ? scopedCandidates
        : [
            resolvePrometheusRoot(),
            path.dirname(configuredWorkspace),
            configuredWorkspace,
            path.dirname(workspaceRoot),
          ];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        if (seen.has(key)) continue;
        seen.add(key);
        if (hasPrometheusSourceShape(resolved)) {
          if (!hasActiveWorkspaceScope()) {
            cachedSourceAccessRoot = {
              workspace: configuredWorkspace,
              sessionId,
              taskRevision: getTaskSessionLookupRevision(),
              root: resolved,
            };
          }
          return resolved;
        }
      }
	    return path.resolve(workspacePath, '..');
	  }
  const PROM_ROOT_ALLOWED_ROOT_FILES = new Set([
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'README.md',
    'CHANGELOG.md',
    'SELF.md',
    'AGENTS.md',
  ]);
  const PROM_ROOT_ALLOWED_DIRECTORIES = new Set([
    '.prometheus',
    'scripts',
    'electron',
    'build',
    'dist',
    'src',
    'web-ui',
  ]);
  const PROM_ROOT_DENIED_TOP_LEVEL = new Set([
    '.git',
    'node_modules',
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.env.test',
    '.npm',
    '.cache',
    '.turbo',
    '.next',
    '.pnpm-store',
  ]);
  function normalizePromPath(input: unknown): string {
    const normalized = String(input || '').replace(/\\/g, '/').trim();
    if (!normalized || normalized === '.' || normalized === './') return '';
    return normalized.replace(/^\.?\//, '').replace(/\/+$|^\/$/g, '');
  }
  function isPromDeniedPath(normalizedRel: string): boolean {
    if (!normalizedRel) return false;
    const topLevel = normalizedRel.split('/')[0]?.toLowerCase() || '';
    if (!topLevel) return false;
    if (PROM_ROOT_DENIED_TOP_LEVEL.has(topLevel)) return true;
    return topLevel.includes('secret') || topLevel.includes('credential');
  }
  function isPromAllowedPath(normalizedRel: string): boolean {
    if (!normalizedRel) return true;
    if (isPromDeniedPath(normalizedRel)) return false;
    if (PROM_ROOT_ALLOWED_ROOT_FILES.has(normalizedRel)) return true;
    const topLevel = normalizedRel.split('/')[0] || '';
    return PROM_ROOT_ALLOWED_DIRECTORIES.has(topLevel);
  }
  function promAllowlistSummary(): string {
    return `${Array.from(PROM_ROOT_ALLOWED_ROOT_FILES).join(', ')} and directories ${Array.from(PROM_ROOT_ALLOWED_DIRECTORIES).join(', ')}/`;
  }
	  function resolvePromAllowedPath(projectRoot: string, rel: string): { absPath: string; normalizedRel: string } {
	    const normalizedRel = normalizePromPath(rel);
	    if (!isPromAllowedPath(normalizedRel)) {
	      throw new Error(`Path "${normalizedRel || '.'}" is outside the prom-root allowlist. Allowed surfaces: ${promAllowlistSummary()}.`);
	    }
    const absPath = normalizedRel ? path.resolve(projectRoot, normalizedRel) : projectRoot;
    if (!absPath.startsWith(projectRoot)) {
      throw new Error('Path escapes the Prometheus project root.');
	    }
	    return { absPath, normalizedRel };
	  }
	  function resolvePromAllowedFilePath(projectRoot: string, rel: string): { absPath: string; normalizedRel: string } {
	    const resolved = resolvePromAllowedPath(projectRoot, rel);
	    if (!resolved.normalizedRel) {
	      throw new Error('A file path is required; refusing to edit the Prometheus project root directory.');
	    }
	    return resolved;
	  }
	  function ensureProposalPromWriteTool(toolName: string): ToolResult | null {
        return ensureDevSrcSelfEditWriteSession(toolName, 'prom-root');
		  }
  function writeToolResultOverflow(toolName: string, output: string): string | null {
    try {
      const safeTool = String(toolName || 'tool')
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'tool';
      const safeSession = String(sessionId || 'default')
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'default';
      // Spool into the Prometheus workspace even when this run is scoped to a
      // different work dir (a background agent in a repo worktree), so overflow
      // files never show up as untracked changes in that repo.
      const spoolRoot = hasActiveWorkspaceScope()
        ? path.resolve(getConfig().getWorkspacePath() || workspacePath)
        : path.resolve(workspacePath);
      const dir = path.resolve(spoolRoot, 'temp', 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      const file = `${Date.now()}-${safeSession}-${safeTool}.txt`;
      const absPath = path.join(dir, file);
      fs.writeFileSync(absPath, output, 'utf-8');
      const rel = path.relative(path.resolve(workspacePath), absPath);
      return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : absPath).replace(/\\/g, '/');
    } catch {
      return null;
    }
  }
  function maybeSpoolToolOutput(toolName: string, output: string, inlineLimit: number, opts: { allowInline?: boolean; summary?: string } = {}): string {
    const text = String(output || '');
    if (opts.allowInline || text.length <= inlineLimit) return text;
    const relPath = writeToolResultOverflow(toolName, text);
    if (!relPath) {
      return `${opts.summary ? `${opts.summary}\n` : ''}[TOOL_RESULT_TRUNCATED] Output was ${text.length} chars; returning first ${inlineLimit} chars because overflow artifact write failed.\n${text.slice(0, inlineLimit)}`;
    }
    return buildToolOutputArtifactPreview({
      toolName,
      text,
      inlineLimit,
      artifactPath: relPath,
      summary: opts.summary,
    });
  }
	  function renderNumberedRead(displayPath: string, allLines: string[], argsObj: any, defaultCap = FILE_TOOL_DEFAULT_READ_LINES): string {
    const exactLine = resolvePositiveLineArg(argsObj.line ?? argsObj.line_number ?? argsObj.lineNumber ?? argsObj.physical_line);
    if (exactLine != null) {
      const renderedLine = formatPhysicalLineWindow(displayPath, allLines, {
        line: exactLine,
        column: argsObj.column != null ? Number(argsObj.column) : undefined,
        char_window: argsObj.char_window ?? argsObj.charWindow,
        full_line: argsObj.full_line === true || argsObj.fullLine === true,
        show_full_line: argsObj.show_full_line === true || argsObj.showFullLine === true,
      });
      return maybeSpoolToolOutput(name, renderedLine, resolveResultCharBudget(argsObj, FILE_TOOL_READ_INLINE_LIMIT_CHARS), {
        allowInline: argsObj.inline === true || argsObj.no_spool === true,
        summary: `${displayPath} exact physical-line read exceeded inline budget. Requested line ${exactLine}.`,
      });
    }
    const head = argsObj.head ? Number(argsObj.head) : 0;
    const tail = argsObj.tail ? Number(argsObj.tail) : 0;
    const aroundLine = argsObj.around_line ?? argsObj.aroundLine ? Math.max(1, Math.floor(Number(argsObj.around_line ?? argsObj.aroundLine))) : 0;
    const beforeLines = Math.max(0, Math.min(240, Math.floor(Number(argsObj.before) || 40)));
    const afterLines = Math.max(0, Math.min(240, Math.floor(Number(argsObj.after) || 80)));
    const startLine = argsObj.start_line ? Math.max(1, Math.floor(Number(argsObj.start_line))) : 0;
    const numLines = argsObj.num_lines ? Math.max(1, Math.floor(Number(argsObj.num_lines))) : 0;
    const allowFull = argsObj.full === true || argsObj.full_file === true || argsObj.allow_large === true;
    const cap = Math.max(1, Math.min(480, Math.floor(Number(argsObj.max_lines) || defaultCap)));
    let sliced: string[];
    let firstLineNum: number;
    let requestedFull = false;
    if (aroundLine > 0) {
      const fromLine = Math.max(1, aroundLine - beforeLines);
      const requested = beforeLines + afterLines + 1;
      const window = allowFull ? requested : Math.min(requested, cap);
      sliced = allLines.slice(fromLine - 1, fromLine - 1 + window);
      firstLineNum = fromLine;
    } else if (startLine > 0) {
      const from = startLine - 1;
      const requested = numLines > 0 ? numLines : (allowFull ? allLines.length : cap);
      const window = allowFull ? requested : Math.min(requested, cap);
      const to = from + window;
      sliced = allLines.slice(from, to);
      firstLineNum = startLine;
    } else if (head > 0) {
      sliced = allLines.slice(0, allowFull ? head : Math.min(head, cap));
      firstLineNum = 1;
    } else if (tail > 0) {
      sliced = allLines.slice(-(allowFull ? tail : Math.min(tail, cap)));
      firstLineNum = allLines.length - sliced.length + 1;
    } else {
      requestedFull = true;
      sliced = allowFull ? allLines : allLines.slice(0, cap);
      firstLineNum = 1;
    }
    const endLine = firstLineNum + sliced.length - 1;
    const truncated = sliced.length < allLines.length || (startLine > 0 && endLine < allLines.length);
    const range = sliced.length ? ` [window ${firstLineNum}-${endLine}${truncated ? ', truncated' : ''}]` : '';
    const hint = truncated
      ? `\n[READ_TRUNCATED] Returned ${sliced.length} of ${allLines.length} lines. Use start_line:${endLine + 1}, num_lines:${cap} for the next chunk, or pass full:true only when the whole file is truly needed.`
      : '';
    const fullHint = requestedFull && !allowFull && truncated
      ? `\n[READ_DEFAULT_CAP] Whole-file reads are capped by default to control context usage.`
      : '';
    const numbered = sliced.map((line, i) => `${firstLineNum + i}: ${trimReturnedFileLine(line)}`).join('\n');
    const rendered = `${displayPath} (${allLines.length} lines)${range}:\n${numbered}${fullHint}${hint}`;
    return maybeSpoolToolOutput(name, rendered, resolveResultCharBudget(argsObj, FILE_TOOL_READ_INLINE_LIMIT_CHARS), {
      allowInline: argsObj.inline === true || argsObj.no_spool === true,
      summary: `${displayPath} (${allLines.length} lines) read result exceeded inline budget. Requested window ${firstLineNum}-${endLine}.`,
    });
  }
  function validateSyntaxFileResult(displayPath: string, absPath: string): ToolResult {
    const content = fs.readFileSync(absPath, 'utf-8');
    const validation = validateFileSyntax(displayPath, content);
    return {
      name,
      args,
      result: formatSyntaxValidationResult(validation),
      error: validation.supported && !validation.ok,
      data: validation,
    };
  }
  function normalizeFindTextForRecovery(text: string): string {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }
  function tokenSetForRecovery(text: string): Set<string> {
    return new Set(
      normalizeFindTextForRecovery(text)
        .toLowerCase()
        .split(/[^a-z0-9_$]+/i)
        .filter((token) => token.length >= 2)
    );
  }
  function countCommonTokensForRecovery(left: Set<string>, right: Set<string>): number {
    let common = 0;
    for (const token of left) {
      if (right.has(token)) common += 1;
    }
    return common;
  }
  function renderCandidateSnippetForRecovery(allLines: string[], startLine: number, endLine: number): string {
    const clampedStart = Math.max(1, Math.min(startLine, allLines.length || 1));
    const clampedEnd = Math.max(clampedStart, Math.min(endLine, allLines.length || clampedStart));
    const snippet = allLines
      .slice(clampedStart - 1, clampedEnd)
      .map((line, index) => `${clampedStart + index}: ${line}`)
      .join('\n');
    return snippet || `${clampedStart}:`;
  }
  // Line-ending–tolerant find/replace. LLMs emit `\n` in their find/replace
  // text, but files on disk (especially on Windows checkouts) are often CRLF,
  // so a strict content.includes(find) misses every multi-line edit. This tries
  // the exact text first, then an all-CRLF and an all-LF variant, and aligns the
  // replacement's newlines to the file so we never introduce mixed line endings.
  // Returns null when nothing matches (caller then builds the recovery message).
  function applyTolerantFindReplace(
    content: string,
    find: string,
    replace: string,
    replaceAll: boolean,
  ): { updated: string; count: number; variant: string; firstIndex: number } | null {
    return applyLineEndingTolerantFindReplace(content, find, replace, replaceAll);
  }

  function lineNumberAtOffset(content: string, offset: number): number {
    const target = Math.max(0, Math.floor(Number(offset) || 0));
    let line = 1;
    for (let index = 0; index < Math.min(target, content.length); index += 1) {
      if (content.charCodeAt(index) === 10) line += 1;
    }
    return line;
  }

  function formatPostEditContext(
    displayPath: string,
    content: string,
    changedStartLine: number,
    changedEndLine: number,
    summary: string,
    opts: { before?: number; after?: number; maxChars?: number } = {},
  ): string {
    const lines = splitLinesEolSafe(String(content || ''));
    const lineCount = lines.length;
    const start = Math.max(1, Math.min(Math.floor(Number(changedStartLine) || 1), Math.max(1, lineCount)));
    const end = Math.max(start, Math.min(Math.floor(Number(changedEndLine) || start), Math.max(1, lineCount)));
    const before = Math.max(0, Math.min(12, Math.floor(Number(opts.before) || 3)));
    const after = Math.max(0, Math.min(12, Math.floor(Number(opts.after) || 3)));
    const snippetStart = Math.max(1, start - before);
    const snippetEnd = Math.min(lineCount, end + after);
    const maxChars = Math.max(120, Math.min(1200, Math.floor(Number(opts.maxChars) || 360)));
    const snippet = lines.slice(snippetStart - 1, snippetEnd)
      .map((line, index) => {
        const lineNumber = snippetStart + index;
        const marker = lineNumber >= start && lineNumber <= end ? '>' : ' ';
        return `${marker} ${lineNumber}: ${trimReturnedFileLine(line, maxChars)}`;
      })
      .join('\n');
    return [
      summary,
      `Changed lines: ${displayPath}:${start}-${end} (${lineCount} total lines)`,
      `Post-edit context:`,
      snippet || '(empty)',
    ].join('\n');
  }
  function buildTextNotFoundRecovery(displayPath: string, content: string, findText: string, readToolName: string): string {
    const allLines = splitLinesEolSafe(content);
    const findLines = splitLinesEolSafe(String(findText || ''));
    const normalizedFind = normalizeFindTextForRecovery(findText);
    const targetWindow = Math.max(1, Math.min(40, findLines.length || 1));
    const candidates: Array<{ reason: string; startLine: number; endLine: number; score: number }> = [];
    const seen = new Set<string>();
    const addCandidate = (reason: string, startLine: number, endLine: number, score: number) => {
      if (!Number.isFinite(startLine) || startLine < 1) return;
      const clampedStart = Math.max(1, Math.min(startLine, allLines.length || 1));
      const clampedEnd = Math.max(clampedStart, Math.min(endLine, allLines.length || clampedStart));
      const key = `${clampedStart}:${clampedEnd}:${reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ reason, startLine: clampedStart, endLine: clampedEnd, score });
    };

    if (normalizedFind) {
      const minWindow = Math.max(1, targetWindow - 2);
      const maxWindow = Math.min(Math.max(targetWindow + 4, minWindow), 48);
      for (let size = minWindow; size <= maxWindow; size += 1) {
        for (let index = 0; index <= Math.max(0, allLines.length - size); index += 1) {
          const block = allLines.slice(index, index + size).join('\n');
          const normalizedBlock = normalizeFindTextForRecovery(block);
          if (normalizedBlock && (normalizedBlock === normalizedFind || normalizedBlock.includes(normalizedFind) || normalizedFind.includes(normalizedBlock))) {
            addCandidate('same text with normalized whitespace', index + 1, index + size, 1000 - Math.abs(size - targetWindow));
          }
        }
      }
    }

    const trimmedFindLines = findLines.map((line) => line.trim()).filter(Boolean);
    const prefixAnchor = trimmedFindLines[0] || '';
    const suffixAnchor = trimmedFindLines[trimmedFindLines.length - 1] || '';
    if (prefixAnchor.length >= 8) {
      allLines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (trimmedLine && (trimmedLine.includes(prefixAnchor) || prefixAnchor.includes(trimmedLine))) {
          addCandidate('matching prefix anchor', index + 1, index + targetWindow, 800);
        }
      });
    }
    if (suffixAnchor.length >= 8 && suffixAnchor !== prefixAnchor) {
      allLines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (trimmedLine && (trimmedLine.includes(suffixAnchor) || suffixAnchor.includes(trimmedLine))) {
          addCandidate('matching suffix anchor', index + 2 - targetWindow, index + 1, 780);
        }
      });
    }

    const findTokens = tokenSetForRecovery(findText);
    if (findTokens.size > 0) {
      const closestWindow = Math.min(Math.max(targetWindow, 4), 30);
      for (let index = 0; index <= Math.max(0, allLines.length - closestWindow); index += 1) {
        const block = allLines.slice(index, index + closestWindow).join('\n');
        const blockTokens = tokenSetForRecovery(block);
        const common = countCommonTokensForRecovery(findTokens, blockTokens);
        const union = new Set([...findTokens, ...blockTokens]).size || 1;
        const score = common / union;
        if (common >= 2 || score >= 0.25) {
          addCandidate('closest token block', index + 1, index + closestWindow, Math.round(score * 500));
        }
      }
    }

    const top = candidates
      .sort((a, b) => b.score - a.score || a.startLine - b.startLine)
      .filter((candidate, index, list) => list.findIndex((other) => Math.abs(other.startLine - candidate.startLine) <= 2) === index)
      .slice(0, 3);
    if (!top.length) {
      return `ERROR: Text not found in ${displayPath}. No close candidate found. Use ${readToolName} to confirm exact text including whitespace.`;
    }
    const rendered = top.map((candidate, index) => {
      const snippetStart = Math.max(1, candidate.startLine - 2);
      const snippetEnd = Math.min(allLines.length, candidate.endLine + 2);
      return `${index + 1}) ${candidate.reason}, lines ${candidate.startLine}-${candidate.endLine}:\n${renderCandidateSnippetForRecovery(allLines, snippetStart, snippetEnd)}`;
    }).join('\n\n');
    return `ERROR: Text not found in ${displayPath}. Likely intended locations:\n${rendered}\n\nNext: retry with an exact snippet from one candidate, or call ${readToolName} around the candidate lines.`;
  }
  function scorePathSuggestion(requestedRel: string, candidateRel: string): number {
    const requested = String(requestedRel || '').toLowerCase().replace(/\\/g, '/');
    const candidate = String(candidateRel || '').toLowerCase().replace(/\\/g, '/');
    const requestedBase = path.basename(requested);
    const candidateBase = path.basename(candidate);
    let score = 0;
    if (candidate === requested) score += 1000;
    if (candidate.endsWith(requested)) score += 600;
    if (candidateBase === requestedBase) score += 500;
    if (candidate.includes(requestedBase) && requestedBase) score += 220;
    if (requested.includes(candidateBase) && candidateBase) score += 120;
    const requestedParts = requested.split(/[\/._-]+/).filter(Boolean);
    const candidateParts = new Set(candidate.split(/[\/._-]+/).filter(Boolean));
    for (const part of requestedParts) {
      if (candidateParts.has(part)) score += 40;
      else if (part.length >= 3 && candidate.includes(part)) score += 15;
    }
    score -= Math.abs(candidate.length - requested.length) / 8;
    return score;
  }
  async function buildPathNotFoundRecovery(
    displayPath: string,
    rootDir: string,
    requestedRel: string,
    browseToolName: string,
    options: { displayPrefix?: string; directoriesOnly?: boolean; include?: (rel: string, isDirectory: boolean) => boolean } = {}
  ): Promise<string> {
    const ranked = await findPathSuggestions({
      rootDir,
      score: (rel) => scorePathSuggestion(requestedRel, rel),
      directoriesOnly: options.directoriesOnly,
      include: options.include,
    });
    const top = ranked.slice(0, 3);
    if (!top.length) {
      return `ERROR: ${displayPath} not found. No close path candidate found. Use ${browseToolName} to browse nearby files.`;
    }
    const prefix = options.displayPrefix || '';
    const rendered = top
      .map((item, index) => `${index + 1}) ${prefix}${item.rel}${item.isDirectory ? '/' : ''}`)
      .join('\n');
    return `ERROR: ${displayPath} not found. Likely intended paths:\n${rendered}\n\nNext: retry with one candidate, or use ${browseToolName} to browse nearby files.`;
  }

  function buildLineOutOfRangeRecovery(displayPath: string, allLines: string[], requestedLine: number, readToolName: string, lineLabel = 'line'): string {
    const lineCount = allLines.length;
    const tailStart = Math.max(1, lineCount - 7);
    const tail = renderCandidateSnippetForRecovery(allLines, tailStart, lineCount);
    return `ERROR: ${lineLabel} ${requestedLine} past end of ${displayPath} (${lineCount} lines).\nLast lines:\n${tail}\n\nNext: use ${readToolName} with start_line near ${tailStart}, or retry with a line <= ${lineCount}.`;
  }
  async function recoverWorkspacePathError(err: any, requested: unknown, browseToolName = 'list_dir'): Promise<string> {
    const message = String(err?.message || err);
    if (/not found/i.test(message)) {
      const requestedRel = String(requested || '').replace(/\\/g, '/');
      return await buildPathNotFoundRecovery(requestedRel, workspacePath, requestedRel, browseToolName);
    }
    return `ERROR: ${message}`;
  }
	  function renderDirectoryEntries(absPath: string): string[] {
    return fs.readdirSync(absPath).map((entry) => {
      try {
        const stat = fs.statSync(path.join(absPath, entry));
        return stat.isDirectory() ? `[DIR]  ${entry}/` : `[FILE] ${entry}`;
      } catch {
        return `[??]   ${entry}`;
      }
    });
  }
  function normalizePathForPermissionCompare(p: string): string {
    const resolved = path.resolve(String(p || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
  function isPathInsideForPermissions(basePath: string, targetPath: string): boolean {
    try {
      return isCanonicalPathInsideSync(basePath, targetPath);
    } catch {
      return false;
    }
  }
  /**
 * Runtime diagnostic directories that read-only search/read tools may open.
 * These hold restart, watchdog, turn-timing, process and tool-observation
 * evidence. Deliberately excludes the config dir root itself (config.json,
 * vault, credentials) — only named log/telemetry subdirectories.
 */
function getRuntimeDiagnosticsReadRoots(): string[] {
  try {
    const configDir = getResolvedConfigDir();
    if (!configDir) return [];
    // `runtimes` holds active-runtimes.json / runtime-events.ndjson: the
    // restart-recovery and interruption records. No credentials live there.
    return ['logs', path.join('processes', 'logs'), 'tool-observations', 'runtimes'].map((sub) => path.resolve(configDir, sub));
  } catch {
    return [];
  }
}

function resolveAllowedWorkspacePath(relPath: string, opts: { requireFile?: boolean; requireDirectory?: boolean; allowEmpty?: boolean; readOnlyDiagnostics?: boolean } = {}): { absPath: string; normalizedRel: string; displayPath: string } {
    const raw = String(relPath ?? '').trim();
    if (!raw && !opts.allowEmpty) throw new Error('path is required');
    const root = path.resolve(workspacePath);
    const normalizedInput = normalizeWorkspaceAliasPath(raw, root);
    const cfg = getConfig().getConfig() as any;
    const configuredWorkspace = path.resolve(String(cfg?.workspace?.path || workspacePath));
    const isPrimaryWorkspaceRun = normalizePathForPermissionCompare(root) === normalizePathForPermissionCompare(configuredWorkspace);
    const permissions = cfg?.tools?.permissions?.files || {};
    const configuredAllowed = Array.isArray(permissions.allowed_paths) ? permissions.allowed_paths : [];
    const allowedRoots = hasActiveWorkspaceScope()
      ? getActiveAllowedWorkspaces(configuredWorkspace, configuredAllowed)
      : isPrimaryWorkspaceRun
      ? Array.from(new Set([root, ...configuredAllowed.map((p: any) => String(p || '').trim()).filter(Boolean)].map((p) => path.resolve(p))))
      : [root];
    // Read-only search/read of runtime diagnostics (turn timing, process logs,
    // tool observations) must work: that is where restart/watchdog evidence
    // lives. Never extended to writes, and never to credential-bearing files.
    if (opts.readOnlyDiagnostics && isPrimaryWorkspaceRun) {
      for (const diag of getRuntimeDiagnosticsReadRoots()) {
        if (!allowedRoots.some((r: string) => normalizePathForPermissionCompare(r) === normalizePathForPermissionCompare(diag))) allowedRoots.push(diag);
      }
    }
    const blockedRoots = Array.isArray(permissions.blocked_paths)
      ? permissions.blocked_paths.map((p: any) => String(p || '').trim()).filter(Boolean).map((p: string) => path.resolve(p))
      : [];
    const requested = raw || '.';
    const absPath = path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(path.join(root, normalizedInput || '.'));

    for (const blocked of blockedRoots) {
      if (isPathInsideForPermissions(blocked, absPath)) {
        throw new Error(`Path is in blocked directory: ${blocked}`);
      }
    }
    if (!allowedRoots.some((allowed) => isPathInsideForPermissions(allowed, absPath))) {
      throw new Error(`Path "${requested}" is outside allowed directories. Allowed: ${allowedRoots.join(', ')}`);
    }
    if (opts.requireFile) {
      if (!fs.existsSync(absPath)) throw new Error(`File "${requested}" not found`);
      if (!fs.statSync(absPath).isFile()) throw new Error(`"${requested}" is not a file`);
    }
    if (opts.requireDirectory) {
      if (!fs.existsSync(absPath)) throw new Error(`"${requested}" not found`);
      if (!fs.statSync(absPath).isDirectory()) throw new Error(`"${requested}" is not a directory`);
    }
    const insideWorkspace = isPathInsideForPermissions(root, absPath);
    const normalizedRel = insideWorkspace ? (path.relative(root, absPath).replace(/\\/g, '/') || '.') : absPath;
    const displayPath = insideWorkspace ? normalizedRel : absPath;
    return { absPath, normalizedRel, displayPath };
  }
	  function resolveFilePath(filename: string): string {
	    const normalized = String(filename || '').replace(/\\/g, '/');
	    if (_isProposalSession && normalized.startsWith('src/')) {
	      return path.join(resolveProjectRootForSourceAccess(), normalized);
	    }
	    return path.join(workspacePath, filename);
	  }
	  function resolveWorkspacePath(relPath: string, opts: { requireFile?: boolean } = {}): { absPath: string; normalizedRel: string } {
	    const resolved = resolveAllowedWorkspacePath(relPath, opts);
	    return { absPath: resolved.absPath, normalizedRel: resolved.normalizedRel };
	  }
  function snapshotPreMutation(target: { absPath: string; normalizedRel?: string; displayPath?: string }, operation: string) {
    return toSnapshotRef(createWorkspaceSnapshot({
      workspacePath,
      targetPath: target.absPath,
      displayPath: target.displayPath || target.normalizedRel,
      operation,
    }));
  }
  function withWorkspaceSnapshots<T extends ToolResult>(result: T, snapshots: Array<ReturnType<typeof snapshotPreMutation>>): T {
    const refs = snapshots.filter(Boolean);
    if (!refs.length) return result;
    return {
      ...result,
      data: { ...(result.data || {}), workspaceSnapshots: refs },
      extra: { ...(result.extra || {}), workspaceSnapshots: refs },
    };
  }
  function resolveWorkspaceDirectory(relPath: string, opts: { allowEmpty?: boolean } = {}): { absPath: string; normalizedRel: string; displayPath: string } {
    return resolveAllowedWorkspacePath(relPath, { requireDirectory: true, allowEmpty: opts.allowEmpty === true });
  }
  function quoteArg(value: string): string {
    const raw = String(value || '');
    return `"${raw.replace(/"/g, '\\"')}"`;
  }
  function truncateText(value: string, maxChars = 12000): string {
    const text = String(value || '');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]` : text;
  }
  function isSkippableWorkspaceEntry(entry: string): boolean {
    return new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', '.turbo', '.prometheus/snapshots']).has(entry.replace(/\\/g, '/'));
  }
  function walkFiles(rootDir: string, options: { maxFiles?: number; maxBytes?: number; includeHidden?: boolean } = {}): Array<{ absPath: string; relPath: string; size: number }> {
    const maxFiles = Math.max(1, Math.min(20000, Number(options.maxFiles || 5000)));
    const maxBytes = Math.max(1, Number(options.maxBytes || Number.MAX_SAFE_INTEGER));
    const root = path.resolve(rootDir);
    const out: Array<{ absPath: string; relPath: string; size: number }> = [];
    let totalBytes = 0;
    const walk = (dir: string) => {
      if (out.length >= maxFiles || totalBytes >= maxBytes) return;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (out.length >= maxFiles || totalBytes >= maxBytes) break;
        const abs = path.join(dir, entry.name);
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        if (!options.includeHidden && (entry.name.startsWith('.') || isSkippableWorkspaceEntry(rel) || rel.split('/').some(part => isSkippableWorkspaceEntry(part)))) {
          if (entry.isDirectory()) continue;
        }
        if (entry.isDirectory()) {
          if (isSkippableWorkspaceEntry(rel) || ['.git', 'node_modules', 'dist', 'build', '.next', '.cache', '.turbo'].includes(entry.name)) continue;
          walk(abs);
        } else if (entry.isFile()) {
          let stat: fs.Stats;
          try { stat = fs.statSync(abs); } catch { continue; }
          if (totalBytes + stat.size > maxBytes) break;
          totalBytes += stat.size;
          out.push({ absPath: abs, relPath: rel, size: stat.size });
        }
      }
    };
    walk(root);
    return out;
  }
  function countDirectoryFiles(absDir: string, maxEntries = 2000): { files: number; directories: number; bytes: number; truncated: boolean } {
    let files = 0;
    let directories = 0;
    let bytes = 0;
    let truncated = false;
    const walk = (dir: string) => {
      if (files + directories >= maxEntries) {
        truncated = true;
        return;
      }
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files + directories >= maxEntries) {
          truncated = true;
          return;
        }
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          directories += 1;
          walk(abs);
        } else if (entry.isFile()) {
          files += 1;
          try { bytes += fs.statSync(abs).size; } catch {}
        }
      }
    };
    walk(absDir);
    return { files, directories, bytes, truncated };
  }
  function extractPatchTargetPaths(patchText: string): string[] {
    const paths = new Set<string>();
    const normalize = (raw: string) => {
      let p = String(raw || '').trim().replace(/^"|"$/g, '');
      if (!p || p === '/dev/null') return '';
      if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
      return p;
    };
    for (const line of String(patchText || '').split(/\r?\n/)) {
      if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        const token = line.slice(4).trim().split(/\s+/)[0] || '';
        const p = normalize(token);
        if (p) paths.add(p);
      } else if (line.startsWith('rename from ')) {
        const p = normalize(line.slice('rename from '.length));
        if (p) paths.add(p);
      } else if (line.startsWith('rename to ')) {
        const p = normalize(line.slice('rename to '.length));
        if (p) paths.add(p);
      }
    }
    return Array.from(paths);
  }
  function validatePatchTargetPaths(patchText: string): string[] {
    const targets = extractPatchTargetPaths(patchText);
    if (!targets.length) throw new Error('No target paths found in patch. Include standard unified diff headers.');
    for (const target of targets) {
      if (path.isAbsolute(target)) throw new Error(`Patch path must be relative: ${target}`);
      resolveAllowedWorkspacePath(target, { allowEmpty: false });
    }
    return targets;
  }
  async function runCapturedToolCommand(command: string, cwd: string, timeoutMs = 120000): Promise<ToolResult> {
    const captured = await deps.runCommandCaptured(command, cwd, timeoutMs, { sessionId, toolCallId: deps.toolCallId, workspacePath });
    const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
    const outcome = classifyCommandTermination(captured);
    return {
      name,
      args,
      result: `${command} [${outcome.label}]\n${truncateText(output || '(no output)', 12000)}`,
      error: !outcome.ok,
      extra: {
        ...(captured.runId ? { runId: captured.runId } : {}),
        terminationReason: outcome.reason,
        signal: captured.signal ?? undefined,
        ...(captured.workspaceChanges ? {
          workspacePath: captured.workspacePath,
          workspaceChanges: captured.workspaceChanges,
          workspaceSnapshots: captured.workspaceSnapshots,
          workspaceChangeSource: captured.workspaceChangeSource,
          ...(captured.workspaceChangesTruncated ? { workspaceChangesTruncated: true } : {}),
        } : {}),
      },
    };
  }
  function readPackageScripts(cwd: string): Record<string, string> {
    try {
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return parsed?.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
    } catch {
      return {};
    }
  }
  function snapshotRoot(): string {
    return path.join(getConfig().getConfigDir(), 'snapshots');
  }
  function listSnapshots(): any[] {
    const root = snapshotRoot();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
      .map(id => {
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(root, id, 'manifest.json'), 'utf-8'));
          return { id, ...manifest };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }
  function isCodeFile(rel: string): boolean {
    return /\.(tsx?|jsx?|mjs|cjs)$/i.test(rel) && !rel.includes('/node_modules/') && !rel.includes('/dist/');
  }
  function getLineAndCharacterFromPos(text: string, pos: number): { line: number; character: number } {
    const prefix = text.slice(0, Math.max(0, pos));
    const lines = prefix.split(/\r?\n/);
    return { line: lines.length, character: (lines[lines.length - 1] || '').length + 1 };
  }
  async function buildCodeOutlineForFile(filePath: string, maxSymbols = 300): Promise<any> {
    const ts = normalizeTypeScriptModule(await import('typescript'));
    const content = fs.readFileSync(filePath, 'utf-8');
    const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : filePath.endsWith('.jsx') ? ts.ScriptKind.JSX : filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
    const symbols: any[] = [];
    const push = (node: any, type: string, nameValue: string) => {
      if (!nameValue || symbols.length >= maxSymbols) return;
      const start = getLineAndCharacterFromPos(content, node.getStart(sf));
      const end = getLineAndCharacterFromPos(content, node.getEnd());
      symbols.push({ type, name: nameValue, line: start.line, character: start.character, end_line: end.line });
    };
    const visit = (node: any) => {
      if (symbols.length >= maxSymbols) return;
      if (ts.isImportDeclaration(node)) push(node, 'import', (node.moduleSpecifier as any)?.text || '');
      else if (ts.isClassDeclaration(node)) push(node, 'class', node.name?.text || '<anonymous>');
      else if (ts.isFunctionDeclaration(node)) push(node, 'function', node.name?.text || '<anonymous>');
      else if (ts.isMethodDeclaration(node)) push(node, 'method', node.name?.getText(sf) || '');
      else if (ts.isInterfaceDeclaration(node)) push(node, 'interface', node.name?.text || '');
      else if (ts.isTypeAliasDeclaration(node)) push(node, 'type', node.name?.text || '');
      else if (ts.isEnumDeclaration(node)) push(node, 'enum', node.name?.text || '');
      else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations || []) push(decl, 'variable', decl.name?.getText(sf) || '');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return { file: path.relative(workspacePath, filePath).replace(/\\/g, '/'), symbols, count: symbols.length };
  }
  async function collectCodeSymbols(rootDir: string, query = '', maxResults = 100): Promise<any[]> {
    const files = walkFiles(rootDir, { maxFiles: 3000, maxBytes: 80_000_000 }).filter(f => isCodeFile(f.relPath));
    const q = query.trim().toLowerCase();
    const results: any[] = [];
    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const outline = await buildCodeOutlineForFile(file.absPath, 500);
        for (const sym of outline.symbols) {
          if (results.length >= maxResults) break;
          if (!q || String(sym.name || '').toLowerCase().includes(q)) results.push({ ...sym, file: outline.file });
        }
      } catch {}
    }
    return results;
  }
	  const mutationScope = getSessionMutationScope(sessionId);
	  const normalizeScopePath = (value: string): string =>
	    String(value || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
	  const isWithinAllowedDir = (normalizedRel: string, allowedDir: string): boolean =>
	    normalizedRel === allowedDir || normalizedRel.startsWith(`${allowedDir}/`);
	  function enforceMutationScope(relPath: string, kind: 'file' | 'dir', toolName: string): ToolResult | null {
	    if (!mutationScope) return null;
	    const normalizedRel = normalizeScopePath(relPath);
	    const allowedFiles = (mutationScope.allowedFiles || []).map(normalizeScopePath).filter(Boolean);
	    const allowedDirs = (mutationScope.allowedDirs || []).map(normalizeScopePath).filter(Boolean);
	    const allowed = kind === 'dir'
	      ? allowedDirs.some((dir) => isWithinAllowedDir(normalizedRel, dir))
	      : allowedFiles.some((file) => normalizedRel === file) || allowedDirs.some((dir) => isWithinAllowedDir(normalizedRel, dir));
	    if (allowed) return null;
	    const scopeSummary = [
	      allowedFiles.length ? `files: ${allowedFiles.join(', ')}` : '',
	      allowedDirs.length ? `dirs: ${allowedDirs.join(', ')}` : '',
	    ].filter(Boolean).join(' | ');
	    return {
	      name,
	      args,
	      result: `BLOCKED: ${toolName} cannot modify "${normalizedRel}" because it is outside the approved proposal scope. Allowed mutation scope: ${scopeSummary || 'none'}. If the proposal plan missed a required file, stop and request a revised proposal instead of editing unapproved files.`,
	      error: true,
	    };
	  }
		  function resolveProposalExecutionTask() {
		    const task = resolveTaskForSession(sessionId);
		    if (!task) return null;
		    return isProposalLikeSourceSessionId(String(task.sessionId || '')) ? task : null;
		  }
      function isDevSrcSelfEditProposalSession(): boolean {
	        const mode = resolveProposalExecutionTask()?.proposalExecution?.mode;
	        return mode === DEV_SRC_SELF_EDIT_MODE || mode === DEV_SRC_SELF_EDIT_REPAIR_MODE;
	      }
      function isDevSourceWriteApprovedSession(): boolean {
        return isDevSrcSelfEditProposalSession() || hasDevSourceEditGrant(sessionId);
      }
	      function ensureDevSrcSelfEditWriteSession(toolName: string, target: 'src' | 'web-ui' | 'prom-root'): ToolResult | null {
	        const proposalTask = resolveProposalExecutionTask();
        if (!proposalTask && !hasDevSourceEditGrant(sessionId)) {
          return {
            name: toolName,
            args,
            result: target === 'src'
              ? `ERROR: ${toolName} requires approval before editing Prometheus source. Use request_dev_source_edit for a dev-only fast approval, or write_proposal with execution_mode="code_change" for the full proposal lane.`
              : `ERROR: ${toolName} is only available for approved internal-code edit sessions.`,
            error: true,
          };
        }
	        if (proposalTask && !isDevSrcSelfEditProposalSession()) {
	          const targetLabel = target === 'src' ? 'src/' : target === 'web-ui' ? 'web-ui/' : 'prom-root';
	          return {
	            name: toolName,
	            args,
	            result: `BLOCKED: ${toolName} is not enabled for this proposal task. Automatic self-edit execution is restricted to approved code_change proposal tasks, so ${targetLabel} write access is unavailable here.`,
	            error: true,
	          };
	        }
        if (target === 'prom-root') {
          return {
            name: toolName,
            args,
            result: `BLOCKED: ${toolName} is disabled in code_change self-edit mode. Only approved src/ and web-ui/ files may be written in this proposal lane.`,
            error: true,
          };
        }
        return null;
      }
		  function enforceProposalWriteAccess(relPath: string, kind: 'file' | 'dir', toolName: string): ToolResult | null {
		    const proposalTask = resolveProposalExecutionTask();
        if (!proposalTask && hasDevSourceEditGrant(sessionId)) {
          const scopeBlock = enforceMutationScope(relPath, kind, toolName);
          if (scopeBlock || kind === 'dir') return scopeBlock;
          const grant = getDevSourceEditGrant(sessionId);
          const decision = claimCoordinatedDevEditFile({
            id: grant?.devEditId,
            sessionId,
            file: relPath,
          });
          if (decision.allowed) return null;
          const waitHint = grant?.devEditId
            ? ` Call dev_source_edit(action:"await_files", dev_edit_id:"${grant.devEditId}") to wait for the verified handoff, then reread the latest file before retrying.`
            : '';
          return {
            name: toolName,
            args,
            result: `BLOCKED BY DEV-EDIT FILE QUEUE: ${decision.reason || `${relPath} is owned by another dev edit.`}${waitHint}`,
            error: true,
          };
        }
        if (!proposalTask) {
          return {
            name,
            args,
            result: `BLOCKED: ${toolName} requires an approved proposal execution task.`,
            error: true,
          };
        }
        if (!isDevSourceWriteApprovedSession()) {
	          return {
	            name,
	            args,
	            result: `BLOCKED: ${toolName} is only enabled for approved dev src proposal tasks.`,
	            error: true,
	          };
	        }
		    const buildFailure = proposalTask?.proposalExecution?.buildFailure;
		    if (buildFailure && buildFailure.status !== 'resolved') {
		      const repairMessage = buildFailure.repairProposalId
	        ? `Repair proposal ${buildFailure.repairProposalId} is already waiting for review.`
	        : buildFailure.allowWriteProposal
	          ? 'Source edits are frozen; file exactly one repair proposal with write_proposal and then stop.'
	          : 'Source edits are frozen until a repair proposal is approved.';
	      return {
	        name,
	        args,
	        result: `BLOCKED: ${toolName} cannot modify files after this proposal run hit a build failure. ${repairMessage}`,
	        error: true,
	      };
		    }
		    return enforceMutationScope(relPath, kind, toolName);
		  }

  function resolveRunCommandCwd(rawCwd?: unknown): { cwd: string; displayCwd: string } {
    const requested = String(rawCwd || '').trim();
    if (requested) {
      const root = path.resolve(workspacePath);
      const resolved = path.isAbsolute(requested)
        ? path.resolve(requested)
        : path.resolve(path.join(root, normalizeWorkspaceAliasPath(requested, root) || '.'));
      const permissions = ((getConfig().getConfig() as any)?.tools?.permissions?.files || {});
      const blockedRoots = Array.isArray(permissions.blocked_paths)
        ? permissions.blocked_paths.map((p: any) => String(p || '').trim()).filter(Boolean).map((p: string) => path.resolve(p))
        : [];
      for (const blocked of blockedRoots) {
        if (isPathInsideForPermissions(blocked, resolved)) {
          throw new Error(`cwd is in blocked directory: ${blocked}`);
        }
      }
      if (!fs.existsSync(resolved)) throw new Error(`"${requested}" not found`);
      if (!fs.statSync(resolved).isDirectory()) throw new Error(`"${requested}" is not a directory`);
      const insideWorkspace = isPathInsideForPermissions(root, resolved);
      return {
        cwd: resolved,
        displayCwd: insideWorkspace ? (path.relative(root, resolved).replace(/\\/g, '/') || '.') : resolved,
      };
    }

    const root = path.resolve(workspacePath);
    const configuredWorkspace = path.resolve(String((getConfig().getConfig() as any)?.workspace?.path || workspacePath));
    const isPrimaryWorkspaceRun = normalizePathForPermissionCompare(root) === normalizePathForPermissionCompare(configuredWorkspace);
    if (isPrimaryWorkspaceRun) {
      const projectRoot = path.resolve(root, '..');
      if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
        return { cwd: projectRoot, displayCwd: projectRoot };
      }
    }
    return { cwd: root, displayCwd: '.' };
  }

  function getRunCommandAllowedRoots(): string[] {
    const root = path.resolve(workspacePath);
    const cfg = getConfig().getConfig() as any;
    const configuredWorkspace = path.resolve(String(cfg?.workspace?.path || workspacePath));
    const isPrimaryWorkspaceRun = normalizePathForPermissionCompare(root) === normalizePathForPermissionCompare(configuredWorkspace);
    const permissions = cfg?.tools?.permissions?.files || {};
    const configuredAllowed = Array.isArray(permissions.allowed_paths) ? permissions.allowed_paths : [];
    return hasActiveWorkspaceScope()
      ? getActiveAllowedWorkspaces(configuredWorkspace, configuredAllowed)
      : isPrimaryWorkspaceRun
      ? Array.from(new Set([root, ...configuredAllowed.map((p: any) => String(p || '').trim()).filter(Boolean)].map((p) => path.resolve(p))))
      : [root];
  }

  function extractAbsolutePathsFromCommand(command: string): string[] {
    const paths = new Set<string>();
    let text = String(command || '');
    const quotedWin = /["']([A-Za-z]:[\\/][^"']+)["']/g;
    const bareWin = /[A-Za-z]:[\\/][^\s"']+/g;
    const quotedPosix = /["'](\/[^"']+)["']/g;
    const barePosix = /(?<![\w:])\/[^\s"']{3,}/g;
    const quotedRe = process.platform === 'win32' ? quotedWin : quotedPosix;
    const bareRe = process.platform === 'win32' ? bareWin : barePosix;
    text = text.replace(quotedRe, (whole, inner) => {
      paths.add(String(inner || '').trim());
      return ' '.repeat(String(whole || '').length);
    });
    let match: RegExpExecArray | null;
    while ((match = bareRe.exec(text))) {
      paths.add(String(match[1] || match[0] || '').trim());
    }
    return Array.from(paths).filter(Boolean);
  }

  type CommandBoundaryScope = NonNullable<ToolPermissionCandidate['boundaryScope']>;
  type CommandBoundaryAnalysis = {
    scope: CommandBoundaryScope;
    reason: string;
    externalPaths: string[];
    pathAccessPaths: string[];
    environmentChanges: string[];
    packageManager?: string;
    requiresExplicitApproval: boolean;
    requiresAdmin: boolean;
    blocked?: ToolResult;
  };

  const boundaryRank: Record<CommandBoundaryScope, number> = {
    workspace: 0,
    user_profile: 1,
    global_tooling: 2,
    unknown_external: 3,
    system: 4,
    admin_required: 5,
  };

  function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  }

  function mergeCommandBoundary(base: CommandBoundaryAnalysis, next: Partial<CommandBoundaryAnalysis>): CommandBoundaryAnalysis {
    const nextScope = next.scope || base.scope;
    return {
      scope: boundaryRank[nextScope] > boundaryRank[base.scope] ? nextScope : base.scope,
      reason: uniqueStrings([base.reason, next.reason || '']).join(' '),
      externalPaths: uniqueStrings([...(base.externalPaths || []), ...(next.externalPaths || [])]),
      pathAccessPaths: uniqueStrings([...(base.pathAccessPaths || []), ...(next.pathAccessPaths || [])]),
      environmentChanges: uniqueStrings([...(base.environmentChanges || []), ...(next.environmentChanges || [])]),
      packageManager: next.packageManager || base.packageManager,
      requiresExplicitApproval: base.requiresExplicitApproval || next.requiresExplicitApproval === true,
      requiresAdmin: base.requiresAdmin || next.requiresAdmin === true,
      blocked: base.blocked || next.blocked,
    };
  }

  function envPath(name: string, fallback = ''): string {
    return String(process.env[name] || fallback || '').trim();
  }

  function userProfileRoots(): string[] {
    return uniqueStrings([
      os.homedir(),
      envPath('USERPROFILE'),
      envPath('APPDATA'),
      envPath('LOCALAPPDATA'),
    ]).map((p) => path.resolve(p));
  }

  function isInsideUserProfile(target: string): boolean {
    return userProfileRoots().some((root) => isPathInsideForPermissions(root, target));
  }

  function commandBoundaryFromPatterns(command: string): CommandBoundaryAnalysis {
    const cmd = String(command || '');
    const lower = cmd.toLowerCase().replace(/\s+/g, ' ');
    let boundary: CommandBoundaryAnalysis = {
      scope: 'workspace',
      reason: '',
      externalPaths: [],
      pathAccessPaths: [],
      environmentChanges: [],
      requiresExplicitApproval: false,
      requiresAdmin: false,
    };
    const appData = envPath('APPDATA', path.join(os.homedir(), 'AppData', 'Roaming'));
    const localAppData = envPath('LOCALAPPDATA', path.join(os.homedir(), 'AppData', 'Local'));
    const npmGlobalRe = /\bnpm(?:\.cmd)?\s+(?:install|i|add)\b[\s\S]*(?:^|\s)(?:-g|--global)(?:\s|$)/i;
    if (npmGlobalRe.test(cmd) || /\bnpm(?:\.cmd)?\s+link\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'global_tooling',
        reason: 'This is an npm global tooling operation and may install executables outside the workspace.',
        externalPaths: [
          path.join(appData, 'npm'),
          path.join(appData, 'npm', 'node_modules'),
          path.join(localAppData, 'npm-cache'),
        ],
        packageManager: 'npm',
        requiresExplicitApproval: true,
      });
    }
    if (/\bnpm(?:\.cmd)?\s+config\s+set\s+prefix\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'global_tooling',
        reason: 'This changes npm global install configuration.',
        externalPaths: [path.join(os.homedir(), '.npmrc')],
        environmentChanges: ['npm prefix'],
        packageManager: 'npm',
        requiresExplicitApproval: true,
      });
    }
    if (/\b(?:pip|pip3|python(?:3)?\s+-m\s+pip)\s+install\b[\s\S]*\s--user\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'user_profile',
        reason: 'This installs Python packages into the user profile outside the workspace.',
        externalPaths: [path.join(os.homedir(), 'AppData', 'Roaming', 'Python')],
        packageManager: 'pip',
        requiresExplicitApproval: true,
      });
    }
    if (/\b(?:winget|choco|chocolatey)\s+(?:install|upgrade|uninstall)\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'system',
        reason: 'This uses a Windows package manager and may change installed applications outside the workspace.',
        externalPaths: ['Windows installed applications'],
        packageManager: /\bwinget\b/i.test(cmd) ? 'winget' : 'chocolatey',
        requiresExplicitApproval: true,
        requiresAdmin: /\bchoco(?:latey)?\b/i.test(cmd),
      });
    }
    if (/\bscoop\s+(?:install|update|uninstall)\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'global_tooling',
        reason: 'This uses Scoop and may install user-level tools outside the workspace.',
        externalPaths: [path.join(os.homedir(), 'scoop')],
        packageManager: 'scoop',
        requiresExplicitApproval: true,
      });
    }
    if (/\bgit\s+config\s+--global\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'user_profile',
        reason: 'This changes global Git configuration in the user profile.',
        externalPaths: [path.join(os.homedir(), '.gitconfig')],
        environmentChanges: ['global git config'],
        packageManager: 'git',
        requiresExplicitApproval: true,
      });
    }
    if (/\bsetx\b|\[environment\]::setenvironmentvariable/i.test(lower)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'user_profile',
        reason: 'This changes user or machine environment variables outside the workspace.',
        environmentChanges: ['environment variables'],
        requiresExplicitApproval: true,
      });
    }
    return boundary;
  }

  function applyCommandPathBoundary(boundary: CommandBoundaryAnalysis, candidate: string, kind: 'cwd' | 'path'): CommandBoundaryAnalysis {
    const allowedRoots = getRunCommandAllowedRoots();
    const blockedRoots = ((getConfig().getConfig() as any)?.tools?.permissions?.files?.blocked_paths || [])
      .map((p: any) => String(p || '').trim())
      .filter(Boolean)
      .map((p: string) => path.resolve(p));
    const resolved = path.resolve(candidate);
    if (blockedRoots.some((blocked: string) => isPathInsideForPermissions(blocked, resolved))) {
      return mergeCommandBoundary(boundary, {
        scope: 'admin_required',
        reason: `Command ${kind === 'cwd' ? 'uses' : 'references'} blocked path "${candidate}".`,
        externalPaths: [candidate],
        requiresExplicitApproval: true,
        requiresAdmin: true,
        blocked: { name, args, result: `Blocked: command ${kind === 'cwd' ? 'uses' : 'references'} blocked path "${candidate}".`, error: true },
      });
    }
    const isAllowed = allowedRoots.some((allowed) => isPathInsideForPermissions(allowed, resolved))
      || isSessionAllowedPath(sessionId, resolved);
    if (!isAllowed) {
      const userProfile = isInsideUserProfile(resolved);
      return mergeCommandBoundary(boundary, {
        scope: userProfile ? 'user_profile' : 'unknown_external',
        reason: userProfile
          ? `Command ${kind === 'cwd' ? 'cwd is' : 'references'} a user-profile path outside the workspace: "${candidate}".`
          : `Command ${kind === 'cwd' ? 'cwd is' : 'references'} an external path outside the workspace: "${candidate}".`,
        externalPaths: [candidate],
        pathAccessPaths: [candidate],
        requiresExplicitApproval: true,
      });
    }
    return boundary;
  }

  function analyzeRunCommandBoundary(command: string, cwd?: string): CommandBoundaryAnalysis {
    let boundary = commandBoundaryFromPatterns(command);
    if (cwd) boundary = applyCommandPathBoundary(boundary, cwd, 'cwd');
    for (const candidate of extractAbsolutePathsFromCommand(command)) {
      boundary = applyCommandPathBoundary(boundary, candidate, 'path');
      if (boundary.blocked) return boundary;
    }
    return boundary;
  }

  function stableToolArgsForPermission(toolName: string, toolArgs: any): string {
    const clean = (value: any): any => {
      if (value == null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(clean);
      const out: Record<string, any> = {};
      for (const key of Object.keys(value).sort()) {
        if (/screenshot|image|base64|blob|dataurl|password|token|secret/i.test(key)) continue;
        out[key] = clean(value[key]);
      }
      return out;
    };
    try {
      return `${toolName}:${JSON.stringify(clean(toolArgs || {}))}`;
    } catch {
      return `${toolName}:[unserializable args]`;
    }
  }

  function getShellApprovalMode(): 'default' | 'lite' {
    return getToolPermissionMode();
  }

  function maybeBlockShellTokenPolicy(rawCmd: string, normalizedCmd: string): ToolResult | null {
    if (getShellApprovalMode() !== 'lite') return null;
    const cmd = rawCmd.toLowerCase();
    const blockedPattern = commandContainsBlockedPattern(cmd, deps.BLOCKED_PATTERNS);
    if (blockedPattern) {
      return { name, args, result: `Blocked: "${cmd}" contains unsafe pattern "${blockedPattern}"`, error: true };
    }
    return null;
  }

  function normalizeUrlOrigin(rawUrl: string): string {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      return `${parsed.protocol}//${parsed.host}`.toLowerCase();
    } catch {
      return value.toLowerCase();
    }
  }

  async function buildScopedToolPermissionCandidate(toolName: string, toolArgs: any, riskScore: number): Promise<ToolPermissionCandidate | null> {
    const action = stableToolArgsForPermission(toolName, toolArgs);
    if (/^desktop_(press_key|type|type_raw|click|drag|scroll)$/i.test(toolName)) {
      const activeWindow = await getDesktopActiveWindowInfo().catch(() => null);
      if (!activeWindow) return null;
      const processName = String(activeWindow.processName || '').trim().toLowerCase();
      const title = String(activeWindow.title || '').trim().replace(/\s+/g, ' ');
      if (!processName && !title) return null;
      return {
        sessionId,
        toolName,
        action,
        targetKind: 'desktop_window',
        target: `${processName}|${title.toLowerCase()}`,
        targetDisplay: `${title || '(untitled)'} (${processName || 'unknown process'})`,
        workspaceRoot: path.resolve(workspacePath),
        riskScore,
      } satisfies ToolPermissionCandidate;
    }
    if (/^browser_(click|fill|press_key|type|scroll|drag|upload_file|click_and_download|run_js)$/i.test(toolName)) {
      const info = getBrowserSessionInfo(sessionId);
      if (!info.active) return null;
      const origin = normalizeUrlOrigin(String(info.url || ''));
      const title = String(info.title || '').trim().replace(/\s+/g, ' ');
      return {
        sessionId,
        toolName,
        action,
        targetKind: 'browser_page',
        target: `${info.sessionId || sessionId}|${origin}|${title.toLowerCase()}`,
        targetDisplay: `${title || '(untitled page)'}${origin ? ` (${origin})` : ''}`,
        workspaceRoot: path.resolve(workspacePath),
        riskScore,
      } satisfies ToolPermissionCandidate;
    }
    return null;
  }
 return { updateArgs: (value: WorkspaceHelperContext['args']) => { args = value; ctx.updateArgs(value); }, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate };
}
