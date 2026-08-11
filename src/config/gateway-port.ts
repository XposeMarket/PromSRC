export const DEFAULT_GATEWAY_PORT = 18789;

/**
 * Parse a TCP port supplied by a user or the process environment.
 * Invalid values are treated as unset so startup can fall back safely.
 */
export function parseGatewayPort(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return undefined;
  return parsed;
}

/**
 * PROMETHEUS_GATEWAY_PORT is the explicit per-instance override. Keep
 * GATEWAY_PORT as a compatibility fallback for Docker and existing scripts.
 */
export function getRuntimeGatewayPort(): number | undefined {
  return parseGatewayPort(
    process.env.PROMETHEUS_GATEWAY_PORT || process.env.GATEWAY_PORT,
  );
}

export function resolveGatewayPort(config: unknown): number {
  const configured = parseGatewayPort((config as any)?.gateway?.port);
  return configured || getRuntimeGatewayPort() || DEFAULT_GATEWAY_PORT;
}

export function buildGatewayUrl(port: number, host = '127.0.0.1'): string {
  return `http://${host}:${port}`;
}
