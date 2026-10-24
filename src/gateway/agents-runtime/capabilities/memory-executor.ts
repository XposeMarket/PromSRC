import fs from 'fs';
import path from 'path';
import { getConfig } from '../../../config/config';
import {
  backfillMemoryEmbeddingsInWorker,
  compactMemorySearchResult,
  getMemoryGraphSnapshot,
  getRelatedMemory,
  readMemoryRecord,
  refreshMemoryIndexInWorker,
} from '../../memory-index/index';
import {
  searchMemoryInWorker,
} from '../../memory-index/search-worker-client';
import { getMemoryAccessGateState } from '../../memory-index/memory-access-gate';
import { invalidateMemoryAtomSnapshot } from '../../memory-index/memory-atoms.js';
import {
  BULLET_ID_RE,
  deleteMemoryFact,
  ensureMemoryBulletIds,
  findMemoryBulletById,
  isPoisonMemoryFact,
  normalizeBulletIdArg,
  removeMemoryBulletById,
  renderMemoryIdsForPrompt,
  replaceMemoryBulletById,
  supersedeSectionConflicts,
  writeMemoryFact,
} from '../../memory-index/memory-recall.js';
import { getMemoryEmbeddingStatus } from '../../memory/embeddings/registry';
import { getMemoryProviderStatus } from '../../memory/providers/registry';
import { consolidateMemory, listMemoryClaims, reviewMemoryClaim } from '../../memory/consolidation/runner';
import { isBusinessContextEnabled, setBusinessContextEnabled } from '../../session';
import { appendTeamMemoryEvent } from '../../teams/team-workspace';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import { ensureRuntimeActorMemory, getRuntimeActorContext } from '../../runtime-actor.js';
import type { ToolResult } from '../../tool-builder';
import { inferTeamNoteContext } from './team-agent-helpers';
import { appendEntityEvent, listEntities, readEntity, writeEntity } from '../../business/entity-store';
import { formatIntradayNoteSourceLine, inferIntradayNoteSource } from '../../intraday-note-source';

/** Archive lives beside the source file: memory-archive/<FILE>.archive.md. Never injected or indexed. */
function archivePathFor(memoryPath: string): string {
  const base = path.basename(memoryPath, '.md');
  return path.join(path.dirname(memoryPath), 'memory-archive', `${base}.archive.md`);
}

function archivePathLabel(filename: string): string {
  return `memory-archive/${filename.replace(/\.md$/i, '')}.archive.md`;
}

/**
 * Lazy migration run on every memory action: moves legacy inline `[superseded ...]`
 * bullets to the archive (untrusted quarantine lines stay put) and assigns ids.
 */
function migrateMemoryContent(raw: string): { content: string; archived: string[] } {
  const archived: string[] = [];
  const kept: string[] = [];
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*-\s/.test(line) && /\[superseded\b/i.test(line) && !/memory-status:untrusted/i.test(line)) {
      archived.push(`${line.replace(/\r$/, '').trim()} [archived legacy]`);
      continue;
    }
    kept.push(line);
  }
  return { content: ensureMemoryBulletIds(kept.join('\n')).content, archived };
}

/** Atomic replace: write a unique tmp file, then rename over the target (copy+unlink fallback on Windows EPERM/EEXIST). */
function atomicWriteMemoryFile(target: string, content: string): void {
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, target);
  } catch (err: any) {
    if (err?.code !== 'EPERM' && err?.code !== 'EEXIST') {
      try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      throw err;
    }
    try { fs.copyFileSync(tmp, target); } finally { try { fs.unlinkSync(tmp); } catch { /* best effort */ } }
  }
}

/**
 * Archive FIRST, then write the source atomically. If the archive append throws, the
 * source is left byte-identical and the error is returned (callers must return error:true).
 * Returns null on success.
 */
