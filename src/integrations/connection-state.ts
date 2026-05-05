import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config.js';
import { getVault } from '../security/vault.js';

export type SavedConnectionsMap = Record<
  string,
  {
    connected?: boolean;
    connectedAt?: number;
    authType?: string;
    [key: string]: unknown;
  }
>;

export type VercelCredentials = {
  apiKey: string;
  projectId: string;
  teamId: string;
};

export function getConnectionsFilePath(): string {
  return path.join(getConfig().getConfigDir(), 'connections.json');
}

export function loadSavedConnections(): SavedConnectionsMap {
  try {
    const connectionsFile = getConnectionsFilePath();
    if (!fs.existsSync(connectionsFile)) return {};
    return JSON.parse(fs.readFileSync(connectionsFile, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveSavedConnections(data: SavedConnectionsMap): void {
  const connectionsFile = getConnectionsFilePath();
  fs.mkdirSync(path.dirname(connectionsFile), { recursive: true });
  fs.writeFileSync(connectionsFile, JSON.stringify(data, null, 2), 'utf-8');
}

export function getVercelCredentials(): VercelCredentials | null {
  try {
    const envApiKey = String(process.env.VERCEL_API_TOKEN || '').trim();
    const envProjectId = String(process.env.VERCEL_PROJECT_ID || '').trim();
    const envTeamId = String(process.env.VERCEL_TEAM_ID || '').trim();
    if (envApiKey) {
      return { apiKey: envApiKey, projectId: envProjectId, teamId: envTeamId };
    }
  } catch {
    // fall through to vault
  }

  try {
    const secret = getVault(getConfig().getConfigDir()).get(
      'integration.vercel.credentials',
      'connections:vercel:get',
    );
    if (!secret) return null;
    const parsed = JSON.parse(secret.expose());
    const apiKey = String(parsed?.apiKey || '').trim();
    if (!apiKey) return null;
    return {
      apiKey,
      projectId: String(parsed?.projectId || '').trim(),
      teamId: String(parsed?.teamId || '').trim(),
    };
  } catch {
    return null;
  }
}
