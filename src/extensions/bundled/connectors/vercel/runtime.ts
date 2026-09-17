import type {
  PrometheusExtensionApi,
  PrometheusExtensionDefinition,
  PrometheusToolContext,
  PrometheusToolExecutionResult,
} from '../../../runtime-api.js';
import { getVercelCredentials } from '../../../../integrations/connection-state.js';

const ID = 'vercel';
const NAME = 'Vercel';
const API_BASE = 'https://api.vercel.com';

const tools = [
  'connector_vercel_status',
  'connector_vercel_list_teams',
  'connector_vercel_list_projects',
  'connector_vercel_get_project',
  'connector_vercel_create_project',
  'connector_vercel_update_project',
  'connector_vercel_delete_project',
  'connector_vercel_list_deployments',
  'connector_vercel_get_deployment',
  'connector_vercel_create_deployment',
  'connector_vercel_redeploy',
  'connector_vercel_deployment_events',
  'connector_vercel_cancel_deployment',
  'connector_vercel_delete_deployment',
  'connector_vercel_list_aliases',
  'connector_vercel_assign_alias',
  'connector_vercel_env',
  'connector_vercel_domains',
  'connector_vercel_get_project_domain',
  'connector_vercel_manage_project_domain',
  'connector_vercel_api_request',
];

type VercelAuth = {
  token: string;
  projectId?: string;
  teamId?: string;
};

type VercelFetchOptions = {
  method?: string;
  body?: unknown;
  teamId?: string;
};

type JsonRecord = Record<string, any>;

const MAX_RESULT_CHARS = 20_000;
const MAX_RESULT_DEPTH = 8;
const MAX_RESULT_ENTRIES = 200;
const MAX_RESULT_ARRAY_ITEMS = 100;
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 200;
const MAX_API_PATH_CHARS = 2_048;
const MAX_API_QUERY_CHARS = 8_000;
const MAX_API_QUERY_KEY_CHARS = 128;
const MAX_API_QUERY_VALUE_CHARS = 1_024;
const MAX_API_BODY_CHARS = 200_000;
const SENSITIVE_KEY_RE = /token|secret|password|api[-_]?key|private[-_]?key|authorization|cookie|credential|certificate|cert|pem|jwt|access[-_]?token|refresh[-_]?token|client[-_]?secret|signing[-_]?key|passphrase/i;

function truncateResult(value: string): string {
  return value.length <= MAX_RESULT_CHARS
    ? value
    : `${value.slice(0, MAX_RESULT_CHARS)}\n...[truncated by Vercel connector]`;
}

function sanitizeForOutput(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return String(value);
  if (depth >= MAX_RESULT_DEPTH) return '[truncated]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_RESULT_ARRAY_ITEMS).map((item) => sanitizeForOutput(item, depth + 1, seen));
    if (value.length > MAX_RESULT_ARRAY_ITEMS) items.push(`[${value.length - MAX_RESULT_ARRAY_ITEMS} more items truncated]`);
    return items;
  }

  const record = value as JsonRecord;
  const entries = Object.entries(record);
  const output: JsonRecord = {};
  for (const [key, item] of entries.slice(0, MAX_RESULT_ENTRIES)) {
    const lowerKey = key.toLowerCase();
    const envValue = lowerKey === 'value' && (
      Object.prototype.hasOwnProperty.call(record, 'key')
      || Object.prototype.hasOwnProperty.call(record, 'target')
      || record.type === 'encrypted'
    );
    output[key] = SENSITIVE_KEY_RE.test(key) || envValue
      ? '[redacted]'
      : sanitizeForOutput(item, depth + 1, seen);
  }
  if (entries.length > MAX_RESULT_ENTRIES) output._truncated = `[${entries.length - MAX_RESULT_ENTRIES} more fields truncated]`;
  return output;
}

function stringifyResult(data: unknown): string {
  if (typeof data === 'string') return truncateResult(data);
  try {
    return truncateResult(JSON.stringify(sanitizeForOutput(data), null, 2));
  } catch {
    return truncateResult(String(data));
  }
}

function ok(data: unknown, extra?: any): PrometheusToolExecutionResult {
  return {
    result: stringifyResult(data),
    error: false,
    extra: extra === undefined ? undefined : sanitizeForOutput(extra),
  };
}

function fail(message: string): PrometheusToolExecutionResult {
  return { result: truncateResult(message), error: true };
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function getAuth(context?: PrometheusToolContext): VercelAuth | null {
  const token =
    pickString(context?.getCredential?.('apiKey', ID)) ||
    pickString(context?.getCredential?.('token', ID)) ||
    pickString(process.env.VERCEL_API_TOKEN);
  const projectId =
    pickString(context?.getCredential?.('projectId', ID)) ||
    pickString(process.env.VERCEL_PROJECT_ID);
  const teamId =
    pickString(context?.getCredential?.('teamId', ID)) ||
    pickString(process.env.VERCEL_TEAM_ID);

  if (token) return { token, projectId, teamId };

  const saved = getVercelCredentials();
  if (!saved?.apiKey) return null;
  return {
    token: saved.apiKey,
    projectId: saved.projectId || undefined,
    teamId: saved.teamId || undefined,
  };
}

function resolveTeamId(args: any, auth: VercelAuth): string {
  return pickString(args?.teamId) || pickString(args?.team_id) || auth.teamId || '';
}

function resolveProjectId(args: any, auth: VercelAuth): string {
  return (
    pickString(args?.projectId) ||
    pickString(args?.project_id) ||
    pickString(args?.project) ||
    auth.projectId ||
    ''
  );
}

function withQuery(path: string, query: Record<string, unknown>): string {
  const url = new URL(path, API_BASE);
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw)) {
      for (const value of raw) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
      continue;
    }
    url.searchParams.set(key, String(raw));
  }
  return `${url.pathname}${url.search}`;
}

