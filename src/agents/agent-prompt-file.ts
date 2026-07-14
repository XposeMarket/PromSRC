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
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(filePath, String(defaultContent || ''), 'utf-8');
  return {
    path: filePath,
    content: String(defaultContent || ''),
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
