/**
 * plugin_ops tool: find, inspect, import and manage plugins and skills from
 * other agents: Claude Code, Codex / OpenAI (incl. portable Agent Plugins),
 * Hermes Agent and OpenClaw. Browses the Claude official and OpenAI official
 * catalogs live. Secrets are never accepted as tool arguments; imported MCP
 * servers and hooks stay off until the user turns them on.
 */
import fs from 'fs';
import path from 'path';
import {
  activateMcpServers, deactivateMcpServers, defaultMarketplaceRoots, defaultPluginSourceRoots, enableReadyMcpServers, getImportedPlugin,
  installPlugin, listImportedPlugins, readMarketplace, resolveCatalogSource, resolvePluginSource, scanPlugins, scanSkillFolders, uninstallPlugin, writeLedger,
  type PluginImportDeps, type ResolvedSource,
} from './import-service.js';
import { findPluginDirs, readPluginBundle, readSkillBundle, summarizeBundle } from './formats.js';
import { CATALOGS, filterCatalogEntries, loadCatalogs, resolveCatalogEntry } from './catalogs.js';
import { invalidatePluginHookCache } from './plugin-hooks.js';
import { resolveUserPluginsDir } from '../loader.js';

export const PLUGIN_OPS_ACTIONS = [
  'catalog', 'scan', 'skills', 'inspect', 'install', 'list', 'uninstall',
  'activate_mcp', 'deactivate_mcp', 'enable_mcp', 'approve_hooks', 'revoke_hooks', 'marketplace',
] as const;

export const PLUGIN_OPS_TOOL_DEF = {
  type: 'function',
  function: {
    name: 'plugin_ops',
    description:
      'Find and import plugins and skills made for other AI agents: Claude Code, Codex/OpenAI (incl. portable Agent Plugins: root plugin.json + mcp.json), Hermes Agent and OpenClaw. ' +
      'Imports skills, slash commands (as skills), agents (as role skills), MCP servers and command hooks. Hosted ChatGPT apps and Python/TypeScript plugin runtimes are reported as not importable. ' +
      'Typical flow: catalog(query) to search the Claude official + OpenAI official catalogs -> inspect(entry) -> install(entry). ' +
      'Other actions: scan (plugins installed in Claude Code/Codex/Hermes/OpenClaw on this computer) | skills (standalone skill folders: ~/.hermes/skills, ~/.openclaw/skills, ~/.agents/skills, ~/.claude/skills, ~/.codex/skills) | ' +
      'install(source) for a local folder, owner/repo[#subdir] or GitHub URL | list | uninstall(id, purge_data?) | ' +
      'activate_mcp(id) / deactivate_mcp(id): turn an import\'s MCP servers on/off (on = runs third-party code, needs the user\'s approval) | approve_hooks(id) / revoke_hooks(id) | enable_mcp(id): re-check after the user saved a secret. ' +
      'Imported MCP servers and hooks start OFF. Never pass secrets; the user saves them on the Plugins page.',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: [...PLUGIN_OPS_ACTIONS] },
        entry: { type: 'string', description: 'Catalog entry id from catalog, e.g. "claude-official:feature-dev" or "openai-official:figma" (inspect/install).' },
        source: { type: 'string', description: 'Local folder, owner/repo[#subdir], or GitHub URL/tree URL (inspect/install). Other hosts are not supported. Use entry instead for catalog items.' },
        id: { type: 'string', description: 'Imported plugin id (uninstall/activate_mcp/deactivate_mcp/enable_mcp/approve_hooks/revoke_hooks).' },
        catalog: { type: 'string', enum: CATALOGS.map((c) => c.id), description: 'catalog: limit to one catalog.' },
        query: { type: 'string', description: 'Filter text for catalog/scan/skills.' },
        refresh: { type: 'boolean', description: 'catalog: fetch live now instead of the 6-hour cache.' },
        parts: { type: 'array', items: { type: 'string', enum: ['skills', 'commands', 'agents', 'mcp', 'hooks'] }, description: 'install: parts to import (default all importable).' },
        overwrite: { type: 'boolean', description: 'install: reinstall over an existing import of the same id (its data folder is kept).' },
        purge_data: { type: 'boolean', description: 'uninstall: also delete the plugin\'s saved data folder.' },
        include_marketplaces: { type: 'boolean', description: 'scan: also list plugins in local marketplace checkouts.' },
        limit: { type: 'number', description: 'Max rows (default 40).' },
      },
    },
  },
};

function compact(value: unknown): string { return JSON.stringify(value, null, 1).replace(/\n\s*/g, ' '); }

function partsLine(imp: any): string {
  return [imp.skills?.length && `${imp.skills.length} skills`, imp.commands?.length && `${imp.commands.length} commands`, imp.agents?.length && `${imp.agents.length} agents`, imp.mcpServers?.length && `mcp:${imp.mcpServers.join(',')}`, imp.hooks?.length && `${imp.hooks.length} hooks`].filter(Boolean).join(', ') || 'nothing importable';
}

