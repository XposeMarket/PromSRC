/**
 * plugin_ops tool: scan / inspect / install / uninstall imported plugins from
 * Claude Code, Codex, Hermes Agent and OpenClaw, browse marketplaces, and
 * manage imported hooks and MCP secrets. Secrets are never accepted as tool
 * arguments; the tool points the user at the Plugins page / env vars instead.
 */
import fs from 'fs';
import path from 'path';
import {
  defaultMarketplaceRoots, defaultPluginSourceRoots, enableReadyMcpServers, getImportedPlugin,
  installPlugin, listImportedPlugins, readMarketplace, resolvePluginSource, scanPlugins, uninstallPlugin, writeLedger,
  type PluginImportDeps,
} from './import-service.js';
import { findPluginDirs, readPluginBundle, summarizeBundle } from './formats.js';
import { invalidatePluginHookCache } from './plugin-hooks.js';
import { resolveUserPluginsDir } from '../loader.js';

export const PLUGIN_OPS_TOOL_DEF = {
  type: 'function',
  function: {
    name: 'plugin_ops',
    description:
      'Import and manage plugins from other agent harnesses: Claude Code (.claude-plugin), Codex (.codex-plugin), Hermes Agent (plugin.yaml), OpenClaw (openclaw.plugin.json). ' +
      'Imports skills, slash commands (as skills), agents (as role skills), MCP servers (secrets as vault refs) and command hooks; reports hosted apps and native Python/TS runtimes as unsupported with a reason. ' +
      'Actions: scan (installed plugins in ~/.claude, ~/.codex, ~/.hermes, ~/.openclaw; include_marketplaces for local marketplace checkouts) | inspect(source) | install(source, parts?, overwrite?) | ' +
      'list (imported) | uninstall(id) | marketplace(source?: dir, git URL or owner/repo; default = local Claude marketplaces; query?) | approve_hooks(id) | revoke_hooks(id) | enable_mcp(id). ' +
      'source = local plugin folder, https git URL, owner/repo, owner/repo#subdir, or GitHub tree URL. Never pass secrets; required secrets go in the Plugins page or env vars.',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['scan', 'inspect', 'install', 'list', 'uninstall', 'marketplace', 'approve_hooks', 'revoke_hooks', 'enable_mcp'] },
        source: { type: 'string', description: 'Plugin folder, git URL, owner/repo[#subdir], or GitHub tree URL (inspect/install/marketplace).' },
        id: { type: 'string', description: 'Imported plugin id (uninstall/approve_hooks/revoke_hooks/enable_mcp).' },
        query: { type: 'string', description: 'Filter text for scan/marketplace.' },
        parts: { type: 'array', items: { type: 'string', enum: ['skills', 'commands', 'agents', 'mcp', 'hooks'] }, description: 'Parts to import (default all importable).' },
        overwrite: { type: 'boolean', description: 'Reinstall over an existing import.' },
        include_marketplaces: { type: 'boolean', description: 'scan: also list plugins in local marketplace checkouts (not installed in the harness).' },
        limit: { type: 'number', description: 'Max rows for scan/marketplace (default 40).' },
      },
    },
  },
};

function compact(value: unknown): string { return JSON.stringify(value, null, 1).replace(/\n\s*/g, ' '); }

