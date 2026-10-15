/** Pure, platform-independent environment boundary for untrusted MCP processes. */
export interface McpEnvironmentConfig {
  env?: Record<string, string>;
  envPassthrough?: string[];
}
const BASE_ENV = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'HOME',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMDATA', 'LANG', 'TERM',
]);
export function buildMcpServerEnv(config: McpEnvironmentConfig, parentEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = Object.create(null);
  const explicit = new Set(config.envPassthrough || []);
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value !== undefined && (BASE_ENV.has(key.toUpperCase()) || explicit.has(key))) env[key] = value;
  }
  // Explicit server configuration wins, including case variants on Windows.
  for (const [key, value] of Object.entries(config.env || {})) {
    for (const inherited of Object.keys(env)) {
      if (inherited.toUpperCase() === key.toUpperCase()) delete env[inherited];
    }
    env[key] = value;
  }
  return env;
}
