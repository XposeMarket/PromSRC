import assert from 'node:assert/strict';
import type http from 'node:http';
import { createServer } from './server';

async function main(): Promise<void> {
  const app: http.RequestListener = (_req, res) => {
    res.statusCode = 404;
    res.end();
  };
  const expected = {
    contextBuild: { active: 1, queued: 2, maxConcurrency: 2 },
    postTurn: { active: false, queued: 3 },
    sessionPersistence: { active: true, pending: 4 },
  };
  const { server } = createServer(app, 0, '127.0.0.1', undefined, undefined, () => expected);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/status`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.gatewayQueues, expected);
    assert.equal(body.fastPath, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log('server status fast-path regression passed');
}

void main();
