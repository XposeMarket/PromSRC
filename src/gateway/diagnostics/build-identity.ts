import fs from 'fs';
import path from 'path';

export interface BuildIdentity {
  status: 'exact' | 'modified' | 'unknown';
  version: string | null;
  commit: string | null;
  builtAt: string | null;
  reason: string | null;
  platform: string;
  architecture: string;
  node: string;
  playbookVersion: 1;
}
const installedManifest = path.resolve(__dirname, '../../config/build-identity.json');
export function readBuildIdentity(manifestPath = installedManifest): BuildIdentity {
  const unknown = (reason: string): BuildIdentity => ({ status: 'unknown', version: null, commit: null, builtAt: null, reason, platform: process.platform, architecture: process.arch, node: process.version, playbookVersion: 1 });
  try {
    if (!fs.existsSync(manifestPath)) return unknown('Build manifest unavailable; do not substitute latest source.');
    if (fs.statSync(manifestPath).size > 4096) return unknown('Build manifest exceeds size limit.');
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!m || m.schemaVersion !== 1 || m.playbookVersion !== 1
      || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(m.version)
      || !(m.commit === null || (typeof m.commit === 'string' && /^[a-f0-9]{40,64}$/.test(m.commit)))
      || !(m.dirty === null || typeof m.dirty === 'boolean')
      || typeof m.builtAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(m.builtAt) || !Number.isFinite(Date.parse(m.builtAt))) return unknown('Invalid build manifest; source match unavailable.');
    const status = m.commit && m.dirty === false ? 'exact' : m.dirty === true ? 'modified' : 'unknown';
    return { ...unknown('Source identity unavailable.'), status, version: m.version, commit: m.commit, builtAt: m.builtAt,
      reason: status === 'exact' ? null : status === 'modified' ? 'Build contained local changes; commit alone cannot reproduce it.' : 'Build did not establish a clean source commit.' };
  } catch { return unknown('Build manifest could not be read; source match unavailable.'); }
}

export function diagnosticTriage(identity: BuildIdentity) {
  return {
    version: 1 as const,
    sourceMatch: identity.status === 'exact' ? 'match-recorded-commit' : 'unavailable',
    sourceCommit: identity.status === 'exact' ? identity.commit : null,
    steps: [
      'Preview all packet fields before sharing. Redaction is best-effort, not proof that every private value was removed.',
      'Reproduce with an isolated fixture; distinguish configuration, dependency, provider outage and application defect using evidence.',
      identity.status === 'exact' ? `Use source or symbols for recorded commit ${identity.commit}; do not silently use latest source.` : 'Exact source match is unavailable. Preserve that uncertainty; obtain the matching build manifest before source-level conclusions.',
      'Record expected behavior, actual behavior, reproduction steps and unresolved uncertainty. Search existing issues before preparing a new issue.',
      'Do not modify the installed app, execute downloaded source, or submit an issue without the applicable approval.',
    ],
    disclosure: 'Local build metadata is not a signed attestation. No source was downloaded or executed.',
  };
}
