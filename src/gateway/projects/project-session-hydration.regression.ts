import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { hydrateProjectSessions, type ProjectSessionSummaryLike } from './project-session-hydration';

const index: Record<string, ProjectSessionSummaryLike> = {
  renamed: { title: 'Roblox obby plan', preview: '  latest\n reply  ', messageCount: 42, createdAt: 100, lastActiveAt: 900, lastMessageAt: 880 },
  placeholder: { title: 'New chat', preview: 'hi', messageCount: 2, createdAt: 5, lastActiveAt: 50 },
  untitled: { title: '', preview: '', messageCount: 0, lastActiveAt: 70 },
  long: { title: 'Long', preview: 'x'.repeat(500), messageCount: 1 },
};
const calls: string[] = [];
const lookup = (id: string) => { calls.push(id); return Object.prototype.hasOwnProperty.call(index, id) ? index[id] : null; };

const project = {
  id: 'p1',
  name: 'Demo',
  sessions: [
    { id: 'renamed', title: 'old stored title', createdAt: 1, updatedAt: 2 },
    { id: 'placeholder', title: 'Stored name', createdAt: 3, updatedAt: 4 },
    { id: 'untitled', title: 'New Chat', updatedAt: 6 },
    { id: 'not-indexed', title: 'Kept as stored', updatedAt: 7 },
    { id: 'long', title: 'Long' },
  ],
};
const out = hydrateProjectSessions(project, lookup);

assert.equal(out.id, 'p1');
assert.equal(out.name, 'Demo');
assert.deepEqual(calls, ['renamed', 'placeholder', 'untitled', 'not-indexed', 'long'], 'one index lookup per chat');

const [renamed, placeholder, untitled, notIndexed, long] = out.sessions;
assert.equal(renamed.title, 'Roblox obby plan', 'live chat title wins over the stored one');
assert.equal(renamed.messageCount, 42);
assert.equal(renamed.preview, 'latest reply', 'preview whitespace is collapsed');
assert.equal(renamed.createdAt, 100);
assert.equal(renamed.updatedAt, 900);
assert.equal(renamed.lastMessageAt, 880);

assert.equal(placeholder.title, 'Stored name', 'placeholder chat title falls back to the stored title');
assert.equal(placeholder.lastMessageAt, 50, 'falls back to last activity');

assert.equal(untitled.title, 'New chat', 'both titles are placeholders');
assert.equal(untitled.messageCount, 0);
assert.equal(untitled.updatedAt, 70);

assert.deepEqual(notIndexed, project.sessions[3], 'a chat missing from the index is returned exactly as stored');
assert.equal(long.preview.length, 240, 'preview is capped');

// Inputs are not mutated, and odd shapes do not throw.
assert.equal(project.sessions[0].title, 'old stored title');
assert.deepEqual(hydrateProjectSessions({ id: 'p2' }, lookup).sessions, []);
assert.deepEqual(hydrateProjectSessions({ id: 'p3', sessions: [{ id: 'renamed' }] }, () => { throw new Error('index unavailable'); }).sessions, [{ id: 'renamed' }], 'a failing lookup keeps the stored row');

// The list route must stay on the index: it may not load whole sessions again.
const routerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'gateway', 'routes', 'projects.router.ts'), 'utf8');
const hydrateFn = routerSource.slice(routerSource.indexOf('function hydrateProjectSessions('), routerSource.indexOf("router.get('/api/projects'"));
assert.ok(hydrateFn.includes('getSessionSummaryById'), 'route hydrates from the session index');
assert.ok(!/\bgetSession\(/.test(hydrateFn), 'route does not load full sessions to list projects');

console.log('project session hydration regressions passed');
