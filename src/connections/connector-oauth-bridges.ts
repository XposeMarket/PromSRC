import type { OAuthCallbackResult, OAuthConnectorMetadata } from '../integrations/oauth-base';
import {
  disconnectConnector,
  getConnector,
  getConnectorOAuthMetadata,
  pollOAuthResult,
  revokeConnectorAccess,
  startOAuthFlowForConnector,
} from '../integrations/connector-registry';
import type { ConnectorOAuthBridge, ConnectorOAuthVerification } from './adapters/connector-oauth';
import { normalizeConnectionAccountIdentity, normalizeConnectionResources } from './connector-contract';

type ConnectorRuntime = {
  isConnected?: () => boolean;
  loadTokens?: () => Record<string, unknown> | null;
  getUser?: () => Promise<any>;
  getProfile?: () => Promise<any>;
  listFiles?: (query?: string, pageSize?: number) => Promise<any[]>;
  listProperties?: () => Promise<any[]>;
  getCurrentUser?: () => Promise<any>;
  authTest?: () => Promise<any>;
  getPortalInfo?: () => Promise<any>;
  listContacts?: (limit?: number, after?: string) => Promise<any>;
  getIdentity?: () => Promise<any>;
  getMe?: () => Promise<any>;
};

const NATIVE_OAUTH_CONNECTORS: Readonly<Record<string, string>> = Object.freeze({
  github: 'GitHub',
  gmail: 'Gmail',
  google_drive: 'Google Drive',
  ga4: 'Google Analytics 4',
  notion: 'Notion',
  slack: 'Slack',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  reddit: 'Reddit',
});

function runtimeFor(id: string): ConnectorRuntime {
  const connector = getConnector(id) as ConnectorRuntime | undefined;
  if (!connector) throw new Error(`${NATIVE_OAUTH_CONNECTORS[id] || id} connector runtime is unavailable.`);
  return connector;
}

function tokensFor(id: string): Record<string, unknown> {
  try {
    const tokens = runtimeFor(id).loadTokens?.();
    return tokens && typeof tokens === 'object' ? tokens : {};
  } catch {
    return {};
  }
}

function baseAccount(id: string): ReturnType<typeof normalizeConnectionAccountIdentity> {
  const metadata = getConnectorOAuthMetadata(id);
  return normalizeConnectionAccountIdentity({ provider: id, ...(metadata?.account || {}) }, id);
}

