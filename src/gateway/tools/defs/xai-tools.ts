// src/gateway/tools/defs/xai-tools.ts
// Tool definitions for xAI-backed search tools:
//   * x_search        - xAI Responses API "x_search" tool (X/Twitter only)
//   * xai_live_search - xAI Chat Completions Live Search (X + web + news + rss)
//
// Both are registered only when xAI credentials are present (OAuth in vault or
// XAI_API_KEY env / providers.xai.api_key). Registration is refreshed by
// xai-extension-adapter on credential changes.

export const X_SEARCH_TOOL_NAME = 'x_search';
export const XAI_LIVE_SEARCH_TOOL_NAME = 'xai_live_search';

export function getXSearchToolDef(): any {
  return {
    type: 'function',
    function: {
      name: X_SEARCH_TOOL_NAME,
      description:
        "Search X (Twitter) posts, profiles, and threads via xAI's built-in x_search tool. " +
        'Returns an answer string plus inline citations to specific X posts. Use this for current ' +
        'discussion, reactions, breaking news, or sentiment on X rather than general web pages. ' +
        'Available only when xAI credentials are configured. ' +
        'Pass enable_image_understanding/enable_video_understanding to have xAI analyze attached ' +
        'media server-side; no scraping or media download is needed.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description: 'What to look up on X. Natural language; can include topics, people, events.',
          },
          allowed_x_handles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of X handles to include exclusively (max 10). Mutually exclusive with excluded_x_handles.',
          },
          excluded_x_handles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of X handles to exclude (max 10). Mutually exclusive with allowed_x_handles.',
          },
          from_date: {
            type: 'string',
            description: 'Optional start date in YYYY-MM-DD format.',
          },
          to_date: {
            type: 'string',
            description: 'Optional end date in YYYY-MM-DD format.',
          },
          enable_image_understanding: {
            type: 'boolean',
            description: 'When true, xAI analyzes images attached to matching X posts and includes its understanding in the answer.',
            default: false,
          },
          enable_video_understanding: {
            type: 'boolean',
            description: 'When true, xAI analyzes videos attached to matching X posts and includes its understanding in the answer.',
            default: false,
          },
        },
      },
    },
  };
}

export function getXAILiveSearchToolDef(): any {
  return {
    type: 'function',
    function: {
      name: XAI_LIVE_SEARCH_TOOL_NAME,
      description:
        'xAI Live Search across multiple sources (X, web, news, rss) in one query. Use this when ' +
        'you want cross-source research that includes X discussion alongside web pages and news. ' +
        'Returns an answer plus a citations array. Available only when xAI credentials are configured. ' +
        'For pure X queries, prefer x_search; it has a tighter, X-specific schema.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query.',
          },
          sources: {
            type: 'array',
            description:
              'Sources to search. Each item is an object with a type (x, web, news, rss) and optional filters. ' +
              'Defaults to [{type:"web"},{type:"x"}] if omitted.',
            items: {
              type: 'object',
              required: ['type'],
              properties: {
                type: { type: 'string', enum: ['x', 'web', 'news', 'rss'] },
                x_handles: { type: 'array', items: { type: 'string' }, description: '(x) include only these handles, max 10; sent to xAI as included_x_handles' },
                excluded_x_handles: { type: 'array', items: { type: 'string' }, description: '(x) exclude these handles, max 10' },
                post_favorite_count: { type: 'number', description: '(x) minimum favorite count' },
                post_view_count: { type: 'number', description: '(x) minimum view count' },
                country: { type: 'string', description: '(web/news) ISO country code, e.g. "US"' },
                allowed_websites: { type: 'array', items: { type: 'string' }, description: '(web) restrict to these domains' },
                excluded_websites: { type: 'array', items: { type: 'string' }, description: '(web/news) exclude these domains' },
                safe_search: { type: 'boolean', description: '(web/news) enable safe search' },
                links: { type: 'array', items: { type: 'string' }, description: '(rss) RSS feed URLs' },
              },
            },
          },
          mode: {
            type: 'string',
            enum: ['on', 'auto', 'off'],
            description: 'on = always search; auto = let model decide; off = no search. Defaults to on.',
            default: 'on',
          },
          from_date: { type: 'string', description: 'Optional start date YYYY-MM-DD' },
          to_date: { type: 'string', description: 'Optional end date YYYY-MM-DD' },
          max_search_results: { type: 'number', description: 'Max number of source results to use (default 15)', default: 15 },
          return_citations: { type: 'boolean', description: 'Return source citations (default true)', default: true },
        },
      },
    },
  };
}

export function getXAIToolDefs(): any[] {
  return [getXSearchToolDef()];
}

export const XAI_TOOL_NAMES = [X_SEARCH_TOOL_NAME];
