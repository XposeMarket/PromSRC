import type { ConnectionToolClassification, ConnectionToolRisk } from './tool-classifier.js';

export type ConnectionExposureMode = 'read_only' | 'selected' | 'all_approved';

export interface ConnectionExposurePolicy {
  mode?: ConnectionExposureMode;
  selectedTools?: string[];
  approvedRisks?: ConnectionToolRisk[];
  blockUnknown?: boolean;
}

export interface ConnectionExposureDecision {
  connectionId: string;
  expose: string[];
  withhold: Array<{ toolName: string; risk: ConnectionToolRisk; reason: string }>;
}

export interface ConnectionToolExposureRuntime {
  /** Apply the complete allowlist atomically for this connection. */
  setExposedTools(connectionId: string, toolNames: string[]): Promise<void> | void;
  listExposedTools?(connectionId: string): Promise<string[]> | string[];
}

export interface ConnectionExposureSelectionStore {
  get(connectionId: string): Promise<string[] | undefined> | string[] | undefined;
  set(connectionId: string, tools: string[]): Promise<void> | void;
  delete?(connectionId: string): Promise<void> | void;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export class ConnectionExposureService {
  constructor(
    private readonly runtime: ConnectionToolExposureRuntime,
    private readonly selections?: ConnectionExposureSelectionStore,
  ) {}

  async decide(
    connectionId: string,
    classifications: ConnectionToolClassification[],
    policy: ConnectionExposurePolicy = {},
  ): Promise<ConnectionExposureDecision> {
    const mode = policy.mode || 'read_only';
    const persisted = this.selections ? await this.selections.get(connectionId) : undefined;
    const selected = new Set(unique(policy.selectedTools || persisted || []));
    const approvedRisks = new Set<ConnectionToolRisk>(policy.approvedRisks || ['read-only']);
    const expose: string[] = [];
    const withhold: ConnectionExposureDecision['withhold'] = [];

    for (const classification of classifications) {
      const selectedByUser = selected.has(classification.toolName);
      let allowed = false;
      let reason = '';

      if (classification.risk === 'unknown' && policy.blockUnknown !== false) {
        reason = 'Unknown tools are blocked until explicitly classified.';
      } else if (mode === 'read_only') {
        allowed = classification.risk === 'read-only';
        if (!allowed) reason = 'The connection is configured for read-only exposure.';
      } else if (mode === 'selected') {
        allowed = selectedByUser && approvedRisks.has(classification.risk);
        if (!selectedByUser) reason = 'The tool was not selected by the user.';
        else if (!allowed) reason = `Risk class ${classification.risk} was not approved.`;
      } else {
        allowed = approvedRisks.has(classification.risk);
        if (!allowed) reason = `Risk class ${classification.risk} was not approved.`;
      }

      if (allowed) expose.push(classification.toolName);
      else withhold.push({ toolName: classification.toolName, risk: classification.risk, reason });
    }
    return { connectionId, expose: unique(expose), withhold };
  }

  async apply(decision: ConnectionExposureDecision): Promise<void> {
    // A complete replacement prevents previously exposed mutation tools from
    // surviving a switch back to read-only mode.
    await this.runtime.setExposedTools(decision.connectionId, unique(decision.expose));
    await this.selections?.set(decision.connectionId, unique(decision.expose));
  }

  async revoke(connectionId: string): Promise<void> {
    await this.runtime.setExposedTools(connectionId, []);
    await this.selections?.delete?.(connectionId);
  }

  async refresh(
    connectionId: string,
    classifications: ConnectionToolClassification[],
    policy: ConnectionExposurePolicy = {},
  ): Promise<ConnectionExposureDecision> {
    const decision = await this.decide(connectionId, classifications, policy);
    await this.apply(decision);
    return decision;
  }
}