async function resourcesFor(id: string) {
  const connector = runtimeFor(id);
  const tokens = tokensFor(id);

  if (id === 'ga4' && connector.listProperties) {
    const properties = await connector.listProperties();
    return normalizeConnectionResources((properties || []).map((property: any) => ({
      kind: 'property',
      id: String(property?.name || '').replace(/^properties\//, ''),
      displayName: property?.displayName,
      scope: 'analytics read-only',
    })));
  }

  if (id === 'notion' && tokens.resource_id) {
    return normalizeConnectionResources([{
      kind: 'workspace',
      id: String(tokens.resource_id),
      displayName: tokens.resource_name,
      scope: 'shared pages and databases selected by the Notion connection',
    }]);
  }

  if (id === 'slack' && tokens.resource_id) {
    return normalizeConnectionResources([{
      kind: 'workspace',
      id: String(tokens.resource_id),
      displayName: tokens.resource_name,
      scope: 'installed Slack workspace',
    }]);
  }

  if (id === 'hubspot' && tokens.resource_id) {
    return normalizeConnectionResources([{
      kind: 'portal',
      id: String(tokens.resource_id),
      displayName: tokens.resource_name,
      scope: 'selected HubSpot portal',
    }]);
  }

  if (id === 'salesforce' && tokens.resource_id) {
    return normalizeConnectionResources([{
      kind: 'org',
      id: String(tokens.resource_id),
      displayName: tokens.resource_name,
      scope: String(tokens.instance_url || 'Salesforce org'),
    }]);
  }

  return [];
}

async function verifyNativeConnector(id: string): Promise<ConnectorOAuthVerification> {
  const connector = runtimeFor(id);
  if (connector.isConnected && !connector.isConnected()) throw new Error(`${NATIVE_OAUTH_CONNECTORS[id]} authorization is not connected.`);

  let account = baseAccount(id);
  const tokens = tokensFor(id);

  if (id === 'github' && connector.getUser) {
    const user = await connector.getUser();
    account = normalizeConnectionAccountIdentity({
      provider: id,
      providerAccountId: user?.id,
      displayName: user?.name || user?.login,
      username: user?.login,
      email: user?.email,
    }, id);
  } else if (id === 'gmail' && connector.getProfile) {
    const profile = await connector.getProfile();
    account = normalizeConnectionAccountIdentity({
      provider: id,
      ...(account || {}),
      email: profile?.email || account?.email,
    }, id);
  } else if (id === 'google_drive' && connector.listFiles) {
    await connector.listFiles('trashed = false', 1);
  } else if (id === 'ga4' && connector.listProperties) {
    await connector.listProperties();
  } else if (id === 'notion' && connector.getCurrentUser) {
    const user = await connector.getCurrentUser();
    account = normalizeConnectionAccountIdentity({
      provider: id,
      ...(account || {}),
      providerAccountId: account?.providerAccountId || user?.id,
      displayName: account?.displayName || user?.name,
    }, id);
  } else if (id === 'slack' && connector.authTest) {
    const auth = await connector.authTest();
    account = normalizeConnectionAccountIdentity({
      provider: id,
      providerAccountId: account?.providerAccountId || auth?.user_id,
      displayName: auth?.user || account?.displayName,
      username: auth?.user || account?.username,
      email: account?.email,
    }, id);
  } else if (id === 'hubspot' && connector.getPortalInfo) {
    let portal: any = {};
    try {
      portal = await connector.getPortalInfo();
    } catch {
      // Some HubSpot apps are not granted account-info access even when the
      // requested CRM read scopes are valid. A one-record contacts read still
      // verifies the selected portal without broadening the OAuth request.
      if (connector.listContacts) await connector.listContacts(1);
    }
    account = normalizeConnectionAccountIdentity({
      provider: id,
      ...(account || {}),
      displayName: account?.displayName || portal?.portalName || portal?.name,
    }, id);
  } else if (id === 'salesforce' && connector.getIdentity) {
    const identity = await connector.getIdentity();
    account = normalizeConnectionAccountIdentity({
      provider: id,
      ...(account || {}),
      providerAccountId: identity?.user_id || account?.providerAccountId,
      displayName: identity?.username || account?.displayName,
      username: identity?.username || account?.username,
      email: identity?.email || account?.email,
    }, id);
  } else if (id === 'reddit' && connector.getMe) {
    const me = await connector.getMe();
    account = normalizeConnectionAccountIdentity({
      provider: id,
      providerAccountId: me?.id || account?.providerAccountId,
      displayName: me?.name || account?.displayName,
      username: me?.name || account?.username,
      email: account?.email,
    }, id);
  }

  return { account, resources: await resourcesFor(id) };
}

function metadataFor(id: string): OAuthConnectorMetadata | undefined {
  return getConnectorOAuthMetadata(id);
}

export function buildConnectorOAuthBridges(): Readonly<Record<string, ConnectorOAuthBridge>> {
  return Object.fromEntries(Object.entries(NATIVE_OAUTH_CONNECTORS).map(([id, name]) => [id, {
    id,
    name,
    start: (expectedAccountId?: string, requestedScopes?: string[]) => startOAuthFlowForConnector(id, expectedAccountId, requestedScopes) as any,
    poll: (): Promise<OAuthCallbackResult | null> => pollOAuthResult(id),
    metadata: async () => {
      const metadata = metadataFor(id);
      if (!metadata) throw new Error(`${name} connector runtime is unavailable.`);
      let resources: any[] = [];
      try { resources = await resourcesFor(id); } catch { /* resource discovery is verified separately */ }
      return { ...metadata, resources };
    },
    verify: () => verifyNativeConnector(id),
    revoke: ['github', 'gmail', 'google_drive', 'ga4'].includes(id)
      ? async () => { await revokeConnectorAccess(id); }
      : undefined,
    clear: () => { disconnectConnector(id); },
    credentialReference: () => getConnector(id)?.credentialReference() || '',
  } satisfies ConnectorOAuthBridge]));
}
