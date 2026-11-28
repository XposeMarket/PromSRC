import fs from 'fs';
import path from 'path';

export const AGENT_PROMPT_FILENAME = 'AGENT.md';
export const LEGACY_AGENT_PROMPT_FILENAMES = ['agent.md', 'system_prompt.md', 'AGENTS.md'] as const;

export interface AgentPromptFile {
  path: string;
  content: string;
  sourceFilename: string;
  migrated: boolean;
}

function readText(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Older ensureAgentWorkspace callers still pass the historical bootstrap
 * scaffold that mixed identity with runtime policy (including a prompt to list
 * allowed tools). New agents should treat AGENT.md as identity/purpose only;
 * actual tool/workspace/run policy is enforced structurally by the runtime.
 *
 * This only normalizes the known generated bootstrap template. Explicit user
 * writes, migrated legacy AGENT.md files, and unrelated bootstrap templates
 * remain byte-for-byte untouched.
 */
export function normalizeAgentPromptBootstrap(defaultContent: string): string {
  const source = String(defaultContent || '');
  const raw = source.trim();
  if (!raw) return source;

  const isLegacyGeneratedBootstrap = raw.includes('## Role')
    && raw.includes('## Instructions')
    && raw.includes('- List tools this agent is allowed to use.');
  if (!isLegacyGeneratedBootstrap) return source;

  const name = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Agent';
  const roleMatch = raw.match(/## Role\s*\n([\s\S]*?)(?=\n## Instructions|$)/);
  const role = String(roleMatch?.[1] || '').trim();
  const purpose = /^No description set\./i.test(role) ? '' : role;

  return [
    `# ${name}`,
    purpose ? `\n## Purpose\n${purpose}` : '',
    `\n## Working Identity\nYou are ${name}, a distinct Prometheus Bot. Work within the capabilities and workspace access Prometheus actually exposes to you.`,
  ].filter(Boolean).join('\n').trim() + '\n';
}

/**
 * Resolve an agent's canonical identity prompt.
 *
 * AGENT.md is authoritative. Older workspaces are migrated lazily and
 * non-destructively: the legacy file remains in place while its contents are
 * copied to AGENT.md. HEARTBEAT.md remains a scheduler contract and is never
 * treated as an identity fallback.
 */
export function readAgentPromptFile(
  workspacePath: string,
  options: { migrateLegacy?: boolean } = {},
): AgentPromptFile | null {
  const workspace = path.resolve(String(workspacePath || '.'));
  const canonicalPath = path.join(workspace, AGENT_PROMPT_FILENAME);
  const canonical = readText(canonicalPath);
  if (canonical !== null) {
    return {
      path: canonicalPath,
      content: canonical,
      sourceFilename: AGENT_PROMPT_FILENAME,
      migrated: false,
    };
  }

  for (const filename of LEGACY_AGENT_PROMPT_FILENAMES) {
    const legacyPath = path.join(workspace, filename);
    const content = readText(legacyPath);
    if (content === null) continue;
    let migrated = false;
    if (options.migrateLegacy !== false) {
      try {
        fs.mkdirSync(workspace, { recursive: true });
        fs.writeFileSync(canonicalPath, content, 'utf-8');
        migrated = true;
      } catch {
        // Read compatibility still works if the migration cannot be persisted.
      }
    }
    return {
      path: migrated ? canonicalPath : legacyPath,
      content,
      sourceFilename: filename,
      migrated,
    };
  }

  return null;
}

export function ensureAgentPromptFile(workspacePath: string, defaultContent: string): AgentPromptFile {
  const existing = readAgentPromptFile(workspacePath, { migrateLegacy: true });
  if (existing) return existing;
  const workspace = path.resolve(String(workspacePath || '.'));
  const filePath = path.join(workspace, AGENT_PROMPT_FILENAME);
  const content = normalizeAgentPromptBootstrap(defaultContent);
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return {
    path: filePath,
    content,
    sourceFilename: AGENT_PROMPT_FILENAME,
    migrated: false,
  };
}

export function writeAgentPromptFile(workspacePath: string, content: string): string {
  const workspace = path.resolve(String(workspacePath || '.'));
  const filePath = path.join(workspace, AGENT_PROMPT_FILENAME);
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(filePath, String(content || ''), 'utf-8');
  return filePath;
}

const LEGACY_STANDALONE_SENTENCE = 'You are a standalone one-off subagent, not a member of a managed team.';
const LEGACY_EDIT_NOTE = '**Note:** Edit this file to modify the subagent. Changes take effect on next call.';
// The generated block was always exactly these three lines, in this order.
const LEGACY_CONFIG_BLOCK = [/^- Max steps: \d+$/, /^- Timeout: \d+ms$/, /^- Model override: .+$/];

/**
 * Removes lines that older builds generated into AGENT.md and that are false or empty when
 * the file is read into a run:
 *  - "You are a standalone one-off subagent, not a member of a managed team." (written for
 *    every agent, including team members)
 *  - the "## Configuration" block of Max steps / Timeout / Model override (nothing enforces
 *    the first two, so agents were told limits that do not exist)
 *  - the user-facing "Edit this file" note
 *  - generated sections with nothing in them, and repeated bullets inside the generated
 *    personality section
 *
 * Read-time only: the file on disk is never rewritten, so hand edits are safe. Only whole
 * lines that match the generated text exactly are dropped, and the Configuration block only
 * when it is the complete three-line generated block. Text a user wrote that merely mentions
 * timeouts, teams or configuration is kept, a partial or edited Configuration section is
 * kept, nothing inside a fenced code block is touched, and a file with no generated legacy
 * lines is returned unchanged.
 */
export function stripLegacyGeneratedAgentPromptLines(content: string): string {
  const source = String(content || '');
  if (!source) return source;
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  let changed = false;
  let inPersonality = false;
  let inFence = false;
  let seenBullets = new Set<string>();

  const nextContentIndex = (from: number): number => {
    let j = from;
    while (j < lines.length && lines[j].trim() === '') j++;
    return j;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced examples are the user's content, whatever they look like.
    if (/^(?:```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (/^## /.test(trimmed)) {
      inPersonality = trimmed === '## Personality And Voice';
      seenBullets = new Set<string>();
    }

    if (trimmed === LEGACY_STANDALONE_SENTENCE || trimmed === LEGACY_EDIT_NOTE) {
      changed = true;
      continue;
    }

    // A rule line that only introduced the edit note.
    if (trimmed === '---' && lines[nextContentIndex(i + 1)]?.trim() === LEGACY_EDIT_NOTE) {
      changed = true;
      continue;
    }

    if (trimmed === '## Configuration') {
      const isGeneratedBlock = LEGACY_CONFIG_BLOCK.every((pattern, k) => pattern.test(String(lines[i + 1 + k] ?? '').trim()));
      const j = i + 1 + LEGACY_CONFIG_BLOCK.length;
      // Followed by nothing, or only by the generated note / another heading: anything else
      // means someone added to the section, so it stays.
      const after = nextContentIndex(j);
      const endsCleanly = after >= lines.length || /^(?:## |---$)/.test(lines[after].trim());
      if (isGeneratedBlock && endsCleanly) {
        changed = true;
        i = j - 1;
        continue;
      }
    }

    // Generated headings whose body is empty or a placeholder.
    if (trimmed === '## Constraints (DO NOT VIOLATE)') {
      const j = nextContentIndex(i + 1);
      if (j >= lines.length || /^## /.test(lines[j].trim())) {
        changed = true;
        continue;
      }
    }
    if (trimmed === '## Forbidden Tools' || trimmed === '## Base Preset Role') {
      const placeholder = trimmed === '## Forbidden Tools' ? '(none)' : '(not recorded)';
      const j = nextContentIndex(i + 1);
      const after = nextContentIndex(j + 1);
      if (lines[j]?.trim() === placeholder && (after >= lines.length || /^(?:## |---$)/.test(lines[after].trim()))) {
        changed = true;
        i = j;
        continue;
      }
    }

    if (inPersonality && trimmed.startsWith('- ')) {
      if (seenBullets.has(trimmed)) {
        changed = true;
        continue;
      }
      seenBullets.add(trimmed);
    }

    out.push(line);
  }

  if (!changed) return source;
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}
