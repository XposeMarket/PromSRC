const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

function readMeta(html, name, fallback) {
  const match = html.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, 'i'));
  return match ? match[1] : fallback;
}

function ffmpegCommand() {
  const candidates = [
    'ffmpeg',
    'C:\\Users\\rafel\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe',
  ];
  return candidates.find((candidate) => {
    if (candidate === 'ffmpeg') return true;
    return fs.existsSync(candidate);
  });
}

function browserExecutablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || undefined;
}

async function main() {
  const [inputArg, outputArg, fpsArg] = process.argv.slice(2);
  if (!inputArg || !outputArg) {
    throw new Error('Usage: node scripts/export-html-motion-mp4.js <input.html> <output.mp4> [fps]');
  }

  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg);
  const tmpPath = `${outputPath}.tmp.mp4`;
  const html = fs.readFileSync(inputPath, 'utf8');
  const width = Number(readMeta(html, 'prometheus:width', 1080));
  const height = Number(readMeta(html, 'prometheus:height', 1920));
  const durationMs = Number(readMeta(html, 'prometheus:duration', 18000));
  const fps = Math.max(1, Number(fpsArg || readMeta(html, 'prometheus:frameRate', 60)) || 60);
  const frameCount = Math.round((durationMs / 1000) * fps);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });

  const ffmpeg = spawn(ffmpegCommand(), [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-vcodec', 'mjpeg',
    '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    tmpPath,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutablePath(),
    args: ['--disable-gpu', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.goto(`file:///${inputPath.replace(/\\/g, '/')}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts?.ready || Promise.resolve());

    for (let frame = 0; frame < frameCount; frame += 1) {
      const timeMs = (frame / fps) * 1000;
      await page.evaluate((ms) => {
        window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__ = ms / 1000;
        window.__prometheusRender?.(ms);
        window.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', { detail: { timeMs: ms } }));
      }, timeMs);
      const image = await page.screenshot({ type: 'jpeg', quality: 94, fullPage: false });
      if (!ffmpeg.stdin.write(image)) {
        await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
      }
      if (frame % Math.max(1, fps) === 0) {
        process.stdout.write(`rendered ${frame}/${frameCount} frames\r`);
      }
    }
    process.stdout.write(`rendered ${frameCount}/${frameCount} frames\n`);
  } finally {
    await browser.close().catch(() => {});
    ffmpeg.stdin.end();
  }

  const exitCode = await new Promise((resolve) => ffmpeg.on('close', resolve));
  if (exitCode !== 0) {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
    throw new Error(`ffmpeg exited with code ${exitCode}`);
  }

  if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
  fs.renameSync(tmpPath, outputPath);
  const stats = fs.statSync(outputPath);
  console.log(`wrote ${outputPath} (${stats.size} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
