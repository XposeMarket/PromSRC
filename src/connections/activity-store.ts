import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ConnectionActivity } from './types';

interface ActivityStoreFile { version: 1; updatedAt: string; activities: ConnectionActivity[]; }

export class ConnectionActivityStore {
  private readonly filePath: string;
  private data: ActivityStoreFile;
  constructor(configDir: string, fileName = 'connection-activity.json', private readonly maxEntries = 5000) { this.filePath = path.join(configDir, fileName); this.data = this.load(); }

  append(input: Omit<ConnectionActivity, 'id' | 'at'> & Partial<Pick<ConnectionActivity, 'id' | 'at'>>): ConnectionActivity {
    const activity: ConnectionActivity = { ...input, id: input.id ?? `conn_activity_${randomUUID()}`, at: input.at ?? new Date().toISOString() };
    this.data.activities.push(activity);
    if (this.data.activities.length > this.maxEntries) this.data.activities.splice(0, this.data.activities.length - this.maxEntries);
    this.save(); return structuredClone(activity);
  }
  list(filter?: { attemptId?: string; connectionId?: string; serviceId?: string; type?: string; limit?: number; before?: string }): ConnectionActivity[] {
    let items = this.data.activities;
    if (filter?.attemptId) items = items.filter((item) => item.attemptId === filter.attemptId);
    if (filter?.connectionId) items = items.filter((item) => item.connectionId === filter.connectionId);
    if (filter?.serviceId) items = items.filter((item) => item.serviceId === filter.serviceId);
    if (filter?.type) items = items.filter((item) => item.type === filter.type);
    if (filter?.before) items = items.filter((item) => item.at < filter.before!);
    const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at));
    return structuredClone(sorted.slice(0, filter?.limit ?? 100));
  }
  clear(): void { this.data.activities = []; this.save(); }

  private load(): ActivityStoreFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, updatedAt: new Date().toISOString(), activities: [] };
    try { const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as ActivityStoreFile; if (parsed.version !== 1 || !Array.isArray(parsed.activities)) throw new Error('Unsupported activity store format'); return parsed; }
    catch (error) { throw new Error(`Failed to load connection activity from ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); this.data.updatedAt = new Date().toISOString();
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8'); fs.renameSync(temp, this.filePath); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
}
