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
import { wrapForIframePreview } from '../hyperframes-bridge';
import { resolveRuntimeBinary } from '../../../runtime/dependencies';

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
    const proc = spawn(resolveRuntimeBinary('ffmpeg', { allowPathFallback: true }), args, { windowsHide: true });
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

// Probe once per gateway lifetime. FFmpeg can list an encoder that is compiled in but
// unusable on the current machine, so only select hardware after a real one-frame encode.
let sourceVideoEncoderPromise: Promise<'h264_qsv' | 'h264_amf' | 'libx264'> | null = null;

async function canUseSourceVideoEncoder(encoder: 'h264_qsv' | 'h264_amf'): Promise<boolean> {
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1',
      '-frames:v', '1', '-c:v', encoder, '-f', 'null', '-',
    ]);
    return true;
  } catch {
    return false;
  }
}

async function selectSourceVideoEncoder(): Promise<'h264_qsv' | 'h264_amf' | 'libx264'> {
  if (!sourceVideoEncoderPromise) {
    sourceVideoEncoderPromise = (async () => {
      const requested = String(process.env.PROMETHEUS_CREATIVE_H264_ENCODER || '').trim().toLowerCase();
      if (requested === 'libx264') return 'libx264';
      if (requested === 'h264_qsv' || requested === 'h264_amf') {
        return (await canUseSourceVideoEncoder(requested)) ? requested : 'libx264';
      }
      // QSV is the faster verified hardware path on this machine; AMF is the fallback.
      if (await canUseSourceVideoEncoder('h264_qsv')) return 'h264_qsv';
      if (await canUseSourceVideoEncoder('h264_amf')) return 'h264_amf';
      return 'libx264';
    })();
  }
  return sourceVideoEncoderPromise;
}

function sourceVideoEncoderArgs(encoder: 'h264_qsv' | 'h264_amf' | 'libx264', format: 'mp4' | 'webm'): string[] {
  if (format !== 'mp4') return ['-c:v', 'libvpx-vp9'];
  if (encoder === 'libx264') {
    return ['-c:v', 'libx264', '-preset', process.env.PROMETHEUS_CREATIVE_X264_PRESET || 'veryfast', '-crf', process.env.PROMETHEUS_CREATIVE_X264_CRF || '20'];
  }
  // Hardware encoders do not share x264 CRF semantics. A bounded 2 Mbps VBR target
  // preserves readable text and dark footage far better than the previous ~800 kbps output.
  return ['-c:v', encoder, '-b:v', process.env.PROMETHEUS_CREATIVE_HW_VIDEO_BITRATE || '2M', '-maxrate', process.env.PROMETHEUS_CREATIVE_HW_VIDEO_MAXRATE || '2500k', '-bufsize', process.env.PROMETHEUS_CREATIVE_HW_VIDEO_BUFSIZE || '4M'];
}


function assTimestamp(ms: number): string {
  const centiseconds = Math.max(0, Math.round(ms / 10));
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/[\r\n]+/g, '\\N').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

