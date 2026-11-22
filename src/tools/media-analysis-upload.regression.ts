import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-image-scope-'));
  try {
    for (const key of ['PROMETHEUS_APP_DATA_DIR', 'PROMETHEUS_DATA_DIR', 'PROMETHEUS_WORKSPACE_DIR', 'APPDATA', 'USERPROFILE', 'HOME']) process.env[key] = root;
    const { getConfig } = await import('../config/config.js');
    const { runWithWorkspace } = await import('./workspace-context.js');
    const { executeAnalyzeImage } = await import('./media-analysis.js');
    const cfg = getConfig().getConfig();
    const parent = path.join(root, 'parent');
    const worker = path.join(root, 'worker');
    const uploads = path.join(parent, 'uploads');
    const blocked = path.join(uploads, 'blocked');
    cfg.workspace.path = parent;
    cfg.tools.permissions.files.blocked_paths = [blocked];
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1sAAAAASUVORK5CYII=', 'base64');
    const makeImage = (dir: string) => {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'image.png'); fs.writeFileSync(file, bytes); return file;
    };
    const upload = makeImage(uploads), local = makeImage(worker), unrelated = makeImage(parent), denied = makeImage(blocked);
    const inspect = (file_path: string) => executeAnalyzeImage({ file_path, direct_observation: true });
    const reject = async (file: string) => { const r = await inspect(file); assert.equal(r.success, false); assert.match(r.error || '', /outside workspace|blocked/i); };
    await runWithWorkspace(worker, async () => {
      const result = await inspect(upload);
      assert.equal(result.success, true, result.error);
      const preview = result.data.visual_inputs[0];
      assert.equal(path.dirname(preview.path), path.join(worker, 'downloads', 'media-analysis-previews'));
      assert.deepEqual(fs.readFileSync(preview.path), bytes);
      assert.equal((await inspect(path.basename(local))).success, true);
      await reject(unrelated); await reject(denied); await reject(path.relative(worker, upload));
    }, [parent]);
    await runWithWorkspace(worker, () => reject(upload));
    console.log('PASS: granted parent upload, preview bytes, local read, unrelated/blocked/relative/ungranted denials');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
