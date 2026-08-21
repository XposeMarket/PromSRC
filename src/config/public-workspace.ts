import fs from 'fs';
import path from 'path';

const PUBLIC_WORKSPACE_DIRS = [
  '.prometheus/subagents',
  'memory',
  'projects',
  'generated',
  'uploads',
  'downloads',
  'skills',
] as const;

/**
 * Factory documents for a brand-new Prometheus workspace.
 *
 * These files are intentionally generic and contain no install/user-specific
 * facts. Existing files are NEVER overwritten by ensurePublicWorkspaceScaffold.
 * Feature-specific files and directories are created lazily by the feature that
 * owns them rather than pre-populating a fresh workspace with runtime internals.
 */
const PUBLIC_WORKSPACE_FILES: Record<string, string> = {
  'AGENTS.md': [
    '# AGENTS.md - Workspace Contract',
    '',
    'This workspace is durable user-owned Prometheus state.',
    '',
    '## Operating Rules',
    '- Treat existing workspace files as user-owned. Do not overwrite or delete them merely because Prometheus was updated or reinstalled.',
    '- Prefer narrow, understandable edits over broad rewrites.',
    '- Keep durable work in organized workspace files when it should survive the current chat.',
    '- External side effects still require the approval rules configured for this Prometheus installation.',
    '',
    '## Agent Workspaces',
    '- Standalone subagent identities live under `.prometheus/subagents/<agentId>/`.',
    '- Team shared work and team-scoped identities live under `teams/<teamId>/` when teams are created.',
    '- External repositories can remain external; they do not need to be copied into this workspace.',
  ].join('\n'),

  'SOUL.md': [
    '# SOUL.md - Prometheus',
    '',
    'Prometheus is a durable AI collaborator that works with the same user over time.',
    '',
    '## Core Style',
    '- Be capable, direct, curious, warm, and grounded.',
    '- Prefer useful action and verified results over ceremony.',
    '- Be concise for simple work and thorough when complexity or risk justifies it.',
    '- Preserve continuity without pretending to know things that are not actually available in memory or workspace state.',
    '',
    '## Workspace Discipline',
    '- Inspect real state before making claims about files, projects, tools, connections, or prior work.',
    '- Preserve user-owned changes and unrelated work.',
    '- Use tools when execution or inspection is actually needed; normal conversation does not need performative tool use.',
  ].join('\n'),

  'IDENTITY.md': [
    '# IDENTITY.md - Prometheus Identity',
    '',
    '> User-editable identity details for this Prometheus installation.',
    '',
    '## Name',
    '- Prometheus',
    '',
    '## Display / Persona Notes',
    '- ',
    '',
    '## Relationship / Collaboration Notes',
    '- ',
  ].join('\n'),

  'USER.md': [
    '# USER.md - User Profile',
    '',
    '> Durable facts and preferences about the person using this Prometheus installation. Fill this in through normal use or onboarding.',
    '',
    '## Identity',
    '- Name: ',
    '- Location / timezone: ',
    '',
    '## Communication Preferences',
    '- Preferred tone: ',
    '- Preferred response length: ',
    '- Things to avoid: ',
    '',
    '## Working Style',
    '- ',
    '',
    '## Current Priorities',
    '- ',
    '',
    '## Notes',
    '- ',
  ].join('\n'),

  'TOOLS.md': [
    '# TOOLS.md - Workspace Notes',
    '',
    '> Optional human-readable notes about tools, environments, machines, repositories, and workflows relevant to this workspace.',
    '',
    'The live Prometheus tool registry and security policy remain the source of truth for actual tool availability and permissions.',
    '',
    '## Notes',
    '- ',
  ].join('\n'),

  'BOOTSTRAP.md': [
    '# BOOTSTRAP.md - First Run',
    '',
    'This file exists only to help initialize a new Prometheus relationship.',
    '',
    'During onboarding, learn only what is useful for future collaboration: who the user is, how they like to work, what they are currently building, and any durable preferences they explicitly want remembered.',
    '',
    'Do not manufacture a biography or fill blank profile fields from guesses.',
    '',
    'After onboarding is complete, Prometheus may remove this file. Onboarding completion is tracked separately in runtime state, so recreating this file later must not silently reset or rerun onboarding.',
  ].join('\n'),
};

/**
 * Copy bundled skills from the app package into a skills directory.
 * Only copies skills that do not already exist — never overwrites user customizations.
 */
export function seedBundledSkillsIntoDir(targetSkillsDir: string, bundledSkillsDir: string): void {
  if (!fs.existsSync(bundledSkillsDir)) return;
  fs.mkdirSync(targetSkillsDir, { recursive: true });

  let seeded = 0;
  for (const entry of fs.readdirSync(bundledSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const srcSkillDir = path.join(bundledSkillsDir, entry.name);
    const srcMd = path.join(srcSkillDir, 'SKILL.md');
    const srcMdLower = path.join(srcSkillDir, 'skill.md');
    const srcManifest = path.join(srcSkillDir, 'skill.json');
    if (!fs.existsSync(srcMd) && !fs.existsSync(srcMdLower) && !fs.existsSync(srcManifest)) continue;

    const destSkillDir = path.join(targetSkillsDir, entry.name);
    if (
      fs.existsSync(path.join(destSkillDir, 'SKILL.md')) ||
      fs.existsSync(path.join(destSkillDir, 'skill.md')) ||
      fs.existsSync(path.join(destSkillDir, 'skill.json'))
    ) continue;

    try {
      fs.cpSync(srcSkillDir, destSkillDir, { recursive: true, force: false });
      seeded++;
    } catch {
      // Ignore a single skill failure so one malformed bundle never prevents
      // first-run workspace initialization.
    }
  }

  if (seeded > 0) {
    console.log(`[Skills] Seeded ${seeded} bundled skill(s) into ${targetSkillsDir}`);
  }
}

export function seedBundledSkills(workspacePath: string, bundledSkillsDir: string): void {
  seedBundledSkillsIntoDir(path.join(workspacePath, 'skills'), bundledSkillsDir);
}

/**
 * Ensure the minimal durable workspace exists.
 *
 * IMPORTANT: this function is additive only. It never removes files and never
 * rewrites an existing profile/identity/workspace document during application
 * startup or update.
 */
export function ensurePublicWorkspaceScaffold(workspacePath: string): void {
  fs.mkdirSync(workspacePath, { recursive: true });

  for (const relDir of PUBLIC_WORKSPACE_DIRS) {
    fs.mkdirSync(path.join(workspacePath, relDir), { recursive: true });
  }

  for (const [relFile, content] of Object.entries(PUBLIC_WORKSPACE_FILES)) {
    const absPath = path.join(workspacePath, relFile);
    if (fs.existsSync(absPath)) continue;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, `${content.trimEnd()}\n`, 'utf-8');
  }
}
