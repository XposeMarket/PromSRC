// Native Slack connector runtime. See §23B. Auth stays in SlackConnector.
import type { SlackConnector } from '../../../../integrations/connectors/slack.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

const ID = 'slack';
const NAME = 'Slack';
const tools = ['connector_slack_list_channels', 'connector_slack_send_message', 'connector_slack_get_history', 'connector_slack_search'];

async function withConn(fn: (c: SlackConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<SlackConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  return fn(c);
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['chat'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => (connectorConnected(ID) ? 'connected' : 'not connected'),
    });

    api.registerTool({
      name: 'connector_slack_list_channels',
      description: '[Slack] List public and private channels in the connected Slack workspace.',
      parameters: { type: 'object', required: [], properties: { limit: { type: 'number', description: 'Number of channels to return (default: 100)' } } },
      connectorId: ID, capability: 'chat',
      execute: (args: any) => withConn(async (c) => {
        const channels = await c.listChannels(args.limit || 100);
        return toolOk(channels.map((ch: any) => `${ch.id}: #${ch.name} (${ch.num_members || 0} members${ch.is_private ? ', private' : ''})`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_slack_send_message',
      description: '[Slack] Send a message to a Slack channel or DM. Use the channel ID or name (e.g., "#general" or "C01234ABCD").',
      parameters: { type: 'object', required: ['channel', 'text'], properties: { channel: { type: 'string', description: 'Channel ID or name (e.g., "#general", "C01234ABCD", "@username")' }, text: { type: 'string', description: 'Message text (markdown supported)' } } },
      connectorId: ID, capability: 'chat',
      execute: (args: any) => withConn(async (c) => {
        const result = await c.postMessage(args.channel, args.text);
        return toolOk(`Message sent to ${args.channel}. Timestamp: ${result.ts}`);
      }),
    });

    api.registerTool({
      name: 'connector_slack_get_history',
      description: '[Slack] Get recent message history from a Slack channel.',
      parameters: { type: 'object', required: ['channel_id'], properties: { channel_id: { type: 'string', description: 'Channel ID (from connector_slack_list_channels)' }, limit: { type: 'number', description: 'Number of messages to return (default: 20)' } } },
      connectorId: ID, capability: 'chat',
      execute: (args: any) => withConn(async (c) => {
        const messages = await c.getChannelHistory(args.channel_id, args.limit || 20);
        if (!messages.length) return toolOk('No messages found.');
        return toolOk(messages.map((m: any) => `[${new Date(parseFloat(m.ts) * 1000).toLocaleString()}] ${m.username || m.user}: ${m.text}`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_slack_search',
      description: '[Slack] Search messages across the Slack workspace.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Search query (supports Slack search modifiers: from:, in:, before:, after:)' }, count: { type: 'number', description: 'Number of results (default: 20)' } } },
      connectorId: ID, capability: 'chat',
      execute: (args: any) => withConn(async (c) => {
        const results = await c.searchMessages(args.query, args.count || 20);
        if (!results.length) return toolOk('No messages found matching that query.');
        return toolOk(results.map((m: any) => `[#${m.channel?.name} | ${m.ts}] ${m.username}: ${m.text}\n  ${m.permalink}`).join('\n'));
      }),
    });
  },
};

export default ext;