function commitMemoryFile(memoryPath: string, content: string, archived: string[]): string | null {
  try {
    if (archived.length) {
      const archivePath = archivePathFor(memoryPath);
      fs.mkdirSync(path.dirname(archivePath), { recursive: true });
      const header = fs.existsSync(archivePath)
        ? ''
        : `# ${path.basename(memoryPath)} archive\n\nReplaced, superseded and deleted memory bullets. Never injected into prompts.\n\n`;
      fs.appendFileSync(archivePath, `${header}${archived.join('\n')}\n`, 'utf-8');
    }
    const current = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';
    if (content !== current) atomicWriteMemoryFile(memoryPath, content);
    return null;
  } catch (err: any) {
    return String(err?.message || err);
  }
}
const MEMORY_TOOL_NAMES = new Set([
  'business_context_mode',
  'list_entities',
  'read_entity',
  'write_entity',
  'append_entity_event',
  'memory',
  'memory_browse',
  'memory_write',
  'memory_update',
  'memory_delete',
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

export function loadBusinessContextSnapshot(workspacePath: string, maxChars: number = 4000): string {
  try {
    const businessPath = path.join(workspacePath, 'BUSINESS.md');
    if (!fs.existsSync(businessPath)) return '';
    // Prompt text shows [m:id] and never the raw <!-- m:id --> comment.
    const content = renderMemoryIdsForPrompt(fs.readFileSync(businessPath, 'utf-8')).trim();
    if (content.length <= maxChars) return content;
    return `${content.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...[truncated]`;
  } catch {
    return '';
  }
}

function normalizeMemoryCategory(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

interface MemoryCategorySection {
  headerStart: number;
  bodyStart: number;
  end: number;
  heading: string;
}

function findMemoryCategorySection(content: string, category: string): MemoryCategorySection | null {
  const wanted = normalizeMemoryCategory(category);
  if (!wanted) return null;
  const headingRe = /^##[ \t]+(.+?)\s*$/gm;
  const matches: Array<{ index: number; end: number; heading: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(content)) !== null) {
    matches.push({ index: match.index, end: headingRe.lastIndex, heading: String(match[1] || '').trim() });
  }
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    if (normalizeMemoryCategory(current.heading) !== wanted) continue;
    return {
      headerStart: current.index,
      bodyStart: current.end,
      end: index + 1 < matches.length ? matches[index + 1].index : content.length,
      heading: current.heading,
    };
  }
  return null;
}

function resolveMemoryFile(file: any): { key: 'user' | 'memory' | 'soul'; filename: string } {
  const raw = String(file || 'user').toLowerCase().trim();
  const key = raw === 'memory' ? 'memory' : (raw === 'soul' ? 'soul' : 'user');
  return {
    key,
    filename: key === 'soul' ? 'SOUL.md' : (key === 'memory' ? 'MEMORY.md' : 'USER.md'),
  };
}

function resolveMemoryPath(workspacePath: string, filename: string, sessionId?: string): string {
  const actor = getRuntimeActorContext(String(sessionId || ''));
  if (actor?.kind === 'agent' || actor?.kind === 'manager') {
    // A distinct actor may only use the generic markdown-memory tools for its
    // own MEMORY.md. USER.md and SOUL.md belong exclusively to main Prometheus.
    if (filename !== 'MEMORY.md') {
      throw new Error(`${filename} is main-Prometheus memory and is not writable/readable from the ${actor.kind} runtime. Use personal MEMORY.md instead.`);
    }
    const personalPath = ensureRuntimeActorMemory(actor);
    if (!personalPath) throw new Error(`Personal memory root is not configured for ${actor.agentId || actor.kind}.`);
    return personalPath;
  }
  const primary = path.join(workspacePath, filename);
  if (fs.existsSync(primary)) return primary;
  const configWorkspace = getConfig().getWorkspacePath();
  return path.join(configWorkspace, filename);
}

/**
 * Unified recall for memory(action:"search"|"recall"). The incremental recall
 * index (transcripts, notes, MEMORY/USER bullets, captured ideas) answers
 * first and never waits on memory maintenance. The structured memory index is
 * appended as a secondary section with a short timeout: if maintenance holds
 * it, the answer still returns with a note instead of a 30s failure.
 * The current chat is excluded so the question can't match itself.
 */
// Structured-index budget for memory(action:"search"). The keyword + semantic
// recall index is the primary answer; the structured worker index is a bonus
// section. It used to run AFTER recall with a 4-8s race, and because every
// explicit search schedules an index refresh + embedding backfill (exclusive
// SQLite gate), the next search routinely sat ~8s queued behind maintenance
// before being skipped (observed: "Memory completed · 8.7 s").
export const STRUCTURED_SEARCH_BUDGET_MS = 3000;
export const STRUCTURED_SEARCH_MAINTENANCE_BUDGET_MS = 750;

function maintenanceHoldsMemoryGate(): boolean {
  const gate = getMemoryAccessGateState();
  return gate.activeKind === 'maintenance' || gate.pending.includes('maintenance');
}

/**
 * Run a structured search with a hard wall-clock budget, started in parallel
 * with recall. Budget shrinks when maintenance holds/awaits the gate. On
 * expiry while still queued behind maintenance, the underlying task is
 * aborted so it does not linger in the worker queue (aborting a query that is
 * actively executing would force-kill and cold-restart the worker, so that
 * case is left to finish in the background and its result is discarded).
 */
export function runStructuredSearchWithBudget(
  search: (signal: AbortSignal) => Promise<string>,
  options: { parentSignal?: AbortSignal; budgetMs?: number; maintenanceBudgetMs?: number; maintenanceBusy?: () => boolean } = {},
): Promise<{ ok: true; value: string } | { ok: false; error: string; elapsedMs: number }> {
  const busy = options.maintenanceBusy || maintenanceHoldsMemoryGate;
  const budgetMs = busy()
    ? (options.maintenanceBudgetMs ?? STRUCTURED_SEARCH_MAINTENANCE_BUDGET_MS)
    : (options.budgetMs ?? STRUCTURED_SEARCH_BUDGET_MS);
  const controller = new AbortController();
  const parent = options.parentSignal;
  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const work = search(controller.signal);
  work.catch(() => undefined);
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const queuedBehindMaintenance = busy();
      if (queuedBehindMaintenance) controller.abort();
      reject(new Error(queuedBehindMaintenance
        ? `structured memory index busy with maintenance (>${budgetMs}ms); skipped`
        : `structured memory index slow (>${budgetMs}ms); skipped`));
    }, budgetMs);
    timer.unref?.();
  });
  return Promise.race([work, budget])
    .then(
      (value) => ({ ok: true as const, value }),
      (err: any) => ({ ok: false as const, error: String(err?.message || err), elapsedMs: Date.now() - startedAt }),
    )
    .finally(() => {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    });
}

