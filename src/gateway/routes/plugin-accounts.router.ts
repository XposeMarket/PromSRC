import { Router } from 'express';
import { publicConnectionValue } from '../../connections/serialize-public';
import { getConfig } from '../../config/config';
import { getConnectionRuntime } from '../../connections/runtime';
import { resolvePluginAccountOwner } from '../../connections/account-owner';
import { publicAccountView } from '../../connections/account-view';
import { accountFamilySupport } from '../../connections/account-family-support';
import { listExtensionDescriptors } from '../../extensions/registry';
function accountView(record: Parameters<typeof publicAccountView>[0]) {
  const descriptor = listExtensionDescriptors().find(item => item.id === record.pluginId);
  const support = accountFamilySupport(descriptor?.kind || record.accountAccess?.family || '', record.serviceId, record.adapterId);
  return { ...publicAccountView(record), canAddAccount: support.mode === 'account' || support.mode === 'instance', addAccountUnavailableReason: support.reason };
}
import { getCurrentUserId, hasAccountSession } from './account.router';
import { requirePluginSetup } from './plugin-setup-access';
import { requireProtectedOwner, ownerSurfaceState } from './secure-access.router';

export const pluginAccountsRouter = Router();
pluginAccountsRouter.use((req,res,next)=>{
  if(req.path.startsWith('/api/plugin-accounts/')) {
    const json=res.json.bind(res);
    res.json=(body:any)=>json(publicConnectionValue(body));
  }
  next();
});
function owner(): string {
  const user = getCurrentUserId();
  // An expired signed-in session must not silently switch to the local owner.
  if (!user && hasAccountSession()) throw new Error('ACCOUNT_SESSION_EXPIRED');
  return resolvePluginAccountOwner(getConfig().getConfigDir(), user);
}
function owned(id: string) {
  const runtime = getConnectionRuntime(); const ownerId = owner();
  const record = runtime.connections.get(id);
  if (!record?.accountAccess || record.accountAccess.ownerId !== ownerId) throw new Error('ACCOUNT_UNAVAILABLE');
  return { runtime, ownerId, record };
}
// Protected POST reads avoid exposing identities through originless agent HTTP fetches.
pluginAccountsRouter.post('/api/plugin-accounts/list', requirePluginSetup, (req, res) => {
  try { const ownerId=owner(); res.json({success:true,canManageLegacyAccounts:ownerSurfaceState(req).canApprove,creatableServices:listExtensionDescriptors().filter(item=>item.kind==='connector' && accountFamilySupport(item.kind,item.id).mode==='account').map(item=>item.id),accounts:getConnectionRuntime().connections.list().filter(record=>record.accountAccess?.ownerId===ownerId).map(accountView)}); }
  catch {res.status(403).json({success:false,error:'ACCOUNT_UNAVAILABLE'});}
});
pluginAccountsRouter.post('/api/plugin-accounts/:id/rename', requirePluginSetup, (req,res)=>{
  try {const {runtime,ownerId}=owned(req.params.id);const label=req.body?.label;if(typeof label!=='string')throw new Error();res.json({success:true,account:publicAccountView(runtime.accountLifecycle.rename(req.params.id,ownerId,label))});}
  catch {res.status(400).json({success:false,error:'ACCOUNT_RENAME_FAILED'});}
});
// Disconnect and delegation retain general owner authorization; pairing alone does not authorize them.
pluginAccountsRouter.post('/api/plugin-accounts/:id/disconnect', requireProtectedOwner, async(req,res)=>{
  try {const {runtime}=owned(req.params.id);await runtime.orchestrator.disconnect(req.params.id);res.json({success:true});}
  catch {res.status(400).json({success:false,error:'ACCOUNT_DISCONNECT_FAILED'});}
});


pluginAccountsRouter.post('/api/plugin-accounts/:id/reauth', requirePluginSetup, async(req,res)=>{
  try {
    const {runtime,ownerId}=owned(req.params.id);
    const attemptId=req.body?.attemptId;
    if(attemptId!==undefined && typeof attemptId!=='string') throw new Error();
    const attempt=await runtime.accountSetup.resume(req.params.id,ownerId,attemptId);
    res.json({success:true,attempt});
  } catch {res.status(400).json({success:false,error:'ACCOUNT_REAUTH_FAILED'});}
});

// Only an owner-scoped template may be duplicated; family support is resolved by the host.
pluginAccountsRouter.post('/api/plugin-accounts/:id/add', requirePluginSetup, async(req,res)=>{
  try {
    const {runtime,ownerId,record}=owned(req.params.id);
    const label=req.body?.label;
    if(typeof label!=='string' || !label.trim() || label.length>256) throw new Error('INVALID_ACCOUNT_LABEL');
    const {accountFamilySupport}=await import('../../connections/account-family-support.js');
    const { listExtensionDescriptors } = await import('../../extensions/registry.js');
    const descriptor = listExtensionDescriptors().find(item => item.id === record.pluginId);
    const kind = descriptor?.kind || record.accountAccess!.family;
    const support=accountFamilySupport(kind,record.serviceId,record.adapterId);
    if(support.mode!=='account' && support.mode!=='instance') {
      res.status(409).json({success:false,error:'ACCOUNT_FAMILY_NOT_READY',mode:support.mode,reason:support.reason});return;
    }
    const result=await runtime.accountSetup.add(record,ownerId,label,record.accountAccess!.family);
    res.json({success:true,account:publicAccountView(result.connection),attempt:result.attempt});
  } catch {res.status(400).json({success:false,error:'ACCOUNT_ADD_FAILED'});}
});

