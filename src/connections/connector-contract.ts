import { resolveToolCapabilityMetadata } from '../gateway/tool-capabilities.js';
import type {
  ClassifiedConnectionTool,
  ConnectionAccountIdentity,
  ConnectionCapabilityContract,
  ConnectionCapabilityGrant,
  ConnectionResourceIdentity,
  ConnectionToolRisk,
} from './types.js';

const MAX_IDENTITY_LENGTH = 256;

function safeText(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.slice(0, MAX_IDENTITY_LENGTH);
}

/** Keep provider identity displayable and durable without accepting tokens or
 * arbitrary provider response objects into the connection record. */
export function normalizeConnectionAccountIdentity(
  value: unknown,
  provider?: string,
): ConnectionAccountIdentity | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const account: ConnectionAccountIdentity = {
    provider: safeText(input.provider) || safeText(provider),
    providerAccountId: safeText(input.providerAccountId ?? input.accountId ?? input.id),
    displayName: safeText(input.displayName ?? input.name),
    username: safeText(input.username ?? input.login),
    email: safeText(input.email ?? input.accountEmail),
  };
  return Object.values(account).some(Boolean) ? account : undefined;
}

export function normalizeConnectionResources(value: unknown): ConnectionResourceIdentity[] {
  if (!Array.isArray(value)) return [];
  const normalized: Array<ConnectionResourceIdentity | undefined> = value
    .map((item) => {
      if (!item || typeof item !== 'object') return undefined;
      const input = item as Record<string, unknown>;
      const kind = safeText(input.kind);
      const id = safeText(input.id);
      if (!kind || !id) return undefined;
      return {
        kind,
        id,
        displayName: safeText(input.displayName ?? input.name),
        parentId: safeText(input.parentId),
        scope: safeText(input.scope),
      } satisfies ConnectionResourceIdentity;
    })
  return normalized.filter((item): item is ConnectionResourceIdentity => Boolean(item)).slice(0, 200);
}

function toolRisk(name: string): ConnectionToolRisk {
  const metadata = resolveToolCapabilityMetadata(name);
  if (!metadata.known) return 'unknown';
  if (metadata.destructive) return 'destructive';
  if (metadata.externalWrite && /stripe|payment|financial|billing/i.test(name)) return 'financial-mutation';
  if (metadata.externalWrite) return 'write';
  if (metadata.localWrite) return 'write';
  return metadata.readOnly ? 'read-only' : 'unknown';
}

/** Fail closed for connector tools: read-only tools can be exposed by the
 * default connection, while writes and unknown tools remain review-gated. */
export function classifyConnectorTools(
  toolNames: string[],
  readOnlyRequested = true,
): { registeredTools: string[]; exposedTools: string[]; tools: ClassifiedConnectionTool[] } {
  const registeredTools = [...new Set(toolNames.map((tool) => String(tool || '').trim()).filter(Boolean))];
  const tools = registeredTools.map((name) => {
    const risk = toolRisk(name);
    const approved = readOnlyRequested && risk === 'read-only';
    return {
      name,
      risk,
      approved,
      classificationReason: approved
        ? 'Explicitly classified read-only connector tool.'
        : 'Write, destructive, credential-sensitive, or unknown connector tool requires explicit approval.',
    } satisfies ClassifiedConnectionTool;
  });
  return { registeredTools, exposedTools: tools.filter((tool) => tool.approved).map((tool) => tool.name), tools };
}

export function buildConnectorCapabilityGrants(
  contracts: ConnectionCapabilityContract[] | undefined,
  requestedCapabilities: string[],
  readOnlyRequested = true,
): { grantedCapabilities: string[]; capabilityGrants: ConnectionCapabilityGrant[] } {
  const requested = new Set(requestedCapabilities.map((value) => String(value || '').trim()).filter(Boolean));
  const normalizedContracts = (contracts || []).filter((item) => item?.id).map((item) => ({
    ...item,
    id: String(item.id),
    risk: item.risk || 'high_impact',
  }));
  const knownIds = new Set(normalizedContracts.map((item) => item.id));
  const allContracts = [
    ...normalizedContracts,
    ...[...requested].filter((id) => !knownIds.has(id)).map((id) => ({ id, label: undefined, description: undefined, risk: 'high_impact' as const })),
  ];
  const capabilityGrants = allContracts.map((item) => {
    const granted = requested.has(item.id) && readOnlyRequested && item.risk === 'read';
    return {
      id: item.id,
      label: item.label,
      risk: item.risk,
      granted,
      approvalRequired: !granted,
      source: 'manifest' as const,
    };
  });
  return {
    grantedCapabilities: capabilityGrants.filter((item) => item.granted).map((item) => item.id),
    capabilityGrants,
  };
}

export function accountIdentityKey(account?: ConnectionAccountIdentity): string | undefined {
  if (!account) return undefined;
  return safeText(account.providerAccountId) || safeText(account.email) || safeText(account.username);
}

export function accountIdentitiesMatch(
  left?: ConnectionAccountIdentity,
  right?: ConnectionAccountIdentity,
): boolean {
  if (!left || !right) return true;
  if (left.provider && right.provider && left.provider !== right.provider) return false;
  if (left.providerAccountId && right.providerAccountId) return left.providerAccountId === right.providerAccountId;
  if (left.email && right.email) return left.email.toLowerCase() === right.email.toLowerCase();
  if (left.username && right.username) return left.username.toLowerCase() === right.username.toLowerCase();
  // Providers do not always return the same stable field on every endpoint;
  // do not reject a session merely because one side omitted it.
  return true;
}