function writeSourceVideoAss(comp: CreativeComposition, clip: CreativeClip, workdir: string): string | null {
  const captionTracks = Array.isArray(comp.captions) ? comp.captions : [];
  const lines: string[] = [];
  for (const track of captionTracks) {
    for (const segment of Array.isArray(track?.segments) ? track.segments : []) {
      const segmentStart = Number(segment?.startMs) || 0;
      const segmentEnd = Math.max(segmentStart + 1, Number(segment?.endMs) || segmentStart + 1);
      const startMs = Math.max(0, segmentStart - clip.inMs);
      const endMs = Math.min(clip.outMs - clip.inMs, segmentEnd - clip.inMs);
      if (endMs <= startMs) continue;
      const text = escapeAssText(segment?.text || (Array.isArray(segment?.words) ? segment.words.map((word: any) => word?.text).filter(Boolean).join(' ') : ''));
      if (text) lines.push(`Dialogue: 0,${assTimestamp(startMs)},${assTimestamp(endMs)},Caption,,0,0,0,,${text}`);
    }
  }
  if (!lines.length) return null;
  const assPath = path.join(workdir, `${clip.id}-captions.ass`);
  // Keep burned captions in the lower-middle safe zone: above Reels/TikTok controls,
  // descriptions, and account chrome, while retaining room for readable two-line copy.
  const marginV = Math.max(240, Math.round(comp.height * 0.30));
  const content = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${comp.width}\nPlayResY: ${comp.height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Caption,Arial,${Math.max(42, Math.round(comp.width / 17))},&H00FFFFFF,&H0000D7FF,&H00101010,&H9A000000,1,0,0,0,100,100,0,0,1,3,1,2,34,34,${marginV},1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${lines.join('\n')}\n`;
  fs.writeFileSync(assPath, content, 'utf8');
  return assPath;
}

function ffmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function renderSourceVideoSegment(
  clip: CreativeClip,
  comp: CreativeComposition,
  workspacePath: string,
  workdir: string,
  outFile: string,
  format: 'mp4' | 'webm',
  onProgress?: RenderProgress,
): Promise<void> {
  if (clip.source.kind !== 'source-video') throw new Error('source-video lane requires a source-video source.');
  const sourcePath = path.isAbsolute(clip.source.path) ? path.resolve(clip.source.path) : path.resolve(workspacePath, clip.source.path);
  ensureInside(workspacePath, sourcePath);
  if (!fs.existsSync(sourcePath)) throw new Error(`Source video not found: ${sourcePath}`);
  const durationMs = Math.max(1, clip.outMs - clip.inMs);
  const sourceStartMs = Math.max(0, Number(clip.trimStartMs) || 0);
  // Default to the direct phone-native crop used by the strongest first-pass clips.
  // Blurred-background remains available as an explicit editorial choice, not an
  // accidental padded fallback for every imported landscape source.
  const fit = clip.source.fit || 'cover';
  const background = String(clip.source.background || comp.background || '#000000').replace(/[^#(),.%a-zA-Z0-9\s-]/g, '') || '#000000';
  const filters: string[] = [];
  if (fit === 'cover') {
    filters.push(`[0:v]scale=${comp.width}:${comp.height}:force_original_aspect_ratio=increase,crop=${comp.width}:${comp.height}[vout]`);
  } else if (fit === 'contain') {
    filters.push(`[0:v]scale=${comp.width}:${comp.height}:force_original_aspect_ratio=decrease,pad=${comp.width}:${comp.height}:(ow-iw)/2:(oh-ih)/2:${background}[vout]`);
  } else {
    const scale = Math.max(0.1, Math.min(4, Number(clip.source.scale) || 1));
    const positionX = Math.max(0, Math.min(1, Number(clip.source.positionX) || 0.5));
    const positionY = Math.max(0, Math.min(1, Number(clip.source.positionY) || 0.5));
    filters.push(`[0:v]split=2[bgsource][fgsource]`);
    filters.push(`[bgsource]scale=${comp.width}:${comp.height}:force_original_aspect_ratio=increase,crop=${comp.width}:${comp.height},boxblur=20:10[bg]`);
    filters.push(`[fgsource]scale=${comp.width}:${comp.height}:force_original_aspect_ratio=decrease,scale=iw*${scale}:ih*${scale}[fg]`);
    filters.push(`[bg][fg]overlay=(W-w)*${positionX}:(H-h)*${positionY}[vout]`);
  }
  let current = 'vout';
  const transitionIn = clip.transitionIn && clip.transitionIn.kind !== 'cut' ? Math.min(durationMs / 2, Math.max(1, Number(clip.transitionIn.durationMs) || 0)) : 0;
  const transitionOut = clip.transitionOut && clip.transitionOut.kind !== 'cut' ? Math.min(durationMs / 2, Math.max(1, Number(clip.transitionOut.durationMs) || 0)) : 0;
  if (transitionIn > 0) {
    filters.push(`[${current}]fade=t=in:st=0:d=${(transitionIn / 1000).toFixed(3)}[vtransitionin]`);
    current = 'vtransitionin';
  }
  if (transitionOut > 0) {
    filters.push(`[${current}]fade=t=out:st=${Math.max(0, (durationMs - transitionOut) / 1000).toFixed(3)}:d=${(transitionOut / 1000).toFixed(3)}[vtransitionout]`);
    current = 'vtransitionout';
  }
  const hook = String(clip.source.hook || clip.meta?.hook || '').trim();
  if (hook) {
    const escapedHook = hook.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    // Hooks should establish the first beat, not become a permanent template banner.
    const hookDurationSec = Math.max(1.8, Math.min(3.2, durationMs / 1000 * 0.18)).toFixed(2);
    filters.push(`[${current}]drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='${escapedHook}':fontcolor=white:fontsize=${Math.max(32, Math.round(comp.width / 19))}:x=(w-text_w)/2:y=${Math.max(48, Math.round(comp.height * 0.06))}:box=1:boxcolor=black@0.62:boxborderw=18:enable='between(t,0,${hookDurationSec})'[vhook]`);
    current = 'vhook';
  }
  const assPath = writeSourceVideoAss(comp, clip, workdir);
  if (assPath) {
    filters.push(`[${current}]subtitles=filename='${ffmpegFilterPath(assPath)}'[vcaption]`);
    current = 'vcaption';
  }
  const buildArgs = (encoder: 'h264_qsv' | 'h264_amf' | 'libx264'): string[] => [
    '-y', '-ss', (sourceStartMs / 1000).toFixed(3), '-i', sourcePath,
    '-t', (durationMs / 1000).toFixed(3), '-filter_complex', filters.join(';'), '-map', `[${current}]`,
    ...((clip.source.kind !== 'source-video' || clip.source.preserveAudio !== false) ? ['-map', '0:a?'] : []),
    '-r', String(comp.frameRate),
    ...sourceVideoEncoderArgs(encoder, format),
    '-pix_fmt', 'yuv420p',
    ...(format === 'mp4' ? ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] : ['-c:a', 'libopus']),
    '-shortest', outFile,
  ];
  const encoder = format === 'mp4' ? await selectSourceVideoEncoder() : 'libx264';
  onProgress?.({ phase: 'encode', clipId: clip.id, message: `Rendering source video directly with FFmpeg (${encoder}).` });
  try {
    await runFfmpeg(buildArgs(encoder));
  } catch (error) {
    // Hardware support can change after startup (driver resets/docks). Keep the export reliable.
    if (format === 'mp4' && encoder !== 'libx264') {
      onProgress?.({ phase: 'encode', clipId: clip.id, message: `${encoder} failed; retrying direct source video with libx264.` });
      await runFfmpeg(buildArgs('libx264'));
      return;
    }
    throw error;
  }

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
  if (clip.lane === 'hyperframes') {
    return renderHyperframesFrames(clip, comp, workspacePath, outDir, frameCount, fps, onProgress);
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
      await page.evaluate(async (timeMs: number) => {
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
        let handled = false;
        try {
          if (typeof w.__promSeek === 'function') {
            const result = w.__promSeek(timeMs);
            if (result && typeof result.then === 'function') await result;
            handled = true;
          } else if (w.__hf && typeof w.__hf.seek === 'function') {
            const result = w.__hf.seek(timeSeconds);
            if (result && typeof result.then === 'function') await result;
            handled = true;
          }
        } catch {}
        w.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', { detail: { timeMs, timeSeconds } }));
        try {
          if (w.__promLastSeekPromise && typeof w.__promLastSeekPromise.then === 'function') {
            await w.__promLastSeekPromise;
          }
        } catch {}
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

function ensureInside(basePath: string, targetPath: string): void {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes composition workspace: ${target}`);
  }
}

