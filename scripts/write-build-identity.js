const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Build-time only: runtime never invokes git or trusts the caller's current directory.
function writeBuildIdentity(repoRoot, targetDir) {
  const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid package version');
  let commit = null, dirty = null;
  try {
    const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const candidate = git('rev-parse', 'HEAD');
    // Repo-root check: if this tree sits inside a parent repo, HEAD/status describe the wrong repo. Treat as unknown.
    // Native realpath gives canonical Windows casing/separators; git prints forward slashes there.
    const top = fs.realpathSync.native(git('rev-parse', '--show-toplevel'));
    if (/^[a-f0-9]{40,64}$/.test(candidate) && top === fs.realpathSync.native(repoRoot)) {
      commit = candidate;
      // Conservative dirty scope: whole tree (tracked + untracked) except build outputs.
      // Covers src, electron, web-ui, scripts, builder configs, tsconfig*, manifests. False "modified" is acceptable; false "exact" is not.
      const statusOut = git('status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)dist', ':(exclude)generated', ':(exclude)release', ':(exclude)release-public');
      // Gitignored files under compiled/packaged inputs are invisible to status; check them explicitly (node_modules excluded).
      // node_modules is filtered here, not with a ':(exclude)**/node_modules/**' pathspec: that pathspec makes git walk
      // every ignored path and took minutes in a real checkout, so the 5 s timeout fired and identity fell back to unknown.
      const ignoredOut = git('ls-files', '--others', '--ignored', '--exclude-standard', '--', 'src', 'electron', 'web-ui', 'scripts')
        .split('\n')
        .filter((line) => line && !/(^|\/)node_modules(\/|$)/.test(line))
        .join('\n');
      dirty = Boolean(statusOut || ignoredOut);
    }
  } catch { commit = null; dirty = null; }
  const manifest = { schemaVersion: 1, version, commit, dirty, builtAt: new Date().toISOString(), playbookVersion: 1 };
  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(targetDir, 'build-identity.json');
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  return manifest;
}
module.exports = { writeBuildIdentity };
