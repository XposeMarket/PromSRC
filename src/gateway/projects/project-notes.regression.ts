// Regression: projects v2 (instructions/notes split, legacy cleanup, folder instruction
// files, prompt block, ghost-chat pruning, folder-linked harness chats).
// Runs against an isolated data dir; never touches a real Prometheus store.
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-projects-v2-'));
process.env.PROMETHEUS_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_APP_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

(async () => {
  // require (not import()) so the store and this test share one session module instance.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const store = require('./project-store') as typeof import('./project-store');
  const session = require('../session') as typeof import('../session');

  // 1. Pure legacy cleanup.
  const legacy = [
    '# OUTSIDE DC', '', '> Last updated: 2026-10-25 04:07 UTC', '',
    '> This file is the living context for this project. Keep durable project facts, decisions, and status current.', '',
    '## Overview', '', '*(Prometheus will fill this in after your first substantive conversation.)*', '',
    '## Project Instructions', '', 'Always answer in English.', '',
    '## Project Memory', '', 'Launch is Dec 1.', '',
    '## Goals', '- all of it  <!-- 2026-10-21 -->', '- Reach 1k signups by launch', '',
    '## Tech Stack & Tools', '- Twilio  <!-- 2026-10-23 -->', '- gonna make this work  <!-- 2026-10-21 -->', '',
    '## Notes', '',
  ].join('\n');
  const m = store.migrateLegacyProjectContext(legacy, 'OUTSIDE DC', '', '');
  assert.equal(m.instructions, 'Always answer in English.');
  assert.equal(m.reviewLines, 3);
  assert.match(m.notes, /^# OUTSIDE DC\n/);
  assert.match(m.notes, /## Memory\n\nLaunch is Dec 1\./);
  assert.match(m.notes, /## Goals\n\n- Reach 1k signups by launch/);
  assert.doesNotMatch(m.notes, /Project Instructions|Last updated|living context|will fill this in|## Overview|## Notes/);
  assert.match(m.notes, /## Auto-captured \(review\)[\s\S]*- Twilio _\(was under Tech Stack & Tools\)_/);
  // The review section and comments never reach the model.
  const prompt = store.projectNotesForPrompt(m.notes);
  assert.doesNotMatch(prompt, /Auto-captured|Twilio|gonna make this work|<!--/);
  assert.match(prompt, /Reach 1k signups/);
  // Idempotent: cleaning already-clean notes changes nothing meaningful.
  const again = store.migrateLegacyProjectContext(m.notes, 'OUTSIDE DC', m.instructions, '');
  assert.equal(again.instructions, m.instructions);
  assert.equal(again.reviewLines, m.reviewLines);
  // Existing instructions are not duplicated.
  assert.equal(store.migrateLegacyProjectContext(legacy, 'x', 'Always answer in English.').instructions, 'Always answer in English.');
  // Empty template -> empty notes for the prompt.
  assert.equal(store.projectNotesForPrompt('# Name\n\n<!-- seed -->\n'), '');

  // 2. Folder instruction files (AGENTS.md + CLAUDE.md, identical content deduped).
  const folder = path.join(root, 'repo');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'AGENTS.md'), 'Use pnpm.\n');
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), 'Use pnpm.\n');
  assert.deepEqual(store.readFolderInstructionFiles(folder).map((f) => f.name), ['AGENTS.md']);
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), 'Run tests before committing.\n');
  assert.deepEqual(store.readFolderInstructionFiles(folder).map((f) => f.name), ['AGENTS.md', 'CLAUDE.md']);
  assert.deepEqual(store.readFolderInstructionFiles(path.join(root, 'missing')), []);

  // 3. A real v1 project on disk is cleaned once, with a backup, then the prompt block uses v2.
  const project = store.createProject('Legacy app');
  const findFile = (dir: string, name: string): string => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { const hit = findFile(full, name); if (hit) return hit; } else if (entry.name === name) return full;
    }
    return '';
  };
  const projectFile = findFile(root, `${project.id}.json`);
  assert.ok(projectFile, 'project record written inside the isolated root');
  const raw = JSON.parse(fs.readFileSync(projectFile, 'utf-8'));
  delete raw.contextVersion;
  raw.memorySnapshot = 'Old snapshot fact.';
  fs.writeFileSync(projectFile, JSON.stringify(raw));
  const contextPath = store.getProjectContextFilePath(project.id);
  fs.writeFileSync(contextPath, legacy);
  const sid = 'sess_projects_v2_a';
  session.addMessage(sid, { role: 'user', content: 'hello', timestamp: Date.now() } as any); session.flushSession(sid);
  store.attachSessionToProject(project.id, sid);
  const cleaned = store.getProject(project.id)!;
  assert.equal(cleaned.contextVersion, 2);
  assert.equal(cleaned.instructions, 'Always answer in English.');
  assert.ok(fs.existsSync(path.join(path.dirname(contextPath), 'CONTEXT.v1-backup.md')));
  assert.equal(fs.readFileSync(path.join(path.dirname(contextPath), 'CONTEXT.v1-backup.md'), 'utf-8'), legacy);
  assert.match(fs.readFileSync(contextPath, 'utf-8'), /Old snapshot fact\./);
  store.updateProject(project.id, { workspacePath: folder });
  const block = store.buildProjectContextBlock(sid)!;
  assert.match(block, /## Project instructions \(written by the user; follow them\)\nAlways answer in English\./);
  assert.match(block, /## AGENTS\.md \(from the linked folder/);
  assert.match(block, /Run tests before committing\./);
  assert.match(block, /Reach 1k signups/);
  assert.doesNotMatch(block, /FIRST session|must ask what the project is about|Twilio/);
  assert.match(block, /PROJECT NOTES: /);
  // Saving instructions no longer rewrites the notes file.
  const notesBefore = fs.readFileSync(contextPath, 'utf-8');
  store.updateProject(project.id, { instructions: 'New rule.' });
  assert.equal(fs.readFileSync(contextPath, 'utf-8'), notesBefore);
  assert.ok(store.writeProjectNotes(project.id, '# Legacy app\n\n- edited by user\n'));
  assert.match(store.buildProjectContextBlock(sid)!, /edited by user/);

  // 4. Unstarted project chats (row created, first message never landed) are pruned after the grace period.
  store.addSessionToProject(project.id, 'sess_projects_v2_ghost');
  const now = Date.now();
  assert.ok(store.pruneUnstartedProjectChats(store.getProject(project.id)!, now).sessions.some((s) => s.id === 'sess_projects_v2_ghost'));
  const pruned = store.pruneUnstartedProjectChats(store.getProject(project.id)!, now + 3 * 60_000);
  assert.ok(!pruned.sessions.some((s) => s.id === 'sess_projects_v2_ghost'));
  assert.ok(pruned.sessions.some((s) => s.id === sid));
  assert.ok(!store.getProject(project.id)!.sessions.some((s) => s.id === 'sess_projects_v2_ghost'));

  // 5. One project, any agent: a harness chat in the linked folder is filed into the project.
  const hid = 'sess_projects_v2_codex';
  session.addMessage(hid, { role: 'user', content: 'hi codex', timestamp: Date.now() } as any); session.flushSession(hid);
  session.setSessionExternalAgent(hid, { agentId: 'codex', cwd: folder } as any); session.flushSession(hid);
  assert.equal(store.fileSessionIntoFolderProject(hid, path.join(folder, path.sep))?.id, project.id);
  assert.equal(store.findProjectBySessionId(hid)?.id, project.id);
  assert.equal(store.fileSessionIntoFolderProject(hid, folder), null, 'already filed');
  // Backfill when a folder gets linked later.
  const other = path.join(root, 'other');
  fs.mkdirSync(other);
  const hid2 = 'sess_projects_v2_claude';
  session.addMessage(hid2, { role: 'user', content: 'hi claude', timestamp: Date.now() } as any); session.flushSession(hid2);
  session.setSessionExternalAgent(hid2, { agentId: 'claude-code', cwd: other } as any); session.flushSession(hid2);
  // The session index (what the backfill reads) is written on its own debounce.
  for (let i = 0; i < 40; i += 1) {
    const hit = (session.listSessionSummaries() as any[]).find((s) => s.id === hid2);
    if (hit?.externalAgent?.cwd) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok((session.listSessionSummaries() as any[]).find((s) => s.id === hid2)?.externalAgent?.cwd, 'index carries the harness folder');
  const p2 = store.createProject('Other', '');
  assert.equal(store.findProjectBySessionId(hid2), null);
  store.updateProject(p2.id, { workspacePath: other });
  // The session index settles on its own schedule in this tight loop; linking is idempotent, so retry.
  for (let i = 0; i < 40 && !store.findProjectBySessionId(hid2); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    store.fileHarnessChatsIntoProject(p2.id);
  }
  assert.equal(store.findProjectBySessionId(hid2)?.id, p2.id);
  assert.equal(store.findProjectByFolder(other.toUpperCase())?.id, process.platform === 'linux' ? undefined : p2.id);

  // 6. New projects are v2 from the start and carry no forced first question.
  const fresh = store.createProject('Fresh');
  assert.equal(fresh.contextVersion, 2);
  const fsid = 'sess_projects_v2_fresh';
  session.addMessage(fsid, { role: 'user', content: 'start', timestamp: Date.now() } as any); session.flushSession(fsid);
  store.attachSessionToProject(fresh.id, fsid);
  const freshBlock = store.buildProjectContextBlock(fsid)!;
  assert.doesNotMatch(freshBlock, /FIRST session|## Project notes/);

  console.log('project-notes regression: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp */ }
});
