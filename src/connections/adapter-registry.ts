import { ConnectionAdapter, ConnectionStrategy } from './types';

export class ConnectionAdapterRegistry {
  private readonly adapters = new Map<string, ConnectionAdapter>();

  register(adapter: ConnectionAdapter): () => void {
    if (!adapter.id.trim()) throw new Error('Connection adapter id is required');
    if (this.adapters.has(adapter.id)) throw new Error(`Connection adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return () => { if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id); };
  }

  unregister(id: string): boolean { return this.adapters.delete(id); }
  get(id: string): ConnectionAdapter | undefined { return this.adapters.get(id); }
  list(): ConnectionAdapter[] { return [...this.adapters.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id)); }
  find(strategy: ConnectionStrategy): ConnectionAdapter[] { return this.list().filter((adapter) => adapter.supports(strategy)); }
  resolve(strategy: ConnectionStrategy): ConnectionAdapter {
    const exact = this.adapters.get(strategy.adapter);
    if (exact?.supports(strategy)) return exact;
    const match = this.find(strategy)[0];
    if (!match) throw new Error(`No connection adapter supports strategy ${strategy.id} (${strategy.adapter})`);
    return match;
  }
  clear(): void { this.adapters.clear(); }
}
