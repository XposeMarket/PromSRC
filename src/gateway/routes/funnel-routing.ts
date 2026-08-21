export type FunnelRoute = { httpsPort: number; targetPorts: number[] };

export function parseFunnelRoutes(raw: string): FunnelRoute[] {
  try {
    const parsed = JSON.parse(raw) as any;
    const routes: FunnelRoute[] = [];
    for (const [endpoint, service] of Object.entries(parsed?.Web || {})) {
      const endpointPort = Number(String(endpoint).match(/:(\d+)$/)?.[1] || 443);
      if (![443, 8443, 10000].includes(endpointPort)) continue;
      const targetPorts = new Set<number>();
      for (const handler of Object.values((service as any)?.Handlers || {})) {
        const matches = String((handler as any)?.Proxy || '').matchAll(/127\.0\.0\.1:(\d+)/g);
        for (const match of matches) targetPorts.add(Number(match[1]));
      }
      if (targetPorts.size) routes.push({ httpsPort: endpointPort, targetPorts: [...targetPorts] });
    }
    if (routes.length) return routes;
  } catch {}

  const routes: FunnelRoute[] = [];
  let httpsPort = 443;
  for (const line of String(raw || '').split(/\r?\n/)) {
    const endpoint = line.match(/https:\/\/[^\s(]+/i)?.[0];
    if (endpoint) {
      try {
        const parsed = new URL(endpoint);
        httpsPort = Number(parsed.port || 443);
      } catch {}
    }
    const target = line.match(/127\.0\.0\.1:(\d+)/);
    if (target) routes.push({ httpsPort, targetPorts: [Number(target[1])] });
  }
  return routes;
}

export function findFunnelRouteForPort(routes: FunnelRoute[], localPort: number): FunnelRoute | undefined {
  return routes.find((route) => route.targetPorts.includes(Number(localPort)));
}

export function formatFunnelOrigin(publicUrl: string, httpsPort: number): string {
  try {
    const parsed = new URL(publicUrl);
    if (parsed.protocol !== 'https:' || !parsed.host) return publicUrl;
    parsed.port = Number(httpsPort) === 443 ? '' : String(httpsPort);
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return publicUrl;
  }
}
