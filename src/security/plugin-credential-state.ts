import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getInjectedMasterKey } from './vault-key-bootstrap';

type State = { stopped: boolean; generation: number; history: Array<{ at: string; action: string }> };
export function protectedPluginStorageAvailable(): boolean {
  return process.env.PROMETHEUS_VAULT_OS_PROTECTED === '1' && Boolean(getInjectedMasterKey());
}
export function pluginCredentialState(directory: string, service: string): State {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(directory, 'plugin-credential-state.json'), 'utf8'));
    const state = data[service];
    if (!state) return { stopped: false, generation: 0, history: [] };
    return { stopped: state.stopped !== false, generation: Number(state.generation) || 0, history: Array.isArray(state.history) ? state.history.slice(-30) : [] };
  } catch (error: any) {
    return { stopped: error?.code !== 'ENOENT', generation: 0, history: [] };
  }
}
export function setPluginCredentialState(directory: string, service: string, stopped: boolean, action: string): State {
  const file = path.join(directory, 'plugin-credential-state.json');
  let data: Record<string, State> = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error: any) { if (error?.code !== 'ENOENT') throw new Error('CREDENTIAL_STATE_UNAVAILABLE'); }
  const prior = pluginCredentialState(directory, service);
  const state = { stopped, generation: prior.generation + 1, history: [...prior.history, { at: new Date().toISOString(), action }].slice(-30) };
  data[service] = state;
  fs.mkdirSync(directory, { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(temp, file);
  return state;
}
export function assertPluginCredentialUse(directory: string, service: string, generation?: number): number {
  const state = pluginCredentialState(directory, service);
  if (state.stopped || (generation !== undefined && state.generation !== generation)) throw new Error('CREDENTIAL_USE_STOPPED');
  return state.generation;
}
