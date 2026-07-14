import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

test('bridge exposes health', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const child = spawn(process.execPath, ['server.mjs'], { cwd, env: { ...process.env, VITA_BRIDGE_PORT: String(port), VITA_BRIDGE_HOST: '127.0.0.1' }, stdio: 'inherit' });
  try {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        if (r.ok) {
          const j = await r.json();
          assert.equal(j.service, 'prometheus-vita-bridge');
          assert.equal(j.update.version, '00.24');
          const manifest = await fetch(`http://127.0.0.1:${port}/update/manifest.json`);
          assert.equal(manifest.status, 200);
          const info = await manifest.json();
          assert.equal(info.ready, true);
          assert.ok(info.size > 1024);
          const update = await fetch(`http://127.0.0.1:${port}/update/prometheus_vita.vpk`);
          assert.equal(update.status, 200);
          assert.equal(Number(update.headers.get('content-length')), info.size);
          return;
        }
      } catch {}
      await wait(50);
    }
    assert.fail('bridge did not start');
  } finally {
    child.kill('SIGKILL');
  }
});
