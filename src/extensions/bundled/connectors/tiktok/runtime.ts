// Native TikTok connector runtime: official Content Posting + Display APIs.
import path from 'path';
import fs from 'fs';
import type { TikTokConnector } from '../../../../integrations/connectors/tiktok.js';
import { getConfig } from '../../../../config/config.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, connectorStatusLabel, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';
import { registerConnectorApiRequestTool } from '../_runtime/api-request.js';

const ID = 'tiktok';
const NAME = 'TikTok';
const READ = { readOnly: true, localWrite: false, externalWrite: false, destructive: false, credentialUse: true, known: true } as const;
const WRITE = { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true } as const;
const tools = ['connector_tiktok_publish_video', 'connector_tiktok_get_user', 'connector_tiktok_list_videos', 'connector_tiktok_get_creator_info', 'connector_tiktok_get_publish_status', 'connector_tiktok_api_request'];

async function withConn(fn: (c: TikTokConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<TikTokConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  try { return await fn(c); } catch (err: any) { return toolError(err?.message || String(err)); }
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['social', 'analytics'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => connectorStatusLabel(ID),
    });

    registerConnectorApiRequestTool<TikTokConnector>(api, {
      connectorId: ID, displayName: NAME,
      bases: { open: 'https://open.tiktokapis.com' },
      examplePath: '/v2/user/info/?fields=open_id,display_name',
      coverageHint: 'photo posts (/v2/post/publish/content/init/), video query by id, research/insights endpoints your app is approved for',
    });

    api.registerTool({
      name: 'connector_tiktok_publish_video',
      description: '[TikTok] Upload a local video through the official Content Posting API. mode "draft" (default) sends it to your TikTok inbox to add sounds/effects and post from the app; mode "direct" posts immediately (unaudited apps can only post SELF_ONLY/private until TikTok audits the app). Returns a publish_id; check with get_publish_status.',
      parameters: {
        type: 'object', required: ['path'],
        properties: {
          path: { type: 'string', description: 'Local mp4/mov/webm (workspace-relative or absolute)' },
          mode: { type: 'string', enum: ['draft', 'direct'], description: 'Default draft' },
          title: { type: 'string', description: 'Direct post caption with #hashtags/@mentions (max 2200)' },
          privacy_level: { type: 'string', enum: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'], description: 'Direct only. Must be allowed by creator_info.' },
          disable_comment: { type: 'boolean' }, disable_duet: { type: 'boolean' }, disable_stitch: { type: 'boolean' },
          video_cover_timestamp_ms: { type: 'number' },
          is_aigc: { type: 'boolean', description: 'Label as AI-generated content' },
          brand_content_toggle: { type: 'boolean', description: 'Paid partnership' },
          brand_organic_toggle: { type: 'boolean', description: 'Promoting your own business' },
        },
      },
      connectorId: ID, capability: 'social', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => {
        const abs = path.isAbsolute(args.path) ? args.path : path.resolve(getConfig().getWorkspacePath(), args.path);
        if (!fs.existsSync(abs)) return toolError(`Video not found: ${args.path}`);
        const mode = args.mode === 'direct' ? 'direct' : 'draft';
        const r = await c.uploadVideo(abs, { ...args, mode });
        return toolOk(mode === 'draft'
          ? `Uploaded to your TikTok inbox. Open TikTok notifications to finish and post. publish_id=${r.publish_id}`
          : `Submitted direct post (privacy ${r.privacy_level}). publish_id=${r.publish_id}. TikTok processes it for a minute or so; check connector_tiktok_get_publish_status.`);
      }),
    });

    api.registerTool({
      name: 'connector_tiktok_get_user',
      description: '[TikTok] Connected account profile and stats (followers, following, likes, video count).',
      parameters: { type: 'object', properties: {} },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: () => withConn(async (c) => toolOk((await c.getUser())?.data?.user || {})),
    });

    api.registerTool({
      name: 'connector_tiktok_list_videos',
      description: '[TikTok] List your public videos with views, likes, comments, shares and share URL.',
      parameters: { type: 'object', properties: { max_count: { type: 'number', description: 'Max 20' }, cursor: { type: 'number' } } },
      connectorId: ID, capability: 'analytics', sideEffects: READ,
      execute: (args: any) => withConn(async (c) => toolOk((await c.listVideos(args?.max_count || 20, args?.cursor))?.data || {})),
    });

    api.registerTool({
      name: 'connector_tiktok_get_creator_info',
      description: '[TikTok] Allowed privacy levels, max video duration and interaction settings for direct posting.',
      parameters: { type: 'object', properties: {} },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: () => withConn(async (c) => toolOk((await c.creatorInfo())?.data || {})),
    });

    api.registerTool({
      name: 'connector_tiktok_get_publish_status',
      description: '[TikTok] Status of an upload/post by publish_id (PROCESSING_UPLOAD, SEND_TO_USER_INBOX, PUBLISH_COMPLETE, FAILED).',
      parameters: { type: 'object', required: ['publish_id'], properties: { publish_id: { type: 'string' } } },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: (args: any) => withConn(async (c) => toolOk((await c.publishStatus(args.publish_id))?.data || {})),
    });
  },
};

export default ext;
