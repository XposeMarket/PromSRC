// Native Instagram connector runtime: official Instagram API with Instagram
// Login (graph.instagram.com). Auth/refresh lives in InstagramConnector.
import type { InstagramConnector } from '../../../../integrations/connectors/instagram.js';
import { publishInstagram } from '../../../../integrations/connectors/instagram-publish.js';
import { getConfig } from '../../../../config/config.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, connectorStatusLabel, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';
import { registerConnectorApiRequestTool } from '../_runtime/api-request.js';

const ID = 'instagram';
const NAME = 'Instagram';
const READ = { readOnly: true, localWrite: false, externalWrite: false, destructive: false, credentialUse: true, known: true } as const;
const WRITE = { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true } as const;
const DESTRUCTIVE = { ...WRITE, destructive: true } as const;

const tools = [
  'connector_instagram_publish', 'connector_instagram_get_profile', 'connector_instagram_list_media',
  'connector_instagram_get_insights', 'connector_instagram_get_publishing_limit', 'connector_instagram_list_comments',
  'connector_instagram_reply_comment', 'connector_instagram_moderate_comment', 'connector_instagram_list_conversations',
  'connector_instagram_send_message', 'connector_instagram_api_request',
];

async function withConn(fn: (c: InstagramConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<InstagramConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  try { return await fn(c); } catch (err: any) { return toolError(err?.message || String(err)); }
}

const mediaItem = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Local file (workspace-relative or absolute). Served briefly over the gateway public URL so Meta can fetch it.' },
    url: { type: 'string', description: 'Already-public https URL (alternative to path)' },
    alt_text: { type: 'string', description: 'Accessibility text (images only)' },
  },
};

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['social', 'analytics'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => connectorStatusLabel(ID),
    });

    registerConnectorApiRequestTool<InstagramConnector>(api, {
      connectorId: ID, displayName: NAME,
      bases: { graph: 'https://graph.instagram.com' },
      examplePath: '/v26.0/me?fields=user_id,username',
      coverageHint: 'media/children, insights, comments, mentions, hashtag search, messaging, business discovery, webhooks subscriptions',
    });

    api.registerTool({
      name: 'connector_instagram_publish',
      description: '[Instagram] Publish to the connected professional account through the official Content Publishing API. Types: image (JPEG; png/webp auto-converted), reel (mp4/mov), story (image or video), carousel (2-10 images/videos). Audio must already be in the video; licensed music, filters and stickers are not available via API. Limit: 100 API posts per 24h.',
      parameters: {
        type: 'object', required: ['type', 'media'],
        properties: {
          type: { type: 'string', enum: ['image', 'reel', 'story', 'carousel'] },
          media: { type: 'array', items: mediaItem, description: 'One item, or 2-10 for carousel' },
          caption: { type: 'string', description: 'Caption with hashtags/@mentions (max 2200 chars). Ignored for stories.' },
          share_to_feed: { type: 'boolean', description: 'Reels: also show in the main feed grid (default true)' },
          cover: { ...mediaItem, description: 'Reels: optional cover image' },
          thumb_offset_ms: { type: 'number', description: 'Reels: cover frame offset in ms when no cover image' },
          collaborators: { type: 'array', items: { type: 'string' }, description: 'Up to 3 usernames to invite as collaborators' },
          location_id: { type: 'string', description: 'Facebook Page location id' },
          user_tags: { type: 'array', items: { type: 'object', properties: { username: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } },
          audio_name: { type: 'string', description: 'Reels: rename the original audio track' },
        },
      },
      connectorId: ID, capability: 'social', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => {
        const result = await publishInstagram(c, { ...args, baseDir: getConfig().getWorkspacePath() });
        return toolOk(`Published ${result.type} to Instagram. media_id=${result.media_id}${result.permalink ? `\n${result.permalink}` : ''}`);
      }),
    });

    api.registerTool({
      name: 'connector_instagram_get_profile',
      description: '[Instagram] Get the connected account: username, account type, followers, following, media count, bio.',
      parameters: { type: 'object', properties: {} },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: () => withConn(async (c) => toolOk(await c.getProfile())),
    });

    api.registerTool({
      name: 'connector_instagram_list_media',
      description: '[Instagram] List recent posts/reels with caption, permalink, likes and comment counts.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Default 25, max 100' }, after: { type: 'string', description: 'Paging cursor from a previous call' } } },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: (args: any) => withConn(async (c) => toolOk(await c.listMedia(Math.min(Number(args?.limit) || 25, 100), args?.after))),
    });

    api.registerTool({
      name: 'connector_instagram_get_insights',
      description: '[Instagram] Insights for one media item (media_id) or for the account (omit media_id). Media metrics default: views,reach,likes,comments,shares,saved,total_interactions. Account metrics default: reach,views,follower_count,profile_views,accounts_engaged,total_interactions (period=day).',
      parameters: { type: 'object', properties: { media_id: { type: 'string' }, metrics: { type: 'string', description: 'Comma-separated metric names' }, period: { type: 'string', description: 'Account insights period (day, week, days_28, lifetime)' }, metric_type: { type: 'string', description: 'Account: time_series or total_value' }, since: { type: 'string' }, until: { type: 'string' } } },
      connectorId: ID, capability: 'analytics', sideEffects: READ,
      execute: (args: any) => withConn(async (c) => {
        if (args?.media_id) return toolOk(await c.graph('GET', `/${args.media_id}/insights`, { metric: args.metrics || 'views,reach,likes,comments,shares,saved,total_interactions' }));
        return toolOk(await c.graph('GET', `/${c.igUserId()}/insights`, {
          metric: args?.metrics || 'reach,views,follower_count,profile_views,accounts_engaged,total_interactions',
          period: args?.period || 'day', metric_type: args?.metric_type || 'total_value', since: args?.since, until: args?.until,
        }));
      }),
    });

    api.registerTool({
      name: 'connector_instagram_get_publishing_limit',
      description: '[Instagram] How many API posts were used in the rolling 24h window (limit 100).',
      parameters: { type: 'object', properties: {} },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: () => withConn(async (c) => toolOk(await c.publishingLimit())),
    });

    api.registerTool({
      name: 'connector_instagram_list_comments',
      description: '[Instagram] List comments (with replies) on a media item.',
      parameters: { type: 'object', required: ['media_id'], properties: { media_id: { type: 'string' }, limit: { type: 'number' } } },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: (args: any) => withConn(async (c) => toolOk(await c.graph('GET', `/${args.media_id}/comments`, { fields: 'id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp}', limit: args.limit || 50 }))),
    });

    api.registerTool({
      name: 'connector_instagram_reply_comment',
      description: '[Instagram] Reply to a comment on your media.',
      parameters: { type: 'object', required: ['comment_id', 'message'], properties: { comment_id: { type: 'string' }, message: { type: 'string' } } },
      connectorId: ID, capability: 'social', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => toolOk(await c.graph('POST', `/${args.comment_id}/replies`, { message: args.message }))),
    });

    api.registerTool({
      name: 'connector_instagram_moderate_comment',
      description: '[Instagram] Hide, unhide, or delete a comment on your media.',
      parameters: { type: 'object', required: ['comment_id', 'action'], properties: { comment_id: { type: 'string' }, action: { type: 'string', enum: ['hide', 'unhide', 'delete'] } } },
      connectorId: ID, capability: 'social', sideEffects: DESTRUCTIVE,
      execute: (args: any) => withConn(async (c) => {
        if (args.action === 'delete') return toolOk(await c.graph('DELETE', `/${args.comment_id}`));
        return toolOk(await c.graph('POST', `/${args.comment_id}`, { hide: args.action === 'hide' }));
      }),
    });

    api.registerTool({
      name: 'connector_instagram_list_conversations',
      description: '[Instagram] List DM conversations with recent messages (needs instagram_business_manage_messages).',
      parameters: { type: 'object', properties: { limit: { type: 'number' } } },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: (args: any) => withConn(async (c) => toolOk(await c.graph('GET', `/${c.igUserId()}/conversations`, { platform: 'instagram', fields: 'id,updated_time,participants,messages.limit(5){id,from,to,message,created_time}', limit: args?.limit || 20 }))),
    });

    api.registerTool({
      name: 'connector_instagram_send_message',
      description: '[Instagram] Send a DM to an Instagram-scoped user id (IGSID) who messaged you within the last 24h (Meta messaging window).',
      parameters: { type: 'object', required: ['recipient_id', 'text'], properties: { recipient_id: { type: 'string', description: 'IGSID from list_conversations participants' }, text: { type: 'string' } } },
      connectorId: ID, capability: 'social', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => toolOk(await c.graph('POST', `/${c.igUserId()}/messages`, { recipient: { id: args.recipient_id }, message: { text: args.text } }))),
    });
  },
};

export default ext;
