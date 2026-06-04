/**
 * Run AFTER a fresh OpenAI Codex OAuth login (Settings -> Models -> OpenAI Codex -> Connect).
 * A login id_token carries organization_id; this exchanges it for a real platform
 * api_key and stores it so realtime works. Does NOT refresh (refresh strips org_id).
 */
import { getConfig } from '../src/config/config.js';
import { loadTokens, saveTokens } from '../src/auth/openai-oauth.js';
const TOKEN_URL='https://auth.openai.com/oauth/token';
const CLIENT_ID='app_EMoamEEZ73f0CkXaXp7hrann';
function ns(jwt?:string){ if(!jwt) return {} as any; try{const p=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString());return p['https://api.openai.com/auth']||p;}catch{return {} as any;} }
(async()=>{
  const dir=getConfig().getConfigDir(); const t=loadTokens(dir);
  if(!t?.id_token){ console.log('No id_token — reconnect OpenAI Codex OAuth first.'); return; }
  const claims=ns(t.id_token);
  console.log('id_token organization_id:', claims.organization_id || '(MISSING — this is a refresh token, do a FRESH login)');
  if(t.api_key){ console.log('api_key already present in bundle.'); }
  const r=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',client_id:CLIENT_ID,requested_token:'openai-api-key',subject_token:t.id_token,subject_token_type:'urn:ietf:params:oauth:token-type:id_token'}).toString()});
  const txt=await r.text(); let key=''; try{key=JSON.parse(txt)?.access_token||'';}catch{}
  console.log('exchange status:', r.status, '| api_key minted?', !!key);
  if(!key){ console.log('body:', txt.slice(0,200)); return; }
  saveTokens(dir, { ...t, api_key:key } as any);
  const m=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${key}`}});
  console.log('GET /v1/models w/ minted key:', m.status, m.status===200?'(platform access OK — realtime will work)':'');
  console.log('SAVED api_key to vault. Restart the gateway and realtime should connect.');
})().catch(e=>{console.error('FATAL',e?.message||e);process.exit(1);});
