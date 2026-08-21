import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePrometheusLayout } from './storage-layout.js';
import { executeStorageLayoutV2Migration, rewriteMigratedConfigPaths } from './storage-migration.js';

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function run(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-storage-migration-'));
  const sourceConfig = path.join(root, 'repo', '.prometheus');
  const sourceWorkspace = path.join(root, 'repo', 'workspace');
  const appData = path.join(root, 'appdata', 'Prometheus');
  const externalRepo = path.join(root, 'external-repo');

  try {
    write(path.join(sourceConfig, 'sessions', 's1.json'), '{"id":"s1"}\n');
    write(path.join(sourceConfig, 'tool-observations', 's1', 'o1.txt'), 'tool result\n');
    write(path.join(sourceConfig, 'skills', 'research', 'SKILL.md'), '# Research\n');
    write(path.join(sourceConfig, 'memory', 'index.json'), '{"memory":true}\n');
    write(path.join(sourceConfig, 'agents', 'researcher', 'workspace', 'MEMORY.md'), '# agent memory\n');
    write(path.join(sourceConfig, 'managed-teams.json'), '{"teams":[]}\n');
    write(path.join(sourceWorkspace, 'USER.md'), '# User\n');
    write(path.join(sourceWorkspace, 'projects', 'alpha', 'CONTEXT.md'), '# Alpha\n');
    fs.mkdirSync(externalRepo, { recursive: true });

    const sourceConfigJson = {
      workspace: { path: sourceWorkspace },
      skills: { directory: path.join(sourceConfig, 'skills') },
      memory: { path: path.join(sourceConfig, 'memory') },
      tools: {
        permissions: {
          files: {
            allowed_paths: [sourceWorkspace, externalRepo],
            blocked_paths: [],
          },
        },
      },
      agents: [{
        id: 'researcher',
        workspace: path.join(sourceConfig, 'agents', 'researcher', 'workspace'),
        executionWorkspace: externalRepo,
        allowedWorkPaths: [sourceWorkspace, externalRepo],
      }],
    };
    write(path.join(sourceConfig, 'config.json'), `${JSON.stringify(sourceConfigJson, null, 2)}\n`);

    const layout = resolvePrometheusLayout({
      env: {
        PROMETHEUS_DATA_DIR: appData,
        PROMETHEUS_STORAGE_LAYOUT: 'canonical',
      },
      platform: process.platform,
      homedir: path.join(root, 'home'),
      cwd: path.join(root, 'repo'),
      existsSync: fs.existsSync,
    });

    const rewritten = rewriteMigratedConfigPaths(sourceConfigJson, sourceConfig, sourceWorkspace, layout);
    assert.equal(rewritten.workspace.path, layout.workspace.root);
    assert.equal(rewritten.skills.directory, layout.workspace.skills);
    assert.equal(rewritten.memory.path, layout.runtime.memoryIndex);
    assert.equal(rewritten.tools.permissions.files.allowed_paths[0], layout.workspace.root);
    assert.equal(rewritten.tools.permissions.files.allowed_paths[1], externalRepo);
    assert.equal(rewritten.agents[0].workspace, path.join(layout.workspace.standaloneSubagents, 'researcher'));
    assert.equal(rewritten.agents[0].executionWorkspace, externalRepo);

    const first = executeStorageLayoutV2Migration({
      layout,
      sourceConfigRoot: sourceConfig,
      sourceWorkspaceRoot: sourceWorkspace,
      migrationId: 'regression',
      now: new Date('2026-08-21T12:00:00.000Z'),
    });

    assert.equal(first.readyToActivate, true, JSON.stringify(first, null, 2));
    assert.equal(first.conflicts.length, 0);
    assert.equal(first.errors.length, 0);
    assert.equal(first.rewrittenConfig, true);

    assert.equal(fs.readFileSync(path.join(sourceWorkspace, 'USER.md'), 'utf-8'), '# User\n');
    assert.ok(fs.existsSync(path.join(sourceConfig, 'config.json')), 'source config must remain untouched');
    assert.ok(fs.existsSync(path.join(first.backupRoot, 'source-config', 'config.json')));
    assert.ok(fs.existsSync(path.join(first.backupRoot, 'source-workspace', 'USER.md')));

    assert.equal(fs.readFileSync(path.join(layout.runtime.sessions, 's1.json'), 'utf-8'), '{"id":"s1"}\n');
    assert.equal(fs.readFileSync(path.join(layout.runtime.toolObservations, 's1', 'o1.txt'), 'utf-8'), 'tool result\n');
    assert.equal(fs.readFileSync(path.join(layout.workspace.skills, 'research', 'SKILL.md'), 'utf-8'), '# Research\n');
    assert.equal(fs.readFileSync(path.join(layout.workspace.standaloneSubagents, 'researcher', 'MEMORY.md'), 'utf-8'), '# agent memory\n');
    assert.equal(fs.readFileSync(path.join(layout.workspace.root, 'projects', 'alpha', 'CONTEXT.md'), 'utf-8'), '# Alpha\n');
    assert.ok(fs.existsSync(path.join(layout.runtime.teams, 'managed-teams.json')));
    assert.ok(fs.existsSync(path.join(layout.runtime.migrations, 'storage-layout-v2-ready.json')));

    const migratedConfig = JSON.parse(fs.readFileSync(path.join(layout.runtime.config, 'config.json'), 'utf-8'));
    assert.equal(migratedConfig.workspace.path, layout.workspace.root);
    assert.equal(migratedConfig.skills.directory, layout.workspace.skills);
    assert.equal(migratedConfig.memory.path, layout.runtime.memoryIndex);
    assert.equal(migratedConfig.tools.permissions.files.allowed_paths[1], externalRepo);

    // Re-running with the same ID must be a verified no-op, not a conflict.
    const second = executeStorageLayoutV2Migration({
      layout,
      sourceConfigRoot: sourceConfig,
      sourceWorkspaceRoot: sourceWorkspace,
      migrationId: 'regression',
      now: new Date('2026-08-21T12:05:00.000Z'),
    });
    assert.equal(second.readyToActivate, true, JSON.stringify(second, null, 2));
    assert.equal(second.conflicts.length, 0);
    assert.equal(second.errors.length, 0);
    assert.ok(second.identical.length > 0);

    // A different existing destination file must block activation and remain untouched.
    const conflictTarget = path.join(layout.runtime.sessions, 's2.json');
    write(path.join(sourceConfig, 'sessions', 's2.json'), '{"source":true}\n');
    write(conflictTarget, '{"destination":true}\n');
    const conflict = executeStorageLayoutV2Migration({
      layout,
      sourceConfigRoot: sourceConfig,
      sourceWorkspaceRoot: sourceWorkspace,
      migrationId: 'conflict-regression',
    });
    assert.equal(conflict.readyToActivate, false);
    assert.ok(conflict.conflicts.some((item) => item.target === conflictTarget));
    assert.equal(fs.readFileSync(conflictTarget, 'utf-8'), '{"destination":true}\n');

    console.log('storage migration regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
