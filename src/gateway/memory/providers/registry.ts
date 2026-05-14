import { createSqliteLocalMemoryProvider } from './sqlite-local-provider';
import type { MemoryProvider } from './types';

function createStubProvider(id: string, label: string, reason: string): MemoryProvider {
  return {
    id,
    label,
    capabilities: {
      search: false,
      read: false,
      write: false,
      sync: false,
      vectorSearch: false,
      graph: false,
    },
    async status() {
      return {
        id,
        label,
        ok: false,
        reason,
        capabilities: this.capabilities,
      };
    },
  };
}

export function listMemoryProviders(workspacePath: string): MemoryProvider[] {
  return [
    createSqliteLocalMemoryProvider(workspacePath),
    createStubProvider('obsidian', 'Obsidian memory evidence', 'Available through the Obsidian connector sync path; not yet a standalone search backend.'),
    createStubProvider('external-vector', 'External vector memory', 'Adapter slot reserved for Qdrant/LanceDB/Chroma-style stores.'),
    createStubProvider('cloud-memory', 'Cloud memory', 'Adapter slot reserved for hosted memory providers.'),
  ];
}

export async function getMemoryProviderStatus(workspacePath: string) {
  return await Promise.all(listMemoryProviders(workspacePath).map(provider => provider.status()));
}

export function getPrimaryMemoryProvider(workspacePath: string): MemoryProvider {
  return createSqliteLocalMemoryProvider(workspacePath);
}
