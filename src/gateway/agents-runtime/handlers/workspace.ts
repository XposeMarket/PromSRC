import fs from 'fs';
import path from 'path';
import { looksLikeNativeFileToolBypass } from './../native-file-tool-bypass';
import { shouldTrackTerminalWorkspaceChanges } from './../../terminal-service';
import { getConfig } from './../../../config/config';
import { jsonEditGuardError } from './../../../tools/json-edit-guard';
import { DEFAULT_FILE_TOOL_EXCLUDES, buildFileIntelligence, buildNoMatchHints, buildRepoMapHeader, collectGrepMatchesInText, compareGrepMatches, createSearchMatcher, formatGrepToolResult, parseGlobList, readSimpleGitignore, resolveResultCharBudget, summarizeFileForTool, type SearchMatcher } from './../../../tools/file-intelligence';
import { runBoundedWorkspaceSearch } from './../../workspace-search';
import { runElevatedCommand } from './../../process/elevated-command';
import { createTerminalWorkspaceTracker } from './../../coding/terminal-change-tracker';
import { applyDeleteLinesEolSafe, applyInsertAfterEolSafe, applyReplaceLinesEolSafe, splitLinesEolSafe } from './../../dev-source-patchset';
import { classifyCommandTermination } from './../../process/command-outcome';
import { isTerminalFirstWorkspaceMode } from './../../../runtime/workspace-tool-mode.js';
import { FILE_TOOL_DEFAULT_READ_LINES, FILE_TOOL_DEFAULT_BATCH_FILES, FILE_TOOL_MAX_BATCH_FILES, FILE_TOOL_DEFAULT_BATCH_LINES, FILE_TOOL_MAX_BATCH_LINES, FILE_TOOL_DEFAULT_TREE_DEPTH, FILE_TOOL_DEFAULT_TREE_ENTRIES, FILE_TOOL_BATCH_INLINE_LIMIT_CHARS, FILE_TOOL_TREE_INLINE_LIMIT_CHARS, trimReturnedFileLine, getPostSourceEditInstructionForSession, rejectInvalidSourceEdit, coerceBatchFileList, executeTool } from './../subagent-executor';
import type { createWorkspaceHelpers } from '../workspace-helpers';
import { DEFAULT_RUN_YIELD_MS } from './../../../tools/parallel-tool-calls';

