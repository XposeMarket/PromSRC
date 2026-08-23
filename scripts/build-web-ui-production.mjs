import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_UI_ROOT = path.join(ROOT, 'web-ui');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'generated', 'public-web-ui');
const BUILD_DESCRIPTOR = 'prometheus-web-production-v1|esm-split|minify|chrome120|safari16.4';
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.mjs', '.txt', '.webmanifest']);
const args = new Set(process.argv.slice(2));
const outRootIndex = process.argv.indexOf('--out-root');
const OUT_ROOT = outRootIndex >= 0
  ? path.resolve(process.argv[outRootIndex + 1] || '')
  : DEFAULT_OUT_ROOT;
const BUILD_ROOT = path.join(OUT_ROOT, 'build');
const MANIFEST_PATH = path.join(OUT_ROOT, 'asset-manifest.json');
const CHECK_ONLY = args.has('--check');

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalBuffer(filePath) {
  const body = fs.readFileSync(filePath);
  if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return body;
  return Buffer.from(body.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  }
  return output.sort((left, right) => toPosix(left).localeCompare(toPosix(right)));
}

function computeSourceDigest() {
  const hash = crypto.createHash('sha256');
  hash.update(`${BUILD_DESCRIPTOR}|esbuild-${esbuild.version}\n`);
  const buildInputs = [
    ...walkFiles(WEB_UI_ROOT),
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'package-lock.json'),
    fileURLToPath(import.meta.url),
  ].sort((left, right) => toPosix(left).localeCompare(toPosix(right)));
  for (const filePath of buildInputs) {
    const relative = toPosix(path.relative(ROOT, filePath));
    hash.update(`${relative}\0`);
    hash.update(canonicalBuffer(filePath));
    hash.update('\0');
  }
  const generatedFontCss = path.join(OUT_ROOT, 'static', 'styles', 'fonts.css');
  if (fs.existsSync(generatedFontCss)) {
    hash.update('generated-font-css\0');
    hash.update(canonicalBuffer(generatedFontCss));
  }
  return hash.digest('hex');
}

function publicPath(filePath) {
  const relative = toPosix(path.relative(OUT_ROOT, filePath));
  if (!relative || relative.startsWith('../')) {
    throw new Error(`[web-production] Asset escaped output root: ${filePath}`);
  }
  return `/${relative}`;
}

function absoluteOutputPath(outputKey) {
  return path.isAbsolute(outputKey) ? outputKey : path.resolve(ROOT, outputKey);
}

function outputPublicPath(outputKey) {
  return publicPath(absoluteOutputPath(outputKey));
}

function findOutputForEntry(metafile, entryPath) {
  const target = path.resolve(entryPath);
  for (const [outputKey, metadata] of Object.entries(metafile.outputs || {})) {
    if (!metadata.entryPoint) continue;
    if (path.resolve(ROOT, metadata.entryPoint) === target) return outputKey;
  }
  throw new Error(`[web-production] Missing output for entry ${toPosix(path.relative(ROOT, entryPath))}`);
}

function importPublicPath(outputKey, importedPath) {
  const outputAbsolute = absoluteOutputPath(outputKey);
  // esbuild's metafile records internal imports as output keys relative to the
  // working directory, while emitted source uses paths relative to the owning
  // chunk. Accept both representations.
  const importAbsolute = importedPath.startsWith('.')
    ? path.resolve(path.dirname(outputAbsolute), importedPath)
    : absoluteOutputPath(importedPath);
  return publicPath(importAbsolute);
}

function importedOutputAbsolute(outputKey, importedPath) {
  return importedPath.startsWith('.')
    ? path.resolve(path.dirname(absoluteOutputPath(outputKey)), importedPath)
    : absoluteOutputPath(importedPath);
}

