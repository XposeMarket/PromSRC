// src/integrations/connectors/stripe.ts
// Stripe connector — uses secret API key, not OAuth.
// The key is stored in the vault under integration.stripe.oauth_tokens.
//
// SETUP REQUIRED:
//   1. https://dashboard.stripe.com/apikeys → copy "Secret key" (sk_live_... or sk_test_...)
//   2. Set env var: STRIPE_SECRET_KEY
//   OR enter it in Settings → Connectors → Stripe

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens, OAuthStartResult } from '../oauth-base.js';

export class StripeConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'stripe',
      name: 'Stripe',
      authUrl: '',
      tokenUrl: '',
      clientId: '',
      scopes: [],
      usePkce: false,
      callbackPort: 19428,
      callbackPath: '/auth/callback/stripe',
    };
    super(cfg, configDir);
  }

  isConnected(): boolean {
    const envKey = process.env.STRIPE_SECRET_KEY || '';
    if (envKey) return true;
    return super.isConnected();
  }

  async getValidAccessToken(): Promise<string> {
    const envKey = process.env.STRIPE_SECRET_KEY || '';
    if (envKey) return envKey;
    const tokens = this.loadTokens();
    if (tokens?.access_token) return tokens.access_token;
    throw new Error('Stripe not configured. Set STRIPE_SECRET_KEY environment variable.');
  }

  // Stripe doesn't use OAuth — override startFlow to save the env key
  startFlow(): OAuthStartResult {
    const envKey = process.env.STRIPE_SECRET_KEY || '';
    if (envKey) {
      this.saveTokens({ access_token: envKey, expires_at: Date.now() + 365 * 24 * 3600 * 1000, account_email: 'stripe-key' });
    }
    return { success: false, authUrl: 'https://dashboard.stripe.com/apikeys', flowId: 'stripe' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async buildTokens(_data: Record<string, any>): Promise<ConnectorTokens> {
    return { access_token: '', expires_at: 0 };
  }

  private async apiGet(path: string): Promise<any> {
    const key = await this.getValidAccessToken();
    const res = await fetch(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Stripe API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async getBalance(): Promise<any> {
    return this.apiGet('/v1/balance');
  }

  async listCustomers(limit = 20): Promise<any[]> {
    const data = await this.apiGet(`/v1/customers?limit=${limit}`);
    return data.data || [];
  }

  async listCharges(limit = 20): Promise<any[]> {
    const data = await this.apiGet(`/v1/charges?limit=${limit}&expand[]=data.customer`);
    return data.data || [];
  }

  async listPaymentIntents(limit = 20): Promise<any[]> {
    const data = await this.apiGet(`/v1/payment_intents?limit=${limit}`);
    return data.data || [];
  }

  async listProducts(limit = 20): Promise<any[]> {
    const data = await this.apiGet(`/v1/products?limit=${limit}&active=true`);
    return data.data || [];
  }

  async getCustomer(customerId: string): Promise<any> {
    return this.apiGet(`/v1/customers/${customerId}`);
  }
}
