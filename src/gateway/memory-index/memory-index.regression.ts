import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getRelatedMemory, readMemoryRecord, scheduleMemoryIndexRefresh, searchMemoryIndex } from './index.js';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function operationalId(canonicalKey: string): string {
  return `opr_${crypto.createHash('sha1').update(canonicalKey).digest('hex').slice(0, 16)}`;
}

function makeOperationalRecord(input: {
  canonicalKey: string;
  title: string;
  summary: string;
  body: string;
  recordType?: string;
  projectId?: string | null;
  tags?: string[];
  exactTerms?: string[];
  relatedIds?: string[];
  sourcePath?: string;
  sourceType?: string;
  day?: string;
}) {
  const canonicalKey = input.canonicalKey;
  return {
    id: operationalId(canonicalKey),
    canonicalKey,
    recordType: input.recordType || 'decision',
    title: input.title,
    summary: input.summary,
    body: input.body,
    createdAt: `${input.day || '2026-04-22'}T09:00:00.000Z`,
    updatedAt: `${input.day || '2026-04-22'}T10:00:00.000Z`,
    day: input.day || '2026-04-22',
    sourceRefs: [{
      sourceType: input.sourceType || 'memory_root',
      sourcePath: input.sourcePath || 'memory/root/MEMORY.md',
      confidence: 1,
    }],
    entities: {
      people: [],
      projects: input.projectId ? [input.projectId] : [],
      features: [],
      files: [],
      tools: ['memory_search'],
      aliases: [],
    },
    projectId: input.projectId ?? null,
    sessionIds: [],
    confidence: 0.98,
    durability: 1,
    supersedes: [],
    supersededBy: [],
    relatedIds: input.relatedIds || [],
    exactTerms: input.exactTerms || [],
    tags: input.tags || [],
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function main(): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-memory-regression-'));
  try {
    const workspaceA = path.join(tmpRoot, 'workspace-a');
    const opRoot = path.join(workspaceA, 'audit', '_index', 'memory', 'operational');
    const base = makeOperationalRecord({
      canonicalKey: 'decision:root:key_decisions:command_approvals',
      title: 'Command approval policy',
      summary: 'User wants command approvals preserved for high-risk shell actions.',
      body: 'Approvals stay enabled for destructive or privileged commands.',
      projectId: 'prometheus-memory',
      tags: ['memory_root', 'decision', 'approval'],
      exactTerms: ['command', 'approvals', 'preserved'],
    });
    const related = makeOperationalRecord({
      canonicalKey: 'workflow_rule:root:approval_follow_up',
      title: 'Approval follow-up workflow',
      summary: 'When approvals are needed, explain the reason and ask once.',
      body: 'Approval-related prompts should stay consistent across tool and API paths.',
      recordType: 'workflow_rule',
      projectId: 'prometheus-memory',
      tags: ['workflow_rule', 'approval'],
      exactTerms: ['approvals', 'api', 'paths'],
      relatedIds: [base.id],
    });

    writeJson(path.join(opRoot, 'records.json'), {
      version: 1,
      updatedAt: '2026-04-22T10:00:00.000Z',
      records: {
        [base.id]: base,
        [related.id]: related,
      },
    });
    writeJson(path.join(opRoot, 'exact-lookup.json'), {
      [base.id]: base.id,
      [base.canonicalKey]: base.id,
      [related.id]: related.id,
      [related.canonicalKey]: related.id,
    });
    writeJson(path.join(opRoot, 'token-index.json'), {});
    writeJson(path.join(opRoot, 'embeddings.json'), {});
    writeJson(path.join(opRoot, 'manifest.json'), {
      version: 1,
      updatedAt: '2026-04-22T10:00:00.000Z',
      lastRunAtMs: Date.now(),
    });

    const resolved = readMemoryRecord(workspaceA, base.id);
    assert.equal(resolved.layer, 'operational');
    assert.equal(resolved.record?.id, base.id);
    assert.equal(resolved.record?.sourcePath, 'memory/root/MEMORY.md');
    assert.ok(Array.isArray(resolved.chunks) && resolved.chunks.length > 0, 'operational records should expose synthetic chunks');

    const relatedHits = getRelatedMemory(workspaceA, base.id, 5);
    assert.ok(relatedHits.some((hit) => hit.recordId === related.id), 'operational related lookup should return related opr_* records');

    const searchHits = searchMemoryIndex(workspaceA, { query: 'command approvals', limit: 5 }).hits;
    assert.ok(searchHits.some((hit) => hit.recordId === base.id && hit.layer === 'operational'), 'memory_search should still surface operational hits from cached snapshots');
    const operationalHit = searchHits.find((hit) => hit.recordId === base.id);
    assert.equal(operationalHit?.citation?.sourcePath, 'memory/root/MEMORY.md');
    assert.equal(operationalHit?.citation?.authority, 'durable_memory_file');

    const workspaceB = path.join(tmpRoot, 'workspace-b');
    const auditRoot = path.join(workspaceB, 'audit', 'memory', 'root');
    fs.mkdirSync(auditRoot, { recursive: true });
    fs.writeFileSync(
      path.join(auditRoot, 'MEMORY.md'),
      '# MEMORY\n\n## Key Decisions\n- Preserve command approvals for risky shell actions.\n',
      'utf-8',
    );

    const storePath = path.join(workspaceB, 'audit', '_index', 'memory', 'store.json');
    assert.equal(fs.existsSync(storePath), false);
    const hotPathResult = searchMemoryIndex(workspaceB, { query: 'command approvals', limit: 5 });
    assert.ok(Array.isArray(hotPathResult.hits), 'search should return immediately even before refresh finishes');
    assert.ok(typeof hotPathResult.stats.backend === 'string' || hotPathResult.stats.backend === undefined, 'search result may identify the active backend');
    assert.equal(fs.existsSync(storePath), false, 'hot-path search must not synchronously build the evidence store');

    await waitFor(() => fs.existsSync(storePath));
    scheduleMemoryIndexRefresh(workspaceB, { minIntervalMs: 0, maxChangedFiles: 500 });
    await waitFor(() => {
      try {
        const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
        return Object.keys(parsed.records || {}).length > 0;
      } catch {
        return false;
      }
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('memory-index regression checks passed');
}).catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exitCode = 1;
});
