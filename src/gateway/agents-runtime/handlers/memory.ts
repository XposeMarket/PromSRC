import fs from 'fs';
import path from 'path';
import { getConfig } from './../../../config/config';
import { splitCsv, formatCompactSkillList, skillsCapabilityExecutor } from './../capabilities/skills-executor';
import { formatIntradayNoteSourceLine, inferIntradayNoteSource } from './../../intraday-note-source';
import { appendTeamMemoryEvent } from './../../teams/team-workspace';
import { compactMemorySearchResult, refreshMemoryIndexInWorker, readMemoryRecord, getMemoryGraphSnapshot, getRelatedMemory } from './../../memory-index/index';
import { searchMemoryInWorker } from './../../memory-index/search-worker-client';
import { parseJsonLike } from './../../tool-builder';
import { activateSkillForSession, activateSkillResourceForSession, isBusinessContextEnabled, setBusinessContextEnabled } from './../../session';
import { markDevSourceEditContinuationComplete } from './../../dev-source-approvals.js';
import { loadBusinessContextSnapshot, inferTeamNoteContext } from './../subagent-executor';
import type { createWorkspaceHelpers } from '../workspace-helpers';

export interface handleMemoryToolContext extends ReturnType<typeof createWorkspaceHelpers> {
 name: string;
 args: Parameters<typeof import('../subagent-executor').executeTool>[1];
 workspacePath: string;
 deps: import('../subagent-executor').ExecuteToolDeps;
 sessionId: string;
 __dirname: string;
}
export async function handleMemoryTool(ctx: handleMemoryToolContext): Promise<Awaited<ReturnType<typeof import('../subagent-executor').executeTool>>> {
 const { name, args, workspacePath, deps, sessionId, __dirname, _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = ctx;
 switch (name) {

      case 'business_context_mode': {
        const action = String(args?.action || '').trim().toLowerCase();
        if (action !== 'enable' && action !== 'disable' && action !== 'status') {
          return { name, args, result: 'business_context_mode: action must be "enable", "disable", or "status"', error: true };
        }

        const fileExists = fs.existsSync(path.join(workspacePath, 'BUSINESS.md'));
        if (action === 'status') {
          const enabled = isBusinessContextEnabled(sessionId);
          return {
            name,
            args,
            result: [
              `BUSINESS.md auto-injection is currently ${enabled ? 'ENABLED' : 'DISABLED'} for session ${sessionId}.`,
              `BUSINESS.md ${fileExists ? 'is present in the workspace.' : 'is not present in the workspace.'}`,
              enabled
                ? 'BUSINESS.md will continue to be injected on later turns until you disable it.'
                : 'Use business_context_mode({"action":"enable"}) if you need persistent business context.',
            ].join('\n'),
            error: false,
          };
        }

        const enabled = setBusinessContextEnabled(sessionId, action === 'enable');
        if (!enabled) {
          return {
            name,
            args,
            result: `BUSINESS.md auto-injection disabled for session ${sessionId}. Future turns will not receive [BUSINESS] unless you enable it again.`,
            error: false,
          };
        }

        const snapshot = loadBusinessContextSnapshot(workspacePath);
        const snapshotBlock = snapshot
          ? `\n\n[BUSINESS]\n${snapshot}`
          : '\n\nBUSINESS.md was not found in the workspace, so nothing can be injected yet.';
        return {
          name,
          args,
          result: `BUSINESS.md auto-injection enabled for session ${sessionId}. Future turns in this session will receive [BUSINESS] context.${snapshotBlock}`,
          error: false,
        };
      }

	      case 'memory_browse': {
        const mbFileRaw = String(args.file || 'user').toLowerCase().trim();
        const mbFile = mbFileRaw === 'memory' ? 'memory' : (mbFileRaw === 'soul' ? 'soul' : 'user');
        const mbFilename = mbFile === 'soul' ? 'SOUL.md' : (mbFile === 'memory' ? 'MEMORY.md' : 'USER.md');
        const mbPath = path.join(workspacePath, mbFilename);
        console.log(`[memory_browse] workspacePath: ${workspacePath}`);
        console.log(`[memory_browse] mbPath: ${mbPath}`);
        console.log(`[memory_browse] exists: ${fs.existsSync(mbPath)}`);
        if (!fs.existsSync(mbPath)) {
          // Try absolute path fallback
          const configWorkspace = getConfig().getWorkspacePath();
          const fallbackPath = path.join(configWorkspace, mbFilename);
          console.log(`[memory_browse] fallback configWorkspace: ${configWorkspace}`);
          console.log(`[memory_browse] fallback path: ${fallbackPath}`);
          console.log(`[memory_browse] fallback exists: ${fs.existsSync(fallbackPath)}`);
          if (!fs.existsSync(fallbackPath)) {
            return { name, args, result: `${mbFilename} not found at ${mbPath} or ${fallbackPath}. Create it first.`, error: true };
          }
          // Use fallback
          const mbContent = fs.readFileSync(fallbackPath, 'utf-8');
          const mbMatches = mbContent.match(/^## (.+)/gm) || [];
          const mbCategories = mbMatches.map((m: string) => m.replace(/^## /, '').trim());
          if (mbCategories.length === 0) {
            return { name, args, result: `${mbFilename} has no categories yet. Use memory(action="write") to create the first one.`, error: false };
          }
          return { name, args, result: `${mbFilename} categories:\n${mbCategories.map((c: string) => `- ${c}`).join('\n')}\n\nUse memory(action="write", file="${mbFile}", category="<name>", content="...") to add a fact.`, error: false };
        }
        const mbContent = fs.readFileSync(mbPath, 'utf-8');
        const mbMatches = mbContent.match(/^## (.+)/gm) || [];
        const mbCategories = mbMatches.map((m: string) => m.replace(/^## /, '').trim());
        if (mbCategories.length === 0) {
          return { name, args, result: `${mbFilename} has no categories yet. Use memory(action="write") to create the first one.`, error: false };
        }
        return { name, args, result: `${mbFilename} categories:\n${mbCategories.map((c: string) => `- ${c}`).join('\n')}\n\nUse memory(action="write", file="${mbFile}", category="<name>", content="...") to add a fact.`, error: false };
      }

      case 'memory_write': {
        const mwFileRaw = String(args.file || 'user').toLowerCase().trim();
        const mwFile = mwFileRaw === 'memory' ? 'memory' : (mwFileRaw === 'soul' ? 'soul' : 'user');
        const mwCategory = String(args.category || '').trim().toLowerCase().replace(/\s+/g, '_');
        const mwContent = String(args.content || '').trim();
        if (!mwCategory) return { name, args, result: 'memory_write: category is required', error: true };
        if (!mwContent) return { name, args, result: 'memory_write: content is required', error: true };
        const mwFilename = mwFile === 'soul' ? 'SOUL.md' : (mwFile === 'memory' ? 'MEMORY.md' : 'USER.md');
        let mwPath = path.join(workspacePath, mwFilename);
        if (!fs.existsSync(mwPath)) {
          // Try config workspace as fallback
          const configWorkspace = getConfig().getWorkspacePath();
          mwPath = path.join(configWorkspace, mwFilename);
          console.log(`[memory_write] fallback workspace: ${configWorkspace}, path: ${mwPath}`);
        }
        if (!fs.existsSync(mwPath)) {
          const initial = `# ${mwFilename}\n\n---\n`;
          fs.mkdirSync(path.dirname(mwPath), { recursive: true });
          fs.writeFileSync(mwPath, initial, 'utf-8');
        }
        let mwFileContent = fs.readFileSync(mwPath, 'utf-8');
        const mwDate = new Date().toISOString().split('T')[0];
        const mwEntry = `- ${mwContent} [${mwDate}]`;
        const mwSectionHeader = `## ${mwCategory}`;
        const mwSectionIdx = mwFileContent.indexOf(`\n${mwSectionHeader}`);
        if (mwSectionIdx !== -1) {
          // Section exists â€” find end of section, insert before next ## or EOF
          const afterHeader = mwSectionIdx + mwSectionHeader.length + 1;
          const nextSection = mwFileContent.indexOf('\n## ', afterHeader);
          const insertAt = nextSection !== -1 ? nextSection : mwFileContent.length;
          mwFileContent = mwFileContent.slice(0, insertAt) + '\n' + mwEntry + mwFileContent.slice(insertAt);
        } else {
          // New category â€” append before closing --- or at end
          const closingComment = mwFileContent.lastIndexOf('\n---');
          const insertAt = closingComment !== -1 ? closingComment : mwFileContent.length;
          mwFileContent = mwFileContent.slice(0, insertAt) + '\n\n' + mwSectionHeader + '\n' + mwEntry + mwFileContent.slice(insertAt);
        }
        fs.writeFileSync(mwPath, mwFileContent, 'utf-8');
        return { name, args, result: `Written to ${mwFilename} [${mwCategory}]: ${mwContent}`, error: false };
      }

      case 'memory_read': {
        const mrFileRaw = String(args.file || 'user').toLowerCase().trim();
        const mrFile = mrFileRaw === 'memory' ? 'memory' : (mrFileRaw === 'soul' ? 'soul' : 'user');
        const mrFilename = mrFile === 'soul' ? 'SOUL.md' : (mrFile === 'memory' ? 'MEMORY.md' : 'USER.md');
        let mrPath = path.join(workspacePath, mrFilename);
        if (!fs.existsSync(mrPath)) {
          // Try config workspace as fallback
          const configWorkspace = getConfig().getWorkspacePath();
          mrPath = path.join(configWorkspace, mrFilename);
          console.log(`[memory_read] fallback workspace: ${configWorkspace}, path: ${mrPath}`);
        }
        if (!fs.existsSync(mrPath)) return { name, args, result: `${mrFilename} not found at ${mrPath}`, error: true };
        const mrContent = fs.readFileSync(mrPath, 'utf-8');
        return { name, args, result: mrContent, error: false };
      }

      case 'memory_search': {
        try {
          const query = String(args.query || '').trim();
          if (!query) return { name, args, result: 'memory_search: query is required', error: true };
          const modeRaw = String(args.mode || 'quick').trim().toLowerCase();
          const mode = (modeRaw === 'deep' || modeRaw === 'project' || modeRaw === 'timeline')
            ? modeRaw
            : 'quick';
          const sourceTypes = Array.isArray(args.source_types)
            ? args.source_types.map((v: any) => String(v || '').trim()).filter(Boolean)
            : undefined;
          const result = await searchMemoryInWorker('memory_search', {
            workspacePath,
            params: {
            query,
            mode: mode as any,
            limit: Number(args.limit || 8),
            projectId: args.project_id ? String(args.project_id) : undefined,
            dateFrom: args.date_from ? String(args.date_from) : undefined,
            dateTo: args.date_to ? String(args.date_to) : undefined,
            sourceTypes: sourceTypes as any,
            minDurability: args.min_durability !== undefined ? Number(args.min_durability) : undefined,
            debug: args.debug === true,
            queryRoute: 'legacy_executor',
            },
          }, { signal: deps.abortSignal?.signal });
          return { name, args, result: compactMemorySearchResult(result, { debug: args.debug === true }), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_search failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_read_record': {
        try {
          const recordId = String(args.record_id || '').trim();
          if (!recordId) return { name, args, result: 'memory_read_record: record_id is required', error: true };
          const out = readMemoryRecord(workspacePath, recordId);
          if (out.record) return { name, args, result: JSON.stringify(out, null, 2), error: false };
          return { name, args, result: `Record not found: ${recordId}`, error: true };
        } catch (err: any) {
          return { name, args, result: `memory_read_record failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_search_project': {
        try {
          const projectId = String(args.project_id || '').trim();
          const query = String(args.query || '').trim();
          if (!projectId) return { name, args, result: 'memory_search_project: project_id is required', error: true };
          if (!query) return { name, args, result: 'memory_search_project: query is required', error: true };
          const result = await searchMemoryInWorker('memory_search_project', {
            workspacePath,
            projectId,
            query,
            limit: Number(args.limit || 10),
          }, { signal: deps.abortSignal?.signal });
          return { name, args, result: compactMemorySearchResult(result), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_search_project failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_search_timeline': {
        try {
          const query = String(args.query || '').trim();
          if (!query) return { name, args, result: 'memory_search_timeline: query is required', error: true };
          const result = await searchMemoryInWorker('memory_search_timeline', {
            workspacePath,
            query,
            dateFrom: args.date_from ? String(args.date_from) : undefined,
            dateTo: args.date_to ? String(args.date_to) : undefined,
            limit: Number(args.limit || 20),
          }, { signal: deps.abortSignal?.signal });
          return { name, args, result: compactMemorySearchResult(result), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_search_timeline failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_get_related': {
        try {
          const recordId = String(args.record_id || '').trim();
          if (!recordId) return { name, args, result: 'memory_get_related: record_id is required', error: true };
          const related = getRelatedMemory(workspacePath, recordId, Number(args.limit || 8));
          return { name, args, result: JSON.stringify({ record_id: recordId, hits: related }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_get_related failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_graph_snapshot': {
        try {
          const graph = getMemoryGraphSnapshot(workspacePath);
          return { name, args, result: JSON.stringify(graph, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_graph_snapshot failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_index_refresh': {
        try {
          const out = await refreshMemoryIndexInWorker(workspacePath, { force: true, maxChangedFiles: 500, minIntervalMs: 0 });
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_index_refresh failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'write_note': {
        const noteContent = String(args.content || '').trim();
        if (!noteContent) {
          return { name, args, result: 'write_note: empty content', error: true };
        }
        const noteTag = String(args.tag || args.step || 'general').trim();
        const noteTaskId = args.task_id ? String(args.task_id) : null;
        let noteWriteResult: any = null;

        // Always write to intraday notes file (works in all sessions)
        try {
          const sourceLine = formatIntradayNoteSourceLine(inferIntradayNoteSource(sessionId, args));
          const noteWrite = require('./../../memory/intraday-notes').appendIntradayNote(workspacePath, {
            tag: noteTag, content: noteContent, sourceLine, taskId: noteTaskId,
            status: args.status, resolves: args.resolves, thread: args.thread,
          });
          noteWriteResult = noteWrite;
          try { require('./../../memory-index/recall-index').markRecallDirty(workspacePath, noteWrite.file, 500); } catch { /* best-effort */ }
        } catch (err: any) {
          return { name, args, result: `write_note: failed to write intraday note: ${err.message}`, error: true };
        }

        // Also append to task journal if in a task session
        const isTaskSession = String(sessionId || '').startsWith('task_');
        if (isTaskSession) {
          try {
            const taskId = sessionId.replace(/^task_/, '');
            const { appendJournal, loadTask, mutatePlan, saveTask } = require('./../../tasks/task-store');
            appendJournal(taskId, {
              type: 'write_note',
              content: `[${noteTag}] ${noteContent.slice(0, 300)}`,
              detail: noteContent.slice(0, 2000),
            });
            if (noteTag.toLowerCase() === 'task_complete') {
              const task = loadTask(taskId);
              const stepIndex = Number(task?.currentStepIndex);
              if (task && Number.isInteger(stepIndex)) {
                const startIndex = Math.max(0, Math.min(stepIndex, task.plan.length));
                const completions = task.plan
                  .map((step: any, index: number) => ({ step, index }))
                  .filter(({ step, index }: any) => index >= startIndex && step?.status !== 'done')
                  .map(({ index }: any) => ({
                    op: 'complete' as const,
                    step_index: index,
                    notes: 'auto-complete: task_complete logged by write_note',
                  }));

                if (completions.length > 0) {
                  mutatePlan(taskId, completions);
                }

                const advancedTask = loadTask(taskId);
                if (advancedTask) {
                  advancedTask.currentStepIndex = advancedTask.plan.length;
                  advancedTask.lastProgressAt = Date.now();
                  saveTask(advancedTask);
                }
                appendJournal(taskId, {
                  type: 'status_push',
                  content: `Auto-completed task plan from step ${startIndex + 1}: task_complete note logged by write_note.`,
                });
              }
            }
          } catch {}
        }

        const teamNote = inferTeamNoteContext(sessionId);
        if (teamNote) {
          appendTeamMemoryEvent(teamNote.teamId, {
            authorType: teamNote.authorType,
            authorId: teamNote.authorId,
            taskId: noteTaskId,
            tag: noteTag,
            content: noteContent,
          });
        }

        const completedDevEdit = markDevSourceEditContinuationComplete({
          id: args.dev_edit_id || args.devEditId,
          sessionId,
          tag: noteTag,
          note: noteContent,
        });
        const devEditSuffix = completedDevEdit
          ? ` Dev edit continuation ${completedDevEdit.id} marked complete.`
          : '';

        return {
          name,
          args,
          result: `Note saved [${noteTag}] (${noteContent.length} chars) -> intraday-notes${noteWriteResult?.deduped ? ' (duplicate of #' + noteWriteResult.id + ' within 10 min, not re-written)' : noteWriteResult?.id ? ' #' + noteWriteResult.id + ' (' + noteWriteResult.status + ')' : ''}${noteWriteResult?.resolved?.length ? ' resolved: ' + noteWriteResult.resolved.join(', ') : ''}${noteWriteResult?.unresolved?.length ? ' not found: ' + noteWriteResult.unresolved.join(', ') : ''}.${devEditSuffix}`,
          data: completedDevEdit ? { dev_edit_complete: true, dev_edit_id: completedDevEdit.id, tag: noteTag } : undefined,
          extra: completedDevEdit ? { dev_edit_complete: true, dev_edit_id: completedDevEdit.id, tag: noteTag } : undefined,
          error: false,
        };
      }

      // -- Skill Tools -------------------------------------------------------
      // New architecture: no trigger-matching, no session windows.
      // Flow: skill_list() -> skill_read("<id>"). Pinned skills auto-injected by buildTurnContext.

      case 'skill_list': {
        deps.skillsManager.refreshSkillsIfChanged();
        const all = deps.skillsManager.getAll();
        if (all.length === 0) {
          return { name, args, result: 'No skills installed yet. Use skill_create to save a new one.', error: false };
        }
        return {
          name, args,
          result: formatCompactSkillList(all, args),
          error: false,
        };
      }

      // skill_read: read a skill's full SKILL.md content by ID.
      // Resolves via skillsManager so it always works regardless of workspacePath
      // (critical for team agents whose workspace is inside teams/<id>/workspace).
      case 'skill_read': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) {
          return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        }
        activateSkillForSession(sessionId, skill.id);
        try {
          const content = fs.readFileSync(skill.filePath, 'utf-8').replace(/^\s*emoji\s*:.*\r?\n/gm, '');
          const header = [
            `${skill.name} (${skill.id}) ${skill.kind === 'bundle' ? `v${skill.version} bundle` : 'simple skill'}`,
            skill.description ? `Description: ${skill.description}` : '',
            Array.isArray(skill.requiredTools) && skill.requiredTools.length ? `Required tools: ${skill.requiredTools.join(', ')}` : '',
            skill.status && skill.status !== 'ready' ? `Status: ${skill.status}` : '',
            skill.validation && !skill.validation.ok ? `Validation errors: ${skill.validation.errors.join('; ')}` : '',
          ].filter(Boolean).join('\n');
          let resourceBlock = '';
          if (skill.kind === 'bundle' && Array.isArray(skill.resources) && skill.resources.length) {
            const menuLines = skill.resources.map((r: any) =>
              `- ${r.path}${r.description ? ` — ${r.description}` : ''}`
            );
            const firstResource = skill.resources[0];
            const suggested = `skill_resource_read({ id: "${skillId}", path: "${firstResource.path}" })`;
            resourceBlock = [
              '',
              '',
              'Relevant resources:',
              ...menuLines,
              '',
              `Suggested next call if you need a resource:\n${suggested}`,
            ].join('\n');
          }
          return { name, args, result: `${header}\n\nInstructions:\n${content}${resourceBlock}`, error: false };
        } catch {
          return { name, args, result: `${skill.name} (${skillId})\n\n${skill.instructions}`, error: false };
        }
      }

      case 'skill_resource_list': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        const resources = deps.skillsManager.listResources(skillId);
        if (!resources.length) return { name, args, result: `Skill "${skill.id}" has no declared or discovered resources.`, error: false };
        const lines = resources.map((r: any) => {
          const size = Number.isFinite(Number(r.sizeBytes)) ? `, ${r.sizeBytes} bytes` : '';
          return `- ${r.path} (${r.type}${size})${r.description ? ` - ${r.description}` : ''}`;
        }).join('\n');
        return {
          name, args,
          result: `Resources for ${skill.name} (${skill.id}):\n${lines}\n\nRead one with skill_resource_read({"id":"${skill.id}","path":"<resource path>"}).`,
          error: false,
        };
      }

      case 'skill_resource_read': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required.', error: true };
        if (!resourcePath) return { name, args, result: 'ERROR: path is required.', error: true };
        const maxChars = args.max_chars ? Number(args.max_chars) : undefined;
        const result = deps.skillsManager.readResource(skillId, resourcePath, Number.isFinite(maxChars) ? maxChars : undefined);
        if (!result.ok) return { name, args, result: `skill_resource_read failed: ${result.error}`, error: true };
        const skill = deps.skillsManager.get(skillId);
        activateSkillForSession(sessionId, skill?.id || skillId);
        activateSkillResourceForSession(sessionId, skill?.id || skillId, result.path);
        return {
          name, args,
          result: `Resource ${skillId}/${result.path}${result.truncated ? ' (truncated)' : ''}:\n\n${result.content}`,
          error: false,
        };
      }

      case 'skill_import_bundle': {
        const source = String(args.source || args.url || args.path || '').trim();
        if (!source) return { name, args, result: 'skill_import_bundle: source is required (directory, .zip path, GitHub tree URL, or https URL to a .zip).', error: true };
        try {
          const imported = await deps.skillsManager.importBundles(source, {
            id: args.id ? String(args.id) : undefined,
            overwrite: args.overwrite === true,
          });
          const lines = imported.map((skill: any) =>
            `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources) - ${skill.description || skill.name}`
          ).join('\n');
          return {
            name, args,
            result: `Imported ${imported.length} skill${imported.length !== 1 ? 's' : ''}:\n${lines}\n\nUse skill_read("<id>") to inspect one.`,
            error: false,
          };
        } catch (importErr: any) {
          return { name, args, result: `skill_import_bundle failed: ${importErr.message}`, error: true };
        }
      }

      case 'skill_inspect': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const inspection = deps.skillsManager.inspect(skillId);
        if (!inspection) return { name, args, result: `Skill "${skillId}" not found.`, error: true };
        return {
          name, args,
          result: JSON.stringify(inspection, null, 2),
          error: false,
        };
      }

      case 'skill_manifest_write': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required.', error: true };
        const manifestArg = args.manifest;
        const manifest = typeof manifestArg === 'string' ? parseJsonLike(manifestArg) : manifestArg;
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
          return { name, args, result: 'ERROR: manifest must be an object or JSON object string.', error: true };
        }
        try {
          const updated = deps.skillsManager.writeManifestOverlay(skillId, manifest, {
            changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : undefined,
            evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
            appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          });
          return {
            name, args,
            result: `Wrote manifest overlay for ${updated.name} (${updated.id}) at ${updated.overlayPath || '(overlay path unavailable)'}. Manifest source: ${updated.manifestSource}.`,
            error: false,
          };
        } catch (manifestErr: any) {
          return { name, args, result: `skill_manifest_write failed: ${manifestErr.message}`, error: true };
        }
      }

      case 'skill_create_bundle': {
        const scId = String(args.id || '').trim();
        const scName = String(args.name || '').trim();
        const scInstructions = String(args.instructions || '').trim();
        if (!scId) return { name, args, result: 'skill_create_bundle: id is required', error: true };
        if (!scName) return { name, args, result: 'skill_create_bundle: name is required', error: true };
        if (!scInstructions) return { name, args, result: 'skill_create_bundle: instructions is required', error: true };
        const splitCsv = (value: any) => Array.isArray(value)
          ? value.map((v: any) => String(v || '').trim()).filter(Boolean)
          : String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
        try {
          const skill = deps.skillsManager.createBundle({
            id: scId,
            name: scName,
            description: args.description ? String(args.description).trim() : '',
            instructions: scInstructions,
            version: args.version ? String(args.version) : undefined,
            triggers: splitCsv(args.triggers),
            categories: splitCsv(args.categories),
            requiredTools: splitCsv(args.requiredTools || args.required_tools),
            permissions: args.permissions && typeof args.permissions === 'object' ? args.permissions : undefined,
            resources: Array.isArray(args.resources) ? args.resources : [],
            overwrite: args.overwrite === true,
          });
          return {
            name, args,
            result: `Bundle skill "${skill.name}" created at ${skill.rootDir}. Resources: ${skill.resources.length}. Use skill_read("${skill.id}") to inspect it.`,
            error: false,
          };
        } catch (bundleErr: any) {
          return { name, args, result: `skill_create_bundle failed: ${bundleErr.message}`, error: true };
        }
      }

      case 'skill_resource_write': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        const content = String(args.content ?? '');
        if (!skillId) return { name, args, result: 'skill_resource_write: id is required', error: true };
        if (!resourcePath) return { name, args, result: 'skill_resource_write: path is required', error: true };
        try {
          const updated = deps.skillsManager.writeResource(skillId, resourcePath, content, {
            type: args.type ? String(args.type) : undefined,
            description: args.description ? String(args.description) : undefined,
            addToManifest: args.addToManifest !== false,
            change: {
              changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : undefined,
              evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
              appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
              reason: args.reason ? String(args.reason) : undefined,
            },
          });
          return {
            name, args,
            result: `Wrote ${resourcePath} in skill "${updated.id}". Resources now: ${updated.resources.length}.`,
            error: false,
          };
        } catch (resourceErr: any) {
          return { name, args, result: `skill_resource_write failed: ${resourceErr.message}`, error: true };
        }
      }

      case 'skill_resource_delete': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        if (!skillId) return { name, args, result: 'skill_resource_delete: id is required', error: true };
        if (!resourcePath) return { name, args, result: 'skill_resource_delete: path is required', error: true };
        try {
          const updated = deps.skillsManager.deleteResource(skillId, resourcePath, {
            removeFromManifest: args.removeFromManifest !== false,
          });
          return {
            name, args,
            result: `Deleted ${resourcePath} from skill "${updated.id}". Resources now: ${updated.resources.length}.`,
            error: false,
          };
        } catch (deleteErr: any) {
          return { name, args, result: `skill_resource_delete failed: ${deleteErr.message}`, error: true };
        }
      }

      case 'skill_export_bundle': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_export_bundle: id is required', error: true };
        try {
          const exported = await deps.skillsManager.exportBundle(skillId, args.outputPath ? String(args.outputPath) : undefined);
          return {
            name, args,
            result: `Exported skill "${skillId}" to ${exported.path} (${exported.bytes} bytes).`,
            error: false,
          };
        } catch (exportErr: any) {
          return { name, args, result: `skill_export_bundle failed: ${exportErr.message}`, error: true };
        }
      }

      case 'skill_update_from_source': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_update_from_source: id is required', error: true };
        try {
          const updated = await deps.skillsManager.updateFromSource(skillId, { overwrite: args.overwrite !== false });
          const lines = updated.map((skill: any) => `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources)`).join('\n');
          return {
            name, args,
            result: `Updated ${updated.length} skill${updated.length !== 1 ? 's' : ''} from stored source:\n${lines}`,
            error: false,
          };
        } catch (updateErr: any) {
          return { name, args, result: `skill_update_from_source failed: ${updateErr.message}`, error: true };
        }
      }

      case 'skill_create': {
        const scId = String(args.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const scName = String(args.name || '').trim();
        const scInstructions = String(args.instructions || '').trim();
        if (!scId) return { name, args, result: 'skill_create: id is required', error: true };
        if (!scName) return { name, args, result: 'skill_create: name is required', error: true };
        if (!scInstructions) return { name, args, result: 'skill_create: instructions is required', error: true };
        try {
          const scSkill = deps.skillsManager.createSkill({
            id: scId,
            name: scName,
            description: args.description ? String(args.description).trim() : '',
            triggers: splitCsv(args.triggers),
            instructions: scInstructions,
          });
          return {
            name, args,
            result: `Skill "${scSkill.name}" created at ${scSkill.filePath}.\nUse skill_read("${scSkill.id}") to verify it, or skill_list() to see all skills.`,
            error: false,
          };
        } catch (scErr: any) {
          return { name, args, result: `skill_create failed: ${scErr.message}`, error: true };
        }
      }

      case 'skill_audit_all': {
        return skillsCapabilityExecutor.execute({ name, args, workspacePath, deps, sessionId });
      }

      case 'skill_update_metadata': {
        return skillsCapabilityExecutor.execute({ name, args, workspacePath, deps, sessionId });
      }

      case 'skill_repair_metadata': {
        return skillsCapabilityExecutor.execute({ name, args, workspacePath, deps, sessionId });
      }
 }
 throw new Error(`Unsupported memory tool: ${name}`);
}
