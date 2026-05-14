/**
 * composition_renderer.ts — Server-side composition renderer.
 *
 * Pipeline:
 *   1. For each clip on a video track: render PNG frames per lane
 *      - html-motion: Playwright loads the clip HTML, dispatches the
 *        prometheus-html-motion-seek event for each frame, screenshots.
 *      - remotion: @remotion/renderer renderFrames against the templateId.
 *   2. ffmpeg encodes each clip to an intermediate MP4 (h264 + faststart).
 *   3. ffmpeg concat demuxer stitches clips into one MP4.
 *   4. ffmpeg amix + afade muxes audio tracks into the master MP4.
 *
 * The renderer emits progress callbacks; callers wire those to the
 * creative-render-jobs broadcast channel.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import {
  type CreativeClip,
  type CreativeComposition,
  type CreativeAudioTrack,
} from '../contracts';
import { launchCreativeChromium } from '../playwright-runtime';

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

export type RenderProgress = (event: {
  phase: 'prepare' | 'frames' | 'encode' | 'concat' | 'mux' | 'done';
  clipId?: string;
  ratio?: number;
  message?: string;
}) => void;

export type RenderCompositionOptions = {
  composition: CreativeComposition;
  workspacePath: string;
  outputPath: string;
  format?: 'mp4' | 'webm';
  onProgress?: RenderProgress;
  videoBitrate?: string;
  audioBitrate?: string;
};

export type RenderCompositionResult = {
  outputPath: string;
  format: 'mp4' | 'webm';
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
  clipCount: number;
  audioTrackCount: number;
};

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function makeWorkdir(prefix: string): string {
  const base = path.join(os.tmpdir(), 'prometheus-composition');
  ensureDir(base);
  const workdir = fs.mkdtempSync(path.join(base, `${prefix}-`));
  return workdir;
}

function runFfmpeg(args: string[], onLog?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegInstaller.path, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onLog) text.split(/\r?\n/).forEach((line: string) => line && onLog(line));
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/**
 * Render frames for a single clip into outDir as frame_00001.png, frame_00002.png, ...
 * Returns the count of frames written.
 */
async function renderClipFrames(
  clip: CreativeClip,
  comp: CreativeComposition,
  workspacePath: string,
  outDir: string,
  onProgress?: RenderProgress,
): Promise<number> {
  ensureDir(outDir);
  const fps = Math.max(1, comp.frameRate);
  const clipDurationMs = Math.max(1, clip.outMs - clip.inMs);
  const frameCount = Math.max(1, Math.round((clipDurationMs / 1000) * fps));

  if (clip.lane === 'html-motion') {
    return renderHtmlMotionFrames(clip, comp, workspacePath, outDir, frameCount, fps, onProgress);
  }
  if (clip.lane === 'remotion') {
    return renderRemotionFrames(clip, comp, workspacePath, outDir, frameCount, fps, onProgress);
  }
  throw new Error(`Unknown clip lane: ${(clip as any).lane}`);
}

