import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getResourceStore } from './resource-store';
import { resolveConfinedStoragePath } from '../storage/storage-paths';
import { ResourceStore, AttachResourceResult } from './resource-store';
import { ReferenceStore, SavedReference, ReferenceBinding, AUTOMATIC_REFERENCE_CAPTURE_READY } from './reference-store';

/** Gateway-internal Stage A API. Not exposed to model/HTTP callers until access controls ship. */
export class ReferenceService {
  constructor(readonly resources: ResourceStore, readonly metadata: ReferenceStore) {
    if (resources.rootDir !== metadata.rootDir || resources.workspaceScope !== metadata.workspace) throw new Error('Reference store scope mismatch');
    if (metadata.writable) {
      metadata.recover(binding => Boolean(resources.referenceVersion(binding.resourceId, binding.versionId, true)));
    }
  }

  saveExisting(input: {
    operationId: string; binding: ReferenceBinding; title: string; dependencies?: ReferenceBinding[];
    sourceSession?: string; sourceMessage?: string; userQuote?: string; interpretation?: string;
  }): SavedReference {
    this.metadata.assertWriter();
    const existing = this.metadata.findByOperation(input.operationId);
    if (existing) {
      if (existing.resourceId !== input.binding.resourceId || existing.versionId !== input.binding.versionId) throw new Error('Capture operation already saved different evidence');
      return existing;
    }
    if (this.metadata.blocksResource(input.binding.resourceId) || (input.dependencies || []).some(binding => this.metadata.blocksResource(binding.resourceId))) throw new Error('This source was excluded from reference capture');
    const bindings = [input.binding, ...(input.dependencies || [])];
    if (!bindings.every(item => this.resources.referenceVersion(item.resourceId, item.versionId))) throw new Error('Saved evidence is unavailable or sensitive');
    const pending = this.metadata.pendingOperation(input.operationId);
    if (pending) {
      if (pending.reference.resourceId !== input.binding.resourceId || pending.reference.versionId !== input.binding.versionId) throw new Error('Pending capture binds different evidence');
      if (!pending.bindings.every(binding => this.resources.referenceVersion(binding.resourceId, binding.versionId))) throw new Error('Pending evidence unavailable; retained for recovery');
      this.persistBindings(pending.bindings);
      return this.metadata.complete(input.operationId);
    }
    const reference: SavedReference = {
      id: `ref_${crypto.createHash('sha256').update(`${this.metadata.workspace}\0${input.operationId}`).digest('hex').slice(0, 32)}`,
      operationId: input.operationId, workspace: this.metadata.workspace, ...input.binding,
      title: input.title.slice(0, 500), sourceSession: input.sourceSession, sourceMessage: input.sourceMessage,
      userQuote: input.userQuote?.slice(0, 16000), interpretation: input.interpretation?.slice(0, 16000),
      status: 'saved', createdAt: new Date().toISOString(),
    };
    // This is synchronous: scheduled ResourceStore flush cannot run between attach and pending pin.
    this.metadata.prepare(reference, bindings);
    this.persistBindings(bindings);
    const saved = this.metadata.complete(input.operationId);
    try {
      const content = this.resources.referenceContent(saved.resourceId, saved.versionId);
      if (content.version.snapshotKind === 'text') this.metadata.update(saved.id, { searchText: content.bytes.toString('utf8').slice(0, 24000) });
    } catch { /* The saved evidence remains usable if indexing is unavailable. */ }
    return saved;
  }

  saveText(input: { operationId: string; title: string; content: string; userQuote?: string; sourceSession?: string }): SavedReference {
    const existing = this.metadata.findByOperation(input.operationId); if (existing) return existing;
    const attached = this.resources.attach({ kind: 'file', title: input.title, mimeType: 'text/plain', origin: 'user_upload',
      locator: { type: 'artifact', canonical: `reference-note:${input.operationId}` }, snapshotKind: 'text', content: input.content.slice(0, 100000) });
    if (!attached.version) throw new Error('No note snapshot created');
    return this.saveExisting({ ...input, binding: { resourceId: attached.resource.id, versionId: attached.version.id } });
  }

