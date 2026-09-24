// X API v2 tool definitions (OAuth 2.0 user context). Owned by the native X connector (connectors/x/runtime.ts).

export const X_API_ME_TOOL_NAME = 'x_api_me';
export const X_API_REQUEST_TOOL_NAME = 'x_api_request';
export const X_API_GET_POST_TOOL_NAME = 'x_api_get_post';

export const X_API_GET_POSTS_TOOL_NAME = 'x_api_get_posts';
export const X_API_SEARCH_RECENT_TOOL_NAME = 'x_api_search_recent';
export const X_API_SEARCH_ALL_TOOL_NAME = 'x_api_search_all';
export const X_API_DELETE_POST_TOOL_NAME = 'x_api_delete_post';
export const X_API_CREATE_BOOKMARK_TOOL_NAME = 'x_api_create_bookmark';
export const X_API_DELETE_BOOKMARK_TOOL_NAME = 'x_api_delete_bookmark';
export const X_API_GET_BOOKMARKS_TOOL_NAME = 'x_api_get_bookmarks';
export const X_API_CREATE_POST_TOOL_NAME = 'x_api_create_post';
export const X_API_LIKE_POST_TOOL_NAME = 'x_api_like_post';
export const X_API_UNLIKE_POST_TOOL_NAME = 'x_api_unlike_post';
export const X_API_GET_LIKED_POSTS_TOOL_NAME = 'x_api_get_liked_posts';
export const X_API_GET_LIKING_USERS_TOOL_NAME = 'x_api_get_liking_users';
export const X_API_REPOST_TOOL_NAME = 'x_api_repost';
export const X_API_UNREPOST_TOOL_NAME = 'x_api_unrepost';
export const X_API_GET_REPOSTED_BY_TOOL_NAME = 'x_api_get_reposted_by';
export const X_API_GET_REPOSTS_OF_ME_TOOL_NAME = 'x_api_get_reposts_of_me';
export const X_API_GET_USER_TOOL_NAME = 'x_api_get_user';
export const X_API_GET_USER_BY_USERNAME_TOOL_NAME = 'x_api_get_user_by_username';
export const X_API_GET_USER_POSTS_TOOL_NAME = 'x_api_get_user_posts';
export const X_API_GET_USER_MENTIONS_TOOL_NAME = 'x_api_get_user_mentions';
export const X_API_GET_FOLLOWERS_TOOL_NAME = 'x_api_get_followers';
export const X_API_GET_FOLLOWING_TOOL_NAME = 'x_api_get_following';
export const X_API_FOLLOW_USER_TOOL_NAME = 'x_api_follow_user';
export const X_API_UNFOLLOW_USER_TOOL_NAME = 'x_api_unfollow_user';
export const X_API_MUTE_USER_TOOL_NAME = 'x_api_mute_user';
export const X_API_UNMUTE_USER_TOOL_NAME = 'x_api_unmute_user';
export const X_API_BLOCK_USER_TOOL_NAME = 'x_api_block_user';
export const X_API_UNBLOCK_USER_TOOL_NAME = 'x_api_unblock_user';
export const X_API_GET_LIST_TOOL_NAME = 'x_api_get_list';
export const X_API_GET_OWNED_LISTS_TOOL_NAME = 'x_api_get_owned_lists';
export const X_API_GET_LIST_POSTS_TOOL_NAME = 'x_api_get_list_posts';
export const X_API_CREATE_LIST_TOOL_NAME = 'x_api_create_list';
export const X_API_UPDATE_LIST_TOOL_NAME = 'x_api_update_list';
export const X_API_DELETE_LIST_TOOL_NAME = 'x_api_delete_list';
export const X_API_ADD_LIST_MEMBER_TOOL_NAME = 'x_api_add_list_member';
export const X_API_REMOVE_LIST_MEMBER_TOOL_NAME = 'x_api_remove_list_member';
export const X_API_FOLLOW_LIST_TOOL_NAME = 'x_api_follow_list';
export const X_API_UNFOLLOW_LIST_TOOL_NAME = 'x_api_unfollow_list';
export const X_API_PIN_LIST_TOOL_NAME = 'x_api_pin_list';
export const X_API_UNPIN_LIST_TOOL_NAME = 'x_api_unpin_list';
export const X_API_SEARCH_SPACES_TOOL_NAME = 'x_api_search_spaces';
export const X_API_GET_SPACE_TOOL_NAME = 'x_api_get_space';
export const X_API_GET_TRENDS_TOOL_NAME = 'x_api_get_trends';
export const X_API_GET_PERSONALIZED_TRENDS_TOOL_NAME = 'x_api_get_personalized_trends';
export const X_API_SEND_DM_TOOL_NAME = 'x_api_send_dm';
export const X_API_GET_DM_EVENTS_TOOL_NAME = 'x_api_get_dm_events';
export const X_API_GET_USAGE_TOOL_NAME = 'x_api_get_usage';