export async function runPluginOps(args: any, deps: PluginImportDeps): Promise<{ result: string; error?: boolean; data?: any }> {
  const action = String(args?.action || '').trim();
  const limit = Math.max(1, Math.min(400, Number(args?.limit) || 40));
  const userDir = deps.userPluginsDir || resolveUserPluginsDir();
  const catalogOpts = { ...(deps.catalogOptions || {}), fetcher: deps.catalogOptions?.fetcher || deps.fetcher };
  try {
    switch (action) {
      case 'catalog': {
        const results = await loadCatalogs({ ...catalogOpts, refresh: args?.refresh === true, catalog: args?.catalog || undefined });
        const hits = filterCatalogEntries(results, args?.query);
        const imported = new Set(listImportedPlugins(userDir).map((l) => l.provenance?.entry).filter(Boolean));
        const head = results.map((r) => `${r.label}: ${r.entries.length} (${r.origin}${r.error ? `; ${r.error}` : ''})`).join(' | ');
        const lines = hits.slice(0, limit).map((e) => `- ${e.id}${imported.has(e.id) ? ' [IMPORTED]' : ''}${e.category ? ` [${e.category}]` : ''}: ${e.description.slice(0, 140)}${e.installable ? '' : ` | not importable: ${e.reason}`}${e.note ? ` | ${e.note}` : ''}`);
        return {
          result: `${head}\n${hits.length} match(es)${hits.length > limit ? ` (showing ${limit})` : ''}:\n${lines.join('\n') || '(none)'}\nPreview with plugin_ops(action:"inspect", entry:"<id>"), import with plugin_ops(action:"install", entry:"<id>").`,
          data: { catalogs: results.map(({ entries, renames, ...meta }) => ({ ...meta, count: entries.length })), entries: hits.slice(0, limit).map((e) => ({ ...e, imported: imported.has(e.id) })), total: hits.length },
        };
      }
      case 'scan': {
        const roots = [...defaultPluginSourceRoots(), ...(args?.include_marketplaces ? defaultMarketplaceRoots() : [])];
        const rows = scanPlugins({ roots, filter: args?.query, userPluginsDir: userDir });
        const lines = rows.slice(0, limit).map((p: any) => {
          const un = p.unsupported.length ? ` | unsupported: ${p.unsupported.map((u: any) => u.part).join('; ')}` : '';
          return `- ${p.id} [${p.format}] (${p.harness})${p.installedAs ? ` IMPORTED as ${p.installedAs}` : ''}: ${partsLine(p.importable)}${p.requiredEnv.length ? ` | needs ${p.requiredEnv.join(',')}` : ''}${un}\n  source: ${p.root}`;
        });
        return { result: `Scanned ${roots.length} plugin folder(s): ${roots.map((r) => r.label).join(', ') || 'none found on this computer'}.\n${rows.length} plugin(s)${rows.length > limit ? ` (showing ${limit})` : ''}:\n${lines.join('\n') || '(none)'}\nImport with plugin_ops(action:"install", source:"<source path>").` };
      }
      case 'skills': {
        const rows = scanSkillFolders({ filter: args?.query, userPluginsDir: userDir });
        const lines = rows.slice(0, limit).map((p: any) => `- ${p.id} (${p.harness})${p.installedAs ? ' IMPORTED' : ''}: ${String(p.description).slice(0, 120)}\n  source: ${p.root}`);
        return { result: `${rows.length} standalone skill(s)${rows.length > limit ? ` (showing ${limit})` : ''}:\n${lines.join('\n') || '(none: no Hermes/OpenClaw/Agent Skills/Claude/Codex skill folders on this computer)'}\nImport with plugin_ops(action:"install", source:"<source path>").`, data: rows.slice(0, limit) };
      }
      case 'inspect': {
        let resolved: ResolvedSource;
        let label = String(args?.source || '');
        if (args?.entry) {
          const entry = await resolveCatalogEntry(String(args.entry), catalogOpts);
          resolved = await resolveCatalogSource(entry, userDir, { fetcher: deps.fetcher });
          label = entry.id;
        } else resolved = await resolvePluginSource(label, userDir, { fetcher: deps.fetcher });
        try {
          const bundle = readPluginBundle(resolved.dir) || (fs.existsSync(path.join(resolved.dir, 'SKILL.md')) ? readSkillBundle(resolved.dir, path.basename(resolved.dir)) : null);
          if (!bundle) {
            const nested = findPluginDirs(resolved.dir, 4).map((d) => readPluginBundle(d)).filter(Boolean).map((b) => `${b!.id} [${b!.format}] ${path.relative(resolved.dir, b!.root)}`);
            return { result: nested.length ? `Collection with ${nested.length} plugin(s):\n${nested.slice(0, limit).join('\n')}` : `No plugin manifest or SKILL.md found at ${label}.`, error: !nested.length };
          }
          return { result: compact({ ...summarizeBundle(bundle), root: undefined, source: label, provenance: resolved.provenance }) };
        } finally { resolved.cleanup(); }
      }
      case 'install': {
        if (!args?.entry && !args?.source) return { result: 'install needs entry (from catalog) or source.', error: true };
        const res = await installPlugin(String(args?.source || ''), deps, { parts: args?.parts, overwrite: args?.overwrite === true, entry: args?.entry ? String(args.entry) : undefined });
        const lines = [
          `${res.partial ? 'Partly imported' : 'Imported'} ${res.format} plugin "${res.id}"${res.provenance?.commit ? ` at ${res.provenance.repo || res.provenance.url}@${res.provenance.commit.slice(0, 12)}` : ''}.`,
          `Skills (${res.skills.length}): ${res.skills.join(', ') || 'none'}`,
          `MCP servers (${res.mcpServers.length}, OFF until turned on): ${res.mcpServers.map((m) => `${m.id}${m.note ? ` (${m.note})` : ''}`).join('; ') || 'none'}`,
          `Hooks: ${res.hooks}${res.hooks ? ' (off until approved)' : ''}`,
          res.unsupported.length ? `Not imported: ${res.unsupported.map((u) => `${u.part}: ${u.reason}`).join(' | ')}` : '',
          res.warnings.length ? `Problems: ${res.warnings.join(' | ')}` : '',
          res.nextSteps.length ? `Next: ${res.nextSteps.join(' ')}` : '',
        ].filter(Boolean);
        return { result: lines.join('\n'), data: res };
      }
      case 'list': {
        const rows = listImportedPlugins(userDir);
        return {
          result: rows.length ? rows.map((l) => `- ${l.id} [${l.format}] skills:${l.skills.length} mcp:${l.mcpServers.map((s) => `${s.id}(${s.enabled ? 'on' : s.activation === 'pending' ? 'off' : 'needs secret'})`).join(',') || 0} hooks:${l.hooks.length}${l.hooks.length ? (l.hooksApproved ? '(approved)' : '(off)') : ''}${l.provenance?.entry ? ` from ${l.provenance.entry}` : ''}${l.provenance?.commit ? `@${l.provenance.commit.slice(0, 12)}` : ''}`).join('\n') : 'No imported plugins.',
          data: rows,
        };
      }
      case 'uninstall': {
        const res = await uninstallPlugin(String(args?.id || ''), deps, { purgeData: args?.purge_data === true });
        return { result: `Uninstalled "${res.id}": removed skills ${res.removedSkills.join(', ') || 'none'}; removed MCP ${res.removedMcp.join(', ') || 'none'}.${res.failed.length ? ` Could not remove: ${res.failed.join(', ')}.` : ''}${res.dataKept ? ` Saved data kept at ${res.dataKept} (uninstall with purge_data:true to delete it).` : ''}` };
      }
      case 'activate_mcp':
      case 'deactivate_mcp': {
        const rows = action === 'activate_mcp' ? await activateMcpServers(String(args?.id || ''), deps) : await deactivateMcpServers(String(args?.id || ''), deps);
        return { result: rows.map((r) => `${r.id}: ${r.enabled ? 'on' : r.activation === 'active' ? `approved, waiting for secret(s) ${r.missing.join(', ')}` : 'off'}`).join('\n') || 'No MCP servers in this plugin.', data: rows };
      }
      case 'enable_mcp': {
        const rows = enableReadyMcpServers(String(args?.id || ''), deps);
        return { result: rows.map((r) => `${r.id}: ${r.enabled ? 'on' : r.missing.length ? `missing ${r.missing.join(', ')}` : r.activation === 'pending' ? 'ready but off (turn on with activate_mcp)' : 'off'}`).join('\n') || 'No MCP servers in this plugin.', data: rows };
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
      case 'marketplace': {
        // Legacy: browse a local marketplace checkout folder. Remote catalogs use action:"catalog".
        const src = String(args?.source || '').trim();
        if (src && !fs.existsSync(path.resolve(src))) return { result: 'marketplace only reads a local folder now. Use action:"catalog" for the Claude/OpenAI official catalogs.', error: true };
        const entries = src ? readMarketplace(path.resolve(src)) : defaultMarketplaceRoots().flatMap((m) => readMarketplace(m.dir));
        const q = String(args?.query || '').toLowerCase();
        const hits = entries.filter((e) => !q || `${e.name} ${e.description} ${e.category || ''}`.toLowerCase().includes(q));
        return { result: `${hits.length} local marketplace plugin(s)${hits.length > limit ? ` (showing ${limit})` : ''}:\n${hits.slice(0, limit).map((e) => `- ${e.name} [${e.marketplace}]: ${e.description.slice(0, 140)}\n  source: ${e.source}`).join('\n') || '(none)'}\nTip: action:"catalog" searches the live official catalogs.` };
      }
      default:
        return { result: `Unknown plugin_ops action "${action}". Actions: ${PLUGIN_OPS_ACTIONS.join(', ')}.`, error: true };
    }
  } catch (err: any) {
    return { result: `plugin_ops ${action} failed: ${String(err?.message || err).slice(0, 600)}`, error: true };
  }
}

export function pluginSecretVaultKey(pluginId: string, envName: string): string {
  return `plugins.${pluginId}.${envName}`;
}

export function ensureImportDirExists(): void { try { fs.mkdirSync(resolveUserPluginsDir(), { recursive: true }); } catch {} }
