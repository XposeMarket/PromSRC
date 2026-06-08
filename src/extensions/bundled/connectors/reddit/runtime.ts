// Native Reddit connector runtime. See §23B. Auth stays in RedditConnector.
import type { RedditConnector } from '../../../../integrations/connectors/reddit.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

const ID = 'reddit';
const NAME = 'Reddit';
const tools = ['connector_reddit_get_posts', 'connector_reddit_search', 'connector_reddit_submit_post', 'connector_reddit_get_comments'];

async function withConn(fn: (c: RedditConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<RedditConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  return fn(c);
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['social'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => (connectorConnected(ID) ? 'connected' : 'not connected'),
    });

    api.registerTool({
      name: 'connector_reddit_get_posts',
      description: '[Reddit] Get posts from a subreddit.',
      parameters: { type: 'object', required: ['subreddit'], properties: { subreddit: { type: 'string', description: 'Subreddit name (without r/, e.g., "programming")' }, sort: { type: 'string', enum: ['hot', 'new', 'top', 'rising'], description: 'Sort order (default: hot)' }, limit: { type: 'number', description: 'Number of posts (default: 25)' } } },
      connectorId: ID, capability: 'social',
      execute: (args: any) => withConn(async (c) => {
        const posts = await c.getSubredditPosts(args.subreddit, args.sort || 'hot', args.limit || 25);
        if (!posts.length) return toolOk('No posts found.');
        return toolOk(posts.map((p: any) => `[${p.score}↑] ${p.title}\n  ${p.url} | ${p.num_comments} comments | by u/${p.author}`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_reddit_search',
      description: '[Reddit] Search Reddit posts across all subreddits or within a specific one.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Search query' }, subreddit: { type: 'string', description: 'Limit search to this subreddit (optional)' }, sort: { type: 'string', enum: ['relevance', 'new', 'top'], description: 'Sort order (default: relevance)' }, limit: { type: 'number', description: 'Number of results (default: 25)' } } },
      connectorId: ID, capability: 'social',
      execute: (args: any) => withConn(async (c) => {
        const posts = await c.searchPosts(args.query, args.subreddit, args.sort || 'relevance', args.limit || 25);
        if (!posts.length) return toolOk('No posts found.');
        return toolOk(posts.map((p: any) => `[${p.score}↑] r/${p.subreddit}: ${p.title}\n  ${p.url}`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_reddit_submit_post',
      description: '[Reddit] Submit a text post to a subreddit.',
      parameters: { type: 'object', required: ['subreddit', 'title', 'text'], properties: { subreddit: { type: 'string', description: 'Subreddit to post to (without r/)' }, title: { type: 'string', description: 'Post title' }, text: { type: 'string', description: 'Post body text' } } },
      connectorId: ID, capability: 'social',
      execute: (args: any) => withConn(async (c) => {
        const result = await c.submitPost(args.subreddit, args.title, args.text);
        return toolOk(`Post submitted to r/${args.subreddit}. URL: ${(result as any)?.json?.data?.url || 'submitted'}`);
      }),
    });

    api.registerTool({
      name: 'connector_reddit_get_comments',
      description: '[Reddit] Get comments for a specific Reddit post.',
      parameters: { type: 'object', required: ['subreddit', 'post_id'], properties: { subreddit: { type: 'string', description: 'Subreddit name (without r/)' }, post_id: { type: 'string', description: 'Post ID (the alphanumeric ID from the post URL)' }, limit: { type: 'number', description: 'Number of comments (default: 20)' } } },
      connectorId: ID, capability: 'social',
      execute: (args: any) => withConn(async (c) => {
        const comments = await c.getPostComments(args.subreddit, args.post_id, args.limit || 20);
        if (!comments.length) return toolOk('No comments found.');
        return toolOk(comments.map((cm: any) => `u/${cm.author} [${cm.score}↑]: ${cm.body}`).join('\n---\n'));
      }),
    });
  },
};

export default ext;
