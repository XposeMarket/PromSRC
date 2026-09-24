// X API v2 client + tool executor for the native X connector. Moved out of
// gateway/tools/handlers/xai-handlers.ts (which now only handles xAI x_search).
import { getValidXApiToken } from '../../../../auth/x-api-oauth.js';
import { validateXApiRequest } from '../../../../gateway/tools/x-api-request-policy.js';
import {
  X_API_ADD_LIST_MEMBER_TOOL_NAME,
  X_API_BLOCK_USER_TOOL_NAME,
  X_API_CREATE_BOOKMARK_TOOL_NAME,
  X_API_CREATE_LIST_TOOL_NAME,
  X_API_CREATE_POST_TOOL_NAME,
  X_API_DELETE_BOOKMARK_TOOL_NAME,
  X_API_DELETE_LIST_TOOL_NAME,
  X_API_DELETE_POST_TOOL_NAME,
  X_API_FOLLOW_LIST_TOOL_NAME,
  X_API_FOLLOW_USER_TOOL_NAME,
  X_API_GET_BOOKMARKS_TOOL_NAME,
  X_API_GET_DM_EVENTS_TOOL_NAME,
  X_API_GET_FOLLOWERS_TOOL_NAME,
  X_API_GET_FOLLOWING_TOOL_NAME,
  X_API_GET_LIKED_POSTS_TOOL_NAME,
  X_API_GET_LIKING_USERS_TOOL_NAME,
  X_API_GET_LIST_POSTS_TOOL_NAME,
  X_API_GET_LIST_TOOL_NAME,
  X_API_GET_OWNED_LISTS_TOOL_NAME,
  X_API_GET_PERSONALIZED_TRENDS_TOOL_NAME,
  X_API_GET_POSTS_TOOL_NAME,
  X_API_GET_POST_TOOL_NAME,
  X_API_GET_REPOSTED_BY_TOOL_NAME,
  X_API_GET_REPOSTS_OF_ME_TOOL_NAME,
  X_API_GET_SPACE_TOOL_NAME,
  X_API_GET_TRENDS_TOOL_NAME,
  X_API_GET_USAGE_TOOL_NAME,
  X_API_GET_USER_BY_USERNAME_TOOL_NAME,
  X_API_GET_USER_MENTIONS_TOOL_NAME,
  X_API_GET_USER_POSTS_TOOL_NAME,
  X_API_GET_USER_TOOL_NAME,
  X_API_LIKE_POST_TOOL_NAME,
  X_API_ME_TOOL_NAME,
  X_API_MUTE_USER_TOOL_NAME,
  X_API_PIN_LIST_TOOL_NAME,
  X_API_REMOVE_LIST_MEMBER_TOOL_NAME,
  X_API_REPOST_TOOL_NAME,
  X_API_REQUEST_TOOL_NAME,
  X_API_SEARCH_ALL_TOOL_NAME,
  X_API_SEARCH_RECENT_TOOL_NAME,
  X_API_SEARCH_SPACES_TOOL_NAME,
  X_API_SEND_DM_TOOL_NAME,
  X_API_UNBLOCK_USER_TOOL_NAME,
  X_API_UNFOLLOW_LIST_TOOL_NAME,
  X_API_UNFOLLOW_USER_TOOL_NAME,
  X_API_UNLIKE_POST_TOOL_NAME,
  X_API_UNMUTE_USER_TOOL_NAME,
  X_API_UNPIN_LIST_TOOL_NAME,
  X_API_UNREPOST_TOOL_NAME,
  X_API_UPDATE_LIST_TOOL_NAME,
} from './x-api-tools.js';

const X_API_BASE_URL = 'https://api.x.com/2';

function getConfigDir(): string {
  const { getConfig } = require('../../../../config/config') as typeof import('../../../../config/config');
  return getConfig().getConfigDir();
}