export function getXApiMeToolDef(): any {
  return {
    type: 'function',
    function: {
      name: X_API_ME_TOOL_NAME,
      description: 'Get the authenticated X user for the X API OAuth 2.0 user-context token. Use before user-scoped X API calls.',
      parameters: { type: 'object', required: [], properties: {} },
    },
  };
}

function commonPaginationProperties(): Record<string, any> {
  return {
    max_results: { type: 'number', description: 'Optional result count. Endpoint limits vary; Prometheus clamps obvious unsafe values.' },
    pagination_token: { type: 'string', description: 'Optional pagination token from a previous response.' },
  };
}

function commonPostExpansionProperties(): Record<string, any> {
  return {
    expansions: { type: 'string', description: 'Optional comma-separated X API expansions.' },
    'tweet.fields': { type: 'string', description: 'Optional comma-separated post fields.' },
    'user.fields': { type: 'string', description: 'Optional comma-separated user fields.' },
    'media.fields': { type: 'string', description: 'Optional comma-separated media fields.' },
  };
}

function toolDef(name: string, description: string, properties: Record<string, any> = {}, required: string[] = []): any {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', required, properties },
    },
  };
}

export function getXApiRequestToolDef(): any {
  return toolDef(
    X_API_REQUEST_TOOL_NAME,
    'Make an authenticated X API v2 request with the X API OAuth 2.0 user-context token. Use for newly-added or less common X API endpoints not covered by a dedicated tool. Mutation requests require operation_intent and the normal approval policy.',
    {
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method.' },
      path: { type: 'string', description: 'X API path beginning with /, for example /tweets/search/recent. Do not include scheme or host.' },
      query: { type: 'object', description: 'Optional query string parameters.' },
      body: { type: 'object', description: 'Optional JSON body for POST/PUT/PATCH/DELETE requests.' },
      operation_intent: { type: 'string', description: 'Required for mutations. Briefly state the user-authorized operation.' },
    },
    ['method', 'path'],
  );
}

