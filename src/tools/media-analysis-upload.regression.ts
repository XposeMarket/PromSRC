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
    const { executeAnalyzeVideo } = await import('./media-analysis.js');
    const { executeVideoSocialCut } = await import('./video-social-cut.js');
    const { resolveReferenceImages, validateMaskImage } = await import('../image-generation/utils.js');
    const { resolveVideoInput } = await import('../video-generation/utils.js');
    const video = path.join(uploads, 'source.mp4');
    const missing = path.join(uploads, 'missing.mp4');
    const outsideOutput = path.join(uploads, 'output');
    const videoBytes = Buffer.from('local video input fixture');
    fs.writeFileSync(video, videoBytes);
    const cut = (source: string, output_dir?: string) => executeVideoSocialCut({ source, output_dir, captions: false });
    await runWithWorkspace(worker, async () => {
      assert.deepEqual((await resolveReferenceImages([upload]))[0].bytes, bytes);
      await validateMaskImage(upload, upload);
      assert.deepEqual((await resolveVideoInput(video)).bytes, videoBytes);
      assert.deepEqual((await resolveVideoInput(upload)).bytes, bytes);
      // A missing granted source reaches file lookup, without invoking a codec or provider.
      assert.match((await executeAnalyzeVideo({ file_path: missing })).error || '', /File not found/i);
      assert.match((await cut(missing)).error || '', /Local source not found/i);
      for (const r of [await executeAnalyzeVideo({ file_path: video, output_dir: outsideOutput }), await cut(video, outsideOutput)]) {
        assert.ok(r.error?.includes(outsideOutput), r.error); assert.equal(r.success, false);
      }
      assert.equal(fs.existsSync(outsideOutput), false);
    }, [parent]);
    for (const [file, grants] of [[denied, [parent]], [unrelated, [parent]], [upload, []]] as const) {
      await runWithWorkspace(worker, async () => {
        const refusal = /outside workspace|blocked/i;
        await assert.rejects(resolveReferenceImages([file]), refusal);
        await assert.rejects(resolveVideoInput(file), refusal);
        assert.match((await executeAnalyzeVideo({ file_path: file })).error || '', refusal);
        assert.match((await cut(file)).error || '', refusal);
      }, [...grants]);
    }
    console.log('PASS: granted media inputs, reference and mask bytes, denied reads and output confinement');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
