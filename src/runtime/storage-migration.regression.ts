import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePrometheusLayout } from './storage-layout.js';
import { discoverStorageMigrationCandidates, executeStorageLayoutV2Migration, rewriteMigratedConfigPaths } from './storage-migration.js';

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function layoutFor(root: string, workspaceOverride?: string) {
  return resolvePrometheusLayout({
    env: {
      PROMETHEUS_DATA_DIR: path.join(root, 'appdata', 'Prometheus'),
      PROMETHEUS_STORAGE_LAYOUT: 'canonical',
      ...(workspaceOverride ? { PROMETHEUS_WORKSPACE_DIR: workspaceOverride } : {}),
    },
    platform: process.platform,
    homedir: path.join(root, 'home'),
    cwd: path.join(root, 'repo'),
    existsSync: fs.existsSync,
  });
}

function createDirectoryLink(target: string, link: string): void {
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function run(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-storage-migration-'));
  try {
    const normalRoot = path.join(root, 'normal');
    const sourceConfig = path.join(normalRoot, 'repo', '.prometheus');
    const sourceWorkspace = path.join(normalRoot, 'repo', 'workspace');
    const externalRepo = path.join(normalRoot, 'external-repo');
    const layout = layoutFor(normalRoot);

    write(path.join(sourceConfig, 'sessions', 's1.json'), '{"id":"s1"}\n');
    write(path.join(sourceConfig, 'tool-observations', 's1', 'o1.txt'), 'tool result\n');
    write(path.join(sourceConfig, 'skills', 'research', 'SKILL.md'), '# Research\n');
    write(path.join(sourceConfig, 'skill-state', 'lock.json'), '{"skills":[]}\n');
    write(path.join(sourceConfig, 'memory', 'index.json'), '{"memory":true}\n');
    write(path.join(sourceConfig, 'agents', 'researcher', 'workspace', 'MEMORY.md'), '# agent memory\n');
    write(path.join(sourceConfig, 'managed-teams.json'), '{"teams":[]}\n');
    write(path.join(sourceConfig, 'connections.json'), '{"connections":[]}\n');
    write(path.join(sourceConfig, 'jobs.db'), 'jobs-db\n');
    write(path.join(sourceWorkspace, 'USER.md'), '# User\n');
    write(path.join(sourceWorkspace, 'projects', 'alpha', 'CONTEXT.md'), '# Alpha\n');
    fs.mkdirSync(externalRepo, { recursive: true });

    const sourceConfigJson = {
      workspace: { path: sourceWorkspace },
      skills: { directory: path.join(sourceConfig, 'skills') },
      memory: { path: path.join(sourceConfig, 'memory') },
      tools: { permissions: { files: { allowed_paths: [sourceWorkspace, externalRepo], blocked_paths: [] } } },
      agents: [{
        id: 'researcher',
        workspace: path.join(sourceConfig, 'agents', 'researcher', 'workspace'),
        executionWorkspace: externalRepo,
        allowedWorkPaths: [sourceWorkspace, externalRepo],
      }],
    };
    write(path.join(sourceConfig, 'config.json'), `${JSON.stringify(sourceConfigJson, null, 2)}\n`);

    const rewritten = rewriteMigratedConfigPaths(sourceConfigJson, sourceConfig, sourceWorkspace, layout);
    assert.equal(rewritten.workspace.path, layout.workspace.root);
    assert.equal(rewritten.skills.directory, layout.workspace.skills);
    assert.equal(rewritten.memory.path, layout.runtime.memoryIndex);
    assert.equal(rewritten.tools.permissions.files.allowed_paths[0], layout.workspace.root);
    assert.equal(rewritten.tools.permissions.files.allowed_paths[1], externalRepo);
    assert.equal(rewritten.agents[0].workspace, path.join(layout.workspace.standaloneSubagents, 'researcher'));
    assert.equal(rewritten.agents[0].executionWorkspace, externalRepo);

    const candidates = discoverStorageMigrationCandidates(layout);
    assert.ok(candidates.every((item) => item.kind === 'config' || item.kind === 'workspace'));
    const retiredNamespace = ['local', 'claw'].join('');
    assert.equal(JSON.stringify(candidates).toLowerCase().includes(retiredNamespace), false, 'first-generation storage namespace must not be a v2 migration candidate');

    const first = executeStorageLayoutV2Migration({
      layout,
      sourceConfigRoot: sourceConfig,
      sourceWorkspaceRoot: sourceWorkspace,
      migrationId: 'regression',
      now: new Date('2026-08-21T12:00:00.000Z'),
    });
    assert.equal(first.preflightRejected, false);
    assert.equal(first.copyVerified, true, JSON.stringify(first, null, 2));
    assert.equal(first.conflicts.length, 0);
    assert.equal(first.errors.length, 0);
    assert.equal(first.rewrittenConfig, true);
    assert.ok(fs.existsSync(path.join(first.backupRoot, 'source-config', 'config.json')));
    assert.ok(fs.existsSync(path.join(first.backupRoot, 'source-workspace', 'USER.md')));
    assert.equal(fs.readFileSync(path.join(layout.runtime.sessions, 's1.json'), 'utf-8'), '{"id":"s1"}\n');
    assert.equal(fs.readFileSync(path.join(layout.runtime.toolObservations, 's1', 'o1.txt'), 'utf-8'), 'tool result\n');
    assert.equal(fs.readFileSync(path.join(layout.workspace.skills, 'research', 'SKILL.md'), 'utf-8'), '# Research\n');
    assert.equal(fs.readFileSync(path.join(layout.runtime.config, 'skills', 'lock.json'), 'utf-8'), '{"skills":[]}\n');
    assert.equal(fs.readFileSync(path.join(layout.workspace.standaloneSubagents, 'researcher', 'MEMORY.md'), 'utf-8'), '# agent memory\n');
    assert.ok(fs.existsSync(path.join(layout.runtime.teams, 'managed-teams.json')));
    assert.ok(fs.existsSync(path.join(layout.runtime.connections, 'connections.json')));
    assert.ok(fs.existsSync(path.join(layout.runtime.cron, 'jobs.db')));
    assert.ok(fs.existsSync(path.join(layout.runtime.migrations, 'storage-layout-v2-copy-verified.json')));
    assert.equal(fs.existsSync(path.join(layout.runtime.migrations, 'storage-layout-v2-ready.json')), false);

    const second = executeStorageLayoutV2Migration({
      layout,
      sourceConfigRoot: sourceConfig,
      sourceWorkspaceRoot: sourceWorkspace,
      migrationId: 'regression',
      now: new Date('2026-08-21T12:05:00.000Z'),
    });
    assert.equal(second.copyVerified, true, JSON.stringify(second, null, 2));
    assert.ok(second.identical.length > 0);

    const conflictTarget = path.join(layout.runtime.sessions, 's2.json');
    write(path.join(sourceConfig, 'sessions', 's2.json'), '{"source":true}\n');
    write(conflictTarget, '{"destination":true}\n');
    const conflict = executeStorageLayoutV2Migration({ layout, sourceConfigRoot: sourceConfig, sourceWorkspaceRoot: sourceWorkspace, migrationId: 'conflict-regression' });
    assert.equal(conflict.copyVerified, false);
    assert.ok(conflict.conflicts.some((item) => item.target === conflictTarget));
    assert.equal(fs.readFileSync(conflictTarget, 'utf-8'), '{"destination":true}\n');
    assert.equal(fs.existsSync(path.join(layout.runtime.migrations, 'storage-layout-v2-copy-verified.json')), false, 'a failed run must clear any stale stable copy marker');

    const linkRoot = path.join(root, 'destination-link');
    const linkConfig = path.join(linkRoot, 'repo', '.prometheus');
    const linkWorkspace = path.join(linkRoot, 'repo', 'workspace');
    const linkLayout = layoutFor(linkRoot);
    write(path.join(linkConfig, 'sessions', 'linked.json'), '{"id":"linked"}\n');
    write(path.join(linkWorkspace, 'USER.md'), '# Link test\n');
    const outside = path.join(linkRoot, 'outside');
    fs.mkdirSync(linkLayout.runtime.root, { recursive: true });
    createDirectoryLink(outside, linkLayout.runtime.sessions);
    const linked = executeStorageLayoutV2Migration({ layout: linkLayout, sourceConfigRoot: linkConfig, sourceWorkspaceRoot: linkWorkspace, migrationId: 'destination-link' });
    assert.equal(linked.copyVerified, false);
    assert.ok(linked.conflicts.some((item) => item.reason === 'destination_symlink'));
    assert.equal(fs.existsSync(path.join(outside, 'linked.json')), false, 'migration must never write through a destination symlink/junction');
    assert.ok(fs.existsSync(path.join(linkLayout.runtime.migrations, 'destination-link', 'manifest.json')), 'non-preflight failures must still emit a manifest');

    const typeRoot = path.join(root, 'directory-conflict');
    const typeConfig = path.join(typeRoot, 'repo', '.prometheus');
    const typeWorkspace = path.join(typeRoot, 'repo', 'workspace');
    const typeLayout = layoutFor(typeRoot);
    write(path.join(typeConfig, 'sessions', 'one.json'), '{}\n');
    write(path.join(typeWorkspace, 'USER.md'), '# Type test\n');
    write(typeLayout.runtime.sessions, 'not a directory\n');
    const typeConflict = executeStorageLayoutV2Migration({ layout: typeLayout, sourceConfigRoot: typeConfig, sourceWorkspaceRoot: typeWorkspace, migrationId: 'directory-conflict' });
    assert.equal(typeConflict.copyVerified, false);
    assert.ok(typeConflict.conflicts.some((item) => item.reason === 'type_mismatch' && item.target === typeLayout.runtime.sessions));
    assert.ok(fs.existsSync(path.join(typeLayout.runtime.migrations, 'directory-conflict', 'manifest.json')), 'directory conflicts must return and persist a failure manifest');

    const overlapRoot = path.join(root, 'overlap');
    const overlapConfig = path.join(overlapRoot, 'repo', '.prometheus');
    const overlapWorkspace = path.join(overlapRoot, 'source-workspace');
    const overlapTarget = path.join(overlapWorkspace, 'canonical-workspace');
    write(path.join(overlapConfig, 'config.json'), '{}\n');
    write(path.join(overlapWorkspace, 'USER.md'), '# Overlap\n');
    const overlapLayout = layoutFor(overlapRoot, overlapTarget);
    const overlap = executeStorageLayoutV2Migration({ layout: overlapLayout, sourceConfigRoot: overlapConfig, sourceWorkspaceRoot: overlapWorkspace, migrationId: 'overlap' });
    assert.equal(overlap.preflightRejected, true);
    assert.equal(overlap.copyVerified, false);
    assert.ok(overlap.errors.some((item) => item.message.includes('overlap')));
    assert.equal(fs.existsSync(overlapTarget), false, 'overlap rejection must occur before creating the target workspace');
    assert.equal(fs.existsSync(overlapLayout.runtime.root), false, 'overlap rejection must occur before creating migration/backup state');

    console.log('storage migration regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