export function getXApiReadToolDefs(): any[] {
  return [
    toolDef(X_API_GET_POST_TOOL_NAME, 'Fetch one X post by ID using the X API.', { post_id: { type: 'string' }, ...commonPostExpansionProperties() }, ['post_id']),
    toolDef(X_API_GET_POSTS_TOOL_NAME, 'Fetch multiple X posts by ID using the X API.', { post_ids: { type: 'array', items: { type: 'string' } }, ...commonPostExpansionProperties() }, ['post_ids']),
    toolDef(X_API_SEARCH_RECENT_TOOL_NAME, 'Search recent X posts with the official X API recent search endpoint.', { query: { type: 'string' }, ...commonPaginationProperties(), ...commonPostExpansionProperties() }, ['query']),
    toolDef(X_API_SEARCH_ALL_TOOL_NAME, 'Search the full X archive when the authenticated account has access.', { query: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, ...commonPaginationProperties(), ...commonPostExpansionProperties() }, ['query']),
    toolDef(X_API_GET_BOOKMARKS_TOOL_NAME, 'List the authenticated user bookmarks.', { ...commonPaginationProperties(), ...commonPostExpansionProperties() }),
    toolDef(X_API_GET_LIKED_POSTS_TOOL_NAME, 'List posts liked by a user, defaulting to the authenticated user.', { user_id: { type: 'string' }, ...commonPaginationProperties(), ...commonPostExpansionProperties() }),
    toolDef(X_API_GET_LIKING_USERS_TOOL_NAME, 'List users who liked a post.', { post_id: { type: 'string' }, ...commonPaginationProperties(), 'user.fields': { type: 'string' } }, ['post_id']),
    toolDef(X_API_GET_REPOSTED_BY_TOOL_NAME, 'List users who reposted a post.', { post_id: { type: 'string' }, ...commonPaginationProperties(), 'user.fields': { type: 'string' } }, ['post_id']),
    toolDef(X_API_GET_REPOSTS_OF_ME_TOOL_NAME, 'List posts that reposted the authenticated user.', { ...commonPaginationProperties(), ...commonPostExpansionProperties() }),
    toolDef(X_API_GET_USER_TOOL_NAME, 'Fetch an X user by user ID.', { user_id: { type: 'string' }, 'user.fields': { type: 'string' }, expansions: { type: 'string' } }, ['user_id']),
    toolDef(X_API_GET_USER_BY_USERNAME_TOOL_NAME, 'Fetch an X user by username/handle.', { username: { type: 'string' }, 'user.fields': { type: 'string' }, expansions: { type: 'string' } }, ['username']),
    toolDef(X_API_GET_USER_POSTS_TOOL_NAME, 'List posts from a user, defaulting to the authenticated user.', { user_id: { type: 'string' }, ...commonPaginationProperties(), ...commonPostExpansionProperties() }),
    toolDef(X_API_GET_USER_MENTIONS_TOOL_NAME, 'List mentions for a user, defaulting to the authenticated user.', { user_id: { type: 'string' }, ...commonPaginationProperties(), ...commonPostExpansionProperties() }),
    toolDef(X_API_GET_FOLLOWERS_TOOL_NAME, 'List followers for a user, defaulting to the authenticated user.', { user_id: { type: 'string' }, ...commonPaginationProperties(), 'user.fields': { type: 'string' } }),
    toolDef(X_API_GET_FOLLOWING_TOOL_NAME, 'List accounts followed by a user, defaulting to the authenticated user.', { user_id: { type: 'string' }, ...commonPaginationProperties(), 'user.fields': { type: 'string' } }),
    toolDef(X_API_GET_LIST_TOOL_NAME, 'Fetch an X List by ID.', { list_id: { type: 'string' }, 'list.fields': { type: 'string' }, expansions: { type: 'string' } }, ['list_id']),
    toolDef(X_API_GET_OWNED_LISTS_TOOL_NAME, 'List X Lists owned by a user, defaulting to the authenticated user.', { user_id: { type: 'string' }, ...commonPaginationProperties(), 'list.fields': { type: 'string' } }),
    toolDef(X_API_GET_LIST_POSTS_TOOL_NAME, 'List posts from an X List.', { list_id: { type: 'string' }, ...commonPaginationProperties(), ...commonPostExpansionProperties() }, ['list_id']),
    toolDef(X_API_SEARCH_SPACES_TOOL_NAME, 'Search X Spaces.', { query: { type: 'string' }, state: { type: 'string', enum: ['live', 'scheduled', 'all'] }, ...commonPaginationProperties(), 'space.fields': { type: 'string' } }, ['query']),
    toolDef(X_API_GET_SPACE_TOOL_NAME, 'Fetch an X Space by ID.', { space_id: { type: 'string' }, 'space.fields': { type: 'string' }, expansions: { type: 'string' } }, ['space_id']),
    toolDef(X_API_GET_TRENDS_TOOL_NAME, 'Fetch X trends by WOEID.', { woeid: { type: 'string', description: 'Where On Earth ID, e.g. 1 for worldwide.' } }, ['woeid']),
    toolDef(X_API_GET_PERSONALIZED_TRENDS_TOOL_NAME, 'Fetch personalized trends for the authenticated user.', { max_results: { type: 'number' } }),
    toolDef(X_API_GET_DM_EVENTS_TOOL_NAME, 'Read Direct Message events if the token has DM scopes/access.', { ...commonPaginationProperties(), event_types: { type: 'string' }, dm_event_fields: { type: 'string' }, expansions: { type: 'string' } }),
    toolDef(X_API_GET_USAGE_TOOL_NAME, 'Fetch X API usage information for posts if available on the account.', {}),
  ];
}

