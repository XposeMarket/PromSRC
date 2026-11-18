import { OAuthConnector, type ConnectorTokens } from '../oauth-base.js';
import { loadXApiCredentials } from '../../auth/x-api-oauth.js';

/** Separate X account tokens; shares only the developer application's OAuth configuration. */
export class XAccountConnector extends OAuthConnector {
  constructor(directory: string) {
    const app=loadXApiCredentials(directory);
    const redirect=new URL(app?.redirect_uri || 'http://localhost:8080/callback');
    if(redirect.protocol!=='http:' || !['localhost','127.0.0.1'].includes(redirect.hostname)) throw new Error('X account OAuth requires a loopback redirect URI.');
    super({id:'x',name:'X / Twitter',authUrl:'https://x.com/i/oauth2/authorize',tokenUrl:'https://api.x.com/2/oauth2/token',
      clientId:app?.client_id || '',clientSecret:app?.client_secret,
      scopes:app?.scopes || ['tweet.read','users.read','offline.access'],requiredScopes:['tweet.read','users.read'],
      usePkce:true,tokenAuthMethod:app?.client_secret?'basic':'body',
      callbackPort:Number(redirect.port || 8080),callbackPath:redirect.pathname},directory);
  }
  protected callbackUrl(): string {
    const redirect=loadXApiCredentials(this.configDir)?.redirect_uri || 'http://localhost:8080/callback';
    const parsed=new URL(redirect);
    if(parsed.protocol!=='http:' || !['localhost','127.0.0.1'].includes(parsed.hostname)
      || Number(parsed.port || 80)!==this.cfg.callbackPort || parsed.pathname!==this.cfg.callbackPath
      || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('X OAuth redirect changed; reconnect the account.');
    return redirect;
  }
  protected loadCredentialsFromVault(): void {
    const app=loadXApiCredentials(this.configDir);
    if(app){this.cfg.clientId=app.client_id;this.cfg.clientSecret=app.client_secret;this.cfg.tokenAuthMethod=app.client_secret?'basic':'body';}
  }
  protected async buildTokens(data: Record<string,any>): Promise<ConnectorTokens> {
    const response=await fetch('https://api.x.com/2/users/me?user.fields=username,name',{
      headers:{Authorization:`Bearer ${data.access_token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`X identity verification failed (${response.status})`);
    const body=await response.json() as any;
    if(!body?.data?.id)throw new Error('X account identity unavailable');
    return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+Number(data.expires_in||7200)*1000,
      scope:data.scope,token_type:data.token_type,account_id:String(body.data.id)};
  }
  async getUser(): Promise<any> {
    const response=await fetch('https://api.x.com/2/users/me?user.fields=username,name',{
      headers:{Authorization:`Bearer ${await this.getValidAccessToken()}`},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`X identity verification failed (${response.status})`);
    const body=await response.json() as any;
    if(!body?.data?.id)throw new Error('X account identity unavailable');
    return body.data;
  }
}