function validateApiPath(path: string): string | null {
  const normalized = pickString(path);
  const pathname = normalized.split('?')[0];
  if (!normalized.startsWith('/') || normalized.startsWith('//') || normalized.includes('://')) {
    return 'path must be a relative Vercel API path beginning with /.';
  }
  if (normalized.length > MAX_API_PATH_CHARS) return `path must be ${MAX_API_PATH_CHARS} characters or fewer.`;
  if (normalized.includes('#')) return 'path may not contain a URL fragment.';
  if (!/^\/v\d+(?:\/|$)/i.test(pathname)) return 'path must target a versioned Vercel REST endpoint such as /v9/projects.';
  if (pathname.split('/').some((segment) => segment === '..')) {
    return 'path may not contain parent-directory segments.';
  }
  return null;
}

function validateApiQuery(query: JsonRecord | undefined): string | null {
  if (!query) return null;
  let encodedLength = 0;
  for (const [key, raw] of Object.entries(query)) {
    if (key.length > MAX_API_QUERY_KEY_CHARS) return `query keys must be ${MAX_API_QUERY_KEY_CHARS} characters or fewer.`;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null || value === '') continue;
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        return `query parameter ${key} must be a string, number, boolean, or array of those.`;
      }
      const text = String(value);
      if (text.length > MAX_API_QUERY_VALUE_CHARS) {
        return `query parameter ${key} values must be ${MAX_API_QUERY_VALUE_CHARS} characters or fewer.`;
      }
      encodedLength += encodeURIComponent(key).length + encodeURIComponent(text).length + 2;
      if (encodedLength > MAX_API_QUERY_CHARS) return `encoded query must be ${MAX_API_QUERY_CHARS} characters or fewer.`;
    }
  }
  return null;
}

async function readResponseTextBounded(res: Response): Promise<{ text: string; exceededLimit: boolean }> {
  const contentLength = Number(res.headers.get('content-length') || '');
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    try { await res.body?.cancel(); } catch { /* best effort */ }
    return { text: '', exceededLimit: true };
  }

  if (!res.body) {
    const text = await res.text();
    return new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES
      ? { text: '', exceededLimit: true }
      : { text, exceededLimit: false };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        return { text: '', exceededLimit: true };
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), exceededLimit: false };
}

