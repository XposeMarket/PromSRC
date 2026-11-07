import { Router } from 'express';
import { getConfig } from '../../config/config';
import { getReferenceService } from '../resources/reference-service';
import { getManagedTeam, listManagedTeams } from '../teams/managed-teams';

/** Mounted only behind gateway/account owner authentication; no model-provided owner/workspace. */
export const referenceSharingRouter = Router();
const store = () => getReferenceService(getConfig().getWorkspacePath()).metadata;
const route = (fn: (req: any) => unknown) => (req: any, res: any) => { try { res.json({ success: true, ...fn(req) as object }); } catch (e) { res.status(400).json({ success: false, error: e instanceof Error ? e.message : String(e) }); } };
const root = '/api/memory/reference-sharing';
referenceSharingRouter.get(root, route(() => {
  const metadata = store(), sharing = metadata.sharing();
  return { writable: metadata.writable, teams: listManagedTeams().map(t => ({ id: t.id, name: t.name })), collections: sharing.collections().map(c => ({ ...c, members: sharing.members(c.id) })), grants: sharing.grants() };
}));
referenceSharingRouter.post(`${root}/collections`, route(req => ({ collection: store().sharing().saveCollection({ title: String(req.body?.title || ''), purpose: String(req.body?.purpose || '') }) })));
referenceSharingRouter.patch(`${root}/collections/:id`, route(req => { const sharing = store().sharing(), old = sharing.collection(String(req.params.id)); if (!old) throw new Error('Collection unavailable'); return { collection: sharing.saveCollection({ ...old, title: req.body?.title === undefined ? old.title : String(req.body.title), purpose: req.body?.purpose === undefined ? old.purpose : String(req.body.purpose) }) }; }));
referenceSharingRouter.delete(`${root}/collections/:id`, route(req => { store().sharing().deleteCollection(String(req.params.id)); return {}; }));
referenceSharingRouter.post(`${root}/collections/:id/members`, route(req => { if (typeof req.body?.add !== 'boolean') throw new Error('add must be boolean'); store().sharing().setMember(String(req.params.id), String(req.body?.referenceId || ''), req.body.add, req.body?.acknowledgeSharedAudience === true); return {}; }));
referenceSharingRouter.post(`${root}/grants`, route(req => {
  const teamId = String(req.body?.teamId || ''); if (!getManagedTeam(teamId)) throw new Error('Existing team required');
  if(req.body?.required !== undefined && typeof req.body.required !== 'boolean') throw new Error('required must be boolean');
  return { grant: store().sharing().grant(teamId, req.body?.targetKind, String(req.body?.targetId || ''), {required:req.body?.required === true,purpose:String(req.body?.purpose || '')}) };
}));
referenceSharingRouter.delete(`${root}/grants/:id`, route(req => { store().sharing().revoke(String(req.params.id)); return {}; }));
