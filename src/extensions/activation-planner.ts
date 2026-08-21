import { getExtensionRuntimeRegistry } from './runtime-registry.js';
import { loadManifestRuntimeExtensions } from './runtime-loader.js';
import { ensurePrometheusExtensionRuntimeLoaded } from './legacy-connector-adapter.js';
import type { PrometheusExtensionRuntimeRecord } from './runtime-api.js';
import {
  evaluatePromptSignals,
  matchesActionableMention,
  normalizePromptSignalText,
} from '../runtime/prompt-signal-matcher.js';

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

export type MessageExtensionActivationCategory = 'external_apps' | 'integration_admin' | 'mcp_server_tools';

export interface MessageExtensionActivationEntry {
  extensionId: string;
  category: MessageExtensionActivationCategory;
  reason: 'message_alias' | 'message_signal' | 'explicit_tool';
  matchedAliases: string[];
}

export interface MessageExtensionActivationPlan {
  entries: MessageExtensionActivationEntry[];
  categories: MessageExtensionActivationCategory[];
  blockedExtensionIds: string[];
  hasConnectedExtension: boolean;
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
  loadManifestRuntimeExtensions();
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

const GENERIC_EXTENSION_ALIASES = new Set([
  'api', 'app', 'apps', 'connector', 'connectors', 'external app', 'external apps',
  'integration', 'integrations', 'plugin', 'plugins', 'service', 'services',
  'tool', 'tools', 'mcp', 'mcp server', 'server', 'provider', 'oauth', 'api key',
]);

function extensionKind(extension: PrometheusExtensionRuntimeRecord): 'connector' | 'mcp_preset' | 'integration' | 'other' {
  const kind = extension.manifest?.kind;
  if (kind === 'connector' || kind === 'mcp_preset' || kind === 'integration') return kind;
  if ((extension.contracts?.connectors || []).length > 0) return 'connector';
  if ((extension.contracts?.mcpPresets || []).length > 0) return 'mcp_preset';
  return 'other';
}

function normalizeAliasCandidate(value: unknown): string {
  return normalizePromptSignalText(value);
}

function extensionMessageAliases(extension: PrometheusExtensionRuntimeRecord): string[] {
  const manifest = extension.manifest;
  const values = [
    extension.id,
    manifest?.id,
    manifest?.name,
    ...(manifest?.tags || []),
    ...(manifest?.connection?.aliases || []),
    manifest?.connection?.providerApp?.provider,
    ...(extension.activation?.aliases || []),
  ];
  const aliases = new Set<string>();
  for (const value of values) {
    const alias = normalizeAliasCandidate(value);
    if (!alias || alias.length < 3 || GENERIC_EXTENSION_ALIASES.has(alias)) continue;
    aliases.add(alias);
  }
  return [...aliases].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

const GENERIC_EXTENSION_TRIGGER_WORDS = new Set([
  'api', 'app', 'apps', 'connector', 'connectors', 'create', 'delete', 'get', 'gets', 'list', 'lists', 'read', 'reads',
  'search', 'searches', 'service', 'services', 'tool', 'tools', 'update', 'use', 'write', 'writes',
  'thread', 'threads', 'conversation', 'conversations', 'session', 'sessions', 'message', 'messages',
  'chat', 'chats', 'status', 'statuses', 'state', 'account', 'accounts', 'file', 'files', 'page', 'pages',
  'record', 'records', 'activity', 'activities', 'the', 'and',
  'for', 'with', 'from', 'read only', 'read only default',
]);

function addTriggerWord(set: Set<string>, raw: unknown): void {
  const value = normalizeAliasCandidate(raw);
  if (!value || value.length < 2 || GENERIC_EXTENSION_TRIGGER_WORDS.has(value)) return;
  set.add(value);
  // Contract names commonly use plural or snake_case forms. Keep both the
  // readable phrase and a light singular/abbreviation variant so "PR",
  // "commits", and "deployments" are natural triggers.
  for (const word of value.split(' ')) {
    if (word.length < 3 || GENERIC_EXTENSION_TRIGGER_WORDS.has(word)) continue;
    set.add(word);
    if (word.endsWith('ies')) {
      const singular = `${word.slice(0, -3)}y`;
      if (!GENERIC_EXTENSION_TRIGGER_WORDS.has(singular)) set.add(singular);
    } else if (word.endsWith('s') && !word.endsWith('ss')) {
      const singular = word.slice(0, -1);
      if (!GENERIC_EXTENSION_TRIGGER_WORDS.has(singular)) set.add(singular);
    }
  }
  if (/\bpull requests?\b/.test(value)) set.add('pr');
  if (/\bprs\b/.test(value)) set.add('pr');
}

function extensionMessageTriggerAliases(extension: PrometheusExtensionRuntimeRecord): string[] {
  const aliases = new Set(extensionMessageAliases(extension));
  const manifest = extension.manifest;
  const values: unknown[] = [
    ...(extension.contracts?.capabilities || []),
    ...(extension.contracts?.tools || []),
    ...(manifest?.tags || []),
    ...((manifest as any)?.connection?.requestedCapabilities || []).flatMap((item: any) => [item?.id, item?.label]),
  ];
  for (const value of values) {
    const normalized = normalizeAliasCandidate(value);
    const withoutPrefix = normalized
      .replace(/^connector\s+/, '')
      .replace(new RegExp(`^${escapeRegExp(normalizeAliasCandidate(extension.id))}\\s+`), '')
      .trim();
    addTriggerWord(aliases, withoutPrefix);
  }
  return [...aliases].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extensionToolNames(extension: PrometheusExtensionRuntimeRecord): string[] {
  return (extension.contracts?.tools || []).map(String).filter(Boolean);
}

function isConnectionAdministrationRequest(message: string): boolean {
  return /\b(?:connect|configure|authorize|authenticate|oauth|webhook|setup|set up|install|add)\b/i.test(message);
}

function isConnectedExtension(
  extension: PrometheusExtensionRuntimeRecord,
  registry: {
    getConnector?: (id: string) => { isConnected?: () => boolean } | undefined;
    isConnectorAvailable?: (id: string) => boolean;
  },
  connectedExtensionIds?: ReadonlySet<string>,
): boolean {
  const kind = extensionKind(extension);
  if (kind === 'mcp_preset') return connectedExtensionIds?.has(extension.id) === true;
  const connectorIds = extension.contracts?.connectors?.length
    ? extension.contracts.connectors
    : [extension.id];
  return connectorIds.some((id) => {
    try {
      if (registry.isConnectorAvailable) return registry.isConnectorAvailable(id) === true;
      return registry.getConnector?.(id)?.isConnected?.() === true;
    } catch { return false; }
  });
}

/**
 * Plan message-driven extension activation without a provider-specific list.
 *
 * Connector identity comes from the extension manifest (id, name, tags,
 * connection aliases, and optional activation aliases). A future user plugin
 * therefore participates automatically as soon as its descriptor is visible
 * to the extension registry.
 */
export function planMessageExtensionActivation(params: {
  message: string;
  registry?: {
    listExtensions(): PrometheusExtensionRuntimeRecord[];
    getConnector?: (id: string) => { isConnected?: () => boolean } | undefined;
    isConnectorAvailable?: (id: string) => boolean;
  };
  connectedExtensionIds?: ReadonlySet<string>;
}): MessageExtensionActivationPlan {
  if (!params.message?.trim()) {
    return { entries: [], categories: [], blockedExtensionIds: [], hasConnectedExtension: false };
  }
  if (!params.registry) ensurePrometheusExtensionRuntimeLoaded();
  const registry = params.registry || getExtensionRuntimeRegistry();
  const entries: MessageExtensionActivationEntry[] = [];
  const blockedExtensionIds = new Set<string>();
  let hasConnectedExtension = false;

  for (const extension of registry.listExtensions()) {
    const kind = extensionKind(extension);
    if (kind === 'other') continue;
    const connected = isConnectedExtension(extension, registry, params.connectedExtensionIds);
    if (connected) hasConnectedExtension = true;
    if (!connected) {
      // A disconnected connector may still be mentioned in a setup request,
      // but its operational tools must never enter the turn's tool surface.
      const aliases = extensionMessageTriggerAliases(extension);
      const operationalMention = matchesActionableMention(params.message, aliases, {
        explicitToolNames: extensionToolNames(extension),
      });
      if (operationalMention.matched) blockedExtensionIds.add(extension.id);
      if (kind === 'connector' && isConnectionAdministrationRequest(params.message)) {
        const setupMention = matchesActionableMention(params.message, extensionMessageAliases(extension), { allowTaskNouns: true });
        if (setupMention.matched) {
          entries.push({
            extensionId: extension.id,
            category: 'integration_admin',
            reason: 'message_alias',
            matchedAliases: setupMention.aliases,
          });
        }
      }
      continue;
    }
    const category: MessageExtensionActivationCategory = kind === 'mcp_preset'
      ? 'mcp_server_tools'
      : 'external_apps';
    const aliases = extensionMessageTriggerAliases(extension);
    const explicitToolNames = extensionToolNames(extension);
    const explicitTool = matchesActionableMention(params.message, [], { explicitToolNames }).explicitTool;
    const configuredSignals = extension.activation?.message;
    const signalMatch = evaluatePromptSignals(configuredSignals, params.message);
    const defaultMatch = matchesActionableMention(params.message, aliases, { explicitToolNames });
    const matched = explicitTool || (configuredSignals ? signalMatch.matched : defaultMatch.matched);
    if (!matched) continue;

    entries.push({
      extensionId: extension.id,
      category,
      reason: explicitTool ? 'explicit_tool' : configuredSignals ? 'message_signal' : 'message_alias',
      matchedAliases: explicitTool ? [] : configuredSignals && signalMatch.matched
        ? [...signalMatch.matchedPhrases, ...signalMatch.matchedAnyOf, ...signalMatch.matchedAllOf.flat()]
        : defaultMatch.aliases,
    });
    if (category === 'external_apps' && isConnectionAdministrationRequest(params.message)) {
      entries.push({
        extensionId: extension.id,
        category: 'integration_admin',
        reason: explicitTool ? 'explicit_tool' : configuredSignals ? 'message_signal' : 'message_alias',
        matchedAliases: defaultMatch.aliases,
      });
    }
  }

  const uniqueEntries = entries.filter((entry, index, all) => all.findIndex((candidate) =>
    candidate.extensionId === entry.extensionId
    && candidate.category === entry.category
    && candidate.reason === entry.reason
  ) === index);
  const categories = [...new Set(uniqueEntries.map((entry) => entry.category))].sort() as MessageExtensionActivationCategory[];
  return {
    entries: uniqueEntries.sort((left, right) =>
      left.extensionId.localeCompare(right.extensionId)
      || left.category.localeCompare(right.category)
      || left.reason.localeCompare(right.reason),
    ),
    categories,
    blockedExtensionIds: [...blockedExtensionIds].sort(),
    hasConnectedExtension,
  };
}