function staticImportClosure(metafile, outputKey, options = {}) {
  const seen = new Set();
  const queue = [outputKey];
  while (queue.length) {
    const current = queue.shift();
    const currentPublic = outputPublicPath(current);
    if (seen.has(currentPublic)) continue;
    seen.add(currentPublic);
    const metadata = metafile.outputs?.[current];
    if (!metadata) continue;
    for (const imported of metadata.imports || []) {
      const allowImmediateRouter = options.includeMobileRouter
        && imported.kind === 'dynamic-import'
        && /mobile-router-[A-Z0-9]+\.js$/i.test(imported.path);
      if (imported.external || (imported.kind !== 'import-statement' && !allowImmediateRouter)) continue;
      const importedAbsolute = importedOutputAbsolute(current, imported.path);
      const importedKey = Object.keys(metafile.outputs).find(
        (candidate) => absoluteOutputPath(candidate) === importedAbsolute,
      );
      if (importedKey) queue.push(importedKey);
    }
  }
  return [...seen].sort();
}

function entryPointOutputMap(metafile) {
  const mapping = new Map();
  for (const [outputKey, metadata] of Object.entries(metafile.outputs || {})) {
    if (!metadata.entryPoint) continue;
    mapping.set(path.resolve(ROOT, metadata.entryPoint), outputPublicPath(outputKey));
  }
  return mapping;
}

function replaceModuleSpecifiers(source, moduleOutputs) {
  let output = source;
  for (const [entryAbsolute, builtPath] of moduleOutputs) {
    const relative = toPosix(path.relative(path.join(WEB_UI_ROOT, 'src'), entryAbsolute));
    if (relative.startsWith('../')) continue;
    output = output.split(`./src/${relative}`).join(builtPath);
    output = output.split(`/src/${relative}`).join(builtPath);
  }
  return output;
}

async function extractInlineScripts(html, documentName, moduleOutputs) {
  let scriptIndex = 0;
  const replacements = [];
  const pattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attributes = match[1] || '';
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const typeMatch = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const scriptType = String(typeMatch?.[1] || 'text/javascript').toLowerCase();
    if (!['text/javascript', 'application/javascript', 'module'].includes(scriptType)) continue;

    scriptIndex += 1;
    const rewritten = replaceModuleSpecifiers(match[2], moduleOutputs);
    const transformed = await esbuild.transform(rewritten, {
      loader: 'js',
      format: scriptType === 'module' ? 'esm' : undefined,
      target: ['chrome120', 'safari16.4'],
      minifySyntax: true,
      minifyWhitespace: true,
      // Classic scripts expose named functions to inline DOM handlers. Keep
      // those identifiers stable until the inline-handler migration is done.
      minifyIdentifiers: scriptType === 'module',
      legalComments: 'none',
    });
    const code = transformed.code.trimEnd() + '\n';
    const digest = sha256(code).slice(0, 12);
    const filename = `${documentName}-inline-${String(scriptIndex).padStart(2, '0')}-${digest}.js`;
    const destination = path.join(BUILD_ROOT, 'inline', filename);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, code, 'utf8');
    const cleanAttributes = attributes.trim();
    const replacement = `<script${cleanAttributes ? ` ${cleanAttributes}` : ''} src="${publicPath(destination)}"></script>`;
    replacements.push({ start: match.index, end: pattern.lastIndex, replacement });
  }

  for (const replacement of replacements.reverse()) {
    html = html.slice(0, replacement.start) + replacement.replacement + html.slice(replacement.end);
  }
  return html;
}

