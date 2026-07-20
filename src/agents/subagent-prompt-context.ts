import fs from 'fs';
import path from 'path';
import { readAgentPromptFile } from './agent-prompt-file.js';

export const SUBAGENT_IDENTITY_OPEN = '[AGENT_IDENTITY - PRIVATE TO THIS AGENT]';
export const SUBAGENT_IDENTITY_CLOSE = '[/AGENT_IDENTITY]';
export const SUBAGENT_MEMORY_OPEN = '[AGENT_MEMORY - PRIVATE TO THIS AGENT]';
export const SUBAGENT_MEMORY_CLOSE = '[/AGENT_MEMORY]';
const DEFAULT_MEMORY_LIMIT = 6000;

export const SUBAGENT_IDENTITY_STUB = `You are a distinct autonomous agent operating inside Prometheus, not Prom or the main chat.
You operate in EXECUTE mode: use the tools actually exposed in this runtime to read/write files, run code, and call APIs.
Inspect the available tools before claiming a capability is unavailable.
Always verify your work with a tool call before reporting completion.
If you are unsure what to do, list the workspace directory first, then act.`.trim();

function readCappedFile(filePath: string, maxChars: number): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return '';
    return content.length <= maxChars
      ? content
      : `${content.slice(0, Math.max(0, maxChars - 30)).trimEnd()}\n...[personal memory truncated]`;
  } catch {
    return '';
  }
}

/**
 * Builds the only identity/memory block used by subagent runtimes. Callers pass
 * their resolved per-agent roots; this helper never discovers or reads the main
 * Prometheus workspace, so USER.md/SOUL.md/root MEMORY.md cannot bleed in.
 */
export function buildSubagentIdentityMemoryContext(options: {
  identityRoot?: string;
  memoryRoot?: string;
  memoryLimit?: number;
  includeIdentityStub?: boolean;
}): string {
  const identityRoot = String(options.identityRoot || '').trim();
  const memoryRoot = String(options.memoryRoot || identityRoot).trim();
  const identity = identityRoot
    ? String(readAgentPromptFile(identityRoot, { migrateLegacy: true })?.content || '').trim()
    : '';
  const identityContent = identity || (options.includeIdentityStub === false ? '' : SUBAGENT_IDENTITY_STUB);
  const memory = memoryRoot
    ? readCappedFile(path.join(memoryRoot, 'MEMORY.md'), options.memoryLimit ?? DEFAULT_MEMORY_LIMIT)
    : '';
  const memoryContent = memory || 'No private MEMORY.md has been created for this agent yet.';
  return [
    identityContent ? `${SUBAGENT_IDENTITY_OPEN}\n${identityContent}\n${SUBAGENT_IDENTITY_CLOSE}` : '',
    `${SUBAGENT_MEMORY_OPEN}\nUse memory_read/memory_write with file="memory" for this file. USER/SOUL memory belongs to main Prometheus and is unavailable here.\n${memoryContent}\n${SUBAGENT_MEMORY_CLOSE}`,
  ].filter(Boolean).join('\n\n');
}