async function vercelFetch(
  path: string,
  auth: VercelAuth,
  options: VercelFetchOptions = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const teamId = options.teamId ?? auth.teamId;
  const url = new URL(path, API_BASE);
  if (teamId && !url.searchParams.has('teamId')) {
    url.searchParams.set('teamId', teamId);
  }
  let requestBody: string | undefined;
  if (options.body !== undefined) {
    let serializedBody: string | undefined;
    try {
      serializedBody = JSON.stringify(options.body);
    } catch {
      return { ok: false, status: 400, data: { error: { message: 'Vercel request body must be JSON-serializable.' } } };
    }
    if (serializedBody === undefined) {
      return { ok: false, status: 400, data: { error: { message: 'Vercel request body must be a JSON value.' } } };
    }
    requestBody = serializedBody;
    if (serializedBody.length > MAX_API_BODY_CHARS) {
      return { ok: false, status: 413, data: { error: { message: `Vercel request body exceeded the ${MAX_API_BODY_CHARS}-character safety limit.` } } };
    }
  }
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: requestBody,
    signal: AbortSignal.timeout(30_000),
  });
  const response = await readResponseTextBounded(res);
  if (response.exceededLimit) {
    return {
      ok: false,
      status: 413,
      data: { error: { message: `Vercel response exceeded the ${MAX_RESPONSE_BYTES}-byte safety limit.` } },
    };
  }
  let data: any = {};
  try {
    data = response.text ? JSON.parse(response.text) : {};
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

function apiError(action: string, res: { status: number; data: any }): PrometheusToolExecutionResult {
  const message = res.data?.error?.message || res.data?.message || stringifyResult(res.data).slice(0, 500);
  return fail(`${action} failed (${res.status}): ${message || 'Vercel API error'}`);
}

async function withAuth(
  context: PrometheusToolContext,
  fn: (auth: VercelAuth) => Promise<PrometheusToolExecutionResult>,
) {
  const auth = getAuth(context);
  if (!auth?.token) {
    return fail('Vercel is not connected. Add a Vercel API token in Connections, then try again.');
  }
  return fn(auth);
}

function summarizeProject(project: any): string {
  const framework = project.framework || project.buildCommand || 'unknown';
  const updated = project.updatedAt ? new Date(project.updatedAt).toLocaleString() : 'unknown';
  const link = project.link;
  const git = link
    ? `Git: ${link.type || 'unknown'} ${link.org ? `${link.org}/` : ''}${link.repo || 'unknown'} (production branch: ${link.productionBranch || 'unknown'})`
    : 'Git: not linked';
  return `${project.name || project.id} (${project.id}) - ${framework} - updated ${updated}\n  ${git}`;
}

function summarizeDeployment(deployment: any): string {
  const state = deployment.readyState || deployment.state || 'UNKNOWN';
  const url = deployment.url ? `https://${deployment.url}` : 'pending';
  const project = deployment.projectId ? ` project=${deployment.projectId}` : '';
  const source = deployment.gitSource
    ? ` source=${deployment.gitSource.type || 'git'}:${deployment.gitSource.ref || deployment.gitSource.sha || 'unknown'}`
    : '';
  const tsValue = deployment.createdAt || deployment.created;
  const ts = tsValue ? new Date(tsValue).toLocaleString() : 'unknown time';
  return `[${state}] ${deployment.uid || deployment.id}${project}${source} - ${url} - ${ts}`;
}

function copyAllowed(source: JsonRecord | undefined, keys: string[]): JsonRecord {
  const result: JsonRecord = {};
  if (!source) return result;
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

function normalizeGitRepository(value: unknown): JsonRecord | undefined {
  const repository = pickRecord(value);
  if (!repository) return undefined;
  return copyAllowed(repository, ['type', 'repo', 'org', 'repoId', 'owner', 'name']);
}

function buildProjectBody(args: any, includeName = false): JsonRecord {
  const body = copyAllowed(args, [
    'framework',
    'buildCommand',
    'commandForIgnoringBuildStep',
    'devCommand',
    'installCommand',
    'outputDirectory',
    'rootDirectory',
    'nodeVersion',
    'serverlessFunctionRegion',
    'publicSource',
    'autoExposeSystemEnvs',
    'autoAssignCustomDomains',
    'productionBranch',
  ]);
  if (includeName && pickString(args?.name)) body.name = pickString(args.name);
  const gitRepository = normalizeGitRepository(args?.gitRepository);
  if (gitRepository && Object.keys(gitRepository).length) body.gitRepository = gitRepository;
  const settings = pickRecord(args?.settings);
  if (settings) {
    Object.assign(body, copyAllowed(settings, [
      'framework',
      'buildCommand',
      'commandForIgnoringBuildStep',
      'devCommand',
      'installCommand',
      'outputDirectory',
      'rootDirectory',
      'nodeVersion',
      'serverlessFunctionRegion',
      'publicSource',
      'autoExposeSystemEnvs',
      'autoAssignCustomDomains',
      'productionBranch',
    ]));
  }
  return body;
}

function normalizeGitSource(args: any): { source?: JsonRecord; error?: string } {
  const raw = pickRecord(args?.gitSource) || {};
  const type = pickString(raw.type || args?.gitProvider || 'github').toLowerCase();
  if (!['github', 'gitlab', 'bitbucket'].includes(type)) {
    return { error: 'gitSource.type must be github, gitlab, or bitbucket.' };
  }
  const source: JsonRecord = { type };
  for (const key of ['org', 'repo', 'ref', 'sha', 'repoId', 'prId']) {
    const value = pickString(raw[key] ?? args?.[`git${key[0].toUpperCase()}${key.slice(1)}`]);
    if (value) source[key] = value;
  }
  if (!source.repo && !source.repoId) return { error: 'A Git deployment requires gitSource.repo or gitSource.repoId.' };
  if (!source.ref && !source.sha) return { error: 'A Git deployment requires gitSource.ref or gitSource.sha.' };
  return { source };
}

const vercelExtension: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID,
      name: NAME,
      authType: 'api_key',
      capabilities: ['api', 'deployments', 'hosting', 'projects', 'git', 'environment', 'domains', 'aliases'],
      toolNames: tools,
      isConnected: () => Boolean(getAuth()?.token),
      hasCredentials: () => Boolean(getAuth()?.token),
      describeStatus: () => {
        const auth = getAuth();
        return auth?.token
          ? `connected${auth.teamId ? ` (team ${auth.teamId})` : ''}${auth.projectId ? `, default project ${auth.projectId}` : ''}`
          : 'not connected';
      },
    });

    api.registerTool({
      name: 'connector_vercel_status',
      description: '[Vercel] Check the connected Vercel account/user and configured default project/team scope.',
      parameters: { type: 'object', required: [], properties: {} },
      connectorId: ID,
      capability: 'hosting',
      execute: async (_args: any, context) => withAuth(context, async (auth) => {
        const res = await vercelFetch('/v2/user', auth, { teamId: '' });
        if (!res.ok) return apiError('Vercel status', res);
        const user = res.data?.user || res.data;
        return ok([
          `Connected as ${user?.username || user?.email || user?.id || 'Vercel user'}`,
          auth.teamId ? `Default team: ${auth.teamId}` : 'Default team: personal account',
          auth.projectId ? `Default project: ${auth.projectId}` : 'Default project: none (account/team-wide tools enabled)',
        ].join('\n'), { user });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_list_teams',
      description: '[Vercel] List teams available to the connected Vercel token.',
      parameters: { type: 'object', required: [], properties: { limit: { type: 'number', description: 'Max teams to return (default 50)' } } },
      connectorId: ID,
      capability: 'hosting',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const res = await vercelFetch(withQuery('/v2/teams', { limit: Math.min(Number(args?.limit) || 50, 100) }), auth, { teamId: '' });
        if (!res.ok) return apiError('List Vercel teams', res);
        const teams = res.data?.teams || [];
        if (!teams.length) return ok('No teams found for this Vercel token.', { teams });
        return ok(teams.map((team: any) => `${team.slug || team.name || team.id} (${team.id})`).join('\n'), { teams });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_list_projects',
      description: '[Vercel] List projects in the connected personal account or specified team, including Git-link metadata when available.',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          teamId: { type: 'string', description: 'Optional team ID. Omit for default/personal scope.' },
          search: { type: 'string', description: 'Optional project name search.' },
          limit: { type: 'number', description: 'Max projects to return (default 20, max 100).' },
        },
      },
      connectorId: ID,
      capability: 'projects',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const teamId = resolveTeamId(args, auth);
        const res = await vercelFetch(withQuery('/v9/projects', {
          limit: Math.min(Number(args?.limit) || 20, 100),
          search: pickString(args?.search),
        }), auth, { teamId });
        if (!res.ok) return apiError('List Vercel projects', res);
        const projects = res.data?.projects || [];
        if (!projects.length) return ok('No projects found.', { projects });
        return ok(projects.map(summarizeProject).join('\n'), { projects });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_get_project',
      description: '[Vercel] Inspect a project, including its Git provider, repository, production branch, framework, domains, and current deployment metadata.',
      parameters: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', description: 'Project ID or name.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
        },
      },
      connectorId: ID,
      capability: 'projects',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const projectId = resolveProjectId(args, { ...auth, projectId: undefined });
        if (!projectId) return fail('projectId is required.');
        const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}`, auth, { teamId: resolveTeamId(args, auth) });
        if (!res.ok) return apiError('Get Vercel project', res);
        return ok(`${summarizeProject(res.data)}\n${stringifyResult({
          link: res.data?.link || null,
          productionBranch: res.data?.link?.productionBranch || res.data?.productionBranch || null,
          domains: res.data?.domains || [],
          latestDeployments: res.data?.latestDeployments || [],
        })}`, { project: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_create_project',
      description: '[Vercel] Create a project. A Git repository can be supplied with gitRepository; external write requires approval.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Project name.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          gitRepository: { type: 'object', description: 'Optional Git repository descriptor: type, repo, org, repoId, owner, name.' },
          framework: { type: 'string' },
          buildCommand: { type: 'string' },
          installCommand: { type: 'string' },
          outputDirectory: { type: 'string' },
          rootDirectory: { type: 'string' },
          productionBranch: { type: 'string' },
        },
      },
      connectorId: ID,
      capability: 'projects',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const name = pickString(args?.name);
        if (!name) return fail('name is required.');
        const res = await vercelFetch('/v11/projects', auth, {
          method: 'POST',
          teamId: resolveTeamId(args, auth),
          body: buildProjectBody(args, true),
        });
        if (!res.ok) return apiError('Create Vercel project', res);
        return ok(`Project created: ${summarizeProject(res.data)}`, { project: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_update_project',
      description: '[Vercel] Update supported project settings such as framework, build commands, root directory, production branch, or Git repository descriptor; external write requires approval.',
      parameters: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', description: 'Project ID or name.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          settings: { type: 'object', description: 'Supported project settings to update.' },
          gitRepository: { type: 'object', description: 'Optional Git repository descriptor.' },
          productionBranch: { type: 'string', description: 'Production Git branch.' },
          framework: { type: 'string' },
          buildCommand: { type: 'string' },
          installCommand: { type: 'string' },
          outputDirectory: { type: 'string' },
          rootDirectory: { type: 'string' },
        },
      },
      connectorId: ID,
      capability: 'projects',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const projectId = resolveProjectId(args, { ...auth, projectId: undefined });
        if (!projectId) return fail('projectId is required.');
        const body = buildProjectBody(args);
        if (!Object.keys(body).length) return fail('At least one supported project setting is required.');
        const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}`, auth, {
          method: 'PATCH',
          teamId: resolveTeamId(args, auth),
          body,
        });
        if (!res.ok) return apiError('Update Vercel project', res);
        return ok(`Project updated: ${summarizeProject(res.data)}`, { project: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_delete_project',
      description: '[Vercel] Delete a project. This is destructive and requires approval.',
      parameters: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', description: 'Project ID or name.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
        },
      },
      connectorId: ID,
      capability: 'projects',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: true, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const projectId = resolveProjectId(args, { ...auth, projectId: undefined });
        if (!projectId) return fail('projectId is required.');
        const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}`, auth, {
          method: 'DELETE',
          teamId: resolveTeamId(args, auth),
        });
        if (!res.ok) return apiError('Delete Vercel project', res);
        return ok(`Project deleted: ${projectId}`, { project: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_list_deployments',
      description: '[Vercel] List deployments account-wide, team-wide, or filtered by project, target, state, branch, or commit SHA.',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          teamId: { type: 'string', description: 'Optional team ID. Omit for default/personal scope.' },
          projectId: { type: 'string', description: 'Optional project ID or name.' },
          projectIds: { type: 'array', items: { type: 'string' }, description: 'Optional list of up to 20 project IDs.' },
          target: { type: 'string', description: 'Optional target: production, preview, development, staging, or a custom environment.' },
          state: { type: 'string', description: 'Optional state filter, e.g. READY,ERROR or BUILDING,READY.' },
          branch: { type: 'string', description: 'Optional Git branch filter.' },
          sha: { type: 'string', description: 'Optional Git commit SHA filter.' },
          limit: { type: 'number', description: 'Max deployments to return (default 10, max 100).' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const teamId = resolveTeamId(args, auth);
        const projectId = resolveProjectId(args, auth);
        const projectIds = Array.isArray(args?.projectIds) ? args.projectIds.slice(0, 20).map(String) : undefined;
        const res = await vercelFetch(withQuery('/v7/deployments', {
          limit: Math.min(Number(args?.limit) || 10, 100),
          projectId: projectIds?.length ? undefined : projectId,
          projectIds,
          target: pickString(args?.target),
          state: pickString(args?.state),
          branch: pickString(args?.branch),
          sha: pickString(args?.sha),
        }), auth, { teamId });
        if (!res.ok) return apiError('List Vercel deployments', res);
        const deployments = res.data?.deployments || [];
        if (!deployments.length) return ok('No deployments found.', { deployments });
        return ok(deployments.map(summarizeDeployment).join('\n'), { deployments, pagination: res.data?.pagination });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_get_deployment',
      description: '[Vercel] Get a deployment by ID or URL, including Git source metadata when available.',
      parameters: {
        type: 'object',
        required: ['deployment'],
        properties: {
          deployment: { type: 'string', description: 'Deployment ID, UID, or URL.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          withGitRepoInfo: { type: 'boolean', description: 'Ask Vercel to include Git repository information.' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const deployment = pickString(args?.deployment);
        if (!deployment) return fail('deployment is required.');
        const path = withQuery(`/v13/deployments/${encodeURIComponent(deployment)}`, {
          withGitRepoInfo: args?.withGitRepoInfo === true ? 'true' : undefined,
        });
        const res = await vercelFetch(path, auth, { teamId: resolveTeamId(args, auth) });
        if (!res.ok) return apiError('Get Vercel deployment', res);
        return ok(`${summarizeDeployment(res.data)}\nInspector: ${res.data?.inspectorUrl || 'not available'}\nGit source: ${stringifyResult(res.data?.gitSource || null)}`, { deployment: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_create_deployment',
      description: '[Vercel] Create a new deployment from a GitHub, GitLab, or Bitbucket repository branch/ref or commit SHA. This is the source-aware deployment operation; external write requires approval.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Vercel project/deployment name.' },
          projectId: { type: 'string', description: 'Optional existing Vercel project ID or name.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          target: { type: 'string', description: 'Deployment target, typically production or preview.' },
          gitSource: { type: 'object', description: 'Git source descriptor: type, org, repo or repoId, ref, sha, prId.' },
          gitProvider: { type: 'string', enum: ['github', 'gitlab', 'bitbucket'] },
          gitOrg: { type: 'string' },
          gitRepo: { type: 'string' },
          gitRef: { type: 'string', description: 'Branch or tag ref.' },
          gitSha: { type: 'string', description: 'Commit SHA.' },
          gitRepoId: { type: 'string' },
          gitPrId: { type: 'string' },
          gitMetadata: { type: 'object', description: 'Optional provider metadata such as remoteUrl, commit message, or author.' },
          projectSettings: { type: 'object', description: 'Optional Vercel project settings for the deployment.' },
          meta: { type: 'object', description: 'Optional deployment metadata.' },
          customEnvironmentSlugOrId: { type: 'string' },
          forceNew: { type: 'boolean', description: 'Force a fresh build instead of deduplicating a similar deployment.' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const name = pickString(args?.name);
        if (!name) return fail('name is required.');
        const git = normalizeGitSource(args);
        if (git.error) return fail(git.error);
        const body: JsonRecord = {
          name,
          project: resolveProjectId(args, { ...auth, projectId: undefined }) || undefined,
          target: pickString(args?.target) || undefined,
          gitSource: git.source,
          customEnvironmentSlugOrId: pickString(args?.customEnvironmentSlugOrId) || undefined,
          gitMetadata: pickRecord(args?.gitMetadata),
          projectSettings: pickRecord(args?.projectSettings),
          meta: pickRecord(args?.meta),
        };
        const path = withQuery('/v13/deployments', { forceNew: args?.forceNew === true ? '1' : undefined });
        const res = await vercelFetch(path, auth, {
          method: 'POST',
          teamId: resolveTeamId(args, auth),
          body,
        });
        if (!res.ok) return apiError('Create Vercel deployment', res);
        return ok(`Deployment created:\n${summarizeDeployment(res.data)}\nGit source: ${stringifyResult(res.data?.gitSource || git.source)}`, { deployment: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_redeploy',
      description: '[Vercel] Redeploy an existing deployment. This reuses the existing deployment source unless withLatestCommit is requested; use connector_vercel_create_deployment to deploy a specific branch or SHA.',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          deploymentId: { type: 'string', description: 'Optional existing deployment ID to redeploy.' },
          projectId: { type: 'string', description: 'Project ID/name. Required when deploymentId is omitted unless a default project is configured.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          name: { type: 'string', description: 'Optional deployment/project name override.' },
          target: { type: 'string', description: 'Deployment target, defaults to the existing target or production.' },
          withLatestCommit: { type: 'boolean', description: 'When redeploying a Git deployment, ask Vercel to use the latest commit.' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const teamId = resolveTeamId(args, auth);
        let deploymentId = pickString(args?.deploymentId) || pickString(args?.deployment_id);
        let latest: any;
        if (!deploymentId) {
          const projectId = resolveProjectId(args, auth);
          if (!projectId) return fail('projectId is required when deploymentId is omitted.');
          const list = await vercelFetch(withQuery('/v7/deployments', { projectId, limit: 1 }), auth, { teamId });
          if (!list.ok) return apiError('Find latest Vercel deployment', list);
          latest = list.data?.deployments?.[0];
          deploymentId = latest?.uid || latest?.id || '';
        }
        if (!deploymentId) return fail('No deployment found to redeploy.');
        if (!latest?.name) {
          const detail = await vercelFetch(`/v13/deployments/${encodeURIComponent(deploymentId)}`, auth, { teamId });
          if (!detail.ok) return apiError('Inspect deployment before Vercel redeploy', detail);
          latest = detail.data;
        }
        const name = pickString(args?.name) || pickString(latest?.name) || pickString(latest?.project?.name);
        if (!name) return fail('Vercel redeploy requires the existing deployment name. Supply name explicitly.');
        const res = await vercelFetch('/v13/deployments', auth, {
          method: 'POST',
          teamId,
          body: {
            deploymentId,
            name,
            target: pickString(args?.target) || latest?.target || 'production',
            withLatestCommit: args?.withLatestCommit === true ? true : undefined,
          },
        });
        if (!res.ok) return apiError('Vercel redeploy', res);
        return ok(`Redeploy triggered:\n${summarizeDeployment(res.data)}`, { deployment: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_deployment_events',
      description: '[Vercel] Read deployment build events/logs for diagnosing queued, failed, or successful builds.',
      parameters: {
        type: 'object',
        required: ['deployment'],
        properties: {
          deployment: { type: 'string', description: 'Deployment ID or URL.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          limit: { type: 'number', description: `Maximum events to return (default ${DEFAULT_EVENT_LIMIT}, max ${MAX_EVENT_LIMIT}).` },
          direction: { type: 'string', enum: ['forward', 'backward'] },
          since: { type: 'number' },
          until: { type: 'number' },
          buildId: { type: 'string', description: 'Optional build name/ID filter.' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const deployment = pickString(args?.deployment);
        if (!deployment) return fail('deployment is required.');
        const requestedLimit = args?.limit === undefined ? DEFAULT_EVENT_LIMIT : Number(args.limit);
        if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
          return fail(`limit must be a positive number between 1 and ${MAX_EVENT_LIMIT}.`);
        }
        const limit = Math.min(Math.trunc(requestedLimit), MAX_EVENT_LIMIT);
        const res = await vercelFetch(withQuery(`/v3/deployments/${encodeURIComponent(deployment)}/events`, {
          limit,
          direction: pickString(args?.direction),
          since: args?.since,
          until: args?.until,
          name: pickString(args?.buildId),
        }), auth, { teamId: resolveTeamId(args, auth) });
        if (!res.ok) return apiError('Get Vercel deployment events', res);
        const events = (Array.isArray(res.data) ? res.data : res.data?.events || []).slice(0, MAX_EVENT_LIMIT);
        const lines = events.map((event: any) => {
          const payload = event?.payload || event;
          const text = payload?.text || payload?.info?.step || payload?.info?.name || stringifyResult(payload);
          const stamp = payload?.date || event?.created || '';
          return `${stamp ? `${new Date(Number(stamp)).toISOString()} ` : ''}${text}`;
        });
        return ok(lines.join('\n') || 'No deployment events returned.', { events });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_cancel_deployment',
      description: '[Vercel] Cancel a queued or building deployment; external write requires approval.',
      parameters: {
        type: 'object',
        required: ['deployment'],
        properties: {
          deployment: { type: 'string', description: 'Deployment ID.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const deployment = pickString(args?.deployment);
        if (!deployment) return fail('deployment is required.');
        const res = await vercelFetch(`/v12/deployments/${encodeURIComponent(deployment)}/cancel`, auth, {
          method: 'PATCH',
          teamId: resolveTeamId(args, auth),
        });
        if (!res.ok) return apiError('Cancel Vercel deployment', res);
        return ok(`Deployment canceled:\n${summarizeDeployment(res.data)}`, { deployment: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_delete_deployment',
      description: '[Vercel] Delete a deployment. This is destructive and requires approval.',
      parameters: {
        type: 'object',
        required: ['deployment'],
        properties: {
          deployment: { type: 'string', description: 'Deployment ID or URL.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: true, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const deployment = pickString(args?.deployment);
        if (!deployment) return fail('deployment is required.');
        const res = await vercelFetch(`/v13/deployments/${encodeURIComponent(deployment)}`, auth, {
          method: 'DELETE',
          teamId: resolveTeamId(args, auth),
        });
        if (!res.ok) return apiError('Delete Vercel deployment', res);
        return ok(`Deployment deleted: ${deployment}`, { deployment: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_list_aliases',
      description: '[Vercel] List deployment aliases for the connected account/team, optionally filtered by project, deployment, or domain.',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          projectId: { type: 'string' },
          deploymentId: { type: 'string' },
          domain: { type: 'string' },
          teamId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      connectorId: ID,
      capability: 'aliases',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const res = await vercelFetch(withQuery('/v4/aliases', {
          projectId: pickString(args?.projectId),
          deploymentId: pickString(args?.deploymentId),
          domain: pickString(args?.domain),
          limit: Math.min(Number(args?.limit) || 20, 100),
        }), auth, { teamId: resolveTeamId(args, auth) });
        if (!res.ok) return apiError('List Vercel aliases', res);
        const aliases = res.data?.aliases || [];
        if (!aliases.length) return ok('No aliases found.', { aliases });
        return ok(aliases.map((alias: any) => `${alias.alias || alias.domain || alias.uid} -> ${alias.deploymentId || alias.deployment?.id || 'unknown deployment'}`).join('\n'), { aliases });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_assign_alias',
      description: '[Vercel] Assign a domain alias to a ready deployment; this can move a live alias and requires approval.',
      parameters: {
        type: 'object',
        required: ['deployment', 'alias'],
        properties: {
          deployment: { type: 'string', description: 'Deployment ID, alias, or URL.' },
          alias: { type: 'string', description: 'Alias hostname to assign.' },
          redirect: { type: 'string', description: 'Optional redirect hostname instead of assigning directly.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
        },
      },
      connectorId: ID,
      capability: 'aliases',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const deployment = pickString(args?.deployment);
        const alias = pickString(args?.alias);
        if (!deployment || !alias) return fail('deployment and alias are required.');
        const res = await vercelFetch(`/v2/deployments/${encodeURIComponent(deployment)}/aliases`, auth, {
          method: 'POST',
          teamId: resolveTeamId(args, auth),
          body: { alias, redirect: pickString(args?.redirect) || undefined },
        });
        if (!res.ok) return apiError('Assign Vercel alias', res);
        return ok(`Alias assigned: ${res.data?.alias || alias}`, { alias: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_env',
      description: '[Vercel] List, create, or delete environment variables for a Vercel project. Writes require approval.',
      parameters: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['list', 'set', 'delete'] },
          projectId: { type: 'string', description: 'Project ID/name. Omit to use the configured default project.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          key: { type: 'string', description: 'Environment variable key for set/delete.' },
          value: { type: 'string', description: 'Environment variable value for set.' },
          target: { type: 'string', enum: ['production', 'preview', 'development'], description: 'Target for set (default production).' },
        },
      },
      connectorId: ID,
      capability: 'environment',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const action = pickString(args?.action);
        const projectId = resolveProjectId(args, auth);
        if (!projectId) return fail('projectId is required for environment variable operations.');
        const teamId = resolveTeamId(args, auth);
        if (action === 'list') {
          const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/env`, auth, { teamId });
          if (!res.ok) return apiError('List Vercel environment variables', res);
          const envs = res.data?.envs || [];
          if (!envs.length) return ok('No environment variables found.', { envs });
          return ok(envs.map((env: any) => `${env.key} [${(env.target || []).join(', ')}] ${env.type === 'encrypted' ? '(encrypted)' : ''}`).join('\n'), { envs });
        }
        if (action === 'set') {
          const key = pickString(args?.key);
          const value = typeof args?.value === 'string' ? args.value : '';
          if (!key || !value) return fail('key and value are required for action=set.');
          const target = [pickString(args?.target) || 'production'];
          const res = await vercelFetch(`/v10/projects/${encodeURIComponent(projectId)}/env`, auth, {
            method: 'POST',
            teamId,
            body: { key, value, target, type: 'encrypted' },
          });
          if (!res.ok) return apiError('Set Vercel environment variable', res);
          return ok(`Environment variable ${key} set for ${target.join(', ')}.`, { env: res.data });
        }
        if (action === 'delete') {
          const key = pickString(args?.key);
          if (!key) return fail('key is required for action=delete.');
          const list = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/env`, auth, { teamId });
          if (!list.ok) return apiError('Find Vercel environment variable', list);
          const env = (list.data?.envs || []).find((item: any) => item.key === key);
          if (!env?.id) return fail(`Environment variable ${key} was not found.`);
          const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(env.id)}`, auth, {
            method: 'DELETE',
            teamId,
          });
          if (!res.ok) return apiError('Delete Vercel environment variable', res);
          return ok(`Environment variable ${key} deleted.`);
        }
        return fail('Unknown action. Use list, set, or delete.');
      }),
    });

    api.registerTool({
      name: 'connector_vercel_domains',
      description: '[Vercel] List domains for the connected personal account/team or a specific project.',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          projectId: { type: 'string', description: 'Optional project ID/name. Omit for account/team domains.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          limit: { type: 'number', description: 'Max domains to return (default 20).' },
        },
      },
      connectorId: ID,
      capability: 'domains',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const teamId = resolveTeamId(args, auth);
        const projectId = resolveProjectId(args, { ...auth, projectId: undefined });
        const path = projectId
          ? withQuery(`/v9/projects/${encodeURIComponent(projectId)}/domains`, { limit: Math.min(Number(args?.limit) || 20, 100) })
          : withQuery('/v5/domains', { limit: Math.min(Number(args?.limit) || 20, 100) });
        const res = await vercelFetch(path, auth, { teamId });
        if (!res.ok) return apiError('List Vercel domains', res);
        const domains = res.data?.domains || [];
        if (!domains.length) return ok('No domains found.', { domains });
        return ok(domains.map((domain: any) => `${domain.name || domain.apexName || domain.uid}${domain.gitBranch ? ` [branch=${domain.gitBranch}]` : ''}${domain.verified === false ? ' (unverified)' : ''}`).join('\n'), { domains });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_get_project_domain',
      description: '[Vercel] Get one project domain configuration, including Git branch, redirect, verification, and custom environment metadata.',
      parameters: {
        type: 'object',
        required: ['projectId', 'domain'],
        properties: {
          projectId: { type: 'string' },
          domain: { type: 'string' },
          teamId: { type: 'string' },
        },
      },
      connectorId: ID,
      capability: 'domains',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const projectId = resolveProjectId(args, { ...auth, projectId: undefined });
        const domain = pickString(args?.domain);
        if (!projectId || !domain) return fail('projectId and domain are required.');
        const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`, auth, { teamId: resolveTeamId(args, auth) });
        if (!res.ok) return apiError('Get Vercel project domain', res);
        return ok(res.data, { domain: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_manage_project_domain',
      description: '[Vercel] Add, update, verify, or remove a project domain. This changes hosting configuration and requires approval.',
      parameters: {
        type: 'object',
        required: ['action', 'projectId'],
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'verify', 'remove'] },
          projectId: { type: 'string' },
          domain: { type: 'string', description: 'Domain name. Required for add/update/verify/remove.' },
          name: { type: 'string', description: 'Replacement domain name for update.' },
          gitBranch: { type: 'string' },
          redirect: { type: 'string' },
          redirectStatusCode: { type: 'number' },
          customEnvironmentId: { type: 'string' },
          teamId: { type: 'string' },
        },
      },
      connectorId: ID,
      capability: 'domains',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const action = pickString(args?.action);
        const projectId = resolveProjectId(args, { ...auth, projectId: undefined });
        const domain = pickString(args?.domain);
        const teamId = resolveTeamId(args, auth);
        if (!projectId || !domain) return fail('projectId and domain are required.');
        if (action === 'add') {
          const res = await vercelFetch(`/v10/projects/${encodeURIComponent(projectId)}/domains`, auth, {
            method: 'POST', teamId,
            body: { name: domain, gitBranch: pickString(args?.gitBranch) || undefined, customEnvironmentId: pickString(args?.customEnvironmentId) || undefined },
          });
          if (!res.ok) return apiError('Add Vercel project domain', res);
          return ok(`Domain added: ${domain}`, { domain: res.data });
        }
        if (action === 'update') {
          const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`, auth, {
            method: 'PATCH', teamId,
            body: {
              name: pickString(args?.name) || undefined,
              gitBranch: pickString(args?.gitBranch) || undefined,
              redirect: pickString(args?.redirect) || undefined,
              redirectStatusCode: args?.redirectStatusCode,
              customEnvironmentId: pickString(args?.customEnvironmentId) || undefined,
            },
          });
          if (!res.ok) return apiError('Update Vercel project domain', res);
          return ok(`Domain updated: ${domain}`, { domain: res.data });
        }
        if (action === 'verify') {
          const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}/verify`, auth, { method: 'POST', teamId });
          if (!res.ok) return apiError('Verify Vercel project domain', res);
          return ok(`Domain verification requested: ${domain}`, { domain: res.data });
        }
        if (action === 'remove') {
          const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`, auth, { method: 'DELETE', teamId });
          if (!res.ok) return apiError('Remove Vercel project domain', res);
          return ok(`Domain removed: ${domain}`, { domain: res.data });
        }
        return fail('Unknown action. Use add, update, verify, or remove.');
      }),
    });

    api.registerTool({
      name: 'connector_vercel_api_request',
      description: '[Vercel] Call a provider-native Vercel REST API path not yet covered by a first-class tool. Paths are restricted to api.vercel.com; GET/HEAD are read-only, while other methods use the normal external-write approval gate.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Relative Vercel API path beginning with /, for example /v9/projects/my-project.' },
          method: { type: 'string', enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method, default GET.' },
          query: { type: 'object', description: 'Optional query parameters. Values must be strings, numbers, booleans, or arrays of those.' },
          body: { type: 'object', description: 'Optional JSON request body for write methods.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
        },
      },
      connectorId: ID,
      capability: 'api',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const rawPath = pickString(args?.path);
        const pathError = validateApiPath(rawPath);
        if (pathError) return fail(pathError);
        const method = pickString(args?.method || 'GET').toUpperCase();
        if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return fail('method must be GET, HEAD, POST, PUT, PATCH, or DELETE.');
        const query = pickRecord(args?.query);
        const queryError = validateApiQuery(query);
        if (queryError) return fail(queryError);
        const path = query ? withQuery(rawPath, query) : rawPath;
        if (path.length > MAX_API_PATH_CHARS + MAX_API_QUERY_CHARS) return fail('path and query parameters exceed the combined safety limit.');
        if (args?.body !== undefined && method !== 'GET' && method !== 'HEAD') {
          let bodyChars = 0;
          try {
            const serializedBody = JSON.stringify(args.body);
            if (serializedBody === undefined) return fail('body must be a JSON value.');
            bodyChars = serializedBody.length;
          } catch {
            return fail('body must be JSON-serializable.');
          }
          if (bodyChars > MAX_API_BODY_CHARS) return fail(`body must be ${MAX_API_BODY_CHARS} characters or fewer.`);
        }
        const res = await vercelFetch(path, auth, {
          method,
          body: method === 'GET' || method === 'HEAD' ? undefined : args?.body,
          teamId: resolveTeamId(args, auth),
        });
        if (!res.ok) return apiError(`Vercel API ${method} ${rawPath}`, res);
        return ok(res.data, { status: res.status, method, path });
      }),
    });
  },
};

export default vercelExtension;
