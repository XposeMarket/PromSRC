import express from 'express';
import path from 'path';
import {
  getCodingWorkspaceSession,
  gitCommit,
  gitCheckoutBranch,
  gitCreateBranch,
  getGitFileHistory,
  gitListBranches,
  gitPull,
  gitPush,
  gitCurrentStatus,
  getCodingRepositorySnapshot,
  gitStage,
  gitUnstage,
  resolveCodingRoot,
} from '../coding/workspace-session';
import {
  getCodingWorkspaceContext,
  getCodingWorkspaceDiff,
  getCodingWorkspaceTree,
  findCodingGitRoot,
  type CodingScope,
} from '../coding/workspace-context';
import { findProjectBySessionId } from '../projects/project-store';
import { getWorkspace, sessionExists } from '../session';
import { getConnector, isConnectorConnected } from '../../integrations/connector-registry';

export const router = express.Router();

function resolveRequestCodingRoot(rawRoot: string | undefined, rawSessionId: string | undefined): string {
  const sessionId = String(rawSessionId || '').trim();
  if (!rawRoot && sessionId) {
    const projectRoot = String(findProjectBySessionId(sessionId)?.workspacePath || '').trim();
    if (projectRoot) return resolveCodingRoot(projectRoot);
  }
  if (!rawRoot && sessionId && sessionExists(sessionId)) {
    const sessionWorkspace = String(getWorkspace(sessionId) || '').trim();
    if (sessionWorkspace) return resolveCodingRoot(sessionWorkspace);
  }
  return resolveCodingRoot(rawRoot);
}

