import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourcePanelEnvironmentState } from '../web-ui/src/source-panel-environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chatPage = fs.readFileSync(path.join(root, 'web-ui/src/pages/ChatPage.js'), 'utf8');
const generatedChatPage = fs.readFileSync(path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js'), 'utf8');
const environmentModule = fs.readFileSync(path.join(root, 'web-ui/src/source-panel-environment.mjs'), 'utf8');
const generatedEnvironmentModule = fs.readFileSync(path.join(root, 'generated/public-web-ui/static/source-panel-environment.mjs'), 'utf8');

const cleanGitContext = {
  root: 'C:/projects/demo',
  roots: [{
    root: 'C:/projects/demo',
    repository: {
      vcs: { kind: 'git', remoteConnected: true },
      branch: 'main',
      provider: 'GitHub',
      remoteUrl: 'git@github.com:demo/project.git',
      repoFullName: 'demo/project',
      dirtyFiles: [],
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
    },
    files: [],
  }],
  files: [],
};

const loading = buildSourcePanelEnvironmentState({ loading: true, loaded: false });
assert.equal(loading.contextStatus, 'loading');
assert.equal(loading.changesValue, 'Loading…');
assert.equal(loading.branchValue, 'Loading…');
assert.equal(loading.remoteValue, 'Loading…');

const staleWhileLoading = buildSourcePanelEnvironmentState({ context: cleanGitContext, loading: true, loaded: false });
assert.equal(staleWhileLoading.branchLabel, 'Branch');
assert.equal(staleWhileLoading.localValue, 'Loading…');

const clean = buildSourcePanelEnvironmentState({ context: cleanGitContext, loaded: true });
assert.equal(clean.repositoryReady, true);
assert.equal(clean.changesValue, '0');
assert.equal(clean.localValue, 'clean');
assert.equal(clean.branchLabel, 'main');
assert.equal(clean.branchValue, 'up to date');
assert.equal(clean.remoteStatus, 'loading');

const connected = buildSourcePanelEnvironmentState({
  context: cleanGitContext,
  loaded: true,
  remoteData: { root: 'c:/projects/demo', connected: true, prs: [{ number: 1 }, { number: 2 }] },
});
assert.equal(connected.remoteStatus, 'ready');
assert.equal(connected.remoteValue, '2 open');

const disconnected = buildSourcePanelEnvironmentState({
  context: cleanGitContext,
  loaded: true,
  remoteData: { root: cleanGitContext.root, connected: false, prs: [] },
});
assert.equal(disconnected.remoteStatus, 'unavailable');
assert.equal(disconnected.remoteValue, 'Connect GitHub');

const localOnly = buildSourcePanelEnvironmentState({
  context: {
    ...cleanGitContext,
    roots: [{ ...cleanGitContext.roots[0], repository: { ...cleanGitContext.roots[0].repository, remoteUrl: '', vcs: { kind: 'git', remoteConnected: false } } }],
  },
  loaded: true,
});
assert.equal(localOnly.remoteStatus, 'unavailable');
assert.equal(localOnly.remoteValue, 'Local only');

const snapshotOnly = buildSourcePanelEnvironmentState({
  context: { roots: [{ root: 'C:/projects/plain', repository: { vcs: { kind: 'none' } }, files: [{ path: 'note.md', insertions: 2 }] }] },
  loaded: true,
});
assert.equal(snapshotOnly.changesValue, '1');
assert.equal(snapshotOnly.localValue, 'Unavailable');

const error = buildSourcePanelEnvironmentState({ loaded: true, error: 'Gateway offline' });
assert.equal(error.contextStatus, 'error');
assert.equal(error.changesValue, 'Unavailable');
assert.equal(error.remoteStatus, 'error');

const empty = buildSourcePanelEnvironmentState({ loaded: true, context: { roots: [], files: [] } });
assert.equal(empty.contextStatus, 'empty');
assert.equal(empty.changesValue, 'No workspace');

assert.match(chatPage, /sourcePanelState\.gitLoading = true/);
assert.match(chatPage, /sourcePanelState\.gitError = error\?\.message/);
assert.match(chatPage, /workspaceRoot = await sourcePanelSessionWorkspaceRoot\(sid\)/);
assert.match(chatPage, /if \(workspaceRoot\) params\.set\('root', workspaceRoot\)/);
assert.match(chatPage, /loadSourcePanelRemoteData\(sid\)\.catch\(\(\) => \{\}\);/);
assert.match(chatPage, /refreshSourcePanel\(\);/);
assert.equal(generatedChatPage, chatPage, 'generated desktop ChatPage must match source');
assert.equal(generatedEnvironmentModule, environmentModule, 'generated environment helper must match source');
assert.match(chatPage, /if \(sourcePanelState\.gitError\)/);

console.log('desktop source panel contract: loading, clean Git, remote, local-only, error, empty, refresh, and recovery states passed');
