import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { CONNECTION_SCHEMA_VERSION, ConnectionRecord } from './types';
import { assertConnectionRecord } from './schema';

interface ConnectionStoreFile { version: 1; updatedAt: string; connections: Record<string, ConnectionRecord>; }
type NewConnection = Omit<ConnectionRecord, 'id' | 'schemaVersion' | 'createdAt' | 'updatedAt'> & Partial<Pick<ConnectionRecord, 'id'>>;

export class ConnectionStore {
  private readonly filePath: string;
  private data: ConnectionStoreFile;
  constructor(configDir: string, fileName = 'connections-v2.json') { this.filePath = path.join(configDir, fileName); this.data = this.load(); }

  create(input: NewConnection): ConnectionRecord {
    const now = new Date().toISOString();
    const record: ConnectionRecord = { ...input, id: input.id ?? `connection_${randomUUID()}`, schemaVersion: CONNECTION_SCHEMA_VERSION, createdAt: now, updatedAt: now };
    assertConnectionRecord(record);
    if (this.data.connections[record.id]) throw new Error(`Connection already exists: ${record.id}`);
    this.data.connections[record.id] = record; this.save(); return structuredClone(record);
  }
  upsert(input: NewConnection): ConnectionRecord {
    if (input.id && this.data.connections[input.id]) return this.update(input.id, input);
    const existing = Object.values(this.data.connections).find((item) => item.serviceId === input.serviceId && item.pluginId === input.pluginId && item.strategyId === input.strategyId);
    return existing ? this.update(existing.id, input) : this.create(input);
  }
  get(id: string): ConnectionRecord | undefined { const value = this.data.connections[id]; return value ? structuredClone(value) : undefined; }
  findByService(serviceId: string): ConnectionRecord[] { return structuredClone(Object.values(this.data.connections).filter((item) => item.serviceId === serviceId)); }
  list(filter?: { pluginId?: string; health?: ConnectionRecord['health']; enabled?: boolean }): ConnectionRecord[] {
    let items = Object.values(this.data.connections);
    if (filter?.pluginId) items = items.filter((item) => item.pluginId === filter.pluginId);
    if (filter?.health) items = items.filter((item) => item.health === filter.health);
    if (filter?.enabled !== undefined) items = items.filter((item) => item.enabled === filter.enabled);
    return structuredClone(items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  update(id: string, patch: Partial<Omit<ConnectionRecord, 'id' | 'schemaVersion' | 'createdAt'>>): ConnectionRecord {
    const current = this.data.connections[id]; if (!current) throw new Error(`Unknown connection: ${id}`);
    const next: ConnectionRecord = { ...current, ...patch, id, schemaVersion: CONNECTION_SCHEMA_VERSION, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
    assertConnectionRecord(next); this.data.connections[id] = next; this.save(); return structuredClone(next);
  }
  delete(id: string): boolean { if (!this.data.connections[id]) return false; delete this.data.connections[id]; this.save(); return true; }

  private load(): ConnectionStoreFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, updatedAt: new Date().toISOString(), connections: {} };
    try { const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as ConnectionStoreFile; if (parsed.version !== 1 || typeof parsed.connections !== 'object') throw new Error('Unsupported connection store format'); for (const item of Object.values(parsed.connections)) assertConnectionRecord(item); return parsed; }
    catch (error) { throw new Error(`Failed to load connections from ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); this.data.updatedAt = new Date().toISOString();
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8'); fs.renameSync(temp, this.filePath); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
}
