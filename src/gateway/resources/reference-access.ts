import { getConfig } from '../../config/config';
import { getReferenceService } from './reference-service';
import { currentTeamReferenceScope, bindOpenedTeamReference } from './reference-team-runtime';
import { currentTrace } from '../observability/turn-trace';

/** Grant scope is installed only by actual server team entrypoints, never a session-name/actor lookup. */
export function referenceAccess(workspace: string, sessionId?: string) {
  const team = currentTeamReferenceScope(sessionId);
  if (team) {
    const trace = currentTrace();
    if (!trace || trace.sessionId !== sessionId || !['team_subagent','team_manager','background_task'].includes(String(trace.executionMode))) throw new Error('Shared reference access requires a trusted team turn');
    const {getManagedTeam}=require('../teams/managed-teams') as typeof import('../teams/managed-teams');
    if (!getManagedTeam(team.teamId)) throw new Error('Shared reference team unavailable');
    return { service: getReferenceService(getConfig().getWorkspacePath()), team };
  }
  const { assertPersonalReferenceCaller } = require('./reference-library') as typeof import('./reference-library');
  assertPersonalReferenceCaller(sessionId); return { service: getReferenceService(workspace), team: undefined };
}
export function accessibleReferenceOpen(workspace: string, sessionId: string | undefined, id: string, options: { versionId?: string; offset?: number; limit?: number } = {}) {
  const access = referenceAccess(workspace,sessionId);
  const selected = access.team ? bindOpenedTeamReference(sessionId,id) : undefined;
  if (access.team && !selected) throw new Error('Shared reference unavailable');
  if (selected && options.versionId && options.versionId !== selected.versionId) throw new Error('Selected reference version mismatch');
  const { openReference } = require('./reference-library') as typeof import('./reference-library');
  const result = openReference(access.service,id,{...options,versionId:selected?.versionId || options.versionId});
  if (access.team) {
    const sharing=access.service.metadata.sharing(); sharing.validate(access.team.teamId,[selected!]);
    result.reference={...result.reference,sourceSession:undefined,sourceMessage:undefined,relatedIds:(result.reference.relatedIds || []).filter((r:string)=>!!sharing.authorized(access.team!.teamId,r)),visibility:'team',shared:true};
  }
  return result;
}
export function accessibleReferenceSearch(workspace: string, sessionId: string | undefined, query: string, limit=10) {
  const {service,team}=referenceAccess(workspace,sessionId);
  const words=query.toLowerCase().split(/\s+/).filter(Boolean).slice(0,12);
  let refs;
  if (team) {
    const sharing=service.metadata.sharing();
    const ids=new Set<string>();
    for(const grant of sharing.grants(team.teamId)) { for(const id of grant.targetKind==='reference'?[grant.targetId]:sharing.members(grant.targetId)) ids.add(id); }
    refs=[...ids].map(id=>service.metadata.get(id)).filter((r): r is NonNullable<typeof r>=>!!r && !!sharing.authorized(team.teamId,r.id));
    refs=refs.filter(r=>words.every(w=>[r.title,r.userQuote,r.interpretation,r.notes,r.searchText].join(' ').toLowerCase().includes(w))).slice(0,Math.max(1,Math.min(20,limit)));
  } else refs=service.metadata.list({query,limit:Math.max(1,Math.min(20,limit))});
  return refs.map(r=>({id:r.id,title:r.title,userQuote:r.userQuote,interpretation:r.interpretation,status:r.status,versionId:r.versionId,createdAt:r.createdAt,...(!team?{sourceSession:r.sourceSession}:{})}));
}
