import fs from 'fs';
import path from 'path';
import { getConfig } from '../../../config/config';
import {
  backfillSqliteMemoryEmbeddings,
  getMemoryGraphSnapshot,
  getRelatedMemory,
  readMemoryRecord,
  refreshMemoryIndexFromAudit,
  searchMemoryIndexAsync,
  searchMemoryTimeline,
  searchProjectMemory,
} from '../../memory-index/index';
import { getMemoryEmbeddingStatus } from '../../memory/embeddings/registry';
import { getMemoryProviderStatus } from '../../memory/providers/registry';
import { consolidateMemory, listMemoryClaims, reviewMemoryClaim } from '../../memory/consolidation/runner';
import { isBusinessContextEnabled, setBusinessContextEnabled } from '../../session';
import { appendTeamMemoryEvent } from '../../teams/team-workspace';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import type { ToolResult } from '../../tool-builder';
import { inferTeamNoteContext } from './team-agent-helpers';

const MEMORY_TOOL_NAMES = new Set([
  'business_context_mode',
  'memory_browse',
  'memory_write',
  'memory_read',
  'memory_search',
  'memory_read_record',
  'memory_search_project',
  'memory_search_timeline',
  'memory_get_related',
  'memory_graph_snapshot',
  'memory_index_refresh',
  'memory_provider_status',
  'memory_embedding_status',
  'memory_embedding_backfill',
  'memory_debug_search',
  'memory_consolidate',
  'memory_review_claims',
  'memory_accept_claim',
  'memory_reject_claim',
  'memory_supersede_record',
  'write_note',
]);

function loadBusinessContextSnapshot(workspacePath: string, maxChars: number = 4000): string {
  try {
    const businessPath = path.join(workspacePath, 'BUSINESS.md');
    if (!fs.existsSync(businessPath)) return '';
    const content = fs.readFileSync(businessPath, 'utf-8').trim();
    if (content.length <= maxChars) return content;
    return `${content.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...[truncated]`;
  } catch {
    return '';
  }
}

function resolveMemoryFile(file: any): { key: 'user' | 'memory' | 'soul'; filename: string } {
  const raw = String(file || 'user').toLowerCase().trim();
  const key = raw === 'memory' ? 'memory' : (raw === 'soul' ? 'soul' : 'user');
  return {
    key,
    filename: key === 'soul' ? 'SOUL.md' : (key === 'memory' ? 'MEMORY.md' : 'USER.md'),
  };
}

function resolveMemoryPath(workspacePath: string, filename: string): string {
  const primary = path.join(workspacePath, filename);
  if (fs.existsSync(primary)) return primary;
  const configWorkspace = getConfig().getWorkspacePath();
  return path.join(configWorkspace, filename);
}