async function renderHtmlMotionFrames(
  clip: CreativeClip,
  comp: CreativeComposition,
  workspacePath: string,
  outDir: string,
  frameCount: number,
  fps: number,
  onProgress?: RenderProgress,
): Promise<number> {
  if (clip.source.kind !== 'html-motion') throw new Error('html-motion lane requires html-motion source');
  const clipPath = clip.source.clipPath;
  const absClipPath = path.isAbsolute(clipPath) ? clipPath : path.resolve(workspacePath, clipPath);
  if (!fs.existsSync(absClipPath)) throw new Error(`HTML Motion clip not found: ${absClipPath}`);

  const playwright = require('playwright');
  const browser = await launchCreativeChromium(playwright);
  try {
    const context = await browser.newContext({ viewport: { width: comp.width, height: comp.height } });
    const page = await context.newPage();
    await page.goto(`file://${absClipPath.replace(/\\/g, '/')}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);

    const frameDurationMs = 1000 / fps;
    for (let frame = 0; frame < frameCount; frame++) {
      const localTimeMs = clip.trimStartMs + frame * frameDurationMs;
      await page.evaluate((timeMs: number) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w: any = globalThis;
        const timeSeconds = timeMs / 1000;
        const seekTimelines = () => {
          try { if (typeof w.__PROM_HF_PATCH_TIMELINES__ === 'function') w.__PROM_HF_PATCH_TIMELINES__(); } catch {}
          try {
            const timelines = w.__timelines || {};
            Object.keys(timelines).forEach((key) => {
              const timeline = timelines[key];
              if (!timeline) return;
              if (typeof timeline.seek === 'function') timeline.seek(timeSeconds, false);
              else if (typeof timeline.totalTime === 'function') timeline.totalTime(timeSeconds, false);
              else if (typeof timeline.time === 'function') timeline.time(timeSeconds, false);
            });
          } catch {}
        };
        w.__PROMETHEUS_HTML_MOTION_TIME_MS__ = timeMs;
        w.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__ = timeSeconds;
        w.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', { detail: { timeMs, timeSeconds } }));
        try { w.postMessage({ source: 'hf-parent', action: 'seek', payload: { timeMs } }, '*'); } catch {}
        seekTimelines();
      }, localTimeMs);
      // Yield a frame so animation step settles
      await page.evaluate((timeMs: number) => new Promise((resolve: any) => {
        const w: any = globalThis;
        const timeSeconds = timeMs / 1000;
        w.requestAnimationFrame(() => {
          try {
            const timelines = w.__timelines || {};
            Object.keys(timelines).forEach((key) => {
              const timeline = timelines[key];
              if (!timeline) return;
              if (typeof timeline.seek === 'function') timeline.seek(timeSeconds, false);
              else if (typeof timeline.totalTime === 'function') timeline.totalTime(timeSeconds, false);
              else if (typeof timeline.time === 'function') timeline.time(timeSeconds, false);
            });
          } catch {}
          resolve(null);
        });
      }), localTimeMs);
      const filename = `frame_${String(frame + 1).padStart(6, '0')}.png`;
      await page.screenshot({ path: path.join(outDir, filename), type: 'png', animations: 'disabled', caret: 'hide', timeout: 45_000 });
      if (onProgress && frame % Math.max(1, Math.floor(frameCount / 20)) === 0) {
        onProgress({ phase: 'frames', clipId: clip.id, ratio: frame / frameCount });
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return frameCount;
}

async function renderRemotionFrames(
  clip: CreativeClip,
  comp: CreativeComposition,
  workspacePath: string,
  outDir: string,
  frameCount: number,
  fps: number,
  onProgress?: RenderProgress,
): Promise<number> {
  if (clip.source.kind !== 'remotion') throw new Error('remotion lane requires remotion source');
  const { renderFrames } = require('@remotion/renderer');
  const { bundle } = require('@remotion/bundler');
  // Reuse bundle cache directory
  const outBundleDir = path.join(workspacePath, '.prometheus', 'creative', 'remotion-bundles');
  ensureDir(outBundleDir);
  const entryPoint = path.resolve(process.cwd(), 'src', 'remotion', 'index.tsx');
  const serveUrl = await bundle({ entryPoint, outDir: outBundleDir, ignoreRegisterRootWarning: true });
  await renderFrames({
    composition: { id: clip.source.templateId, width: comp.width, height: comp.height, fps, durationInFrames: frameCount },
    serveUrl,
    inputProps: clip.source.input || {},
    outputDir: outDir,
    imageFormat: 'png',
    framesPerLane: undefined,
    onFrameUpdate: (n: number) => {
      if (onProgress && n % Math.max(1, Math.floor(frameCount / 20)) === 0) {
        onProgress({ phase: 'frames', clipId: clip.id, ratio: n / frameCount });
      }
    },
  } as any);
  return frameCount;
}

async function encodeFrames(framesDir: string, outFile: string, fps: number, format: 'mp4' | 'webm', onLog?: (line: string) => void): Promise<void> {
  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(framesDir, 'frame_%06d.png'),
    '-c:v', format === 'mp4' ? 'libx264' : 'libvpx-vp9',
    '-pix_fmt', 'yuv420p',
    ...(format === 'mp4' ? ['-movflags', '+faststart'] : []),
    outFile,
  ];
  await runFfmpeg(args, onLog);
}

async function concatVideos(segmentFiles: string[], outFile: string, format: 'mp4' | 'webm'): Promise<void> {
  const concatList = path.join(path.dirname(outFile), 'concat.txt');
  fs.writeFileSync(concatList, segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''").replace(/\\/g, '/')}'`).join('\n'), 'utf-8');
  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatList,
    '-c', 'copy',
    outFile,
  ];
  await runFfmpeg(args);
}

