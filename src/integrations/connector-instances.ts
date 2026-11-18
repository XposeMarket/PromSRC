/** Account-scoped clients. Legacy registry remains a separate compatibility path. */
import type { OAuthConnector, OAuthCallbackResult, OAuthStartResult } from './oauth-base.js';
import { XAccountConnector } from './connectors/x-account.js';
import { GmailConnector } from './connectors/gmail.js';
import { SlackConnector } from './connectors/slack.js';
import { GitHubConnector } from './connectors/github.js';
import { NotionConnector } from './connectors/notion.js';
import { RedditConnector } from './connectors/reddit.js';
import { GoogleDriveConnector } from './connectors/google-drive.js';
import { HubSpotConnector } from './connectors/hubspot.js';
import { SalesforceConnector } from './connectors/salesforce.js';
import { StripeConnector } from './connectors/stripe.js';
import { GoogleAnalyticsConnector } from './connectors/google-analytics.js';
import { InstagramConnector } from './connectors/instagram.js';
import { TikTokConnector } from './connectors/tiktok.js';
import { LinkedInConnector } from './connectors/linkedin.js';

const factories: Record<string, new (directory: string) => OAuthConnector> = {
  x: XAccountConnector, gmail: GmailConnector, slack: SlackConnector, github: GitHubConnector,
  notion: NotionConnector, reddit: RedditConnector, google_drive: GoogleDriveConnector,
  hubspot: HubSpotConnector, salesforce: SalesforceConnector, stripe: StripeConnector,
  ga4: GoogleAnalyticsConnector, instagram: InstagramConnector,
  tiktok: TikTokConnector, linkedin: LinkedInConnector,
};

export const nativeAccountConnectorIds: readonly string[] = Object.freeze(Object.keys(factories));

/** Owned by one config/runtime. Never falls back to the legacy service client. */
export class ConnectorInstanceRegistry {
  private readonly clients = new Map<string, { serviceId: string; client: OAuthConnector }>();
  private readonly attempts = new Map<string, { serviceId: string; connectionId: string; result?: OAuthCallbackResult }>();
  constructor(private readonly directory: string) {}

  start(serviceId: string, connectionId: string, attemptId: string, expectedAccountId?: string, scopes?: string[]): OAuthStartResult {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId)) throw new Error('INVALID_ATTEMPT_ID');
    if (this.attempts.has(attemptId)) throw new Error('ATTEMPT_ALREADY_EXISTS');
    // Registered loopback ports are per provider. Serialize provider flows explicitly rather than steal a listener.
    if ([...this.attempts.values()].some(attempt => attempt.serviceId === serviceId && !attempt.result)) throw new Error('PROVIDER_AUTH_IN_PROGRESS');
    const client = this.get(serviceId, connectionId);
    const result = client.startFlow(expectedAccountId, scopes);
    if (result.error || !result.authUrl) return result;
    const attempt: { serviceId: string; connectionId: string; result?: OAuthCallbackResult } = { serviceId, connectionId };
    this.attempts.set(attemptId, attempt);
    void client.listenForCallback().then(result => {
      if (this.attempts.get(attemptId) === attempt) attempt.result = result;
    }, () => {
      if (this.attempts.get(attemptId) === attempt) attempt.result = { success: false, error: 'Authorization callback failed.' };
    });
    return { ...result, flowId: attemptId };
  }

  poll(serviceId: string, connectionId: string, attemptId: string): OAuthCallbackResult | null {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.serviceId !== serviceId || attempt.connectionId !== connectionId) throw new Error('ACCOUNT_ATTEMPT_UNAVAILABLE');
    if (!attempt.result) return null;
    this.attempts.delete(attemptId);
    return attempt.result;
  }

  hasPending(serviceId: string, connectionId: string): boolean {
    return [...this.attempts.values()].some(attempt => attempt.serviceId === serviceId && attempt.connectionId === connectionId);
  }

  cancel(serviceId: string, connectionId: string): void {
    this.get(serviceId, connectionId).cancelFlow();
    for (const [id, attempt] of this.attempts) {
      if (attempt.serviceId === serviceId && attempt.connectionId === connectionId) this.attempts.delete(id);
    }
  }

  get(serviceId: string, connectionId: string): OAuthConnector {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId)) throw new Error('INVALID_CONNECTION_ID');
    const existing = this.clients.get(connectionId);
    if (existing) {
      if (existing.serviceId !== serviceId) throw new Error('CONNECTION_SERVICE_MISMATCH');
      return existing.client;
    }
    const Factory = Object.prototype.hasOwnProperty.call(factories, serviceId) ? factories[serviceId] : undefined;
    if (!Factory) throw new Error('UNSUPPORTED_ACCOUNT_CONNECTOR');
    const client = new Factory(this.directory).bindAccountInstance(connectionId);
    this.clients.set(connectionId, { serviceId, client });
    return client;
  }

  disconnect(serviceId: string, connectionId: string): void {
    // Retain the object: in-flight callbacks/refresh retain this same lifecycle owner.
    this.cancel(serviceId, connectionId);
    this.get(serviceId, connectionId).clearTokens();
  }
}

const runtimeRegistries = new Map<string, ConnectorInstanceRegistry>();
/** One lifecycle owner per configuration directory across setup and execution. */
export function getConnectorInstances(directory: string): ConnectorInstanceRegistry {
  let registry = runtimeRegistries.get(directory);
  if (!registry) { registry = new ConnectorInstanceRegistry(directory); runtimeRegistries.set(directory, registry); }
  return registry;
}
