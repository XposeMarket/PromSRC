import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { looksLikeNativeFileToolBypass } from './../native-file-tool-bypass';
import { shouldTrackTerminalWorkspaceChanges } from './../../terminal-service';
import { createHash } from 'crypto';
import { getConfig } from './../../../config/config';
import { executeAnalyzeVideo } from './../../../tools/media-analysis';
import { listWorkspaceHistory, restoreWorkspaceCheckpoint, restoreWorkspaceSnapshot } from './../../../workspace-history';
import { DEFAULT_FILE_TOOL_EXCLUDES, buildFileIntelligence, buildNoMatchHints, collectGrepMatchesInText, compareGrepMatches, createSearchMatcher, formatGrepToolResult, matchesGlobList, parseGlobList, readSimpleGitignore, resolveResultCharBudget, shouldSkipSearchPath, summarizeFileForTool, type SearchMatcher } from './../../../tools/file-intelligence';
import { getProcessSupervisor } from './../../process/supervisor';
import { normalizeDevSourcePatchsetArgs, splitLinesEolSafe } from './../../dev-source-patchset';
import { executeAgentBuilderTool } from './../agent-builder-integration';
import { parseSchedulePattern } from './../../scheduling/schedule-pattern';
import { saveSiteShortcut } from './../../site-shortcuts';
import { deployAnalysisTeamTool } from './../../../tools/deploy-analysis-team.js';
import { socialIntelTool } from './../../../tools/social-scraper.js';
import { type ToolResult } from './../../tool-builder';
import { getCreativeMode, normalizeCreativeMode, setCreativeMode } from './../../session';
import { type CodeEvidenceFile } from './../../code-evidence';
import { classifyCommandTermination } from './../../process/command-outcome';
import { isTerminalFirstWorkspaceMode } from './../../../runtime/workspace-tool-mode.js';
import { appendEntityEvent, listEntities, readEntity, writeEntity } from './../../business/entity-store';
import { FILE_TOOL_DEFAULT_READ_LINES, FILE_TOOL_DEFAULT_BATCH_FILES, FILE_TOOL_MAX_BATCH_FILES, FILE_TOOL_DEFAULT_BATCH_LINES, FILE_TOOL_MAX_BATCH_LINES, FILE_TOOL_BATCH_INLINE_LIMIT_CHARS, devServerProcesses, getPostSourceEditInstructionForSession, rejectInvalidSourceEdit, normalizeWorkspacePatchOp, inferWorkspacePatchOp, coerceBatchFileList, normalizeWorkspacePatchsetArgs, executeTool } from './../subagent-executor';
import type { createWorkspaceHelpers } from '../workspace-helpers';

