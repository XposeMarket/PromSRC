import type { ConnectionAdapterContext } from './types.js';
/** Fixed provider-owned read endpoint. Never probe a model-supplied URL with a stored token. */
export async function verifyApiKeyAccount(context: ConnectionAdapterContext, envelope: string | undefined,
  fetcher: typeof fetch = fetch): Promise<{ok:boolean;message:string;details?:Record<string,unknown>}> {
  if(context.attempt.serviceId!=='vercel')return {ok:false,message:'Stored, not verified: no safe authentication verifier is available.'};
  let fields: Record<string,unknown>;
  try{fields=JSON.parse(envelope || '{}');}catch{return {ok:false,message:'Credential is unavailable.'};}
  const token=typeof fields.apiKey==='string'?fields.apiKey:typeof fields.token==='string'?fields.token:'';
  if(!token)return {ok:false,message:'Credential is unavailable.'};
  try{
    const response=await fetcher('https://api.vercel.com/v2/user',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok)return {ok:false,message:`Vercel authentication failed (HTTP ${response.status}).`};
    const body=await response.json() as any;
    if(!body?.user?.id)return {ok:false,message:'Vercel returned no account identity.'};
    return {ok:true,message:'Vercel account verified.',details:{account:{provider:'vercel',providerAccountId:String(body.user.id),email:body.user.email,username:body.user.username}}};
  }catch{return {ok:false,message:'Vercel account verification could not complete.'};}
}