async function runUnifiedRecall(ctx: CapabilityExecutionContext, recallOnly: boolean): Promise<ToolResult> {
  const { name, args, workspacePath, sessionId } = ctx;
  const query = String(args?.query || '').trim();
  if (!query) return { name, args, result: `memory(action="${recallOnly ? 'recall' : 'search'}"): query is required`, error: true };
  const sections: string[] = [];
  let recallBest = 'none';
  // Kick off the structured worker query first so it runs in its child
  // process while keyword + semantic recall run here.
  const structuredPending = recallOnly ? null : (() => {
    const modeRaw = String(args?.mode || 'quick').trim().toLowerCase();
    const mode = (modeRaw === 'deep' || modeRaw === 'project' || modeRaw === 'timeline') ? modeRaw : 'quick';
    const sourceTypes = Array.isArray(args?.source_types) ? args.source_types.map((v: any) => String(v || '').trim()).filter(Boolean) : undefined;
    return runStructuredSearchWithBudget((signal) => searchMemoryInWorker('memory_search', {
      workspacePath,
      params: {
        query, mode: mode as any, limit: Math.min(8, Number(args?.limit || 6)),
        projectId: args?.project_id ? String(args.project_id) : undefined,
        dateFrom: args?.date_from ? String(args.date_from) : undefined,
        dateTo: args?.date_to ? String(args.date_to) : undefined,
        sourceTypes: sourceTypes as any,
        minDurability: args?.min_durability !== undefined ? Number(args.min_durability) : undefined,
        rerank: true,
        queryRoute: 'tool_manual',
      },
    }, { signal }), {
      parentSignal: ctx.deps?.abortSignal?.signal,
      // Deep mode explicitly asks for more work; give it a longer budget.
      budgetMs: mode === 'deep' ? 8000 : undefined,
    });
  })();
  try {
    const { searchRecall, formatRecallResult, searchRecallSemantic, formatSemanticRecallSection } = require('../../memory-index/recall-index');
    const sources = Array.isArray(args?.sources) ? args.sources.map((s: any) => String(s || '').trim()).filter(Boolean) : undefined;
    const res = searchRecall(workspacePath, {
      query,
      limit: Math.min(15, Number(args?.limit || 8)),
      sources,
      excludeSessionId: args?.include_current_chat === true ? '' : String(sessionId || ''),
      dateFrom: args?.date_from ? String(args.date_from) : undefined,
      dateTo: args?.date_to ? String(args.date_to) : undefined,
    });
    recallBest = res.best;
    sections.push(formatRecallResult(res));
    try {
      const sem = await searchRecallSemantic(workspacePath, {
        query,
        limit: 5,
        sources: Array.isArray(args?.sources) ? args.sources.map((s: any) => String(s || '').trim()).filter(Boolean) : undefined,
        excludeSessionId: args?.include_current_chat === true ? '' : String(sessionId || ''),
        dateFrom: args?.date_from ? String(args.date_from) : undefined,
        dateTo: args?.date_to ? String(args.date_to) : undefined,
      }, res.hits);
      const semText = formatSemanticRecallSection(sem);
      if (semText) {
        sections.push(semText);
        if (recallBest === 'none' && sem?.hits?.some((h: any) => h.confidence === 'strong')) recallBest = 'partial';
      }
    } catch { /* keyword result stands alone */ }
  } catch (err: any) {
    sections.push(`recall index unavailable: ${String(err?.message || err)}`);
  }
  if (structuredPending) {
    const outcome = await structuredPending;
    if (outcome.ok) {
      try {
        const { formatStructuredMemoryHits } = require('../../tools/core-tool-normalizers');
        sections.push(args?.debug === true
          ? `STRUCTURED MEMORY INDEX (raw):\n${compactMemorySearchResult(outcome.value)}`
          : `STRUCTURED MEMORY INDEX (decisions/tasks/proposals; use memory_read_record with id for detail):\n${formatStructuredMemoryHits(outcome.value)}`);
      } catch (err: any) {
        sections.push(`STRUCTURED MEMORY INDEX: ${String(err?.message || err)}`);
      }
    } else {
      sections.push(`STRUCTURED MEMORY INDEX: ${outcome.error}`);
    }
  }
  return { name, args, result: sections.join('\n\n'), error: false };
}

