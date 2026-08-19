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
