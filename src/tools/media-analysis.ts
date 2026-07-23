import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '../types.js';

import { getActiveWorkspace } from './workspace-context.js';
import { getProvider, getPrimaryModel } from '../providers/factory.js';
import { contentToString } from '../providers/content-utils.js';
import { buildVisionImagePart, primarySupportsVision } from '../gateway/vision-chat.js';
import { resolveRuntimeBinary } from '../runtime/dependencies.js';
import { creativeTranscribeAudio } from '../gateway/creative/generative-pipeline.js';
import { getConfig } from '../config/config.js';

const execFileAsync = promisify(execFile);

type AnalyzeImageArgs = {
  file_path: string;
  prompt?: string;
};

export type MediaAnalysisProgress = {
  phase: string;
  message: string;
  current?: number;
  total?: number;
};

type AnalyzeVideoArgs = {
  file_path: string;
  prompt?: string;
  analysis_mode?: 'quick' | 'detail' | 'both';
  sample_count?: number;
  quick_sample_count?: number;
  detail_frame_budget?: number;
  max_detail_frames?: number;
  output_dir?: string;
  extract_audio?: boolean;
  transcribe?: boolean;
  include_raw_probe?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: MediaAnalysisProgress) => void;
};

export type VisionFrameInput = {
  dataUrl?: string;
  base64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  atMs?: number | null;
};

type PythonRunner = {
  cmd: string;
  preArgs: string[];
};

function getWorkspaceRoot(): string {
  const globalWorkspace = getConfig().getConfig().workspace.path;
  return getActiveWorkspace(globalWorkspace);
}

function ensureWorkspacePath(workspaceRoot: string, requested: string): string {
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(path.join(workspaceRoot, requested));
  const rel = path.relative(workspaceRoot, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${requested}" is outside workspace.`);
  }
  return candidate;
}

function sanitizeStem(input: string): string {
  return String(input || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'media';
}

function inferMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
function buildCreativeStorage() {
  const workspacePath = getWorkspaceRoot();
  const rootAbsPath = path.join(workspacePath, 'creative-projects', 'default');
  const creativeDir = path.join(rootAbsPath, 'prometheus-creative');
  require('fs').mkdirSync(creativeDir, { recursive: true });
  const rootRelPath = 'creative-projects/default';
  return { workspacePath, rootAbsPath, rootRelPath, creativeDir };
}

function normalizeAnalysisMode(value?: unknown): 'quick' | 'detail' | 'both' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'detail' || raw === 'detailed' || raw === 'deep') return 'detail';
  if (raw === 'both' || raw === 'quick+detail' || raw === 'quick_detail') return 'both';
  return 'quick';
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function relPath(workspaceRoot: string, absPath: string): string {
  return path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
}

function parseJsonFromStdout(stdout: string): any {
  const text = String(stdout || '').trim();
  if (!text) throw new Error('Analyzer returned empty stdout.');
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('Analyzer did not return valid JSON.');
    }
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  }
}

async function detectPythonRunner(signal?: AbortSignal): Promise<PythonRunner | null> {
  const candidates: PythonRunner[] = [
    { cmd: 'python', preArgs: [] },
    { cmd: 'py', preArgs: ['-3'] },
    { cmd: 'python3', preArgs: [] },
  ];

  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || '';
  const directCandidates = [
    process.env.PYTHON,
    process.env.PYTHON_EXE,
    localAppData ? path.join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe') : '',
    localAppData ? path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe') : '',
    localAppData ? path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe') : '',
    programFiles ? path.join(programFiles, 'Python313', 'python.exe') : '',
    programFiles ? path.join(programFiles, 'Python312', 'python.exe') : '',
  ].filter(Boolean) as string[];

  for (const candidate of directCandidates) {
    if (signal?.aborted) throw new Error('video analysis canceled by user');
    try {
      if (!fs.existsSync(candidate)) continue;
      await execFileAsync(candidate, ['--version'], {
        timeout: 8_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        signal,
      });
      return { cmd: candidate, preArgs: [] };
    } catch {
      if (signal?.aborted) throw new Error('video analysis canceled by user');
      // try next candidate
    }
  }

  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error('video analysis canceled by user');
    try {
      await execFileAsync(candidate.cmd, [...candidate.preArgs, '--version'], {
        timeout: 8_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        signal,
      });
      return candidate;
    } catch {
      if (signal?.aborted) throw new Error('video analysis canceled by user');
      // try next runner
    }
  }
  return null;
}