function resolveHyperframesSourceHtml(clip: CreativeClip, workspacePath: string): string {
  if (clip.source.kind !== 'hyperframes') throw new Error('hyperframes lane requires hyperframes source');
  if (typeof clip.source.html === 'string' && clip.source.html.trim()) {
    return clip.source.html;
  }
  const projectPath = String(clip.source.projectPath || '').trim();
  if (!projectPath) throw new Error('HyperFrames clip requires source.html or source.projectPath');
  const absProjectPath = path.isAbsolute(projectPath) ? path.resolve(projectPath) : path.resolve(workspacePath, projectPath);
  ensureInside(workspacePath, absProjectPath);
  const entryFile = String(clip.source.entryFile || 'index.html').trim() || 'index.html';
  const entryPath = path.resolve(absProjectPath, entryFile);
  ensureInside(absProjectPath, entryPath);
  if (!fs.existsSync(entryPath)) throw new Error(`HyperFrames entry file not found: ${entryPath}`);
  return fs.readFileSync(entryPath, 'utf8');
}

async function seekHyperframesPage(page: any, timeMs: number): Promise<void> {
  await page.evaluate((ms: number) => {
    const w: any = globalThis;
    const seconds = ms / 1000;
    w.__PROMETHEUS_HTML_MOTION_TIME_MS__ = ms;
    w.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__ = seconds;
    try {
      if (w.__hf && typeof w.__hf.seek === 'function') {
        w.__hf.seek(seconds);
      }
    } catch {}
    try {
      w.dispatchEvent(new CustomEvent('hf-seek', { detail: { time: seconds, timeMs: ms } }));
    } catch {}
    try {
      w.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', { detail: { timeMs: ms, timeSeconds: seconds } }));
    } catch {}
    try {
      const timelines = w.__timelines || {};
      Object.keys(timelines).forEach((key) => {
        const timeline = timelines[key];
        if (!timeline) return;
        if (typeof timeline.seek === 'function') timeline.seek(seconds, false);
        else if (typeof timeline.totalTime === 'function') timeline.totalTime(seconds, false);
        else if (typeof timeline.time === 'function') timeline.time(seconds, false);
      });
    } catch {}
  }, timeMs);
  await page.evaluate((ms: number) => new Promise((resolve: any) => {
    const w: any = globalThis;
    const seconds = ms / 1000;
    w.requestAnimationFrame(() => {
      try {
        if (w.__hf && typeof w.__hf.seek === 'function') w.__hf.seek(seconds);
      } catch {}
      resolve(null);
    });
  }), timeMs);
}

