import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
/** Account identity comes from verified host auth; local mode is separately persisted per config directory. */
export function resolvePluginAccountOwner(directory: string, authenticatedUserId: string | null): string {
  if (authenticatedUserId) return `user:${authenticatedUserId}`;
  const file = path.join(directory, 'plugin-local-owner.json');
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, id: `local:${randomUUID()}` }), { flag: 'wx', mode: 0o600 });
  } catch (error: any) { if (error?.code !== 'EEXIST') throw new Error('ACCOUNT_OWNER_UNAVAILABLE'); }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || typeof data.id !== 'string' || !/^local:[a-f0-9-]{36}$/.test(data.id)) throw new Error();
    return data.id;
  } catch { throw new Error('ACCOUNT_OWNER_UNAVAILABLE'); }
}