export interface handleWorkspaceToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
 approvedCommandApprovalId: string;
}
export async function handleWorkspaceTool(ctx: handleWorkspaceToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 let { name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = ctx;
 switch (name) {


      case 'list_files': {
        try {
          const listArgs = args || {};
          const resolved = resolveAllowedWorkspacePath(String(listArgs.path ?? listArgs.directory ?? '.'), { requireDirectory: true, allowEmpty: true, readOnlyDiagnostics: true });
          const files = fs.readdirSync(resolved.absPath).filter(f => {
            try { return fs.statSync(path.join(resolved.absPath, f)).isFile(); } catch { return false; }
          });
          return { name, args, result: JSON.stringify({ path: resolved.displayPath, files }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'list_directory': {
        const listArgs = args || {};
        let resolvedDir: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          const rawPath = listArgs.path ?? listArgs.directory ?? '.';
          const directoryArg = String(rawPath || '.').trim() || '.';
          resolvedDir = resolveAllowedWorkspacePath(directoryArg, { requireDirectory: true, allowEmpty: true, readOnlyDiagnostics: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const targetDir = resolvedDir.absPath;

        const maxEntries = Math.max(1, Math.min(1000, Math.floor(Number(listArgs.max_entries) || 250)));
        const maxDepth = Math.max(0, Math.min(8, Math.floor(Number(listArgs.max_depth ?? listArgs.depth) || 1)));
        const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', '.prometheus', 'coverage', 'generated', 'temp', 'logs']);
        const entries: string[] = [];
        let truncated = false;

        const walk = (dir: string, depth: number): void => {
          if (entries.length >= maxEntries) {
            truncated = true;
            return;
          }

          let dirents: fs.Dirent[] = [];
          try {
            dirents = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }

          dirents.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

          for (const entry of dirents) {
            if (entries.length >= maxEntries) {
              truncated = true;
              return;
            }
            const abs = path.join(dir, entry.name);
            const rel = path.join(resolvedDir.displayPath === '.' ? '' : resolvedDir.displayPath, path.relative(targetDir, abs)).replace(/\\/g, '/');
            if (entry.isDirectory()) {
              entries.push(`[DIR]  ${rel}/`);
              if (depth < maxDepth && !skipDirs.has(entry.name)) {
                walk(abs, depth + 1);
              }
            } else if (entry.isFile()) {
              entries.push(`[FILE] ${rel}`);
            }
          }
        };

        walk(targetDir, 0);
        const listedPath = resolvedDir.displayPath;
        const header = `Directory ${listedPath} (max_depth=${maxDepth}, entries=${entries.length}${truncated ? `/${maxEntries}+` : ''}):`;
        const footer = truncated ? `\n...[truncated; pass max_depth or max_entries to narrow/expand]` : '';
        const repoHeader = args.map === false ? '' : buildRepoMapHeader(targetDir, listedPath, { excludes: Array.from(skipDirs) });
        const rendered = `${repoHeader ? `${repoHeader}\n\n` : ''}${header}\n${entries.join('\n') || '(empty directory)'}${footer}`;
        return {
          name,
          args,
          result: maybeSpoolToolOutput(name, rendered, resolveResultCharBudget(args, FILE_TOOL_TREE_INLINE_LIMIT_CHARS), {
            allowInline: args.inline === true || args.no_spool === true,
            summary: `${header}\nDirectory listing exceeded inline budget.`,
          }),
          error: false,
        };
      }

      case 'read_files_batch': {
        const batchFiles = coerceBatchFileList(args);
        if (!batchFiles.length) return { name, args, result: 'files array is required and must not be empty', error: true };
        args = { ...args, files: batchFiles };
        ctx.updateArgs(args);
        const maxFiles = Math.max(1, Math.min(FILE_TOOL_MAX_BATCH_FILES, Math.floor(Number(args.max_files) || FILE_TOOL_DEFAULT_BATCH_FILES)));
        const batchCap = Math.max(1, Math.min(FILE_TOOL_MAX_BATCH_LINES, Math.floor(Number(args.max_lines_per_file) || Number(args.num_lines) || FILE_TOOL_DEFAULT_BATCH_LINES)));
        const resultChunks: string[] = [];
        const batchSummaryLines: string[] = [];
        const forceSummary = args.summary === true || args.content === false || args.include_content === false || String(args.mode || '').toLowerCase() === 'summary';
        const summarizeFile = (display: string, absPath: string): string => {
          return summarizeFileForTool(display, absPath, {
            readCap: batchCap,
            query: args.query ? String(args.query) : undefined,
          });
        };
        for (const entry of batchFiles.slice(0, maxFiles)) {
          const bFilename = entry?.filename || entry?.name;
          if (!bFilename) { resultChunks.push('--- [missing filename] ---\nERROR: filename is required'); continue; }
          try {
            const bNorm = String(bFilename).replace(/\\/g, '/');
            let bContent: string;
            let bDisplay: string;
            const entryFull = entry.full === true || entry.allow_large === true || args.full === true || args.allow_large === true;
            const summaryOnly = forceSummary;
            if (bNorm.startsWith('src/')) {
              if (summaryOnly) {
                const projectRoot = resolveProjectRootForSourceAccess();
                const srcRoot = path.join(projectRoot, 'src');
                const rel = bNorm.replace(/^src\//, '');
                const absPath = path.resolve(srcRoot, rel);
                if (!absPath.startsWith(srcRoot)) throw new Error('Path escapes src/ directory.');
                resultChunks.push(summarizeFile(bNorm, absPath));
                batchSummaryLines.push(`${bNorm}: summary`);
                continue;
              }
              const r = await executeTool('read_source', { file: bNorm, start_line: entry.start_line, num_lines: entry.num_lines ?? batchCap, max_lines: batchCap, full: entry.full ?? args.full, allow_large: entry.allow_large ?? args.allow_large }, workspacePath, deps, sessionId);
              resultChunks.push(`--- ${bFilename} ---\n${r.result}`);
              batchSummaryLines.push(`${bFilename}: content`);
              continue;
            }
            if (bNorm.startsWith('web-ui/')) {
              if (summaryOnly) {
                const projectRoot = resolveProjectRootForSourceAccess();
                const webUiRoot = path.join(projectRoot, 'web-ui');
                const rel = bNorm.slice('web-ui/'.length);
                const absPath = path.resolve(webUiRoot, rel);
                if (!absPath.startsWith(webUiRoot)) throw new Error('Path escapes web-ui/ directory.');
                resultChunks.push(summarizeFile(bNorm, absPath));
                batchSummaryLines.push(`${bNorm}: summary`);
                continue;
              }
              const r = await executeTool('read_webui_source', { file: bNorm.slice('web-ui/'.length), start_line: entry.start_line, num_lines: entry.num_lines ?? batchCap, max_lines: batchCap, full: entry.full ?? args.full, allow_large: entry.allow_large ?? args.allow_large }, workspacePath, deps, sessionId);
              resultChunks.push(`--- ${bFilename} ---\n${r.result}`);
              batchSummaryLines.push(`${bFilename}: content`);
              continue;
            }
            const bResolved = resolveAllowedWorkspacePath(String(bFilename), { requireFile: true, readOnlyDiagnostics: true });
            bDisplay = bResolved.displayPath;
            if (summaryOnly) {
              resultChunks.push(summarizeFile(bDisplay, bResolved.absPath));
              batchSummaryLines.push(`${bDisplay}: summary`);
              continue;
            }
            bContent = fs.readFileSync(bResolved.absPath, 'utf-8');
            const bAllLines = splitLinesEolSafe(bContent);
            if (entry.start_line !== undefined || entry.num_lines !== undefined) {
              const bStart = Math.max(1, Math.floor(Number(entry.start_line) || 1));
              const requested = Math.max(1, Math.floor(Number(entry.num_lines) || batchCap));
              const bNum = entryFull ? requested : Math.min(requested, batchCap);
              const bIdx = bStart - 1;
              const bWindow = bAllLines.slice(bIdx, bIdx + bNum);
              const bNumbered = bWindow.map((l, i) => `${bStart + i}: ${trimReturnedFileLine(l)}`).join('\n');
              const bEnd = bStart + bWindow.length - 1;
              const truncated = bEnd < bAllLines.length;
              resultChunks.push(`${bDisplay} (${bAllLines.length} lines) [window ${bStart}-${bEnd}${truncated ? ', truncated' : ''}]:\n${bNumbered}${truncated ? `\n[READ_TRUNCATED] Use start_line:${bEnd + 1}, num_lines:${batchCap} for the next chunk, or full:true only when needed.` : ''}`);
              batchSummaryLines.push(`${bDisplay}: lines ${bStart}-${bEnd}${truncated ? ' truncated' : ''}`);
            } else {
              const bWindow = entryFull ? bAllLines : bAllLines.slice(0, batchCap);
              const bNumbered = bWindow.map((l, i) => `${i + 1}: ${trimReturnedFileLine(l)}`).join('\n');
              const truncated = bWindow.length < bAllLines.length;
              resultChunks.push(`${bDisplay} (${bAllLines.length} lines) [window 1-${bWindow.length}${truncated ? ', truncated' : ''}]:\n${bNumbered}${truncated ? `\n[READ_DEFAULT_CAP] Batch reads default to ${batchCap} lines per file. Use start_line:${bWindow.length + 1}, num_lines:${batchCap} for the next chunk, or full:true only when needed.` : ''}`);
              batchSummaryLines.push(`${bDisplay}: lines 1-${bWindow.length}${truncated ? ' truncated' : ''}`);
            }
          } catch (err: any) {
            resultChunks.push(`--- ${String(bFilename)} ---\nERROR: ${err?.message || String(err)}`);
            batchSummaryLines.push(`${String(bFilename)}: error`);
          }
        }
        if (batchFiles.length > maxFiles) {
          resultChunks.push(`--- [batch truncated] ---\nOnly first ${maxFiles} files read. Re-run with remaining files if needed.`);
          batchSummaryLines.push(`[batch truncated]: ${batchFiles.length - maxFiles} file(s) omitted`);
        }
        const rendered = resultChunks.join('\n\n');
        return {
          name,
          args,
          result: maybeSpoolToolOutput(name, rendered, resolveResultCharBudget(args, FILE_TOOL_BATCH_INLINE_LIMIT_CHARS), {
            allowInline: args.inline === true || args.no_spool === true,
            summary: `read_files_batch returned ${Math.min(batchFiles.length, maxFiles)} file entry result(s):\n${batchSummaryLines.join('\n')}`,
          }),
          error: false,
        };
      }

	      case 'read_file': {
	        const filename = args.filename || args.name;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
        const normalizedFn = String(filename || '').replace(/\\/g, '/');
        const ROOT_READ_ALLOWLIST = ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'CHANGELOG.md'];
        if (normalizedFn.startsWith('src/') || ROOT_READ_ALLOWLIST.includes(normalizedFn)) {
          return executeTool('read_source', { ...args, file: filename }, workspacePath, deps, sessionId);
        }
        if (normalizedFn.startsWith('web-ui/')) {
          return executeTool('read_webui_source', { ...args, file: normalizedFn.slice('web-ui/'.length) }, workspacePath, deps, sessionId);
        }
        let resolvedFile: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedFile = resolveAllowedWorkspacePath(String(filename), { requireFile: true, readOnlyDiagnostics: true });
        } catch (err: any) {
          const requested = String(filename || '').replace(/\\/g, '/');
          return { name, args, result: await recoverWorkspacePathError(err, requested, 'list_dir'), error: true };
        }
        const filePath = resolvedFile.absPath;
        const content = fs.readFileSync(filePath, 'utf-8');
        const allLines = splitLinesEolSafe(content);
        const explicitStart = Math.floor(Number(args.start_line) || 0);
        const aroundLine = Math.floor(Number(args.around_line ?? args.aroundLine) || 0);
        if (explicitStart > allLines.length || aroundLine > allLines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(resolvedFile.displayPath, allLines, explicitStart || aroundLine, 'read_file', explicitStart ? 'start_line' : 'around_line'), error: true };
        }
        return { name, args, result: renderNumberedRead(resolvedFile.displayPath, allLines, args), error: false };
	      }

	      case 'mkdir': {
	        const requestedPath = args.path || args.directory || args.name;
	        if (!requestedPath) return { name, args, result: 'path is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(requestedPath));
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'dir', 'mkdir');
	          if (blocked) return blocked;
	          const snapshot = snapshotPreMutation(resolved, 'mkdir');
	          fs.mkdirSync(resolved.absPath, { recursive: true });
	          return withWorkspaceSnapshots({ name, args, result: `OK directory created: ${resolved.normalizedRel}`, error: false }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, requestedPath, 'list_dir'), error: true };
	        }
	      }

	      case 'create_file': {
	        const filename = args.filename || args.name || args.path;
	        const content = String(args.content ?? '');
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename));
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'create_file');
	          if (blocked) return blocked;
	          if (fs.existsSync(resolved.absPath)) {
	            return { name, args, result: `ERROR: File "${resolved.normalizedRel}" already exists. Use write_file, replace_lines, or find_replace to edit it.`, error: true };
	          }
	          const snapshot = snapshotPreMutation(resolved, 'create_file');
	          fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
	          fs.writeFileSync(resolved.absPath, content, 'utf-8');
	          return withWorkspaceSnapshots({ name, args, result: `OK created ${resolved.normalizedRel} (${content.split('\n').length} lines).`, error: false }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'write_file': {
	        const filename = args.filename || args.name || args.path;
	        const content = String(args.content ?? '');
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename));
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'write_file');
	          if (blocked) return blocked;
	          const snapshot = snapshotPreMutation(resolved, 'write_file');
	          fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
	          fs.writeFileSync(resolved.absPath, content, 'utf-8');
	          return withWorkspaceSnapshots({ name, args, result: `OK wrote ${resolved.normalizedRel} (${content.split('\n').length} lines).`, error: false }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'append_file': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        const content = String(args.content ?? '');
	        try {
	          const resolved = resolveWorkspacePath(String(filename));
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'append_file');
	          if (blocked) return blocked;
	          const snapshot = snapshotPreMutation(resolved, 'append_file');
	          fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
	          fs.appendFileSync(resolved.absPath, content, 'utf-8');
	          return withWorkspaceSnapshots({ name, args, result: `OK appended ${content.length} characters to ${resolved.normalizedRel}.`, error: false }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'replace_lines': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        const start = Math.max(1, Math.floor(Number(args.start_line) || 0));
	        const end = Math.max(start, Math.floor(Number(args.end_line) || start));
	        if (!start || !end) return { name, args, result: 'start_line and end_line are required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'replace_lines');
	          if (blocked) return blocked;
	          const content = fs.readFileSync(resolved.absPath, 'utf-8');
	          const originalLines = splitLinesEolSafe(content);
	          if (start > originalLines.length) return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, originalLines, start, 'read_file', 'start_line'), error: true };
	          const replaced = applyReplaceLinesEolSafe(content, start, end, String(args.new_content ?? ''));
	          const jsonErr = jsonEditGuardError(resolved.normalizedRel, content, replaced.updated);
	          if (jsonErr) return { name, args, result: jsonErr, error: true };
	          const snapshot = snapshotPreMutation(resolved, 'replace_lines');
	          fs.writeFileSync(resolved.absPath, replaced.updated, 'utf-8');
	          return withWorkspaceSnapshots({
	            name,
	            args,
	            result: formatPostEditContext(
	              resolved.normalizedRel,
	              replaced.updated,
	              start,
	              Math.max(start, start + replaced.newLines.length - 1),
	              `OK ${resolved.normalizedRel}: replaced lines ${start}-${replaced.endClamped}.`,
	            ),
	            error: false,
	          }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'insert_after': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        const afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'insert_after');
	          if (blocked) return blocked;
	          const content = fs.readFileSync(resolved.absPath, 'utf-8');
	          const originalLines = splitLinesEolSafe(content);
	          if (afterLine > originalLines.length) return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, originalLines, afterLine, 'read_file', 'after_line'), error: true };
	          const inserted = applyInsertAfterEolSafe(content, afterLine, String(args.content ?? ''));
	          const jsonErr = jsonEditGuardError(resolved.normalizedRel, content, inserted.updated);
	          if (jsonErr) return { name, args, result: jsonErr, error: true };
	          const snapshot = snapshotPreMutation(resolved, 'insert_after');
	          fs.writeFileSync(resolved.absPath, inserted.updated, 'utf-8');
	          return withWorkspaceSnapshots({
	            name,
	            args,
	            result: formatPostEditContext(
	              resolved.normalizedRel,
	              inserted.updated,
	              inserted.insertAt + 1,
	              Math.max(inserted.insertAt + 1, inserted.insertAt + inserted.newLines.length),
	              `OK ${resolved.normalizedRel}: inserted after line ${afterLine}.`,
	            ),
	            error: false,
	          }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'delete_lines': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        const start = Math.max(1, Math.floor(Number(args.start_line) || 0));
	        const end = Math.max(start, Math.floor(Number(args.end_line) || start));
	        if (!start || !end) return { name, args, result: 'start_line and end_line are required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'delete_lines');
	          if (blocked) return blocked;
	          const content = fs.readFileSync(resolved.absPath, 'utf-8');
	          const originalLines = splitLinesEolSafe(content);
	          if (start > originalLines.length) return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, originalLines, start, 'read_file', 'start_line'), error: true };
	          const deleted = applyDeleteLinesEolSafe(content, start, end);
	          const jsonErr = jsonEditGuardError(resolved.normalizedRel, content, deleted.updated);
	          if (jsonErr) return { name, args, result: jsonErr, error: true };
	          const snapshot = snapshotPreMutation(resolved, 'delete_lines');
	          fs.writeFileSync(resolved.absPath, deleted.updated, 'utf-8');
	          return withWorkspaceSnapshots({
	            name,
	            args,
	            result: formatPostEditContext(
	              resolved.normalizedRel,
	              deleted.updated,
	              Math.min(start, Math.max(1, deleted.lines.length)),
	              Math.min(start, Math.max(1, deleted.lines.length)),
	              `OK ${resolved.normalizedRel}: deleted lines ${start}-${deleted.endClamped}.`,
	            ),
	            error: false,
	          }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'find_replace': {
	        const filename = args.filename || args.name || args.path || args.file;
	        const find = String(args.find ?? '');
	        const replace = String(args.replace ?? '');
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        if (!find) return { name, args, result: 'find is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'find_replace');
	          if (blocked) return blocked;
	          const content = fs.readFileSync(resolved.absPath, 'utf-8');
	          const fr = applyTolerantFindReplace(content, find, replace, args.replace_all === true);
		          if (!fr) return { name, args, result: buildTextNotFoundRecovery(resolved.normalizedRel, content, find, 'read_file'), error: true };
	          const updated = fr.updated;
	          const snapshot = snapshotPreMutation(resolved, 'find_replace');
	          fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	          const startLine = lineNumberAtOffset(content, fr.firstIndex);
	          const replacementLineCount = Math.max(1, String(replace ?? '').replace(/\r\n/g, '\n').split('\n').length);
	          return withWorkspaceSnapshots({
	            name,
	            args,
	            result: formatPostEditContext(
	              resolved.normalizedRel,
	              updated,
	              startLine,
	              Math.max(startLine, startLine + replacementLineCount - 1),
	              `OK ${resolved.normalizedRel}: replaced ${args.replace_all === true ? `all occurrences (${fr.count})` : 'first occurrence'}.`,
	            ),
	            error: false,
	          }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'rename_file': {
	        const oldPath = args.old_path || args.oldPath || args.filename || args.name;
	        const newPath = args.new_path || args.newPath || args.to || args.path;
	        if (!oldPath || !newPath) return { name, args, result: 'old_path and new_path are required', error: true };
	        try {
	          const oldResolved = resolveWorkspacePath(String(oldPath), { requireFile: true });
	          const newResolved = resolveWorkspacePath(String(newPath));
	          const oldBlocked = enforceMutationScope(oldResolved.normalizedRel, 'file', 'rename_file');
	          if (oldBlocked) return oldBlocked;
	          const newBlocked = enforceMutationScope(newResolved.normalizedRel, 'file', 'rename_file');
	          if (newBlocked) return newBlocked;
	          const snapshots = [
	            snapshotPreMutation(oldResolved, 'rename_file:source'),
	            snapshotPreMutation(newResolved, 'rename_file:destination'),
	          ];
	          fs.mkdirSync(path.dirname(newResolved.absPath), { recursive: true });
	          fs.renameSync(oldResolved.absPath, newResolved.absPath);
	          return withWorkspaceSnapshots({ name, args, result: `OK renamed ${oldResolved.normalizedRel} to ${newResolved.normalizedRel}.`, error: false }, snapshots);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, oldPath, 'list_dir'), error: true };
	        }
	      }

	      case 'delete_file': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'delete_file');
	          if (blocked) return blocked;
	          const snapshot = snapshotPreMutation(resolved, 'delete_file');
	          fs.unlinkSync(resolved.absPath);
	          return withWorkspaceSnapshots({ name, args, result: `OK deleted ${resolved.normalizedRel}.`, error: false }, [snapshot]);
	        } catch (err: any) {
	          return { name, args, result: await recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

      case 'copy_file':
      case 'move_file': {
        const source = args.source || args.from || args.old_path || args.filename || args.path;
        const destination = args.destination || args.dest || args.to || args.new_path;
        if (!source || !destination) return { name, args, result: 'source and destination are required', error: true };
        try {
          const src = resolveAllowedWorkspacePath(String(source), { requireFile: true });
          const dest = resolveAllowedWorkspacePath(String(destination));
          const srcBlocked = enforceMutationScope(src.normalizedRel, 'file', name);
          if (srcBlocked) return srcBlocked;
          const destBlocked = enforceMutationScope(dest.normalizedRel, 'file', name);
          if (destBlocked) return destBlocked;
          const overwrite = args.overwrite === true;
          if (fs.existsSync(dest.absPath) && !overwrite) {
            return { name, args, result: `ERROR: destination exists: ${dest.displayPath}. Pass overwrite=true to replace it.`, error: true };
          }
          const plan = { operation: name, from: src.displayPath, to: dest.displayPath, overwrite, will_overwrite: fs.existsSync(dest.absPath) };
          if (args.dry_run === true) return { name, args, result: JSON.stringify(plan, null, 2), error: false };
          const snapshots = [
            snapshotPreMutation(dest, `${name}:destination`),
            name === 'move_file' ? snapshotPreMutation(src, `${name}:source`) : null,
          ];
          if (args.create_dirs !== false) fs.mkdirSync(path.dirname(dest.absPath), { recursive: true });
          if (fs.existsSync(dest.absPath) && overwrite) fs.rmSync(dest.absPath, { force: true });
          if (name === 'copy_file') fs.copyFileSync(src.absPath, dest.absPath);
          else fs.renameSync(src.absPath, dest.absPath);
          return withWorkspaceSnapshots({ name, args, result: `OK ${name === 'copy_file' ? 'copied' : 'moved'} ${src.displayPath} to ${dest.displayPath}.`, error: false }, snapshots);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'copy_directory':
      case 'move_directory': {
        const source = args.source || args.from || args.old_path || args.path;
        const destination = args.destination || args.dest || args.to || args.new_path;
        if (!source || !destination) return { name, args, result: 'source and destination are required', error: true };
        try {
          const src = resolveAllowedWorkspacePath(String(source), { requireDirectory: true });
          const dest = resolveAllowedWorkspacePath(String(destination));
          const srcBlocked = enforceMutationScope(src.normalizedRel, 'dir', name);
          if (srcBlocked) return srcBlocked;
          const destBlocked = enforceMutationScope(dest.normalizedRel, 'dir', name);
          if (destBlocked) return destBlocked;
          const maxEntries = Math.max(1, Math.min(20000, Number(args.max_entries || 2000)));
          const counts = countDirectoryFiles(src.absPath, maxEntries);
          if (counts.truncated) return { name, args, result: `ERROR: source exceeds max_entries=${maxEntries}. Increase max_entries intentionally or narrow the operation.`, error: true };
          const overwrite = args.overwrite === true;
          if (fs.existsSync(dest.absPath) && !overwrite) {
            return { name, args, result: `ERROR: destination exists: ${dest.displayPath}. Pass overwrite=true to replace it.`, error: true };
          }
          const plan = { operation: name, from: src.displayPath, to: dest.displayPath, overwrite, will_overwrite: fs.existsSync(dest.absPath), ...counts };
          if (args.dry_run === true) return { name, args, result: JSON.stringify(plan, null, 2), error: false };
          const snapshots = [
            snapshotPreMutation(dest, `${name}:destination`),
            name === 'move_directory' ? snapshotPreMutation(src, `${name}:source`) : null,
          ];
          if (fs.existsSync(dest.absPath) && overwrite) fs.rmSync(dest.absPath, { recursive: true, force: true });
          fs.mkdirSync(path.dirname(dest.absPath), { recursive: true });
          if (name === 'copy_directory') fs.cpSync(src.absPath, dest.absPath, { recursive: true, force: overwrite, errorOnExist: !overwrite });
          else fs.renameSync(src.absPath, dest.absPath);
          return withWorkspaceSnapshots({ name, args, result: `OK ${name === 'copy_directory' ? 'copied' : 'moved'} directory ${src.displayPath} to ${dest.displayPath} (${counts.files} files).`, error: false }, snapshots);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'path_exists': {
        const requested = args.path || args.filename || args.file;
        if (!requested) return { name, args, result: 'path is required', error: true };
        try {
          const resolved = resolveAllowedWorkspacePath(String(requested), { readOnlyDiagnostics: true });
          if (!fs.existsSync(resolved.absPath)) return { name, args, result: JSON.stringify({ path: resolved.displayPath, exists: false }, null, 2), error: false };
          const stat = fs.statSync(resolved.absPath);
          return {
            name,
            args,
            result: JSON.stringify({
              path: resolved.displayPath,
              exists: true,
              is_file: stat.isFile(),
              is_directory: stat.isDirectory(),
              bytes: stat.size,
              modified: stat.mtime.toISOString(),
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'show_diff':
      case 'git_diff': {
        try {
          const maxChars = Math.max(1000, Math.min(100000, Number(args.max_chars || 12000)));
          const parts = ['git diff'];
          if (args.staged === true) parts.push('--cached');
          if (args.stat === true) parts.push('--stat');
          if (args.path) {
            const resolved = resolveAllowedWorkspacePath(String(args.path));
            parts.push('--', quoteArg(resolved.displayPath));
          }
          const result = await runCapturedToolCommand(parts.join(' '), workspacePath, 120000);
          result.result = truncateText(result.result, maxChars);
          return result;
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'preview_patch':
      case 'apply_patch': {
        const patchText = String(args.patch || '');
        if (!patchText.trim()) return { name, args, result: 'patch is required', error: true };
        try {
          const targets = validatePatchTargetPaths(patchText);
          const tmpPath = path.join(getConfig().getConfigDir(), `patch-${Date.now()}-${Math.random().toString(36).slice(2)}.diff`);
          fs.writeFileSync(tmpPath, patchText, 'utf-8');
          try {
            const check = await deps.runCommandCaptured(`git apply --check --whitespace=nowarn ${quoteArg(tmpPath)}`, workspacePath, 120000);
            const checkOutput = [check.stdout, check.stderr].filter(Boolean).join('\n').trim();
            if (check.code !== 0 || check.timedOut) {
              return { name, args, result: `Patch check failed:\n${truncateText(checkOutput || `exit ${check.code}`, 8000)}`, error: true };
            }
            if (name === 'preview_patch' || args.check === true) {
              return { name, args, result: JSON.stringify({ checked_only: true, files: targets, file_count: targets.length }, null, 2), error: false };
            }
            const snapshots = targets.map((target) => {
              const resolved = resolveAllowedWorkspacePath(String(target), { allowEmpty: true });
              return snapshotPreMutation(resolved, 'apply_patch');
            });
            const applied = await deps.runCommandCaptured(`git apply --whitespace=nowarn ${quoteArg(tmpPath)}`, workspacePath, 120000);
            const appliedOutput = [applied.stdout, applied.stderr].filter(Boolean).join('\n').trim();
            return withWorkspaceSnapshots({ name, args, result: applied.code === 0 ? `Patch applied to ${targets.length} file(s).` : `Patch apply failed:\n${truncateText(appliedOutput, 8000)}`, error: applied.code !== 0 }, applied.code === 0 ? snapshots : []);
          } finally {
            try { fs.unlinkSync(tmpPath); } catch {}
          }
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'validate_file': {
        const filename = args.filename || args.name || args.path || args.file;
        if (!filename) return { name, args, result: 'filename is required', error: true };
        const normalizedFilename = String(filename).replace(/\\/g, '/');
        if (normalizedFilename.startsWith('src/')) {
          return executeTool('validate_source', { ...args, file: normalizedFilename }, workspacePath, deps, sessionId);
        }
        if (normalizedFilename.startsWith('web-ui/')) {
          return executeTool('validate_webui_source', { ...args, file: normalizedFilename }, workspacePath, deps, sessionId);
        }
        let resolvedFile: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedFile = resolveAllowedWorkspacePath(String(filename), { requireFile: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        return validateSyntaxFileResult(resolvedFile.displayPath, resolvedFile.absPath);
      }

      case 'validate_source': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'file path is required', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const normalizedRel = rel.replace(/^\.?\//, '').replace(/^src\//, '');
        const absPath = path.resolve(srcRoot, normalizedRel);
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: validate_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(`src/${normalizedRel}`, srcRoot, normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        if (!fs.statSync(absPath).isFile()) return { name, args, result: `"src/${normalizedRel}" is not a file`, error: true };
        return validateSyntaxFileResult(`src/${normalizedRel}`, absPath);
      }

      case 'validate_prom_file': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        const projectRoot = resolveProjectRootForSourceAccess();
        let resolved: { absPath: string; normalizedRel: string };
        try {
          resolved = resolvePromAllowedFilePath(projectRoot, rel);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const promDisplay = resolved.normalizedRel || rel;
        if (!fs.existsSync(resolved.absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(promDisplay, projectRoot, resolved.normalizedRel || '', 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
        }
        if (!fs.statSync(resolved.absPath).isFile()) return { name, args, result: `"${promDisplay}" is not a file`, error: true };
        return validateSyntaxFileResult(promDisplay, resolved.absPath);
      }

      case 'validate_webui_source': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'file path is required', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const webUiRoot = path.join(projectRoot, 'web-ui');
        const normalizedRel = rel.replace(/^\.?\//, '').replace(/^web-ui\//, '');
        const absPath = path.resolve(webUiRoot, normalizedRel);
        if (!absPath.startsWith(webUiRoot)) {
          return { name, args, result: 'ERROR: validate_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(`web-ui/${normalizedRel}`, webUiRoot, normalizedRel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        if (!fs.statSync(absPath).isFile()) return { name, args, result: `"web-ui/${normalizedRel}" is not a file`, error: true };
        return validateSyntaxFileResult(`web-ui/${normalizedRel}`, absPath);
      }

	      case 'file_stats': {
        const filename = args.filename || args.name || args.path;
        if (!filename) return { name, args, result: 'filename is required', error: true };
        const normalizedFilename = String(filename).replace(/\\/g, '/');
        if (normalizedFilename.startsWith('src/')) {
          return executeTool('source_stats', { ...args, file: normalizedFilename }, workspacePath, deps, sessionId);
        }
        if (normalizedFilename.startsWith('web-ui/')) {
          return executeTool('webui_source_stats', { ...args, file: normalizedFilename }, workspacePath, deps, sessionId);
        }
        let resolvedFile: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedFile = resolveAllowedWorkspacePath(String(filename), { readOnlyDiagnostics: true });
          if (!fs.existsSync(resolvedFile.absPath)) throw new Error(`File "${filename}" not found`);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const filePath = resolvedFile.absPath;
        const stat = fs.statSync(filePath);
        // 24% of file_stats calls failed with "is not a file" because a folder
        // was passed. Answer with a compact directory summary instead.
        if (stat.isDirectory()) {
          let entries: fs.Dirent[] = [];
          try { entries = fs.readdirSync(filePath, { withFileTypes: true }); } catch { /* unreadable */ }
          const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
          const files = entries.filter((e) => e.isFile()).map((e) => {
            let size = 0;
            try { size = fs.statSync(path.join(filePath, e.name)).size; } catch { /* raced */ }
            return { name: e.name, bytes: size };
          }).sort((a, b) => b.bytes - a.bytes);
          const payload = {
            path: resolvedFile.displayPath,
            kind: 'directory',
            modified: stat.mtime.toISOString(),
            directories: dirs.length,
            files: files.length,
            total_file_bytes: files.reduce((sum, f) => sum + f.bytes, 0),
            subdirectories: dirs.slice(0, 60),
            largest_files: files.slice(0, 25),
            note: 'This path is a directory. Use list_directory/file_tree for structure or pass a file path for file stats.',
          };
          return { name, args, result: JSON.stringify(payload, null, 2), error: false };
        }
        if (!stat.isFile()) return { name, args, result: `"${resolvedFile.displayPath}" is not a regular file`, error: true };
        const content = fs.readFileSync(filePath, 'utf-8');
        const payload = buildFileIntelligence(resolvedFile.displayPath, content, stat, {
          readCap: FILE_TOOL_DEFAULT_READ_LINES,
          query: args.query ? String(args.query) : undefined,
        });
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'prom_file_stats': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        const projectRoot = resolveProjectRootForSourceAccess();
        let resolved: { absPath: string; normalizedRel: string };
        try {
          resolved = resolvePromAllowedPath(projectRoot, rel);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const promDisplay = resolved.normalizedRel || '.';
        if (!fs.existsSync(resolved.absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(promDisplay, projectRoot, resolved.normalizedRel || '', 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
        }
        const stat = fs.statSync(resolved.absPath);
        if (!stat.isFile()) return { name, args, result: `"${promDisplay}" is not a file`, error: true };
        const content = fs.readFileSync(resolved.absPath, 'utf-8');
        const payload = buildFileIntelligence(promDisplay, content, stat, {
          readCap: FILE_TOOL_DEFAULT_READ_LINES,
          query: args.query ? String(args.query) : undefined,
        });
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'grep_file': {
        const filename = args.filename || args.name || args.path;
        const pattern = String(args.pattern || '');
        if (!filename) return { name, args, result: 'filename is required', error: true };
        if (!pattern) return { name, args, result: 'pattern is required', error: true };
        let resolvedFile: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedFile = resolveAllowedWorkspacePath(String(filename), { requireFile: true, readOnlyDiagnostics: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const filePath = resolvedFile.absPath;
        let matcher: SearchMatcher;
        try {
          matcher = createSearchMatcher(pattern, {
            regex: args.regex === true,
            literal: args.literal === true,
            caseInsensitive: args.case_insensitive === true,
          });
        } catch (err: any) {
          return { name, args, result: `Invalid regex pattern: ${pattern}`, error: true };
        }
        const requestedMaxResults = Math.floor(Number(args.max_results) || 50);
        const contextLines = Math.max(0, Math.min(3, Math.floor(Number(args.context ?? args.context_lines) || 0)));
        const maxResults = Math.max(1, Math.min(80, requestedMaxResults));
        const content = fs.readFileSync(filePath, 'utf-8');
        const grep = collectGrepMatchesInText(resolvedFile.displayPath, content, matcher, {
          maxResults,
          contextLines,
          before: Number(args.before) || 40,
          after: Number(args.after) || 80,
          charBefore: Number(args.char_before) || undefined,
          charAfter: Number(args.char_after) || undefined,
          charWindow: Number(args.char_window) || undefined,
        });
        const payload = {
          file: resolvedFile.displayPath,
          pattern,
          search_mode: matcher.mode,
          match_count: grep.totalMatches,
          returned_count: grep.matches.length,
          truncated_count: grep.truncatedCount,
          result_limit: {
            requested: requestedMaxResults,
            applied: maxResults,
            context_lines: contextLines,
            limit_reached: grep.limitReached,
            note: 'Result payloads are hard-clamped. Narrow pattern/path/glob or rerun with a smaller directory to inspect more matches.',
          },
          no_match_hints: grep.totalMatches === 0 ? buildNoMatchHints({ pattern, searched: resolvedFile.displayPath, mode: matcher.mode }) : undefined,
          matches: grep.matches,
        };
        return { name, args, result: formatGrepToolResult(payload, args.format), error: false };
      }

      case 'search_files':
      case 'grep_files': {
        const pattern = String(args.pattern || '');
        if (!pattern) return { name, args, result: 'pattern is required', error: true };
        const directoryArg = name === 'grep_files'
          ? (args.path || args.directory || '.')
          : (args.directory || args.path || '.');
        const sourceSearchRawGlob = String((name === 'grep_files' ? args.glob : args.file_glob) || args.file_glob || args.glob || '').trim();
        const normalizedSourceDirectoryArg = String(directoryArg || '.').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
        if (normalizedSourceDirectoryArg === 'src' || normalizedSourceDirectoryArg.startsWith('src/') || normalizedSourceDirectoryArg === 'web-ui' || normalizedSourceDirectoryArg.startsWith('web-ui/')) {
          const sourceIsWebUi = normalizedSourceDirectoryArg === 'web-ui' || normalizedSourceDirectoryArg.startsWith('web-ui/');
          const delegatedTool = sourceIsWebUi ? 'grep_webui_source' : 'grep_source';
          const sourcePath = sourceIsWebUi
            ? normalizedSourceDirectoryArg.replace(/^web-ui\/?/, '')
            : normalizedSourceDirectoryArg.replace(/^src\/?/, '');
          return executeTool(delegatedTool, {
            pattern,
            path: sourcePath,
            glob: sourceSearchRawGlob,
            case_insensitive: args.case_insensitive,
            context: args.context ?? args.context_lines,
            max_results: args.max_results,
            regex: args.regex,
            literal: args.literal,
            before: args.before,
            after: args.after,
            exclude: args.exclude,
            gitignore: args.gitignore,
            respect_gitignore: args.respect_gitignore,
            include_lockfiles: args.include_lockfiles,
            format: args.format,
          }, workspacePath, deps, sessionId);
        }
        let resolvedDir: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedDir = resolveAllowedWorkspacePath(String(directoryArg), { requireDirectory: true, allowEmpty: true, readOnlyDiagnostics: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const searchDir = resolvedDir.absPath;
        let matcher: SearchMatcher;
        try {
          matcher = createSearchMatcher(pattern, {
            regex: args.regex === true,
            literal: args.literal === true,
            caseInsensitive: args.case_insensitive === true,
          });
        } catch {
          return { name, args, result: `Invalid regex pattern: ${pattern}`, error: true };
        }
        const globs = parseGlobList(sourceSearchRawGlob);
        const requestedMaxResults = Math.floor(Number(args.max_results) || 50);
        const contextLines = Math.max(0, Math.min(3, Math.floor(Number(args.context ?? args.context_lines) || 0)));
        const maxResults = Math.max(1, Math.min(80, requestedMaxResults));
        const requestedMaxFileBytes = Math.floor(Number(args.max_file_bytes) || (5 * 1024 * 1024));
        const maxFileBytes = Math.max(64 * 1024, Math.min(25 * 1024 * 1024, requestedMaxFileBytes));
        const storeLimit = Math.max(maxResults, Math.min(240, maxResults * 3));
        const requestedMaxFiles = Math.floor(Number(args.max_files) || 5_000);
        const maxFiles = Math.max(100, Math.min(25_000, requestedMaxFiles));
        const requestedMaxDurationMs = Math.floor(Number(args.timeout_ms) || 10_000);
        const maxDurationMs = Math.max(500, Math.min(30_000, requestedMaxDurationMs));
        const requestedMaxDepth = Math.floor(Number(args.max_depth) || 24);
        const maxDepth = Math.max(1, Math.min(64, requestedMaxDepth));
        const defaultExcludes = new Set<string>([
          ...DEFAULT_FILE_TOOL_EXCLUDES,
          ...String(args.exclude || '').split(',').map((item: string) => item.trim()).filter(Boolean),
        ]);
        if ((resolvedDir.normalizedRel || '.') === '.') {
          for (const largeRoot of ['audit', 'oss agents', 'oss-agents', 'repos', 'captures', 'videos']) {
            defaultExcludes.add(largeRoot);
          }
        }
        // An explicitly requested directory must never be filtered out by a
        // default exclude (searching "PromSRC/dist" used to return 0 matches
        // silently because "dist" is a default exclude). Drop excludes that
        // name any segment of the requested path, unless the caller passed it.
        {
          const explicitExcludes = new Set(String(args.exclude || '').split(',').map((item: string) => item.trim()).filter(Boolean));
          const requestedSegments = String(resolvedDir.absPath || directoryArg || '').split(/[\\/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
          for (const exclude of Array.from(defaultExcludes)) {
            if (explicitExcludes.has(exclude)) continue;
            if (requestedSegments.includes(String(exclude).toLowerCase())) defaultExcludes.delete(exclude);
          }
        }
        const gitignoreRules = args.gitignore === false || args.respect_gitignore === false ? [] : readSimpleGitignore(searchDir);
        const search = await runBoundedWorkspaceSearch({
          searchDir,
          displayRoot: resolvedDir.displayPath,
          matcher,
          globs,
          excludes: defaultExcludes,
          gitignoreRules,
          maxResults,
          storeLimit,
          maxFileBytes,
          maxFiles,
          maxDurationMs,
          maxDepth,
          contextLines,
          before: Number(args.before) || 40,
          after: Number(args.after) || 80,
          charBefore: Number(args.char_before) || undefined,
          charAfter: Number(args.char_after) || undefined,
          charWindow: Number(args.char_window) || undefined,
          includeLockfiles: args.include_lockfiles === true,
          pathOnly: args.path_only === true || args.mode === 'path',
          signal: deps.abortSignal?.signal,
        });
        const sortedMatches = search.matches.sort(compareGrepMatches(pattern)).slice(0, maxResults);
        const payload = {
          directory: resolvedDir.displayPath,
          pattern,
          search_mode: matcher.mode,
          operation: args.path_only === true || args.mode === 'path' ? 'path_lookup' : 'content_search',
          elapsed_ms: search.elapsedMs,
          files_visited: search.filesVisited,
          files_searched: search.filesSearched,
          files_skipped: search.filesSkipped,
          files_skipped_too_large: search.filesSkippedTooLarge,
          max_file_bytes: maxFileBytes,
          skipped_large_file_samples: search.skippedLargeSamples,
          match_count_observed: search.totalMatchesObserved,
          returned_count: args.path_only === true || args.mode === 'path' ? search.pathMatches.length : sortedMatches.length,
          truncated_count_observed: Math.max(0, search.totalMatchesObserved - sortedMatches.length),
          truncated: search.truncated,
          stop_reason: search.stopReason,
          files_remaining_unknown: search.filesRemainingUnknown,
          path_matches: args.path_only === true || args.mode === 'path' ? search.pathMatches.slice(0, maxResults) : undefined,
          limits: {
            max_files: maxFiles,
            timeout_ms: maxDurationMs,
            max_depth: maxDepth,
          },
          result_limit: {
            requested: requestedMaxResults,
            applied: maxResults,
            context_lines: contextLines,
            limit_reached: search.stopReason === 'result_limit' || search.totalMatchesObserved > sortedMatches.length,
            note: 'Result payloads are hard-clamped. Narrow directory, glob, or pattern to inspect more matches.',
          },
          no_match_hints: search.totalMatchesObserved === 0 ? [
            ...buildNoMatchHints({ pattern, searched: resolvedDir.displayPath, mode: matcher.mode, excluded: Array.from(defaultExcludes), pathHint: String(directoryArg || '.') }),
            ...(search.filesSkippedTooLarge > 0 ? [`${search.filesSkippedTooLarge} large file(s) were skipped to protect gateway responsiveness. Narrow to a specific file and use file_stats/read_file, or explicitly raise max_file_bytes (hard cap 25 MiB).`] : []),
          ] : undefined,
          matches: sortedMatches,
        };
        return { name, args, result: formatGrepToolResult(payload, args.format), error: false };
      }

      case 'file_tree': {
        const ftRootArg = String(args.path || args.directory || '.').trim() || '.';
        let ftResolved: { absPath: string; displayPath: string };
        const ftResolveSourceTree = (): { absPath: string; displayPath: string } | null => {
          const normalized = ftRootArg.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
          if (!(normalized === 'src' || normalized.startsWith('src/') || normalized === 'web-ui' || normalized.startsWith('web-ui/'))) return null;
          const projectRoot = resolveProjectRootForSourceAccess();
          const isWebUi = normalized === 'web-ui' || normalized.startsWith('web-ui/');
          const label = isWebUi ? 'web-ui' : 'src';
          const root = path.join(projectRoot, label);
          const subPath = normalized.replace(new RegExp(`^${label}/?`), '');
          const absPath = path.resolve(root, subPath);
          if (absPath !== root && !absPath.startsWith(root + path.sep)) throw new Error(`Path escapes ${label}/ directory.`);
          if (!fs.existsSync(absPath)) throw new Error(`${label}/${subPath} not found.`);
          const stat = fs.statSync(absPath);
          if (!stat.isDirectory()) throw new Error(`${label}/${subPath} is not a directory.`);
          return { absPath, displayPath: subPath ? `${label}/${subPath}` : label };
        };
        try {
          ftResolved = ftResolveSourceTree() ?? resolveAllowedWorkspacePath(ftRootArg, { requireDirectory: true, allowEmpty: true, readOnlyDiagnostics: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const ftMaxDepth = Math.max(1, Math.min(8, Math.floor(Number(args.max_depth) || FILE_TOOL_DEFAULT_TREE_DEPTH)));
        const ftMaxEntries = Math.max(1, Math.min(1000, Math.floor(Number(args.max_entries) || FILE_TOOL_DEFAULT_TREE_ENTRIES)));
        const ftGlobs = String(args.glob || '').trim().toLowerCase().split(',').map((g: string) => g.trim()).filter(Boolean);
        const ftDefaultExclude = DEFAULT_FILE_TOOL_EXCLUDES;
        const ftExclude = new Set<string>([
          ...ftDefaultExclude,
          ...String(args.exclude || '').split(',').map((e: string) => e.trim()).filter(Boolean),
        ]);
        const ftMatchesGlob = (filename: string): boolean => {
          if (!ftGlobs.length) return true;
          const lower = filename.toLowerCase();
          return ftGlobs.some((g: string) => {
            if (g.startsWith('*.')) return lower.endsWith(g.slice(1));
            return lower.includes(g.replace(/\*/g, ''));
          });
        };
        const ftLines: string[] = [];
        let ftEntryCount = 0;
        let ftTruncated = false;
        const ftPushEntry = (line: string): boolean => {
          if (ftEntryCount >= ftMaxEntries) {
            ftTruncated = true;
            return false;
          }
          ftLines.push(line);
          ftEntryCount += 1;
          return true;
        };
        const ftWalk = (dir: string, depth: number, prefix: string): void => {
          if (depth > ftMaxDepth) return;
          let entries: fs.Dirent[];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          entries = entries.filter((entry) => !ftExclude.has(entry.name));
          entries.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          for (let i = 0; i < entries.length; i++) {
            if (ftTruncated) return;
            const entry = entries[i];
            const isLast = i === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = isLast ? prefix + '    ' : prefix + '│   ';
            if (entry.isDirectory()) {
              if (!ftPushEntry(`${prefix}${connector}${entry.name}/`)) return;
              ftWalk(path.join(dir, entry.name), depth + 1, childPrefix);
            } else if (ftMatchesGlob(entry.name)) {
              if (!ftPushEntry(`${prefix}${connector}${entry.name}`)) return;
            }
          }
        };
        ftLines.push(ftResolved.displayPath || '.');
        ftWalk(ftResolved.absPath, 1, '');
        if (ftTruncated) {
          ftLines.push(`[TREE_TRUNCATED] Returned first ${ftEntryCount} entries. Narrow path/glob or pass max_depth/max_entries when you truly need more.`);
        }
        const ftRepoHeader = args.map === false ? '' : buildRepoMapHeader(ftResolved.absPath, ftResolved.displayPath || '.', { excludes: Array.from(ftExclude) });
        const rendered = `${ftRepoHeader ? `${ftRepoHeader}\n\n` : ''}${ftLines.join('\n')}`;
        return {
          name,
          args,
          result: maybeSpoolToolOutput(name, rendered, resolveResultCharBudget(args, FILE_TOOL_TREE_INLINE_LIMIT_CHARS), {
            allowInline: args.inline === true || args.no_spool === true,
            summary: `file_tree ${ftResolved.displayPath || '.'} returned ${ftEntryCount} entries and exceeded inline budget.`,
          }),
          error: false,
        };
      }

	      case 'find_replace_prom': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const findText = String(args.find || '');
	        const replaceText = String(args.replace ?? '');
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        if (!findText) return { name, args, result: 'ERROR: find text required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: await buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const content = fs.readFileSync(resolved.absPath, 'utf-8');
	        if (!applyTolerantFindReplace(content, findText, replaceText, args.replace_all === true)) {
	          return { name, args, result: buildTextNotFoundRecovery(resolved.normalizedRel, content, findText, 'read_prom_file'), error: true };
	        }
	        const replaceAll = args.replace_all === true;
	        const _frProm = applyTolerantFindReplace(content, findText, replaceText, replaceAll)!;
	        const occurrences = _frProm.count; const updated = _frProm.updated;
	        fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	        console.log(`[edit_prom] find_replace_prom: ${resolved.normalizedRel} (session: ${sessionId})`);
	        const startLine = lineNumberAtOffset(content, _frProm.firstIndex);
	        const replacementLineCount = Math.max(1, replaceText.replace(/\r\n/g, '\n').split('\n').length);
	        return {
	          name,
	          args,
	          result: `${formatPostEditContext(
	            resolved.normalizedRel,
	            updated,
	            startLine,
	            Math.max(startLine, startLine + replacementLineCount - 1),
	            `OK ${resolved.normalizedRel} updated (${occurrences} occurrence${occurrences !== 1 ? 's' : ''} replaced).`,
	          )}\n${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`,
	          error: false,
	        };
	      }

	      case 'replace_lines_prom': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const end = Math.max(start, Math.floor(Number(args.end_line) || start));
	        const newContent = String(args.new_content || '');
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: await buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        if (start > lines.length) {
	          return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, lines, start, 'read_prom_file', 'start_line'), error: true };
	        }
	        const endClamped = Math.min(end, lines.length);
	        const newLines = newContent.split('\n');
	        lines.splice(start - 1, endClamped - start + 1, ...newLines);
	        const updated = lines.join('\n');
	        fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	        console.log(`[edit_prom] replace_lines_prom: ${resolved.normalizedRel} lines ${start}-${endClamped} (session: ${sessionId})`);
	        return {
	          name,
	          args,
	          result: `${formatPostEditContext(
	            resolved.normalizedRel,
	            updated,
	            start,
	            Math.max(start, start + newLines.length - 1),
	            `OK ${resolved.normalizedRel}: replaced lines ${start}-${endClamped} (now ${lines.length} lines).`,
	          )}\n${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`,
	          error: false,
	        };
	      }

	      case 'insert_after_prom': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
	        const content = String(args.content || '');
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: await buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        const insertAt = Math.min(afterLine, lines.length);
	        const newLines = content.split('\n');
	        lines.splice(insertAt, 0, ...newLines);
	        const updated = lines.join('\n');
	        fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	        console.log(`[edit_prom] insert_after_prom: ${resolved.normalizedRel} after line ${afterLine} (session: ${sessionId})`);
	        return {
	          name,
	          args,
	          result: `${formatPostEditContext(
	            resolved.normalizedRel,
	            updated,
	            insertAt + 1,
	            Math.max(insertAt + 1, insertAt + newLines.length),
	            `OK ${resolved.normalizedRel}: inserted after line ${afterLine} (now ${lines.length} lines).`,
	          )}\n${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`,
	          error: false,
	        };
	      }

	      case 'delete_lines_prom': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const end = Math.max(start, Math.floor(Number(args.end_line) || start));
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: await buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        if (start > lines.length) {
	          return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, lines, start, 'read_prom_file', 'start_line'), error: true };
	        }
	        const endClamped = Math.min(end, lines.length);
	        lines.splice(start - 1, endClamped - start + 1);
	        const updated = lines.join('\n');
	        fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	        console.log(`[edit_prom] delete_lines_prom: ${resolved.normalizedRel} lines ${start}-${endClamped} (session: ${sessionId})`);
	        return {
	          name,
	          args,
	          result: `${formatPostEditContext(
	            resolved.normalizedRel,
	            updated,
	            Math.min(start, Math.max(1, lines.length)),
	            Math.min(start, Math.max(1, lines.length)),
	            `OK ${resolved.normalizedRel}: deleted lines ${start}-${endClamped} (now ${lines.length} lines).`,
	          )}\n${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`,
	          error: false,
	        };
	      }

      // ── web-ui/ write tools (proposal sessions only) ─────────────────────────

      case 'find_replace_source': {
        const frs_sid = String(sessionId || '');
        const frsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (frsSessionGate) return frsSessionGate;
        const frs_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?src\//, '');
        const frs_find = String(args.find || '');
        const frs_replace = String(args.replace ?? '');
        if (!frs_rel) return { name, args, result: 'ERROR: file path required', error: true };
        if (!frs_find) return { name, args, result: 'ERROR: find text required', error: true };
        const frs_projectRel = `src/${frs_rel}`;
        const frs_scopeBlocked = enforceProposalWriteAccess(frs_projectRel, 'file', name);
        if (frs_scopeBlocked) return frs_scopeBlocked;
        const frs_projectRoot = resolveProjectRootForSourceAccess();
        const frs_srcRoot = path.join(frs_projectRoot, 'src');
        const frs_absPath = path.resolve(frs_srcRoot, frs_rel);
        if (!frs_absPath.startsWith(frs_srcRoot)) {
          return { name, args, result: 'ERROR: find_replace_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(frs_absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(`src/${frs_rel}`, frs_srcRoot, frs_rel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const frs_content = fs.readFileSync(frs_absPath, 'utf-8');
        const frs_replaceAll = args.replace_all === true;
        const _frSrc = applyTolerantFindReplace(frs_content, frs_find, frs_replace, frs_replaceAll);
        if (!_frSrc) {
          return { name, args, result: buildTextNotFoundRecovery(`src/${frs_rel}`, frs_content, frs_find, 'read_source'), error: true };
        }
        const frs_occurrences = _frSrc.count;
        const frs_updated = _frSrc.updated;
        const frs_invalidEdit = rejectInvalidSourceEdit(name, args, frs_absPath, frs_updated);
        if (frs_invalidEdit) return frs_invalidEdit;
        fs.writeFileSync(frs_absPath, frs_updated, 'utf-8');
        const frs_display = 'src/' + frs_absPath.slice(frs_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] find_replace_source: ${frs_display} (session: ${frs_sid})`);
        const frs_startLine = lineNumberAtOffset(frs_content, _frSrc.firstIndex);
        const frs_replacementLineCount = Math.max(1, frs_replace.replace(/\r\n/g, '\n').split('\n').length);
        return {
          name,
          args,
          result: `${formatPostEditContext(
            frs_display,
            frs_updated,
            frs_startLine,
            Math.max(frs_startLine, frs_startLine + frs_replacementLineCount - 1),
            `✅ ${frs_display} updated (${frs_occurrences} occurrence${frs_occurrences !== 1 ? 's' : ''} replaced).`,
          )}\n${getPostSourceEditInstructionForSession(sessionId, [frs_display])}`,
          error: false,
        };
      }

	      case 'replace_lines_source': {
	        const rls_sid = String(sessionId || '');
        const rlsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (rlsSessionGate) return rlsSessionGate;
	        const rls_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
        const rls_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
        const rls_end = Math.max(rls_start, Math.floor(Number(args.end_line) || rls_start));
	        const rls_newContent = String(args.new_content || '');
	        if (!rls_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const rls_projectRel = `src/${rls_rel.replace(/^\.?\/?src\//, '')}`;
	        const rls_scopeBlocked = enforceProposalWriteAccess(rls_projectRel, 'file', name);
	        if (rls_scopeBlocked) return rls_scopeBlocked;
	        const rls_projectRoot = resolveProjectRootForSourceAccess();
	        const rls_srcRoot = path.join(rls_projectRoot, 'src');
        const rls_absPath = path.resolve(rls_srcRoot, rls_rel.replace(/^\.?\/?src\//, ''));
        if (!rls_absPath.startsWith(rls_srcRoot)) {
          return { name, args, result: 'ERROR: replace_lines_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(rls_absPath)) {
          const rls_normalizedRel = rls_rel.replace(/^\.?\/?src\//, '');
          return { name, args, result: await buildPathNotFoundRecovery(`src/${rls_normalizedRel}`, rls_srcRoot, rls_normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const rls_content = fs.readFileSync(rls_absPath, 'utf-8');
        const rls_originalLines = splitLinesEolSafe(rls_content);
        if (rls_start > rls_originalLines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(`src/${rls_rel.replace(/^\.?\/?src\//, '')}`, rls_originalLines, rls_start, 'read_source', 'start_line'), error: true };
        }
        const rls_replaced = applyReplaceLinesEolSafe(rls_content, rls_start, rls_end, rls_newContent);
        const rls_updated = rls_replaced.updated;
        const rls_invalidEdit = rejectInvalidSourceEdit(name, args, rls_absPath, rls_updated);
        if (rls_invalidEdit) return rls_invalidEdit;
        fs.writeFileSync(rls_absPath, rls_updated, 'utf-8');
        const rls_display = 'src/' + rls_absPath.slice(rls_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] replace_lines_source: ${rls_display} lines ${rls_start}-${rls_replaced.endClamped} (session: ${rls_sid})`);
        return {
          name,
          args,
          result: `${formatPostEditContext(
            rls_display,
            rls_updated,
            rls_start,
            Math.max(rls_start, rls_start + rls_replaced.newLines.length - 1),
            `✅ ${rls_display}: replaced lines ${rls_start}-${rls_replaced.endClamped} (now ${rls_replaced.lines.length} lines).`,
          )}\n${getPostSourceEditInstructionForSession(sessionId, [rls_display])}`,
          error: false,
        };
      }

      // ── insert_after_source: insert lines after a given line in src/ ─────────
	      case 'insert_after_source': {
	        const ias_sid = String(sessionId || '');
        const iasSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (iasSessionGate) return iasSessionGate;
	        const ias_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
	        const ias_afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
	        const ias_content = String(args.content || '');
	        if (!ias_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const ias_projectRel = `src/${ias_rel.replace(/^\.?\/?src\//, '')}`;
	        const ias_scopeBlocked = enforceProposalWriteAccess(ias_projectRel, 'file', name);
	        if (ias_scopeBlocked) return ias_scopeBlocked;
	        const ias_projectRoot = resolveProjectRootForSourceAccess();
	        const ias_srcRoot = path.join(ias_projectRoot, 'src');
        const ias_absPath = path.resolve(ias_srcRoot, ias_rel.replace(/^\.?\/?src\//, ''));
        if (!ias_absPath.startsWith(ias_srcRoot)) {
          return { name, args, result: 'ERROR: insert_after_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(ias_absPath)) {
          const ias_normalizedRel = ias_rel.replace(/^\.?\/?src\//, '');
          return { name, args, result: await buildPathNotFoundRecovery(`src/${ias_normalizedRel}`, ias_srcRoot, ias_normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const ias_fileContent = fs.readFileSync(ias_absPath, 'utf-8');
        const ias_inserted = applyInsertAfterEolSafe(ias_fileContent, ias_afterLine, ias_content);
        const ias_updated = ias_inserted.updated;
        const ias_invalidEdit = rejectInvalidSourceEdit(name, args, ias_absPath, ias_updated);
        if (ias_invalidEdit) return ias_invalidEdit;
        fs.writeFileSync(ias_absPath, ias_updated, 'utf-8');
        const ias_display = 'src/' + ias_absPath.slice(ias_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] insert_after_source: ${ias_display} after line ${ias_afterLine} (session: ${ias_sid})`);
        return {
          name,
          args,
          result: `${formatPostEditContext(
            ias_display,
            ias_updated,
            ias_inserted.insertAt + 1,
            Math.max(ias_inserted.insertAt + 1, ias_inserted.insertAt + ias_inserted.newLines.length),
            `✅ ${ias_display}: inserted after line ${ias_afterLine} (now ${ias_inserted.lines.length} lines).`,
          )}\n${getPostSourceEditInstructionForSession(sessionId, [ias_display])}`,
          error: false,
        };
      }

      // ── delete_lines_source: delete a range of lines from a src/ file ─────────
	      case 'delete_lines_source': {
	        const dls_sid = String(sessionId || '');
        const dlsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (dlsSessionGate) return dlsSessionGate;
	        const dls_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
	        const dls_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const dls_end = Math.max(dls_start, Math.floor(Number(args.end_line) || dls_start));
	        if (!dls_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const dls_projectRel = `src/${dls_rel.replace(/^\.?\/?src\//, '')}`;
	        const dls_scopeBlocked = enforceProposalWriteAccess(dls_projectRel, 'file', name);
	        if (dls_scopeBlocked) return dls_scopeBlocked;
	        const dls_projectRoot = resolveProjectRootForSourceAccess();
	        const dls_srcRoot = path.join(dls_projectRoot, 'src');
        const dls_absPath = path.resolve(dls_srcRoot, dls_rel.replace(/^\.?\/?src\//, ''));
        if (!dls_absPath.startsWith(dls_srcRoot)) {
          return { name, args, result: 'ERROR: delete_lines_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(dls_absPath)) {
          const dls_normalizedRel = dls_rel.replace(/^\.?\/?src\//, '');
          return { name, args, result: await buildPathNotFoundRecovery(`src/${dls_normalizedRel}`, dls_srcRoot, dls_normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const dls_content = fs.readFileSync(dls_absPath, 'utf-8');
        const dls_originalLines = splitLinesEolSafe(dls_content);
        if (dls_start > dls_originalLines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(`src/${dls_rel.replace(/^\.?\/?src\//, '')}`, dls_originalLines, dls_start, 'read_source', 'start_line'), error: true };
        }
        const dls_deleted = applyDeleteLinesEolSafe(dls_content, dls_start, dls_end);
        const dls_updated = dls_deleted.updated;
        const dls_invalidEdit = rejectInvalidSourceEdit(name, args, dls_absPath, dls_updated);
        if (dls_invalidEdit) return dls_invalidEdit;
        fs.writeFileSync(dls_absPath, dls_updated, 'utf-8');
        const dls_display = 'src/' + dls_absPath.slice(dls_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] delete_lines_source: ${dls_display} lines ${dls_start}-${dls_deleted.endClamped} (session: ${dls_sid})`);
        return {
          name,
          args,
          result: `${formatPostEditContext(
            dls_display,
            dls_updated,
            Math.min(dls_start, Math.max(1, dls_deleted.lines.length)),
            Math.min(dls_start, Math.max(1, dls_deleted.lines.length)),
            `✅ ${dls_display}: deleted lines ${dls_start}-${dls_deleted.endClamped} (now ${dls_deleted.lines.length} lines).`,
          )}\n${getPostSourceEditInstructionForSession(sessionId, [dls_display])}`,
          error: false,
        };
      }

      // ── web-ui/ write tools (proposal sessions only) ─────────────────────────

      // ── find_replace_webui_source ─────────────────────────────────────────────
	      case 'find_replace_webui_source': {
	        const frwu_sid = String(sessionId || '');
        const frwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (frwuSessionGate) return frwuSessionGate;
	        const frwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const frwu_find = String(args.find || '');
	        const frwu_replace = String(args.replace ?? '');
	        if (!frwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        if (!frwu_find) return { name, args, result: 'ERROR: find text required', error: true };
	        const frwu_projectRel = `web-ui/${frwu_rel}`;
	        const frwu_scopeBlocked = enforceProposalWriteAccess(frwu_projectRel, 'file', name);
	        if (frwu_scopeBlocked) return frwu_scopeBlocked;
	        const frwu_projectRoot = resolveProjectRootForSourceAccess();
	        const frwu_webUiRoot = path.join(frwu_projectRoot, 'web-ui');
        const frwu_absPath = path.resolve(frwu_webUiRoot, frwu_rel);
        if (!frwu_absPath.startsWith(frwu_webUiRoot)) {
          return { name, args, result: 'ERROR: find_replace_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(frwu_absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(`web-ui/${frwu_rel}`, frwu_webUiRoot, frwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const frwu_content = fs.readFileSync(frwu_absPath, 'utf-8');
        const frwu_replaceAll = args.replace_all === true;
        const _frWui = applyTolerantFindReplace(frwu_content, frwu_find, frwu_replace, frwu_replaceAll);
        if (!_frWui) {
          return { name, args, result: buildTextNotFoundRecovery(`web-ui/${frwu_rel}`, frwu_content, frwu_find, 'read_webui_source'), error: true };
        }
        const frwu_occurrences = _frWui.count;
        const frwu_updated = _frWui.updated;
        const frwu_invalidEdit = rejectInvalidSourceEdit(name, args, frwu_absPath, frwu_updated);
        if (frwu_invalidEdit) return frwu_invalidEdit;
        fs.writeFileSync(frwu_absPath, frwu_updated, 'utf-8');
        const frwu_display = 'web-ui/' + frwu_absPath.slice(frwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] find_replace_webui_source: ${frwu_display} (session: ${frwu_sid})`);
        const frwu_startLine = lineNumberAtOffset(frwu_content, _frWui.firstIndex);
        const frwu_replacementLineCount = Math.max(1, frwu_replace.replace(/\r\n/g, '\n').split('\n').length);
        return {
          name,
          args,
          result: `${formatPostEditContext(
            frwu_display,
            frwu_updated,
            frwu_startLine,
            Math.max(frwu_startLine, frwu_startLine + frwu_replacementLineCount - 1),
            `OK ${frwu_display} updated (${frwu_occurrences} occurrence${frwu_occurrences !== 1 ? 's' : ''} replaced).`,
          )}\n${getPostSourceEditInstructionForSession(sessionId, [frwu_display])}`,
          error: false,
        };
      }

      // ── replace_lines_webui_source ────────────────────────────────────────────
	      case 'replace_lines_webui_source': {
	        const rlwu_sid = String(sessionId || '');
        const rlwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (rlwuSessionGate) return rlwuSessionGate;
	        const rlwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const rlwu_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const rlwu_end = Math.max(rlwu_start, Math.floor(Number(args.end_line) || rlwu_start));
	        const rlwu_newContent = String(args.new_content || '');
	        if (!rlwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const rlwu_projectRel = `web-ui/${rlwu_rel}`;
	        const rlwu_scopeBlocked = enforceProposalWriteAccess(rlwu_projectRel, 'file', name);
	        if (rlwu_scopeBlocked) return rlwu_scopeBlocked;
	        const rlwu_projectRoot = resolveProjectRootForSourceAccess();
	        const rlwu_webUiRoot = path.join(rlwu_projectRoot, 'web-ui');
        const rlwu_absPath = path.resolve(rlwu_webUiRoot, rlwu_rel);
        if (!rlwu_absPath.startsWith(rlwu_webUiRoot)) {
          return { name, args, result: 'ERROR: replace_lines_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(rlwu_absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(`web-ui/${rlwu_rel}`, rlwu_webUiRoot, rlwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const rlwu_content = fs.readFileSync(rlwu_absPath, 'utf-8');
        const rlwu_originalLines = splitLinesEolSafe(rlwu_content);
        if (rlwu_start > rlwu_originalLines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(`web-ui/${rlwu_rel}`, rlwu_originalLines, rlwu_start, 'read_webui_source', 'start_line'), error: true };
        }
        const rlwu_replaced = applyReplaceLinesEolSafe(rlwu_content, rlwu_start, rlwu_end, rlwu_newContent);
        const rlwu_updated = rlwu_replaced.updated;
        const rlwu_invalidEdit = rejectInvalidSourceEdit(name, args, rlwu_absPath, rlwu_updated);
        if (rlwu_invalidEdit) return rlwu_invalidEdit;
        fs.writeFileSync(rlwu_absPath, rlwu_updated, 'utf-8');
        const rlwu_display = 'web-ui/' + rlwu_absPath.slice(rlwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] replace_lines_webui_source: ${rlwu_display} lines ${rlwu_start}-${rlwu_replaced.endClamped} (session: ${rlwu_sid})`);
        return {
          name,
          args,
          result: `${formatPostEditContext(
            rlwu_display,
            rlwu_updated,
            rlwu_start,
            Math.max(rlwu_start, rlwu_start + rlwu_replaced.newLines.length - 1),
            `OK ${rlwu_display}: replaced lines ${rlwu_start}-${rlwu_replaced.endClamped} (now ${rlwu_replaced.lines.length} lines).`,
          )}\n${getPostSourceEditInstructionForSession(sessionId, [rlwu_display])}`,
          error: false,
        };
      }

      // ── insert_after_webui_source ─────────────────────────────────────────────
	      case 'insert_after_webui_source': {
	        const iawu_sid = String(sessionId || '');
        const iawuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (iawuSessionGate) return iawuSessionGate;
	        const iawu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
	        const iawu_afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
	        const iawu_content = String(args.content || '');
	        if (!iawu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const iawu_projectRel = `web-ui/${iawu_rel}`;
	        const iawu_scopeBlocked = enforceProposalWriteAccess(iawu_projectRel, 'file', name);
	        if (iawu_scopeBlocked) return iawu_scopeBlocked;
	        const iawu_projectRoot = resolveProjectRootForSourceAccess();
	        const iawu_webUiRoot = path.join(iawu_projectRoot, 'web-ui');
        const iawu_absPath = path.resolve(iawu_webUiRoot, iawu_rel);
        if (!iawu_absPath.startsWith(iawu_webUiRoot)) {
          return { name, args, result: 'ERROR: insert_after_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(iawu_absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(`web-ui/${iawu_rel}`, iawu_webUiRoot, iawu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const iawu_fileContent = fs.readFileSync(iawu_absPath, 'utf-8');
        const iawu_inserted = applyInsertAfterEolSafe(iawu_fileContent, iawu_afterLine, iawu_content);
        const iawu_updated = iawu_inserted.updated;
        const iawu_invalidEdit = rejectInvalidSourceEdit(name, args, iawu_absPath, iawu_updated);
        if (iawu_invalidEdit) return iawu_invalidEdit;
        fs.writeFileSync(iawu_absPath, iawu_updated, 'utf-8');
        const iawu_display = 'web-ui/' + iawu_absPath.slice(iawu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] insert_after_webui_source: ${iawu_display} after line ${iawu_afterLine} (session: ${iawu_sid})`);
        return {
          name,
          args,
          result: `${formatPostEditContext(
            iawu_display,
            iawu_updated,
            iawu_inserted.insertAt + 1,
            Math.max(iawu_inserted.insertAt + 1, iawu_inserted.insertAt + iawu_inserted.newLines.length),
            `OK ${iawu_display}: inserted after line ${iawu_afterLine} (now ${iawu_inserted.lines.length} lines).`,
          )}\n${getPostSourceEditInstructionForSession(sessionId, [iawu_display])}`,
          error: false,
        };
      }

      // ── delete_lines_webui_source ─────────────────────────────────────────────
	      case 'delete_lines_webui_source': {
	        const dlwu_sid = String(sessionId || '');
        const dlwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (dlwuSessionGate) return dlwuSessionGate;
	        const dlwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
	        const dlwu_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const dlwu_end = Math.max(dlwu_start, Math.floor(Number(args.end_line) || dlwu_start));
	        if (!dlwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const dlwu_projectRel = `web-ui/${dlwu_rel}`;
	        const dlwu_scopeBlocked = enforceProposalWriteAccess(dlwu_projectRel, 'file', name);
	        if (dlwu_scopeBlocked) return dlwu_scopeBlocked;
	        const dlwu_projectRoot = resolveProjectRootForSourceAccess();
	        const dlwu_webUiRoot = path.join(dlwu_projectRoot, 'web-ui');
        const dlwu_absPath = path.resolve(dlwu_webUiRoot, dlwu_rel);
        if (!dlwu_absPath.startsWith(dlwu_webUiRoot)) {
          return { name, args, result: 'ERROR: delete_lines_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(dlwu_absPath)) {
          return { name, args, result: await buildPathNotFoundRecovery(`web-ui/${dlwu_rel}`, dlwu_webUiRoot, dlwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const dlwu_content = fs.readFileSync(dlwu_absPath, 'utf-8');
        const dlwu_originalLines = splitLinesEolSafe(dlwu_content);
        if (dlwu_start > dlwu_originalLines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(`web-ui/${dlwu_rel}`, dlwu_originalLines, dlwu_start, 'read_webui_source', 'start_line'), error: true };
        }
        const dlwu_deleted = applyDeleteLinesEolSafe(dlwu_content, dlwu_start, dlwu_end);
        const dlwu_updated = dlwu_deleted.updated;
        const dlwu_invalidEdit = rejectInvalidSourceEdit(name, args, dlwu_absPath, dlwu_updated);
        if (dlwu_invalidEdit) return dlwu_invalidEdit;
        fs.writeFileSync(dlwu_absPath, dlwu_updated, 'utf-8');
        const dlwu_display = 'web-ui/' + dlwu_absPath.slice(dlwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] delete_lines_webui_source: ${dlwu_display} lines ${dlwu_start}-${dlwu_deleted.endClamped} (session: ${dlwu_sid})`);
        return {
          name,
          args,
          result: `${formatPostEditContext(
            dlwu_display,
            dlwu_updated,
            Math.min(dlwu_start, Math.max(1, dlwu_deleted.lines.length)),
            Math.min(dlwu_start, Math.max(1, dlwu_deleted.lines.length)),
            `OK ${dlwu_display}: deleted lines ${dlwu_start}-${dlwu_deleted.endClamped} (now ${dlwu_deleted.lines.length} lines).`,
          )}\n${getPostSourceEditInstructionForSession(sessionId, [dlwu_display])}`,
          error: false,
        };
      }

      case 'git_status': {
        try {
          const cwd = args.cwd ? resolveAllowedWorkspacePath(String(args.cwd), { requireDirectory: true }).absPath : workspacePath;
          return runCapturedToolCommand('git status --short --branch', cwd, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'git_log': {
        try {
          const limit = Math.max(1, Math.min(50, Number(args.limit || 10)));
          const parts = [`git log --oneline --decorate -n ${limit}`];
          if (args.path) {
            const resolved = resolveAllowedWorkspacePath(String(args.path));
            parts.push('--', quoteArg(resolved.displayPath));
          }
          return runCapturedToolCommand(parts.join(' '), workspacePath, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'git_branch': {
        try {
          const action = String(args.action || 'list').trim().toLowerCase();
          if (action === 'list') return runCapturedToolCommand('git branch --all --verbose', workspacePath, 120000);
          const branch = String(args.branch || '').trim();
          if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) return { name, args, result: 'ERROR: branch is required and must be a safe branch name.', error: true };
          if (action === 'create') {
            const startPoint = String(args.start_point || '').trim();
            return runCapturedToolCommand(`git branch ${quoteArg(branch)}${startPoint ? ` ${quoteArg(startPoint)}` : ''}`, workspacePath, 120000);
          }
          if (action === 'switch' || action === 'checkout') {
            return runCapturedToolCommand(`git switch ${quoteArg(branch)}`, workspacePath, 120000);
          }
          return { name, args, result: 'ERROR: action must be list, create, or switch.', error: true };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'git_commit': {
        const message = String(args.message || '').trim();
        if (!message) return { name, args, result: 'message is required', error: true };
        try {
          if (Array.isArray(args.paths) && args.paths.length) {
            const pathspecs = args.paths.map((p: any) => quoteArg(resolveAllowedWorkspacePath(String(p)).displayPath)).join(' ');
            const add = await deps.runCommandCaptured(`git add -- ${pathspecs}`, workspacePath, 120000);
            if (add.code !== 0) return { name, args, result: `git add failed:\n${add.stderr || add.stdout}`, error: true };
          } else if (args.all === true) {
            const add = await deps.runCommandCaptured('git add -A', workspacePath, 120000);
            if (add.code !== 0) return { name, args, result: `git add -A failed:\n${add.stderr || add.stdout}`, error: true };
          }
          return runCapturedToolCommand(`git commit -m ${quoteArg(message)}`, workspacePath, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'git_push': {
        try {
          const remote = String(args.remote || 'origin').trim();
          let branch = String(args.branch || '').trim();
          if (!branch) {
            const current = await deps.runCommandCaptured('git branch --show-current', workspacePath, 120000);
            branch = String(current.stdout || '').trim();
          }
          if (!/^[A-Za-z0-9._\/-]+$/.test(remote) || !/^[A-Za-z0-9._\/-]+$/.test(branch)) {
            return { name, args, result: 'ERROR: remote/branch must be safe names.', error: true };
          }
          const upstream = args.set_upstream === true ? '--set-upstream ' : '';
          return runCapturedToolCommand(`git push ${upstream}${quoteArg(remote)} ${quoteArg(branch)}`, workspacePath, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'snapshot_workspace': {
        try {
          const id = `snap_${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`;
          const root = snapshotRoot();
          const snapDir = path.join(root, id);
          const filesDir = path.join(snapDir, 'files');
          fs.mkdirSync(filesDir, { recursive: true });
          const scopeArg = String(args.path || args.directory || '').trim();
          const scope = scopeArg
            ? resolveAllowedWorkspacePath(scopeArg, { requireDirectory: true, allowEmpty: true })
            : { absPath: workspacePath, normalizedRel: '', displayPath: '.' };
          const scopedFiles = walkFiles(scope.absPath, {
            maxFiles: Math.max(1, Math.min(20000, Number(args.max_files || 2000))),
            maxBytes: Math.max(1, Number(args.max_bytes || 50_000_000)),
          });
          const scopePrefix = String(scope.normalizedRel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
          const files = scopedFiles.map((file) => ({
            ...file,
            relPath: scopePrefix ? `${scopePrefix}/${file.relPath}`.replace(/\\/g, '/') : file.relPath,
          }));
          for (const file of files) {
            const dest = path.join(filesDir, file.relPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(file.absPath, dest);
          }
          const manifest = {
            id,
            label: String(args.label || '').trim(),
            workspacePath,
            scope: scopePrefix || '.',
            createdAt: Date.now(),
            fileCount: files.length,
            totalBytes: files.reduce((sum, f) => sum + f.size, 0),
            files: files.map(f => ({ path: f.relPath, size: f.size })),
          };
          fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
          return { name, args, result: JSON.stringify(manifest, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'code_outline': {
        try {
          const requested = args.file || args.filename || args.path;
          if (!requested) return { name, args, result: 'file is required', error: true };
          const resolved = resolveAllowedWorkspacePath(String(requested), { requireFile: true });
          const outline = await buildCodeOutlineForFile(resolved.absPath, Math.max(1, Math.min(1000, Number(args.max_symbols || 300))));
          return { name, args, result: JSON.stringify(outline, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

	      case 'run_command': {
        const rawCmd = (args.command || '').trim();
        if (!rawCmd) return { name, args, result: 'command is required', error: true };
        if (!isTerminalFirstWorkspaceMode(getConfig().getConfig()) && looksLikeNativeFileToolBypass(rawCmd)) {
          return {
            name,
            args,
            result: 'Blocked: this looks like an ad hoc shell/Python/Node/PowerShell file edit. Use native workspace wrappers instead: workspace_read(action:"stats"/"read"/"grep") first, then workspace_edit(action:"find_replace"/"replace_lines"/"insert_after"/"delete_lines"/"write"/"create"/"append") or workspace_edit(action:"patchset"). Use workspace_run for tests, builds, git/status, package installs, diagnostics, or transformations the file tools cannot perform.',
            error: true,
          };
        }
        const cmd = rawCmd.toLowerCase();
        if (/\b(playwright|npx\s+playwright|npm\s+exec\s+playwright|pnpm\s+exec\s+playwright|yarn\s+playwright)\b[\s\S]*\binstall\b/.test(cmd)) {
          return {
            name,
            args,
            result: 'Blocked: agents must not install Playwright browser binaries during task execution. Browser runtime setup belongs to the app/bootstrap layer, not background-agent work.',
            error: true,
          };
        }
        const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
        // Visible shells are an explicit escape hatch only. The old `window`
        // alias made it too easy for a model/tool payload to open a terminal
        // accidentally, and the `/k` launcher below left every such shell
        // open indefinitely.
        const wantVisible = args.visible === true;
        let commandCwd: { cwd: string; displayCwd: string };
        try {
          commandCwd = resolveRunCommandCwd(args.cwd);
        } catch (err: any) {
          return { name, args, result: `Invalid cwd for run_command: ${err.message || err}`, error: true };
        }
        const commandBoundary = analyzeRunCommandBoundary(normalizedCmd, commandCwd.cwd);
        if (commandBoundary.blocked) return commandBoundary.blocked;
        const shellTokenPolicyBlock = maybeBlockShellTokenPolicy(rawCmd, normalizedCmd);
        if (shellTokenPolicyBlock) return shellTokenPolicyBlock;
        if (args.elevated === true) {
          if (!approvedCommandApprovalId) {
            return { name, args, result: 'Blocked: administrator execution requires a fresh one-shot approval.', error: true };
          }
          try {
            const workspaceTracker = shouldTrackTerminalWorkspaceChanges(normalizedCmd) ? createTerminalWorkspaceTracker({
              workspacePath,
              cwd: commandCwd.cwd,
              command: normalizedCmd,
              sessionId,
              toolCallId: deps.toolCallId,
            }) : null;
            const elevated = await runElevatedCommand({
              command: normalizedCmd,
              cwd: commandCwd.cwd,
              shell: args.shell || 'auto',
              timeoutMs: Number(args.timeoutMs || args.timeout_ms || 120_000),
            });
            const output = [elevated.stdout, elevated.stderr].filter(Boolean).join('\n').trim();
            const ok = !elevated.timedOut && elevated.exitCode === 0;
            const workspaceResult = workspaceTracker?.finalize();
            return {
              name,
              args,
              result: `${normalizedCmd} [${elevated.timedOut ? 'administrator timeout' : `administrator exit ${elevated.exitCode}`}] cwd=${commandCwd.displayCwd}\n${output.slice(0, 4000) || '(no output)'}`,
              error: !ok,
              extra: {
                elevated: true,
                approvalId: approvedCommandApprovalId,
                exitCode: elevated.exitCode,
                timedOut: elevated.timedOut,
                ...(workspaceResult?.workspaceChanges.length ? {
                  workspacePath: workspaceResult.workspacePath,
                  workspaceChanges: workspaceResult.workspaceChanges,
                  workspaceSnapshots: workspaceResult.workspaceSnapshots,
                  workspaceChangeSource: workspaceResult.workspaceChangeSource,
                  ...(workspaceResult.truncated ? { workspaceChangesTruncated: true } : {}),
                } : {}),
              },
            };
          } catch (error: any) {
            return { name, args, result: `Administrator command failed: ${error?.message || error}`, error: true };
          }
        }
        const requestedYieldMs = Number(args.yieldTimeMs ?? args.yield_time_ms ?? DEFAULT_RUN_YIELD_MS);
        const yieldTimeMs = Number.isFinite(requestedYieldMs)
          ? Math.max(1_000, Math.min(30_000, requestedYieldMs))
          : DEFAULT_RUN_YIELD_MS;
        let streamToSse = true;
        const onCommandOutput = (event: { runId: string; stream: 'stdout' | 'stderr' | 'combined'; chunk: string; sequence: number }) => {
          if (!streamToSse) return;
          deps.sendSSE?.('process_run_output', {
            ...event,
            action: 'run_command',
            sessionId,
            toolCallId: deps.toolCallId,
          });
        };
        const yieldedCommandResult = (captured: { runId?: string; stdout: string }) => ({
          name,
          args,
          result: `${normalizedCmd} [still running] run=${captured.runId || 'n/a'} cwd=${commandCwd.displayCwd}\n${captured.stdout.slice(-4000) || '(no output yet)'}\nUse process_status/process_log to inspect it, process_wait for a bounded wait, or process_kill to stop it.`,
          error: false,
          extra: { runId: captured.runId, stillRunning: true },
        });
        let execCmd = '';

        // 1. Check allowlist (exact match)
        if (deps.SAFE_COMMANDS[cmd]) {
          execCmd = deps.SAFE_COMMANDS[cmd];
        }
        // 2. "chrome <url>" or "browser <url>" â†’ open browser with URL
        else if (/^(chrome|browser|firefox|edge)\s+/.test(cmd)) {
          const parts = rawCmd.split(/\s+/);
          const app = parts[0].toLowerCase();
          let url = parts.slice(1).join(' ');
          // Add https:// only when no URI scheme is present.
          // This preserves file://, chrome://, about:, etc.
          if (url && !deps.hasUriScheme(url)) url = 'https://' + url;
          execCmd = deps.buildBrowserLaunchCommand(app, url);
        }
        // 3. URL/URI â†’ open in default browser
        else if (/^(https?:\/\/|file:\/\/|chrome:\/\/|about:|www\.)/.test(cmd)) {
          const url = cmd.startsWith('www.') ? 'https://' + rawCmd : rawCmd;
          execCmd = deps.buildUrlOpenCommand(url);
        }
        // 4. Bare domain like "youtube.com" â†’ open in browser
        else if (/^[a-z0-9-]+\.[a-z]{2,}/.test(cmd) && !cmd.includes(' ')) {
          execCmd = deps.buildUrlOpenCommand(`https://${rawCmd}`);
        }
        // 5. "code <path>" â†’ VS Code
        else if (cmd.startsWith('code ')) {
          execCmd = rawCmd;
        }
        // 6. Windows-only: "start <url>" â†’ pass through
        else if (deps.isWindows && (cmd.startsWith('start http') || cmd.startsWith('start https'))) {
          execCmd = rawCmd;
        }
        // 7. Windows-only: "explorer <path>"
        else if (deps.isWindows && cmd.startsWith('explorer ')) {
          execCmd = rawCmd;
        }
        // 8. Dev CLI tools: git, npm, node, npx, python, pip, tsc, cargo, etc.
        //    DEFAULT: captured mode (returns stdout/stderr). Pass visible:true to open a window.
        else if (/^(git|npm|node|npx|yarn|pnpm|python|python3|pip|pip3|tsc|ts-node|cargo|rustc|go|java|javac|mvn|gradle|dotnet|docker|kubectl|az|aws|xurl)\b/.test(cmd)) {
          if (!wantVisible) {
            // Captured mode (DEFAULT) — wait for completion and return output
            try {
              const captured = await deps.runCommandCaptured(normalizedCmd, commandCwd.cwd, Number(args.timeoutMs || args.timeout_ms || 120_000), {
                shell: args.shell,
                pty: args.pty === true,
                approvalId: approvedCommandApprovalId || undefined,
                sessionId,
                toolCallId: deps.toolCallId,
                workspacePath,
                yieldTimeMs,
                onOutput: onCommandOutput,
              });
              streamToSse = false;
              if (captured.yielded) return yieldedCommandResult(captured);
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
              const outcome = classifyCommandTermination(captured);
              return {
                name, args,
                result: `${normalizedCmd} [${outcome.label}] run=${captured.runId || 'n/a'} cwd=${commandCwd.displayCwd}\n${output.slice(0, 4000) || '(no output)'}`,
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
            } catch (capErr: any) {
              return { name, args, result: `run_command capture failed: ${capErr.message}`, error: true };
            }
          }
          // Windowed mode (only when explicitly requested). `/c` is deliberate:
          // the command window closes when the command finishes, so an agent
          // cannot leave a pile of orphaned terminals behind.
          if (deps.isWindows) {
            const escaped = normalizedCmd.replace(/"/g, '""');
            execCmd = `start "" cmd.exe /d /s /c "${escaped}"`;
          } else {
            execCmd = normalizedCmd;
          }
        }
        // 9. Fallback: in default terminal mode, broader commands may run after normal command approval.
        // Lite mode already enforced the shell token allowlist above.
        else {
          if (!wantVisible) {
            try {
              const captured = await deps.runCommandCaptured(normalizedCmd, commandCwd.cwd, Number(args.timeoutMs || args.timeout_ms || 120_000), {
                shell: args.shell,
                pty: args.pty === true,
                approvalId: approvedCommandApprovalId || undefined,
                sessionId,
                toolCallId: deps.toolCallId,
                workspacePath,
                yieldTimeMs,
                onOutput: onCommandOutput,
              });
              streamToSse = false;
              if (captured.yielded) return yieldedCommandResult(captured);
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
              const outcome = classifyCommandTermination(captured);
              return {
                name, args,
                result: `${normalizedCmd} [${outcome.label}] run=${captured.runId || 'n/a'} cwd=${commandCwd.displayCwd}\n${output.slice(0, 4000) || '(no output)'}`,
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
            } catch (capErr: any) {
              return { name, args, result: `run_command capture failed: ${capErr.message}`, error: true };
            }
          }
          if (deps.isWindows) {
            const escaped = normalizedCmd.replace(/"/g, '""');
            execCmd = `start "" cmd.exe /d /s /c "${escaped}"`;
          } else {
            execCmd = normalizedCmd;
          }
        }

        if (!execCmd) {
          return {
            name,
            args,
            result: `Command "${rawCmd}" was not executable.`,
            error: true,
          };
        }
        try {
          const { exec } = await import('child_process');
          exec(execCmd, { cwd: commandCwd.cwd });
          return { name, args, result: `Executed: ${execCmd}`, error: false };
        } catch (err: any) {
          return { name, args, result: `Failed: ${err.message}`, error: true };
        }
      }
 }
 throw new Error(`Unsupported workspace tool: ${name}`);
}
