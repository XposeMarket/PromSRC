import assert from 'node:assert/strict';
import { findFunnelRouteForPort, formatFunnelOrigin, parseFunnelRoutes } from './funnel-routing';

const raw = JSON.stringify({
  Web: {
    'desktop.example:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:32466' } } },
    'desktop.example:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:18791' } } },
  },
});

const routes = parseFunnelRoutes(raw);
const active = findFunnelRouteForPort(routes, 18791);
assert.deepEqual(active, { httpsPort: 8443, targetPorts: [18791] });
assert.equal(formatFunnelOrigin('https://desktop.example', active.httpsPort), 'https://desktop.example:8443');
assert.equal(formatFunnelOrigin('https://desktop.example:443', 443), 'https://desktop.example');

console.log('funnel-routing regression passed');
