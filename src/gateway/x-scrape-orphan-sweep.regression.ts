import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

async function main(): Promise<void> {
// Run the actual sweep with deterministic process/filesystem dependencies, not Chrome.
const source = fs.readFileSync('src/gateway/browser-tools.ts', 'utf8');
const start = source.indexOf("const X_SCRAPE_PROFILE_PREFIX =");
const end = source.indexOf('export async function fetchXThread', start);
assert.ok(start > 0 && end > start);
const root = path.resolve('test-profiles');
const profile = (name: string) => path.join(root, `detached-x_scrape_${name}`);
const sessions = new Map<string, { profileDir: string; debugPort?: number; browser?: { process: () => { pid: number } } }>();
const killed: number[] = [], removed: string[] = [];
let enumerate!: (rows: Array<{ pid: number; profileDir: string; debugPort: number }>) => void;
let enumerationCalls = 0;
const box = vm.createContext({
  path, sessions, console,
  getPersistentBrowserProfileRoot: () => root,
  findChromeProcessesByProfilePrefix: () => { enumerationCalls++; return new Promise(resolve => { enumerate = resolve; }); },
  killProcessTree: async (pid: number) => {
    killed.push(pid);
    // Another launch registers while a previous asynchronous kill is in flight.
    sessions.set('late', { profileDir: profile('late') });
    return true;
  },
  setTimeout: (callback: () => void) => { sessions.set('delete-late', { profileDir: profile('delete-late') }); callback(); },
  fs: {
    readdirSync: () => ['orphan', 'live', 'late', 'delete-late', 'pid-live'].map(name => ({ name: path.basename(profile(name)), isDirectory: () => true })),
    rmSync: (dir: string) => removed.push(dir),
    existsSync: (dir: string) => !removed.includes(dir),
  },
});
vm.runInContext(ts.transpileModule(source.slice(start, end).replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, box);
const first = vm.runInContext('sweepOrphanedXScrapeChromes()', box) as Promise<unknown>;
const second = vm.runInContext('sweepOrphanedXScrapeChromes()', box) as Promise<unknown>;
assert.equal(first, second, 'concurrent callers share the in-flight promise');
let launchReady = false;
void second.then(() => { launchReady = true; });
await Promise.resolve();
assert.equal(enumerationCalls, 1);
assert.equal(launchReady, false, 'launch stays blocked during enumeration');
sessions.set('live', { profileDir: profile('live') });
sessions.set('pid-live', { profileDir: profile('pid-live'), browser: { process: () => ({ pid: 5 }) } });
enumerate([
  { pid: 2, profileDir: profile('live'), debugPort: 0 },
  { pid: 3, profileDir: profile('orphan'), debugPort: 0 },
  { pid: 4, profileDir: profile('late'), debugPort: 0 },
  { pid: 5, profileDir: profile('stale-process-path'), debugPort: 0 },
]);
await Promise.all([first, second]);
assert.deepEqual(killed, [3], 'newly registered profiles/PIDs survive enumeration and earlier kills');
assert.deepEqual(removed, [profile('orphan')], 'ownership is checked again after the deletion delay');
assert.equal(launchReady, true);
console.log('x-scrape orphan sweep regression: ok');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
