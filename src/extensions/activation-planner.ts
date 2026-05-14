import { getExtensionRuntimeRegistry } from './runtime-registry.js';

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === value || pattern === '*') return true;
  if (!pattern.includes('*')) return false;
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(value);
}

export type ExtensionActivationReason =
  | 'startup'
  | 'tool_contract'
  | 'tool_activation_hint'
  | 'capability_contract'
  | 'capability_activation_hint'
  | 'connected_connector';

export interface ExtensionActivationPlanEntry {
  extensionId: string;
  reason: ExtensionActivationReason;
}

export interface ExtensionActivationPlan {
  entries: ExtensionActivationPlanEntry[];
}

function pushUnique(entries: ExtensionActivationPlanEntry[], entry: ExtensionActivationPlanEntry): void {
  if (entries.some((existing) => existing.extensionId === entry.extensionId && existing.reason === entry.reason)) {
    return;
  }
  entries.push(entry);
}

export function planExtensionActivation(params: {
  startup?: boolean;
  toolName?: string;
  capability?: string;
  connectedOnly?: boolean;
}): ExtensionActivationPlan {
  const registry = getExtensionRuntimeRegistry();
  const entries: ExtensionActivationPlanEntry[] = [];

  for (const extension of registry.listExtensions()) {
    if (params.startup && extension.activation?.onStartup === true) {
      pushUnique(entries, { extensionId: extension.id, reason: 'startup' });
    }

    if (params.toolName) {
      if (extension.contracts?.tools?.includes(params.toolName)) {
        pushUnique(entries, { extensionId: extension.id, reason: 'tool_contract' });
      }
      if (extension.activation?.whenToolsRequested?.some((pattern) => matchesPattern(params.toolName!, pattern))) {
        pushUnique(entries, { extensionId: extension.id, reason: 'tool_activation_hint' });
      }
    }

    if (params.capability) {
      if (extension.contracts?.capabilities?.includes(params.capability)) {
        pushUnique(entries, { extensionId: extension.id, reason: 'capability_contract' });
      }
      if (extension.activation?.whenCapabilityRequested?.includes(params.capability)) {
        pushUnique(entries, { extensionId: extension.id, reason: 'capability_activation_hint' });
      }
    }

    if (params.connectedOnly && extension.activation?.whenConnected === true) {
      const connectorIds = extension.contracts?.connectors || [];
      if (connectorIds.some((id) => registry.getConnector(id)?.isConnected?.() === true)) {
        pushUnique(entries, { extensionId: extension.id, reason: 'connected_connector' });
      }
    }
  }

  return {
    entries: entries.sort((left, right) =>
      left.extensionId.localeCompare(right.extensionId) || left.reason.localeCompare(right.reason),
    ),
  };
}