function compactTranscriptionError(error: unknown): string {
  const text = String((error as any)?.message || error || '').replace(/\s+/g, ' ').trim();
  if (/quota|usage.limit|billing/i.test(text)) return 'Configured cloud transcription is unavailable because its quota or billing limit was reached.';
  if (/auth|unauthorized|api.key|access.token/i.test(text)) return 'Configured cloud transcription is unavailable because authentication failed.';
  return text.slice(0, 220) || 'Configured cloud transcription was unavailable.';
}

const MEDIA_PROCESS_MAX_BUFFER = 16 * 1024 * 1024;

function stopMediaProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode != null) return;
  try { child.kill('SIGTERM'); } catch {}
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.unref();
    } catch {}
  }
}

export async function runMediaProcess(options: {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: MediaAnalysisProgress) => void;
  keepalive?: MediaAnalysisProgress;
}): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw new Error('video analysis canceled by user');
  return await new Promise((resolve, reject) => {
    const child = spawn(options.cmd, options.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stderrLines = '';
    let settled = false;
    const appendBounded = (current: string, chunk: Buffer | string) => {
      const next = current + String(chunk);
      return next.length > MEDIA_PROCESS_MAX_BUFFER ? next.slice(-MEDIA_PROCESS_MAX_BUFFER) : next;
    };
    const emit = (progress: MediaAnalysisProgress) => {
      try { options.onProgress?.(progress); } catch {}
    };
    const inspectProgressLine = (line: string) => {
      const marker = '__PROMETHEUS_PROGRESS__';
      const at = line.indexOf(marker);
      if (at < 0) return;
      try {
        const parsed = JSON.parse(line.slice(at + marker.length));
        if (parsed?.message) emit({
          phase: String(parsed.phase || 'working'),
          message: String(parsed.message),
          current: Number.isFinite(Number(parsed.current)) ? Number(parsed.current) : undefined,
          total: Number.isFinite(Number(parsed.total)) ? Number(parsed.total) : undefined,
        });
      } catch {}
    };
    const cleanup = () => {
      clearTimeout(timeout);
      if (keepalive) clearInterval(keepalive);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      stopMediaProcess(child);
      fail(new Error('video analysis canceled by user'));
    };
    const timeout = setTimeout(() => {
      stopMediaProcess(child);
      fail(new Error(`media analysis process timed out after ${Math.round(options.timeoutMs / 60_000)} minutes`));
    }, options.timeoutMs);
    timeout.unref?.();
    const keepalive = options.keepalive ? setInterval(() => emit(options.keepalive!), 10_000) : null;
    keepalive?.unref?.();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
      stderrLines += String(chunk);
      const lines = stderrLines.split(/\r?\n|\r/g);
      stderrLines = lines.pop() || '';
      lines.forEach(inspectProgressLine);
    });
    child.once('error', fail);
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (stderrLines) inspectProgressLine(stderrLines);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`media analysis process exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}: ${String(stderr || stdout).slice(-1500)}`));
    });
  });
}

async function transcribeWithLocalWhisper(sourcePath: string, options: {
  signal?: AbortSignal;
  onProgress?: (progress: MediaAnalysisProgress) => void;
} = {}): Promise<string> {
  const runner = await detectPythonRunner(options.signal);
  if (!runner) return '';
  const python = [
    'import json, sys, whisper',
    "model = whisper.load_model('tiny')",
    "result = model.transcribe(sys.argv[1], fp16=False)",
    "print(json.dumps({'text': str(result.get('text', '')).strip()}))",
  ].join('; ');
  const ffmpegPath = resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
  const { stdout } = await runMediaProcess({
    cmd: runner.cmd,
    args: [...runner.preArgs, '-c', python, sourcePath],
    timeoutMs: 3 * 60 * 1000,
    signal: options.signal,
    onProgress: options.onProgress,
    keepalive: { phase: 'transcribing', message: 'Transcribing audio locally…' },
    env: {
      ...process.env,
      PATH: [path.dirname(ffmpegPath), process.env.PATH || ''].filter(Boolean).join(path.delimiter),
    },
  });
  return String(parseJsonFromStdout(stdout)?.text || '').trim();
}

