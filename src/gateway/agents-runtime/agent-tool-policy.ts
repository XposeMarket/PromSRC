/**
 * Agent tool policy: one resolver shared by every subagent / team-member runtime path.
 *
 * Default (no allowlist): the agent gets exactly the main-chat tool system, i.e. core tools
 * plus automatic keyword category activation from its actual task text, plus
 * request_tool_category for anything else. Nothing is pre-loaded "just in case".
 *
 * Minimal agent (allowed_tools set): the agent's config lists exact tool names. That list is
 * passed to handleChat as the tool filter; handleChat pre-activates the categories those names
 * live in, so e.g. allowed_tools:["workspace_run"] really exposes workspace_run even though the
 * task text never mentioned a terminal. The agent never sees any tool outside the list.
 */
import fs from 'fs';
import path from 'path';
import { ensureAgentWorkspace, getAgentById, getConfig } from '../../config/config';

function cleanToolList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean)));
}

function readAgentConfigFile(agentId: string, agent: any): any | null {
  const roots = new Set<string>();
  try {
    if (agent) roots.add(path.join(ensureAgentWorkspace(agent), 'config.json'));
  } catch { /* best effort */ }
  try {
    const cfg = getConfig().getConfig() as any;
    const workspaceRoot = String(cfg?.workspace?.path || getConfig().getWorkspacePath?.() || '').trim();
    if (workspaceRoot) roots.add(path.join(workspaceRoot, '.prometheus', 'subagents', agentId, 'config.json'));
  } catch { /* best effort */ }
  roots.add(path.join(process.cwd(), '.prometheus', 'subagents', agentId, 'config.json'));
  for (const file of roots) {
    try {
      if (!fs.existsSync(file)) continue;
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch { /* try next root */ }
  }
  return null;
}

/**
 * Returns the agent's explicit tool allowlist, or undefined when the agent should get the
 * full main-chat tool system. The per-agent config.json wins over the agent definition.
 */
export function resolveAgentToolFilter(agentId: string | undefined | null): string[] | undefined {
  const id = String(agentId || '').trim();
  if (!id) return undefined;
  let agent: any = null;
  try { agent = getAgentById(id); } catch { agent = null; }
  const fromConfigFile = cleanToolList(readAgentConfigFile(id, agent)?.allowed_tools);
  if (fromConfigFile.length > 0) return fromConfigFile;
  const fromDefinition = cleanToolList(agent?.allowed_tools);
  return fromDefinition.length > 0 ? fromDefinition : undefined;
}
