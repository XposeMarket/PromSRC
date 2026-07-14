import { getExtensionDescriptor, listExtensionDescriptors } from '../extensions/registry';
import type { ConnectionDiscoveryMatch, ConnectionDiscoveryResult, ConnectionPlan, ConnectionStrategy } from './types';
import type { ConnectionPlanResolver } from './orchestrator';

function normalize(value: string): string { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function tokens(value: string): string[] { return normalize(value).split(' ').filter((item) => item.length > 1 && !['mcp', 'api', 'connector', 'plugin', 'server'].includes(item)); }

function descriptorMatch(item: ReturnType<typeof listExtensionDescriptors>[number], query: string): ConnectionDiscoveryMatch | undefined {
  if (!item.connection) return undefined;
  const q = normalize(query);
  if (!q) return undefined;
  const identities = [
    { value: item.id, kind: 'id' }, { value: item.name, kind: 'name' },
    ...(item.connection.aliases || []).map((value) => ({ value, kind: 'alias' })),
    ...(item.connection.domains || []).map((value) => ({ value, kind: 'domain' })),
  ];
  let score = 0; const matchedOn: string[] = [];
  for (const identity of identities) {
    const candidate = normalize(identity.value);
    if (!candidate) continue;
    if (candidate === q) { score = Math.max(score, identity.kind === 'id' ? 120 : 110); matchedOn.push(`${identity.kind}:exact`); continue; }
    if (candidate.includes(q) || q.includes(candidate)) { score = Math.max(score, identity.kind === 'alias' ? 98 : 88); matchedOn.push(`${identity.kind}:phrase`); }
  }
  const queryTokens = tokens(q); const haystack = new Set(identities.flatMap((identity) => tokens(identity.value)));
  const overlap = queryTokens.filter((token) => haystack.has(token)).length;
  if (queryTokens.length && overlap) { score = Math.max(score, Math.round((overlap / queryTokens.length) * 75)); matchedOn.push(`tokens:${overlap}/${queryTokens.length}`); }
  return score >= 55 ? { serviceId: item.id, serviceName: item.name, pluginId: item.id, score, matchedOn: [...new Set(matchedOn)] } : undefined;
}

function validateOfficialResearch(metadata?: Record<string, unknown>): void {
  if (metadata?.officialSource !== true) return;
  if (typeof metadata.protocol !== 'string' || !metadata.protocol.trim()) throw new Error('Official connection research requires a protocol.');
  const sources = Array.isArray(metadata.sourceUrls) ? metadata.sourceUrls.map(String) : [];
  if (!sources.length || sources.some((value) => { try { return new URL(value).protocol !== 'https:'; } catch { return true; } })) throw new Error('Official connection research requires at least one valid HTTPS source URL.');
  const endpoint = String(metadata.endpoint || metadata.baseUrl || '').trim();
  if (endpoint) { try { if (new URL(endpoint).protocol !== 'https:') throw new Error(); } catch { throw new Error('Researched connection endpoints must be valid HTTPS URLs.'); } }
}

export class PluginConnectionPlanResolver implements ConnectionPlanResolver {
  constructor(private readonly getMcpConfigs: () => Array<{ id: string; name?: string; transport: string; url?: string; command?: string }>) {}

  discover(service: string): ConnectionDiscoveryResult {
    const query = String(service || '').trim();
    const matches = listExtensionDescriptors().map((item) => descriptorMatch(item, query)).filter((item): item is ConnectionDiscoveryMatch => Boolean(item)).sort((a, b) => b.score - a.score);
    const mcpMatches = this.getMcpConfigs().map((item) => {
      const exact = normalize(item.id) === normalize(query) || normalize(item.name || '') === normalize(query);
      const phrase = normalize(item.id).includes(normalize(query)) || normalize(query).includes(normalize(item.id));
      return (exact || phrase) ? { serviceId: item.id, serviceName: item.name || item.id, score: exact ? 115 : 85, matchedOn: [exact ? 'mcp:exact' : 'mcp:phrase'] } : undefined;
    }).filter((item): item is ConnectionDiscoveryMatch => Boolean(item));
    const combined = [...matches, ...mcpMatches].sort((a, b) => b.score - a.score);
    if (!combined.length) return { status: 'research_required', query, matches: [], nextAction: 'research_official_sources' };
    if (combined.length > 1 && combined[1].score >= combined[0].score - 5 && combined[0].serviceId !== combined[1].serviceId) return { status: 'ambiguous', query, matches: combined.slice(0, 5), nextAction: 'select_match' };
    return { status: 'resolved', query, matches: combined.slice(0, 5), canonicalServiceId: combined[0].serviceId, nextAction: 'plan' };
  }

  async resolve(input: { serviceId: string; requestedCapabilities: string[]; readOnly: boolean; metadata?: Record<string, unknown> }): Promise<ConnectionPlan> {
    validateOfficialResearch(input.metadata);
    const serviceId = String(input.serviceId || '').trim();
    const discovery = this.discover(serviceId);
    const canonicalServiceId = discovery.status === 'resolved' ? discovery.canonicalServiceId! : serviceId;
    const descriptor = getExtensionDescriptor(canonicalServiceId);
    const declared = descriptor?.connection?.strategies || [];
    let strategies: ConnectionStrategy[] = declared.map((item) => ({
      id: item.id, adapter: item.adapter, priority: item.priority, capabilities: item.capabilities || input.requestedCapabilities,
      readOnly: item.readOnlyDefault ?? input.readOnly, authentication: item.authentication ? { type: item.authentication.type, scopes: item.authentication.scopes } : undefined,
      configuration: { ...(item.config || {}), ...(input.metadata || {}) }, verification: item.verification,
    }));

    const mcp = this.getMcpConfigs().find((item) => normalize(item.id) === normalize(canonicalServiceId) || normalize(item.name || '') === normalize(canonicalServiceId));
    if (!strategies.length && mcp) {
      const remote = mcp.transport === 'http' || mcp.transport === 'sse';
      strategies = [{
        id: `${mcp.id}-${remote ? 'mcp-oauth' : 'mcp-stdio'}`, adapter: remote ? 'mcp-oauth' : 'mcp-stdio',
        priority: 100, capabilities: input.requestedCapabilities, readOnly: input.readOnly,
        authentication: remote ? { type: 'oauth2-pkce' } : { type: 'none' },
        configuration: { mcpServerId: mcp.id, url: mcp.url, command: mcp.command },
        verification: ['mcp.initialize', 'mcp.tools.discover', 'safe-read'],
      }];
    }

    if (!strategies.length && input.metadata?.officialSource !== true && (input.metadata?.endpoint || input.metadata?.baseUrl)) {
      strategies = [{ id: `${serviceId}-openai-compatible`, adapter: 'openai-compatible-model', priority: 50, capabilities: input.requestedCapabilities, readOnly: true, authentication: { type: 'api-key' }, configuration: input.metadata, verification: ['endpoint.reachable', 'models.list', 'completion.minimal'] }];
    }
    if (!strategies.length && input.metadata?.officialSource === true && typeof input.metadata?.protocol === 'string') {
      const protocol = String(input.metadata.protocol).toLowerCase();
      const adapter = protocol === 'mcp-oauth' ? 'mcp-oauth'
        : protocol === 'mcp-http' ? 'mcp-http'
        : protocol === 'mcp-stdio' ? 'mcp-stdio'
        : protocol === 'oauth' ? 'oauth-pkce'
        : protocol === 'device-code' ? 'oauth-device-code'
        : protocol === 'cli' ? 'cli-login'
        : protocol === 'browser' ? 'browser-session'
        : protocol === 'api-key' ? 'api-key'
        : protocol === 'openai-compatible' ? 'openai-compatible-model'
        : 'custom-http';
      strategies = [{ id: `${serviceId}-${adapter}`, adapter, priority: 40, capabilities: input.requestedCapabilities, readOnly: input.readOnly, authentication: { type: String(input.metadata.authType || protocol), scopes: Array.isArray(input.metadata.scopes) ? input.metadata.scopes.map(String) : undefined }, configuration: input.metadata, verification: ['authentication', 'registration', 'safe-read'] }];
    }
    if (!strategies.length) throw new Error(`No installed plugin or trusted connection strategy was found for "${serviceId}". Run discovery against official documentation before installing generated code.`);

    strategies.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const strategy = strategies[0];
    const now = new Date().toISOString();
    return {
      id: `connection_plan_${Date.now().toString(36)}`, serviceId: canonicalServiceId, serviceName: descriptor?.name || mcp?.name || serviceId,
      pluginId: descriptor?.id, strategy, alternatives: strategies.slice(1), requestedCapabilities: input.requestedCapabilities,
      requestedScopes: strategy.authentication?.scopes, installRequired: false,
      permissions: input.readOnly ? ['Read-only capabilities requested'] : ['Write capabilities may require separate approval'],
      risks: strategy.readOnly === false ? ['Strategy may expose state-changing tools; classification and approval are required.'] : [],
      summary: `Connect ${descriptor?.name || mcp?.name || serviceId} using ${strategy.adapter}${input.readOnly ? ' with read-only exposure by default' : ''}.`,
      createdAt: now,
    };
  }
}
