/**
 * project-learning.ts — Automatic project context extraction
 *
 * Mirrors conversation-learning.ts but writes to workspace/projects/<id>/CONTEXT.md
 * instead of BUSINESS.md. Fires fire-and-forget after every assistant reply in a
 * project session. No LLM call — pure heuristic scan of the conversation.
 *
 * What it captures:
 *  - Project name / rename ("let's call it X" / "the project is called X")
 *  - Goals / outcomes ("the goal is", "we want to", "the objective is")
 *  - Key people ("John is the client", "Sarah is our designer", "working with Acme")
 *  - Tools / tech stack ("we're using React", "built on Postgres", "deployed on AWS")
 *  - Deadlines / milestones ("due by", "launch in", "deadline is")
 *  - Notes — anything else substantive the user said about the project
 */

import fs from 'fs';
import path from 'path';
import {
  getSession,
  PRE_COMPACTION_MEMORY_FLUSH_PROMPT,
  PRE_COMPACTION_SUMMARY_PROMPT,
} from '../session.js';
import {
  getProject,
  findProjectBySessionId,
  getProjectWorkspaceDir,
} from './project-store.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectLearningResult {
  skipped: boolean;
  reason?: string;
  sectionsUpdated: string[];
  linesAdded: number;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_USER_MESSAGES = 1; // fire even after first user reply
const MAX_CONVO_CHARS   = 8000;

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Called fire-and-forget after each assistant reply in a project session.
 * Scans the conversation for project facts and appends them to CONTEXT.md.
 */
