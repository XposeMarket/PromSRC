import { randomUUID } from 'node:crypto';
import type { ConnectionStore } from './connection-store.js';
import type { SecureInputService } from './secure-input-service.js';
import { bindPluginCredential } from './plugin-credential-binding.js';

/** Copy only after explicit owner confirmation; retain the original credential on every path. */
export function adoptLegacyKeyAccount(directory: string, store: ConnectionStore, secure: SecureInputService,
  id: string, ownerId: string, fields: Record<string,string>): string {
  const record=store.get(id);
  if(!record || record.serviceId!=='vercel' || !ownerId || !fields.apiKey)throw new Error('ACCOUNT_UNAVAILABLE');
  if(record.accountAccess){if(record.accountAccess.ownerId!==ownerId)throw new Error('ACCOUNT_UNAVAILABLE');return id;}
  const attemptId=`adopt_${randomUUID()}`;
  const session=secure.create({serviceId:'vercel',attemptId,connectionId:id,
    fields:[{key:'apiKey',label:'API Token',required:true,secret:true},{key:'teamId',label:'Team',secret:true},{key:'projectId',label:'Project',secret:true}]});
  const saved=secure.submit(session.id,fields);
  try{
    bindPluginCredential(directory,'vercel',saved.credentialRef,attemptId,id);
    store.update(id,{credentialRef:saved.credentialRef,contractVersion:2,
      accountAccess:{ownerId,label:record.account?.email || record.serviceName || 'Vercel',family:'connector',instanceId:id,generation:1,policyRevision:1,grants:[]}});
  }catch(error){
    secure.clearReference(saved.credentialRef,'vercel',attemptId,{connectionId:id});
    throw error;
  }
  return id;
}
