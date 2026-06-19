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
  'connector_vercel_list_deployments',
  'connector_vercel_get_deployment',
  'connector_vercel_redeploy',
  'connector_vercel_env',
  'connector_vercel_domains',
];

type VercelAuth = {
  token: string;
  projectId?: string;
  teamId?: string;
};

function ok(data: unknown, extra?: any): PrometheusToolExecutionResult {
  if (typeof data === 'string') return { result: data, error: false, extra };
  return { result: JSON.stringify(data, null, 2), error: false, extra };
}

function fail(message: string): PrometheusToolExecutionResult {
  return { result: message, error: true };
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

async function vercelFetch(
  path: string,
  auth: VercelAuth,
  options: { method?: string; body?: unknown; teamId?: string } = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const teamId = options.teamId ?? auth.teamId;
  const url = new URL(path, API_BASE);
  if (teamId && !url.searchParams.has('teamId')) {
    url.searchParams.set('teamId', teamId);
  }
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

function apiError(action: string, res: { status: number; data: any }): PrometheusToolExecutionResult {
  const message = res.data?.error?.message || res.data?.message || JSON.stringify(res.data).slice(0, 300);
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
  return `${project.name || project.id} (${project.id}) - ${framework} - updated ${updated}`;
}

function summarizeDeployment(deployment: any): string {
  const state = deployment.readyState || deployment.state || 'UNKNOWN';
  const url = deployment.url ? `https://${deployment.url}` : 'pending';
  const project = deployment.projectId ? ` project=${deployment.projectId}` : '';
  const created = deployment.createdAt || deployment.created;
  const ts = created ? new Date(created).toLocaleString() : 'unknown time';
  return `[${state}] ${deployment.uid || deployment.id}${project} - ${url} - ${ts}`;
}

const vercelExtension: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID,
      name: NAME,
      authType: 'api_key',
      capabilities: ['deployments', 'hosting', 'projects', 'environment'],
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
      description: '[Vercel] List projects in the connected personal account or specified team.',
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
      name: 'connector_vercel_list_deployments',
      description: '[Vercel] List deployments account-wide, team-wide, or filtered to one/multiple projects.',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          teamId: { type: 'string', description: 'Optional team ID. Omit for default/personal scope.' },
          projectId: { type: 'string', description: 'Optional project ID or name. Omit for account/team-wide deployments.' },
          projectIds: { type: 'array', items: { type: 'string' }, description: 'Optional list of up to 20 project IDs.' },
          target: { type: 'string', enum: ['production', 'preview', 'development'], description: 'Optional deployment target filter.' },
          state: { type: 'string', description: 'Optional state filter, e.g. READY,ERROR or BUILDING,READY.' },
          limit: { type: 'number', description: 'Max deployments to return (default 10, max 100).' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const teamId = resolveTeamId(args, auth);
        const projectId = resolveProjectId(args, auth);
        const projectIds = Array.isArray(args?.projectIds) ? args.projectIds.slice(0, 20).map(String) : undefined;
        const res = await vercelFetch(withQuery('/v6/deployments', {
          limit: Math.min(Number(args?.limit) || 10, 100),
          projectId: projectIds?.length ? undefined : projectId,
          projectIds,
          target: pickString(args?.target),
          state: pickString(args?.state),
        }), auth, { teamId });
        if (!res.ok) return apiError('List Vercel deployments', res);
        const deployments = res.data?.deployments || [];
        if (!deployments.length) return ok('No deployments found.', { deployments });
        return ok(deployments.map(summarizeDeployment).join('\n'), { deployments, pagination: res.data?.pagination });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_get_deployment',
      description: '[Vercel] Get a deployment by ID or URL.',
      parameters: {
        type: 'object',
        required: ['deployment'],
        properties: {
          deployment: { type: 'string', description: 'Deployment ID, UID, or URL.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const deployment = pickString(args?.deployment);
        if (!deployment) return fail('deployment is required.');
        const res = await vercelFetch(`/v13/deployments/${encodeURIComponent(deployment)}`, auth, { teamId: resolveTeamId(args, auth) });
        if (!res.ok) return apiError('Get Vercel deployment', res);
        return ok(`${summarizeDeployment(res.data)}\nInspector: ${res.data?.inspectorUrl || 'not available'}`, { deployment: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_redeploy',
      description: '[Vercel] Redeploy the latest deployment for a project, or redeploy a specific deployment ID.',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          deploymentId: { type: 'string', description: 'Optional existing deployment ID to redeploy.' },
          projectId: { type: 'string', description: 'Project ID/name. Required when deploymentId is omitted unless a default project is configured.' },
          teamId: { type: 'string', description: 'Optional team ID.' },
          target: { type: 'string', enum: ['production', 'preview'], description: 'Deployment target, defaults to latest deployment target or production.' },
        },
      },
      connectorId: ID,
      capability: 'deployments',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const teamId = resolveTeamId(args, auth);
        let deploymentId = pickString(args?.deploymentId) || pickString(args?.deployment_id);
        let latest: any;
        if (!deploymentId) {
          const projectId = resolveProjectId(args, auth);
          if (!projectId) return fail('projectId is required when deploymentId is omitted.');
          const list = await vercelFetch(withQuery('/v6/deployments', { projectId, limit: 1 }), auth, { teamId });
          if (!list.ok) return apiError('Find latest Vercel deployment', list);
          latest = list.data?.deployments?.[0];
          deploymentId = latest?.uid || latest?.id || '';
        }
        if (!deploymentId) return fail('No deployment found to redeploy.');
        const res = await vercelFetch('/v13/deployments', auth, {
          method: 'POST',
          teamId,
          body: {
            deploymentId,
            name: latest?.name,
            target: pickString(args?.target) || latest?.target || 'production',
          },
        });
        if (!res.ok) return apiError('Vercel redeploy', res);
        return ok(`Redeploy triggered:\n${summarizeDeployment(res.data)}`, { deployment: res.data });
      }),
    });

    api.registerTool({
      name: 'connector_vercel_env',
      description: '[Vercel] List, create, update, or delete environment variables for a Vercel project.',
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
      capability: 'hosting',
      execute: async (args: any, context) => withAuth(context, async (auth) => {
        const teamId = resolveTeamId(args, auth);
        const projectId = resolveProjectId(args, { ...auth, projectId: undefined });
        const path = projectId
          ? `/v9/projects/${encodeURIComponent(projectId)}/domains`
          : withQuery('/v5/domains', { limit: Math.min(Number(args?.limit) || 20, 100) });
        const res = await vercelFetch(path, auth, { teamId });
        if (!res.ok) return apiError('List Vercel domains', res);
        const domains = res.data?.domains || [];
        if (!domains.length) return ok('No domains found.', { domains });
        return ok(domains.map((domain: any) => `${domain.name || domain.apexName || domain.uid}${domain.verified === false ? ' (unverified)' : ''}`).join('\n'), { domains });
      }),
    });
  },
};

export default vercelExtension;
