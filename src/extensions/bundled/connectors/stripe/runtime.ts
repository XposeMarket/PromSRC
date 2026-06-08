// Native Stripe connector runtime (reference implementation for the
// legacy→native connector migration; see §23B).
//
// Auth stays central: execute closures fetch the live, startup-initialized
// StripeConnector instance (which owns the secret-key vault access) and call its
// methods. Schemas + dispatch live here instead of connector-tools.ts /
// connector-handlers.ts.
import type { StripeConnector } from '../../../../integrations/connectors/stripe.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition } from '../../../runtime-api.js';
import {
  connectorConnected,
  connectorHasCredentials,
  getLiveConnector,
  notConnected,
  toolError,
  toolOk,
} from '../_runtime/connector-helpers.js';

const CONNECTOR_ID = 'stripe';
const DISPLAY_NAME = 'Stripe';

function getStripe(): StripeConnector | undefined {
  return getLiveConnector<StripeConnector>(CONNECTOR_ID);
}

const stripeExtension: PrometheusExtensionDefinition = {
  id: CONNECTOR_ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: CONNECTOR_ID,
      name: DISPLAY_NAME,
      authType: 'api_key',
      capabilities: ['payments'],
      toolNames: [
        'connector_stripe_get_balance',
        'connector_stripe_list_customers',
        'connector_stripe_list_charges',
        'connector_stripe_list_products',
      ],
      isConnected: () => connectorConnected(CONNECTOR_ID),
      hasCredentials: () => connectorHasCredentials(CONNECTOR_ID),
      describeStatus: () => (connectorConnected(CONNECTOR_ID) ? 'connected' : 'not connected'),
    });

    api.registerTool({
      name: 'connector_stripe_get_balance',
      description: '[Stripe] Get the current Stripe account balance (available, pending amounts by currency).',
      parameters: { type: 'object', required: [], properties: {} },
      connectorId: CONNECTOR_ID,
      capability: 'payments',
      execute: async () => {
        if (!connectorConnected(CONNECTOR_ID)) return notConnected(DISPLAY_NAME);
        const stripe = getStripe();
        if (!stripe) return toolError(`${DISPLAY_NAME} is unavailable.`);
        const balance = await stripe.getBalance();
        const lines: string[] = ['Stripe Account Balance:'];
        for (const entry of balance.available || []) {
          lines.push(`  Available: ${(entry.amount / 100).toFixed(2)} ${String(entry.currency).toUpperCase()}`);
        }
        for (const entry of balance.pending || []) {
          lines.push(`  Pending: ${(entry.amount / 100).toFixed(2)} ${String(entry.currency).toUpperCase()}`);
        }
        return toolOk(lines.join('\n'));
      },
    });

    api.registerTool({
      name: 'connector_stripe_list_customers',
      description: '[Stripe] List recent customers in the Stripe account.',
      parameters: {
        type: 'object',
        required: [],
        properties: { limit: { type: 'number', description: 'Number of customers to return (default: 20, max: 100)' } },
      },
      connectorId: CONNECTOR_ID,
      capability: 'payments',
      execute: async (args: { limit?: number }) => {
        if (!connectorConnected(CONNECTOR_ID)) return notConnected(DISPLAY_NAME);
        const stripe = getStripe();
        if (!stripe) return toolError(`${DISPLAY_NAME} is unavailable.`);
        const customers = await stripe.listCustomers(args.limit || 20);
        if (!customers.length) return toolOk('No customers found.');
        return toolOk(
          customers
            .map((c: any) => `${c.id}: ${c.email || '(no email)'} — ${c.name || ''} (created: ${new Date(c.created * 1000).toLocaleDateString()})`)
            .join('\n'),
        );
      },
    });

    api.registerTool({
      name: 'connector_stripe_list_charges',
      description: '[Stripe] List recent charges/payments in the Stripe account.',
      parameters: {
        type: 'object',
        required: [],
        properties: { limit: { type: 'number', description: 'Number of charges to return (default: 20, max: 100)' } },
      },
      connectorId: CONNECTOR_ID,
      capability: 'payments',
      execute: async (args: { limit?: number }) => {
        if (!connectorConnected(CONNECTOR_ID)) return notConnected(DISPLAY_NAME);
        const stripe = getStripe();
        if (!stripe) return toolError(`${DISPLAY_NAME} is unavailable.`);
        const charges = await stripe.listCharges(args.limit || 20);
        if (!charges.length) return toolOk('No charges found.');
        return toolOk(
          charges
            .map((c: any) => {
              const amt = ((c.amount || 0) / 100).toFixed(2);
              return `${c.id}: ${amt} ${(c.currency || 'usd').toUpperCase()} | ${c.status} | ${c.description || 'no desc'} | ${new Date(c.created * 1000).toLocaleDateString()}`;
            })
            .join('\n'),
        );
      },
    });

    api.registerTool({
      name: 'connector_stripe_list_products',
      description: '[Stripe] List active products and their prices in the Stripe account.',
      parameters: {
        type: 'object',
        required: [],
        properties: { limit: { type: 'number', description: 'Number of products to return (default: 20)' } },
      },
      connectorId: CONNECTOR_ID,
      capability: 'payments',
      execute: async (args: { limit?: number }) => {
        if (!connectorConnected(CONNECTOR_ID)) return notConnected(DISPLAY_NAME);
        const stripe = getStripe();
        if (!stripe) return toolError(`${DISPLAY_NAME} is unavailable.`);
        const products = await stripe.listProducts(args.limit || 20);
        if (!products.length) return toolOk('No products found.');
        return toolOk(products.map((p: any) => `${p.id}: ${p.name} — ${p.description || 'no description'}`).join('\n'));
      },
    });
  },
};

export default stripeExtension;
