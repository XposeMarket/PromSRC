// src/tools/view-connections.ts
// CIS — view_connections tool
// Lets the AI see all configured connectors, their connection state,
// and recent activity — so it can reference them in conversation and
// proactively suggest using connected data sources.

import fs from 'fs';
import path from 'path';
import type { ToolResult } from '../types.js';

const CONNECTIONS_FILE = path.join(process.cwd(), '.prometheus', 'connections.json');
const CONNECTIONS_ACTIVITY_FILE = path.join(process.cwd(), '.prometheus', 'connections-activity.jsonl');

// All known connectors — mirrors the CONNECTORS array in index.html
const CONNECTOR_CATALOG = [
  { id: 'gmail',        name: 'Gmail',        category: 'Email',     authType: 'oauth'   },
  { id: 'slack',        name: 'Slack',        category: 'Messaging', authType: 'oauth'   },
  { id: 'github',       name: 'GitHub',       category: 'Dev',       authType: 'oauth'   },
  { id: 'notion',       name: 'Notion',       category: 'Docs',      authType: 'oauth'   },
  { id: 'hubspot',      name: 'HubSpot',      category: 'CRM',       authType: 'oauth'   },
  { id: 'salesforce',   name: 'Salesforce',   category: 'CRM',       authType: 'oauth'   },
  { id: 'stripe',       name: 'Stripe',       category: 'Finance',   authType: 'oauth'   },
  { id: 'ga4',          name: 'Google Analytics', category: 'Analytics', authType: 'oauth' },
  { id: 'instagram',    name: 'Instagram',    category: 'Social',    authType: 'browser' },
  { id: 'tiktok',       name: 'TikTok',       category: 'Social',    authType: 'browser' },
  { id: 'x',            name: 'X / Twitter',  category: 'Social',    authType: 'browser' },
  { id: 'linkedin',     name: 'LinkedIn',     category: 'Social',    authType: 'browser' },
  { id: 'reddit',       name: 'Reddit',       category: 'Social',    authType: 'oauth'   },
  { id: 'google_drive', name: 'Google Drive', category: 'Storage',   authType: 'oauth'   },
];

function loadConnections(): Record<string, any> {
  try {
    if (!fs.existsSync(CONNECTIONS_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
  } catch { return {}; }
}

function readRecentActivity(id: string, limit = 5): any[] {
  try {
    if (!fs.existsSync(CONNECTIONS_ACTIVITY_FILE)) return [];
    const lines = fs.readFileSync(CONNECTIONS_ACTIVITY_FILE, 'utf-8')
      .trim().split('\n').filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.connectorId === id)
      .slice(-limit)
      .reverse();
  } catch { return []; }
}

export const viewConnectionsTool = {
  name: 'view_connections',
  description:
    'View all available connectors and their current connection status. ' +
    'Shows which platforms are connected, when they were connected, and recent activity. ' +
    'Use this before suggesting data from Gmail, Slack, GitHub, social media, CRM, or any ' +
    'external platform — so you know what\'s actually available to pull from. ' +
    'Use action="list" for a summary, action="detail" with connector_id for full activity log.',
  schema: {
    action: 'list (summary of all) | detail (full info for one connector)',
    connector_id: 'ID of specific connector for detail view (gmail, slack, github, notion, hubspot, salesforce, stripe, ga4, instagram, tiktok, x, linkedin, reddit, google_drive)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'detail'],
        description: 'list = summary of all connectors | detail = full info for one',
      },
      connector_id: {
        type: 'string',
        description: 'Required for action=detail',
      },
    },
    additionalProperties: false,
  },

  execute: async (args: any): Promise<ToolResult> => {
    const action = String(args?.action || 'list').trim().toLowerCase();
    const connectorId = String(args?.connector_id || '').trim().toLowerCase();
    const state = loadConnections();

    // ── action: list ──────────────────────────────────────────────────────────
    if (action === 'list') {
      const connected = CONNECTOR_CATALOG.filter(c => state[c.id]?.connected);
      const disconnected = CONNECTOR_CATALOG.filter(c => !state[c.id]?.connected);

      const lines: string[] = [];

      if (connected.length === 0) {
        lines.push('No connectors are currently connected.');
        lines.push('');
        lines.push('The user can connect platforms via the Connections panel in the right column of the UI.');
      } else {
        lines.push(`✅ Connected (${connected.length}):`);
        for (const c of connected) {
          const s = state[c.id];
          const since = s.connectedAt ? `since ${new Date(s.connectedAt).toLocaleDateString()}` : '';
          const recentCount = readRecentActivity(c.id, 1).length;
          lines.push(`  • ${c.name} [${c.id}] — ${c.category} — ${c.authType}${since ? ' ' + since : ''}${recentCount ? ' — has activity' : ''}`);
        }
      }

      if (disconnected.length > 0) {
        lines.push('');
        lines.push(`○ Not connected (${disconnected.length}):`);
        // Group by category
        const byCategory: Record<string, string[]> = {};
        for (const c of disconnected) {
          if (!byCategory[c.category]) byCategory[c.category] = [];
          byCategory[c.category].push(`${c.name} [${c.id}]`);
        }
        for (const [cat, names] of Object.entries(byCategory)) {
          lines.push(`  ${cat}: ${names.join(', ')}`);
        }
      }

      lines.push('');
      lines.push('Use action="detail" with a connector_id to see full activity log for a connected platform.');

      return {
        success: true,
        stdout: lines.join('\n'),
        data: {
          connected: connected.map(c => c.id),
          disconnected: disconnected.map(c => c.id),
          total: CONNECTOR_CATALOG.length,
        },
      };
    }

    // ── action: detail ────────────────────────────────────────────────────────
    if (action === 'detail') {
      if (!connectorId) {
        return { success: false, error: 'connector_id is required for action=detail' };
      }
      const catalog = CONNECTOR_CATALOG.find(c => c.id === connectorId);
      if (!catalog) {
        const ids = CONNECTOR_CATALOG.map(c => c.id).join(', ');
        return { success: false, error: `Unknown connector "${connectorId}". Valid IDs: ${ids}` };
      }

      const s = state[connectorId];
      const isConnected = !!s?.connected;
      const lines: string[] = [];

      lines.push(`── ${catalog.name} ──`);
      lines.push(`ID: ${catalog.id}`);
      lines.push(`Category: ${catalog.category}`);
      lines.push(`Auth type: ${catalog.authType}`);
      lines.push(`Status: ${isConnected ? '✅ Connected' : '○ Not connected'}`);
      if (isConnected && s.connectedAt) {
        lines.push(`Connected: ${new Date(s.connectedAt).toLocaleString()}`);
      }

      if (isConnected) {
        const activity = readRecentActivity(connectorId, 20);
        if (activity.length === 0) {
          lines.push('');
          lines.push('Activity: No activity logged yet.');
        } else {
          lines.push('');
          lines.push(`Recent activity (last ${activity.length} events):`);
          for (const e of activity) {
            const dir = e.direction === 'in' ? '← IN ' : '→ OUT';
            const time = new Date(e.timestamp).toLocaleString();
            lines.push(`  ${dir} [${time}] ${e.title || e.action || ''}${e.summary ? ' — ' + e.summary.slice(0, 100) : ''}`);
          }
        }
      } else {
        lines.push('');
        lines.push('Not connected. The user can connect this platform via the Connections panel in the UI.');
      }

      return {
        success: true,
        stdout: lines.join('\n'),
        data: { connector: catalog, connected: isConnected, state: s || null },
      };
    }

    return { success: false, error: `Unknown action "${action}". Use list or detail.` };
  },
};
