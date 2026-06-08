// Native Salesforce connector runtime. See §23B. Auth stays in SalesforceConnector.
import type { SalesforceConnector } from '../../../../integrations/connectors/salesforce.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

const ID = 'salesforce';
const NAME = 'Salesforce';
const tools = ['connector_salesforce_query', 'connector_salesforce_search', 'connector_salesforce_create_record', 'connector_salesforce_get_record'];

async function withConn(fn: (c: SalesforceConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<SalesforceConnector>(ID);
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
      name: 'connector_salesforce_query',
      description: '[Salesforce] Run a SOQL query against Salesforce data (SELECT ... FROM ... WHERE ...).',
      parameters: { type: 'object', required: ['soql'], properties: { soql: { type: 'string', description: 'SOQL query string, e.g., "SELECT Id, Name, Email FROM Contact WHERE Account.Name = \'Acme\' LIMIT 20"' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => {
        const result = await c.query(args.soql);
        if (!result.records?.length) return toolOk(`Query returned 0 records (totalSize: ${result.totalSize})`);
        return toolOk({ totalSize: result.totalSize, records: result.records });
      }),
    });

    api.registerTool({
      name: 'connector_salesforce_search',
      description: '[Salesforce] Full-text search across Salesforce objects using SOSL.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Search term — will be wrapped in SOSL: FIND {query} IN ALL FIELDS RETURNING Contact, Lead, Account, Opportunity' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => {
        const sosl = `FIND {${args.query}} IN ALL FIELDS RETURNING Contact(Id,Name,Email), Lead(Id,Name,Email,Company), Account(Id,Name), Opportunity(Id,Name,StageName)`;
        const records = await c.search(sosl);
        if (!records.length) return toolOk('No records found matching that search.');
        return toolOk(records);
      }),
    });

    api.registerTool({
      name: 'connector_salesforce_create_record',
      description: '[Salesforce] Create a new record in a Salesforce object (e.g., Lead, Contact, Opportunity).',
      parameters: { type: 'object', required: ['object_type', 'fields'], properties: { object_type: { type: 'string', description: 'Salesforce object type, e.g., "Lead", "Contact", "Opportunity", "Account"' }, fields: { type: 'object', description: 'Field values for the new record, e.g., {"LastName":"Smith","Email":"smith@acme.com","Company":"Acme"}' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => {
        const result = await c.createRecord(args.object_type, args.fields);
        return toolOk(`${args.object_type} record created. ID: ${result.id}`);
      }),
    });

    api.registerTool({
      name: 'connector_salesforce_get_record',
      description: '[Salesforce] Get a specific Salesforce record by ID.',
      parameters: { type: 'object', required: ['object_type', 'record_id'], properties: { object_type: { type: 'string', description: 'Salesforce object type (e.g., Contact, Lead, Account)' }, record_id: { type: 'string', description: 'Salesforce record ID' } } },
      connectorId: ID, capability: 'crm',
      execute: (args: any) => withConn(async (c) => toolOk(await c.getRecord(args.object_type, args.record_id))),
    });
  },
};

export default ext;
