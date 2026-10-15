import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { z } from 'zod';

const identifier = z.string().regex(/^[a-zA-Z0-9_.:-]+$/);
const host = z.string().refine((v) => v === '*' || (/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(v) && !v.includes('..')), 'Expected an exact hostname');
const filePath = z.string().min(1).refine((v) => !/[\x00*?]/.test(v) && path.isAbsolute(v) && path.parse(path.resolve(v)).root !== path.resolve(v), 'Expected a non-root absolute path without globs');
export const PluginPermissionsSchema = z.object({
  network: z.object({ hosts: z.array(host), allowWildcardHosts: z.boolean().optional() }).strict().refine((v) => !v.hosts.includes('*') || v.allowWildcardHosts === true, 'Wildcard hosts require allowWildcardHosts: true').optional(),
  filesystem: z.object({ read: z.array(filePath).optional(), write: z.array(filePath).optional() }).strict().optional(),
  tools: z.array(identifier).optional(),
  secrets: z.array(identifier).optional(),
  sideEffects: z.enum(['none', 'read', 'write', 'external']).optional(),
}).strict();
export type PluginPermissions = z.infer<typeof PluginPermissionsSchema>;
export interface PermissionManifest { id?: string; permissions?: PluginPermissions }
export function validatePluginPermissions(value: unknown): PluginPermissions { return PluginPermissionsSchema.parse(value); }
export type PluginPermissionRequest =
  | { kind: 'network'; url: string }
  | { kind: 'tool'; name: string }
  | { kind: 'secret'; name: string }
  | { kind: 'filesystem'; operation: 'read' | 'write'; path: string }
  | { kind: 'sideEffect'; level: 'none' | 'read' | 'write' | 'external' };
const warned = new Set<string>();
const context = new AsyncLocalStorage<PermissionManifest>();
export function withPluginPermissions<T>(manifest: PermissionManifest, fn: () => T): T { return context.run(manifest, fn); }
export function assertCurrentPluginPermission(request: PluginPermissionRequest): void {
  assertPluginPermission(context.getStore(), request);
}
export function assertPluginPermission(manifest: PermissionManifest | undefined, request: PluginPermissionRequest): void {
  if (!manifest?.permissions) {
    const id = manifest?.id || 'unknown';
    if (!warned.has(id)) { warned.add(id); console.warn(`[extensions] ${id}: missing permission manifest; legacy unrestricted mode`); }
    return;
  }
  const p = validatePluginPermissions(manifest.permissions);
  let allowed = false;
  switch (request.kind) {
    case 'network': {
      const url = new URL(request.url);
      allowed = ['https:', 'http:'].includes(url.protocol) && !!p.network?.hosts.some((h) => h === '*' || h.toLowerCase() === url.hostname.toLowerCase());
      break;
    }
    // Omitted tools means all tools owned by this extension; [] denies all.
    case 'tool': allowed = p.tools === undefined || p.tools.includes(request.name); break;
    case 'secret': allowed = !!p.secrets?.includes(request.name); break;
    case 'filesystem': allowed = !!p.filesystem?.[request.operation]?.some((root) => {
      const relative = path.relative(path.resolve(root), path.resolve(request.path));
      return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    }); break;
    case 'sideEffect': {
      const levels = ['none', 'read', 'write', 'external'];
      allowed = levels.indexOf(request.level) <= levels.indexOf(p.sideEffects || 'none');
      break;
    }
  }
  if (!allowed) throw new Error(`Plugin ${manifest.id || 'unknown'} permission denied: ${request.kind}`);
}
