import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function main(): Promise<void> {
  // Import the gateway modules only after the test data root is isolated. The
  // config/session/resource singletons are process-scoped and must never point
  // at a developer's real Prometheus directory during this regression.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-imports-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;

  try {
    const adapters = await import('./import-adapters');
    const service = await import('./import-service');
    const sessions = await import('../session');
    const resources = await import('../resources/resource-store');
    const JSZip = require('jszip') as any;
    const selectAllPreviewChats = (job: any): string[] => (job?.preview?.conversationSummaries || [])
      .map((summary: any) => String(summary?.id || ''))
      .filter(Boolean);

    const transcriptDir = path.join(root, 'codex-transcript');
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, 'codex-session.jsonl');
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ session_id: 'session-a', cwd: workspace, role: 'user', content: 'Review this imported transcript.', timestamp: 1_700_000_000 }),
      JSON.stringify({ session_id: 'session-a', cwd: workspace, role: 'assistant', content: 'I found a historical tool record.', model: 'source-model', timestamp: 1_700_000_010, events: [{ id: 'tool-1', type: 'tool_call', name: 'shell', input: { command: 'never run this' } }] }),
      JSON.stringify({ session_id: 'session-a', role: 'tool', type: 'tool_result', content: 'Historical output only.', timestamp: 1_700_000_011 }),
    ].join('\n'), 'utf8');

    const transcriptResult = await adapters.parseConversationImport({
      stagedPath: transcriptDir,
      files: adapters.listStagedFiles(transcriptDir),
      sourceLabel: 'Codex local transcript',
      inputDigest: 'codex-digest',
      requestedAdapter: 'codex-local',
    });
    assert.equal(transcriptResult.adapter, 'codex-local');
    assert.equal(transcriptResult.provider, 'codex');
    assert.equal(transcriptResult.conversations.length, 1);
    assert.equal(transcriptResult.conversations[0].messages.length, 2);
    assert.equal(transcriptResult.conversations[0].project?.sourcePath, workspace);
    assert.ok(transcriptResult.conversations[0].events.length >= 2);
    assert.ok(transcriptResult.conversations[0].events.every((event) => event.historicalOnly === true));
    assert.equal(transcriptResult.conversations[0].messages[0].timestamp, 1_700_000_000_000);

    // Optional real-format verification. The rollout is supplied by the
    // caller and is never checked into the repository; all committed session
    // state is created under this regression's isolated temporary root.
    const realCodexPath = String(process.env.PROMETHEUS_REAL_CODEX_ROLLOUT || '').trim();
    if (realCodexPath && fs.existsSync(realCodexPath)) {
      const realCodexResult = await adapters.parseConversationImport({
        stagedPath: path.dirname(realCodexPath),
        files: [{ relativePath: path.basename(realCodexPath), absolutePath: realCodexPath, size: fs.statSync(realCodexPath).size }],
        sourceLabel: 'Codex current rollout',
        inputDigest: 'real-codex-rollout-digest',
        requestedAdapter: 'codex-local',
      });
      assert.equal(realCodexResult.adapter, 'codex-local');
      assert.equal(realCodexResult.provider, 'codex');
      assert.ok(realCodexResult.conversations.length >= 1);
      assert.ok(realCodexResult.conversations[0].messages.length >= 1);
      assert.ok(realCodexResult.conversations[0].events.some((event) => event.type === 'reasoning'));
      assert.ok(realCodexResult.conversations[0].events.some((event) => event.type === 'tool_call'));
      assert.ok(realCodexResult.conversations[0].events.every((event) => event.historicalOnly === true));
      const realCodexAutoResult = await adapters.parseConversationImport({
        stagedPath: path.dirname(realCodexPath),
        files: [{ relativePath: path.basename(realCodexPath), absolutePath: realCodexPath, size: fs.statSync(realCodexPath).size }],
        sourceLabel: 'current rollout',
        inputDigest: 'real-codex-rollout-auto-digest',
      });
      assert.equal(realCodexAutoResult.adapter, 'codex-local');
      assert.ok(realCodexAutoResult.conversations.length >= 1);
      const realCodexJob = await service.createImportJob({
        ownerId: 'import-regression-owner',
        workspacePath: workspace,
        kind: 'conversation',
        sourcePath: realCodexPath,
        sourceLabel: 'Codex current rollout',
        requestedAdapter: 'codex-local',
        sourceAccountId: 'real-codex-test-account',
      });
      assert.equal(realCodexJob.job.status, 'preview_ready');
      assert.ok((realCodexJob.job.preview?.messages || 0) >= 1);
      const realCodexCommitted = await service.confirmImportJob(realCodexJob.job.id, 'import-regression-owner', selectAllPreviewChats(realCodexJob.job));
      assert.equal(realCodexCommitted.status, 'completed');
      assert.ok(realCodexCommitted.result?.sessionIds?.some(Boolean));
      service.rollbackImportJob(realCodexJob.job.id, 'import-regression-owner');
    }

    const hermesFixtureDir = path.join(root, 'hermes-export');
    fs.mkdirSync(hermesFixtureDir, { recursive: true });
    const hermesFixturePath = path.join(hermesFixtureDir, 'hermes-sessions.jsonl');
    fs.writeFileSync(hermesFixturePath, JSON.stringify({
      id: 'hermes-fixture-session',
      source: 'cli',
      model: 'gpt-5.6-luna',
      title: 'Hermes native export fixture',
      cwd: workspace,
      started_at: 1_700_000_200,
      ended_at: 1_700_000_220,
      messages: [
        { id: 'hermes-user', session_id: 'hermes-fixture-session', role: 'user', content: 'Keep this Hermes history.', timestamp: 1_700_000_200 },
        { id: 'hermes-assistant', session_id: 'hermes-fixture-session', role: 'assistant', content: 'Historical response.', timestamp: 1_700_000_210, reasoning: 'Historical reasoning only.', tool_calls: [{ id: 'hermes-tool-call', type: 'tool_call', name: 'shell', input: { command: 'never run this' } }] },
        { id: 'hermes-tool-result', session_id: 'hermes-fixture-session', role: 'tool', tool_call_id: 'hermes-tool-call', tool_name: 'shell', content: 'Historical output only.', timestamp: 1_700_000_211 },
      ],
    }) + '\n', 'utf8');
    const hermesFixtureResult = await adapters.parseConversationImport({
      stagedPath: hermesFixtureDir,
      files: adapters.listStagedFiles(hermesFixtureDir),
      sourceLabel: 'Hermes native session export',
      inputDigest: 'hermes-digest',
      requestedAdapter: 'hermes-local',
    });
    assert.equal(hermesFixtureResult.adapter, 'hermes-local');
    assert.equal(hermesFixtureResult.provider, 'hermes');
    assert.equal(hermesFixtureResult.conversations.length, 1);
    assert.equal(hermesFixtureResult.conversations[0].messages.length, 2);
    assert.equal(hermesFixtureResult.conversations[0].source.sourceSessionKey, 'hermes-fixture-session');
    assert.equal(hermesFixtureResult.conversations[0].project?.sourcePath, workspace);
    assert.ok(hermesFixtureResult.conversations[0].events.some((event) => event.type === 'reasoning'));
    assert.ok(hermesFixtureResult.conversations[0].events.some((event) => event.type === 'tool_call'));
    assert.ok(hermesFixtureResult.conversations[0].events.some((event) => event.type === 'tool_result'));
    assert.ok(hermesFixtureResult.conversations[0].events.every((event) => event.historicalOnly === true));

    // Optional verification against a real `hermes sessions export` artifact.
    // The source file is read-only input; all Prometheus state remains under
    // this regression's isolated temporary root and is rolled back afterward.
    const realHermesPath = String(process.env.PROMETHEUS_REAL_HERMES_EXPORT || '').trim();
    if (realHermesPath && fs.existsSync(realHermesPath)) {
      const realHermesResult = await adapters.parseConversationImport({
        stagedPath: path.dirname(realHermesPath),
        files: [{ relativePath: path.basename(realHermesPath), absolutePath: realHermesPath, size: fs.statSync(realHermesPath).size }],
        sourceLabel: 'Hermes native session export',
        inputDigest: 'real-hermes-export-digest',
        requestedAdapter: 'hermes-local',
      });
      assert.equal(realHermesResult.adapter, 'hermes-local');
      assert.equal(realHermesResult.provider, 'hermes');
      assert.ok(realHermesResult.conversations.length >= 1);
      assert.ok(realHermesResult.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0) >= 1);
      assert.ok(realHermesResult.conversations.some((conversation) => conversation.events.some((event) => event.type === 'tool_call')));
      assert.ok(realHermesResult.conversations.some((conversation) => conversation.events.some((event) => event.type === 'reasoning')));
      assert.ok(realHermesResult.conversations.every((conversation) => conversation.events.every((event) => event.historicalOnly === true)));
      const realHermesJob = await service.createImportJob({
        ownerId: 'import-regression-owner',
        workspacePath: workspace,
        kind: 'conversation',
        sourcePath: realHermesPath,
        sourceLabel: 'Hermes native session export',
        requestedAdapter: 'hermes-local',
        sourceAccountId: 'real-hermes-test-account',
      });
      assert.equal(realHermesJob.job.status, 'preview_ready');
      assert.ok((realHermesJob.job.preview?.conversations || 0) >= 1);
      const realHermesCommitted = await service.confirmImportJob(realHermesJob.job.id, 'import-regression-owner', selectAllPreviewChats(realHermesJob.job));
      assert.equal(realHermesCommitted.status, 'completed');
      assert.ok((realHermesCommitted.result?.sessionIds || []).length >= 1);
      service.rollbackImportJob(realHermesJob.job.id, 'import-regression-owner');
    }

    const zip = new JSZip();
    zip.file('conversations.json', JSON.stringify([{
      conversation_id: 'chatgpt-1',
      title: 'ChatGPT export with attachment',
      mapping: {
        user: { message: { id: 'user-1', author: { role: 'user' }, content: { parts: ['Keep this source context.'] }, create_time: 1_700_000_100 } },
        assistant: { message: { id: 'assistant-1', author: { role: 'assistant' }, content: { parts: ['Continue this in Prometheus.'] }, create_time: 1_700_000_110, metadata: { model_slug: 'source-chat-model' } } },
      },
    }]));
    zip.file('assets/attachment.txt', 'untrusted historical attachment');
    const zipPath = path.join(root, 'chatgpt-export.zip');
    fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
    const zipResult = await adapters.parseConversationImport({
      stagedPath: root,
      files: [{ relativePath: 'chatgpt-export.zip', absolutePath: zipPath, size: fs.statSync(zipPath).size }],
      sourceLabel: 'ChatGPT official export',
      inputDigest: 'chatgpt-digest',
      requestedAdapter: 'chatgpt-export',
    });
    assert.equal(zipResult.adapter, 'chatgpt-export');
    assert.equal(zipResult.provider, 'chatgpt');
    assert.equal(zipResult.conversations.length, 1);
    assert.equal(zipResult.conversations[0].resources.length, 1);
    assert.equal(zipResult.conversations[0].resources[0].relativePath, '__zip__/assets/attachment.txt');

    const setupDir = path.join(root, 'hermes-setup');
    fs.mkdirSync(setupDir, { recursive: true });
    const secret = 'setup-secret-that-must-not-leak';
    const setupPath = path.join(setupDir, 'mcp.json');
    fs.writeFileSync(setupPath, JSON.stringify({
      mcpServers: {
        imported_server: {
          name: 'Imported server',
          command: 'node',
          args: ['server.js'],
          env: { API_KEY: secret },
          enabled: true,
        },
      },
    }), 'utf8');
    fs.writeFileSync(path.join(setupDir, 'MEMORY.md'), '# Imported memory\nReview before activation.', 'utf8');
    const setupResult = adapters.parseSetupImport({
      stagedPath: setupDir,
      files: adapters.listStagedFiles(setupDir),
      sourceLabel: 'Hermes setup',
      inputDigest: 'setup-digest',
      requestedAdapter: 'setup-config',
    });
    assert.equal(setupResult.provider, 'hermes');
    assert.equal(setupResult.setup.mcpServers.length, 1);
    assert.equal(setupResult.setup.mcpServers[0].config.enabled, false);
    assert.ok(setupResult.setup.secretNotices.length >= 1);
    assert.ok(!JSON.stringify(setupResult.setup).includes(secret));
    assert.equal(setupResult.setup.files.find((file) => file.relativePath === 'MEMORY.md')?.activation, 'inactive_snapshot');

    const ownerId = 'import-regression-owner';
    const first = await service.createImportJob({
      ownerId,
      workspacePath: workspace,
      kind: 'conversation',
      sourcePath: transcriptPath,
      sourceLabel: 'Codex local transcript',
      requestedAdapter: 'codex-local',
      sourceAccountId: 'test-account',
    });
    assert.equal(first.idempotent, false);
    assert.equal(first.job.status, 'preview_ready');
    assert.equal(first.job.preview?.conversations, 1);
    assert.equal('stagedPath' in first.job, false);
    assert.equal('workspacePath' in first.job, false);
    await assert.rejects(() => service.confirmImportJob(first.job.id, ownerId), /Explicit chat selection is required/);
    const committed = await service.confirmImportJob(first.job.id, ownerId, selectAllPreviewChats(first.job));
    assert.equal(committed.status, 'completed');
    const importedSessionId = committed.result?.sessionIds?.find(Boolean);
    assert.ok(importedSessionId);
    assert.ok(sessions.sessionExists(importedSessionId!));
    const importedSession = sessions.getSession(importedSessionId!);
    assert.equal(importedSession.externalImport?.continuation, 'prometheus');
    assert.equal(importedSession.externalImport?.sourceResume, 'unsupported');
    assert.ok(importedSession.history.some((message: any) => message.historicalEvents?.some((event: any) => event.historicalOnly === true)));
    assert.ok(importedSession.history.some((message: any) => message.processEntries?.some((entry: any) => entry.extra?.executed === false)));

    const duplicate = await service.createImportJob({
      ownerId,
      workspacePath: workspace,
      kind: 'conversation',
      sourcePath: transcriptPath,
      sourceLabel: 'Codex local transcript',
      requestedAdapter: 'codex-local',
      sourceAccountId: 'test-account',
    });
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.job.id, first.job.id);

    const codexBatchDir = path.join(root, 'codex-batch');
    fs.mkdirSync(codexBatchDir, { recursive: true });
    const selectedCodexBatchFile = path.join(codexBatchDir, 'rollout-selected.jsonl');
    fs.writeFileSync(selectedCodexBatchFile, [
      JSON.stringify({ session_id: 'selected-batch-session', role: 'user', content: 'Selected Codex batch message.', timestamp: 1_700_000_030 }),
      JSON.stringify({ session_id: 'selected-batch-session', role: 'assistant', content: 'Selected batch response.', timestamp: 1_700_000_040 }),
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(codexBatchDir, 'rollout-not-selected.jsonl'), JSON.stringify({ session_id: 'not-selected', role: 'user', content: 'Must not be staged.', timestamp: 1_700_000_050 }), 'utf8');
    const codexBatchJob = await service.createImportJob({
      ownerId,
      workspacePath: workspace,
      kind: 'conversation',
      sourcePath: codexBatchDir,
      sourceFiles: [selectedCodexBatchFile],
      sourceLabel: 'Codex bounded batch',
      requestedAdapter: 'codex-local',
    });
    assert.equal(codexBatchJob.job.status, 'preview_ready');
    assert.equal(codexBatchJob.job.preview?.conversations, 1);
    assert.equal(codexBatchJob.job.preview?.messages, 2);
    const codexBatchCommitted = await service.confirmImportJob(codexBatchJob.job.id, ownerId, selectAllPreviewChats(codexBatchJob.job));
    assert.equal(codexBatchCommitted.status, 'completed');
    service.rollbackImportJob(codexBatchJob.job.id, ownerId);

    const claudeProjectDir = path.join(root, 'claude-project', 'C--Users-rafel-project');
    fs.mkdirSync(claudeProjectDir, { recursive: true });
    for (const [index, [sessionId, title]] of [['claude-project-session-a', 'Claude project chat A'], ['claude-project-session-b', 'Claude project chat B']].entries()) {
      const startedAt = 1_700_001_000 + index * 100;
      fs.writeFileSync(path.join(claudeProjectDir, `${sessionId}.jsonl`), [
        JSON.stringify({ type: 'user', sessionId, cwd: workspace, message: { role: 'user', content: title }, timestamp: startedAt }),
        JSON.stringify({ type: 'assistant', sessionId, cwd: workspace, message: { role: 'assistant', content: 'Historical Claude response.' }, timestamp: startedAt + 10 }),
      ].join('\n'), 'utf8');
    }
    const projectJob = await service.createImportJob({
      ownerId,
      workspacePath: workspace,
      kind: 'conversation',
      sourcePath: path.join(root, 'claude-project'),
      sourceLabel: 'Claude Code project folders',
      requestedAdapter: 'claude-code-local',
      conversationMode: 'projects',
    });
    assert.equal(projectJob.job.status, 'preview_ready');
    assert.equal(projectJob.job.conversationMode, 'projects');
    assert.equal(projectJob.job.preview?.projects, 1);
    assert.equal(projectJob.job.preview?.projectSummaries[0]?.conversations, 2);
    assert.equal(projectJob.job.preview?.conversationSummaries[0]?.id, 'claude-project-session-b');
    const selectedProjectConversationId = projectJob.job.preview?.conversationSummaries[0]?.id;
    assert.ok(selectedProjectConversationId);
    const projectCommitted = await service.confirmImportJob(projectJob.job.id, ownerId, [selectedProjectConversationId!]);
    assert.equal(projectCommitted.status, 'completed');
    assert.deepEqual(projectCommitted.selectedConversationIds, [selectedProjectConversationId]);
    assert.equal(projectCommitted.result?.projectIds?.length, 1);
    assert.equal(projectCommitted.result?.sessionIds?.length, 1);
    const projectStore = await import('../projects/project-store');
    const importedProject = projectStore.getProject(projectCommitted.result!.projectIds[0]);
    assert.ok(importedProject);
    assert.equal(importedProject?.name, path.basename(workspace));
    assert.equal(importedProject?.workspacePath, workspace);
    assert.equal(importedProject?.sessions.length, 1);
    assert.equal(importedProject?.externalImport?.linkState, 'linked');
    const projectRolledBack = service.rollbackImportJob(projectJob.job.id, ownerId);
    assert.equal(projectRolledBack.status, 'rolled_back');
    assert.equal(projectStore.getProject(projectCommitted.result!.projectIds[0]), null);

    const zipJob = await service.createImportJob({
      ownerId,
      workspacePath: workspace,
      kind: 'conversation',
      sourcePath: zipPath,
      sourceLabel: 'ChatGPT official export',
      requestedAdapter: 'chatgpt-export',
      conversationMode: 'projects',
    });
    assert.equal(zipJob.job.preview?.projects, 0);
    assert.ok(zipJob.job.preview?.warnings.some((warning) => warning.includes('top-level Prometheus threads')));
    const zipCommitted = await service.confirmImportJob(zipJob.job.id, ownerId, selectAllPreviewChats(zipJob.job));
    assert.equal(zipCommitted.status, 'completed');
    const zipSessionId = zipCommitted.result?.sessionIds?.find(Boolean);
    assert.ok(zipSessionId);
    assert.equal(resources.getResourceStore(workspace).listThreadResources(zipSessionId!).length, 1);

    const rolledBack = service.rollbackImportJob(first.job.id, ownerId);
    assert.equal(rolledBack.status, 'rolled_back');
    assert.equal(sessions.sessionExists(importedSessionId!), false);
    assert.equal(resources.getResourceStore(workspace).listThreadResources(importedSessionId!).length, 0);

    const setupJob = await service.createImportJob({
      ownerId,
      workspacePath: workspace,
      kind: 'setup',
      sourcePath: setupDir,
      sourceLabel: 'Hermes setup',
      requestedAdapter: 'setup-config',
    });
    const setupCommitted = await service.confirmImportJob(setupJob.job.id, ownerId);
    assert.ok(['completed', 'partial'].includes(setupCommitted.status));
    const mcp = (await import('../mcp-manager')).getMCPManager();
    const applied = mcp.getConfigs().find((config) => config.id === 'imported_server');
    assert.ok(applied);
    assert.equal(applied?.enabled, false);
    assert.ok(!JSON.stringify(applied).includes(secret));
    const configDir = (await import('../../config/config')).getConfig().getConfigDir();
    const setupSnapshotRoot = path.join(configDir, String(setupCommitted.result?.setupSnapshotPath || ''));
    assert.ok(fs.existsSync(path.join(setupSnapshotRoot, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(setupSnapshotRoot, 'mcp.json')));
    assert.ok(!fs.readFileSync(path.join(setupSnapshotRoot, 'mcp.json'), 'utf8').includes(secret));
    const conflictPath = path.join(root, 'conflicting-mcp.json');
    fs.writeFileSync(conflictPath, JSON.stringify({ mcpServers: { imported_server: { name: 'Must not replace', command: 'node' } } }), 'utf8');
    const conflictJob = await service.createImportJob({
      ownerId,
      workspacePath: workspace,
      kind: 'setup',
      sourcePath: conflictPath,
      sourceLabel: 'conflicting setup',
      requestedAdapter: 'setup-config',
    });
    assert.equal(conflictJob.job.preview?.conflicts, 1);
    const conflictCommitted = await service.confirmImportJob(conflictJob.job.id, ownerId);
    assert.equal(conflictCommitted.result?.conflicts, 1);
    assert.equal(mcp.getConfigs().find((config) => config.id === 'imported_server')?.name, 'Imported server');
    service.rollbackImportJob(conflictJob.job.id, ownerId);
    const setupRolledBack = service.rollbackImportJob(setupJob.job.id, ownerId);
    assert.equal(setupRolledBack.status, 'rolled_back');
    mcp.load();
    assert.equal(mcp.getConfigs().some((config) => config.id === 'imported_server'), false);

    const malformedPath = path.join(root, 'malformed.json');
    fs.writeFileSync(malformedPath, '{not-json', 'utf8');
    const malformed = await service.createImportJob({
      ownerId,
      workspacePath: workspace,
      kind: 'conversation',
      sourcePath: malformedPath,
      requestedAdapter: 'chatgpt-export',
    });
    assert.equal(malformed.job.status, 'failed');
    const retried = await service.retryImportJob(malformed.job.id, ownerId);
    assert.equal(retried.status, 'failed');
    assert.equal(retried.result?.sessionIds?.length || 0, 0);

    const serviceSource = fs.readFileSync(path.join(__dirname, 'import-service.ts'), 'utf8');
    assert.ok(serviceSource.includes('historicalOnly: true'));
    assert.ok(serviceSource.includes('executed: false'));
    assert.ok(!serviceSource.includes("from 'child_process'"));
    assert.ok(!serviceSource.includes('spawn('));
    assert.notEqual(adapters.stableImportId('owner', 'workspace', 'source', 'account-a', 'conversation'), adapters.stableImportId('owner', 'workspace', 'source', 'account-b', 'conversation'));

    console.log('external import regression: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