function replaceLocalStyles(html, cssPath) {
  let inserted = false;
  const output = html.replace(
    /\s*<link\s+rel=["']stylesheet["']\s+href=["']\/?src\/styles\/[^"']+["'][^>]*>\s*/gi,
    () => {
      if (inserted) return '\n';
      inserted = true;
      return `\n<link rel="stylesheet" href="${cssPath}">\n`;
    },
  );
  if (!inserted) throw new Error('[web-production] Document has no local stylesheet entry.');
  return output;
}

function modulePreloads(metafile, entryOutput) {
  const metadata = metafile.outputs?.[entryOutput];
  if (!metadata) return [];
  return (metadata.imports || [])
    .filter((item) => !item.external && item.kind === 'import-statement')
    .map((item) => importPublicPath(entryOutput, item.path))
    .sort();
}

async function buildDocument({ sourceName, jsSource, cssSource, jsMetafile, cssMetafile, moduleOutputs }) {
  const sourcePath = path.join(WEB_UI_ROOT, sourceName);
  const documentName = path.basename(sourceName, '.html');
  const jsOutput = findOutputForEntry(jsMetafile, jsSource);
  const cssOutput = findOutputForEntry(cssMetafile, cssSource);
  const jsPath = outputPublicPath(jsOutput);
  const cssPath = outputPublicPath(cssOutput);
  const preloads = modulePreloads(jsMetafile, jsOutput);
  let html = fs.readFileSync(sourcePath, 'utf8');
  html = replaceLocalStyles(html, cssPath);
  const sourceEntry = sourceName === 'mobile.html' ? 'mobile/mobile-entry.js' : 'desktop-entry.js';
  const entryPattern = new RegExp(`src=["']\\/?src\\/${sourceEntry.replace('.', '\\.')}["']`, 'i');
  if (!entryPattern.test(html)) throw new Error(`[web-production] Missing ${sourceEntry} in ${sourceName}`);
  const preloadMarkup = preloads.map((href) => `<link rel="modulepreload" href="${href}">`).join('\n');
  html = html.replace(entryPattern, `src="${jsPath}"`);
  if (preloadMarkup) {
    html = html.replace(`<script type="module" src="${jsPath}">`, `${preloadMarkup}\n<script type="module" src="${jsPath}">`);
  }
  html = html.replace(
    '</head>',
    '<script>window.PROMETHEUS_PUBLIC_BUILD = true;</script>\n</head>',
  );
  html = await extractInlineScripts(html, documentName, moduleOutputs);
  fs.writeFileSync(path.join(OUT_ROOT, sourceName), html.replace(/\r\n/g, '\n'), 'utf8');
  return { html: `/${sourceName}`, js: jsPath, css: cssPath, modulePreloads: preloads };
}

function mergedMetafile(...metafiles) {
  return {
    inputs: Object.assign({}, ...metafiles.map((item) => item.inputs || {})),
    outputs: Object.assign({}, ...metafiles.map((item) => item.outputs || {})),
  };
}

function assetRecords(metafile) {
  const metadataByPublicPath = new Map();
  for (const [outputKey, metadata] of Object.entries(metafile.outputs || {})) {
    metadataByPublicPath.set(outputPublicPath(outputKey), { outputKey, metadata });
  }
  return walkFiles(BUILD_ROOT).map((filePath) => {
    const body = fs.readFileSync(filePath);
    const pathname = publicPath(filePath);
    const meta = metadataByPublicPath.get(pathname);
    const imports = (meta?.metadata?.imports || []).filter((item) => !item.external).map((item) => ({
      kind: item.kind,
      path: importPublicPath(meta.outputKey, item.path),
    }));
    return {
      path: pathname,
      bytes: body.length,
      gzipBytes: zlib.gzipSync(body, { level: 9 }).length,
      sha256: sha256(body),
      entryPoint: meta?.metadata?.entryPoint ? toPosix(meta.metadata.entryPoint) : null,
      imports,
    };
  });
}

function initialMetrics(paths, assets) {
  const wanted = new Set(paths);
  const selected = assets.filter((asset) => wanted.has(asset.path));
  const javascript = selected.filter((asset) => /\.m?js$/i.test(asset.path));
  const stylesheets = selected.filter((asset) => /\.css$/i.test(asset.path));
  return {
    paths: [...wanted].sort(),
    files: selected.length,
    bytes: selected.reduce((sum, asset) => sum + asset.bytes, 0),
    gzipBytes: selected.reduce((sum, asset) => sum + asset.gzipBytes, 0),
    jsBytes: javascript.reduce((sum, asset) => sum + asset.bytes, 0),
    jsGzipBytes: javascript.reduce((sum, asset) => sum + asset.gzipBytes, 0),
    cssBytes: stylesheets.reduce((sum, asset) => sum + asset.bytes, 0),
    cssGzipBytes: stylesheets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
  };
}

function documentBuildAssets(name) {
  const html = fs.readFileSync(path.join(OUT_ROOT, name), 'utf8');
  return [...html.matchAll(/\b(?:src|href)=["'](\/build\/[^"']+)["']/g)].map((match) => match[1]);
}

function injectServiceWorker(buildId, precache) {
  const sourcePath = path.join(WEB_UI_ROOT, 'service-worker.js');
  let source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
  const idSentinel = "const ASSET_BUILD_ID = 'source-build';";
  if (!source.includes(idSentinel)) throw new Error('[web-production] Service worker build sentinel is missing.');
  source = source.replace(idSentinel, `const ASSET_BUILD_ID = '${buildId}';`);
  const precacheSentinel = '  /*__PROM_BUILD_PRECACHE__*/';
  if (!source.includes(precacheSentinel)) throw new Error('[web-production] Service worker precache sentinel is missing.');
  const injected = [...new Set(precache)].sort().map((url) => `  ${JSON.stringify(url)},`).join('\n');
  source = source.replace(precacheSentinel, injected);
  fs.writeFileSync(path.join(OUT_ROOT, 'service-worker.js'), source, 'utf8');
}

function validateManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) throw new Error('[web-production] Missing generated asset-manifest.json.');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const expectedDigest = computeSourceDigest();
  if (manifest.sourceDigest !== expectedDigest) {
    throw new Error(`[web-production] Stale source digest: ${manifest.sourceDigest || '(missing)'} != ${expectedDigest}`);
  }
  for (const asset of manifest.assets || []) {
    const filePath = path.join(OUT_ROOT, String(asset.path || '').replace(/^\/+/, ''));
    if (!fs.existsSync(filePath)) throw new Error(`[web-production] Missing asset ${asset.path}`);
    const body = fs.readFileSync(filePath);
    if (body.length !== asset.bytes || sha256(body) !== asset.sha256) {
      throw new Error(`[web-production] Stale asset ${asset.path}`);
    }
  }
  for (const [name, entry] of Object.entries(manifest.entries || {})) {
    const htmlPath = path.join(OUT_ROOT, String(entry.html || '').replace(/^\/+/, ''));
    const html = fs.readFileSync(htmlPath, 'utf8');
    if (!html.includes(entry.js) || !html.includes(entry.css)) {
      throw new Error(`[web-production] ${name} document does not reference its manifest entry.`);
    }
    if (
      /\b(?:src|href)=["']\/?src\//i.test(html)
      || /\b(?:src|href)=["']\/?static\/[^"']+\.(?:css|m?js)(?:[?#][^"']*)?["']/i.test(html)
    ) {
      throw new Error(`[web-production] ${name} document still references raw modules or styles.`);
    }
  }
  const serviceWorker = fs.readFileSync(path.join(OUT_ROOT, 'service-worker.js'), 'utf8');
  if (!serviceWorker.includes(`const ASSET_BUILD_ID = '${manifest.buildId}';`)) {
    throw new Error('[web-production] Generated service worker build id is stale.');
  }
  console.log(`[web-production] manifest ${manifest.buildId} and ${manifest.assets.length} hashed assets are current`);
  return manifest;
}