// Explicit owner action preserves the existing native login before adding another.
// Never run migration merely because someone listed plugins.
pluginAccountsRouter.post('/api/plugin-accounts/:id/adopt', requireProtectedOwner, async(req,res)=>{
  try {
    const runtime=getConnectionRuntime();
    const record=runtime.connections.get(req.params.id);
    if(!record) throw new Error('ACCOUNT_UNAVAILABLE');
    const ownerId=owner();
    if(record.accountAccess && record.accountAccess.ownerId!==ownerId) throw new Error('ACCOUNT_UNAVAILABLE');
    const descriptor=listExtensionDescriptors().find(item=>item.id===record.pluginId);
    if(accountFamilySupport(descriptor?.kind || '',record.serviceId,record.adapterId).mode!=='account') throw new Error('ACCOUNT_FAMILY_NOT_READY');
    const {getConnector}=await import('../../integrations/connector-registry.js');
    const {getConnectorInstances}=await import('../../integrations/connector-instances.js');
    const {adoptLegacyNativeAccount}=await import('../../connections/account-native-migration.js');
    const instances=getConnectorInstances(getConfig().getConfigDir());
    if(record.serviceId==='obsidian'){
      const {adoptLegacyObsidianAccounts}=await import('../../connections/account-resource-migration.js');
      adoptLegacyObsidianAccounts(runtime.connections,record.id,ownerId);
    }else if(record.serviceId==='vercel'){
      const {getVercelCredentials}=await import('../../integrations/connection-state.js');
      const {adoptLegacyKeyAccount}=await import('../../connections/account-key-migration.js');
      const fields=getVercelCredentials();if(!fields)throw new Error('ACCOUNT_UNAVAILABLE');
      adoptLegacyKeyAccount(getConfig().getConfigDir(),runtime.connections,runtime.secureInput,record.id,ownerId,{apiKey:fields.apiKey,teamId:fields.teamId || '',projectId:fields.projectId || ''});
    }else if(record.serviceId==='x'){
      const {loadXApiTokens}=await import('../../auth/x-api-oauth.js');
      const {adoptLegacyXAccount}=await import('../../connections/account-native-migration.js');
      adoptLegacyXAccount(runtime.connections,instances,record.id,ownerId,loadXApiTokens(getConfig().getConfigDir()));
    }else{
      const legacy=getConnector(record.serviceId);
      if(!legacy) throw new Error('ACCOUNT_UNAVAILABLE');
      adoptLegacyNativeAccount(runtime.connections,instances,record.id,ownerId,legacy);
    }
    res.json({success:true,account:accountView(runtime.connections.get(record.id)!)});
  } catch {res.status(400).json({success:false,error:'ACCOUNT_ADOPTION_FAILED'});}
});

pluginAccountsRouter.post('/api/plugin-accounts/legacy-list', requireProtectedOwner, (_req,res)=>{
  try {
    owner();
    const accounts=getConnectionRuntime().connections.list()
      .filter(record=>!record.accountAccess && record.authenticated)
      .filter(record=>accountFamilySupport(listExtensionDescriptors().find(item=>item.id===record.pluginId)?.kind || '',record.serviceId,record.adapterId).mode==='account')
      .map(accountView);
    res.json({success:true,accounts});
  } catch {res.status(403).json({success:false,error:'ACCOUNT_UNAVAILABLE'});}
});

// First account uses declared plugin metadata, not another user's connection as a template.
pluginAccountsRouter.post('/api/plugin-accounts/create', requirePluginSetup, async(req,res)=>{
  try {
    const serviceId=String(req.body?.serviceId || '');
    const descriptor=listExtensionDescriptors().find(item=>item.id===serviceId && item.kind==='connector');
    const strategy=descriptor?.connection?.strategies?.find(item=>item.adapter==='connector-oauth')
      || (descriptor?.id==='obsidian' ? {id:'obsidian-local-vault',adapter:'local-resource'} : undefined)
      || (descriptor?.id==='vercel' && descriptor.setup?.authType==='api_key' ? {id:'vercel-manifest-key',adapter:'api-key'} : undefined);
    if(!descriptor || !strategy || accountFamilySupport(descriptor.kind,serviceId,strategy.adapter).mode!=='account') throw new Error('ACCOUNT_FAMILY_NOT_READY');
    const runtime=getConnectionRuntime();
    if(runtime.connections.list().some(record=>record.serviceId===serviceId && !record.accountAccess && record.authenticated)) throw new Error('ACCOUNT_ADOPTION_REQUIRED');
    const label=req.body?.label;
    if(typeof label!=='string' || !label.trim() || label.length>256) throw new Error('INVALID_ACCOUNT_LABEL');
    const result=await runtime.accountSetup.add({serviceId,serviceName:descriptor.name,pluginId:descriptor.id,
      strategyId:strategy.id,adapterId:strategy.adapter,installed:true},owner(),label,serviceId==='obsidian'?'resource':'connector');
    res.json({success:true,account:accountView(result.connection),attempt:result.attempt});
  } catch {res.status(400).json({success:false,error:'ACCOUNT_CREATE_FAILED'});}
});
