import {
  getMemoryGraphSnapshot,
  getRelatedMemory,
  readMemoryRecord,
  refreshMemoryIndexFromAudit,
  searchMemoryIndexAsync,
} from '../../memory-index';
import { getSqliteMemoryStatus } from '../../memory-index/sqlite-store';
import type { MemoryProvider } from './types';

export function createSqliteLocalMemoryProvider(workspacePath: string): MemoryProvider {
  return {
    id: 'sqlite-local',
    label: 'SQLite local memory',
    capabilities: {
      search: true,
      read: true,
      write: false,
      sync: true,
      vectorSearch: true,
      graph: true,
    },

    async status() {
      const status = getSqliteMemoryStatus(workspacePath);
      return {
        id: this.id,
        label: this.label,
        ok: status.available,
        reason: status.error,
        records: status.records,
        chunks: status.chunks,
        indexedAt: status.indexedAt,
        capabilities: this.capabilities,
      };
    },

    async sync(options) {
      try {
        const result = refreshMemoryIndexFromAudit(workspacePath, {
          force: options?.force,
          maxChangedFiles: options?.limit || 500,
          minIntervalMs: 0,
        });
        return {
          ok: true,
          providerId: this.id,
          indexed: result.indexedFiles,
          updated: result.totalRecords,
          skipped: result.skippedFiles,
        };
      } catch (err: any) {
        return { ok: false, providerId: this.id, error: String(err?.message || err) };
      }
    },

    async search(query) {
      return await searchMemoryIndexAsync(workspacePath, query);
    },

    async read(recordId) {
      return readMemoryRecord(workspacePath, recordId);
    },

    async related(recordId, limit) {
      return getRelatedMemory(workspacePath, recordId, limit);
    },

    async graph() {
      return getMemoryGraphSnapshot(workspacePath);
    },
  } as MemoryProvider & { graph: () => Promise<any> };
}
