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
    if (/^[a-f0-9]{40,64}$/.test(candidate)) {
      commit = candidate;
      // Include untracked sources too: they can enter tsc output without belonging to HEAD.
      dirty = Boolean(git('status', '--porcelain', '--untracked-files=all', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json'));
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