async function runVideoAnalyzer(scriptPath: string, args: string[], options: {
  signal?: AbortSignal;
  onProgress?: (progress: MediaAnalysisProgress) => void;
} = {}): Promise<any> {
  const runner = await detectPythonRunner(options.signal);
  if (!runner) throw new Error('Python was not found on this machine.');
  const ffmpegPath = resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
  const ffprobePath = resolveRuntimeBinary('ffprobe', { allowPathFallback: true });
  const { stdout } = await runMediaProcess({
      cmd: runner.cmd,
      args: [...runner.preArgs, scriptPath, '--ffmpeg', ffmpegPath, '--ffprobe', ffprobePath, ...args],
      cwd: path.dirname(scriptPath),
      env: {
        ...process.env,
        PROMETHEUS_FFMPEG_PATH: ffmpegPath,
        PROMETHEUS_FFPROBE_PATH: ffprobePath,
      },
      timeoutMs: 10 * 60 * 1000,
      signal: options.signal,
      onProgress: options.onProgress,
      keepalive: { phase: 'extracting_frames', message: 'Extracting video frames…' },
    });
  return parseJsonFromStdout(stdout);
}

async function readFileAsVisionPart(filePath: string): Promise<any> {
  const mimeType = inferMimeType(filePath);
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Unsupported image type for vision: ${path.basename(filePath)}`);
  }
  const base64 = (await fsp.readFile(filePath)).toString('base64');
  return buildVisionImagePart(base64, mimeType);
}

async function analyzeWithPrimaryVision(messages: any[], options: { maxTokens?: number; think?: 'none' | 'minimal' | 'low' | 'medium' | 'high' } = {}): Promise<string> {
  if (!primarySupportsVision()) {
    throw new Error('The active primary model is not vision-capable. Switch to a vision-capable model first.');
  }
  const provider = getProvider();
  const model = getPrimaryModel();
  const result = await provider.chat(messages, model, {
    temperature: 0.2,
    max_tokens: options.maxTokens || 900,
    think: options.think || 'low',
  });
  return contentToString(result.message.content).trim();
}

function parseVisionFrame(frame: VisionFrameInput): { base64: string; mimeType: string; width?: number; height?: number; atMs?: number | null } | null {
  const dataUrl = String(frame?.dataUrl || '').trim();
  if (dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
      mimeType: match[1] || 'image/png',
      base64: match[2] || '',
      width: Number(frame?.width || 0) || undefined,
      height: Number(frame?.height || 0) || undefined,
      atMs: frame?.atMs,
    };
  }
  const base64 = String(frame?.base64 || '').trim();
  if (!base64) return null;
  return {
    mimeType: String(frame?.mimeType || 'image/png').trim() || 'image/png',
    base64,
    width: Number(frame?.width || 0) || undefined,
    height: Number(frame?.height || 0) || undefined,
    atMs: frame?.atMs,
  };
}

export async function executeAnalyzeVisionFrames(args: {
  frames: VisionFrameInput[];
  prompt?: string;
  mode?: 'image' | 'video' | string;
}): Promise<ToolResult> {
  try {
    const frames = (Array.isArray(args?.frames) ? args.frames : [])
      .map(parseVisionFrame)
      .filter(Boolean)
      .slice(0, 6) as Array<{ base64: string; mimeType: string; width?: number; height?: number; atMs?: number | null }>;
    if (!frames.length) return { success: false, error: 'No visual frames were provided for analysis.' };
    const mode = String(args?.mode || 'creative').trim().toLowerCase();
    const userPrompt = String(args?.prompt || '').trim();
    const frameLabels = frames.map((frame, index) => (
      `#${index + 1}: ${frame.width || '?'}x${frame.height || '?'}${Number.isFinite(Number(frame.atMs)) ? ` @ ${frame.atMs}ms` : ''}`
    )).join(', ');
    const content: any[] = [
      {
        type: 'text',
        text:
          `${userPrompt || 'Analyze these rendered creative editor frames and critique the output before it is presented.'}\n` +
          `Creative mode: ${mode}\nFrames: ${frameLabels}\n\n` +
          'Be direct. Identify visible design/video problems, including unreadable text, overlap, cramped layout, poor contrast, bad framing, wrong aspect ratio, cheap/repetitive composition, timing issues, blank areas, and export readiness. Include concrete fixes.',
      },
      ...frames.map((frame) => buildVisionImagePart(frame.base64, frame.mimeType)),
    ];
    const analysis = await analyzeWithPrimaryVision([
      {
        role: 'system',
        content:
          'You are Prometheus Creative QA. You inspect rendered canvas/video frames with a professional designer/video editor eye. ' +
          'Do not flatter. If the output looks bad, say exactly why. Return concise markdown with sections: Verdict, Problems, Concrete Fixes, Export Readiness.',
      },
      { role: 'user', content },
    ]);
    return {
      success: true,
      stdout: analysis,
      data: {
        mode,
        frame_count: frames.length,
        frames: frames.map(({ width, height, atMs, mimeType }) => ({ width, height, atMs, mimeType })),
        analysis,
      },
    };
  } catch (error: any) {
    return { success: false, error: `creative visual analysis failed: ${String(error?.message || error)}` };
  }
}

