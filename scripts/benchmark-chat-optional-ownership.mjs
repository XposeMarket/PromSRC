import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enforce = process.argv.includes('--enforce');
const skipBuild = process.argv.includes('--no-build');
if (!skipBuild) {
  execFileSync(process.execPath, ['scripts/build-web-ui-production.mjs'], { cwd: root, stdio: 'inherit' });
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'generated/public-web-ui/asset-manifest.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'scripts/chat-optional-ownership-baseline.json'), 'utf8'));
const assets = new Map(manifest.assets.map((asset) => [asset.path, asset]));

function staticClosure(entryPath) {
  const seen = new Set();
  const queue = [entryPath];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const imported of assets.get(current)?.imports || []) {
      if (imported.kind === 'import-statement') queue.push(imported.path);
    }
  }
  const records = [...seen].map((pathname) => assets.get(pathname)).filter(Boolean);
  return {
    paths: [...seen].sort(),
    rawBytes: records.reduce((total, record) => total + record.bytes, 0),
    gzipBytes: records.reduce((total, record) => total + record.gzipBytes, 0),
    moduleCount: records.length,
  };
}

function outputFor(source) {
  const output = manifest.moduleOutputs[source];
  assert(output, `production manifest is missing ${source}`);
  return output;
}

function reduction(before, after) {
  return Math.round((1 - after / before) * 10000) / 10000;
}

const desktop = staticClosure(outputFor('src/pages/ChatPage.js'));
const mobile = staticClosure(outputFor('src/mobile/mobile-pages.js'));
const voice = staticClosure(outputFor('src/mobile/mobile-voice-page.js'));
const desktopExcludedSources = [
  'src/vendor/thinking-orb.js',
  'src/tool-activity.js',
  'src/components/creative/sceneGraph.js',
  'src/components/creative/featureRuntime.js',
  'src/features/chat/optional/browser-surface-renderer.js',
  'src/features/chat/optional/creative-workspace-runtime.js',
  'src/components/ProcessRunCard.js',
  'src/components/coding-diff.js',
  'src/source-panel-environment.mjs'
];
const mobileExcludedSources = [
  'src/mobile/mobile-voice-page.js',
  'src/vendor/thinking-orb.js',
  'src/tool-activity.js'
];

const excluded = {
  desktop: Object.fromEntries(desktopExcludedSources.map((source) => [source, outputFor(source)])),
  mobile: Object.fromEntries(mobileExcludedSources.map((source) => [source, outputFor(source)])),
};
const measurements = {
  reference: baseline.reference,
  buildId: manifest.buildId,
  desktopPlainChat: {
    ...desktop,
    gzipReductionRatio: reduction(baseline.baseline.desktopPlainChat.gzipBytes, desktop.gzipBytes),
  },
  mobilePlainChat: {
    ...mobile,
    gzipReductionRatio: reduction(baseline.baseline.mobilePlainChat.gzipBytes, mobile.gzipBytes),
  },
  mobileVoiceOwner: voice,
  excluded,
  sourceDiagnostics: {
    chatPageBytes: fs.statSync(path.join(root, 'web-ui/src/pages/ChatPage.js')).size,
    mobilePagesBytes: fs.statSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js')).size,
    mobileVoiceOwnerBytes: fs.statSync(path.join(root, 'web-ui/src/mobile/mobile-voice-page.js')).size,
  },
};

if (enforce) {
  const budgets = baseline.budgets;
  assert(desktop.rawBytes <= budgets.desktopPlainChatRawBytesMax, `desktop plain-chat raw closure ${desktop.rawBytes} exceeds ${budgets.desktopPlainChatRawBytesMax}`);
  assert(desktop.gzipBytes <= budgets.desktopPlainChatGzipBytesMax, `desktop plain-chat gzip closure ${desktop.gzipBytes} exceeds ${budgets.desktopPlainChatGzipBytesMax}`);
  assert(desktop.moduleCount <= budgets.desktopPlainChatModuleCountMax, `desktop plain-chat module count ${desktop.moduleCount} exceeds ${budgets.desktopPlainChatModuleCountMax}`);
  assert(measurements.desktopPlainChat.gzipReductionRatio >= budgets.desktopMinimumGzipReductionRatio, 'desktop plain-chat reduction regressed below the committed milestone');
  assert(mobile.rawBytes <= budgets.mobilePlainChatRawBytesMax, `mobile plain-chat raw closure ${mobile.rawBytes} exceeds ${budgets.mobilePlainChatRawBytesMax}`);
  assert(mobile.gzipBytes <= budgets.mobilePlainChatGzipBytesMax, `mobile plain-chat gzip closure ${mobile.gzipBytes} exceeds ${budgets.mobilePlainChatGzipBytesMax}`);
  assert(mobile.moduleCount <= budgets.mobilePlainChatModuleCountMax, `mobile plain-chat module count ${mobile.moduleCount} exceeds ${budgets.mobilePlainChatModuleCountMax}`);
  assert(measurements.mobilePlainChat.gzipReductionRatio >= budgets.mobileMinimumGzipReductionRatio, 'mobile plain-chat reduction regressed below the committed milestone');
  assert(voice.gzipBytes <= budgets.mobileVoiceOwnerGzipBytesMax, `mobile Voice owner ${voice.gzipBytes} gzip bytes exceeds ${budgets.mobileVoiceOwnerGzipBytesMax}`);
  for (const [source, output] of Object.entries(excluded.desktop)) {
    assert(!desktop.paths.includes(output), `${source} leaked into the desktop plain-chat static closure`);
  }
  for (const [source, output] of Object.entries(excluded.mobile)) {
    assert(!mobile.paths.includes(output), `${source} leaked into the mobile plain-chat static closure`);
  }
}

console.log(JSON.stringify(measurements, null, 2));
if (enforce) console.log('Chat optional ownership budgets passed.');