export async function extractAndWriteProjectContext(
  messages: ConversationMessage[],
  sessionId: string,
  options?: { extraTextBlocks?: string[] },
): Promise<ProjectLearningResult> {
  const project = findProjectBySessionId(sessionId);
  if (!project) {
    // Not a project session — silent skip
    return { skipped: true, reason: 'not a project session', sectionsUpdated: [], linesAdded: 0 };
  }
  console.log(`[ProjectLearning] Scanning session ${sessionId} for project "${project.name}" (${messages.length} msgs)...`);

  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.length < MIN_USER_MESSAGES) {
    return { skipped: true, reason: 'too short', sectionsUpdated: [], linesAdded: 0 };
  }

  const transcript = buildLearningTranscript(userMessages, options?.extraTextBlocks);
  if (!transcript) {
    return { skipped: true, reason: 'no usable project context', sectionsUpdated: [], linesAdded: 0 };
  }

  const contextPath = path.join(getProjectWorkspaceDir(project.id), 'CONTEXT.md');

  // Read or seed the file
  let content = '';
  if (fs.existsSync(contextPath)) {
    content = fs.readFileSync(contextPath, 'utf-8');
  } else {
    content = `# ${project.name}\n\n## Overview\n\n## Goals\n\n## Key People & Entities\n\n## Tech Stack & Tools\n\n## Timeline & Milestones\n\n## Notes\n`;
    fs.mkdirSync(path.dirname(contextPath), { recursive: true });
    fs.writeFileSync(contextPath, content, 'utf-8');
  }

  const sectionsUpdated: string[] = [];
  let linesAdded = 0;

  // ── Extract facts ──────────────────────────────────────────────────────────
  const goals      = extractGoals(transcript);
  const people     = extractPeople(transcript);
  const tools      = extractTools(transcript);
  const milestones = extractMilestones(transcript);
  const name       = extractProjectName(transcript);

  // ── Apply to CONTEXT.md ───────────────────────────────────────────────────

  // Project name rename
  if (name && !content.includes(name)) {
    // Update the H1 title if it still matches the original project.name
    const h1Re = /^# .+$/m;
    if (h1Re.test(content)) {
      content = content.replace(h1Re, `# ${name}`);
      sectionsUpdated.push('title');
      linesAdded++;
    }
  }

  // Goals
  const addedGoals = appendToSection(content, '## Goals', goals, todayDate());
  if (addedGoals.added > 0) {
    content = addedGoals.content;
    sectionsUpdated.push('Goals');
    linesAdded += addedGoals.added;
  }

  // People
  const addedPeople = appendToSection(content, '## Key People & Entities', people, todayDate());
  if (addedPeople.added > 0) {
    content = addedPeople.content;
    sectionsUpdated.push('Key People & Entities');
    linesAdded += addedPeople.added;
  }

  // Tools
  const addedTools = appendToSection(content, '## Tech Stack & Tools', tools, todayDate());
  if (addedTools.added > 0) {
    content = addedTools.content;
    sectionsUpdated.push('Tech Stack & Tools');
    linesAdded += addedTools.added;
  }

  // Milestones
  const addedMilestones = appendToSection(content, '## Timeline & Milestones', milestones, todayDate());
  if (addedMilestones.added > 0) {
    content = addedMilestones.content;
    sectionsUpdated.push('Timeline & Milestones');
    linesAdded += addedMilestones.added;
  }

  // Stamp last-updated header if we changed anything
  if (linesAdded > 0) {
    const stampRe = /^> Last updated: .+$/m;
    const stamp = `> Last updated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    if (stampRe.test(content)) {
      content = content.replace(stampRe, stamp);
    } else {
      // Insert after the H1
      content = content.replace(/^(# .+\n)/, `$1\n${stamp}\n`);
    }

    // Remove placeholder text now that we have real data
    content = content
      .replace(/\*\(Prometheus will fill this in after your first conversation\.\)\*\n?/g, '')
      .replace(/\*\(Prometheus will fill this in\.\.\.\)\*\n?/g, '');

    fs.writeFileSync(contextPath, content, 'utf-8');
    console.log(`[ProjectLearning] Updated CONTEXT.md for "${project.name}" — ${linesAdded} line(s) in: ${sectionsUpdated.join(', ')}`);
  }

  return { skipped: false, sectionsUpdated, linesAdded };
}

export async function refreshProjectContextForSession(
  sessionId: string,
  options?: { extraTextBlocks?: string[] },
): Promise<ProjectLearningResult> {
  const project = findProjectBySessionId(sessionId);
  if (!project) {
    return { skipped: true, reason: 'not a project session', sectionsUpdated: [], linesAdded: 0 };
  }

  const session = getSession(sessionId);
  const messages: ConversationMessage[] = (Array.isArray(session.history) ? session.history : [])
    .filter((msg) => !isSyntheticProjectLearningNoise(msg?.content))
    .map((msg) => ({
      role: msg.role,
      content: String(msg.content || ''),
    }));

  return extractAndWriteProjectContext(messages, sessionId, options);
}

export async function refreshProjectContextFromLatestPriorSession(
  projectId: string,
  excludeSessionId?: string,
): Promise<ProjectLearningResult> {
  const project = getProject(projectId);
  if (!project) {
    return { skipped: true, reason: 'project not found', sectionsUpdated: [], linesAdded: 0 };
  }

  const priorSessions = project.sessions
    .filter((session) => session.id !== excludeSessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  for (const session of priorSessions) {
    const result = await refreshProjectContextForSession(session.id);
    if (!result.skipped || result.reason !== 'too short') {
      return result;
    }
  }

  return { skipped: true, reason: 'no previous project session with usable context', sectionsUpdated: [], linesAdded: 0 };
}

// ─── Extractors ───────────────────────────────────────────────────────────────

function extractGoals(text: string): string[] {
  const goals: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.length < 8) continue;

    // "the goal is X" / "our goal is X" / "we want to X" / "objective is X"
    const goalMatch = l.match(
      /(?:the|our|main|primary|key)\s+(?:goal|objective|aim|purpose|target)\s+is\s+(.{8,120})/i
    ) || l.match(/we(?:'re|\s+are)?\s+(?:trying to|aiming to|looking to|hoping to)\s+(.{8,100})/i)
      || l.match(/the\s+(?:project|this)\s+(?:is\s+)?(?:for|about)\s+(.{8,100})/i);
    if (goalMatch) {
      const val = cleanValue(goalMatch[1]);
      if (val) goals.push(val);
    }

    // "build X" / "create X" / "develop X" at sentence start
    const buildMatch = l.match(/^(?:build|create|develop|make|launch|ship)\s+(?:a\s+|an\s+)?(.{8,80})/i);
    if (buildMatch) {
      const val = cleanValue(buildMatch[1]);
      if (val) goals.push(val);
    }
  }
  return dedupe(goals).slice(0, 6);
}

function extractPeople(text: string): string[] {
  const people: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    // "John is the client" / "Sarah is our designer" / "working with Acme"
    const roleMatch = l.match(
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is\s+(?:the|our|my)\s+(\w[\w\s]{2,30})/
    );
    if (roleMatch) people.push(`${roleMatch[1]} — ${roleMatch[2].trim()}`);

    // "the client is Acme" / "our client Acme"
    const clientMatch = l.match(
      /(?:client|customer|account)\s+(?:is\s+)?([A-Z][A-Za-z0-9 &.'-]{2,30})/i
    );
    if (clientMatch) people.push(`Client: ${clientMatch[1].trim()}`);

    // "working with Acme Corp"
    const workingMatch = l.match(/working with\s+([A-Z][A-Za-z0-9 &.'-]{2,30})/);
    if (workingMatch) people.push(workingMatch[1].trim());
  }
  return dedupe(people).slice(0, 8);
}

function extractTools(text: string): string[] {
  const tools: string[] = [];
  const lines = text.split('\n');

  // Common tech keywords to look for
  const techRe = /\b(React|Vue|Angular|Next\.js|Nuxt|Svelte|TypeScript|JavaScript|Python|Node\.js|Express|FastAPI|Django|Flask|PostgreSQL|MySQL|SQLite|MongoDB|Redis|Prisma|Drizzle|Tailwind|shadcn|Material UI|Vercel|Netlify|AWS|GCP|Azure|Docker|Kubernetes|GitHub|GitLab|Linear|Notion|Figma|Stripe|Twilio|OpenAI|Anthropic|Claude|Supabase|Firebase|PlanetScale|Neon)\b/gi;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    // "we're using X" / "built with X" / "using X for Y"
    const usingMatch = l.match(/(?:we're|we are|using|built with|built on|powered by|runs on)\s+([A-Za-z0-9 ,./+#-]{4,60})/i);
    if (usingMatch) {
      const val = cleanValue(usingMatch[1]);
      if (val && val.length > 3) tools.push(val);
    }

    // Detect well-known tech names mentioned casually
    const techMatches = l.match(techRe);
    if (techMatches) {
      for (const t of techMatches) tools.push(t);
    }
  }
  return dedupe(tools).slice(0, 10);
}

function extractMilestones(text: string): string[] {
  const milestones: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    // "due by March" / "launch in Q2" / "deadline is Friday" / "ship by next month"
    const dateMatch = l.match(
      /(?:due|launch|deadline|ship|release|go live|complete|finish|deliver)\s+(?:by|in|on|before)?\s+(.{4,60})/i
    );
    if (dateMatch) {
      const val = cleanValue(dateMatch[1]);
      if (val) milestones.push(val);
    }
  }
  return dedupe(milestones).slice(0, 5);
}

function extractProjectName(text: string): string | null {
  // "let's call it X" / "the project is called X" / "project name is X"
  const nameMatch = text.match(
    /(?:let's call it|project is called|project name is|rename it to|call the project)\s+["']?([A-Z][A-Za-z0-9 &.'-]{2,40})["']?/i
  );
  return nameMatch ? cleanValue(nameMatch[1]) : null;
}

// ─── CONTEXT.md section writer ────────────────────────────────────────────────

function appendToSection(
  content: string,
  sectionHeader: string,
  items: string[],
  date: string,
): { content: string; added: number } {
  if (!items.length) return { content, added: 0 };

  let added = 0;

  // Ensure section exists
  if (!content.includes(sectionHeader)) {
    content += `\n${sectionHeader}\n`;
  }

  const insertMarker = `${sectionHeader}\n`;
  const insertPos = content.indexOf(insertMarker) + insertMarker.length;

  for (const item of items) {
    const line = `- ${item}  <!-- ${date} -->\n`;
    // Don't duplicate — check if the core value is already present
    const coreValue = item.split('<!--')[0].trim().toLowerCase();
    const contentLower = content.toLowerCase();
    if (!contentLower.includes(coreValue)) {
      content = content.slice(0, insertPos) + line + content.slice(insertPos);
      added++;
    }
  }

  return { content, added };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isSyntheticProjectLearningNoise(raw: string): boolean {
  const text = String(raw || '').trim();
  if (!text) return true;
  if (text === PRE_COMPACTION_SUMMARY_PROMPT) return true;
  if (text === PRE_COMPACTION_MEMORY_FLUSH_PROMPT) return true;
  if (text === 'NO_REPLY') return true;
  if (/^\[(?:Rolling|Compacted) context summary\]/i.test(text)) return true;
  if (/^CONTEXT:\s+Internal context compaction turn\./i.test(text)) return true;
  if (/^CONTEXT:\s+Internal pre-compaction memory flush turn\./i.test(text)) return true;
  return false;
}

function buildLearningTranscript(
  messages: ConversationMessage[],
  extraTextBlocks?: string[],
): string {
  const parts: string[] = [];
  const userBlock = messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content || '').trim())
    .filter(Boolean)
    .join('\n');
  if (userBlock) parts.push(userBlock);
  for (const block of extraTextBlocks || []) {
    const clean = String(block || '').trim();
    if (clean) parts.push(clean);
  }
  return parts.join('\n\n').slice(0, MAX_CONVO_CHARS);
}

function cleanValue(raw: string): string {
  return raw
    .trim()
    .replace(/[.!?]+$/, '')   // strip trailing punctuation
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}