export const memoryCapabilityExecutor: CapabilityExecutor = {
  id: 'memory',

  canHandle(name: string): boolean {
    return MEMORY_TOOL_NAMES.has(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, workspacePath, sessionId } = ctx;

    // Keep one compact model-facing memory surface while retaining the
    // existing handlers as internal compatibility implementations. The
    // wrapper deliberately delegates so validation, actor scoping, indexing,
    // and result formatting stay identical across old and new call paths.
    if (name === 'memory') {
      const action = String(args?.action || '').trim().toLowerCase();
      if (action === 'search' || action === 'recall') {
        return runUnifiedRecall(ctx, action === 'recall');
      }
      if (action === 'ideas') {
        try {
          const { listRecallIdeas } = require('../../memory-index/recall-index');
          const ideas = listRecallIdeas(workspacePath, Number(args?.limit || 20));
          const body = ideas.length
            ? ideas.map((i: any) => `- ${i.ts ? new Date(i.ts).toISOString().slice(0, 10) : 'undated'} [${i.sessionId}] ${i.text}`).join('\n')
            : 'No captured ideas yet (index may still be backfilling).';
          return { name, args, result: `Captured ideas (newest first):\n${body}`, error: false };
        } catch (err: any) {
          return { name, args, result: `memory(action="ideas") failed: ${String(err?.message || err)}`, error: true };
        }
      }
      const delegateName = action === 'write'
        ? 'memory_write'
        : action === 'update'
          ? 'memory_update'
          : action === 'delete'
            ? 'memory_delete'
            : action === 'read'
              ? 'memory_read'
              : action === 'search'
                ? 'memory_search'
                : '';
      if (!delegateName) {
        return {
          name,
          args,
          result: 'memory: action must be "write", "update", "read", or "search"',
          error: true,
        };
      }
      const delegated = await memoryCapabilityExecutor.execute({ ...ctx, name: delegateName });
      const result = delegated.result.replace(new RegExp(`^${delegateName}`), `memory(action="${action}")`);
      return { ...delegated, name, args, result };
    }

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

      case 'memory_browse': {
        const { key, filename } = resolveMemoryFile(args.file);
        const primaryPath = path.join(workspacePath, filename);
        let memoryPath = '';
        try { memoryPath = resolveMemoryPath(workspacePath, filename, sessionId); }
        catch (err: any) { return { name, args, result: `memory_browse blocked: ${String(err?.message || err)}`, error: true }; }
        if (!fs.existsSync(memoryPath)) {
          return { name, args, result: `${filename} not found at ${primaryPath} or ${memoryPath}. Create it first.`, error: true };
        }
        const content = fs.readFileSync(memoryPath, 'utf-8');
        const matches = content.match(/^## (.+)/gm) || [];
        const categories = matches.map((m: string) => m.replace(/^## /, '').trim());
        if (categories.length === 0) {
          return { name, args, result: `${filename} has no categories yet. Use memory(action="write") to create the first one.`, error: false };
        }
        return {
          name,
          args,
          result: `${filename} categories:\n${categories.map((c: string) => `- ${c}`).join('\n')}\n\nUse memory(action="write", file="${key}", category="<name>", content="...") to add a fact.`,
          error: false,
        };
      }

      case 'memory_write': {
        const { filename } = resolveMemoryFile(args.file);
        const category = normalizeMemoryCategory(args.category);
        const content = String(args.content || '').trim();
        if (!category) return { name, args, result: 'memory_write: category is required', error: true };
        if (!content) return { name, args, result: 'memory_write: content is required', error: true };
        if (/\r?\n\s*-\s+/.test(content)) return { name, args, result: 'memory_write: content must be one bullet; multiline bullet injection is not allowed', error: true };
        let memoryPath = '';
        try { memoryPath = resolveMemoryPath(workspacePath, filename, sessionId); }
        catch (err: any) { return { name, args, result: `memory_write blocked: ${String(err?.message || err)}`, error: true }; }
        if (!fs.existsSync(memoryPath)) {
          fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
          fs.writeFileSync(memoryPath, `# ${filename}\n\n---\n`, 'utf-8');
        }
        const today = new Date().toISOString().split('T')[0];
        const migrated = migrateMemoryContent(fs.readFileSync(memoryPath, 'utf-8'));
        const write = writeMemoryFact(migrated.content, category, content, today);
        const archived = [...migrated.archived];
        for (const old of write.superseded) {
          archived.push(`- ${old.id ? `[m:${old.id}] ` : ''}${old.text} [archived ${today}: superseded by m:${write.id}]`);
          for (const child of (old.lines || []).slice(1)) archived.push(child);
        }
        { const commitErr = commitMemoryFile(memoryPath, write.content, archived); if (commitErr) return { name, args, result: `memory_write failed; ${filename} unchanged: ${commitErr}`, error: true }; }
        if (filename === 'MEMORY.md') invalidateMemoryAtomSnapshot(path.dirname(memoryPath));
        // Do not leave a stale active row retrievable after a contradiction or poison write.
        await refreshMemoryIndexInWorker(path.dirname(memoryPath), { force: true, minIntervalMs: 0, maxChangedFiles: 500, syncSqlite: true });
        const actor = getRuntimeActorContext(sessionId);
        const scope = actor?.kind === 'agent' || actor?.kind === 'manager' ? `${actor.kind}:${actor.agentId || 'unknown'}` : 'main';
        const supersededNote = write.supersededCount
          ? ` Superseded ${write.supersededCount} conflicting older fact${write.supersededCount === 1 ? '' : 's'} (${write.superseded.map((old) => `${old.id ? `m:${old.id}` : 'unassigned'}`).join(', ')}); archived to ${archivePathLabel(filename)}.`
          : '';
        const duplicates = write.nearDuplicates.length
          ? ` Possible duplicates: ${write.nearDuplicates.map((dup) => `[m:${dup.id || '?'}] (${dup.category}) ${dup.text}`).join('; ')}. If one of these is the same fact, call memory update with its id instead, or delete it.`
          : '';
        const quarantine = write.flaggedAsUntrusted ? ' Flagged as untrusted instruction-like content; retained but excluded from recall.' : '';
        return { name, args, result: `Written to ${scope} ${filename} [${category}] id m:${write.id}: ${content}.${supersededNote}${duplicates}${quarantine}`, error: false };
      }

      case 'memory_update': {
        const { filename } = resolveMemoryFile(args.file);
        const idArg = normalizeBulletIdArg(String(args.id || ''));
        const category = normalizeMemoryCategory(args.category);
        const previousContent = String(args.previous_content || '').trim();
        const content = String(args.content || '').trim();
        if (!idArg && !category) return { name, args, result: 'memory_update: category is required (or pass id)', error: true };
        if (!idArg && !previousContent) return { name, args, result: 'memory_update: previous_content is required (or pass id)', error: true };
        if (!content) return { name, args, result: 'memory_update: content is required', error: true };
        if (/\r?\n\s*-\s+/.test(content)) return { name, args, result: 'memory_update: content must be one bullet; multiline bullet injection is not allowed', error: true };
        let memoryPath = '';
        try { memoryPath = resolveMemoryPath(workspacePath, filename, sessionId); }
        catch (err: any) { return { name, args, result: `memory_update blocked: ${String(err?.message || err)}`, error: true }; }
        if (!fs.existsSync(memoryPath)) return { name, args, result: `memory_update: ${filename} not found at ${memoryPath}`, error: true };

        const today = new Date().toISOString().split('T')[0];
        const migrated = migrateMemoryContent(fs.readFileSync(memoryPath, 'utf-8'));
        const archived = [...migrated.archived];
        const fileContent = migrated.content;
        let targetId = idArg;
        if (!targetId) {
          // Back-compat: exact text match (ignoring any [m:id] token the model copied from read output).
          const section = findMemoryCategorySection(fileContent, category);
          if (!section) return { name, args, result: `memory_update: category ${category} was not found in ${filename}`, error: true };
          // Tolerate a copied id or [m:id] prefix in previous_content (back-compat for old copies).
          const cleanedPrevious = previousContent.replace(BULLET_ID_RE, '').replace(/^\[m:[a-z0-9]{4,8}\]\s*/i, '').trim();
          const target = `- ${cleanedPrevious}`;
          const hits = fileContent.slice(section.bodyStart, section.end).split(/\r?\n/).filter((line) => {
            const bare = line.trim().replace(BULLET_ID_RE, '').replace(/^-\s*\[m:[a-z0-9]{4,8}\]\s*/i, '- ').trim();
            return bare === target;
          });
          if (hits.length !== 1) {
            return { name, args, result: `memory_update: expected exactly one exact bullet match in ${filename} [${section.heading}], found ${hits.length}`, error: true };
          }
          targetId = hits[0].match(BULLET_ID_RE)?.[1] || '';
        }
        const found = targetId ? findMemoryBulletById(fileContent, targetId) : null;
        if (!found) {
          return { name, args, result: `memory_update: no bullet with id m:${targetId || idArg} in ${filename}. Call memory read to see current ids.`, error: true };
        }
        const poisoned = isPoisonMemoryFact(content);
        const actor = getRuntimeActorContext(sessionId);
        const scope = actor?.kind === 'agent' || actor?.kind === 'manager' ? `${actor.kind}:${actor.agentId || 'unknown'}` : 'main';
        if (poisoned) {
          // A poisoned candidate is retained and flagged; it never displaces the existing bullet.
          const write = writeMemoryFact(fileContent, found.category, content, today);
          { const commitErr = commitMemoryFile(memoryPath, write.content, archived); if (commitErr) return { name, args, result: `memory_update failed; ${filename} unchanged: ${commitErr}`, error: true }; }
          if (filename === 'MEMORY.md') invalidateMemoryAtomSnapshot(path.dirname(memoryPath));
          await refreshMemoryIndexInWorker(path.dirname(memoryPath), { force: true, minIntervalMs: 0, maxChangedFiles: 500, syncSqlite: true });
          return { name, args, result: `Updated ${scope} ${filename} [${found.category}] m:${targetId}: kept "${found.text}". Candidate was flagged as untrusted instruction-like content and was not allowed to supersede the existing fact.`, error: false };
        }
        // Same id, same line position: replace in place and archive the old text.
        const replaced = replaceMemoryBulletById(fileContent, targetId, content, today);
        archived.push(`- [m:${targetId}] ${found.text} [archived ${today}: replaced by m:${targetId}]`);
        for (const child of (replaced.previousLines || []).slice(1)) archived.push(child);
        // Same supersede rule as write: other category bullets that conflict with the new text are archived too.
        const swept = supersedeSectionConflicts(replaced.content, found.category, content, targetId);
        for (const old of swept.superseded) {
          archived.push(`- ${old.id ? `[m:${old.id}] ` : ''}${old.text} [archived ${today}: superseded by m:${targetId}]`);
          for (const child of old.lines.slice(1)) archived.push(child);
        }
        { const commitErr = commitMemoryFile(memoryPath, swept.content, archived); if (commitErr) return { name, args, result: `memory_update failed; ${filename} unchanged: ${commitErr}`, error: true }; }
        if (filename === 'MEMORY.md') invalidateMemoryAtomSnapshot(path.dirname(memoryPath));
        await refreshMemoryIndexInWorker(path.dirname(memoryPath), { force: true, minIntervalMs: 0, maxChangedFiles: 500, syncSqlite: true });
        return { name, args, result: `Updated ${scope} ${filename} [${found.category}] m:${targetId}: ${found.text} -> ${content}.`, error: false };
      }
      case 'memory_delete': {
        const { filename } = resolveMemoryFile(args.file);
        const idArg = normalizeBulletIdArg(String(args.id || ''));
        const category = normalizeMemoryCategory(args.category);
        const content = String(args.content || args.previous_content || '').trim();
        if (!idArg && !category) return { name, args, result: 'memory_delete: category is required (or pass id)', error: true };
        if (!idArg && !content) return { name, args, result: 'memory_delete: content is required (or pass id)', error: true };
        let memoryPath = '';
        try { memoryPath = resolveMemoryPath(workspacePath, filename, sessionId); }
        catch (err: any) { return { name, args, result: `memory_delete blocked: ${String(err?.message || err)}`, error: true }; }
        if (!fs.existsSync(memoryPath)) return { name, args, result: `memory_delete: ${filename} not found at ${memoryPath}`, error: true };
        const today = new Date().toISOString().split('T')[0];
        const migrated = migrateMemoryContent(fs.readFileSync(memoryPath, 'utf-8'));
        const archived = [...migrated.archived];
        let next = migrated.content;
        let label = '';
        if (idArg) {
          const removed = removeMemoryBulletById(next, idArg);
          if (removed.removed === undefined) return { name, args, result: `memory_delete: no bullet with id m:${idArg} in ${filename}. Call memory read to see current ids.`, error: true };
          next = removed.content;
          archived.push(`- [m:${idArg}] ${removed.removed} [archived ${today}: deleted]`);
          for (const child of (removed.removedLines || []).slice(1)) archived.push(child);
          label = `m:${idArg} [${removed.category}]: ${removed.removed}`;
        } else {
          const deleted = deleteMemoryFact(next, category, content);
          if (!deleted.deleted) return { name, args, result: `memory_delete: expected exactly one exact bullet match in ${filename} [${category}]`, error: true };
          next = deleted.content;
          archived.push(`- ${deleted.id ? `[m:${deleted.id}] ` : ''}${deleted.removed} [archived ${today}: deleted]`);
          for (const child of (deleted.removedLines || []).slice(1)) archived.push(child);
          label = `[${category}]: ${content}`;
        }
        { const commitErr = commitMemoryFile(memoryPath, next, archived); if (commitErr) return { name, args, result: `memory_delete failed; ${filename} unchanged: ${commitErr}`, error: true }; }
        if (filename === 'MEMORY.md') invalidateMemoryAtomSnapshot(path.dirname(memoryPath));
        await refreshMemoryIndexInWorker(path.dirname(memoryPath), { force: true, minIntervalMs: 0, maxChangedFiles: 500, syncSqlite: true });
        return { name, args, result: `Deleted from ${filename} ${label}. Removed from the refreshed retrieval index.`, error: false };
      }

      case 'memory_read': {
        const { filename } = resolveMemoryFile(args.file);
        let memoryPath = '';
        try { memoryPath = resolveMemoryPath(workspacePath, filename, sessionId); }
        catch (err: any) { return { name, args, result: `memory_read blocked: ${String(err?.message || err)}`, error: true }; }
        if (!fs.existsSync(memoryPath)) return { name, args, result: `${filename} not found at ${memoryPath}`, error: true };
        const raw = fs.readFileSync(memoryPath, 'utf-8');
        const migrated = migrateMemoryContent(raw);
        if (migrated.content !== raw || migrated.archived.length) { const commitErr = commitMemoryFile(memoryPath, migrated.content, migrated.archived); if (commitErr) return { name, args, result: `memory_read: could not write migrated ${filename}: ${commitErr}`, error: true }; await refreshMemoryIndexInWorker(path.dirname(memoryPath), { force: true, minIntervalMs: 0, maxChangedFiles: 500, syncSqlite: true }); }
        return { name, args, result: renderMemoryIdsForPrompt(migrated.content), error: false };
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
          const params = {
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
          };
          if (ctx.deps.abortSignal?.aborted || ctx.deps.abortSignal?.signal?.aborted) {
            return { name, args, result: 'memory_search cancelled before execution', error: true };
          }
          const result = await searchMemoryInWorker(
            'memory_search',
            { workspacePath, params },
            { signal: ctx.deps.abortSignal?.signal },
          );
          return { name, args, result: compactMemorySearchResult(result, { debug: params.debug }), error: false };
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
          if (ctx.deps.abortSignal?.aborted || ctx.deps.abortSignal?.signal?.aborted) {
            return { name, args, result: 'memory_search_project cancelled before execution', error: true };
          }
          const result = await searchMemoryInWorker('memory_search_project', {
            workspacePath,
            projectId,
            query,
            limit: Number(args.limit || 10),
          }, { signal: ctx.deps.abortSignal?.signal });
          return { name, args, result: compactMemorySearchResult(result), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_search_project failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_search_timeline': {
        try {
          const query = String(args.query || '').trim();
          if (!query) return { name, args, result: 'memory_search_timeline: query is required', error: true };
          if (ctx.deps.abortSignal?.aborted || ctx.deps.abortSignal?.signal?.aborted) {
            return { name, args, result: 'memory_search_timeline cancelled before execution', error: true };
          }
          const dateFrom = args.date_from ? String(args.date_from) : undefined;
          const dateTo = args.date_to ? String(args.date_to) : undefined;
          const limit = Number(args.limit || 20);
          const result = await searchMemoryInWorker('memory_search_timeline', {
            workspacePath,
            query,
            dateFrom,
            dateTo,
            limit,
          }, { signal: ctx.deps.abortSignal?.signal });
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
          return { name, args, result: JSON.stringify(getMemoryGraphSnapshot(workspacePath), null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_graph_snapshot failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_index_refresh': {
        try {
          const out = await refreshMemoryIndexInWorker(workspacePath, { force: true, maxChangedFiles: 500, minIntervalMs: 0, syncSqlite: true });
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
          const out = await backfillMemoryEmbeddingsInWorker(workspacePath, {
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
          const result = await searchMemoryInWorker('memory_search', {
            workspacePath,
            params: {
              query,
              mode: (['quick', 'deep', 'project', 'timeline'].includes(String(args.mode || 'quick')) ? String(args.mode || 'quick') : 'quick') as any,
              limit: Number(args.limit || 12),
              projectId: args.project_id ? String(args.project_id) : undefined,
              debug: true,
              rerank: args.rerank !== false,
              queryRoute: 'debug_tool',
            },
          }, { signal: ctx.deps.abortSignal?.signal });
          return { name, args, result, error: false };
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
        let noteWriteResult: any = null;

        try {
          const sourceLine = formatIntradayNoteSourceLine(inferIntradayNoteSource(sessionId, args));
          const noteWrite = require('../../memory/intraday-notes').appendIntradayNote(workspacePath, {
            tag: noteTag, content: noteContent, sourceLine, taskId: noteTaskId,
            status: args.status, resolves: args.resolves, thread: args.thread,
          });
          noteWriteResult = noteWrite;
          try { require('../../memory-index/recall-index').markRecallDirty(workspacePath, noteWrite.file, 500); } catch { /* best-effort */ }
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

        return { name, args, result: `Note saved [${noteTag}] (${noteContent.length} chars) -> intraday-notes${noteWriteResult?.deduped ? ' (duplicate of #' + noteWriteResult.id + ' within 10 min, not re-written)' : noteWriteResult?.id ? ' #' + noteWriteResult.id + ' (' + noteWriteResult.status + ')' : ''}${noteWriteResult?.resolved?.length ? ' resolved: ' + noteWriteResult.resolved.join(', ') : ''}${noteWriteResult?.unresolved?.length ? ' not found: ' + noteWriteResult.unresolved.join(', ') : ''}`, error: false };
      }

      default:
        return { name, args, result: `Unhandled memory tool: ${name}`, error: true };
    }
  },
};