export async function executeAnalyzeImage(args: AnalyzeImageArgs): Promise<ToolResult> {
  const workspaceRoot = getWorkspaceRoot();
  const requestedPath = String(args?.file_path || '').trim();
  if (!requestedPath) return { success: false, error: 'file_path is required' };

  try {
    const absPath = ensureWorkspacePath(workspaceRoot, requestedPath);
    if (!fs.existsSync(absPath)) return { success: false, error: `File not found: ${requestedPath}` };
    if (!fs.statSync(absPath).isFile()) return { success: false, error: `"${requestedPath}" is not a file` };

    const userPrompt = String(args?.prompt || '').trim();
    const analysis = await analyzeWithPrimaryVision([
      {
        role: 'system',
        content:
          'You are a grounded media analyst. Describe only what is visibly present in the image. ' +
          'If text is visible, transcribe it. If something is uncertain, say so clearly. ' +
          'Return concise markdown with sections: Summary, Key Details, Visible Text, Uncertainty.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `${userPrompt || 'Analyze this image and explain what is visible.'}\n` +
              `Image file: ${path.basename(absPath)}`,
          },
          await readFileAsVisionPart(absPath),
        ],
      },
    ]);

    const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
    return {
      success: true,
      stdout: analysis,
      data: {
        file_path: absPath,
        rel_path: relPath,
        mime_type: inferMimeType(absPath),
        analysis,
      },
    };
  } catch (error: any) {
    return { success: false, error: `analyze_image failed: ${String(error?.message || error)}` };
  }
}