export function getXApiWriteToolDefs(): any[] {
  return [
    toolDef(X_API_DELETE_POST_TOOL_NAME, 'Delete one of the authenticated user posts. Use only when the user explicitly asks to delete a post.', { post_id: { type: 'string' } }, ['post_id']),
    toolDef(X_API_LIKE_POST_TOOL_NAME, 'Like an X post as the authenticated user. Use only when the user explicitly asks to like it.', { post_id: { type: 'string' } }, ['post_id']),
    toolDef(X_API_UNLIKE_POST_TOOL_NAME, 'Remove the authenticated user like from an X post. Use only when the user explicitly asks.', { post_id: { type: 'string' } }, ['post_id']),
    toolDef(X_API_REPOST_TOOL_NAME, 'Repost an X post as the authenticated user. Use only when the user explicitly asks to repost.', { post_id: { type: 'string' } }, ['post_id']),
    toolDef(X_API_UNREPOST_TOOL_NAME, 'Remove the authenticated user repost of an X post. Use only when the user explicitly asks.', { post_id: { type: 'string' } }, ['post_id']),
    toolDef(X_API_FOLLOW_USER_TOOL_NAME, 'Follow an X user as the authenticated user. Use only when the user explicitly asks.', { target_user_id: { type: 'string' } }, ['target_user_id']),
    toolDef(X_API_UNFOLLOW_USER_TOOL_NAME, 'Unfollow an X user as the authenticated user. Use only when the user explicitly asks.', { target_user_id: { type: 'string' } }, ['target_user_id']),
    toolDef(X_API_MUTE_USER_TOOL_NAME, 'Mute an X user as the authenticated user. Use only when the user explicitly asks.', { target_user_id: { type: 'string' } }, ['target_user_id']),
    toolDef(X_API_UNMUTE_USER_TOOL_NAME, 'Unmute an X user as the authenticated user. Use only when the user explicitly asks.', { target_user_id: { type: 'string' } }, ['target_user_id']),
    toolDef(X_API_BLOCK_USER_TOOL_NAME, 'Block an X user as the authenticated user. Use only when the user explicitly asks.', { target_user_id: { type: 'string' } }, ['target_user_id']),
    toolDef(X_API_UNBLOCK_USER_TOOL_NAME, 'Unblock an X user as the authenticated user. Use only when the user explicitly asks.', { target_user_id: { type: 'string' } }, ['target_user_id']),
    toolDef(X_API_CREATE_LIST_TOOL_NAME, 'Create an X List. Use only when the user explicitly asks.', { name: { type: 'string' }, description: { type: 'string' }, private: { type: 'boolean' } }, ['name']),
    toolDef(X_API_UPDATE_LIST_TOOL_NAME, 'Update an X List. Use only when the user explicitly asks.', { list_id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, private: { type: 'boolean' } }, ['list_id']),
    toolDef(X_API_DELETE_LIST_TOOL_NAME, 'Delete an X List. Use only when the user explicitly asks.', { list_id: { type: 'string' } }, ['list_id']),
    toolDef(X_API_ADD_LIST_MEMBER_TOOL_NAME, 'Add a user to an X List. Use only when the user explicitly asks.', { list_id: { type: 'string' }, user_id: { type: 'string' } }, ['list_id', 'user_id']),
    toolDef(X_API_REMOVE_LIST_MEMBER_TOOL_NAME, 'Remove a user from an X List. Use only when the user explicitly asks.', { list_id: { type: 'string' }, user_id: { type: 'string' } }, ['list_id', 'user_id']),
    toolDef(X_API_FOLLOW_LIST_TOOL_NAME, 'Follow an X List as the authenticated user. Use only when the user explicitly asks.', { list_id: { type: 'string' } }, ['list_id']),
    toolDef(X_API_UNFOLLOW_LIST_TOOL_NAME, 'Unfollow an X List as the authenticated user. Use only when the user explicitly asks.', { list_id: { type: 'string' } }, ['list_id']),
    toolDef(X_API_PIN_LIST_TOOL_NAME, 'Pin an X List as the authenticated user. Use only when the user explicitly asks.', { list_id: { type: 'string' } }, ['list_id']),
    toolDef(X_API_UNPIN_LIST_TOOL_NAME, 'Unpin an X List as the authenticated user. Use only when the user explicitly asks.', { list_id: { type: 'string' } }, ['list_id']),
    toolDef(X_API_SEND_DM_TOOL_NAME, 'Send a Direct Message if the token has DM scopes/access. Use only when the user explicitly asks to send a DM.', { participant_id: { type: 'string', description: 'Target user ID for a one-to-one DM.' }, dm_conversation_id: { type: 'string', description: 'Existing DM conversation ID.' }, text: { type: 'string' } }, ['text']),
  ];
}

export function getXApiCreateBookmarkToolDef(): any {
  return {
    type: 'function',
    function: {
      name: X_API_CREATE_BOOKMARK_TOOL_NAME,
      description: 'Add an X post to the authenticated user bookmarks via the X API using OAuth 2.0 user-context auth.',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The X post/tweet ID to bookmark.' },
        },
      },
    },
  };
}