  private persistBindings(bindings: ReferenceBinding[]): void {
    for (const binding of bindings) {
      const version = this.resources.referenceVersion(binding.resourceId, binding.versionId)!;
      const fd = fs.openSync(resolveConfinedStoragePath(this.resources.rootDir, version.snapshotPath!, { label: 'reference snapshot' }), 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    this.resources.flushSync();
    const registryFd = fs.openSync(path.join(this.resources.rootDir, 'registry.json'), 'r+');
    try { fs.fsyncSync(registryFd); } finally { fs.closeSync(registryFd); }
  }

  saveAttachment(input: { operationId: string; filePath: string; title?: string; mimeType?: string; sourceSession?: string; userQuote?: string }): SavedReference {
    this.metadata.assertWriter();
    const existing = this.metadata.findByOperation(input.operationId);
    if (existing) return existing;
    if (this.metadata.pendingOperation(input.operationId)) throw new Error('Capture is pending recovery; original evidence has not been discarded');
    const attached: AttachResourceResult = this.resources.attachFile({ filePath: input.filePath, title: input.title, mimeType: input.mimeType, threadId: input.sourceSession });
    if (!attached.version) throw new Error('No immutable attachment snapshot created');
    return this.saveExisting({ ...input, title: input.title || attached.resource.title, binding: { resourceId: attached.resource.id, versionId: attached.version.id } });
  }

  saveAnalysis(input: { operationId: string; manifestPath: string; sourceSession?: string }): SavedReference {
    this.metadata.assertWriter();
    const existing = this.metadata.findByOperation(input.operationId);
    if (existing) return existing;
    const manifestPath = resolveConfinedStoragePath(this.resources.workspaceScope, input.manifestPath, { label: 'analysis manifest' });
    if (fs.statSync(manifestPath).size > 2 * 1024 * 1024) throw new Error('Analysis manifest exceeds size limit');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.coverage !== 'sampled_frames' || !Array.isArray(manifest.files)) throw new Error('Unsupported analysis manifest');
    const sourcePath = resolveConfinedStoragePath(this.resources.workspaceScope, manifest.source.path, { label: 'analysis source' });
    if (fs.statSync(sourcePath).size > 100 * 1024 * 1024) throw new Error('Original video exceeds reference snapshot limit; not saved or discarded');
    const bytes = fs.readFileSync(sourcePath);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.source.sha256) throw new Error('Analysis source no longer matches examined version');
    if (manifest.files.length > 160) throw new Error('Analysis manifest has too many files');
    const artifactRoot = resolveConfinedStoragePath(this.resources.rootDir, path.join('content', 'analysis', crypto.createHash('sha256').update(input.operationId).digest('hex')), { label: 'analysis archive' });
    fs.mkdirSync(artifactRoot, { recursive: true });
    const archivedFiles: any[] = [];
    let totalBytes = 0;
    for (const file of manifest.files) {
      const actual = resolveConfinedStoragePath(this.resources.workspaceScope, file.path, { label: 'analysis evidence' });
      totalBytes += fs.statSync(actual).size;
      if (totalBytes > 100 * 1024 * 1024) throw new Error('Analysis archive exceeds storage budget; original outputs retained');
      const data = fs.readFileSync(actual);
      const digest = crypto.createHash('sha256').update(data).digest('hex');
      if (digest !== file.sha256) throw new Error('Analysis evidence changed');
      const archived = resolveConfinedStoragePath(artifactRoot, digest, { label: 'analysis blob' });
      if (!fs.existsSync(archived)) {
        const fd = fs.openSync(archived, 'wx', 0o600);
        try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      if (crypto.createHash('sha256').update(fs.readFileSync(archived)).digest('hex') !== digest) throw new Error('Incomplete archived blob; retained for recovery');
      archivedFiles.push({ ...file, path: path.relative(this.resources.rootDir, archived).replace(/\\/g, '/'), pathRoot: 'resources' });
    }
    // One run resource, not a registry record per frame. Original size limits fail visibly.
    const source = this.resources.attachFile({ filePath: sourcePath, mimeType: path.extname(sourcePath).toLowerCase() === '.mp4' ? 'video/mp4' : 'application/octet-stream', threadId: input.sourceSession });
    const run = this.resources.attach({ kind: 'artifact', title: `Analysis ${manifest.runId}`, mimeType: 'application/json', origin: 'tool_observation',
      locator: { type: 'artifact', canonical: `analysis:${input.operationId}` }, snapshotKind: 'text',
      content: JSON.stringify({ ...manifest, files: archivedFiles, sourceBinding: { resourceId: source.resource.id, versionId: source.version?.id } }),
    });
    if (!source.version || !run.version) throw new Error('Analysis snapshots unavailable');
    return this.saveExisting({ operationId: input.operationId, title: run.resource.title, sourceSession: input.sourceSession,
      binding: { resourceId: run.resource.id, versionId: run.version.id },
      userQuote: manifest.analysisPrompt,
      dependencies: [{ resourceId: source.resource.id, versionId: source.version.id }],
    });
  }
}

const services = new Map<string, ReferenceService>();
const metadataWriters = new Map<string, ReferenceStore>();
export function getReferenceService(workspace: string): ReferenceService {
  const resources = getResourceStore(workspace);
  const key = `${resources.rootDir}\0${resources.workspaceScope}`;
  let service = services.get(key);
  if (!service) {
    let owner = metadataWriters.get(resources.rootDir);
    if (!owner) {
      owner = new ReferenceStore(resources.rootDir, resources.workspaceScope);
      const writer = owner; process.once('exit', () => writer.close()); // release the lock on normal shutdown
      metadataWriters.set(resources.rootDir, owner);
    }
    const metadata = owner.workspace === resources.workspaceScope ? owner
      : new ReferenceStore(resources.rootDir, resources.workspaceScope, { owner });
    service = new ReferenceService(resources, metadata);
    services.set(key, service);
  }
  return service;
}

/** Forward-looking owner opt-in, stored with the canonical library metadata. */
export function automaticReferenceCaptureReady(workspace?: string): boolean {
  // Calls without a workspace remain off for backwards compatibility and health checks.
  if (!workspace || !fs.existsSync(path.join(getResourceStore(workspace).rootDir, 'references.sqlite'))) return false;
  try { return getReferenceService(workspace).metadata.settings().capture; } catch { return false; }
}
