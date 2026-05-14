import * as fs from 'fs';
import * as path from 'path';

export interface OnboardingProfile {
  name?: string;             // What should I call you
  workingOn?: string;        // What you're working on / building
  helpWanted?: string;       // How they want help
  businessContext?: string;  // Business/project context
  workingPreferences?: string;
  thingsToAvoid?: string;
  toolsAndAccounts?: string;
}

export interface SeedFilePlan {
  path: string;
  exists: boolean;
  currentContent: string;
  proposedContent: string;
  changed: boolean;
}

const START_TAG = '<!-- onboarding:start v1 -->';
const END_TAG   = '<!-- onboarding:end -->';

function workspaceDir(): string {
  return process.env.PROMETHEUS_WORKSPACE_DIR || path.join(process.cwd(), 'workspace');
}

function readSafe(fp: string): { exists: boolean; content: string } {
  try {
    if (fs.existsSync(fp)) return { exists: true, content: fs.readFileSync(fp, 'utf8') };
  } catch { /* ignore */ }
  return { exists: false, content: '' };
}

function buildSection(title: string, lines: Array<[string, string | undefined]>): string | null {
  const filled = lines.filter(([, v]) => v && v.trim());
  if (!filled.length) return null;
  const body = filled.map(([k, v]) => `- **${k}:** ${v!.trim()}`).join('\n');
  return `${START_TAG}\n## ${title}\n_Captured during first-run onboarding._\n\n${body}\n${END_TAG}`;
}

function upsertSection(current: string, section: string | null): string {
  if (!section) return current;
  if (current.includes(START_TAG) && current.includes(END_TAG)) {
    const re = new RegExp(`${START_TAG}[\\s\\S]*?${END_TAG}`, 'm');
    return current.replace(re, section);
  }
  const sep = current && !current.endsWith('\n') ? '\n\n' : (current ? '\n' : '');
  return current + sep + section + '\n';
}

export function planSeed(profile: OnboardingProfile): SeedFilePlan[] {
  const ws = workspaceDir();
  const targets: Array<{ file: string; section: string | null }> = [
    {
      file: 'USER.md',
      section: buildSection('User profile', [
        ['Preferred name', profile.name],
        ['Currently working on', profile.workingOn],
        ['How they want help', profile.helpWanted],
        ['Working preferences', profile.workingPreferences],
        ['Things to avoid', profile.thingsToAvoid],
      ]),
    },
    {
      file: 'BUSINESS.md',
      section: buildSection('Business / project context', [
        ['Context', profile.businessContext],
      ]),
    },
    {
      file: 'TOOLS.md',
      section: buildSection('Tools and accounts the user expects to use', [
        ['Stack', profile.toolsAndAccounts],
      ]),
    },
    {
      file: 'MEMORY.md',
      section: buildSection('Initial onboarding notes', [
        ['Name', profile.name],
        ['Goal', profile.workingOn],
        ['Avoid', profile.thingsToAvoid],
      ]),
    },
  ];

  return targets.map(({ file, section }) => {
    const fp = path.join(ws, file);
    const { exists, content } = readSafe(fp);
    const proposed = upsertSection(content, section);
    return {
      path: fp,
      exists,
      currentContent: content,
      proposedContent: proposed,
      changed: proposed !== content,
    };
  });
}

export function applySeed(plans: SeedFilePlan[], approvedPaths: string[]): string[] {
  const written: string[] = [];
  const allow = new Set(approvedPaths);
  for (const p of plans) {
    if (!p.changed) continue;
    if (!allow.has(p.path)) continue;
    fs.mkdirSync(path.dirname(p.path), { recursive: true });
    const tmp = p.path + '.tmp';
    fs.writeFileSync(tmp, p.proposedContent, 'utf8');
    fs.renameSync(tmp, p.path);
    written.push(p.path);
  }
  return written;
}
