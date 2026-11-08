import crypto from 'crypto';
import type { SavedReference, ReferenceBinding } from './reference-store';

export interface ReferenceCollection { id: string; title: string; purpose: string; updatedAt: string }
export interface ReferenceGrant { id: string; teamId: string; targetKind: 'reference' | 'collection'; targetId: string; createdAt: string; revokedAt?: string; required?: boolean; purpose?: string }
export interface SelectedReferenceBinding extends ReferenceBinding { referenceId: string; grantId: string; purpose: string; required: boolean; anchor?: string }

/** One database/one writer: collection/grant metadata shares the existing library lock. */
export function migrateReferenceSharing(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reference_collections (workspace TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(workspace,id));
    CREATE TABLE IF NOT EXISTS reference_collection_members (workspace TEXT NOT NULL, collection_id TEXT NOT NULL, reference_id TEXT NOT NULL, PRIMARY KEY(workspace,collection_id,reference_id));
    CREATE TABLE IF NOT EXISTS reference_grants (workspace TEXT NOT NULL, id TEXT NOT NULL, team_id TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(workspace,id));
    CREATE INDEX IF NOT EXISTS reference_grants_team ON reference_grants(workspace,team_id);
    CREATE TABLE IF NOT EXISTS reference_session_bindings (workspace TEXT NOT NULL, team_id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(workspace,team_id,session_id));
  `);
}

export class ReferenceSharingStore {
  constructor(private db: any, private workspace: string, private assertWriter: () => void, private getReference: (id: string) => SavedReference | undefined) {}
  private key(value: string): string { if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid sharing identifier'); return value; }
  private available(id: string): SavedReference { const ref = this.getReference(this.key(id)); if (!ref || ref.deleted || ref.excluded) throw new Error('Reference unavailable'); return ref; }
  collections(): ReferenceCollection[] { return this.db.prepare('SELECT data FROM reference_collections WHERE workspace=? ORDER BY rowid DESC LIMIT 200').all(this.workspace).map((r: { data: string }) => JSON.parse(r.data)); }
  collection(id: string): ReferenceCollection | undefined { const row = this.db.prepare('SELECT data FROM reference_collections WHERE workspace=? AND id=?').get(this.workspace, this.key(id)); return row ? JSON.parse(row.data) : undefined; }
  saveCollection(input: { id?: string; title: string; purpose?: string }): ReferenceCollection {
    this.assertWriter(); const id = input.id ? this.key(input.id) : crypto.randomUUID();
    if (input.id && !this.collection(id)) throw new Error('Collection unavailable');
    if (!String(input.title || '').trim()) throw new Error('Collection title required');
    if (!input.id && this.collections().length >= 200) throw new Error('Collection limit reached');
    const value = { id, title: input.title.trim().slice(0, 500), purpose: String(input.purpose || '').slice(0, 4000), updatedAt: new Date().toISOString() };
    this.db.prepare('INSERT OR REPLACE INTO reference_collections VALUES (?,?,?)').run(this.workspace, id, JSON.stringify(value)); return value;
  }
  members(id: string): string[] { if (!this.collection(id)) throw new Error('Collection unavailable'); return this.db.prepare('SELECT reference_id FROM reference_collection_members WHERE workspace=? AND collection_id=? ORDER BY rowid LIMIT 200').all(this.workspace, id).map((r: { reference_id: string }) => r.reference_id); }
  setMember(collectionId: string, referenceId: string, add: boolean, acknowledgeSharedAudience = false): void {
    this.assertWriter(); const members = this.members(collectionId); this.key(referenceId);
    if (add) {
      this.available(referenceId);
      if (this.grants().some(g => g.targetKind === 'collection' && g.targetId === collectionId) && !acknowledgeSharedAudience) throw new Error('Adding to a shared collection requires explicit audience confirmation');
      if (members.length >= 200 && !members.includes(referenceId)) throw new Error('Collection member limit reached');
      this.db.prepare('INSERT OR IGNORE INTO reference_collection_members VALUES (?,?,?)').run(this.workspace, collectionId, referenceId);
    } else this.db.prepare('DELETE FROM reference_collection_members WHERE workspace=? AND collection_id=? AND reference_id=?').run(this.workspace, collectionId, referenceId);
  }
  deleteCollection(id: string): void {
    this.assertWriter(); this.key(id); this.db.transaction(() => {
      for (const grant of this.grants().filter(g => g.targetKind === 'collection' && g.targetId === id)) this.revoke(grant.id);
      this.db.prepare('DELETE FROM reference_collection_members WHERE workspace=? AND collection_id=?').run(this.workspace, id);
      this.db.prepare('DELETE FROM reference_collections WHERE workspace=? AND id=?').run(this.workspace, id);
    })();
  }
  grants(teamId?: string): ReferenceGrant[] {
    const rows = teamId ? this.db.prepare('SELECT data FROM reference_grants WHERE workspace=? AND team_id=?').all(this.workspace, this.key(teamId)) : this.db.prepare('SELECT data FROM reference_grants WHERE workspace=?').all(this.workspace);
    return rows.map((r: { data: string }) => JSON.parse(r.data) as ReferenceGrant).filter((g: ReferenceGrant) => !g.revokedAt);
  }
  grant(teamId: string, targetKind: 'reference' | 'collection', targetId: string, guidance: { required?: boolean; purpose?: string } = {}): ReferenceGrant {
    this.assertWriter(); this.key(teamId); this.key(targetId);
    if (targetKind === 'reference') this.available(targetId); else if (targetKind !== 'collection' || !this.collection(targetId)) throw new Error('Collection unavailable');
    const existing = this.grants(teamId).find(g => g.targetKind === targetKind && g.targetId === targetId); if (existing) return existing;
    const value = { id: crypto.randomUUID(), teamId, targetKind, targetId, createdAt: new Date().toISOString(), required: guidance.required === true, purpose: String(guidance.purpose || '').slice(0,4000) };
    this.db.prepare('INSERT INTO reference_grants VALUES (?,?,?,?,?,?)').run(this.workspace, value.id, teamId, targetKind, targetId, JSON.stringify(value)); return value;
  }
  revoke(id: string): void {
    this.assertWriter(); this.key(id); const row = this.db.prepare('SELECT data FROM reference_grants WHERE workspace=? AND id=?').get(this.workspace, id); if (!row) return;
    const grant = JSON.parse(row.data); grant.revokedAt = new Date().toISOString(); this.db.prepare('UPDATE reference_grants SET data=? WHERE workspace=? AND id=?').run(JSON.stringify(grant), this.workspace, id);
  }
  authorized(teamId: string, referenceId: string, grantId?: string): ReferenceGrant | undefined {
    const ref = this.getReference(referenceId); if (!ref || ref.deleted || ref.excluded) return undefined;
    return this.grants(teamId).find(g => (!grantId || g.id === grantId) && (g.targetKind === 'reference' ? g.targetId === referenceId : this.members(g.targetId).includes(referenceId)));
  }
  select(teamId: string, referenceId: string, purpose: string): SelectedReferenceBinding {
    const grant = this.authorized(teamId, referenceId); if (!grant) throw new Error('Shared reference unavailable');
    const ref = this.available(referenceId); return { referenceId, resourceId: ref.resourceId, versionId: ref.versionId, grantId: grant.id, purpose: String(grant.purpose || purpose || ref.userQuote || '').slice(0,4000), required: grant.required === true };
  }
  validate(teamId: string, bindings: SelectedReferenceBinding[]): void {
    if (bindings.length > 30) throw new Error('At most 30 selected references per task');
    for (const b of bindings) { const ref = this.getReference(b.referenceId); if (!this.authorized(teamId, b.referenceId, b.grantId) || ref?.resourceId !== b.resourceId || ref?.versionId !== b.versionId) throw new Error('Selected reference unavailable or permission revoked'); }
  }
  /** Write BEFORE the canonical task selection; retries are idempotent, never expire by age. */
  retainTask(taskId: string, teamId: string, bindings: SelectedReferenceBinding[]): void {
    this.assertWriter(); this.key(taskId);
    // A revoked grant blocks NEW retention/access, not persistence of an already-held task's failure or pause state.
    const held = new Set(this.db.prepare('SELECT version_id FROM version_pins WHERE holder_kind=? AND holder_id=?').all('task', `${this.workspace}:${taskId}`).map((r: {version_id:string})=>r.version_id));
    this.validate(teamId, bindings.filter(b=>!held.has(b.versionId)));
    this.db.transaction(() => { for (const b of bindings) {
      const dependencies = this.db.prepare('SELECT version_id FROM version_pins WHERE holder_kind=? AND holder_id=?').all('reference',b.referenceId).map((r:{version_id:string})=>r.version_id);
      for (const versionId of new Set([b.versionId,...dependencies])) this.db.prepare('INSERT OR IGNORE INTO version_pins VALUES (?,?,?)').run(versionId, 'task', `${this.workspace}:${taskId}`);
    } })();
  }
  sessionBindings(teamId: string, sessionId: string): SelectedReferenceBinding[] { const row=this.db.prepare('SELECT data FROM reference_session_bindings WHERE workspace=? AND team_id=? AND session_id=?').get(this.workspace,this.key(teamId),this.key(sessionId)); return row ? JSON.parse(row.data) : []; }
  setSessionBindings(teamId: string, sessionId: string, bindings: SelectedReferenceBinding[]): void {
    this.assertWriter(); this.validate(teamId,bindings); const holder=`session:${teamId}:${this.key(sessionId)}`;
    this.db.transaction(()=>{ this.releaseTask(holder); this.retainTask(holder,teamId,bindings); this.db.prepare('INSERT OR REPLACE INTO reference_session_bindings VALUES (?,?,?,?)').run(this.workspace,teamId,sessionId,JSON.stringify(bindings)); })();
  }
  removeTeam(teamId:string):void {
    this.assertWriter(); this.key(teamId); this.db.transaction(()=>{
      for(const g of this.grants(teamId))this.revoke(g.id);
      const rows=this.db.prepare('SELECT session_id FROM reference_session_bindings WHERE workspace=? AND team_id=?').all(this.workspace,teamId);
      for(const row of rows)this.releaseTask(`session:${teamId}:${row.session_id}`);
      this.db.prepare('DELETE FROM reference_session_bindings WHERE workspace=? AND team_id=?').run(this.workspace,teamId);
    })();
  }
  /** Recovery only releases holders whose canonical task is proven missing/terminal; exceptions retain pins. */
  reconcileTaskPins(isFinished:(taskId:string)=>boolean):void {
    this.assertWriter(); const prefix=`${this.workspace}:`;
    for(const row of this.db.prepare('SELECT DISTINCT holder_id FROM version_pins WHERE holder_kind=?').all('task')) {
      if(!row.holder_id.startsWith(prefix))continue; const id=row.holder_id.slice(prefix.length); if(id.startsWith('session:'))continue;
      try {if(isFinished(id))this.releaseTask(id);}catch{ /* uncertain data is a retention root */ }
    }
  }
  /** Only a verified terminal/deleted canonical holder may release its leases. */
  releaseTask(taskId: string): void { this.assertWriter(); this.key(taskId); this.db.prepare('DELETE FROM version_pins WHERE holder_kind=? AND holder_id=?').run('task', `${this.workspace}:${taskId}`); }
}
