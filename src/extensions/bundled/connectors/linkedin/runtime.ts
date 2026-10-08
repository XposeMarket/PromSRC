// Native LinkedIn connector runtime: official Posts/Images/Videos APIs.
import path from 'path';
import fs from 'fs';
import type { LinkedInConnector } from '../../../../integrations/connectors/linkedin.js';
import { LINKEDIN_VERSION } from '../../../../integrations/connectors/linkedin.js';
import { getConfig } from '../../../../config/config.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, connectorStatusLabel, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';
import { registerConnectorApiRequestTool } from '../_runtime/api-request.js';

const ID = 'linkedin';
const NAME = 'LinkedIn';
const READ = { readOnly: true, localWrite: false, externalWrite: false, destructive: false, credentialUse: true, known: true } as const;
const WRITE = { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true } as const;
const tools = ['connector_linkedin_create_post', 'connector_linkedin_delete_post', 'connector_linkedin_get_profile', 'connector_linkedin_api_request'];

async function withConn(fn: (c: LinkedInConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<LinkedInConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  try { return await fn(c); } catch (err: any) { return toolError(err?.message || String(err)); }
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['social'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => connectorStatusLabel(ID),
    });

    registerConnectorApiRequestTool<LinkedInConnector>(api, {
      connectorId: ID, displayName: NAME,
      bases: { api: 'https://api.linkedin.com' },
      headers: { 'LinkedIn-Version': LINKEDIN_VERSION, 'X-Restli-Protocol-Version': '2.0.0' },
      examplePath: '/rest/posts?q=author&author=urn%3Ali%3Aperson%3AID',
      coverageHint: 'reactions, socialActions comments, documents, organization posts (needs Community Management approval)',
    });

    api.registerTool({
      name: 'connector_linkedin_create_post',
      description: '[LinkedIn] Publish a post as the connected member via the official Posts API. Optional media: one video, or 1-20 images (local files), or an article link.',
      parameters: {
        type: 'object', required: ['text'],
        properties: {
          text: { type: 'string', description: 'Post commentary (max 3000 chars)' },
          visibility: { type: 'string', enum: ['PUBLIC', 'CONNECTIONS'] },
          images: { type: 'array', items: { type: 'string' }, description: 'Local image paths' },
          video: { type: 'string', description: 'Local mp4 path' },
          article_url: { type: 'string' }, article_title: { type: 'string' }, article_description: { type: 'string' },
        },
      },
      connectorId: ID, capability: 'social', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => {
        if (String(args.text || '').length > 3000) return toolError('LinkedIn posts are limited to 3000 characters.');
        const root = getConfig().getWorkspacePath();
        const abs = (p: string) => { const f = path.isAbsolute(p) ? p : path.resolve(root, p); if (!fs.existsSync(f)) throw new Error(`File not found: ${p}`); return f; };
        let media: Array<{ urn: string }> | undefined;
        if (args.video) media = [{ urn: await c.uploadMedia(abs(args.video), 'video') }];
        else if (Array.isArray(args.images) && args.images.length) {
          media = [];
          for (const img of args.images.slice(0, 20)) media.push({ urn: await c.uploadMedia(abs(img), 'image') });
        }
        const urn = await c.createPost({ text: args.text, visibility: args.visibility, media, article: args.article_url ? { url: args.article_url, title: args.article_title, description: args.article_description } : undefined });
        return toolOk(`Posted to LinkedIn: ${urn}\nhttps://www.linkedin.com/feed/update/${urn}/`);
      }),
    });

    api.registerTool({
      name: 'connector_linkedin_delete_post',
      description: '[LinkedIn] Delete one of your posts by urn.',
      parameters: { type: 'object', required: ['urn'], properties: { urn: { type: 'string' } } },
      connectorId: ID, capability: 'social', sideEffects: { ...WRITE, destructive: true },
      execute: (args: any) => withConn(async (c) => { await c.deletePost(args.urn); return toolOk(`Deleted ${args.urn}`); }),
    });

    api.registerTool({
      name: 'connector_linkedin_get_profile',
      description: '[LinkedIn] Connected member identity (name, email, member id).',
      parameters: { type: 'object', properties: {} },
      connectorId: ID, capability: 'social', sideEffects: READ,
      execute: () => withConn(async (c) => toolOk(await c.getUserInfo())),
    });
  },
};

export default ext;