export const memoryCapabilityExecutor: CapabilityExecutor = {
  id: 'memory',

  canHandle(name: string): boolean {
    return MEMORY_TOOL_NAMES.has(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, workspacePath, sessionId } = ctx;

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
        const { key, filename } = resolveMemoryFile(args.file);
        const primaryPath = path.join(workspacePath, filename);
        const memoryPath = resolveMemoryPath(workspacePath, filename);
        if (!fs.existsSync(memoryPath)) {
          return { name, args, result: `${filename} not found at ${primaryPath} or ${memoryPath}. Create it first.`, error: true };
        }
        const content = fs.readFileSync(memoryPath, 'utf-8');
        const matches = content.match(/^## (.+)/gm) || [];
        const categories = matches.map((m: string) => m.replace(/^## /, '').trim());
        if (categories.length === 0) {
          return { name, args, result: `${filename} has no categories yet. Use memory_write to create the first one.`, error: false };
        }
        return {
          name,
          args,
          result: `${filename} categories:\n${categories.map((c: string) => `- ${c}`).join('\n')}\n\nUse memory_write(file="${key}", category="<name>", content="...") to add a fact.`,
          error: false,
        };
      }

      case 'memory_write': {
        const { filename } = resolveMemoryFile(args.file);
        const category = String(args.category || '').trim().toLowerCase().replace(/\s+/g, '_');
        const content = String(args.content || '').trim();
        if (!category) return { name, args, result: 'memory_write: category is required', error: true };
        if (!content) return { name, args, result: 'memory_write: content is required', error: true };
        const memoryPath = resolveMemoryPath(workspacePath, filename);
        if (!fs.existsSync(memoryPath)) {
          fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
          fs.writeFileSync(memoryPath, `# ${filename}\n\n---\n`, 'utf-8');
        }
        let fileContent = fs.readFileSync(memoryPath, 'utf-8');
        const entry = `- ${content} [${new Date().toISOString().split('T')[0]}]`;
        const sectionHeader = `## ${category}`;
        const sectionIdx = fileContent.indexOf(`\n${sectionHeader}`);
        if (sectionIdx !== -1) {
          const afterHeader = sectionIdx + sectionHeader.length + 1;
          const nextSection = fileContent.indexOf('\n## ', afterHeader);
          const insertAt = nextSection !== -1 ? nextSection : fileContent.length;
          fileContent = fileContent.slice(0, insertAt) + '\n' + entry + fileContent.slice(insertAt);
        } else {
          const closingComment = fileContent.lastIndexOf('\n---');
          const insertAt = closingComment !== -1 ? closingComment : fileContent.length;
          fileContent = fileContent.slice(0, insertAt) + '\n\n' + sectionHeader + '\n' + entry + fileContent.slice(insertAt);
        }
        fs.writeFileSync(memoryPath, fileContent, 'utf-8');
        return { name, args, result: `Written to ${filename} [${category}]: ${content}`, error: false };
      }

      case 'memory_read': {
        const { filename } = resolveMemoryFile(args.file);
        const memoryPath = resolveMemoryPath(workspacePath, filename);
        if (!fs.existsSync(memoryPath)) return { name, args, result: `${filename} not found at ${memoryPath}`, error: true };
        return { name, args, result: fs.readFileSync(memoryPath, 'utf-8'), error: false };
      }

      case 'memory_search': {
        try {
          const query = String(args.query || '').trim();
          if (!query) return { name, args, result: 'memory_search: query is required', error: true };
          const modeRaw = String(args.mode || 'quick').trim().toLowerCase();
          const mode = (modeRaw === 'deep' || modeRaw === 'project' || modeRaw === 'timeline') ? modeRaw : 'quick';
          const sourceTypes = Array.isArray(args.source_types)
            ? args.source_types.map((v: any) => String(v || '').trim()).filter(Boolean)
            : undefined;
          const out = await searchMemoryIndexAsync(workspacePath, {
            query,
            mode: mode as any,
            limit: Number(args.limit || 8),
            projectId: args.project_id ? String(args.project_id) : undefined,
            dateFrom: args.date_from ? String(args.date_from) : undefined,
            dateTo: args.date_to ? String(args.date_to) : undefined,
            sourceTypes: sourceTypes as any,
            minDurability: args.min_durability !== undefined ? Number(args.min_durability) : undefined,
            debug: args.debug === true,
            rerank: args.rerank !== false,
            queryRoute: String(args.query_route || 'tool_manual'),
          });
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
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
          return { name, args, result: JSON.stringify(searchProjectMemory(workspacePath, projectId, query, Number(args.limit || 10)), null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_search_project failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_search_timeline': {
        try {
          const query = String(args.query || '').trim();
          if (!query) return { name, args, result: 'memory_search_timeline: query is required', error: true };
          const out = searchMemoryTimeline(
            workspacePath,
            query,
            args.date_from ? String(args.date_from) : undefined,
            args.date_to ? String(args.date_to) : undefined,
            Number(args.limit || 20),
          );
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
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
          return { name, args, result: JSON.stringify(getMemoryGraphSnapshot(workspacePath), null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_graph_snapshot failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_index_refresh': {
        try {
          const out = refreshMemoryIndexFromAudit(workspacePath, { force: true, maxChangedFiles: 500, minIntervalMs: 0 });
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_index_refresh failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_provider_status': {
        try {
          return { name, args, result: JSON.stringify(await getMemoryProviderStatus(workspacePath), null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_provider_status failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_embedding_status': {
        try {
          return { name, args, result: JSON.stringify(await getMemoryEmbeddingStatus(), null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_embedding_status failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_embedding_backfill': {
        try {
          const out = await backfillSqliteMemoryEmbeddings(workspacePath, {
            limit: args.limit != null ? Number(args.limit) : undefined,
            provider: args.provider ? String(args.provider) : undefined,
            force: args.force === true,
          });
          return { name, args, result: JSON.stringify(out, null, 2), error: !out.ok };
        } catch (err: any) {
          return { name, args, result: `memory_embedding_backfill failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_debug_search': {
        try {
          const query = String(args.query || '').trim();
          if (!query) return { name, args, result: 'memory_debug_search: query is required', error: true };
          const out = await searchMemoryIndexAsync(workspacePath, {
            query,
            mode: (['quick', 'deep', 'project', 'timeline'].includes(String(args.mode || 'quick')) ? String(args.mode || 'quick') : 'quick') as any,
            limit: Number(args.limit || 12),
            projectId: args.project_id ? String(args.project_id) : undefined,
            debug: true,
            rerank: args.rerank !== false,
            queryRoute: 'debug_tool',
          });
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_debug_search failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_consolidate': {
        try {
          const out = consolidateMemory(workspacePath, {
            maxSources: args.max_sources != null ? Number(args.max_sources) : undefined,
            maxClaims: args.max_claims != null ? Number(args.max_claims) : undefined,
            autoAccept: args.auto_accept === true,
          });
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_consolidate failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_review_claims': {
        try {
          const out = listMemoryClaims(workspacePath, String(args.status || 'proposed'));
          return { name, args, result: JSON.stringify({ claims: out }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_review_claims failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_accept_claim':
      case 'memory_reject_claim':
      case 'memory_supersede_record': {
        try {
          const claimId = String(args.claim_id || args.record_id || '').trim();
          if (!claimId) return { name, args, result: `${name}: claim_id is required`, error: true };
          const action = name === 'memory_accept_claim' ? 'accept' : (name === 'memory_reject_claim' ? 'reject' : 'supersede');
          const out = reviewMemoryClaim(workspacePath, claimId, action, args.note ? String(args.note) : undefined);
          return { name, args, result: JSON.stringify(out, null, 2), error: !out.ok };
        } catch (err: any) {
          return { name, args, result: `${name} failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'write_note': {
        const noteContent = String(args.content || '').trim();
        if (!noteContent) return { name, args, result: 'write_note: empty content', error: true };
        const noteTag = String(args.tag || args.step || 'general').trim();
        const noteTaskId = args.task_id ? String(args.task_id) : null;

        try {
          const noteDate = new Date().toISOString().split('T')[0];
          const memDir = path.join(workspacePath, 'memory');
          if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
          const intradayFile = path.join(memDir, `${noteDate}-intraday-notes.md`);
          const timestamp = new Date().toISOString();
          let entry = `\n### [${noteTag.toUpperCase()}] ${timestamp}\n${noteContent}`;
          if (noteTaskId) entry += `\n_Related task: ${noteTaskId}_`;
          fs.appendFileSync(intradayFile, entry + '\n');
        } catch (err: any) {
          return { name, args, result: `write_note: failed to write intraday note: ${err.message}`, error: true };
        }

        if (String(sessionId || '').startsWith('task_')) {
          try {
            const taskId = sessionId.replace(/^task_/, '');
            const { appendJournal, loadTask, mutatePlan, saveTask } = require('../../tasks/task-store');
            appendJournal(taskId, {
              type: 'write_note',
              content: `[${noteTag}] ${noteContent.slice(0, 300)}`,
              detail: noteContent.slice(0, 2000),
            });
            if (noteTag.toLowerCase() === 'task_complete') {
              const task = loadTask(taskId);
              const stepIndex = Number(task?.currentStepIndex);
              const currentStep = Number.isInteger(stepIndex) ? task?.plan?.[stepIndex] : undefined;
              if (task && currentStep?.notes === 'write_note_completion') {
                mutatePlan(taskId, [{
                  op: 'complete',
                  step_index: stepIndex,
                  notes: 'auto-complete: task_complete logged by write_note',
                }]);
                const advancedTask = loadTask(taskId);
                if (advancedTask && advancedTask.currentStepIndex === stepIndex) {
                  advancedTask.currentStepIndex = Math.min(stepIndex + 1, advancedTask.plan.length);
                  advancedTask.lastProgressAt = Date.now();
                  saveTask(advancedTask);
                }
                appendJournal(taskId, {
                  type: 'status_push',
                  content: `Auto-advanced final step ${stepIndex + 1}: task_complete note logged by write_note.`,
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

        return { name, args, result: `Note saved [${noteTag}] (${noteContent.length} chars) -> intraday-notes`, error: false };
      }

      default:
        return { name, args, result: `Unhandled memory tool: ${name}`, error: true };
    }
  },
};
