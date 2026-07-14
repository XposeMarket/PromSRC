import { ConnectionAdapterRegistry } from '../adapter-registry.js';
import { ApiKeyConnectionAdapter, type ApiKeyAdapterOptions } from './api-key.js';
import { BrowserSessionConnectionAdapter, type BrowserSessionHost } from './browser-session.js';
import { CliLoginConnectionAdapter, type CliLoginHost } from './cli-login.js';
import { CustomHttpConnectionAdapter, type CustomHttpHost } from './custom-http.js';
import { DeviceCodeConnectionAdapter, type DeviceCodeFlow } from './device-code.js';
import { LocalResourceConnectionAdapter, type LocalResourceHost } from './local-resource.js';
import { McpOAuthConnectionAdapter, type McpOAuthHost } from './mcp-oauth.js';
import { McpStdioConnectionAdapter, type McpStdioHost } from './mcp-stdio.js';
import { OAuthPkceConnectionAdapter, type OAuthPkceFlow } from './oauth-pkce.js';
import { OpenAiCompatibleModelConnectionAdapter, type OpenAiCompatibleHost } from './openai-compatible-model.js';

export * from './api-key.js';
export * from './browser-session.js';
export * from './cli-login.js';
export * from './custom-http.js';
export * from './device-code.js';
export * from './local-resource.js';
export * from './mcp-oauth.js';
export * from './mcp-stdio.js';
export * from './oauth-pkce.js';
export * from './openai-compatible-model.js';

export interface BuiltInConnectionAdapterHosts {
  apiKey?: ApiKeyAdapterOptions;
  browserSession?: BrowserSessionHost;
  cliLogin?: CliLoginHost;
  customHttp?: CustomHttpHost;
  deviceCode?: DeviceCodeFlow;
  localResource?: LocalResourceHost;
  mcpOAuth?: McpOAuthHost;
  mcpStdio?: McpStdioHost;
  oauthPkce?: OAuthPkceFlow;
  openAiCompatible?: OpenAiCompatibleHost;
}

/** Register only adapters whose privileged host implementation is available. */
export function registerBuiltInConnectionAdapters(registry: ConnectionAdapterRegistry, hosts: BuiltInConnectionAdapterHosts): Array<() => void> {
  const adapters = [
    hosts.mcpOAuth && new McpOAuthConnectionAdapter(hosts.mcpOAuth),
    hosts.oauthPkce && new OAuthPkceConnectionAdapter(hosts.oauthPkce),
    hosts.deviceCode && new DeviceCodeConnectionAdapter(hosts.deviceCode),
    hosts.openAiCompatible && new OpenAiCompatibleModelConnectionAdapter(hosts.openAiCompatible),
    hosts.mcpStdio && new McpStdioConnectionAdapter(hosts.mcpStdio),
    hosts.apiKey && new ApiKeyConnectionAdapter(hosts.apiKey),
    hosts.localResource && new LocalResourceConnectionAdapter(hosts.localResource),
    hosts.cliLogin && new CliLoginConnectionAdapter(hosts.cliLogin),
    hosts.browserSession && new BrowserSessionConnectionAdapter(hosts.browserSession),
    hosts.customHttp && new CustomHttpConnectionAdapter(hosts.customHttp),
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  return adapters.map((adapter) => registry.register(adapter));
}