function buildXApiPath(path: string, query?: Record<string, any>): string {
  const rawPath = String(path || '').trim();
  if (!rawPath.startsWith('/')) throw new Error('X API path must begin with /.');
  if (/^\/\//.test(rawPath) || /^https?:/i.test(rawPath)) throw new Error('X API path must not include a host.');

  const parsed = new URL(rawPath, 'https://api.x.com');
  let pathname = parsed.pathname.replace(/\/+/g, '/');
  if (pathname === '/2') pathname = '/';
  else if (pathname.startsWith('/2/')) pathname = pathname.slice(2);
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;

  const searchParams = new URLSearchParams(parsed.search);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) searchParams.set(key, value.map((v) => String(v)).join(','));
    } else {
      searchParams.set(key, String(value));
    }
  }

  const search = searchParams.toString();
  return `${pathname}${search ? `?${search}` : ''}`;
}

function numericId(value: any, field: string): string {
  const id = String(value || '').trim();
  if (!/^[0-9]{1,24}$/.test(id)) throw new Error(`${field} must be a numeric X ID.`);
  return id;
}

function optionalNumericId(value: any, field: string): string | undefined {
  const id = String(value || '').trim();
  if (!id) return undefined;
  return numericId(id, field);
}

function cleanUsername(value: any): string {
  const username = String(value || '').trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new Error('username must be a valid X handle.');
  return username;
}

function pickQuery(args: any, allowed: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of allowed) {
    if (args?.[key] !== undefined && args?.[key] !== null && args?.[key] !== '') out[key] = args[key];
  }
  return out;
}