async function renderHyperframesFrames(
  clip: CreativeClip,
  comp: CreativeComposition,
  workspacePath: string,
  outDir: string,
  frameCount: number,
  fps: number,
  onProgress?: RenderProgress,
): Promise<number> {
  const html = resolveHyperframesSourceHtml(clip, workspacePath);
  const entryPath = path.join(outDir, 'hyperframes-entry.html');
  fs.writeFileSync(entryPath, wrapForIframePreview(html), 'utf8');

  const playwright = require('playwright');
  const browser = await launchCreativeChromium(playwright);
  try {
    const context = await browser.newContext({ viewport: { width: comp.width, height: comp.height } });
    const page = await context.newPage();
    await page.goto(`file://${entryPath.replace(/\\/g, '/')}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);

    const frameDurationMs = 1000 / fps;
    for (let frame = 0; frame < frameCount; frame++) {
      const localTimeMs = clip.trimStartMs + frame * frameDurationMs;
      await seekHyperframesPage(page, localTimeMs);
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
      if (clip.lane === 'source-video') {
        await renderSourceVideoSegment(clip, comp, workspacePath, workdir, clipSegmentFile, format, onProgress);
      } else {
        await renderClipFrames(clip, comp, workspacePath, clipFramesDir, onProgress);
        if (onProgress) onProgress({ phase: 'encode', clipId: clip.id });
        await encodeFrames(clipFramesDir, clipSegmentFile, comp.frameRate, format);
        // Free disk: delete frames after encode
        try { fs.rmSync(clipFramesDir, { recursive: true, force: true }); } catch {}
      }
      segmentFiles.push(clipSegmentFile);
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
