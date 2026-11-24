import { buildToolCatalog, type ToolCatalogEntry } from '../tool-search';
import { getExtensionRuntimeRegistry } from '../../extensions/runtime-registry';

const reserved = new Set('side visual goal models new screenshot restart update stop stop_now browse'.split(' '));
export function pluginGroups(catalog: ToolCatalogEntry[] = buildToolCatalog()) {
  const groups = new Map<string, {id:string; title:string; tools:string[]}>();
  const titles = new Map(getExtensionRuntimeRegistry().listConnectors().map(c => [c.id, c.name]));
  for (const tool of catalog) {
    if (tool.source !== 'connector' && tool.source !== 'mcp') continue;
    const id = tool.group.replace(/^mcp:/, 'mcp-').toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || reserved.has(id)) continue;
    const title = titles.get(tool.group) || tool.group.replace(/^mcp:/, '').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const group = groups.get(id) || {id,title,tools:[]};
    group.tools.push(tool.name); groups.set(id,group);
  }
  return groups;
}

// Discover only explicitly named, currently callable tools. Execution still goes
// through tool_call -> catalog revalidation -> normal gated executor.
export function pluginReferenceHint(message:string, catalog?:ToolCatalogEntry[]) {
  const ids = new Set(Array.from(message.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/gi), m=>m[1].toLowerCase()));
  if (!ids.size) return '';
  const groups = pluginGroups(catalog);
  const lines = [...ids].flatMap(id=> { const g=groups.get(id); return g ? [`/${id}: ${g.tools.slice(0,64).join(', ')}`] : []; }).slice(0,6);
  return lines.length ? `[REFERENCED PLUGIN TOOLS]\nAlready discovered for this request. Use tool_describe for arguments and tool_call to invoke; normal approvals apply.\n${lines.join('\n')}` : '';
}
