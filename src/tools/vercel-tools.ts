/**
 * vercel-tools.ts — Vercel deployment and project management tools
 *
 * Tools:
 *   vercel_deploy    — Trigger a deployment (redeploy latest or specific git ref)
 *   vercel_status    — Check deployment status
 *   vercel_env       — List/set/delete environment variables on a Vercel project
 *   vercel_domains   — List domains on a project
 *
 * Config required (in Vault or env):
 *   VERCEL_API_TOKEN  — Personal access token from vercel.com/account/tokens
 *   VERCEL_PROJECT_ID — Project ID (from vercel project settings)
 *   VERCEL_TEAM_ID    — Team ID (optional, for team projects)
 */

import type { ToolResult } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVercelConfig(): { token: string; projectId: string; teamId?: string } | null {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;
  return {
    token,
    projectId,
    teamId: process.env.VERCEL_TEAM_ID,
  };
}

async function vercelFetch(
  path: string,
  opts: { method?: string; body?: object; teamId?: string; token: string }
): Promise<{ ok: boolean; status: number; data: any }> {
  const base = 'https://api.vercel.com';
  const teamParam = opts.teamId ? `?teamId=${opts.teamId}` : '';
  const url = `${base}${path}${teamParam}`;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  let data: any;
  try { data = await res.json(); } catch { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

// ─── vercel_deploy ────────────────────────────────────────────────────────────

export const vercelDeployTool = {
  name: 'vercel_deploy',
  description:
    'Trigger a Vercel deployment for the news site. ' +
    'action=redeploy re-runs the latest deployment. ' +
    'action=status checks the current deployment state. ' +
    'action=list shows recent deployments. ' +
    'Requires VERCEL_API_TOKEN and VERCEL_PROJECT_ID env vars.',
  schema: {
    action: 'redeploy | status | list',
    deployment_id: 'Deployment ID for status check (optional — uses latest if omitted)',
    limit: 'Number of deployments to list (default 5)',
  },
  jsonSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['redeploy', 'status', 'list'] },
      deployment_id: { type: 'string' },
      limit: { type: 'number' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const action = String(args?.action || '').trim();
    const cfg = getVercelConfig();
    if (!cfg) {
      return {
        success: false,
        error:
          'Vercel not configured. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID in environment. ' +
          'Get token at: https://vercel.com/account/tokens',
      };
    }

    try {
      if (action === 'list') {
        const limit = Math.min(Number(args?.limit) || 5, 20);
        const res = await vercelFetch(
          `/v6/deployments?projectId=${cfg.projectId}&limit=${limit}`,
          { token: cfg.token, teamId: cfg.teamId }
        );
        if (!res.ok) return { success: false, error: `Vercel API error ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}` };

        const deployments = res.data?.deployments ?? [];
        const lines = deployments.map((d: any) => {
          const state = d.readyState ?? d.state ?? 'UNKNOWN';
          const url = d.url ? `https://${d.url}` : '—';
          const ts = d.createdAt ? new Date(d.createdAt).toLocaleString() : '—';
          return `[${state}] ${d.uid} — ${url} (${ts})`;
        });
        return {
          success: true,
          stdout: lines.length ? lines.join('\n') : 'No deployments found.',
          data: { deployments },
        };
      }

      if (action === 'status') {
        let deploymentId = String(args?.deployment_id || '').trim();
        if (!deploymentId) {
          // Get latest
          const listRes = await vercelFetch(
            `/v6/deployments?projectId=${cfg.projectId}&limit=1`,
            { token: cfg.token, teamId: cfg.teamId }
          );
          deploymentId = listRes.data?.deployments?.[0]?.uid;
          if (!deploymentId) return { success: false, error: 'No deployments found.' };
        }
        const res = await vercelFetch(
          `/v13/deployments/${deploymentId}`,
          { token: cfg.token, teamId: cfg.teamId }
        );
        if (!res.ok) return { success: false, error: `Vercel API error ${res.status}` };
        const d = res.data;
        const state = d.readyState ?? d.state ?? 'UNKNOWN';
        const url = d.url ? `https://${d.url}` : '—';
        return {
          success: true,
          stdout: `Deployment ${deploymentId}\nStatus: ${state}\nURL: ${url}\nCreated: ${new Date(d.createdAt).toLocaleString()}`,
          data: { deployment: d },
        };
      }

      if (action === 'redeploy') {
        // Get latest deployment to redeploy
        const listRes = await vercelFetch(
          `/v6/deployments?projectId=${cfg.projectId}&limit=1`,
          { token: cfg.token, teamId: cfg.teamId }
        );
        const latest = listRes.data?.deployments?.[0];
        if (!latest) return { success: false, error: 'No deployments found to redeploy.' };

        // Trigger redeploy
        const res = await vercelFetch(
          `/v13/deployments`,
          {
            method: 'POST',
            token: cfg.token,
            teamId: cfg.teamId,
            body: {
              name: latest.name ?? 'xpose-news',
              deploymentId: latest.uid,
              target: latest.target ?? 'production',
            },
          }
        );
        if (!res.ok) {
          return { success: false, error: `Redeploy failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}` };
        }
        const d = res.data;
        return {
          success: true,
          stdout: `Redeploy triggered!\nDeployment ID: ${d.id ?? d.uid}\nURL: ${d.url ? 'https://' + d.url : 'pending'}\nState: ${d.readyState ?? 'QUEUED'}`,
          data: { deployment: d },
        };
      }

      return { success: false, error: `Unknown action "${action}". Valid: redeploy, status, list` };
    } catch (err: any) {
      return { success: false, error: `vercel_deploy error: ${String(err?.message || err)}` };
    }
  },
};

// ─── vercel_env ───────────────────────────────────────────────────────────────

export const vercelEnvTool = {
  name: 'vercel_env',
  description:
    'Manage environment variables on the Vercel project. ' +
    'action=list shows all env vars. action=set creates or updates one. action=delete removes one. ' +
    'Requires VERCEL_API_TOKEN and VERCEL_PROJECT_ID.',
  schema: {
    action: 'list | set | delete',
    key: 'Environment variable name (required for set/delete)',
    value: 'Environment variable value (required for set)',
    target: 'Deployment target: production | preview | development (default: production)',
  },
  jsonSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'set', 'delete'] },
      key: { type: 'string' },
      value: { type: 'string' },
      target: { type: 'string', enum: ['production', 'preview', 'development'] },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const action = String(args?.action || '').trim();
    const cfg = getVercelConfig();
    if (!cfg) {
      return { success: false, error: 'Vercel not configured. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID.' };
    }

    try {
      if (action === 'list') {
        const res = await vercelFetch(
          `/v9/projects/${cfg.projectId}/env`,
          { token: cfg.token, teamId: cfg.teamId }
        );
        if (!res.ok) return { success: false, error: `Vercel API error ${res.status}` };
        const envs = res.data?.envs ?? [];
        if (!envs.length) return { success: true, stdout: 'No environment variables set.', data: { envs: [] } };
        const lines = envs.map((e: any) =>
          `${e.key} [${(e.target ?? []).join(', ')}] — ${e.type === 'encrypted' ? '(encrypted)' : e.value?.slice(0, 40)}`
        );
        return { success: true, stdout: lines.join('\n'), data: { envs } };
      }

      if (action === 'set') {
        const key = String(args?.key || '').trim();
        const value = String(args?.value || '').trim();
        if (!key || !value) return { success: false, error: 'key and value are required for set' };
        const target = [args?.target ?? 'production'];

        const res = await vercelFetch(
          `/v10/projects/${cfg.projectId}/env`,
          {
            method: 'POST',
            token: cfg.token,
            teamId: cfg.teamId,
            body: { key, value, target, type: 'encrypted' },
          }
        );
        if (!res.ok) return { success: false, error: `Set env failed (${res.status}): ${JSON.stringify(res.data).slice(0, 200)}` };
        return { success: true, stdout: `Environment variable "${key}" set for ${target.join(', ')}.`, data: res.data };
      }

      if (action === 'delete') {
        const key = String(args?.key || '').trim();
        if (!key) return { success: false, error: 'key is required for delete' };
        // First list to find ID
        const listRes = await vercelFetch(
          `/v9/projects/${cfg.projectId}/env`,
          { token: cfg.token, teamId: cfg.teamId }
        );
        const env = (listRes.data?.envs ?? []).find((e: any) => e.key === key);
        if (!env) return { success: false, error: `Environment variable "${key}" not found.` };

        const res = await vercelFetch(
          `/v9/projects/${cfg.projectId}/env/${env.id}`,
          { method: 'DELETE', token: cfg.token, teamId: cfg.teamId }
        );
        if (!res.ok) return { success: false, error: `Delete env failed (${res.status})` };
        return { success: true, stdout: `Environment variable "${key}" deleted.` };
      }

      return { success: false, error: `Unknown action "${action}". Valid: list, set, delete` };
    } catch (err: any) {
      return { success: false, error: `vercel_env error: ${String(err?.message || err)}` };
    }
  },
};
