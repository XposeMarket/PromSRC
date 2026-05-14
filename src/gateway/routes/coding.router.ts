import express from 'express';
import {
  getCodingWorkspaceSession,
  getGitDiff,
  gitCommit,
  gitCreateBranch,
  gitCurrentStatus,
  gitStage,
  resolveCodingRoot,
} from '../coding/workspace-session';

export const router = express.Router();

router.get('/api/coding/session', (req, res) => {
  try {
    res.json({ session: getCodingWorkspaceSession(req.query.root ? String(req.query.root) : undefined) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/status', (req, res) => {
  try {
    const root = resolveCodingRoot(req.query.root ? String(req.query.root) : undefined);
    res.json({ root, ...gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/api/coding/diff', (req, res) => {
  try {
    const root = resolveCodingRoot(req.query.root ? String(req.query.root) : undefined);
    const file = req.query.file ? String(req.query.file) : undefined;
    res.json({ root, file, diff: getGitDiff(root, file) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/branch', (req, res) => {
  try {
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
    const root = resolveCodingRoot(req.body?.root ? String(req.body.root) : undefined);
    const files = Array.isArray(req.body?.files) ? req.body.files.map(String).filter(Boolean) : [];
    res.json({ root, output: gitStage(root, files), status: gitCurrentStatus(root) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/api/coding/commit', (req, res) => {
  try {
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
