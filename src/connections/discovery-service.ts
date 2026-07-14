/** Trusted, deterministic integration discovery. Network research is supplied by providers. */

export type ConnectionDiscoverySource =
  | 'installed_plugin'
  | 'bundled_plugin'
  | 'trusted_marketplace'
  | 'official_documentation'
  | 'official_package'
  | 'community_integration'
  | 'generated_proposal';

export interface ConnectionDiscoveryRequest {
  service: string;
  requestedCapabilities?: string[];
  readOnly?: boolean;
  allowCommunity?: boolean;
  allowGenerated?: boolean;
}

export interface ConnectionDiscoveryCandidate {
  id: string;
  serviceId: string;
  label: string;
  source: ConnectionDiscoverySource;
  strategyId: string;
  pluginId?: string;
  protocol?: string;
  authType?: string;
  capabilities?: string[];
  official?: boolean;
  installed?: boolean;
  compatible?: boolean;
  trusted?: boolean;
  requiresInstall?: boolean;
  mutationCapabilities?: boolean;
  evidence?: Array<{ url: string; label?: string }>;
  metadata?: Record<string, unknown>;
}

export interface ConnectionDiscoveryProvider {
  id: string;
  priority?: number;
  discover(request: ConnectionDiscoveryRequest): Promise<ConnectionDiscoveryCandidate[]>;
}

export interface RankedConnectionCandidate extends ConnectionDiscoveryCandidate {
  score: number;
  reasons: string[];
}

const SOURCE_SCORE: Record<ConnectionDiscoverySource, number> = {
  installed_plugin: 100,
  bundled_plugin: 90,
  trusted_marketplace: 75,
  official_documentation: 70,
  official_package: 65,
  community_integration: 35,
  generated_proposal: 10,
};

function rank(candidate: ConnectionDiscoveryCandidate, request: ConnectionDiscoveryRequest): RankedConnectionCandidate {
  let score = SOURCE_SCORE[candidate.source];
  const reasons = [`Source priority: ${candidate.source}.`];
  if (candidate.installed) { score += 18; reasons.push('Already installed.'); }
  if (candidate.official) { score += 16; reasons.push('Official provider source.'); }
  if (candidate.trusted) { score += 8; reasons.push('Trusted provenance.'); }
  if (candidate.compatible === true) { score += 12; reasons.push('Host compatibility confirmed.'); }
  if (candidate.compatible === false) { score -= 200; reasons.push('Incompatible with this host.'); }
  if (candidate.requiresInstall) score -= 4;
  if (request.readOnly && candidate.mutationCapabilities) { score -= 24; reasons.push('Includes mutation capabilities despite a read-only request.'); }

  const requested = new Set(request.requestedCapabilities || []);
  const offered = new Set(candidate.capabilities || []);
  if (requested.size) {
    const matches = [...requested].filter((item) => offered.has(item)).length;
    score += Math.round(20 * matches / requested.size);
    if (matches === requested.size) reasons.push('Covers every requested capability.');
  }
  return { ...candidate, score, reasons };
}

export class ConnectionDiscoveryService {
  private readonly providers = new Map<string, ConnectionDiscoveryProvider>();

  register(provider: ConnectionDiscoveryProvider): () => void {
    if (!provider.id.trim()) throw new Error('Discovery provider id is required.');
    if (this.providers.has(provider.id)) throw new Error(`Discovery provider "${provider.id}" is already registered.`);
    this.providers.set(provider.id, provider);
    return () => this.providers.delete(provider.id);
  }

  async discover(request: ConnectionDiscoveryRequest): Promise<RankedConnectionCandidate[]> {
    if (!request.service.trim()) throw new Error('A service name is required for connection discovery.');
    const providers = [...this.providers.values()].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const settled = await Promise.allSettled(providers.map((provider) => provider.discover(request)));
    const deduped = new Map<string, ConnectionDiscoveryCandidate>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const candidate of result.value) {
        if (!candidate?.id || !candidate.serviceId || !candidate.strategyId) continue;
        if (candidate.source === 'community_integration' && !request.allowCommunity) continue;
        if (candidate.source === 'generated_proposal' && !request.allowGenerated) continue;
        const previous = deduped.get(candidate.id);
        if (!previous || rank(candidate, request).score > rank(previous, request).score) deduped.set(candidate.id, candidate);
      }
    }
    return [...deduped.values()]
      .map((candidate) => rank(candidate, request))
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  }
}

