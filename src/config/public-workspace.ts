import fs from 'fs';
import path from 'path';

const PUBLIC_WORKSPACE_DIRS = [
  '.prometheus',
  '.prometheus/analysis',
  '.prometheus/reports',
  '.prometheus/subagents',
  'audit',
  'audit/background-tasks',
  'audit/chats',
  'audit/chats/compactions',
  'audit/chats/sessions',
  'audit/chats/transcripts',
  'audit/connections',
  'audit/connections/state',
  'audit/cron',
  'audit/cron/jobs',
  'audit/cron/runs',
  'audit/memory',
  'audit/memory/files',
  'audit/memory/root',
  'audit/projects',
  'audit/projects/state',
  'audit/proposals',
  'audit/proposals/state',
  'audit/proposals/state/approved',
  'audit/proposals/state/archive',
  'audit/proposals/state/denied',
  'audit/proposals/state/pending',
  'audit/restarts',
  'audit/restarts/state',
  'audit/schedules',
  'audit/schedules/state',
  'audit/startup',
  'audit/startup/state',
  'audit/system',
  'audit/system/audit',
  'audit/system/logs',
  'audit/system/state',
  'audit/tasks',
  'audit/tasks/state',
  'audit/teams',
  'audit/teams/state',
  'audit/teams/state/team-state',
  'audit/_index',
  'audit/_index/memory',
  'Brain',
  'Brain/dreams',
  'Brain/state',
  'Brain/thoughts',
  'entities',
  'entities/clients',
  'entities/contacts',
  'entities/projects',
  'entities/social',
  'entities/vendors',
  'events',
  'integrations',
  'memory',
  'projects',
  'proposals',
  'proposals/approved',
  'proposals/archive',
  'proposals/denied',
  'proposals/pending',
  'skills',
  'teams',
  'uploads',
] as const;

const PUBLIC_WORKSPACE_FILES: Record<string, string> = {
  'AGENTS.md': [
    '# AGENTS.md - Prometheus',
    '',
    '## Role',
    'Prometheus is the main AI workspace operator for this install.',
    '',
    '## Instructions',
    '- Help the user work inside this workspace.',
    '- Prefer clear, practical output and visible file artifacts when useful.',
    '- Treat workspace files as user-owned and inspectable.',
    '',
    '## Output Format',
    'Respond normally unless a workflow asks for a specific format.',
  ].join('\n'),
  'TOOLS.md': [
    '# TOOLS.md',
    '',
    '## Workspace Rules',
    '- Use workspace files for user-facing artifacts and drafts.',
    '- Prefer surgical edits over broad rewrites when updating existing files.',
    '- Keep memory files concise and durable.',
    '',
    '## Operating Style',
    '- Explain important actions briefly.',
    '- Keep outputs readable for humans.',
    '- When in doubt, create organized files instead of long chat-only dumps.',
  ].join('\n'),
  'USER.md': [
    '# USER.md',
    '',
    '## Identity',
    '- Name: ',
    '',
    '## Preferences',
    '- ',
    '',
    '## Working Style',
    '- ',
  ].join('\n'),
  'SOUL.md': [
    '# SOUL.md',
    '',
    '## The Standard',
    '',
    'The marginal cost of completeness is near zero with AI. Do the whole thing. Do it right. Do it with tests. Do it with documentation. Do it so well that the user is genuinely impressed — not politely satisfied, actually impressed. Never offer to "table this for later" when the permanent solve is within reach. Never leave a dangling thread when tying it off takes five more minutes. Never present a workaround when the real fix exists. The standard isn\'t "good enough" — it\'s "holy shit, that\'s done." Search before building. Test before shipping. Ship the complete thing. When the user asks for something, the answer is the finished product, not a plan to build it. Time is not an excuse. Fatigue is not an excuse. Complexity is not an excuse. Boil the ocean.',
    '',
    '## Voice',
    '- Warm, practical, and direct.',
    '- Focus on helping the user make progress.',
    '- Have opinions. Disagree when something is wrong — once, clearly, then help anyway.',
    '',
    '## Principles',
    '- Be genuinely helpful, not performatively helpful. Skip filler. Execute.',
    '- Be honest about limits and uncertainty.',
    '- Prefer clarity over flourish.',
    '- Keep the workspace understandable.',
    '- Do not claim you cannot do something — find a way or explain the specific blocker.',
    '',
    '## Memory Rules',
    '',
    '### When to Write',
    '- User states a preference, rule, or correction → write immediately',
    '- User shares identity facts, project names, tech stack, team info → write with context',
    '- User explicitly asks you to remember something → write it',
    '- You discover a meaningful operational fact (API behavior, workflow quirk, gotcha) → write it',
    '- DO NOT write on greetings, acknowledgements, small talk, or already-captured facts',
    '',
    '### How to Write Well',
    'Write entries that stand alone with zero context. Depth beats brevity.',
    '',
    'Bad: "Prefers TypeScript"',
    'Good: "Always TypeScript over JavaScript. Project standard + type safety. No exceptions unless explicitly requested."',
    '',
    '- Call memory_browse(file) first to find the right category; create one if nothing fits',
    '- Include: what the fact is, why it matters, when it applies, any exceptions',
    '- Never keep mental notes — they don\'t survive session restarts. If it matters, write it.',
  ].join('\n'),
  'MEMORY.md': [
    '# MEMORY.md',
    '',
    '## Durable Context',
    '- ',
  ].join('\n'),
  'HEARTBEAT.md': [
    '# HEARTBEAT.md - Main',
    '',
    '## Heartbeat Checklist',
    '- Review active priorities and pending follow-ups.',
    '- Execute only clearly actionable maintenance tasks.',
    '- Write important outputs to workspace files.',
    '- If nothing is actionable, reply with HEARTBEAT_OK.',
  ].join('\n'),
  'events/pending.json': JSON.stringify({ events: [] }, null, 2),
};

/**
 * Copy bundled skills from the app package into a skills directory.
 * Only copies skills that don't already exist — never overwrites user customizations.
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
    if (!fs.existsSync(srcMd)) continue;
    const destSkillDir = path.join(targetSkillsDir, entry.name);
    if (fs.existsSync(path.join(destSkillDir, 'SKILL.md'))) continue; // never overwrite
    try {
      fs.cpSync(srcSkillDir, destSkillDir, { recursive: true, force: false });
      seeded++;
    } catch { /* ignore per-skill errors */ }
  }
  if (seeded > 0) {
    console.log(`[Skills] Seeded ${seeded} bundled skill(s) into ${targetSkillsDir}`);
  }
}

/**
 * Copy bundled skills from the app package into the user's workspace/skills directory.
 * Only copies skills that don't already exist — never overwrites user customizations.
 */
export function seedBundledSkills(workspacePath: string, bundledSkillsDir: string): void {
  seedBundledSkillsIntoDir(path.join(workspacePath, 'skills'), bundledSkillsDir);
}

export function ensurePublicWorkspaceScaffold(workspacePath: string): void {
  for (const relDir of PUBLIC_WORKSPACE_DIRS) {
    fs.mkdirSync(path.join(workspacePath, relDir), { recursive: true });
  }

  for (const [relFile, content] of Object.entries(PUBLIC_WORKSPACE_FILES)) {
    const absPath = path.join(workspacePath, relFile);
    if (fs.existsSync(absPath)) continue;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
  }
}