function clampMaxResults(value: any, fallback?: number): number | undefined {
  const n = Number(value || fallback || 0);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

async function fetchXApi(path: string, init: RequestInit & { query?: Record<string, any> } = {}): Promise<any> {
  const token = await getValidXApiToken(getConfigDir());
  const requestPath = buildXApiPath(path, init.query);
  const res = await fetch(`${X_API_BASE_URL}${requestPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`X API ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return {};
  const text = await res.text().catch(() => '');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function getAuthenticatedXUser(): Promise<{ id: string; username?: string; name?: string; raw: any }> {
  const data = await fetchXApi('/users/me?user.fields=username,name');
  const user = data?.data || {};
  const id = String(user?.id || '').trim();
  if (!id) throw new Error('X API did not return the authenticated user ID.');
  return {
    id,
    username: user?.username ? String(user.username) : undefined,
    name: user?.name ? String(user.name) : undefined,
    raw: data,
  };
}

async function resolveUserId(args: any): Promise<string> {
  const provided = optionalNumericId(args?.user_id, 'user_id');
  if (provided) return provided;
  const user = await getAuthenticatedXUser();
  return user.id;
}

function postQuery(args: any): Record<string, any> {
  return pickQuery(args, ['expansions', 'tweet.fields', 'user.fields', 'media.fields', 'poll.fields', 'place.fields']);
}

function timelineQuery(args: any): Record<string, any> {
  return {
    ...postQuery(args),
    ...pickQuery(args, ['pagination_token', 'since_id', 'until_id', 'start_time', 'end_time', 'exclude']),
    ...(clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {}),
  };
}

function usersQuery(args: any): Record<string, any> {
  return {
    ...pickQuery(args, ['pagination_token', 'user.fields', 'expansions', 'tweet.fields']),
    ...(clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {}),
  };
}

function listBody(args: any): Record<string, any> {
  const body: Record<string, any> = {};
  if (args?.name !== undefined) body.name = String(args.name).trim();
  if (args?.description !== undefined) body.description = String(args.description).trim();
  if (args?.private !== undefined) body.private = Boolean(args.private);
  return body;
}

async function xApiPostUserAction(path: string, body: Record<string, any>): Promise<any> {
  return fetchXApi(path, { method: 'POST', body: JSON.stringify(body) });
}

async function xApiDelete(path: string, body?: Record<string, any>): Promise<any> {
  return fetchXApi(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined });
}

export async function executeXApiTool(name: string, args: any): Promise<{ success: boolean; tool: string; data?: any; error?: string }> {
  try {
    if (name === X_API_ME_TOOL_NAME) {
      const user = await getAuthenticatedXUser();
      return { success: true, tool: name, data: user.raw };
    }

    if (name === X_API_REQUEST_TOOL_NAME) {
      const request = validateXApiRequest({
        method: args?.method,
        path: buildXApiPath(String(args?.path || ''), args?.query || {}),
        body: args?.body,
        operationIntent: args?.operation_intent,
      });
      const data = await fetchXApi(request.path, {
        method: request.method,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_POST_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const data = await fetchXApi(`/tweets/${encodeURIComponent(postId)}`, { query: postQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_POSTS_TOOL_NAME) {
      const ids = Array.isArray(args?.post_ids || args?.tweet_ids) ? (args.post_ids || args.tweet_ids) : [];
      const cleanIds = ids.map((id: any) => numericId(id, 'post_ids')).slice(0, 100);
      if (!cleanIds.length) return { success: false, tool: name, error: 'post_ids is required.' };
      const data = await fetchXApi('/tweets', { query: { ids: cleanIds.join(','), ...postQuery(args) } });
      return { success: true, tool: name, data };
    }

    if (name === X_API_SEARCH_RECENT_TOOL_NAME || name === X_API_SEARCH_ALL_TOOL_NAME) {
      const query = String(args?.query || '').trim();
      if (!query) return { success: false, tool: name, error: 'query is required.' };
      const path = name === X_API_SEARCH_RECENT_TOOL_NAME ? '/tweets/search/recent' : '/tweets/search/all';
      const data = await fetchXApi(path, {
        query: {
          query,
          ...timelineQuery(args),
          next_token: args?.next_token || args?.pagination_token,
        },
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_DELETE_POST_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const data = await xApiDelete(`/tweets/${encodeURIComponent(postId)}`);
      return { success: true, tool: name, data };
    }

    if (name === X_API_CREATE_BOOKMARK_TOOL_NAME || name === X_API_DELETE_BOOKMARK_TOOL_NAME) {
      const postId = String(args?.post_id || args?.tweet_id || '').trim();
      if (!/^[0-9]{1,19}$/.test(postId)) {
        return { success: false, tool: name, error: 'post_id must be a numeric X post ID.' };
      }
      const user = await getAuthenticatedXUser();
      const path = name === X_API_CREATE_BOOKMARK_TOOL_NAME
        ? `/users/${encodeURIComponent(user.id)}/bookmarks`
        : `/users/${encodeURIComponent(user.id)}/bookmarks/${encodeURIComponent(postId)}`;
      const data = await fetchXApi(path, {
        method: name === X_API_CREATE_BOOKMARK_TOOL_NAME ? 'POST' : 'DELETE',
        body: name === X_API_CREATE_BOOKMARK_TOOL_NAME
          ? JSON.stringify({ tweet_id: postId })
          : undefined,
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_BOOKMARKS_TOOL_NAME) {
      const user = await getAuthenticatedXUser();
      const data = await fetchXApi(`/users/${encodeURIComponent(user.id)}/bookmarks`, { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_CREATE_POST_TOOL_NAME) {
      const text = String(args?.text || '').trim();
      if (!text) return { success: false, tool: name, error: 'text is required.' };
      const replyTo = String(args?.reply_to_post_id || '').trim();
      const body: Record<string, any> = { text };
      if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
      const data = await fetchXApi('/tweets', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_LIKE_POST_TOOL_NAME || name === X_API_UNLIKE_POST_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const user = await getAuthenticatedXUser();
      const path = name === X_API_LIKE_POST_TOOL_NAME
        ? `/users/${encodeURIComponent(user.id)}/likes`
        : `/users/${encodeURIComponent(user.id)}/likes/${encodeURIComponent(postId)}`;
      const data = name === X_API_LIKE_POST_TOOL_NAME
        ? await xApiPostUserAction(path, { tweet_id: postId })
        : await xApiDelete(path);
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_LIKED_POSTS_TOOL_NAME) {
      const userId = await resolveUserId(args);
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}/liked_tweets`, { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_LIKING_USERS_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const data = await fetchXApi(`/tweets/${encodeURIComponent(postId)}/liking_users`, { query: usersQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_REPOST_TOOL_NAME || name === X_API_UNREPOST_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const user = await getAuthenticatedXUser();
      const path = name === X_API_REPOST_TOOL_NAME
        ? `/users/${encodeURIComponent(user.id)}/retweets`
        : `/users/${encodeURIComponent(user.id)}/retweets/${encodeURIComponent(postId)}`;
      const data = name === X_API_REPOST_TOOL_NAME
        ? await xApiPostUserAction(path, { tweet_id: postId })
        : await xApiDelete(path);
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_REPOSTED_BY_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const data = await fetchXApi(`/tweets/${encodeURIComponent(postId)}/retweeted_by`, { query: usersQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_REPOSTS_OF_ME_TOOL_NAME) {
      const data = await fetchXApi('/users/reposts_of_me', { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_USER_TOOL_NAME) {
      const userId = numericId(args?.user_id, 'user_id');
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}`, { query: pickQuery(args, ['user.fields', 'expansions', 'tweet.fields']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_USER_BY_USERNAME_TOOL_NAME) {
      const username = cleanUsername(args?.username || args?.handle);
      const data = await fetchXApi(`/users/by/username/${encodeURIComponent(username)}`, { query: pickQuery(args, ['user.fields', 'expansions', 'tweet.fields']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_USER_POSTS_TOOL_NAME || name === X_API_GET_USER_MENTIONS_TOOL_NAME) {
      const userId = await resolveUserId(args);
      const suffix = name === X_API_GET_USER_POSTS_TOOL_NAME ? 'tweets' : 'mentions';
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}/${suffix}`, { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_FOLLOWERS_TOOL_NAME || name === X_API_GET_FOLLOWING_TOOL_NAME) {
      const userId = await resolveUserId(args);
      const suffix = name === X_API_GET_FOLLOWERS_TOOL_NAME ? 'followers' : 'following';
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}/${suffix}`, { query: usersQuery(args) });
      return { success: true, tool: name, data };
    }

    if (
      name === X_API_FOLLOW_USER_TOOL_NAME ||
      name === X_API_UNFOLLOW_USER_TOOL_NAME ||
      name === X_API_MUTE_USER_TOOL_NAME ||
      name === X_API_UNMUTE_USER_TOOL_NAME ||
      name === X_API_BLOCK_USER_TOOL_NAME ||
      name === X_API_UNBLOCK_USER_TOOL_NAME
    ) {
      const targetUserId = numericId(args?.target_user_id || args?.user_id, 'target_user_id');
      const user = await getAuthenticatedXUser();
      const action = name.includes('follow') ? 'following' : name.includes('mute') ? 'muting_users' : 'blocking';
      const isDelete = name === X_API_UNFOLLOW_USER_TOOL_NAME || name === X_API_UNMUTE_USER_TOOL_NAME || name === X_API_UNBLOCK_USER_TOOL_NAME;
      const path = isDelete
        ? `/users/${encodeURIComponent(user.id)}/${action}/${encodeURIComponent(targetUserId)}`
        : `/users/${encodeURIComponent(user.id)}/${action}`;
      const data = isDelete
        ? await xApiDelete(path)
        : await xApiPostUserAction(path, { target_user_id: targetUserId });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_LIST_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const data = await fetchXApi(`/lists/${encodeURIComponent(listId)}`, { query: pickQuery(args, ['list.fields', 'expansions', 'user.fields']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_OWNED_LISTS_TOOL_NAME) {
      const userId = await resolveUserId(args);
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}/owned_lists`, { query: pickQuery(args, ['list.fields', 'pagination_token', 'max_results']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_LIST_POSTS_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const data = await fetchXApi(`/lists/${encodeURIComponent(listId)}/tweets`, { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_CREATE_LIST_TOOL_NAME) {
      const body = listBody(args);
      if (!body.name) return { success: false, tool: name, error: 'name is required.' };
      const data = await xApiPostUserAction('/lists', body);
      return { success: true, tool: name, data };
    }

    if (name === X_API_UPDATE_LIST_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const data = await fetchXApi(`/lists/${encodeURIComponent(listId)}`, { method: 'PUT', body: JSON.stringify(listBody(args)) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_DELETE_LIST_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const data = await xApiDelete(`/lists/${encodeURIComponent(listId)}`);
      return { success: true, tool: name, data };
    }

    if (name === X_API_ADD_LIST_MEMBER_TOOL_NAME || name === X_API_REMOVE_LIST_MEMBER_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const userId = numericId(args?.user_id || args?.target_user_id, 'user_id');
      const path = `/lists/${encodeURIComponent(listId)}/members/${encodeURIComponent(userId)}`;
      const data = name === X_API_ADD_LIST_MEMBER_TOOL_NAME
        ? await fetchXApi(path, { method: 'POST' })
        : await xApiDelete(path);
      return { success: true, tool: name, data };
    }

    if (
      name === X_API_FOLLOW_LIST_TOOL_NAME ||
      name === X_API_UNFOLLOW_LIST_TOOL_NAME ||
      name === X_API_PIN_LIST_TOOL_NAME ||
      name === X_API_UNPIN_LIST_TOOL_NAME
    ) {
      const listId = numericId(args?.list_id, 'list_id');
      const user = await getAuthenticatedXUser();
      const relation = name === X_API_FOLLOW_LIST_TOOL_NAME || name === X_API_UNFOLLOW_LIST_TOOL_NAME ? 'followed_lists' : 'pinned_lists';
      const isDelete = name === X_API_UNFOLLOW_LIST_TOOL_NAME || name === X_API_UNPIN_LIST_TOOL_NAME;
      const path = `/users/${encodeURIComponent(user.id)}/${relation}${isDelete ? `/${encodeURIComponent(listId)}` : ''}`;
      const data = isDelete ? await xApiDelete(path) : await xApiPostUserAction(path, { list_id: listId });
      return { success: true, tool: name, data };
    }

    if (name === X_API_SEARCH_SPACES_TOOL_NAME) {
      const query = String(args?.query || '').trim();
      if (!query) return { success: false, tool: name, error: 'query is required.' };
      const data = await fetchXApi('/spaces/search', {
        query: {
          query,
          state: args?.state || 'all',
          ...pickQuery(args, ['space.fields', 'expansions']),
          ...(clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {}),
        },
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_SPACE_TOOL_NAME) {
      const spaceId = String(args?.space_id || '').trim();
      if (!spaceId) return { success: false, tool: name, error: 'space_id is required.' };
      const data = await fetchXApi(`/spaces/${encodeURIComponent(spaceId)}`, { query: pickQuery(args, ['space.fields', 'expansions', 'user.fields']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_TRENDS_TOOL_NAME) {
      const woeid = numericId(args?.woeid, 'woeid');
      const data = await fetchXApi(`/trends/by/woeid/${encodeURIComponent(woeid)}`);
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_PERSONALIZED_TRENDS_TOOL_NAME) {
      const data = await fetchXApi('/trends/personalized', {
        query: clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {},
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_DM_EVENTS_TOOL_NAME) {
      const data = await fetchXApi('/dm_events', {
        query: {
          ...pickQuery(args, ['pagination_token', 'event_types', 'dm_event.fields', 'dm_event_fields', 'expansions', 'user.fields', 'tweet.fields']),
          ...(clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {}),
        },
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_SEND_DM_TOOL_NAME) {
      const text = String(args?.text || '').trim();
      if (!text) return { success: false, tool: name, error: 'text is required.' };
      const conversationId = String(args?.dm_conversation_id || '').trim();
      const participantId = optionalNumericId(args?.participant_id, 'participant_id');
      const body = { text };
      const path = conversationId
        ? `/dm_conversations/${encodeURIComponent(conversationId)}/messages`
        : `/dm_conversations/with/${encodeURIComponent(participantId || '')}/messages`;
      if (!conversationId && !participantId) return { success: false, tool: name, error: 'participant_id or dm_conversation_id is required.' };
      const data = await xApiPostUserAction(path, body);
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_USAGE_TOOL_NAME) {
      const data = await fetchXApi('/usage/tweets');
      return { success: true, tool: name, data };
    }

    return { success: false, tool: name, error: `Unknown X API tool: ${name}` };
  } catch (err: any) {
    return { success: false, tool: name, error: String(err?.message || err) };
  }
}
