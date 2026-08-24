import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildThoughtActivityPackage } from './activity-package';
import {
  buildThoughtActivityPackageIsolated,
  getBrainActivityWorkerStatus,
  shutdownBrainActivityWorker,
} from './activity-package-worker-client';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const now = new Date();
  fs.utimesSync(filePath, now, now);
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8');
  const now = new Date();
  fs.utimesSync(filePath, now, now);
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-thought-package-'));
  try {
    const configDir = path.join(root, '.prometheus');
    const workspacePath = path.join(root, 'workspace');
    const start = Date.parse('2026-08-01T16:00:00.000Z');
    const end = Date.parse('2026-08-01T22:00:00.000Z');
    const atStart = '2026-08-01T12:00:00.000-04:00';
    const inWindow = '2026-08-01T18:30:00.000Z';
    const atEnd = '2026-08-01T22:00:00.000Z';

    writeJson(path.join(configDir, 'sessions', 'chat.json'), {
      id: 'chat-1',
      createdAt: atStart,
      history: [
        { messageId: 'm-start', role: 'user', content: 'boundary included', timestamp: atStart },
        { messageId: 'm-in', role: 'assistant', content: 'inside window', timestamp: inWindow },
        { messageId: 'm-end', role: 'user', content: 'boundary excluded', timestamp: atEnd },
      ],
    });
    writeJson(path.join(configDir, 'tasks', 'task-1.json'), {
      id: 'task-1', title: 'Unfinished task', status: 'running', startedAt: inWindow,
      journal: [
        { type: 'status_push', content: 'started', t: inWindow },
        { type: 'status_push', content: 'outside', t: atEnd },
      ],
    });
    fs.mkdirSync(path.join(configDir, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'tasks', 'bad.json'), '{ invalid json\n', 'utf8');
    fs.utimesSync(path.join(configDir, 'tasks', 'bad.json'), new Date(), new Date());
    writeJsonl(path.join(configDir, 'tool-observations', 'chat.jsonl'), [
      { id: 'obs-1', sessionId: 'chat-1', toolName: 'terminal', status: 'error', resultPreview: 'api_key=topsecret token=abc123', createdAt: inWindow },
      ...Array.from({ length: 700 }, (_, index) => ({ id: `obs-${index + 2}`, toolName: 'read_file', status: 'ok', resultPreview: `event-${index}`, createdAt: inWindow })),
    ]);
    // Same message ID/time/type as the session record: it must dedupe while
    // retaining both provenance refs.
    writeJsonl(path.join(configDir, 'audit-log.jsonl'), [
      { messageId: 'm-in', role: 'assistant', type: 'assistant', content: 'inside window', timestamp: inWindow },
      { id: 'audit-error', type: 'error', error: 'tool failed', timestamp: inWindow },
    ]);
    writeJson(path.join(configDir, 'cron', 'runs', 'job.json'), { runId: 'run-1', status: 'failed', startedAt: inWindow, error: 'failure' });
    writeJson(path.join(configDir, 'browser-sessions.json'), [{ sessionId: 'browser-1', url: 'https://example.test/path?token=secret', title: 'Example', updatedAt: inWindow }]);
    writeJson(path.join(configDir, 'managed-teams.json'), { id: 'team-1', updatedAt: inWindow, teamChat: [{ id: 'team-msg-1', role: 'manager', content: 'team update', timestamp: inWindow }] });
    writeJson(path.join(configDir, 'runtimes', 'runtime.json'), { id: 'runtime-1', kind: 'background_task', status: 'completed', startedAt: inWindow });
    writeJson(path.join(configDir, 'config.json'), { updatedAt: inWindow, agents: [{ id: 'agent-1', updatedAt: inWindow, name: 'worker' }] });
    writeJson(path.join(workspacePath, '.prometheus', 'history', 'checkpoint.json'), { id: 'checkpoint-1', type: 'file_change', createdAt: inWindow, pathsTouched: ['notes.md'] });
    writeJson(path.join(workspacePath, 'Brain', 'active-work.jsonl'), { id: 'work-1', status: 'in_progress', title: 'Continue this', updatedAt: inWindow });
    writeJson(path.join(workspacePath, 'events', 'important.json'), { id: 'important-1', type: 'important', occurredAt: inWindow, summary: 'important event' });
    writeJson(path.join(root, 'vault', 'secret.json'), { token: 'must not be read' });

    const options = { configDir, workspacePath, repoRoot: root, start, end, outputDir: path.join(workspacePath, 'Brain', 'activity-packages', '2026-08-01', '16-00') };
    const built = await buildThoughtActivityPackage(options);
    const pkg = built.package;
    assert.equal(pkg.window.start, '2026-08-01T16:00:00.000Z');
    assert.equal(pkg.window.end, '2026-08-01T22:00:00.000Z');
    assert.equal(pkg.window.boundary, '[start,end)');
    assert(pkg.counts['chat_sessions.timestamp'] >= 1, 'chat event at timezone-normalized start should be included');
    assert(!pkg.eventLedger.inline.some((event) => event.entity?.sessionId === 'chat-1' && event.summary.includes('boundary excluded')));
    assert(pkg.eventLedger.totalEvents > 600, 'all synthetic events should be discovered');
    assert(pkg.eventLedger.continuations.length > 0, 'oversized package should create direct continuations');
    assert.equal(pkg.completeness.directContextRule, 'do_not_search_covered_activity');

    const isolated = await buildThoughtActivityPackageIsolated({
      ...options,
      outputDir: path.join(workspacePath, 'Brain', 'activity-packages', '2026-08-01', 'isolated'),
    });
    assert.equal(isolated.package.packageId, pkg.packageId, 'child-process activity assembly must remain deterministic');
    assert.ok(isolated.packagePath, 'child-process activity assembly must hand back the package artifact path');
    assert.equal(
      JSON.parse(fs.readFileSync(isolated.packagePath!, 'utf8')).packageId,
      pkg.packageId,
      'the worker result should be read from the persisted package artifact',
    );
    assert.equal(getBrainActivityWorkerStatus().isolation, 'child_process');
    assert(Number(getBrainActivityWorkerStatus().broker.resource?.pid || 0) > 0, 'activity assembly must run in a child process');
    const retirementDeadline = Date.now() + 3_000;
    while (getBrainActivityWorkerStatus().broker.state !== 'stopped' && Date.now() < retirementDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(getBrainActivityWorkerStatus().broker.state, 'stopped', 'Brain activity workers should retire after a package build');
    assert(pkg.unresolvedWork.some((item) => item.id === 'id:task-1'), 'running task should be listed as unresolved');
    assert(pkg.sourceCoverage.some((source) => source.source === 'tasks' && source.status === 'partial'), 'invalid source data should be visible as partial');
    const dateInput = await buildThoughtActivityPackage({
      ...options,
      start: new Date(start),
      end: new Date(end),
      outputDir: path.join(workspacePath, 'Brain', 'activity-packages', 'date-input'),
    });
    assert.equal(dateInput.package.packageId, pkg.packageId, 'Date inputs must normalize identically to epoch inputs');
    const toolEvent = [...pkg.eventLedger.inline, ...pkg.eventLedger.continuations.flatMap(() => [])].find((event) => event.entity?.sessionId === 'chat-1' && event.type.startsWith('tool_calls.'));
    if (toolEvent) {
      const text = JSON.stringify(toolEvent);
      assert(!text.includes('topsecret') && !text.includes('abc123'), 'tool payload secrets must be redacted');
    }
    const deduped = [...pkg.eventLedger.inline].filter((event) => event.provenance.some((ref) => ref.recordId === 'messageId:m-in'));
    assert(deduped.length <= 1, 'duplicate message records must have one event identity');
    const continuationEvents = built.continuationPaths.flatMap((filePath) => fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
    const allEvents = [...pkg.eventLedger.inline, ...continuationEvents];
    for (const source of ['chat_sessions', 'tasks', 'tool_calls', 'runs_and_schedules', 'managed_threads_and_teams', 'browser', 'files_and_workspace_changes', 'agents_and_subagents', 'runtime_and_errors', 'important_events_and_unresolved']) {
      assert(allEvents.some((event) => event.type.startsWith(`${source}.`)), `expected ${source} event coverage`);
    }

    const [again, concurrent] = await Promise.all([
      buildThoughtActivityPackage(options),
      buildThoughtActivityPackage(options),
    ]);
    assert.equal(again.package.packageId, pkg.packageId, 'same stores/window must produce deterministic package ID');
    assert.equal(concurrent.package.packageId, pkg.packageId, 'concurrent builders must be deterministic');
    const rerunContinuationEvents = pkg.eventLedger.continuations.flatMap((entry) => {
      const filePath = path.join(workspacePath, entry.path);
      const rows = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      assert.equal(rows.length, entry.eventCount, `continuation ${entry.path} must be a snapshot, not an append-only rerun journal`);
      assert.equal(new Set(rows.map((row: any) => row.id)).size, rows.length, `continuation ${entry.path} must not duplicate event ids after reruns`);
      return rows;
    });
    assert.equal(
      rerunContinuationEvents.length,
      pkg.eventLedger.totalEvents - pkg.eventLedger.inline.length,
      'rerunning the same window must not grow continuation contents',
    );
    console.log('activity-package regression passed', JSON.stringify({
      events: pkg.eventLedger.totalEvents,
      continuations: pkg.eventLedger.continuations.length,
      duplicates: pkg.metrics.duplicateEvents,
      latencyMs: pkg.metrics.assemblyLatencyMs,
      packageChars: pkg.metrics.packageChars,
    }));
  } finally {
    await shutdownBrainActivityWorker();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