async function muxAudio(videoFile: string, audioTracks: CreativeAudioTrack[], workspacePath: string, outFile: string, format: 'mp4' | 'webm'): Promise<void> {
  if (!audioTracks.length) {
    fs.copyFileSync(videoFile, outFile);
    return;
  }
  const args: string[] = ['-y', '-i', videoFile];
  const filterParts: string[] = [];
  const audioInputs: string[] = [];
  let audioIdx = 0;
  for (const track of audioTracks) {
    const src = track.source;
    if (!src) continue;
    const absPath = path.isAbsolute(src) ? src : path.resolve(workspacePath, src);
    if (!fs.existsSync(absPath)) continue;
    args.push('-i', absPath);
    audioIdx += 1;
    const inputIdx = audioIdx; // 1, 2, 3 ... (0 is the video)
    const startSec = (Number(track.startMs) || 0) / 1000;
    const trimStart = (Number(track.trimStartMs) || 0) / 1000;
    const fadeInSec = (Number(track.fadeInMs) || 0) / 1000;
    const fadeOutSec = (Number(track.fadeOutMs) || 0) / 1000;
    const volume = Number(track.volume);
    const volumeLin = Number.isFinite(volume) ? Math.max(0, volume) : 1;
    const filters: string[] = [];
    if (trimStart > 0) filters.push(`atrim=start=${trimStart},asetpts=PTS-STARTPTS`);
    if (startSec > 0) filters.push(`adelay=${Math.round(startSec * 1000)}|${Math.round(startSec * 1000)}`);
    if (fadeInSec > 0) filters.push(`afade=t=in:st=${startSec}:d=${fadeInSec}`);
    if (fadeOutSec > 0) {
      const dur = (Number(track.durationMs) || 0) / 1000;
      const outStart = startSec + Math.max(0, dur - fadeOutSec);
      filters.push(`afade=t=out:st=${outStart}:d=${fadeOutSec}`);
    }
    if (volumeLin !== 1) filters.push(`volume=${volumeLin}`);
    if (track.muted) filters.push('volume=0');
    const chain = filters.length ? filters.join(',') : 'anull';
    filterParts.push(`[${inputIdx}:a]${chain}[a${inputIdx}]`);
    audioInputs.push(`[a${inputIdx}]`);
  }
  if (audioInputs.length === 0) {
    fs.copyFileSync(videoFile, outFile);
    return;
  }
  const mixFilter = audioInputs.length === 1
    ? `${audioInputs[0]}acopy[aout]`
    : `${audioInputs.join('')}amix=inputs=${audioInputs.length}:dropout_transition=0[aout]`;
  const filterComplex = [...filterParts, mixFilter].join(';');
  args.push(
    '-filter_complex', filterComplex,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', format === 'mp4' ? 'aac' : 'libopus',
    '-b:a', '192k',
    '-shortest',
    outFile,
  );
  await runFfmpeg(args);
}

export async function renderComposition(options: RenderCompositionOptions): Promise<RenderCompositionResult> {
  const { composition: comp, workspacePath, outputPath, onProgress } = options;
  const format: 'mp4' | 'webm' = options.format || 'mp4';

  // Filter to video-track clips, sorted left→right.
  const videoTrackIds = new Set(comp.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  const videoClips = comp.clips
    .filter((c) => videoTrackIds.has(c.trackId))
    .sort((a, b) => a.inMs - b.inMs);

  if (videoClips.length === 0) {
    throw new Error('Composition has no video clips to render.');
  }

  const workdir = makeWorkdir(comp.id);
  if (onProgress) onProgress({ phase: 'prepare', message: `workdir=${workdir}` });

  const segmentFiles: string[] = [];
  try {
    for (let i = 0; i < videoClips.length; i++) {
      const clip = videoClips[i];
      const clipFramesDir = path.join(workdir, `clip_${String(i).padStart(3, '0')}_frames`);
      const clipSegmentFile = path.join(workdir, `clip_${String(i).padStart(3, '0')}.${format}`);
      await renderClipFrames(clip, comp, workspacePath, clipFramesDir, onProgress);
      if (onProgress) onProgress({ phase: 'encode', clipId: clip.id });
      await encodeFrames(clipFramesDir, clipSegmentFile, comp.frameRate, format);
      segmentFiles.push(clipSegmentFile);
      // Free disk: delete frames after encode
      try { fs.rmSync(clipFramesDir, { recursive: true, force: true }); } catch {}
    }

    const concatFile = path.join(workdir, `concat.${format}`);
    if (onProgress) onProgress({ phase: 'concat' });
    if (segmentFiles.length === 1) {
      fs.copyFileSync(segmentFiles[0], concatFile);
    } else {
      await concatVideos(segmentFiles, concatFile, format);
    }

    if (onProgress) onProgress({ phase: 'mux' });
    ensureDir(path.dirname(outputPath));
    await muxAudio(concatFile, comp.audioTracks || [], workspacePath, outputPath, format);

    if (onProgress) onProgress({ phase: 'done', ratio: 1 });

    return {
      outputPath,
      format,
      durationMs: comp.durationMs,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      clipCount: videoClips.length,
      audioTrackCount: (comp.audioTracks || []).filter((t) => t.source).length,
    };
  } finally {
    // Best-effort cleanup. Keep the workdir on failure for debugging.
    try {
      if (fs.existsSync(workdir)) {
        fs.rmSync(workdir, { recursive: true, force: true });
      }
    } catch {}
  }
}