function fileIsInsideRoot(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveDiffRoot(rawRoot: string | undefined, sessionId: string | undefined, file: string): string {
  const resolved = resolveRequestCodingRoot(rawRoot, sessionId);
  // Canvas can open a native/dev-root file whose absolute path is outside the
  // session's default workspace. The mobile canvas resolves that file from its
  // own workspace endpoint; give desktop Coding Diff the same behavior by
  // deriving a Git root (or the file's directory) when the selected root cannot
  // contain the requested absolute file.
  if (path.isAbsolute(file) && !fileIsInsideRoot(resolved, file)) {
    try {
      const gitRoot = findCodingGitRoot(file);
      if (gitRoot) return resolveCodingRoot(gitRoot);
    } catch {}
    return resolveCodingRoot(path.dirname(file));
  }
  return resolved;
}

router.get('/api/coding/session', (req, res) => {
  try {
    res.json({
      session: getCodingWorkspaceSession(resolveRequestCodingRoot(
        req.query.root ? String(req.query.root) : undefined,
        req.query.sessionId ? String(req.query.sessionId) : undefined,
      )),
    });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/status', (req, res) => {
  try {
    const root = resolveRequestCodingRoot(
      req.query.root ? String(req.query.root) : undefined,
      req.query.sessionId ? String(req.query.sessionId) : undefined,
    );
    res.json({ root, ...gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/repository', (req, res) => {
  try {
    const root = resolveRequestCodingRoot(
      req.query.root ? String(req.query.root) : undefined,
      req.query.sessionId ? String(req.query.sessionId) : undefined,
    );
    res.json({ root, repository: getCodingRepositorySnapshot(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/diff', (req, res) => {
  try {
    const sessionId = req.query.sessionId ? String(req.query.sessionId) : undefined;
    const file = String(req.query.file || '').trim();
    if (!file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }
    const rawRoot = req.query.root ? String(req.query.root) : undefined;
    const root = resolveDiffRoot(rawRoot, sessionId, file);
    res.json(getCodingWorkspaceDiff({
      root,
      file,
      sessionId,
      view: req.query.view === 'staged' ? 'staged' : req.query.view === 'turn' ? 'turn' : 'working',
    }));
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/context', (req, res) => {
  try {
    const sessionId = req.query.sessionId ? String(req.query.sessionId) : undefined;
    const rawPaths = String(req.query.paths || '').trim();
    const paths = rawPaths ? rawPaths.split('|').map((value) => decodeURIComponent(value)).filter(Boolean) : [];
    const scope: CodingScope = req.query.scope === 'project' ? 'project' : 'thread';
    res.json(getCodingWorkspaceContext({
      sessionId,
      scope,
      root: req.query.root ? String(req.query.root) : undefined,
      paths,
    }));
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/tree', (req, res) => {
  try {
    res.json(getCodingWorkspaceTree({
      root: req.query.root ? String(req.query.root) : undefined,
      relativePath: req.query.path ? String(req.query.path) : undefined,
      depth: req.query.depth ? Number(req.query.depth) : 1,
    }));
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/branches', (req, res) => {
  try {
    const root = resolveRequestCodingRoot(
      req.query.root ? String(req.query.root) : undefined,
      req.query.sessionId ? String(req.query.sessionId) : undefined,
    );
    res.json({ root, branches: gitListBranches(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/history', (req, res) => {
  try {
    const root = resolveRequestCodingRoot(
      req.query.root ? String(req.query.root) : undefined,
      req.query.sessionId ? String(req.query.sessionId) : undefined,
    );
    const file = String(req.query.file || '').trim();
    if (!file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }
    res.json({ root, file, history: getGitFileHistory(root, file, Number(req.query.limit) || 20) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

function remoteRepoParts(repository: any): { owner: string; repo: string } | null {
  const match = String(repository?.repoFullName || '').trim().match(/^([^/]+)\/([^/]+)$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function runGitBranchNameSafe(value: string): boolean {
  const branch = String(value || '').trim();
  return branch.length > 0
    && branch.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
    && !branch.includes('..')
    && !branch.includes('@{')
    && !branch.endsWith('.')
    && !branch.endsWith('/');
}

function requireCodingConfirmation(req: express.Request, res: express.Response): boolean {
  if (req.body?.confirm === true) return true;
  res.status(409).json({ error: 'This coding action requires explicit confirmation.' });
  return false;
}

router.get('/api/coding/prs', async (req, res) => {
  try {
    const root = resolveRequestCodingRoot(
      req.query.root ? String(req.query.root) : undefined,
      req.query.sessionId ? String(req.query.sessionId) : undefined,
    );
    const repository = getCodingRepositorySnapshot(root);
    const parts = remoteRepoParts(repository);
    const connector = getConnector('github') as any;
    if (repository.provider !== 'GitHub' || !parts || !connector || !isConnectorConnected('github')) {
      res.json({ root, connected: false, prs: [] });
      return;
    }
    const state = req.query.state === 'all' || req.query.state === 'closed' ? String(req.query.state) : 'open';
    const prs = await connector.listPRs(parts.owner, parts.repo, state, 30);
    res.json({
      root,
      connected: true,
      repository: { owner: parts.owner, repo: parts.repo },
      prs: (Array.isArray(prs) ? prs : []).map((pr: any) => ({
        number: Number(pr?.number || 0),
        title: String(pr?.title || 'Pull request').slice(0, 240),
        state: String(pr?.state || state),
        draft: pr?.draft === true,
        author: String(pr?.user?.login || '').slice(0, 120),
        updatedAt: pr?.updated_at,
        url: String(pr?.html_url || ''),
        head: String(pr?.head?.ref || ''),
        base: String(pr?.base?.ref || ''),
      })).filter((pr: any) => pr.number && pr.title),
    });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/checks', async (req, res) => {
  try {
    const root = resolveRequestCodingRoot(
      req.query.root ? String(req.query.root) : undefined,
      req.query.sessionId ? String(req.query.sessionId) : undefined,
    );
    const repository = getCodingRepositorySnapshot(root);
    const parts = remoteRepoParts(repository);
    const connector = getConnector('github') as any;
    const ref = String(req.query.ref || repository.branch || '').trim();
    if (repository.provider !== 'GitHub' || !parts || !ref || !connector || !isConnectorConnected('github')) {
      res.json({ root, connected: false, ref, checks: [] });
      return;
    }
    const checks = await connector.listCheckRuns(parts.owner, parts.repo, ref, 30);
    res.json({
      root,
      connected: true,
      ref,
      checks: (Array.isArray(checks) ? checks : []).map((check: any) => ({
        name: String(check?.name || check?.app?.name || 'Check').slice(0, 180),
        status: String(check?.status || 'unknown'),
        conclusion: String(check?.conclusion || '').slice(0, 80),
        url: String(check?.html_url || check?.details_url || ''),
        startedAt: check?.started_at,
        completedAt: check?.completed_at,
      })),
    });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/branch', (req, res) => {
  try {
    if (!requireCodingConfirmation(req, res)) return;
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    const branch = String(req.body?.branch || '').trim();
    if (!branch) {
      res.status(400).json({ error: 'branch is required' });
      return;
    }
    res.json({ root, output: gitCreateBranch(root, branch), status: gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/stage', (req, res) => {
  try {
    if (!requireCodingConfirmation(req, res)) return;
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    const files = Array.isArray(req.body?.files) ? req.body.files.map(String).filter(Boolean) : [];
    res.json({ root, output: gitStage(root, files), status: gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/checkout', (req, res) => {
  try {
    if (!requireCodingConfirmation(req, res)) return;
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    const branch = String(req.body?.branch || '').trim();
    if (!branch) {
      res.status(400).json({ error: 'branch is required' });
      return;
    }
    res.json({ root, output: gitCheckoutBranch(root, branch), status: gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/push', (req, res) => {
  try {
    if (!requireCodingConfirmation(req, res)) return;
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    res.json({ root, output: gitPush(root, String(req.body?.remote || 'origin'), req.body?.branch ? String(req.body.branch) : undefined), status: gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/pull', (req, res) => {
  try {
    if (!requireCodingConfirmation(req, res)) return;
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    res.json({ root, output: gitPull(root, String(req.body?.remote || 'origin'), req.body?.branch ? String(req.body.branch) : undefined), status: gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/pr', async (req, res) => {
  try {
    if (!requireCodingConfirmation(req, res)) return;
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    const repository = getCodingRepositorySnapshot(root);
    const parts = remoteRepoParts(repository);
    const connector = getConnector('github') as any;
    if (repository.provider !== 'GitHub' || !parts || !connector || !isConnectorConnected('github')) throw new Error('GitHub is not connected for this repository');
    const title = String(req.body?.title || '').trim().slice(0, 240);
    const body = String(req.body?.body || '').trim().slice(0, 10000);
    const head = String(req.body?.head || repository.branch || '').trim();
    const base = String(req.body?.base || repository.defaultBranch || 'main').trim();
    if (!title || !head || !base) throw new Error('PR title, head branch, and base branch are required');
    if (!runGitBranchNameSafe(head) || !runGitBranchNameSafe(base)) throw new Error('Invalid PR branch name');
    const pr = await connector.createPullRequest(parts.owner, parts.repo, { title, body, head, base });
    res.json({ root, url: String(pr?.html_url || ''), number: Number(pr?.number || 0), title: String(pr?.title || title) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/unstage', (req, res) => {
  try {
    if (!requireCodingConfirmation(req, res)) return;
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    const files = Array.isArray(req.body?.files) ? req.body.files.map(String).filter(Boolean) : [];
    res.json({ root, output: gitUnstage(root, files), status: gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/commit', (req, res) => {
  try {
    if (!requireCodingConfirmation(req, res)) return;
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    const message = String(req.body?.message || '').trim();
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    res.json({ root, output: gitCommit(root, message), status: gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});