export function getXApiDeleteBookmarkToolDef(): any {
  return {
    type: 'function',
    function: {
      name: X_API_DELETE_BOOKMARK_TOOL_NAME,
      description: 'Remove an X post from the authenticated user bookmarks via the X API using OAuth 2.0 user-context auth.',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The X post/tweet ID to remove from bookmarks.' },
        },
      },
    },
  };
}

export function getXApiCreatePostToolDef(): any {
  return {
    type: 'function',
    function: {
      name: X_API_CREATE_POST_TOOL_NAME,
      description: 'Create a post on X as the authenticated user via the X API using OAuth 2.0 user-context auth. Use only when the user explicitly asks to post.',
      parameters: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'Post body text.' },
          reply_to_post_id: { type: 'string', description: 'Optional post ID to reply to.' },
        },
      },
    },
  };
}

export function getXApiToolDefs(): any[] {
  return [
    getXApiMeToolDef(),
    getXApiRequestToolDef(),
    ...getXApiReadToolDefs(),
    getXApiCreateBookmarkToolDef(),
    getXApiDeleteBookmarkToolDef(),
    getXApiCreatePostToolDef(),
    ...getXApiWriteToolDefs(),
  ];
}

export const X_API_TOOL_NAMES: string[] = [
  X_API_ME_TOOL_NAME,
  X_API_REQUEST_TOOL_NAME,
  X_API_GET_POST_TOOL_NAME,
  X_API_GET_POSTS_TOOL_NAME,
  X_API_SEARCH_RECENT_TOOL_NAME,
  X_API_SEARCH_ALL_TOOL_NAME,
  X_API_DELETE_POST_TOOL_NAME,
  X_API_CREATE_BOOKMARK_TOOL_NAME,
  X_API_DELETE_BOOKMARK_TOOL_NAME,
  X_API_GET_BOOKMARKS_TOOL_NAME,
  X_API_CREATE_POST_TOOL_NAME,
  X_API_LIKE_POST_TOOL_NAME,
  X_API_UNLIKE_POST_TOOL_NAME,
  X_API_GET_LIKED_POSTS_TOOL_NAME,
  X_API_GET_LIKING_USERS_TOOL_NAME,
  X_API_REPOST_TOOL_NAME,
  X_API_UNREPOST_TOOL_NAME,
  X_API_GET_REPOSTED_BY_TOOL_NAME,
  X_API_GET_REPOSTS_OF_ME_TOOL_NAME,
  X_API_GET_USER_TOOL_NAME,
  X_API_GET_USER_BY_USERNAME_TOOL_NAME,
  X_API_GET_USER_POSTS_TOOL_NAME,
  X_API_GET_USER_MENTIONS_TOOL_NAME,
  X_API_GET_FOLLOWERS_TOOL_NAME,
  X_API_GET_FOLLOWING_TOOL_NAME,
  X_API_FOLLOW_USER_TOOL_NAME,
  X_API_UNFOLLOW_USER_TOOL_NAME,
  X_API_MUTE_USER_TOOL_NAME,
  X_API_UNMUTE_USER_TOOL_NAME,
  X_API_BLOCK_USER_TOOL_NAME,
  X_API_UNBLOCK_USER_TOOL_NAME,
  X_API_GET_LIST_TOOL_NAME,
  X_API_GET_OWNED_LISTS_TOOL_NAME,
  X_API_GET_LIST_POSTS_TOOL_NAME,
  X_API_CREATE_LIST_TOOL_NAME,
  X_API_UPDATE_LIST_TOOL_NAME,
  X_API_DELETE_LIST_TOOL_NAME,
  X_API_ADD_LIST_MEMBER_TOOL_NAME,
  X_API_REMOVE_LIST_MEMBER_TOOL_NAME,
  X_API_FOLLOW_LIST_TOOL_NAME,
  X_API_UNFOLLOW_LIST_TOOL_NAME,
  X_API_PIN_LIST_TOOL_NAME,
  X_API_UNPIN_LIST_TOOL_NAME,
  X_API_SEARCH_SPACES_TOOL_NAME,
  X_API_GET_SPACE_TOOL_NAME,
  X_API_GET_TRENDS_TOOL_NAME,
  X_API_GET_PERSONALIZED_TRENDS_TOOL_NAME,
  X_API_SEND_DM_TOOL_NAME,
  X_API_GET_DM_EVENTS_TOOL_NAME,
  X_API_GET_USAGE_TOOL_NAME,
];
