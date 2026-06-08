// Native Google Analytics (GA4) connector runtime. See §23B.
// Auth stays central in GoogleAnalyticsConnector (Google OAuth); this module owns
// schemas + dispatch.
import type { GoogleAnalyticsConnector } from '../../../../integrations/connectors/google-analytics.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition } from '../../../runtime-api.js';
import {
  connectorConnected,
  connectorHasCredentials,
  getLiveConnector,
  notConnected,
  toolError,
  toolOk,
} from '../_runtime/connector-helpers.js';

const CONNECTOR_ID = 'ga4';
const DISPLAY_NAME = 'Google Analytics';

function getGa4(): GoogleAnalyticsConnector | undefined {
  return getLiveConnector<GoogleAnalyticsConnector>(CONNECTOR_ID);
}

const ga4Extension: PrometheusExtensionDefinition = {
  id: CONNECTOR_ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: CONNECTOR_ID,
      name: DISPLAY_NAME,
      authType: 'oauth',
      capabilities: ['analytics'],
      toolNames: ['connector_ga4_run_report', 'connector_ga4_realtime_users', 'connector_ga4_list_properties'],
      isConnected: () => connectorConnected(CONNECTOR_ID),
      hasCredentials: () => connectorHasCredentials(CONNECTOR_ID),
      describeStatus: () => (connectorConnected(CONNECTOR_ID) ? 'connected' : 'not connected'),
    });

    api.registerTool({
      name: 'connector_ga4_run_report',
      description: '[Google Analytics] Run a GA4 analytics report. Fetch metrics like sessions, users, pageviews, bounce rate, etc.',
      parameters: {
        type: 'object',
        required: ['metrics'],
        properties: {
          metrics: {
            type: 'array',
            items: { type: 'string' },
            description: 'Metric names, e.g., ["sessions", "activeUsers", "newUsers", "bounceRate", "averageSessionDuration", "screenPageViews"]',
          },
          dimensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Dimension names to break down by, e.g., ["date", "country", "deviceCategory", "sessionSource", "pagePath"]',
          },
          start_date: { type: 'string', description: 'Start date, e.g., "30daysAgo", "7daysAgo", "2024-01-01" (default: 30daysAgo)' },
          end_date: { type: 'string', description: 'End date, e.g., "today", "yesterday", "2024-01-31" (default: today)' },
          property_id: { type: 'string', description: 'GA4 property ID (overrides GA4_PROPERTY_ID env var)' },
          limit: { type: 'number', description: 'Max rows to return (default: 100)' },
        },
      },
      connectorId: CONNECTOR_ID,
      capability: 'analytics',
      execute: async (args: any) => {
        if (!connectorConnected(CONNECTOR_ID)) return notConnected(DISPLAY_NAME);
        const ga4 = getGa4();
        if (!ga4) return toolError(`${DISPLAY_NAME} is unavailable.`);
        const data = await ga4.runReport({
          metrics: args.metrics || ['sessions'],
          dimensions: args.dimensions,
          startDate: args.start_date,
          endDate: args.end_date,
          propertyId: args.property_id,
          limit: args.limit,
        });
        const metricHeaders = (data.metricHeaders || []).map((h: any) => h.name);
        const dimensionHeaders = (data.dimensionHeaders || []).map((h: any) => h.name);
        const header = [...dimensionHeaders, ...metricHeaders].join(' | ');
        const rows = (data.rows || []).map((row: any) => {
          const dims = (row.dimensionValues || []).map((v: any) => v.value);
          const mets = (row.metricValues || []).map((v: any) => v.value);
          return [...dims, ...mets].join(' | ');
        });
        return toolOk([header, ...rows.slice(0, 50)].join('\n'));
      },
    });

    api.registerTool({
      name: 'connector_ga4_realtime_users',
      description: '[Google Analytics] Get the current number of active users on the site right now (realtime report).',
      parameters: {
        type: 'object',
        required: [],
        properties: { property_id: { type: 'string', description: 'GA4 property ID (overrides GA4_PROPERTY_ID env var)' } },
      },
      connectorId: CONNECTOR_ID,
      capability: 'analytics',
      execute: async (args: { property_id?: string }) => {
        if (!connectorConnected(CONNECTOR_ID)) return notConnected(DISPLAY_NAME);
        const ga4 = getGa4();
        if (!ga4) return toolError(`${DISPLAY_NAME} is unavailable.`);
        const result = await ga4.getRealtimeUsers(args.property_id);
        return toolOk(`Active users right now: ${result.activeUsers}`);
      },
    });

    api.registerTool({
      name: 'connector_ga4_list_properties',
      description: '[Google Analytics] List all GA4 properties accessible to the connected Google account.',
      parameters: { type: 'object', required: [], properties: {} },
      connectorId: CONNECTOR_ID,
      capability: 'analytics',
      execute: async () => {
        if (!connectorConnected(CONNECTOR_ID)) return notConnected(DISPLAY_NAME);
        const ga4 = getGa4();
        if (!ga4) return toolError(`${DISPLAY_NAME} is unavailable.`);
        const properties = await ga4.listProperties();
        if (!properties.length) return toolOk('No GA4 properties found for this account.');
        return toolOk(properties.map((p: any) => `${p.name}: ${p.displayName} (industry: ${p.industryCategory || 'n/a'})`).join('\n'));
      },
    });
  },
};

export default ga4Extension;