async function buildProduction() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.rmSync(BUILD_ROOT, { recursive: true, force: true });
  fs.mkdirSync(BUILD_ROOT, { recursive: true });

  const jsEntries = {
    desktop: path.join(WEB_UI_ROOT, 'src', 'desktop-entry.js'),
    mobile: path.join(WEB_UI_ROOT, 'src', 'mobile', 'mobile-entry.js'),
    // Settings is invoked by the synchronous desktop shell shim before app.js
    // owns the page router, so expose it as an addressable lazy production
    // entry without putting it in the desktop boot closure.
    settings: path.join(WEB_UI_ROOT, 'src', 'pages', 'SettingsPage.js'),
  };
  const cssEntries = {
    desktop: path.join(WEB_UI_ROOT, 'src', 'styles', 'desktop-entry.css'),
    mobile: path.join(WEB_UI_ROOT, 'src', 'styles', 'mobile-entry.css'),
  };

  const common = {
    absWorkingDir: ROOT,
    bundle: true,
    legalComments: 'none',
    loader: {
      '.gif': 'file',
      '.jpeg': 'file',
      '.jpg': 'file',
      '.png': 'file',
      '.svg': 'file',
      '.webp': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    logLevel: 'warning',
    metafile: true,
    minify: true,
    outdir: BUILD_ROOT,
    platform: 'browser',
    target: ['chrome120', 'safari16.4'],
    write: true,
  };
  const jsResult = await esbuild.build({
    ...common,
    entryPoints: jsEntries,
    entryNames: 'entries/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'media/[name]-[hash]',
    external: ['/assets/*', '/vendor/*'],
    format: 'esm',
    splitting: true,
    treeShaking: true,
  });
  const generatedFontCssPath = path.join(OUT_ROOT, 'static', 'styles', 'fonts.css');
  const generatedFontCss = fs.existsSync(generatedFontCssPath)
    ? fs.readFileSync(generatedFontCssPath, 'utf8').replace(/url\(['"]?\.\.\/fonts\//g, "url('/static/fonts/")
    : '';
  const cssResult = await esbuild.build({
    ...common,
    entryPoints: cssEntries,
    entryNames: 'styles/[name]-[hash]',
    assetNames: 'media/[name]-[hash]',
    banner: { css: generatedFontCss },
    external: ['/assets/*'],
  });
  const metafile = mergedMetafile(jsResult.metafile, cssResult.metafile);
  const moduleOutputs = entryPointOutputMap(jsResult.metafile);
  const desktop = await buildDocument({
    sourceName: 'index.html',
    jsSource: jsEntries.desktop,
    cssSource: cssEntries.desktop,
    jsMetafile: jsResult.metafile,
    cssMetafile: cssResult.metafile,
    moduleOutputs,
  });
  const mobile = await buildDocument({
    sourceName: 'mobile.html',
    jsSource: jsEntries.mobile,
    cssSource: cssEntries.mobile,
    jsMetafile: jsResult.metafile,
    cssMetafile: cssResult.metafile,
    moduleOutputs,
  });

  const assets = assetRecords(metafile);
  const desktopOutput = findOutputForEntry(jsResult.metafile, jsEntries.desktop);
  const mobileOutput = findOutputForEntry(jsResult.metafile, jsEntries.mobile);
  const desktopDocumentAssets = documentBuildAssets('index.html');
  const mobileDocumentAssets = documentBuildAssets('mobile.html');
  const desktopInitialPaths = [...staticImportClosure(jsResult.metafile, desktopOutput), desktop.css, ...desktopDocumentAssets];
  const mobileInitialPaths = [...staticImportClosure(jsResult.metafile, mobileOutput, { includeMobileRouter: true }), mobile.css, ...mobileDocumentAssets];
  const sourceDigest = computeSourceDigest();
  const buildId = sourceDigest.slice(0, 16);
  const moduleOutputObject = Object.fromEntries(
    [...moduleOutputs.entries()]
      .map(([source, output]) => [toPosix(path.relative(WEB_UI_ROOT, source)), output])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const manifest = {
    schemaVersion: 1,
    buildId,
    sourceDigest,
    builder: { name: 'esbuild', version: esbuild.version, descriptor: BUILD_DESCRIPTOR },
    entries: { desktop, mobile },
    moduleOutputs: moduleOutputObject,
    initial: {
      desktop: initialMetrics(desktopInitialPaths, assets),
      mobile: initialMetrics(mobileInitialPaths, assets),
    },
    assets,
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  injectServiceWorker(buildId, [
    '/mobile/chat',
    '/mobile.html',
    '/asset-manifest.json',
    '/assets/Prometheus.png',
    ...mobileInitialPaths,
    ...mobileDocumentAssets,
  ]);

  console.log(JSON.stringify({ buildId, initial: manifest.initial, assets: assets.length }, null, 2));
  return manifest;
}

if (CHECK_ONLY) validateManifest();
else await buildProduction();
