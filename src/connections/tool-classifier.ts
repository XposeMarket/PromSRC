/**
 * Host-owned classification for tools discovered while connecting a service.
 * Provider plugins may add classifiers, but cannot weaken a higher-risk result.
 */

import type { ConnectionToolRisk } from './types.js';
export type { ConnectionToolRisk } from './types.js';

export interface ConnectionToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  serverId?: string;
}

export interface ConnectionToolClassification {
  toolName: string;
  risk: ConnectionToolRisk;
  confidence: number;
  reasons: string[];
  source: 'annotation' | 'plugin' | 'heuristic' | 'fallback';
  defaultExposed: boolean;
  requiresApproval: boolean;
}

export interface ConnectionToolClassifier {
  id: string;
  priority?: number;
  supports?(tool: ConnectionToolDescriptor, context: ToolClassificationContext): boolean;
  classify(
    tool: ConnectionToolDescriptor,
    context: ToolClassificationContext,
  ): ConnectionToolClassification | null | Promise<ConnectionToolClassification | null>;
}

export interface ToolClassificationContext {
  serviceId: string;
  requestedCapabilities?: string[];
  readOnlyRequested?: boolean;
}

const RISK_WEIGHT: Record<ConnectionToolRisk, number> = {
  'read-only': 0,
  write: 1,
  unknown: 2,
  'credential-security': 3,
  'financial-mutation': 4,
  destructive: 5,
};

const PATTERNS: Array<{ risk: ConnectionToolRisk; re: RegExp; reason: string }> = [
  { risk: 'financial-mutation', re: /\b(place|submit|execute|buy|sell|trade|order|rebalance|transfer|withdraw|deposit)\b/i, reason: 'financial mutation language' },
  { risk: 'destructive', re: /\b(delete|destroy|purge|erase|remove|revoke|terminate|cancel account|drop)\b/i, reason: 'destructive language' },
  { risk: 'credential-security', re: /\b(password|secret|credential|api[ _-]?key|token|oauth|permission|scope|security|mfa|2fa)\b/i, reason: 'credential or security language' },
  { risk: 'write', re: /\b(create|update|edit|write|send|post|publish|upload|invite|approve|reject|close|archive|comment|reply|message|set|enable|disable)\b/i, reason: 'state-changing language' },
  { risk: 'read-only', re: /\b(get|list|read|search|find|lookup|fetch|view|inspect|describe|status|health|quote|balance|holding|position|profile|history)\b/i, reason: 'read-only language' },
];

function normalizeResult(result: ConnectionToolClassification): ConnectionToolClassification {
  const confidence = Number.isFinite(result.confidence)
    ? Math.max(0, Math.min(1, result.confidence))
    : 0;
  const risk = result.risk || 'unknown';
  return {
    ...result,
    risk,
    confidence,
    reasons: [...new Set((result.reasons || []).filter(Boolean))],
    defaultExposed: risk === 'read-only' && result.defaultExposed !== false,
    requiresApproval: risk !== 'read-only' || result.requiresApproval === true,
  };
}

function annotationClassification(tool: ConnectionToolDescriptor): ConnectionToolClassification | null {
  const annotations = tool.annotations || {};
  const readOnly = annotations.readOnlyHint === true || annotations.readOnly === true;
  const destructive = annotations.destructiveHint === true || annotations.destructive === true;
  if (!readOnly && !destructive) return null;
  const risk: ConnectionToolRisk = destructive ? 'destructive' : 'read-only';
  return normalizeResult({
    toolName: tool.name,
    risk,
    confidence: 0.98,
    reasons: [destructive ? 'tool annotation declares destructive behavior' : 'tool annotation declares read-only behavior'],
    source: 'annotation',
    defaultExposed: risk === 'read-only',
    requiresApproval: risk !== 'read-only',
  });
}

function heuristicClassification(tool: ConnectionToolDescriptor): ConnectionToolClassification {
  const haystack = `${tool.name} ${tool.description || ''}`.replace(/[_-]+/g, ' ');
  for (const pattern of PATTERNS) {
    if (!pattern.re.test(haystack)) continue;
    return normalizeResult({
      toolName: tool.name,
      risk: pattern.risk,
      confidence: pattern.risk === 'read-only' ? 0.74 : 0.82,
      reasons: [`Matched ${pattern.reason}.`],
      source: 'heuristic',
      defaultExposed: pattern.risk === 'read-only',
      requiresApproval: pattern.risk !== 'read-only',
    });
  }
  return normalizeResult({
    toolName: tool.name,
    risk: 'unknown',
    confidence: 0,
    reasons: ['No trusted annotation, plugin classification, or unambiguous heuristic matched.'],
    source: 'fallback',
    defaultExposed: false,
    requiresApproval: true,
  });
}

export class ToolClassifierService {
  private readonly classifiers = new Map<string, ConnectionToolClassifier>();

  register(classifier: ConnectionToolClassifier): () => void {
    if (!classifier.id.trim()) throw new Error('Tool classifier id is required.');
    if (this.classifiers.has(classifier.id)) throw new Error(`Tool classifier "${classifier.id}" is already registered.`);
    this.classifiers.set(classifier.id, classifier);
    return () => this.classifiers.delete(classifier.id);
  }

  async classify(tool: ConnectionToolDescriptor, context: ToolClassificationContext): Promise<ConnectionToolClassification> {
    if (!tool.name.trim()) throw new Error('Tool name is required for classification.');
    const candidates: ConnectionToolClassification[] = [];
    const annotation = annotationClassification(tool);
    if (annotation) candidates.push(annotation);

    const classifiers = [...this.classifiers.values()].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const classifier of classifiers) {
      if (classifier.supports && !classifier.supports(tool, context)) continue;
      const result = await classifier.classify(tool, context);
      if (result) candidates.push(normalizeResult({ ...result, toolName: tool.name, source: 'plugin' }));
    }
    const heuristic = heuristicClassification(tool);
    // "Unknown" is a safe fallback, not evidence that should override an
    // explicit trusted plugin classification.
    if (heuristic.risk !== 'unknown' || candidates.length === 0) candidates.push(heuristic);

    // Prefer the highest risk first, then confidence. A plugin cannot downgrade a
    // destructive annotation/heuristic into an automatically exposed read tool.
    return candidates.sort((a, b) =>
      RISK_WEIGHT[b.risk] - RISK_WEIGHT[a.risk] || b.confidence - a.confidence,
    )[0];
  }

  async classifyMany(tools: ConnectionToolDescriptor[], context: ToolClassificationContext): Promise<ConnectionToolClassification[]> {
    return Promise.all(tools.map((tool) => this.classify(tool, context)));
  }
}
