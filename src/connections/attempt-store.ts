import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { CONNECTION_SCHEMA_VERSION, ConnectionAttempt, ConnectionAttemptState, ConnectionProgress } from './types';
import { assertConnectionAttempt, canTransitionConnectionAttempt, isTerminalConnectionAttemptState } from './schema';

interface AttemptStoreFile { version: 1; updatedAt: string; attempts: Record<string, ConnectionAttempt>; }

export class ConnectionAttemptStore {
  private readonly filePath: string;
  private data: AttemptStoreFile;

  constructor(configDir: string, fileName = 'connection-attempts.json') {
    this.filePath = path.join(configDir, fileName);
    this.data = this.load();
  }

  create(input: { serviceId: string; serviceName?: string; pluginId?: string; requestedCapabilities?: string[]; readOnly?: boolean; metadata?: Record<string, unknown> }): ConnectionAttempt {
    const now = new Date().toISOString();
    const attempt: ConnectionAttempt = {
      id: `conn_attempt_${randomUUID()}`,
      schemaVersion: CONNECTION_SCHEMA_VERSION,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      pluginId: input.pluginId,
      requestedCapabilities: input.requestedCapabilities ?? [],
      readOnly: input.readOnly,
      state: 'requested',
      progress: [],
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.data.attempts[attempt.id] = attempt;
    this.save();
    return structuredClone(attempt);
  }

  get(id: string): ConnectionAttempt | undefined { const value = this.data.attempts[id]; return value ? structuredClone(value) : undefined; }
  list(filter?: { serviceId?: string; state?: ConnectionAttemptState; limit?: number }): ConnectionAttempt[] {
    let items = Object.values(this.data.attempts);
    if (filter?.serviceId) items = items.filter((item) => item.serviceId === filter.serviceId);
    if (filter?.state) items = items.filter((item) => item.state === filter.state);
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return structuredClone(items.slice(0, filter?.limit ?? items.length));
  }

  update(id: string, patch: Partial<Omit<ConnectionAttempt, 'id' | 'schemaVersion' | 'createdAt'>>): ConnectionAttempt {
    const current = this.data.attempts[id];
    if (!current) throw new Error(`Unknown connection attempt: ${id}`);
    if (patch.state && !canTransitionConnectionAttempt(current.state, patch.state)) {
      throw new Error(`Invalid connection attempt transition: ${current.state} -> ${patch.state}`);
    }
    const next: ConnectionAttempt = { ...current, ...patch, id: current.id, schemaVersion: CONNECTION_SCHEMA_VERSION, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
    if (patch.state && isTerminalConnectionAttemptState(patch.state)) next.completedAt ??= next.updatedAt;
    assertConnectionAttempt(next);
    this.data.attempts[id] = next;
    this.save();
    return structuredClone(next);
  }

  addProgress(id: string, progress: Omit<ConnectionProgress, 'id' | 'at'> & Partial<Pick<ConnectionProgress, 'id' | 'at'>>): ConnectionAttempt {
    const current = this.get(id);
    if (!current) throw new Error(`Unknown connection attempt: ${id}`);
    current.progress.push({ ...progress, id: progress.id ?? randomUUID(), at: progress.at ?? new Date().toISOString() });
    return this.update(id, { progress: current.progress });
  }

  delete(id: string): boolean {
    if (!this.data.attempts[id]) return false;
    delete this.data.attempts[id]; this.save(); return true;
  }

  private load(): AttemptStoreFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, updatedAt: new Date().toISOString(), attempts: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as AttemptStoreFile;
      if (parsed.version !== 1 || typeof parsed.attempts !== 'object') throw new Error('Unsupported attempt store format');
      for (const attempt of Object.values(parsed.attempts)) assertConnectionAttempt(attempt);
      return parsed;
    } catch (error) { throw new Error(`Failed to load connection attempts from ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.data.updatedAt = new Date().toISOString();
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8'); fs.renameSync(temp, this.filePath); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
}