export async function executeAnalyzeVideo(args: AnalyzeVideoArgs): Promise<ToolResult> {
  const workspaceRoot = getWorkspaceRoot();
  const requestedPath = String(args?.file_path || '').trim();
  if (!requestedPath) return { success: false, error: 'file_path is required' };

  try {
    args.onProgress?.({ phase: 'starting', message: 'Preparing video analysis…' });
    if (args.signal?.aborted) throw new Error('video analysis canceled by user');
    const absPath = ensureWorkspacePath(workspaceRoot, requestedPath);
    if (!fs.existsSync(absPath)) return { success: false, error: `File not found: ${requestedPath}` };
    if (!fs.statSync(absPath).isFile()) return { success: false, error: `"${requestedPath}" is not a file` };

    const bundledScriptPath = path.resolve(process.cwd(), 'scripts', 'video_analyze.py');
    const scriptPath = fs.existsSync(path.join(workspaceRoot, 'video_analyze.py'))
      ? path.join(workspaceRoot, 'video_analyze.py')
      : bundledScriptPath;
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: `video analyzer script not found at ${path.join(workspaceRoot, 'video_analyze.py')} or ${bundledScriptPath}` };
    }

    const analysisMode = normalizeAnalysisMode(args?.analysis_mode);
    const sampleCount = boundedNumber(args?.sample_count, 6, 2, 24);
    const quickSampleCount = boundedNumber(args?.quick_sample_count ?? args?.sample_count, analysisMode === 'quick' ? sampleCount : 16, 2, 24);
    const detailFrameBudget = Number.isFinite(Number(args?.detail_frame_budget))
      ? boundedNumber(args?.detail_frame_budget, 0, 2, 72)
      : 0;
    const maxDetailFrames = boundedNumber(args?.max_detail_frames ?? args?.detail_frame_budget, 42, 2, 72);
    const defaultOutputDir = path.join('downloads', 'video_analysis', sanitizeStem(path.basename(absPath, path.extname(absPath))));
    const outputDirRel = String(args?.output_dir || defaultOutputDir).trim();
    const outputDirAbs = ensureWorkspacePath(workspaceRoot, outputDirRel);
    await fsp.mkdir(outputDirAbs, { recursive: true });

    const analyzerArgs = [
      absPath,
      '--output-dir',
      outputDirAbs,
      '--mode',
      analysisMode,
      '--samples',
      String(sampleCount),
      '--quick-samples',
      String(quickSampleCount),
      '--max-detail-frames',
      String(maxDetailFrames),
    ];
    if (detailFrameBudget > 0) analyzerArgs.push('--detail-samples', String(detailFrameBudget));
    if (args?.extract_audio !== false) analyzerArgs.push('--extract-audio');
    if (args?.transcribe !== false) analyzerArgs.push('--transcribe');

    const analyzerResult = await runVideoAnalyzer(scriptPath, analyzerArgs, {
      signal: args.signal,
      onProgress: args.onProgress,
    });
    const videoSummary = analyzerResult?.video_summary || {};
    const framePaths = Array.isArray(videoSummary?.written)
      ? videoSummary.written.filter((value: unknown) => typeof value === 'string')
      : [];
    if (framePaths.length === 0) {
      return {
        success: false,
        error: 'Video extraction completed but no sample frames were produced.',
      };
    }

    const transcriptionRequested = args?.transcribe !== false;
    let transcript = analyzerResult?.transcript?.available ? String(analyzerResult.transcript.text || '').trim() : '';
    let transcriptionProvider = transcript ? 'local' : null;
    let transcriptionNote = transcriptionRequested ? 'No transcript was produced.' : 'Transcription was not requested.';

    if (!transcript && transcriptionRequested) {
      try {
        args.onProgress?.({ phase: 'transcribing', message: 'Transcribing audio with the configured speech service…' });
        const storage = buildCreativeStorage();
        const result = await creativeTranscribeAudio(storage, {
          source: absPath,
          provider: 'openai',
          signal: args.signal,
        });
        transcript = String(result.text || '').trim();
        transcriptionProvider = transcript ? String(result.provider || 'openai') : null;
        transcriptionNote = transcript ? 'Transcript produced by the configured speech-to-text provider.' : 'Speech-to-text completed but returned no text.';
      } catch (error: any) {
        if (args.signal?.aborted) throw new Error('video analysis canceled by user');
        const cloudFailure = compactTranscriptionError(error);
        try {
          const localSource = analyzerResult?.audio?.path && fs.existsSync(analyzerResult.audio.path)
            ? String(analyzerResult.audio.path)
            : absPath;
          args.onProgress?.({ phase: 'transcribing', message: 'Cloud transcription unavailable; transcribing audio locally…' });
          transcript = await transcribeWithLocalWhisper(localSource, {
            signal: args.signal,
            onProgress: args.onProgress,
          });
          transcriptionProvider = transcript ? 'local-whisper-tiny' : null;
          transcriptionNote = transcript
            ? 'Configured cloud speech-to-text was unavailable; transcript produced locally with Whisper tiny.'
            : `${cloudFailure} Local Whisper returned no speech.`;
        } catch (localError: any) {
          transcriptionNote = `${cloudFailure} Local Whisper unavailable: ${compactTranscriptionError(localError)}`.slice(0, 320);
          console.warn(`Local transcription fallback failed for ${absPath}:`, localError);
        }
      }
    }
    
    const relFrames = framePaths.map((framePath: string) => relPath(workspaceRoot, framePath));
    const quick = videoSummary?.quick || null;
    const detail = videoSummary?.detail || null;
    const contactSheets = [
      quick?.contact_sheet,
      detail?.contact_sheet,
      ...(Array.isArray(detail?.batch_sheets) ? detail.batch_sheets : []),
    ].filter((sheet: any) => sheet?.path && fs.existsSync(sheet.path));
    const visualSheetPaths = contactSheets.map((sheet: any) => String(sheet.path)).slice(0, 8);
    const fallbackFramePaths = visualSheetPaths.length
      ? []
      : framePaths.slice(0, analysisMode === 'quick' ? 8 : 12);
    const prompt = String(args?.prompt || '').trim();
    const durationSeconds = videoSummary?.duration_seconds ?? analyzerResult?.probe?.json?.format?.duration ?? 'unknown';
    const probeJson = analyzerResult?.probe?.json || {};
    const streams = Array.isArray(probeJson?.streams) ? probeJson.streams : [];
    const videoStream = streams.find((stream: any) => stream?.codec_type === 'video') || null;
    const audioStream = streams.find((stream: any) => stream?.codec_type === 'audio') || null;
    const technicalSummary = {
      duration_seconds: Number(durationSeconds) || null,
      container: String(probeJson?.format?.format_name || '').trim() || null,
      size_bytes: Number(probeJson?.format?.size) || null,
      bitrate_bps: Number(probeJson?.format?.bit_rate) || null,
      video: videoStream ? {
        codec: videoStream.codec_name || null,
        width: Number(videoStream.width) || null,
        height: Number(videoStream.height) || null,
        frame_rate: videoStream.avg_frame_rate || videoStream.r_frame_rate || null,
        pixel_format: videoStream.pix_fmt || null,
      } : null,
      audio: audioStream ? {
        codec: audioStream.codec_name || null,
        sample_rate_hz: Number(audioStream.sample_rate) || null,
        channels: Number(audioStream.channels) || null,
      } : null,
    };
    const technicalLine = `Technical metadata: ${JSON.stringify(technicalSummary)}`;
    const detailPlan = detail?.sampling_plan
      ? `\nDetail sampling plan: ${JSON.stringify(detail.sampling_plan)}`
      : '';

    const userContent: any[] = [
      {
        type: 'text',
        text:
          `${prompt || 'Analyze this video from sampled frames and optional transcript.'}\n` +
          `Video file: ${path.basename(absPath)}\n` +
          `Analysis mode: ${analysisMode}\n` +
          `Duration: ${durationSeconds} seconds\n` +
          `${technicalLine}\n` +
          `Frame samples extracted: ${framePaths.length}\n` +
          `Contact sheets provided: ${visualSheetPaths.length}${detailPlan}\n` +
          `If transcript is missing, rely on the visuals and say audio/transcript was unavailable.\n` +
          `For quick mode, summarize the video from the contact sheet. For detail/both mode, read the overview sheet plus detail batch sheets as a chronological scan across the clip.`,
      },
    ];

    for (let idx = 0; idx < visualSheetPaths.length; idx += 1) {
      const sheet = contactSheets[idx] || {};
      userContent.push({
        type: 'text',
        text: `Contact sheet ${idx + 1} of ${visualSheetPaths.length}: ${path.basename(visualSheetPaths[idx])}${sheet.frame_count ? ` (${sheet.frame_count} frames)` : ''}`,
      });
      userContent.push(await readFileAsVisionPart(visualSheetPaths[idx]));
    }

    for (let idx = 0; idx < fallbackFramePaths.length; idx += 1) {
      userContent.push({
        type: 'text',
        text: `Frame ${idx + 1} of ${fallbackFramePaths.length}: ${path.basename(fallbackFramePaths[idx])}`,
      });
      userContent.push(await readFileAsVisionPart(fallbackFramePaths[idx]));
    }

    if (transcript) {
      userContent.push({
        type: 'text',
        text: `Transcript:\n${transcript.slice(0, 12000)}`,
      });
    }

    args.onProgress?.({ phase: 'analyzing', message: 'Analyzing the sampled frames and transcript…' });
    const analysis = await analyzeWithPrimaryVision([
      {
        role: 'system',
        content:
          'You are a grounded video analyst working from sampled frames and an optional transcript. ' +
          'Infer cautiously across time. Contact sheets show multiple timestamped frames at once; use them for broad coverage, and do not claim frame-perfect playback unless dense detail frames were provided. ' +
          'Return concise markdown with sections: Overall Summary, Timeline, Visible Text, Audio/Transcript, Key Objects or People, Uncertainty.',
      },
      {
        role: 'user',
        content: userContent,
      },
    ], { maxTokens: 1100, think: 'low' });

    const compactExtraction: any = {
      ok: analyzerResult?.ok === true,
      video_summary: {
        duration_seconds: Number(durationSeconds) || null,
        mode: String(videoSummary?.mode || analysisMode),
        frame_count: framePaths.length,
        errors: Array.isArray(videoSummary?.errors) ? videoSummary.errors.slice(0, 8) : [],
      },
      audio: {
        requested: analyzerResult?.audio?.requested === true,
        available: analyzerResult?.audio?.available === true,
        rel_path: analyzerResult?.audio?.path ? relPath(workspaceRoot, String(analyzerResult.audio.path)) : null,
        error: analyzerResult?.audio?.error ? String(analyzerResult.audio.error).slice(0, 500) : null,
      },
      technical: technicalSummary,
    };
    if (args?.include_raw_probe === true) compactExtraction.raw_probe = probeJson;

    args.onProgress?.({ phase: 'complete', message: 'Video analysis complete.' });
    return {
      success: true,
      stdout: analysis,
      data: {
        file_path: absPath,
        rel_path: path.relative(workspaceRoot, absPath).replace(/\\/g, '/'),
        output_dir: outputDirAbs,
        output_dir_rel: relPath(workspaceRoot, outputDirAbs),
        analysis_mode: analysisMode,
        sample_count: framePaths.length,
        sample_frames: relFrames,
        contact_sheets: contactSheets.map((sheet: any) => ({
          ...sheet,
          rel_path: relPath(workspaceRoot, String(sheet.path)),
        })),
        detail_sampling_plan: detail?.sampling_plan || null,
        transcript: transcript || null,
        transcription: {
          requested: transcriptionRequested,
          available: Boolean(transcript),
          provider: transcriptionProvider,
          note: transcriptionNote,
        },
        extraction: compactExtraction,
        analysis,
      },
    };
  } catch (error: any) {
    return { success: false, error: `analyze_video failed: ${String(error?.message || error)}` };
  }
}