export async function runPluginOps(args: any, deps: PluginImportDeps): Promise<{ result: string; error?: boolean }> {
  const action = String(args?.action || '').trim();
  const limit = Math.max(1, Math.min(200, Number(args?.limit) || 40));
  const userDir = deps.userPluginsDir || resolveUserPluginsDir();
  try {
    switch (action) {
      case 'scan': {
        const roots = [...defaultPluginSourceRoots(), ...(args?.include_marketplaces ? defaultMarketplaceRoots() : [])];
        const rows = scanPlugins({ roots, filter: args?.query, userPluginsDir: userDir });
        const lines = rows.slice(0, limit).map((p: any) => {
          const imp = p.importable;
          const parts = [imp.skills.length && `${imp.skills.length} skills`, imp.commands.length && `${imp.commands.length} commands`, imp.agents.length && `${imp.agents.length} agents`, imp.mcpServers.length && `mcp:${imp.mcpServers.join(',')}`, imp.hooks.length && `${imp.hooks.length} hooks`].filter(Boolean).join(', ') || 'nothing importable';
          const un = p.unsupported.length ? ` | unsupported: ${p.unsupported.map((u: any) => u.part).join('; ')}` : '';
          return `- ${p.id} [${p.format}] (${p.harness})${p.installedAs ? ` IMPORTED as ${p.installedAs}` : ''}: ${parts}${p.requiredEnv.length ? ` | needs ${p.requiredEnv.join(',')}` : ''}${un}\n  source: ${p.root}`;
        });
        return { result: `Scanned ${roots.length} plugin root(s): ${roots.map((r) => r.label).join(', ') || 'none found'}.\n${rows.length} plugin(s)${rows.length > limit ? ` (showing ${limit})` : ''}:\n${lines.join('\n') || '(none)'}\nInstall with plugin_ops(action:"install", source:"<source path>").` };
      }
      case 'inspect': {
        const resolved = resolvePluginSource(String(args?.source || ''), userDir);
        try {
          const bundle = readPluginBundle(resolved.dir);
          if (!bundle) {
            const nested = findPluginDirs(resolved.dir, 4).map((d) => readPluginBundle(d)).filter(Boolean).map((b) => `${b!.id} [${b!.format}] ${path.relative(resolved.dir, b!.root)}`);
            return { result: nested.length ? `Collection with ${nested.length} plugin(s):\n${nested.slice(0, limit).join('\n')}` : 'No plugin manifest found.', error: !nested.length };
          }
          return { result: compact(summarizeBundle(bundle)) };
        } finally { resolved.cleanup?.(); }
      }
      case 'install': {
        const res = await installPlugin(String(args?.source || ''), deps, { parts: args?.parts, overwrite: args?.overwrite === true });
        const lines = [
          `Imported ${res.format} plugin "${res.id}".`,
          `Skills (${res.skills.length}): ${res.skills.join(', ') || 'none'}`,
          `MCP servers (${res.mcpServers.length}): ${res.mcpServers.map((m) => `${m.id}${m.enabled ? ' enabled' : ' disabled'}${m.note ? ` (${m.note})` : ''}`).join('; ') || 'none'}`,
          `Hooks: ${res.hooks}${res.hooks ? ' (inactive until approved)' : ''}`,
          res.unsupported.length ? `Not imported: ${res.unsupported.map((u) => `${u.part}: ${u.reason}`).join(' | ')}` : '',
          res.warnings.length ? `Warnings: ${res.warnings.join(' | ')}` : '',
          res.nextSteps.length ? `Next: ${res.nextSteps.join(' ')}` : '',
          res.mcpServers.some((m) => m.enabled) ? 'Enabled MCP servers connect on next start; their tools are reachable through tool_search/tool_call.' : '',
        ].filter(Boolean);
        return { result: lines.join('\n') };
      }
      case 'list': {
        const rows = listImportedPlugins(userDir);
        return { result: rows.length ? rows.map((l) => `- ${l.id} [${l.format}] v${l.version || '?'} from ${l.source}: skills ${l.skills.length}, mcp ${l.mcpServers.map((m) => `${m.id}${m.enabled ? '' : '(disabled)'}`).join(',') || 'none'}, hooks ${l.hooks.length}${l.hooks.length ? (l.hooksApproved ? ' APPROVED' : ' inactive') : ''}`).join('\n') : 'No imported plugins.' };
      }
      case 'uninstall': {
        const res = await uninstallPlugin(String(args?.id || ''), deps);
        invalidatePluginHookCache();
        return { result: `Uninstalled "${res.id}": removed skills ${res.removedSkills.join(', ') || 'none'}; removed MCP ${res.removedMcp.join(', ') || 'none'}.` };
      }
      case 'marketplace': {
        const src = String(args?.source || '').trim();
        let entries: ReturnType<typeof readMarketplace> = [];
        let cleanup: (() => void) | undefined;
        try {
          if (src) { const r = resolvePluginSource(src, userDir); cleanup = r.cleanup; entries = readMarketplace(r.dir); }
          else for (const m of defaultMarketplaceRoots()) entries.push(...readMarketplace(m.dir));
        } finally { /* cleanup after reading */ cleanup?.(); }
        const q = String(args?.query || '').toLowerCase();
        const hits = entries.filter((e) => !q || `${e.name} ${e.description} ${e.category || ''}`.toLowerCase().includes(q));
        return { result: `${hits.length} marketplace plugin(s)${hits.length > limit ? ` (showing ${limit})` : ''}:\n${hits.slice(0, limit).map((e) => `- ${e.name} [${e.marketplace}${e.category ? `/${e.category}` : ''}]: ${e.description.slice(0, 140)}\n  source: ${e.source}`).join('\n') || '(none)'}\nInstall with plugin_ops(action:"install", source:"<source>").` };
      }
      case 'approve_hooks':
      case 'revoke_hooks': {
        const ledger = getImportedPlugin(String(args?.id || ''), userDir);
        if (!ledger) return { result: `No imported plugin "${args?.id}".`, error: true };
        ledger.hooksApproved = action === 'approve_hooks';
        writeLedger(ledger);
        invalidatePluginHookCache();
        const detail = ledger.hooks.map((h) => `${h.event}${h.matcher ? `(${h.matcher})` : ''}: ${h.command}`).join('\n');
        return { result: `${ledger.hooksApproved ? 'Approved' : 'Revoked'} ${ledger.hooks.length} hook(s) for "${ledger.id}".${detail ? `\n${detail}` : ''}` };
      }
      case 'enable_mcp': {
        const rows = enableReadyMcpServers(String(args?.id || ''), deps);
        return { result: rows.map((r) => `${r.id}: ${r.enabled ? 'enabled' : `still disabled, missing ${r.missing.join(', ')}`}`).join('\n') || 'No MCP servers in this plugin.' };
      }
      default:
        return { result: `Unknown plugin_ops action "${action}".`, error: true };
    }
  } catch (err: any) {
    return { result: `plugin_ops ${action} failed: ${String(err?.message || err).slice(0, 600)}`, error: true };
  }
}

/** Store a plugin secret in the vault (HTTP route only, never a model tool arg). */
export function pluginSecretVaultKey(pluginId: string, envName: string): string {
  return `plugins.${pluginId}.${envName}`;
}

export function ensureImportDirExists(): void { try { fs.mkdirSync(resolveUserPluginsDir(), { recursive: true }); } catch {} }
