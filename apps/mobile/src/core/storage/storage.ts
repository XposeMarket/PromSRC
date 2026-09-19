export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class BrowserKeyValueStorage implements KeyValueStorage {
  constructor(private readonly storage: Storage) {}
  get(key: string): string | null { return this.storage.getItem(key); }
  set(key: string, value: string): void { this.storage.setItem(key, value); }
  remove(key: string): void { this.storage.removeItem(key); }
}

export class MemoryKeyValueStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  remove(key: string): void { this.values.delete(key); }
}
