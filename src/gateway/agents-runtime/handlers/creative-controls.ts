import { formatCreativeReferencesForPrompt, getCreativeMode, getCreativeReferences, normalizeCreativeMode, setCreativeMode } from './../../session';
import type { createWorkspaceHelpers } from '../workspace-helpers';

export interface handleExistingToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
}
export async function handleExistingTool(ctx: handleExistingToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 const { name, args, workspacePath, deps, sessionId, __dirname, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = ctx;
 switch (name) {


      case 'switch_creative_mode': {
        const hasMode = !!args && typeof args === 'object' && Object.prototype.hasOwnProperty.call(args, 'mode');
        const rawMode = hasMode ? args?.mode : undefined;
        const rawModeText = String(rawMode ?? '').trim().toLowerCase();
        const shouldExit = hasMode && (
          rawMode == null
          || rawModeText === 'null'
          || rawModeText === 'none'
          || rawModeText === 'off'
          || rawModeText === 'normal'
          || rawModeText === 'default'
          || rawModeText === 'chat'
        );
        const previousMode = getCreativeMode(sessionId);
        if (shouldExit) {
          setCreativeMode(sessionId, null);
          deps.sendSSE?.('creative_mode', { sessionId, creativeMode: null, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '' });
          deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode: null, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '' });
          return {
            name,
            args,
            result: previousMode ? `Creative workspace "${previousMode}" cleared.` : 'No Creative workspace was selected for this session.',
            error: false,
            data: { creativeMode: null, previousMode },
          };
        }
        const mode = normalizeCreativeMode(rawMode);
        if (!mode) {
          return { name, args, result: 'switch_creative_mode: mode must be "design", "image", "canvas", "video", or null to exit', error: true };
        }
        const creativeMode = setCreativeMode(sessionId, mode);
        deps.sendSSE?.('creative_mode', { sessionId, creativeMode, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '', resetScene: true });
        deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '', resetScene: true });
        return { name, args, result: `Creative workspace changed from "${previousMode || 'none'}" to "${creativeMode}" with a blank canvas.`, error: false, data: { creativeMode, previousMode, resetScene: true } };
      }

      case 'get_creative_mode': {
        const creativeMode = getCreativeMode(sessionId);
        return {
          name,
          args,
          result: creativeMode ? `Selected Creative workspace: ${creativeMode}` : 'No Creative workspace is selected.',
          error: false,
          data: { creativeMode },
        };
      }

      case 'creative_list_references': {
        const references = getCreativeReferences(sessionId);
        const promptBlock = formatCreativeReferencesForPrompt(sessionId, Number(args?.limit) || 20);
        return {
          name,
          args,
          result: references.length > 0
            ? promptBlock
            : 'No Creative References are saved for this session yet. Use web_fetch on media/reference URLs first, or import assets manually.',
          error: false,
          data: { references },
        };
      }
 }
 throw new Error(`Unsupported existing tool: ${name}`);
}
