import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, resolve = require) {
  const exports = {};
  const source = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, require: resolve, process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval }, { filename: file });
  return exports;
}
const { buildMediaAnalysisPreviewPayloads: previews, buildDirectMediaObservationMessage } = load('src/gateway/media-analysis-preview.ts');
const { snapshotAnalysisVisual } = load('src/tools/media-analysis-visuals.ts');
const { buildDurableChatTraceFromFrames } = load('src/gateway/durable-chat-trace.ts');

// Run the active capability executor, replacing only its external services.
// The previous source contract inspected the obsolete switch and missed this loss.
let serviceResult;
const calls = [];
const { webMediaCapabilityExecutor: executor } = load('src/gateway/agents-runtime/capabilities/web-media-executor.ts', name => {
  if (name.endsWith('/media-analysis')) return {
    executeAnalyzeImage: async args => { calls.push(args); return serviceResult; },
    executeAnalyzeVideo: async args => { calls.push(args); return serviceResult; },
  };
  return {};
});
for (const name of ['analyze_image', 'analyze_video', 'video_analyze_imported_video']) {
  const isImage = name === 'analyze_image';
  const data = isImage ? { file_path: 'latest frame.bmp', visual_inputs: [{ path: 'downloads/frozen.bmp' }] }
    : { visual_inputs: [{ path: 'downloads/sheet #1.png', artifactKind: 'contact_sheet' }], sample_frames: ['unused.png'] };
  serviceResult = { success: true, data };
  const result = await executor.execute({ name, args: { file_path: 'source', transcribe: false }, deps: {}, sessionId: 'test' });
  assert.equal(result.data, data, `${name}: structured visuals survive the active executor`);
  const visual = previews(name, result);
  assert.equal(visual.length, 1);
  assert.equal(visual[0].artifactKind, isImage ? 'analyzed_image' : 'contact_sheet');
  assert.ok(!visual[0].dataUrl.includes('unused'));
  const trace = buildDurableChatTraceFromFrames([{ type: 'vision_injected', seq: 1,
    data: { source: 'media_analysis', tool: name, preview: visual[0] } }]);
  assert.equal(trace[0].type, 'vision');
  assert.equal(trace[0].preview.dataUrl, visual[0].dataUrl, 'history/reconnect retains the exact media URL');
  serviceResult = { success: false, data, error: 'vision unavailable' };
  const failed = await executor.execute({ name, args: {}, deps: {}, sessionId: 'test' });
  assert.equal(failed.data, undefined);
  assert.equal(previews(name, failed).length, 0, 'failed analysis must not claim inspection');
}
assert.equal(calls[2].transcribe, false);
serviceResult = { success: true, data: {} };
for (const name of ['analyze_image', 'analyze_video']) {
  await executor.execute({ name, args: {}, deps: { supportsDirectMediaObservation: true }, sessionId: 'test' });
  assert.equal(calls.at(-1).direct_observation, true);
  await executor.execute({ name, args: { response_mode: 'report' }, deps: { supportsDirectMediaObservation: true }, sessionId: 'test' });
  assert.equal(calls.at(-1).response_mode, 'report');
  await executor.execute({ name, args: { direct_observation: true }, deps: {}, sessionId: 'test' });
  assert.equal(calls.at(-1).direct_observation, false, 'model arguments cannot enable direct mode without runtime image delivery support');
}
assert.equal(previews('analyze_video', { data: { visual_inputs: [], contact_sheets: [{ path: 'not-seen.png' }] } }).length, 0);
assert.equal(previews('unrelated_tool', { data: { file_path: 'x.png' } }).length, 0);
const frames = Array.from({ length: 12 }, (_, i) => ({ path: `frame-${i}.png`, artifactKind: 'sample_frame' }));
assert.equal(previews('analyze_video', { data: { visual_inputs: frames } }).length, 12, 'all twelve fallback vision inputs must be visible');
assert.equal(previews('analyze_video', { data: { contact_sheets: [{ path: 'sheet.png' }], sample_frames: ['frame.png'] } })[0].artifactKind, 'contact_sheet');
assert.equal(previews('analyze_video', { data: { sample_frames: ['a.png', { path: 'b.png' }, 'a.png', null] } }).length, 2);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-analysis-preview-'));
try {
  const file = path.join(directory, 'latest.png');
  fs.writeFileSync(file, 'first screenshot');
  const first = await snapshotAnalysisVisual(directory, file);
  fs.writeFileSync(file, 'second screenshot');
  const second = await snapshotAnalysisVisual(directory, file);
  assert.notEqual(first.path, second.path);
  assert.equal(fs.readFileSync(first.path, 'utf8'), first.bytes.toString());
  assert.equal(fs.readFileSync(second.path, 'utf8'), second.bytes.toString());
  assert.equal((await snapshotAnalysisVisual(directory, file)).path, second.path, 'identical captures reuse their immutable artifact');
  let visionMessages;
  let visionCallCount = 0;
  let analyzerFixture;
  const { executeAnalyzeImage, executeAnalyzeVideo } = load('src/tools/media-analysis.ts', name => {
    if (name === 'child_process') return {
      execFile: (...args) => args.at(-1)(null, 'Python 3', ''),
      spawn: () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => { child.stdout.emit('data', JSON.stringify(analyzerFixture)); child.emit('close', 0); });
        return child;
      },
    };
    if (name === '../runtime/dependencies.js') return { resolveRuntimeBinary: name => name };
    if (name === './media-analysis-visuals.js') return { snapshotAnalysisVisual };
    if (name === './workspace-context.js') return { getActiveWorkspace: value => value };
    if (name === '../config/config.js') return { getConfig: () => ({ getConfig: () => ({ workspace: { path: directory } }) }) };
    if (name === '../gateway/vision-chat.js') return {
      primarySupportsVision: () => true,
      buildVisionImagePart: (data, mime) => ({ type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } }),
    };
    if (name === '../providers/content-utils.js') return { contentToString: value => value };
    if (name === '../providers/factory.js') return {
      getPrimaryModel: () => 'test-vision',
      getProvider: () => ({ chat: async messages => {
        visionCallCount++;
        visionMessages = messages;
        fs.writeFileSync(file, 'overwritten while vision runs');
        return { message: { content: 'test analysis' } };
      } }),
    };
    if (name.startsWith('.')) return {};
    return require(name);
  });
  const analyzed = await executeAnalyzeImage({ file_path: file });
  assert.equal(analyzed.success, true, analyzed.error);
  const input = analyzed.data.visual_inputs[0];
  const seenBytes = visionMessages[1].content.find(part => part.type === 'image_url').image_url.url.split(',')[1];
  assert.equal(fs.readFileSync(input.path).toString('base64'), seenBytes, 'actual image analysis previews the exact bytes sent to vision');
  assert.notEqual(fs.readFileSync(file, 'utf8'), fs.readFileSync(input.path, 'utf8'));
  const observed = await executeAnalyzeImage({ file_path: file, direct_observation: true });
  assert.equal(observed.success, true, observed.error);
  assert.equal(visionCallCount, 1, 'direct inspection must make zero extra model calls');
  assert.equal(observed.data.observation_mode, 'direct');
  assert.equal(observed.data.analysis, undefined, 'do not fabricate a report for direct inspection');
  const observation = await buildDirectMediaObservationMessage('analyze_image', { data: observed.data }, 'Read the HUD');
  assert.equal(observation.role, 'user');
  assert.equal(observation.content.find(part => part.type === 'image_url').image_url.url.split(',')[1], fs.readFileSync(observed.data.visual_inputs[0].path).toString('base64'));
  assert.match(observation.content[0].text, /Read the HUD/);
  assert.equal(await buildDirectMediaObservationMessage('analyze_image', { error: true, data: observed.data }), undefined);
  assert.equal(await buildDirectMediaObservationMessage('analyze_image', { data: analyzed.data }), undefined);
  const report = await executeAnalyzeImage({ file_path: file, direct_observation: true, response_mode: 'report' });
  assert.equal(report.data.observation_mode, 'report');
  assert.equal(visionCallCount, 2, 'explicit report mode retains the analyst');
  const Jimp = require('jimp');
  const bmp = path.join(directory, 'vita.bmp');
  await new Jimp(8, 8, 0xff0000ff).writeAsync(bmp);
  const converted = await snapshotAnalysisVisual(directory, bmp);
  assert.equal(path.extname(converted.path), '.png');
  assert.equal(converted.bytes.subarray(1, 4).toString(), 'PNG');
  const bmpResult = await executeAnalyzeImage({ file_path: bmp, direct_observation: true });
  const bmpObservation = await buildDirectMediaObservationMessage('analyze_image', { data: bmpResult.data });
  assert.match(bmpObservation.content.find(part => part.type === 'image_url').image_url.url, /^data:image\/png;base64,/);
  // Exercise the real video selection/result code; only the FFmpeg subprocess
  // output is supplied by the fixture, so these tests need no Python install.
  const video = path.join(directory, 'clip.mp4');
  fs.writeFileSync(video, 'fixture');
  const samples = [];
  for (let index = 0; index < 12; index++) {
    const sample = path.join(directory, `sample-${index}.png`);
    fs.writeFileSync(sample, `sample ${index}`);
    samples.push(sample);
  }
  const sheets = samples.slice(0, 10).map(path => ({ path }));
  analyzerFixture = { ok: true, video_summary: { written: samples, quick: { contact_sheet: sheets[0] }, detail: { batch_sheets: sheets.slice(1) } } };
  const videoArgs = { file_path: video, transcribe: false, extract_audio: false, direct_observation: true, analysis_mode: 'detail' };
  const videoResult = await executeAnalyzeVideo(videoArgs);
  assert.equal(videoResult.success, true, videoResult.error);
  assert.equal(videoResult.data.visual_inputs.length, 8, 'preview only the eight sheets actually passed to vision');
  assert.equal(previews('analyze_video', { data: videoResult.data }).length, 8);
  assert.equal(visionCallCount, 2, 'direct video also skips the extra model call');
  const videoMessage = await buildDirectMediaObservationMessage('analyze_video', { data: videoResult.data });
  assert.equal(videoMessage.content.filter(part => part.type === 'image_url').length, 8);
  analyzerFixture.video_summary = { written: samples };
  const fallback = await executeAnalyzeVideo(videoArgs);
  assert.equal(fallback.success, true, fallback.error);
  assert.equal(fallback.data.visual_inputs.length, 12);
  assert.equal(previews('analyze_video', { data: fallback.data }).length, 12);
  const repeated = previews('analyze_video', { data: { visual_inputs: [
    { path: 'same.png', artifactKind: 'sample_frame', source_name: 'frame_0001_0.5s.png' },
    { path: 'same.png', artifactKind: 'sample_frame', source_name: 'frame_0002_1.0s.png' },
  ] } });
  assert.equal(repeated.length, 2, 'identical pixels at different timestamps must retain their chronological positions');
  assert.match(repeated[1].title, /1\.0s/);
  const videoReport = await executeAnalyzeVideo({ ...videoArgs, response_mode: 'report' });
  assert.equal(videoReport.success, true, videoReport.error);
  assert.equal(visionCallCount, 3);
} finally {
  assert.ok(directory.startsWith(path.join(os.tmpdir(), 'prom-analysis-preview-')));
  fs.rmSync(directory, { recursive: true, force: true });
}