export const analyzeImageTool = {
  name: 'analyze_image',
  description: 'Analyze a local image file using the active vision-capable model and describe what is visible.',
  execute: executeAnalyzeImage,
  schema: {
    file_path: 'Workspace-relative or absolute path to the image file',
    prompt: 'Optional analysis prompt or focus instruction',
  },
  jsonSchema: {
    type: 'object',
    required: ['file_path'],
    properties: {
      file_path: { type: 'string', description: 'Workspace-relative or absolute path to the image file' },
      prompt: { type: 'string', description: 'Optional analysis prompt or focus instruction' },
    },
    additionalProperties: false,
  },
};

export const analyzeVideoTool = {
  name: 'analyze_video',
  description: 'Analyze a local video by extracting sample frames and optional audio transcript, then using the active vision-capable model to summarize it.',
  execute: executeAnalyzeVideo,
  schema: {
    file_path: 'Workspace-relative or absolute path to the video file',
    prompt: 'Optional analysis prompt or focus instruction',
    analysis_mode: 'quick creates an overview contact sheet, detail creates budgeted chronological batches, both does both',
    sample_count: 'Backward-compatible sample count for quick mode (default 6, max 24)',
    quick_sample_count: 'How many frames to include in the quick contact sheet (default 16, max 24)',
    detail_frame_budget: 'Optional number of detail frames to extract across the full duration. Leave unset to let the Python analyzer choose from duration.',
    max_detail_frames: 'Hard cap for auto detail extraction (default 42, max 72)',
    output_dir: 'Optional workspace-relative output directory for extracted artifacts',
    extract_audio: 'If true, extract audio when ffmpeg is available (default true)',
    transcribe: 'If true, use the configured speech-to-text provider when audio is available (default true)',
    include_raw_probe: 'If true, include full ffprobe JSON; default false keeps output compact',
  },
  jsonSchema: {
    type: 'object',
    required: ['file_path'],
    properties: {
      file_path: { type: 'string', description: 'Workspace-relative or absolute path to the video file' },
      prompt: { type: 'string', description: 'Optional analysis prompt or focus instruction' },
      analysis_mode: { type: 'string', enum: ['quick', 'detail', 'both'], description: 'quick returns a contact-sheet overview; detail extracts budgeted chronological batches; both does both. Default quick.' },
      sample_count: { type: 'number', description: 'Backward-compatible quick sample count (default 6, max 24)' },
      quick_sample_count: { type: 'number', description: 'Frames for the quick contact sheet (default 16, max 24)' },
      detail_frame_budget: { type: 'number', description: 'Optional detail frame budget across the whole duration. Use this instead of asking for every frame on long videos.' },
      max_detail_frames: { type: 'number', description: 'Hard cap for automatic detail extraction (default 42, max 72)' },
      output_dir: { type: 'string', description: 'Optional workspace-relative output directory for extracted artifacts' },
      extract_audio: { type: 'boolean', description: 'Extract audio when ffmpeg is available' },
      transcribe: { type: 'boolean', description: 'Use the configured speech-to-text provider when audio is available' },
      include_raw_probe: { type: 'boolean', description: 'Include full ffprobe JSON. Default false for compact output.' },
    },
    additionalProperties: false,
  },
};