export interface handleMiscToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
}
export async function handleMiscTool(ctx: handleMiscToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 let { name, args, workspacePath, deps, sessionId, __dirname, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = ctx;
 switch (name) {

      case 'declare_plan': {
        // Handled upstream in server-v2 before executeTool is called.
        // This passthrough prevents "unknown tool" errors if it reaches the executor.
        return { name, args, result: 'Plan acknowledged.', error: false };
      }

      case 'source_stats_batch': {
        const batchPaths = coerceBatchFileList(args);
        if (!batchPaths.length) return { name, args, result: 'files array is required', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const batchStatResults: Array<any> = [];
        const maxBatchStats = Math.max(1, Math.min(FILE_TOOL_MAX_BATCH_FILES, Math.floor(Number(args.max_files) || FILE_TOOL_MAX_BATCH_FILES)));
        for (const rawPath of batchPaths.slice(0, maxBatchStats)) {
          const normalized = String(rawPath || '').replace(/\\/g, '/').replace(/^\.?\//, '');
          if (!normalized) { batchStatResults.push({ file: String(rawPath), error: 'path required' }); continue; }
          const isWebUi = normalized.startsWith('web-ui/');
          const root = path.join(projectRoot, isWebUi ? 'web-ui' : 'src');
          const rel = isWebUi ? normalized.slice('web-ui/'.length) : normalized.replace(/^src\//, '');
          const absPath = path.resolve(root, rel);
          const display = `${isWebUi ? 'web-ui' : 'src'}/${rel}`;
          if (!absPath.startsWith(root)) { batchStatResults.push({ file: display, error: 'path escapes source root' }); continue; }
          if (!fs.existsSync(absPath)) { batchStatResults.push({ file: display, error: 'not found' }); continue; }
          const bsStat = fs.statSync(absPath);
          if (!bsStat.isFile()) { batchStatResults.push({ file: display, error: 'not a file' }); continue; }
          const content = fs.readFileSync(absPath, 'utf-8');
          batchStatResults.push(buildFileIntelligence(display, content, bsStat, {
            readCap: FILE_TOOL_DEFAULT_READ_LINES,
            query: args.query ? String(args.query) : undefined,
          }));
        }
        if (batchPaths.length > maxBatchStats) batchStatResults.push({ file: '[batch truncated]', error: `Only first ${maxBatchStats} files inspected.` });
        return { name, args, result: JSON.stringify(batchStatResults, null, 2), error: false };
      }

      case 'source_stats':
      case 'src_stats': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'file path is required', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const normalizedRel = rel.replace(/^\.?\//, '').replace(/^src\//, '');
        const absPath = path.resolve(srcRoot, normalizedRel);
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: source_stats only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${normalizedRel}`, srcRoot, normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) return { name, args, result: `"src/${normalizedRel}" is not a file`, error: true };
        const content = fs.readFileSync(absPath, 'utf-8');
        const payload = buildFileIntelligence(`src/${normalizedRel}`, content, stat, {
          readCap: FILE_TOOL_DEFAULT_READ_LINES,
          query: args.query ? String(args.query) : undefined,
        });
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'webui_source_stats':
      case 'webui_stats': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'file path is required', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const webUiRoot = path.join(projectRoot, 'web-ui');
        const normalizedRel = rel.replace(/^\.?\//, '').replace(/^web-ui\//, '');
        const absPath = path.resolve(webUiRoot, normalizedRel);
        if (!absPath.startsWith(webUiRoot)) {
          return { name, args, result: 'ERROR: webui_source_stats only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${normalizedRel}`, webUiRoot, normalizedRel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) return { name, args, result: `"web-ui/${normalizedRel}" is not a file`, error: true };
        const content = fs.readFileSync(absPath, 'utf-8');
        const payload = buildFileIntelligence(`web-ui/${normalizedRel}`, content, stat, {
          readCap: FILE_TOOL_DEFAULT_READ_LINES,
          query: args.query ? String(args.query) : undefined,
        });
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'apply_workspace_patchset': {
        args = normalizeWorkspacePatchsetArgs(args);
        ctx.updateArgs(args);
        const patchEdits = Array.isArray(args.edits) ? args.edits : [];
        if (!patchEdits.length) return { name, args, result: 'edits array is required and must not be empty', error: true };
        const patchResults: Array<{ filename: string; op: string; ok: boolean; result?: string; error?: string }> = [];
        const patchSnapshots: Array<ReturnType<typeof snapshotPreMutation>> = [];
        const patchEvidenceFiles: CodeEvidenceFile[] = [];
        for (const edit of patchEdits) {
          const pFilename = edit?.filename ?? edit?.path ?? edit?.file ?? args.filename ?? args.path ?? args.file;
          const pOp = normalizeWorkspacePatchOp(edit?.op ?? edit?.action ?? edit?.type ?? inferWorkspacePatchOp(edit));
          if (!pFilename || !pOp) {
            const missing = [!pFilename ? 'filename' : '', !pOp ? 'op' : ''].filter(Boolean).join(' and ');
            patchResults.push({ filename: String(pFilename || ''), op: pOp, ok: false, error: `${missing} required (got keys: ${Object.keys(edit || {}).join(', ') || 'none'}). Each edit needs filename/path plus op (find_replace|replace_lines|insert_after|delete_lines|write_file|create_file), or a top-level path shared by all edits.` });
            continue;
          }
          try {
            const supportedPatchOps = new Set(['find_replace', 'replace_lines', 'insert_after', 'delete_lines', 'write_file', 'create_file', 'rename_file']);
            if (!supportedPatchOps.has(pOp)) {
              patchResults.push({ filename: String(pFilename), op: pOp, ok: false, error: `Unsupported patchset op: ${pOp}` });
              continue;
            }
            const resolvedPOp = pOp;
            const r = await executeTool(resolvedPOp, { filename: pFilename, old_path: pFilename, ...edit }, workspacePath, deps, sessionId);
            const snapshots = [
              ...(Array.isArray((r as any)?.extra?.workspaceSnapshots) ? (r as any).extra.workspaceSnapshots : []),
              ...(Array.isArray((r as any)?.data?.workspaceSnapshots) ? (r as any).data.workspaceSnapshots : []),
            ];
            patchSnapshots.push(...snapshots);
            if (Array.isArray((r as any)?.extra?.codeEvidence?.files)) {
              patchEvidenceFiles.push(...(r as any).extra.codeEvidence.files);
            }
            patchResults.push({ filename: pFilename, op: pOp, ok: !r.error, result: r.error ? undefined : r.result, error: r.error ? r.result : undefined });
          } catch (err: any) {
            patchResults.push({ filename: pFilename, op: pOp, ok: false, error: err?.message || String(err) });
          }
        }
        const allOk = patchResults.every(r => r.ok);
        return withWorkspaceSnapshots({
          name,
          args,
          result: JSON.stringify({ applied: patchResults.filter(r => r.ok).length, failed: patchResults.filter(r => !r.ok).length, results: patchResults }, null, 2),
          error: !allOk,
          ...(patchEvidenceFiles.length ? { extra: { codeEvidence: { version: 1, kind: 'code_evidence', tool_name: name, operation: 'mutation', generated_at: new Date().toISOString(), generation_ms: 0, files: patchEvidenceFiles, truncated: false } } } : {}),
        }, patchSnapshots);
      }

      case 'grep_webui_source':
      case 'grep_source': {
        const gs_pattern = String(args.pattern || '');
        if (!gs_pattern) return { name, args, result: 'pattern is required', error: true };
        const gs_projectRoot = resolveProjectRootForSourceAccess();
        const gs_srcRoot = path.join(gs_projectRoot, 'src');
        const gs_webUiRoot = path.join(gs_projectRoot, 'web-ui');
        const gs_defaultRoot = name === 'grep_webui_source' ? 'web-ui' : 'src';
        const gs_rootParam = String(args.root || gs_defaultRoot).toLowerCase();
        const gs_searchBoth = gs_rootParam === 'both';
        const gs_useSrc = gs_searchBoth || gs_rootParam === 'src';
        const gs_useWebUi = gs_searchBoth || gs_rootParam === 'web-ui';
        const gs_globs = parseGlobList(args.glob);
        let gs_matcher: SearchMatcher;
        try {
          gs_matcher = createSearchMatcher(gs_pattern, {
            regex: args.regex === true,
            literal: args.literal === true,
            caseInsensitive: args.case_insensitive === true,
          });
        } catch {
          return { name, args, result: `Invalid regex pattern: ${gs_pattern}`, error: true };
        }
        const gs_requestedMaxResults = Math.floor(Number(args.max_results) || 50);
        const gs_contextLines = Math.max(0, Math.min(3, Math.floor(Number(args.context || 0))));
        const gs_maxResults = Math.max(1, Math.min(80, gs_requestedMaxResults));
        const gs_storeLimit = Math.max(gs_maxResults, Math.min(240, gs_maxResults * 3));
        const gs_excludes = new Set<string>([
          ...DEFAULT_FILE_TOOL_EXCLUDES,
          ...String(args.exclude || '').split(',').map((item: string) => item.trim()).filter(Boolean),
        ]);
        const gs_matches: any[] = [];
        let gs_totalMatches = 0;
        let gs_filesSearched = 0;
        let gs_filesSkipped = 0;
        const gs_walkDir = (dir: string, rootDir: string, label: string): void => {
          let entries: fs.Dirent[] = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          const gitignoreRules = args.gitignore === false || args.respect_gitignore === false ? [] : readSimpleGitignore(rootDir);
          for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            const relPathNoLabel = path.relative(rootDir, abs).replace(/\\/g, '/');
            if (entry.isDirectory()) {
              if (shouldSkipSearchPath(relPathNoLabel, entry.name, { excludes: gs_excludes, gitignoreRules })) { gs_filesSkipped += 1; continue; }
              gs_walkDir(abs, rootDir, label);
              continue;
            }
            if (!entry.isFile()) continue;
            const relPath = label + '/' + relPathNoLabel;
            if (shouldSkipSearchPath(relPathNoLabel, entry.name, { excludes: gs_excludes, gitignoreRules })) { gs_filesSkipped += 1; continue; }
            if (!args.include_lockfiles && /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i.test(relPath)) { gs_filesSkipped += 1; continue; }
            if (!matchesGlobList(relPath, gs_globs)) continue;
            let content = '';
            try { content = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
            gs_filesSearched += 1;
            const grep = collectGrepMatchesInText(relPath, content, gs_matcher, {
              maxResults: Math.max(1, gs_storeLimit - gs_matches.length),
              contextLines: gs_contextLines,
              before: Number(args.before) || 40,
              after: Number(args.after) || 80,
              charBefore: Number(args.char_before) || undefined,
              charAfter: Number(args.char_after) || undefined,
              charWindow: Number(args.char_window) || undefined,
            });
            gs_totalMatches += grep.totalMatches;
            if (gs_matches.length < gs_storeLimit) {
              gs_matches.push(...grep.matches.slice(0, Math.max(0, gs_storeLimit - gs_matches.length)));
            }
          }
        };
        const gs_fileArg = String(args.file || args.filename || '').replace(/\\/g, '/').trim();
        const gs_rawPath = gs_searchBoth ? '' : String(args.path || gs_fileArg || '').trim();
        const gs_searchOneFile = (absPath: string, rootDir: string, label: string): boolean => {
          if (!fs.existsSync(absPath)) return false;
          let st: fs.Stats;
          try { st = fs.statSync(absPath); } catch { return false; }
          if (!st.isFile()) return false;
          const relPathNoLabel = path.relative(rootDir, absPath).replace(/\\/g, '/');
          const relPath = label + '/' + relPathNoLabel;
          if (!matchesGlobList(relPath, gs_globs)) {
            gs_filesSkipped += 1;
            return true;
          }
          let content = '';
          try { content = fs.readFileSync(absPath, 'utf-8'); } catch { return true; }
          gs_filesSearched += 1;
          const grep = collectGrepMatchesInText(relPath, content, gs_matcher, {
            maxResults: Math.max(1, gs_storeLimit - gs_matches.length),
            contextLines: gs_contextLines,
            before: Number(args.before) || 40,
            after: Number(args.after) || 80,
            charBefore: Number(args.char_before) || undefined,
            charAfter: Number(args.char_after) || undefined,
            charWindow: Number(args.char_window) || undefined,
          });
          gs_totalMatches += grep.totalMatches;
          if (gs_matches.length < gs_storeLimit) {
            gs_matches.push(...grep.matches.slice(0, Math.max(0, gs_storeLimit - gs_matches.length)));
          }
          return true;
        };
        if (gs_useSrc) {
          const gs_srcTarget = gs_rawPath ? path.resolve(gs_srcRoot, gs_rawPath.replace(/^\.?\/?src\//, '')) : gs_srcRoot;
          if (!gs_srcTarget.startsWith(gs_srcRoot)) return { name, args, result: `ERROR: path "${gs_rawPath}" is outside src/`, error: true };
          if (!fs.existsSync(gs_srcTarget)) return { name, args, result: buildPathNotFoundRecovery(`src/${gs_rawPath.replace(/^\.?\/?src\//, '')}`, gs_srcRoot, gs_rawPath.replace(/^\.?\/?src\//, ''), 'list_source', { displayPrefix: 'src/' }), error: true };
          if (!gs_searchOneFile(gs_srcTarget, gs_srcRoot, 'src')) {
            if (!fs.statSync(gs_srcTarget).isDirectory()) {
              return { name, args, result: `ERROR: path "${gs_rawPath}" is not a searchable file or directory under src/`, error: true };
            }
            gs_walkDir(gs_srcTarget, gs_srcRoot, 'src');
          }
        }
        if (gs_useWebUi) {
          const gs_webUiTarget = gs_rawPath ? path.resolve(gs_webUiRoot, gs_rawPath.replace(/^\.?\/?web-ui\//, '')) : gs_webUiRoot;
          if (!gs_webUiTarget.startsWith(gs_webUiRoot)) return { name, args, result: `ERROR: path "${gs_rawPath}" is outside web-ui/`, error: true };
          if (!fs.existsSync(gs_webUiTarget)) return { name, args, result: buildPathNotFoundRecovery(`web-ui/${gs_rawPath.replace(/^\.?\/?web-ui\//, '')}`, gs_webUiRoot, gs_rawPath.replace(/^\.?\/?web-ui\//, ''), 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
          if (!gs_searchOneFile(gs_webUiTarget, gs_webUiRoot, 'web-ui')) {
            if (!fs.statSync(gs_webUiTarget).isDirectory()) {
              return { name, args, result: `ERROR: path "${gs_rawPath}" is not a searchable file or directory under web-ui/`, error: true };
            }
            gs_walkDir(gs_webUiTarget, gs_webUiRoot, 'web-ui');
          }
        }
        const gs_searchedLabel = gs_searchBoth ? 'src/ + web-ui/' : (gs_useSrc ? 'src/' + (gs_rawPath ? gs_rawPath : '') : 'web-ui/' + (gs_rawPath ? gs_rawPath : ''));
        const gs_sortedMatches = gs_matches.sort(compareGrepMatches(gs_pattern)).slice(0, gs_maxResults);
        const gs_payload = {
          searched: gs_searchedLabel,
          pattern: gs_pattern,
          search_mode: gs_matcher.mode,
          files_searched: gs_filesSearched,
          files_skipped: gs_filesSkipped,
          match_count: gs_totalMatches,
          returned_count: gs_sortedMatches.length,
          truncated_count: Math.max(0, gs_totalMatches - gs_sortedMatches.length),
          result_limit: {
            requested: gs_requestedMaxResults,
            applied: gs_maxResults,
            context_lines: gs_contextLines,
            limit_reached: gs_totalMatches > gs_sortedMatches.length,
            note: 'Result payloads are hard-clamped. Narrow root/path/glob/pattern or rerun a targeted read_source/read_webui_source for exact code.',
          },
          no_match_hints: gs_totalMatches === 0 ? buildNoMatchHints({ pattern: gs_pattern, searched: gs_searchedLabel, mode: gs_matcher.mode, excluded: Array.from(gs_excludes) }) : undefined,
          matches: gs_sortedMatches,
        };
        return { name, args, result: formatGrepToolResult(gs_payload, args.format), error: false };
      }

      case 'grep_prom': {
        const gp_pattern = String(args.pattern || '');
        if (!gp_pattern) return { name, args, result: 'pattern is required', error: true };
        let gp_matcher: SearchMatcher;
        try {
          gp_matcher = createSearchMatcher(gp_pattern, {
            regex: args.regex === true,
            literal: args.literal === true,
            caseInsensitive: args.case_insensitive === true,
          });
        } catch {
          return { name, args, result: `Invalid regex pattern: ${gp_pattern}`, error: true };
        }
        const gp_projectRoot = resolveProjectRootForSourceAccess();
        const gp_requestedPath = String(args.path || '').replace(/\\/g, '/');
        let gp_resolved: { absPath: string; normalizedRel: string };
        try {
          gp_resolved = resolvePromAllowedPath(gp_projectRoot, gp_requestedPath);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        if (!fs.existsSync(gp_resolved.absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(gp_resolved.normalizedRel || '.', gp_projectRoot, gp_resolved.normalizedRel || '', 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
        }
        const gp_rootStat = fs.statSync(gp_resolved.absPath);
        const gp_requestedMaxResults = Math.floor(Number(args.max_results) || 50);
        const gp_contextLines = Math.max(0, Math.min(3, Math.floor(Number(args.context || 0))));
        const gp_maxResults = Math.max(1, Math.min(80, gp_requestedMaxResults));
        const gp_storeLimit = Math.max(gp_maxResults, Math.min(240, gp_maxResults * 3));
        const gp_globs = parseGlobList(args.glob);
        const gp_excludes = new Set<string>([
          ...DEFAULT_FILE_TOOL_EXCLUDES,
          ...String(args.exclude || '').split(',').map((item: string) => item.trim()).filter(Boolean),
        ]);
        const gp_gitignoreRules = args.gitignore === false || args.respect_gitignore === false ? [] : readSimpleGitignore(gp_projectRoot);
        const gp_matches: any[] = [];
        let gp_totalMatches = 0;
        let gp_filesSearched = 0;
        let gp_filesSkipped = 0;
        if (gp_rootStat.isFile()) {
          const relFromRoot = gp_resolved.normalizedRel || path.basename(gp_resolved.absPath);
          if (!matchesGlobList(relFromRoot, gp_globs)) {
            gp_filesSkipped += 1;
          } else {
            let content = '';
            try { content = fs.readFileSync(gp_resolved.absPath, 'utf-8'); } catch { content = ''; }
            if (content) {
              gp_filesSearched += 1;
              const grep = collectGrepMatchesInText(relFromRoot || '.', content, gp_matcher, {
                maxResults: gp_storeLimit,
                contextLines: gp_contextLines,
                before: Number(args.before) || 40,
                after: Number(args.after) || 80,
                charBefore: Number(args.char_before) || undefined,
                charAfter: Number(args.char_after) || undefined,
                charWindow: Number(args.char_window) || undefined,
              });
              gp_totalMatches += grep.totalMatches;
              gp_matches.push(...grep.matches);
            }
          }
          const gp_sortedMatches = gp_matches.sort(compareGrepMatches(gp_pattern)).slice(0, gp_maxResults);
          const gp_payload = {
            searched: gp_resolved.normalizedRel || '.',
            pattern: gp_pattern,
            search_mode: gp_matcher.mode,
            files_searched: gp_filesSearched,
            files_skipped: gp_filesSkipped,
            match_count: gp_totalMatches,
            returned_count: gp_sortedMatches.length,
            truncated_count: Math.max(0, gp_totalMatches - gp_sortedMatches.length),
            result_limit: {
              requested: gp_requestedMaxResults,
              applied: gp_maxResults,
              context_lines: gp_contextLines,
              limit_reached: gp_totalMatches > gp_sortedMatches.length,
              note: 'Result payloads are hard-clamped. Narrow path/glob/pattern or rerun a targeted read_prom_file for exact content.',
            },
            no_match_hints: gp_totalMatches === 0 ? buildNoMatchHints({ pattern: gp_pattern, searched: gp_resolved.normalizedRel || '.', mode: gp_matcher.mode, excluded: Array.from(gp_excludes) }) : undefined,
            matches: gp_sortedMatches,
          };
          return { name, args, result: formatGrepToolResult(gp_payload, args.format), error: false };
        }
        if (!gp_rootStat.isDirectory()) {
          return { name, args, result: `"${gp_resolved.normalizedRel || '.'}" is not a searchable file or directory`, error: true };
        }
        const gp_walkDir = (dir: string): void => {
          let entries: fs.Dirent[] = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            const relFromRoot = path.relative(gp_projectRoot, abs).replace(/\\/g, '/');
            if (entry.isDirectory()) {
              if (!isPromAllowedPath(relFromRoot)) continue;
              if (shouldSkipSearchPath(relFromRoot, entry.name, { excludes: gp_excludes, gitignoreRules: gp_gitignoreRules })) { gp_filesSkipped += 1; continue; }
              gp_walkDir(abs);
              continue;
            }
            if (!entry.isFile()) continue;
            if (!isPromAllowedPath(relFromRoot)) continue;
            if (shouldSkipSearchPath(relFromRoot, entry.name, { excludes: gp_excludes, gitignoreRules: gp_gitignoreRules })) { gp_filesSkipped += 1; continue; }
            if (!args.include_lockfiles && /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i.test(relFromRoot)) { gp_filesSkipped += 1; continue; }
            if (!matchesGlobList(relFromRoot, gp_globs)) continue;
            let content = '';
            try { content = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
            gp_filesSearched += 1;
            const grep = collectGrepMatchesInText(relFromRoot || '.', content, gp_matcher, {
              maxResults: Math.max(1, gp_storeLimit - gp_matches.length),
              contextLines: gp_contextLines,
              before: Number(args.before) || 40,
              after: Number(args.after) || 80,
              charBefore: Number(args.char_before) || undefined,
              charAfter: Number(args.char_after) || undefined,
              charWindow: Number(args.char_window) || undefined,
            });
            gp_totalMatches += grep.totalMatches;
            if (gp_matches.length < gp_storeLimit) {
              gp_matches.push(...grep.matches.slice(0, Math.max(0, gp_storeLimit - gp_matches.length)));
            }
          }
        };
        gp_walkDir(gp_resolved.absPath);
        const gp_sortedMatches = gp_matches.sort(compareGrepMatches(gp_pattern)).slice(0, gp_maxResults);
        const gp_payload = {
          searched: gp_resolved.normalizedRel || '.',
          pattern: gp_pattern,
          search_mode: gp_matcher.mode,
          files_searched: gp_filesSearched,
          files_skipped: gp_filesSkipped,
          match_count: gp_totalMatches,
          returned_count: gp_sortedMatches.length,
          truncated_count: Math.max(0, gp_totalMatches - gp_sortedMatches.length),
          result_limit: {
            requested: gp_requestedMaxResults,
            applied: gp_maxResults,
            context_lines: gp_contextLines,
            limit_reached: gp_totalMatches > gp_sortedMatches.length,
            note: 'Result payloads are hard-clamped. Narrow path/glob/pattern or rerun a targeted read_prom_file for exact content.',
          },
          no_match_hints: gp_totalMatches === 0 ? buildNoMatchHints({ pattern: gp_pattern, searched: gp_resolved.normalizedRel || '.', mode: gp_matcher.mode, excluded: Array.from(gp_excludes) }) : undefined,
          matches: gp_sortedMatches,
        };
        return { name, args, result: formatGrepToolResult(gp_payload, args.format), error: false };
      }
      case 'read_dev_sources': {
        const files = Array.isArray(args.files) ? args.files : [];
        if (!files.length) return { name, args, result: 'ERROR: files[] is required.', error: true };
        const maxFiles = Math.max(1, Math.min(FILE_TOOL_MAX_BATCH_FILES, Math.floor(Number(args.max_files) || FILE_TOOL_DEFAULT_BATCH_FILES)));
        const defaultLines = Math.max(1, Math.min(FILE_TOOL_MAX_BATCH_LINES, Math.floor(Number(args.max_lines_per_file) || Number(args.num_lines) || FILE_TOOL_DEFAULT_BATCH_LINES)));
        const results: string[] = [];
        const summaryLines: string[] = [];
        let sawError = false;
        const forceSummary = args.summary === true || args.content === false || args.include_content === false || String(args.mode || '').toLowerCase() === 'summary';
        const normalizeDevSourcePath = (entry: any): string => String(entry?.file || entry?.path || '').replace(/\\/g, '/').replace(/^\.\//, '');
        const summarizeDevSource = (requested: string, isWebUi: boolean, sourceFile: string): string => {
          const projectRoot = resolveProjectRootForSourceAccess();
          const root = path.join(projectRoot, isWebUi ? 'web-ui' : 'src');
          const absPath = path.resolve(root, sourceFile);
          if (!absPath.startsWith(root)) throw new Error(`Path escapes ${isWebUi ? 'web-ui/' : 'src/'}: ${requested}`);
          return summarizeFileForTool(requested, absPath, {
            readCap: defaultLines,
            query: args.query ? String(args.query) : undefined,
          });
        };
        for (let i = 0; i < files.slice(0, maxFiles).length; i++) {
          const entry = files[i] || {};
          const requested = normalizeDevSourcePath(entry);
          if (!requested) {
            sawError = true;
            results.push(`--- read_dev_sources[${i + 1}] ---\nERROR: file path required.`);
            summaryLines.push(`entry ${i + 1}: error`);
            continue;
          }
          const isWebUi = requested.startsWith('web-ui/');
          const sourceFile = isWebUi ? requested.slice('web-ui/'.length) : requested.replace(/^src\//, '');
          const around = String(entry?.around || entry?.anchor || '');
          let result: ToolResult;
          let delegatedTool: string;
          if (around) {
            delegatedTool = isWebUi ? 'grep_webui_source' : 'grep_source';
            result = await executeTool(delegatedTool, {
              pattern: around,
              path: path.dirname(sourceFile) === '.' ? '' : path.dirname(sourceFile),
              glob: path.basename(sourceFile),
              context: entry?.context,
              max_results: entry?.occurrence ? Math.max(1, Number(entry.occurrence)) : 20,
              regex: entry?.regex === true,
            }, workspacePath, deps, sessionId);
          } else {
            const summaryOnly = forceSummary;
            if (summaryOnly) {
              try {
                const summary = summarizeDevSource(requested, isWebUi, sourceFile);
                results.push(summary);
                summaryLines.push(`${requested}: summary`);
              } catch (err: any) {
                sawError = true;
                results.push(`--- ${requested} ---\nERROR: ${err?.message || String(err)}`);
                summaryLines.push(`${requested}: error`);
              }
              continue;
            }
            delegatedTool = isWebUi ? 'read_webui_source' : 'read_source';
            const readArgs: any = { file: sourceFile, max_lines: defaultLines };
            for (const key of ['start_line', 'num_lines', 'head', 'tail', 'full', 'allow_large']) {
              if (entry?.[key] !== undefined) readArgs[key] = entry[key];
            }
            if (readArgs.num_lines === undefined && readArgs.head === undefined && readArgs.tail === undefined) {
              readArgs.num_lines = defaultLines;
            }
            result = await executeTool(delegatedTool, readArgs, workspacePath, deps, sessionId);
          }
          if (result.error) sawError = true;
          results.push(`--- ${requested} via ${delegatedTool} ---\n${result.result}`);
          summaryLines.push(`${requested}: ${result.error ? 'error' : 'content'}`);
        }
        if (files.length > maxFiles) {
          results.push(`--- read_dev_sources truncated ---\nOnly first ${maxFiles} files read. Re-run with remaining files if needed.`);
          summaryLines.push(`[batch truncated]: ${files.length - maxFiles} file(s) omitted`);
        }
        const rendered = results.join('\n\n');
        return {
          name,
          args,
          result: maybeSpoolToolOutput(name, rendered, resolveResultCharBudget(args, FILE_TOOL_BATCH_INLINE_LIMIT_CHARS), {
            allowInline: args.inline === true || args.no_spool === true,
            summary: `read_dev_sources returned ${Math.min(files.length, maxFiles)} file entry result(s):\n${summaryLines.join('\n')}`,
          }),
          error: sawError,
        };
      }

      case 'apply_dev_source_patchset': {
        const normalizedPatchsetArgs = normalizeDevSourcePatchsetArgs(args);
        const edits = Array.isArray(normalizedPatchsetArgs.edits) ? normalizedPatchsetArgs.edits : [];
        if (!edits.length) return { name, args, result: 'ERROR: edits[] is required.', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const results: string[] = [];
        const touched = new Set<string>();
        const evidenceFiles: CodeEvidenceFile[] = [];
        const withDevEvidence = <T extends ToolResult>(result: T): T => {
          if (!evidenceFiles.length) return result;
          return {
            ...result,
            extra: {
              ...(result.extra || {}),
              codeEvidence: {
                version: 1,
                kind: 'code_evidence',
                tool_name: name,
                operation: 'mutation',
                generated_at: new Date().toISOString(),
                generation_ms: 0,
                files: evidenceFiles,
                truncated: false,
              },
            },
          };
        };
        const normalizeDevSourcePath = (entry: any): string => String(entry?.file || entry?.path || '').replace(/\\/g, '/').replace(/^\.\//, '');
        const resolveDevSourceFile = (requested: string): { isWebUi: boolean; file: string; display: string; absPath: string } => {
          const isWebUi = requested.startsWith('web-ui/');
          const root = isWebUi ? path.join(projectRoot, 'web-ui') : path.join(projectRoot, 'src');
          const file = isWebUi ? requested.slice('web-ui/'.length) : requested.replace(/^src\//, '');
          const absPath = path.resolve(root, file);
          if (!absPath.startsWith(root)) throw new Error(`Path escapes ${isWebUi ? 'web-ui/' : 'src/'}: ${requested}`);
          return { isWebUi, file, display: `${isWebUi ? 'web-ui' : 'src'}/${file}`, absPath };
        };
        const delegatedNameFor = (isWebUi: boolean, base: string): string => isWebUi ? `${base}_webui_source` : `${base}_source`;
        const readExistingContent = (target: { display: string; absPath: string }): string | null => {
          if (!fs.existsSync(target.absPath)) return null;
          const stat = fs.statSync(target.absPath);
          if (!stat.isFile()) throw new Error(`"${target.display}" is not a file`);
          return fs.readFileSync(target.absPath, 'utf-8');
        };
        const checkGuards = (edit: any, target: { display: string; absPath: string }): ToolResult | null => {
          const content = readExistingContent(target);
          if (edit.expected_hash) {
            if (content === null) return { name, args, result: `ERROR: ${target.display} does not exist; cannot verify expected_hash.`, error: true };
            const digest = createHash('sha256').update(content).digest('hex');
            const expected = String(edit.expected_hash).trim().toLowerCase();
            if (!digest.startsWith(expected)) {
              return { name, args, result: `ERROR: ${target.display} expected_hash mismatch. Current sha256 starts ${digest.slice(0, Math.max(12, expected.length))}.`, error: true };
            }
          }
          if (edit.expected_before) {
            if (content === null || !content.includes(String(edit.expected_before))) {
              return { name, args, result: `ERROR: ${target.display} expected_before text was not found.`, error: true };
            }
          }
          return null;
        };
        for (let i = 0; i < edits.length; i++) {
          const edit = edits[i] || {};
          const requested = normalizeDevSourcePath(edit);
          if (!requested) return withDevEvidence({ name, args, result: `ERROR: edits[${i}].file is required.`, error: true });
          let target: { isWebUi: boolean; file: string; display: string; absPath: string };
          try {
            target = resolveDevSourceFile(requested);
          } catch (err: any) {
            return withDevEvidence({ name, args, result: `ERROR: ${err?.message || String(err)}`, error: true });
          }
          const guarded = checkGuards(edit, target);
          if (guarded) return withDevEvidence(guarded);
          const op = String(edit.op || '').toLowerCase();
          let delegatedTool = '';
          let delegatedArgs: any = { file: target.file };
          if (op === 'exact_replace' || op === 'find_replace' || op === 'delete_exact') {
            delegatedTool = delegatedNameFor(target.isWebUi, 'find_replace');
            delegatedArgs.find = String(edit.find || '');
            delegatedArgs.replace = op === 'delete_exact' ? '' : String(edit.replace ?? edit.content ?? '');
            delegatedArgs.replace_all = edit.replace_all === true;
          } else if (op === 'line_replace' || op === 'replace_lines') {
            delegatedTool = delegatedNameFor(target.isWebUi, 'replace_lines');
            delegatedArgs.start_line = edit.start_line;
            delegatedArgs.end_line = edit.end_line;
            delegatedArgs.new_content = String(edit.new_content ?? edit.replace ?? edit.content ?? '');
          } else if (op === 'insert_after_line' || op === 'insert_after') {
            delegatedTool = delegatedNameFor(target.isWebUi, 'insert_after');
            delegatedArgs.after_line = edit.after_line;
            delegatedArgs.content = String(edit.content ?? edit.new_content ?? edit.replace ?? '');
          } else if (op === 'insert_after_anchor') {
            const content = readExistingContent(target);
            const anchor = String(edit.anchor || edit.find || '');
            if (content === null) return withDevEvidence({ name, args, result: `ERROR: ${target.display} does not exist.`, error: true });
            if (!anchor) return withDevEvidence({ name, args, result: `ERROR: edits[${i}].anchor is required for insert_after_anchor.`, error: true });
            const lines = content.split('\n');
            const lineIndex = lines.findIndex((line) => line.includes(anchor));
            if (lineIndex < 0) return withDevEvidence({ name, args, result: buildTextNotFoundRecovery(target.display, content, anchor, target.isWebUi ? 'read_webui_source' : 'read_source'), error: true });
            delegatedTool = delegatedNameFor(target.isWebUi, 'insert_after');
            delegatedArgs.after_line = lineIndex + 1;
            delegatedArgs.content = String(edit.content ?? edit.new_content ?? edit.replace ?? '');
          } else if (op === 'delete_lines') {
            delegatedTool = delegatedNameFor(target.isWebUi, 'delete_lines');
            delegatedArgs.start_line = edit.start_line;
            delegatedArgs.end_line = edit.end_line;
          } else if (op === 'write_file' || op === 'full_file_write' || op === 'create_file') {
            delegatedTool = delegatedNameFor(target.isWebUi, 'write');
            delegatedArgs.content = String(edit.content ?? edit.new_content ?? edit.replace ?? '');
            delegatedArgs.overwrite = op !== 'create_file';
          } else {
            return withDevEvidence({ name, args, result: `ERROR: unsupported patchset op "${op}" at edits[${i}].`, error: true });
          }
          const result = await executeTool(delegatedTool, delegatedArgs, workspacePath, deps, sessionId);
          results.push(`--- ${target.display} via ${delegatedTool} ---\n${result.result}`);
          if (Array.isArray((result as any)?.extra?.codeEvidence?.files)) {
            evidenceFiles.push(...(result as any).extra.codeEvidence.files);
          }
          if (result.error) return withDevEvidence({ name, args, result: results.join('\n\n'), error: true });
          touched.add(target.display);
        }
        const touchedFiles = Array.from(touched);
        return withDevEvidence({
          name,
          args,
          result: [
            JSON.stringify({ ok: true, edit_count: edits.length, touched_files: touchedFiles }, null, 2),
            results.join('\n\n'),
            getPostSourceEditInstructionForSession(sessionId, touchedFiles),
          ].filter(Boolean).join('\n\n'),
          error: false,
        });
      }

      // ── read_source: read a file from src/ only ───────────────────────────────
      case 'read_source': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'ERROR: file path required.', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const normalizedRel = rel.replace(/^\.?\//, '').replace(/^src\//, '');
        const absPath = path.resolve(srcRoot, normalizedRel);
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: read_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${normalizedRel}`, srcRoot, normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          const entries = renderDirectoryEntries(absPath);
          return { name, args, result: `${normalizedRel ? `src/${normalizedRel}` : 'src'}/:\n${entries.join('\n') || '(empty)'}`, error: false };
        }
        const content = fs.readFileSync(absPath, 'utf-8');
        const relDisplay = 'src/' + absPath.slice(srcRoot.length + 1).replace(/\\/g, '/');
        const allLines = splitLinesEolSafe(content);
        return { name, args, result: renderNumberedRead(relDisplay, allLines, args), error: false };
      }

      // ── list_source: list files/dirs inside src/ ──────────────────────────────
	      case 'delete_source': {
	        const ds_sid = String(sessionId || '');
        const dsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (dsSessionGate) return dsSessionGate;
	        const ds_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
	        if (!ds_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const ds_projectRel = `src/${ds_rel.replace(/^\.?\/?src\//, '')}`;
	        const ds_scopeBlocked = enforceProposalWriteAccess(ds_projectRel, 'file', name);
	        if (ds_scopeBlocked) return ds_scopeBlocked;
	        const ds_projectRoot = resolveProjectRootForSourceAccess();
	        const ds_srcRoot = path.join(ds_projectRoot, 'src');
	        const ds_absPath = path.resolve(ds_srcRoot, ds_rel.replace(/^\.?\/?src\//, ''));
	        if (!ds_absPath.startsWith(ds_srcRoot)) {
	          return { name, args, result: 'ERROR: delete_source only allows access to src/ directory.', error: true };
	        }
	        if (!fs.existsSync(ds_absPath)) {
	          const ds_normalizedRel = ds_rel.replace(/^\.?\/?src\//, '');
	          return { name, args, result: buildPathNotFoundRecovery(`src/${ds_normalizedRel}`, ds_srcRoot, ds_normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
	        }
	        const ds_stat = fs.statSync(ds_absPath);
	        if (!ds_stat.isFile()) return { name, args, result: `"src/${ds_rel.replace(/^\.?\/?src\//, '')}" is not a file`, error: true };
	        fs.unlinkSync(ds_absPath);
	        const ds_display = 'src/' + ds_absPath.slice(ds_srcRoot.length + 1).replace(/\\/g, '/');
	        console.log(`[edit_source] delete_source: ${ds_display} (session: ${ds_sid})`);
	        return { name, args, result: `OK ${ds_display} deleted. ${getPostSourceEditInstructionForSession(sessionId, [ds_display])}`, error: false };
	      }

	      case 'list_source': {
        const rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?src\/?/, '') || '';
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const absPath = rel ? path.resolve(srcRoot, rel) : srcRoot;
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: list_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${rel}`, srcRoot, rel, 'list_source', { displayPrefix: 'src/', directoriesOnly: true }), error: true };
        }
        const entries = renderDirectoryEntries(absPath);
        const displayPath = rel ? `src/${rel}` : 'src';
        return { name, args, result: `${displayPath}/:\n${entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── list_prom: list files/dirs inside allowlisted Prometheus project-root surfaces ──
      case 'list_prom': {
        const projectRoot = resolveProjectRootForSourceAccess();
        let resolved: { absPath: string; normalizedRel: string };
        try {
          resolved = resolvePromAllowedPath(projectRoot, args.path || args.dir || '');
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        if (!fs.existsSync(resolved.absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel || '.', projectRoot, resolved.normalizedRel || '', 'list_prom', { include: (rel) => isPromAllowedPath(rel) }), error: true };
        }
        const stat = fs.statSync(resolved.absPath);
        if (!stat.isDirectory()) {
          return { name, args, result: `"${resolved.normalizedRel || '.'}" is not a directory`, error: true };
        }
        const entries = renderDirectoryEntries(resolved.absPath).filter((entry) => {
          const entryName = entry.replace(/^\[(?:DIR|FILE|\?\?)\]\s+/, '').replace(/\/$/, '');
          const relCandidate = resolved.normalizedRel ? `${resolved.normalizedRel}/${entryName}` : entryName;
          return isPromAllowedPath(relCandidate);
        });
        const displayPath = resolved.normalizedRel || '.';
        return { name, args, result: `${displayPath}/:\n${entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── read_prom_file: read a file or directory from allowlisted Prometheus root surfaces ──
      case 'read_prom_file': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        const projectRoot = resolveProjectRootForSourceAccess();
        let resolved: { absPath: string; normalizedRel: string };
        try {
          resolved = resolvePromAllowedPath(projectRoot, rel);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        if (!fs.existsSync(resolved.absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel || '.', projectRoot, resolved.normalizedRel || '', 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
        }
        const stat = fs.statSync(resolved.absPath);
        if (stat.isDirectory()) {
          const entries = renderDirectoryEntries(resolved.absPath).filter((entry) => {
            const entryName = entry.replace(/^\[(?:DIR|FILE|\?\?)\]\s+/, '').replace(/\/$/, '');
            const relCandidate = resolved.normalizedRel ? `${resolved.normalizedRel}/${entryName}` : entryName;
            return isPromAllowedPath(relCandidate);
          });
          const displayPath = resolved.normalizedRel || '.';
          return { name, args, result: `${displayPath}/:\n${entries.join('\n') || '(empty)'}`, error: false };
        }
        const content = fs.readFileSync(resolved.absPath, 'utf-8');
        const allLines = splitLinesEolSafe(content);
	        return { name, args, result: renderNumberedRead(resolved.normalizedRel || path.basename(resolved.absPath), allLines, args), error: false };
	      }

	      case 'write_prom_file': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const content = String(args.content || '');
	        const overwrite = args.overwrite !== false;
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
	        if (!overwrite && fs.existsSync(resolved.absPath)) {
	          return { name, args, result: `File already exists: ${resolved.normalizedRel}. Set overwrite:true to replace it.`, error: true };
	        }
	        if (fs.existsSync(resolved.absPath) && fs.statSync(resolved.absPath).isDirectory()) {
	          return { name, args, result: `"${resolved.normalizedRel}" is a directory`, error: true };
	        }
	        fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
	        fs.writeFileSync(resolved.absPath, content, 'utf-8');
	        const lineCount = content.split('\n').length;
	        console.log(`[edit_prom] write_prom_file: ${resolved.normalizedRel} (${lineCount} lines, session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel} written (${lineCount} lines). ${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`, error: false };
	      }

	      case 'delete_prom_file': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
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
	          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        fs.unlinkSync(resolved.absPath);
	        console.log(`[edit_prom] delete_prom_file: ${resolved.normalizedRel} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel} deleted. ${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`, error: false };
	      }

      // ── list_webui_source: list files/dirs inside web-ui/ ────────────────────
      case 'list_webui_source': {
        const lwu_rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\/?/, '') || '';
        const lwu_projectRoot = resolveProjectRootForSourceAccess();
        const lwu_webUiRoot = path.join(lwu_projectRoot, 'web-ui');
        const lwu_absPath = lwu_rel ? path.resolve(lwu_webUiRoot, lwu_rel) : lwu_webUiRoot;
        if (!lwu_absPath.startsWith(lwu_webUiRoot)) {
          return { name, args, result: 'ERROR: list_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(lwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${lwu_rel}`, lwu_webUiRoot, lwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/', directoriesOnly: true }), error: true };
        }
        const lwu_entries = renderDirectoryEntries(lwu_absPath);
        const lwu_displayPath = lwu_rel ? `web-ui/${lwu_rel}` : 'web-ui';
        return { name, args, result: `${lwu_displayPath}/:\n${lwu_entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── read_webui_source: read a file from web-ui/ ───────────────────────────
      case 'read_webui_source': {
        const rwu_rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        if (!rwu_rel) return { name, args, result: 'ERROR: file path required.', error: true };
        const rwu_projectRoot = resolveProjectRootForSourceAccess();
        const rwu_webUiRoot = path.join(rwu_projectRoot, 'web-ui');
        const rwu_absPath = path.resolve(rwu_webUiRoot, rwu_rel);
        if (!rwu_absPath.startsWith(rwu_webUiRoot)) {
          return { name, args, result: 'ERROR: read_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(rwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${rwu_rel}`, rwu_webUiRoot, rwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const rwu_stat = fs.statSync(rwu_absPath);
        if (rwu_stat.isDirectory()) {
          const rwu_entries = renderDirectoryEntries(rwu_absPath);
          return { name, args, result: `web-ui/${rwu_rel}/:\n${rwu_entries.join('\n') || '(empty)'}`, error: false };
        }
        const rwu_content = fs.readFileSync(rwu_absPath, 'utf-8');
        const rwu_display = 'web-ui/' + rwu_absPath.slice(rwu_webUiRoot.length + 1).replace(/\\/g, '/');
        const rwu_allLines = splitLinesEolSafe(rwu_content);
        return { name, args, result: renderNumberedRead(rwu_display, rwu_allLines, args), error: false };
      }

      // ── write_source: create or overwrite a file in src/ ─────────────────────
	      case 'write_source': {
	        const ws_sid = String(sessionId || '');
        const wsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (wsSessionGate) return wsSessionGate;
	        const ws_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
	        const ws_content = String(args.content || '');
	        const ws_overwrite = args.overwrite !== false;
	        if (!ws_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const ws_projectRel = `src/${ws_rel.replace(/^\.?\/?src\//, '')}`;
	        const ws_scopeBlocked = enforceProposalWriteAccess(ws_projectRel, 'file', name);
	        if (ws_scopeBlocked) return ws_scopeBlocked;
	        const ws_projectRoot = resolveProjectRootForSourceAccess();
	        const ws_srcRoot = path.join(ws_projectRoot, 'src');
        const ws_absPath = path.resolve(ws_srcRoot, ws_rel.replace(/^\.?\/?src\//, ''));
        if (!ws_absPath.startsWith(ws_srcRoot)) {
          return { name, args, result: 'ERROR: write_source only allows access to src/ directory.', error: true };
        }
        if (!ws_overwrite && fs.existsSync(ws_absPath)) {
          return { name, args, result: `File already exists: src/${ws_rel.replace(/^\.?\/?src\//, '')}. Set overwrite:true to replace it.`, error: true };
        }
        const ws_invalidEdit = rejectInvalidSourceEdit(name, args, ws_absPath, ws_content);
        if (ws_invalidEdit) return ws_invalidEdit;
        fs.mkdirSync(path.dirname(ws_absPath), { recursive: true });
        fs.writeFileSync(ws_absPath, ws_content, 'utf-8');
        const ws_display = 'src/' + ws_absPath.slice(ws_srcRoot.length + 1).replace(/\\/g, '/');
        const ws_lineCount = ws_content.split('\n').length;
        console.log(`[edit_source] write_source: ${ws_display} (${ws_lineCount} lines, session: ${ws_sid})`);
        return { name, args, result: `✅ ${ws_display} written (${ws_lineCount} lines). ${getPostSourceEditInstructionForSession(sessionId, [ws_display])}`, error: false };
      }

      // ── list_source: list files/dirs inside src/ ──────────────────────────────
      case 'list_source': {
        const rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?src\/?/, '') || '';
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const absPath = rel ? path.resolve(srcRoot, rel) : srcRoot;
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: list_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${rel}`, srcRoot, rel, 'list_source', { displayPrefix: 'src/', directoriesOnly: true }), error: true };
        }
        const entries = fs.readdirSync(absPath).map(e => {
          try {
            const s = fs.statSync(path.join(absPath, e));
            return s.isDirectory() ? `[DIR]  ${e}/` : `[FILE] ${e}`;
          } catch { return `[??]   ${e}`; }
        });
        const displayPath = rel ? `src/${rel}` : 'src';
        return { name, args, result: `${displayPath}/:\n${entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── list_webui_source: list files/dirs inside web-ui/ ────────────────────
      case 'list_webui_source': {
        const lwu_rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\/?/, '') || '';
        const lwu_projectRoot = resolveProjectRootForSourceAccess();
        const lwu_webUiRoot = path.join(lwu_projectRoot, 'web-ui');
        const lwu_absPath = lwu_rel ? path.resolve(lwu_webUiRoot, lwu_rel) : lwu_webUiRoot;
        if (!lwu_absPath.startsWith(lwu_webUiRoot)) {
          return { name, args, result: 'ERROR: list_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(lwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${lwu_rel}`, lwu_webUiRoot, lwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/', directoriesOnly: true }), error: true };
        }
        const lwu_entries = fs.readdirSync(lwu_absPath).map(e => {
          try {
            const s = fs.statSync(path.join(lwu_absPath, e));
            return s.isDirectory() ? `[DIR]  ${e}/` : `[FILE] ${e}`;
          } catch { return `[??]   ${e}`; }
        });
        const lwu_displayPath = lwu_rel ? `web-ui/${lwu_rel}` : 'web-ui';
        return { name, args, result: `${lwu_displayPath}/:\n${lwu_entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── read_webui_source: read a file from web-ui/ ───────────────────────────
      case 'read_webui_source': {
        const rwu_rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        if (!rwu_rel) return { name, args, result: 'ERROR: file path required.', error: true };
        const rwu_projectRoot = resolveProjectRootForSourceAccess();
        const rwu_webUiRoot = path.join(rwu_projectRoot, 'web-ui');
        const rwu_absPath = path.resolve(rwu_webUiRoot, rwu_rel);
        if (!rwu_absPath.startsWith(rwu_webUiRoot)) {
          return { name, args, result: 'ERROR: read_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(rwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${rwu_rel}`, rwu_webUiRoot, rwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const rwu_stat = fs.statSync(rwu_absPath);
        if (rwu_stat.isDirectory()) {
          const rwu_entries = fs.readdirSync(rwu_absPath).map(e => {
            const s = fs.statSync(path.join(rwu_absPath, e));
            return s.isDirectory() ? `[DIR]  ${e}/` : `[FILE] ${e}`;
          });
          return { name, args, result: rwu_entries.join('\n') || '(empty directory)', error: false };
        }
        const rwu_content = fs.readFileSync(rwu_absPath, 'utf-8');
        const rwu_display = 'web-ui/' + rwu_absPath.slice(rwu_webUiRoot.length + 1).replace(/\\/g, '/');
        const rwu_allLines = rwu_content.split('\n');
        const rwu_head = args.head ? Number(args.head) : 0;
        const rwu_tail = args.tail ? Number(args.tail) : 0;
        const rwu_startLine = args.start_line ? Math.max(1, Math.floor(Number(args.start_line))) : 0;
        const rwu_numLines = args.num_lines ? Math.max(1, Math.floor(Number(args.num_lines))) : 0;
        let rwu_sliced: string[];
        let rwu_firstLineNum: number;
        if (rwu_startLine > 0) {
          const from = rwu_startLine - 1;
          const to = rwu_numLines > 0 ? from + rwu_numLines : rwu_allLines.length;
          rwu_sliced = rwu_allLines.slice(from, to);
          rwu_firstLineNum = rwu_startLine;
        } else if (rwu_head > 0) {
          rwu_sliced = rwu_allLines.slice(0, rwu_head);
          rwu_firstLineNum = 1;
        } else if (rwu_tail > 0) {
          rwu_sliced = rwu_allLines.slice(-rwu_tail);
          rwu_firstLineNum = rwu_allLines.length - rwu_sliced.length + 1;
        } else {
          rwu_sliced = rwu_allLines;
          rwu_firstLineNum = 1;
        }
        const rwu_numbered = rwu_sliced.map((line, i) => `${rwu_firstLineNum + i}: ${line}`).join('\n');
        return { name, args, result: `${rwu_display} (${rwu_allLines.length} lines):\n${rwu_numbered}`, error: false };
      }

      // ── write_webui_source: create or overwrite a file in web-ui/ ────────────
	      case 'write_webui_source': {
	        const wwu_sid = String(sessionId || '');
        const wwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (wwuSessionGate) return wwuSessionGate;
	        const wwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
	        const wwu_content = String(args.content || '');
	        const wwu_overwrite = args.overwrite !== false;
	        if (!wwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const wwu_projectRel = `web-ui/${wwu_rel}`;
	        const wwu_scopeBlocked = enforceProposalWriteAccess(wwu_projectRel, 'file', name);
	        if (wwu_scopeBlocked) return wwu_scopeBlocked;
	        const wwu_projectRoot = resolveProjectRootForSourceAccess();
	        const wwu_webUiRoot = path.join(wwu_projectRoot, 'web-ui');
        const wwu_absPath = path.resolve(wwu_webUiRoot, wwu_rel);
        if (!wwu_absPath.startsWith(wwu_webUiRoot)) {
          return { name, args, result: 'ERROR: write_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!wwu_overwrite && fs.existsSync(wwu_absPath)) {
          return { name, args, result: `File already exists: web-ui/${wwu_rel}. Set overwrite:true to replace it.`, error: true };
        }
        const wwu_invalidEdit = rejectInvalidSourceEdit(name, args, wwu_absPath, wwu_content);
        if (wwu_invalidEdit) return wwu_invalidEdit;
        fs.mkdirSync(path.dirname(wwu_absPath), { recursive: true });
        fs.writeFileSync(wwu_absPath, wwu_content, 'utf-8');
        const wwu_display = 'web-ui/' + wwu_absPath.slice(wwu_webUiRoot.length + 1).replace(/\\/g, '/');
        const wwu_lineCount = wwu_content.split('\n').length;
        console.log(`[edit_webui] write_webui_source: ${wwu_display} (${wwu_lineCount} lines, session: ${wwu_sid})`);
        return { name, args, result: `OK ${wwu_display} written (${wwu_lineCount} lines). ${getPostSourceEditInstructionForSession(sessionId, [wwu_display])}`, error: false };
      }

      // ── send_telegram: proactively push text or screenshot to Telegram ────────
      // Works from ANY session (web UI, cron, background task) — not just Telegram-originated ones.
	      case 'delete_webui_source': {
	        const dwu_sid = String(sessionId || '');
        const dwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (dwuSessionGate) return dwuSessionGate;
	        const dwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
	        if (!dwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const dwu_projectRel = `web-ui/${dwu_rel}`;
	        const dwu_scopeBlocked = enforceProposalWriteAccess(dwu_projectRel, 'file', name);
	        if (dwu_scopeBlocked) return dwu_scopeBlocked;
	        const dwu_projectRoot = resolveProjectRootForSourceAccess();
	        const dwu_webUiRoot = path.join(dwu_projectRoot, 'web-ui');
	        const dwu_absPath = path.resolve(dwu_webUiRoot, dwu_rel);
	        if (!dwu_absPath.startsWith(dwu_webUiRoot)) {
	          return { name, args, result: 'ERROR: delete_webui_source only allows access to web-ui/ directory.', error: true };
	        }
	        if (!fs.existsSync(dwu_absPath)) {
	          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${dwu_rel}`, dwu_webUiRoot, dwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
	        }
	        const dwu_stat = fs.statSync(dwu_absPath);
	        if (!dwu_stat.isFile()) return { name, args, result: `"web-ui/${dwu_rel}" is not a file`, error: true };
	        fs.unlinkSync(dwu_absPath);
	        const dwu_display = 'web-ui/' + dwu_absPath.slice(dwu_webUiRoot.length + 1).replace(/\\/g, '/');
	        console.log(`[edit_webui] delete_webui_source: ${dwu_display} (session: ${dwu_sid})`);
	        return { name, args, result: `OK ${dwu_display} deleted. ${getPostSourceEditInstructionForSession(sessionId, [dwu_display])}`, error: false };
	      }

      case 'deploy_analysis_team': {
        const tr = await deployAnalysisTeamTool.execute(args) as any;
        const resultStr = tr?.stdout ?? tr?.error ?? JSON.stringify(tr?.data ?? tr);
        return {
          name,
          args,
          result: resultStr,
          error: tr?.success === false,
          data: tr?.data,
          artifacts: Array.isArray(tr?.artifacts) ? tr.artifacts : undefined,
        };
      }

      case 'enter_creative_mode': {
        const mode = normalizeCreativeMode(args?.mode);
        if (!mode) {
          return { name, args, result: 'enter_creative_mode: mode must be "design", "image", "canvas", or "video"', error: true };
        }
        const previousMode = getCreativeMode(sessionId);
        const creativeMode = setCreativeMode(sessionId, mode);
        deps.sendSSE?.('creative_mode', { sessionId, creativeMode, previousMode, resetScene: true });
        deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode, previousMode, resetScene: true });
        return { name, args, result: `Creative workspace "${creativeMode}" opened with a blank canvas.`, error: false, data: { creativeMode, previousMode, resetScene: true } };
      }

      case 'exit_creative_mode': {
        const previousMode = getCreativeMode(sessionId);
        setCreativeMode(sessionId, null);
        deps.sendSSE?.('creative_mode', { sessionId, creativeMode: null });
        deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode: null });
        return {
          name,
          args,
          result: previousMode ? `Creative workspace "${previousMode}" cleared.` : 'No Creative workspace was selected for this session.',
          error: false,
          data: { creativeMode: null, previousMode },
        };
      }

      case 'list_entities': {
        try {
          const rows = listEntities(workspacePath, args?.type);
          return { name, args, result: JSON.stringify({ count: rows.length, entities: rows }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `list_entities failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'read_entity': {
        try {
          const entity = readEntity(workspacePath, args?.type, args?.id);
          return { name, args, result: JSON.stringify(entity.summary, null, 2) + `\n\n${entity.content}`, error: false };
        } catch (err: any) {
          return { name, args, result: `read_entity failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'write_entity': {
        try {
          const out = writeEntity(workspacePath, args?.type, args?.id, args?.content);
          return {
            name,
            args,
            result: `${out.created ? 'Created' : 'Updated'} entity ${out.summary.type}/${out.summary.id} at ${out.summary.path}`,
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `write_entity failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'append_entity_event': {
        try {
          const out = appendEntityEvent(workspacePath, args?.type, args?.id, args?.event, {
            displayName: args?.display_name || args?.displayName,
            source: args?.source,
            confidence: args?.confidence,
          });
          return {
            name,
            args,
            result: `${out.created ? 'Created' : 'Updated'} entity ${out.summary.type}/${out.summary.id} at ${out.summary.path}\n${out.appended}`,
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `append_entity_event failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'social_intel': {
        const tr = await socialIntelTool.execute(args) as any;
        const resultStr = tr?.stdout ?? tr?.error ?? JSON.stringify(tr);
        return { name, args, result: resultStr, error: tr?.success === false };
      }

	      case 'clone_repo': {
	        const { executeCloneRepo } = await import('./../../../tools/repo-tools.js');
	        const toolResult = await executeCloneRepo({
	          repo: String(args.repo || ''),
	          dest: args.dest != null ? String(args.dest) : undefined,
	          ref: args.ref != null ? String(args.ref) : undefined,
	          branch: args.branch != null ? String(args.branch) : undefined,
	          depth: args.depth != null ? Number(args.depth) : undefined,
	          paths: Array.isArray(args.paths) ? args.paths.map((p: any) => String(p)) : (args.paths != null ? String(args.paths) : undefined),
	          overwrite: args.overwrite === true,
	        });
	        return {
	          name,
	          args,
	          result: toolResult.success
	            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'clone_repo complete' }, null, 2)
	            : `ERROR: ${toolResult.error || 'clone_repo failed'}`,
	          error: toolResult.success !== true,
	        };
	      }

      case 'video_analyze_imported_video': {
        const toolResult = await executeAnalyzeVideo({
          file_path: String(args.file_path || ''),
          prompt: args.prompt != null ? String(args.prompt) : undefined,
          sample_count: args.sample_count != null ? Number(args.sample_count) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
          extract_audio: args.extract_audio !== false,
          transcribe: args.transcribe !== false,
          signal: deps.abortSignal?.signal,
          onProgress: (progress) => deps.sendSSE?.('tool_progress', {
            action: name, name, message: progress.message, phase: progress.phase,
            current: progress.current, total: progress.total,
            ratio: progress.total ? Number(progress.current || 0) / progress.total : undefined,
            show_pill: true,
          }),
        });
        return {
          name,
          args,
          result: toolResult.success
            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'video_analyze_imported_video complete' }, null, 2)
            : `ERROR: ${toolResult.error || 'video_analyze_imported_video failed'}`,
          error: toolResult.success !== true,
        };
      }

      case 'open_pr': {
        try {
          const cmd = [
            'gh pr create',
            args.title ? `--title ${quoteArg(String(args.title))}` : '',
            args.body ? `--body ${quoteArg(String(args.body))}` : '--fill',
            args.base ? `--base ${quoteArg(String(args.base))}` : '',
            args.draft === true ? '--draft' : '',
          ].filter(Boolean).join(' ');
          const result = await runCapturedToolCommand(cmd, workspacePath, 120000);
          if (result.error && /(?:not recognized|command not found|not found).*(?:gh)|(?:gh).*(?:not recognized|command not found|not found)/is.test(result.result)) {
            return {
              name,
              args,
              result: [
                result.result,
                '',
                'GitHub CLI is unavailable. Use connector_github_create_pr with the same owner/repo/title/head/base/body/draft values when the GitHub connector is connected.',
              ].join('\n'),
              error: true,
            };
          }
          return result;
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'run_tests':
      case 'run_linter':
      case 'run_formatter':
      case 'run_typecheck': {
        try {
          const cwd = args.cwd ? resolveAllowedWorkspacePath(String(args.cwd), { requireDirectory: true }).absPath : workspacePath;
          const scripts = readPackageScripts(cwd);
          let command = String(args.command || '').trim();
          if (!command) {
            if (name === 'run_tests') command = scripts.test ? 'npm test' : '';
            if (name === 'run_linter') command = scripts.lint ? 'npm run lint' : '';
            if (name === 'run_formatter') command = scripts.format ? 'npm run format' : (scripts['format:check'] ? 'npm run format:check' : '');
            if (name === 'run_typecheck') command = scripts.typecheck ? 'npm run typecheck' : (scripts['build:backend'] ? 'npm run build:backend' : 'npx tsc --noEmit');
          }
          if (!command) return { name, args, result: `ERROR: no suitable script found for ${name}; pass command explicitly.`, error: true };
          const timeoutMs = Math.max(1000, Math.min(20 * 60 * 1000, Number(args.timeout_ms || 120000)));
          return runCapturedToolCommand(command, cwd, timeoutMs);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'format_changed_files': {
        const scripts = readPackageScripts(workspacePath);
        const script = String(args.script || '').trim() || (scripts.format ? 'format' : (scripts['format:check'] ? 'format:check' : ''));
        if (script) return runCapturedToolCommand(`npm run ${script}`, workspacePath, 120000);
        return runCapturedToolCommand(args.check_only === true ? 'npx prettier --check .' : 'npx prettier --write .', workspacePath, 120000);
      }

      case 'start_dev_server': {
        try {
          const cwd = args.cwd ? resolveAllowedWorkspacePath(String(args.cwd), { requireDirectory: true }).absPath : workspacePath;
          const scripts = readPackageScripts(cwd);
          const command = String(args.command || '').trim() || (scripts.dev ? 'npm run dev' : (scripts.start ? 'npm start' : 'npm run dev'));
          const commandBoundary = analyzeRunCommandBoundary(command);
          if (commandBoundary.blocked) return commandBoundary.blocked;
          if (commandBoundary.requiresExplicitApproval) {
            return { name, args, result: `start_dev_server command requires outside-workspace approval (${commandBoundary.scope}): ${commandBoundary.reason}`, error: true };
          }
          const { spawn } = await import('child_process');
          const child = spawn(command, { cwd, shell: true, windowsHide: true, env: process.env });
          const processId = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const proc = { child, name: String(args.name || processId), command, cwd, startedAt: Date.now(), output: [] as string[], exitCode: undefined as number | null | undefined };
          const append = (chunk: any) => {
            proc.output.push(String(chunk));
            const joined = proc.output.join('');
            if (joined.length > 200000) proc.output = [joined.slice(-200000)];
          };
          child.stdout?.on('data', append);
          child.stderr?.on('data', append);
          child.on('close', (code: number | null) => { proc.exitCode = code; append(`\n[process exited ${code}]\n`); });
          devServerProcesses.set(processId, proc);
          return { name, args, result: JSON.stringify({ process_id: processId, command, cwd, pid: child.pid, name: proc.name }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'read_process_output': {
        const processId = String(args.process_id || '').trim();
        const proc = devServerProcesses.get(processId);
        if (!proc) return { name, args, result: `ERROR: process not found: ${processId}`, error: true };
        const maxChars = Math.max(1000, Math.min(100000, Number(args.max_chars || 8000)));
        return { name, args, result: truncateText(proc.output.join('') || '(no output yet)', maxChars), error: false };
      }

      case 'stop_process': {
        const processId = String(args.process_id || '').trim();
        const proc = devServerProcesses.get(processId);
        if (!proc) return { name, args, result: `ERROR: process not found: ${processId}`, error: true };
        try { proc.child.kill(); } catch {}
        devServerProcesses.delete(processId);
        return { name, args, result: `Stopped ${processId} (${proc.command}).`, error: false };
      }

      case 'restore_snapshot':
      case 'revert_last_tool_change':
      case 'revert_own_patch': {
        try {
          const recentHistory = listWorkspaceHistory(workspacePath);
          const requestedId = String(args.snapshot_id || args.checkpoint_id || args.id || recentHistory[0]?.id || '').trim();
          if (requestedId) {
            const entry = recentHistory.find((item) => item.id === requestedId);
            const isCheckpoint = entry?.kind === 'checkpoint' || requestedId.startsWith('turn_');
            const preview = isCheckpoint
              ? restoreWorkspaceCheckpoint(workspacePath, requestedId, { dryRun: true })
              : restoreWorkspaceSnapshot(workspacePath, requestedId, { dryRun: true });
            if (preview.ok) {
              if (args.dry_run === true) return { name, args, result: JSON.stringify(preview.preview || preview, null, 2), error: false };
              if (args.confirm !== true) {
                return { name, args, result: `ERROR: confirm=true is required to restore ${isCheckpoint ? 'checkpoint' : 'snapshot'}. Preview:\n${JSON.stringify(preview.preview || preview, null, 2)}`, error: true };
              }
              const restored = isCheckpoint
                ? restoreWorkspaceCheckpoint(workspacePath, requestedId)
                : restoreWorkspaceSnapshot(workspacePath, requestedId);
              if (!restored.ok) return { name, args, result: `ERROR: ${restored.error || 'restore failed'}`, error: true };
              return {
                name,
                args,
                result: `Restored ${restored.restored.length} path(s) and deleted ${restored.deleted.length} path(s) from ${requestedId}.`,
                error: false,
                data: { restored: restored.restored, deleted: restored.deleted, snapshot_id: requestedId },
              };
            }
          }

          const snapshots = listSnapshots();
          const snapshotId = String(args.snapshot_id || snapshots[0]?.id || '').trim();
          if (!snapshotId) return { name, args, result: 'ERROR: no snapshots available.', error: true };
          const snapDir = path.join(snapshotRoot(), snapshotId);
          const manifestPath = path.join(snapDir, 'manifest.json');
          if (!fs.existsSync(manifestPath)) return { name, args, result: `ERROR: snapshot not found: ${snapshotId}`, error: true };
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const files = Array.isArray(manifest.files) ? manifest.files : [];
          const preview = { snapshot_id: snapshotId, file_count: files.length, files: files.slice(0, 200).map((f: any) => f.path), truncated: files.length > 200 };
          if (args.dry_run === true) return { name, args, result: JSON.stringify(preview, null, 2), error: false };
          if (args.confirm !== true) return { name, args, result: `ERROR: confirm=true is required to restore snapshot. Preview:\n${JSON.stringify(preview, null, 2)}`, error: true };
          for (const file of files) {
            const rel = String(file.path || '');
            const dest = resolveAllowedWorkspacePath(rel).absPath;
            const src = path.join(snapDir, 'files', rel);
            if (!fs.existsSync(src)) continue;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
          }
          return { name, args, result: `Restored ${files.length} file(s) from ${snapshotId}.`, error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'scan_large_files': {
        try {
          const dir = args.path ? resolveAllowedWorkspacePath(String(args.path), { requireDirectory: true }).absPath : workspacePath;
          const minBytes = Math.max(1, Number(args.min_bytes || 5_000_000));
          const maxResults = Math.max(1, Math.min(1000, Number(args.max_results || 50)));
          const files = walkFiles(dir, { maxFiles: 20000, maxBytes: Number.MAX_SAFE_INTEGER })
            .filter(f => f.size >= minBytes)
            .sort((a, b) => b.size - a.size)
            .slice(0, maxResults);
          return { name, args, result: JSON.stringify(files.map(f => ({ path: f.relPath, bytes: f.size })), null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'scan_secrets': {
        try {
          const target = args.path ? resolveAllowedWorkspacePath(String(args.path)) : resolveAllowedWorkspacePath('.', { requireDirectory: true, allowEmpty: true });
          const stat = fs.existsSync(target.absPath) ? fs.statSync(target.absPath) : null;
          const files = stat?.isFile()
            ? [{ absPath: target.absPath, relPath: target.displayPath, size: stat.size }]
            : walkFiles(target.absPath, { maxFiles: 10000, maxBytes: 80_000_000 });
          const maxResults = Math.max(1, Math.min(1000, Number(args.max_results || 50)));
          const patterns = [
            { type: 'openai_key', re: /sk-[A-Za-z0-9_-]{20,}/g },
            { type: 'github_token', re: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
            { type: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/g },
            { type: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
            { type: 'env_secret_assignment', re: /\b[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD)[A-Z0-9_]*\s*=\s*['"]?[^'"\s]{12,}/g },
          ];
          const findings: any[] = [];
          for (const file of files) {
            if (findings.length >= maxResults || file.size > 2_000_000) continue;
            let content = '';
            try { content = fs.readFileSync(file.absPath, 'utf-8'); } catch { continue; }
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length && findings.length < maxResults; i++) {
              for (const pattern of patterns) {
                pattern.re.lastIndex = 0;
                if (pattern.re.test(lines[i])) {
                  findings.push({ file: file.relPath, line: i + 1, type: pattern.type, preview: lines[i].replace(/=.*/, '= [REDACTED]').slice(0, 160) });
                  break;
                }
              }
            }
          }
          return { name, args, result: JSON.stringify({ findings, count: findings.length }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'operation_plan': {
        const operations = Array.isArray(args.operations) ? args.operations : [];
        const plans: any[] = [];
        for (const op of operations) {
          const type = String(op?.type || op?.operation || '').trim();
          try {
            const source = op?.source || op?.from || op?.path;
            const destination = op?.destination || op?.to || op?.new_path;
            const sourceInfo = source ? resolveAllowedWorkspacePath(String(source)) : null;
            const destInfo = destination ? resolveAllowedWorkspacePath(String(destination)) : null;
            plans.push({
              type,
              source: sourceInfo?.displayPath || null,
              destination: destInfo?.displayPath || null,
              source_exists: sourceInfo ? fs.existsSync(sourceInfo.absPath) : null,
              destination_exists: destInfo ? fs.existsSync(destInfo.absPath) : null,
              would_overwrite: destInfo ? fs.existsSync(destInfo.absPath) : false,
            });
          } catch (err: any) {
            plans.push({ type, error: err?.message || String(err) });
          }
        }
        return { name, args, result: JSON.stringify({ operations: plans, mutates: false }, null, 2), error: false };
      }

      case 'get_symbols': {
        try {
          const dir = args.path ? resolveAllowedWorkspacePath(String(args.path), { requireDirectory: true }).absPath : workspacePath;
          const symbols = await collectCodeSymbols(dir, String(args.query || ''), Math.max(1, Math.min(1000, Number(args.max_results || 50))));
          return { name, args, result: JSON.stringify({ symbols, count: symbols.length }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'go_to_definition': {
        try {
          const symbol = String(args.symbol || '').trim();
          if (!symbol) return { name, args, result: 'symbol is required', error: true };
          const dir = args.path ? resolveAllowedWorkspacePath(String(args.path), { requireDirectory: true }).absPath : workspacePath;
          const symbols = await collectCodeSymbols(dir, symbol, Math.max(1, Math.min(100, Number(args.max_results || 20))));
          const exact = symbols.filter(s => String(s.name) === symbol);
          return { name, args, result: JSON.stringify({ definitions: exact.length ? exact : symbols, count: (exact.length ? exact : symbols).length }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'find_references': {
        try {
          const symbol = String(args.symbol || '').trim();
          if (!symbol) return { name, args, result: 'symbol is required', error: true };
          const dir = args.path ? resolveAllowedWorkspacePath(String(args.path), { requireDirectory: true }).absPath : workspacePath;
          const maxResults = Math.max(1, Math.min(2000, Number(args.max_results || 200)));
          const word = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          const refs: any[] = [];
          for (const file of walkFiles(dir, { maxFiles: 5000, maxBytes: 100_000_000 }).filter(f => isCodeFile(f.relPath))) {
            if (refs.length >= maxResults) break;
            let content = '';
            try { content = fs.readFileSync(file.absPath, 'utf-8'); } catch { continue; }
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length && refs.length < maxResults; i++) {
              if (word.test(lines[i])) refs.push({ file: file.relPath, line: i + 1, text: lines[i].trim().slice(0, 240) });
            }
          }
          return { name, args, result: JSON.stringify({ references: refs, count: refs.length }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'start_process': {
        const rawCmd = String(args.command || '').trim();
        if (!rawCmd) return { name, args, result: 'command is required', error: true };
        if (!isTerminalFirstWorkspaceMode(getConfig().getConfig()) && looksLikeNativeFileToolBypass(rawCmd)) {
          return {
            name,
            args,
            result: 'Blocked: this looks like an ad hoc shell/Python/Node/PowerShell file edit. Use native file tools instead. Use start_process for dev servers, watchers, long builds, and interactive CLIs.',
            error: true,
          };
        }
        const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
        let commandCwd: { cwd: string; displayCwd: string };
        try {
          commandCwd = resolveRunCommandCwd(args.cwd);
        } catch (err: any) {
          return { name, args, result: `Invalid cwd for start_process: ${err.message || err}`, error: true };
        }
        const commandBoundary = analyzeRunCommandBoundary(normalizedCmd, commandCwd.cwd);
        if (commandBoundary.blocked) return commandBoundary.blocked;
        const shellTokenPolicyBlock = maybeBlockShellTokenPolicy(rawCmd, normalizedCmd);
        if (shellTokenPolicyBlock) return shellTokenPolicyBlock;
        try {
          const rawNoOutput = args.noOutputTimeoutMs ?? args.no_output_timeout_ms;
          let noOutputTimeoutMs: number | undefined;
          if (rawNoOutput == null || rawNoOutput === '') {
            noOutputTimeoutMs = 0;
          } else {
            const parsedNoOutput = Number(rawNoOutput);
            noOutputTimeoutMs = Number.isFinite(parsedNoOutput) && parsedNoOutput > 0 && parsedNoOutput < 300_000
              ? 300_000
              : parsedNoOutput;
          }
          const run = await getProcessSupervisor().spawn({
            command: normalizedCmd,
            cwd: commandCwd.cwd,
            mode: 'background',
            shell: args.shell || 'auto',
            pty: args.pty === true,
            title: args.title ? String(args.title) : undefined,
            stdinMode: args.stdin === true ? 'pipe' : 'ignore',
            noOutputTimeoutMs,
            sessionId,
            toolCallId: deps.toolCallId,
            workspacePath,
            trackWorkspaceChanges: shouldTrackTerminalWorkspaceChanges(normalizedCmd),
          });
          return {
            name,
            args,
            result: `Started supervised process ${run.runId} cwd=${commandCwd.displayCwd}\n${normalizedCmd}`,
            error: false,
            extra: { runId: run.runId, workspacePath: run.record.workspacePath, workspaceChangeSource: 'terminal' },
          };
        } catch (err: any) {
          return { name, args, result: `start_process failed: ${err.message || err}`, error: true };
        }
      }

      case 'process_status': {
        const runId = String(args.runId || args.run_id || '').trim();
        const supervisor = getProcessSupervisor();
        if (runId) {
          const run = supervisor.get(runId);
          if (!run) return { name, args, result: `No process found for ${runId}`, error: true };
          const log = supervisor.log(runId, Math.max(500, Math.min(20_000, Number(args.max_chars || 4000))));
          const healthUrl = String(args.health_url || (args.port ? `http://127.0.0.1:${Number(args.port)}/` : '')).trim();
          let health: any = null;
          if (healthUrl) {
            const started = Date.now();
            try {
              const response = await fetch(healthUrl, { signal: AbortSignal.timeout(Math.max(250, Math.min(15_000, Number(args.health_timeout_ms || 3000)))) });
              health = { healthy: response.ok, url: healthUrl, status: response.status, status_text: response.statusText, latency_ms: Date.now() - started };
            } catch (error: any) {
              health = { healthy: false, url: healthUrl, latency_ms: Date.now() - started, error: String(error?.cause?.message || error?.message || error) };
            }
          }
          let portOwner: any = null;
          if (process.platform === 'win32' && Number(args.port) > 0) {
            try {
              const wantedPort = Math.floor(Number(args.port));
              const output = await new Promise<string>((resolve) => {
                execFile('netstat.exe', ['-ano', '-p', 'tcp'],
                  { encoding: 'utf8', timeout: 3000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
                  (error, stdout) => resolve(error ? '' : String(stdout || '')));
              });
              for (const line of output.split(/\r?\n/)) {
                const fields = line.trim().split(/\s+/);
                if (fields.length < 5) continue;
                if (fields[3] !== 'LISTENING') continue;
                const local = fields[1];
                const separator = local.lastIndexOf(':');
                if (separator < 0 || Number(local.slice(separator + 1)) !== wantedPort) continue;
                portOwner = {
                  LocalAddress: local.slice(0, separator).replace(/^\[|\]$/g, ''),
                  LocalPort: wantedPort,
                  OwningProcess: Number(fields[4]),
                };
                break;
              }
            } catch {}
          }
          return { name, args, result: JSON.stringify({
            process: run,
            service_health: health,
            listening_socket: portOwner,
            recent_output: { stdout: log.stdout.slice(-2000), stderr: log.stderr.slice(-2000), stdout_bytes: log.stdoutBytes, stderr_bytes: log.stderrBytes },
            verdict: run.state === 'running' ? (health ? (health.healthy ? 'running_and_healthy' : 'running_but_unhealthy') : 'running_unprobed') : `process_${run.state}`,
          }, null, 2), error: false };
        }
        return { name, args, result: JSON.stringify({ runs: supervisor.list(Number(args.limit || 20)) }, null, 2), error: false };
      }

      case 'process_log': {
        const runId = String(args.runId || args.run_id || '').trim();
        if (!runId) return { name, args, result: 'runId is required', error: true };
        const log = getProcessSupervisor().log(runId, Number(args.maxChars || args.max_chars || 120000));
        return { name, args, result: log.combined || '(no output)', error: false };
      }

      case 'process_wait': {
        const runId = String(args.runId || args.run_id || '').trim();
        if (!runId) return { name, args, result: 'runId is required', error: true };
        const supervisor = getProcessSupervisor();
        if (!supervisor.get(runId)) return { name, args, result: `No process found for ${runId}`, error: true };
        const requestedWaitMs = Number(args.timeoutMs ?? args.timeout_ms ?? 10_000);
        const waitMs = Number.isFinite(requestedWaitMs) ? Math.max(1_000, Math.min(30_000, requestedWaitMs)) : 10_000;
        let waitTimer: NodeJS.Timeout | null = null;
        const exit = await Promise.race([
          supervisor.wait(runId),
          new Promise<null>((resolve) => { waitTimer = setTimeout(() => resolve(null), waitMs); }),
        ]);
        if (waitTimer) clearTimeout(waitTimer);
        if (!exit) {
          const run = supervisor.get(runId);
          const tail = supervisor.log(runId, 4000).combined.slice(-4000);
          return {
            name, args,
            result: `${runId} is ${run?.state || 'running'} after ${Math.round(waitMs / 1000)}s.\n${tail || '(no output yet)'}\nUse process_status/process_log for progress or call process_wait again.`,
            error: false,
            extra: { runId, stillRunning: true },
          };
        }
        const output = [exit.stdout, exit.stderr].filter(Boolean).join('\n').trim();
        const outcome = classifyCommandTermination({ code: exit.exitCode, timedOut: exit.timedOut, reason: exit.reason, signal: exit.exitSignal });
        return {
          name,
          args,
          result: `${runId} [${outcome.label}]\n${output.slice(0, 4000) || '(no output)'}`,
          error: !outcome.ok,
          extra: {
            runId,
            terminationReason: outcome.reason,
            signal: exit.exitSignal ?? undefined,
            ...(exit.workspaceChanges ? {
              workspacePath: exit.workspacePath,
              workspaceChanges: exit.workspaceChanges,
              workspaceSnapshots: exit.workspaceSnapshots,
              workspaceChangeSource: exit.workspaceChangeSource,
              ...(exit.workspaceChangesTruncated ? { workspaceChangesTruncated: true } : {}),
            } : {}),
          },
        };
      }

      case 'process_kill': {
        const runId = String(args.runId || args.run_id || '').trim();
        if (!runId) return { name, args, result: 'runId is required', error: true };
        const supervisor = getProcessSupervisor();
        const killed = supervisor.cancel(runId);
        if (killed) return { name, args, result: `Killed ${runId}`, error: false };
        // Killing a process that already finished is the desired end state, not
        // a failure (20% of process_kill calls were this case).
        const record = supervisor.get(runId);
        if (record) {
          const exit = record.exitCode !== undefined && record.exitCode !== null ? ` (exit ${record.exitCode})` : '';
          return { name, args, result: `${runId} is not running; it already ${record.state === 'exited' ? 'exited' : record.state}${exit}. Nothing to kill.`, error: false };
        }
        return { name, args, result: `No process found for ${runId}`, error: true };
      }

      case 'process_submit': {
        const runId = String(args.runId || args.run_id || '').trim();
        if (!runId) return { name, args, result: 'runId is required', error: true };
        const ok = getProcessSupervisor().write(runId, String(args.data || ''), true);
        return { name, args, result: ok ? `Submitted input to ${runId}` : `Could not write to ${runId}`, error: !ok };
      }

	  case 'task_control': {
	        const out = await deps.handleTaskControlAction(sessionId, args);
	        return {
	          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: out.success !== true,
	        };
	      }

      case 'switch_model': {
        const tier = String(args.tier || '').trim().toLowerCase();
        const reason = String(args.reason || tier + ' tier switch').trim();
        if (tier !== 'low' && tier !== 'medium') {
          return { name, args, result: 'switch_model: tier must be "low" or "medium"', error: true };
        }
        const cfg = (getConfig().getConfig() as any);
        const defaults = cfg?.agent_model_defaults || {};
        const configKey = tier === 'low' ? 'switch_model_low' : 'switch_model_medium';
        const configuredModel: string | undefined = defaults[configKey];
        if (!configuredModel) {
          return { name, args, result: `switch_model: no model configured for tier "${tier}" — set agent_model_defaults.${configKey} in Settings → Agent Model Defaults`, error: true };
        }
        const slashIdx = configuredModel.indexOf('/');
        if (slashIdx < 1) {
          return { name, args, result: `switch_model: invalid config for "${configKey}" — expected "provider/model" format, got "${configuredModel}"`, error: true };
        }
        const providerId = configuredModel.slice(0, slashIdx);
        const model = configuredModel.slice(slashIdx + 1);
        // Never route a helper tier to a provider that is known to be out of
        // usage: it would 429 and cost a wasted round. Stay on the main model.
        try {
          const { providerUsageExhaustedReason } = require('./../../../providers/usage-awareness');
          const exhausted = providerUsageExhaustedReason(providerId);
          if (exhausted) {
            return {
              name,
              args,
              result: `switch_model: skipped ${tier} tier (${configuredModel}) because it ${exhausted}. Staying on the main model for this turn.`,
              error: false,
            };
          }
        } catch { /* usage awareness is advisory */ }
        const { setTurnModelOverride } = require('./../../chat/model-switch-state');
        setTurnModelOverride(sessionId, { providerId, model, reason, tier });
        return { name, args, result: `Switched to ${tier} tier: ${configuredModel}. Reverts automatically at end of turn.`, error: false };
      }

      case 'parse_schedule_pattern': {
        const text = String(args.text || '').trim();
        if (!text) {
          return { name, args, result: 'parse_schedule_pattern requires text parameter', error: true };
        }

        try {
          const normalized = parseSchedulePattern(text, args.timezone || 'UTC');
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              kind: normalized.kind,
              cron: normalized.kind === 'recurring' ? normalized.cron : undefined,
              run_at: normalized.kind === 'one-shot' ? normalized.runAt : undefined,
              preview: normalized.preview,
              timezone: args.timezone || 'UTC',
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `parse_schedule_pattern error: ${err.message}`, error: true };
        }
      }

      case 'save_site_shortcut': {
        const shortcutHostname = String(args.hostname || '').trim();
        const shortcutKey = String(args.key || '').trim();
        const shortcutAction = String(args.action || '').trim();
        if (!shortcutHostname || !shortcutKey || !shortcutAction) {
          return { name, args, result: 'save_site_shortcut: hostname, key, and action are required', error: true };
        }
        try {
          saveSiteShortcut(
            shortcutHostname,
            {
              key: shortcutKey,
              action: shortcutAction,
              context: args.context ? String(args.context) : undefined,
              preferred_for_compose: args.preferred_for_compose === true,
            },
            undefined,
            args.notes ? String(args.notes) : undefined,
          );
          return { name, args, result: `Shortcut saved: ${shortcutHostname} - "${shortcutKey}" -> ${shortcutAction}`, error: false };
        } catch (err: any) {
          return { name, args, result: `save_site_shortcut failed: ${err.message}`, error: true };
        }
      }

      // â”€â”€ Agent Builder Integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'architect_workflow':
      case 'verify_workflow_credentials':
      case 'test_workflow':
      case 'deploy_workflow':
      case 'get_workflow_status':
      case 'search_workflow_templates':
      case 'execute_workflow_template':
      case 'create_node_subagent': {
        const result = await executeAgentBuilderTool(name, args);
        return { name, args, result, error: false };
      }
 }
 throw new Error(`Unsupported misc tool: ${name}`);
}