// Exercise the real desktop and mobile preview renderers plus paired-gateway URL
// handling without loading either application's unrelated global runtime.
function functions(file, names) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return names.map(name => {
    const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, `missing ${name}`);
    return node.getText(source).replace(/^export /, '');
  }).join('\n');
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
const context = {
  URL, API: '', window: { location: { origin: 'https://phone.example' }, __pmMobileActiveGatewayOrigin: 'https://paired.example' },
  _mobileRequestToken: () => 'test-pairing', escapeHtml, escHtml: escapeHtml,
  encodeInlineJsString: value => JSON.stringify(value), _mobileVisionPreviewKey: value => value,
};
vm.createContext(context);
vm.runInContext(functions('web-ui/src/mobile/mobile-api.js', ['appendPairingQuery', 'isMobileVisionPreviewPath', 'buildMobileVisionPreviewUrl'])
  + '\n' + functions('web-ui/src/mobile/mobile-pages.js', ['_isRenderableMobileTraceImageSource', '_renderMobileLiveTracePreview'])
  + '\n' + functions('web-ui/src/pages/ChatPage.js', ['isRenderableLiveTraceImageSource', 'renderLiveTracePreview']), context);
const preview = previews('analyze_video', { data: { visual_inputs: [{ path: 'frames/sheet #1.png', artifactKind: 'contact_sheet' }] } })[0];
const mobileHtml = context._renderMobileLiveTracePreview({ preview });
const desktopHtml = context.renderLiveTracePreview({ preview });
assert.match(mobileHtml, /https:\/\/paired\.example\/api\/canvas\/inline/);
assert.match(mobileHtml, /pt=test-pairing/);
assert.match(mobileHtml, /alt="Contact sheet 1"/);
assert.match(desktopHtml, /<img src="\/api\/canvas\/inline/);
assert.equal(context._renderMobileLiveTracePreview({ preview: { dataUrl: 'javascript:alert(1)' } }), '');
assert.equal(context.renderLiveTracePreview({ preview: { dataUrl: 'javascript:alert(1)' } }), '');
for (const [key, file] of [
  ['desktopGroup', 'web-ui/src/pages/ChatPage.js'],
  ['mobileGroup', 'web-ui/src/mobile/mobile-chat-renderer-runtime.js'],
]) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let branch;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(source) === "group.kind === 'vision'" && node.thenStatement.getText(source).includes('carousel')) branch = node.thenStatement;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(branch, `${key} must render grouped video frames`);
  context[key] = vm.runInContext(`(function(group) ${branch.getText(source)})`, context);
  assert.doesNotMatch(context[key]({ id: 'sheet', entries: [{ preview }] }), /class="[^"]*carousel"/);
  const frames = [1, 2].map(index => ({ preview: { ...preview, artifactKind: 'sample_frame', title: `Frame ${index}` } }));
  assert.match(context[key]({ id: 'frames', entries: frames }), /aria-label="Video sample frames"/);
  assert.match(context[key]({ id: 'frames', entries: frames }), /2 frames/);
}
if (process.argv.includes('--write-fixture')) {
  const image = `data:image/bmp;base64,${fs.readFileSync(path.join(root, 'artifacts/vita-preview-investigation-before.bmp')).toString('base64')}`;
  const sheet = `data:image/png;base64,${fs.readFileSync(path.join(root, 'artifacts/media-analysis-sheet.png')).toString('base64')}`;
  const entries = [{ preview: { dataUrl: image, title: 'Analyzed image' } }, { preview: { dataUrl: sheet, title: 'Video contact sheet' } }];
  const section = mobile => {
    const render = mobile ? context.mobileGroup : context.desktopGroup;
    return entries.map(entry => `<p>${entry.preview.title} completed</p>${render({ id: entry.preview.title, entries: [entry] })}`).join('')
      + '<p>Individual video frames</p>' + render({ id: 'frames', entries: [1, 2, 3].map(index => ({ preview: { dataUrl: image, artifactKind: 'sample_frame', title: `Frame ${index}` } })) });
  };
  for (const mobile of [false, true]) {
    const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Analysis preview verification</title><style>${read(mobile ? 'web-ui/src/styles/mobile.css' : 'web-ui/src/styles/components.css')}body{background:#101114;color:#eee;font:15px system-ui;margin:0;padding:20px;box-sizing:border-box}main{max-width:720px;margin:auto}button{color:inherit}p{margin:18px 0 8px}</style><main>${section(mobile)}</main>`;
    fs.writeFileSync(path.join(root, `artifacts/analysis-preview-${mobile ? 'mobile' : 'desktop'}.html`), html);
  }
}
console.log('[media-analysis-previews] active executors, exact inputs, immutable captures, history, desktop and paired mobile passed');
