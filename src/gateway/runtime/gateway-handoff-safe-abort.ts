/** Fail closed before freezing persistence or stopping schedulers. */
export async function releaseHandoffListeners(hooks: {
  closeListenersForHandoff?: () => Promise<void>;
  hasListeningGateway?: () => boolean;
}): Promise<void> {
  if (!hooks.closeListenersForHandoff || !hooks.hasListeningGateway) {
    throw new Error('Warm handoff listener ownership hooks are not registered.');
  }
  await hooks.closeListenersForHandoff();
  if (hooks.hasListeningGateway()) throw new Error('Warm handoff predecessor still owns its listener.');
}

/** Never trade a serving predecessor or its live agents for a cold restart. */
export function canExitAfterFailedHandoff(listening: boolean, runningRuntimes: number): boolean {
  return !listening && runningRuntimes === 0;
}

/** Probe only loopback: both a live response identity and its drain manifest must match. */
export async function predecessorOwnsHandoffListener(stateDir: string, port: number, tls = false): Promise<boolean> {
  const { readGatewayHandoffManifests, isGatewayHandoffPidAlive } = await import('./gateway-handoff-protocol');
  const manifests = readGatewayHandoffManifests(stateDir).filter(m => m.hostPid !== process.pid && isGatewayHandoffPidAlive(m.hostPid));
  if (!manifests.length) return false;
  const transport = tls ? await import('node:https') : await import('node:http');
  return new Promise<boolean>(resolve => {
    let settled = false;
    const done = (value: boolean): void => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const request = transport.get({ hostname: '127.0.0.1', port, path: '/api/health', agent: false, ...(tls ? { rejectUnauthorized: false } : {}) }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 16_384) { request.destroy(); done(false); } });
      response.on('error', () => done(false));
      response.on('end', () => {
        try {
          const health = JSON.parse(body);
          done(response.statusCode === 200 && health.ok === true && manifests.some(m =>
            m.hostPid === health.pid && m.processStartedAt > 0 &&
            Math.abs(m.processStartedAt - Number(health.processStartedAt)) < 2_000));
        } catch { done(false); }
      });
    });
    const timer = setTimeout(() => { request.destroy(); done(false); }, 2_000);
    request.on('error', () => done(false));
  });
}
