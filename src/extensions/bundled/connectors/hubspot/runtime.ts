// Native HubSpot connector runtime. See §23B. Auth stays in HubSpotConnector.
import type { HubSpotConnector } from '../../../../integrations/connectors/hubspot.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

const ID = 'hubspot';
const NAME = 'HubSpot';
const tools = ['connector_hubspot_list_contacts', 'connector_hubspot_get_contact', 'connector_hubspot_create_contact', 'connector_hubspot_search', 'connector_hubspot_list_deals'];

async function withConn(fn: (c: HubSpotConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<HubSpotConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  return fn(c);
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['crm'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => (connectorConnected(ID) ? 'connected' : 'not connected'),
    });

    api.registerTool({
      name: 'connector_hubspot_list_contacts',
      description: '[HubSpot] List contacts in the HubSpot CRM.',
      parameters: { type: 'object', required: [], properties: { limit: { type: 'number', description: 'Number of contacts to return (default: 20)' }, after: { type: 'string', description: 'Pagination cursor for next page' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => {
        const { results, next } = await c.listContacts(args.limit || 20, args.after);
        if (!results.length) return toolOk('No contacts found.');
        const lines = results.map((ct: any) => {
          const p = ct.properties;
          return `${ct.id}: ${p.firstname || ''} ${p.lastname || ''} <${p.email || 'no email'}> — ${p.company || ''} (${p.jobtitle || ''})`;
        });
        if (next) lines.push(`\nNext page cursor: ${next}`);
        return toolOk(lines.join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_hubspot_get_contact',
      description: '[HubSpot] Get detailed information about a specific HubSpot contact.',
      parameters: { type: 'object', required: ['contact_id'], properties: { contact_id: { type: 'string', description: 'HubSpot contact ID' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => toolOk(await c.getContact(args.contact_id))),
    });

    api.registerTool({
      name: 'connector_hubspot_create_contact',
      description: '[HubSpot] Create a new contact in HubSpot CRM.',
      parameters: { type: 'object', required: ['email'], properties: { email: { type: 'string', description: 'Contact email address' }, firstname: { type: 'string', description: 'First name' }, lastname: { type: 'string', description: 'Last name' }, phone: { type: 'string', description: 'Phone number' }, company: { type: 'string', description: 'Company name' }, jobtitle: { type: 'string', description: 'Job title' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => {
        const properties: Record<string, string> = { email: args.email };
        if (args.firstname) properties.firstname = args.firstname;
        if (args.lastname) properties.lastname = args.lastname;
        if (args.phone) properties.phone = args.phone;
        if (args.company) properties.company = args.company;
        if (args.jobtitle) properties.jobtitle = args.jobtitle;
        const contact = await c.createContact(properties);
        return toolOk(`Contact created: ID ${contact.id} — ${args.firstname || ''} ${args.lastname || ''} <${args.email}>`);
      }),
    });

    api.registerTool({
      name: 'connector_hubspot_search',
      description: '[HubSpot] Search contacts, companies, or deals in HubSpot.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Search query (searches across name, email, company)' }, limit: { type: 'number', description: 'Number of results (default: 20)' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => {
        const results = await c.searchContacts(args.query, args.limit || 20);
        if (!results.length) return toolOk('No contacts found matching that query.');
        return toolOk(results.map((ct: any) => {
          const p = ct.properties;
          return `${ct.id}: ${p.firstname || ''} ${p.lastname || ''} <${p.email || ''}> — ${p.company || ''}`;
        }).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_hubspot_list_deals',
      description: '[HubSpot] List deals in the HubSpot CRM pipeline.',
      parameters: { type: 'object', required: [], properties: { limit: { type: 'number', description: 'Number of deals (default: 20)' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => {
        const deals = await c.listDeals(args.limit || 20);
        if (!deals.length) return toolOk('No deals found.');
        return toolOk(deals.map((d: any) => {
          const p = d.properties;
          return `${d.id}: ${p.dealname} — $${p.amount || '0'} | stage: ${p.dealstage} | close: ${p.closedate?.slice(0, 10) || 'n/a'}`;
        }).join('\n'));
      }),
    });
  },
};

export default ext;
