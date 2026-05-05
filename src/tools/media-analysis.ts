import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '../types.js';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from './workspace-context.js';
import { getProvider, getPrimaryModel } from '../providers/factory.js';
import { contentToString } from '../providers/content-utils.js';
import { buildVisionImagePart, primarySupportsVision } from '../gateway/vision-chat.js';

const execFileAsync = promisify(execFile);

type AnalyzeImageArgs = {
  file_path: string;
  prompt?: string;
};

type AnalyzeVideoArgs = {
  file_path: string;
  prompt?: string;
  sample_count?: number;
  output_dir?: string;
  extract_audio?: boolean;
  transcribe?: boolean;
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

async function detectPythonRunner(): Promise<PythonRunner | null> {
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
    try {
      if (!fs.existsSync(candidate)) continue;
      await execFileAsync(candidate, ['--version'], {
        timeout: 8_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      });
      return { cmd: candidate, preArgs: [] };
    } catch {
      // try next candidate
    }
  }

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.cmd, [...candidate.preArgs, '--version'], {
        timeout: 8_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      });
      return candidate;
    } catch {
      // try next runner
    }
  }
  return null;
}

async function runVideoAnalyzer(scriptPath: string, args: string[]): Promise<any> {
  const runner = await detectPythonRunner();
  if (!runner) throw new Error('Python was not found on this machine.');
  const { stdout } = await execFileAsync(
    runner.cmd,
    [...runner.preArgs, scriptPath, ...args],
    {
      cwd: path.dirname(scriptPath),
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
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

async function analyzeWithPrimaryVision(messages: any[]): Promise<string> {
  if (!primarySupportsVision()) {
    throw new Error('The active primary model is not vision-capable. Switch to a vision-capable model first.');
  }
  const provider = getProvider();
  const model = getPrimaryModel();
  const result = await provider.chat(messages, model, {
    temperature: 0.2,
    max_tokens: 1400,
    think: 'medium',
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

    const sampleCount = Math.min(Math.max(Number(args?.sample_count || 6), 2), 8);
    const defaultOutputDir = path.join('downloads', 'video_analysis', sanitizeStem(path.basename(absPath, path.extname(absPath))));
    const outputDirRel = String(args?.output_dir || defaultOutputDir).trim();
    const outputDirAbs = ensureWorkspacePath(workspaceRoot, outputDirRel);
    await fsp.mkdir(outputDirAbs, { recursive: true });

    const analyzerArgs = [
      absPath,
      '--output-dir',
      outputDirAbs,
      '--samples',
      String(sampleCount),
    ];
    if (args?.extract_audio !== false) analyzerArgs.push('--extract-audio');
    if (args?.transcribe !== false) analyzerArgs.push('--transcribe');

    const analyzerResult = await runVideoAnalyzer(scriptPath, analyzerArgs);
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

    const transcript = analyzerResult?.transcript?.available ? String(analyzerResult.transcript.text || '').trim() : '';
    const relFrames = framePaths.map((framePath: string) => path.relative(workspaceRoot, framePath).replace(/\\/g, '/'));
    const prompt = String(args?.prompt || '').trim();

    const userContent: any[] = [
      {
        type: 'text',
        text:
          `${prompt || 'Analyze this video from sampled frames and optional transcript.'}\n` +
          `Video file: ${path.basename(absPath)}\n` +
          `Duration: ${videoSummary?.duration_seconds ?? analyzerResult?.probe?.json?.format?.duration ?? 'unknown'} seconds\n` +
          `Frame samples: ${framePaths.length}\n` +
          `If transcript is missing, rely on the visuals and say audio/transcript was unavailable.`,
      },
    ];

    for (let idx = 0; idx < framePaths.length; idx += 1) {
      userContent.push({
        type: 'text',
        text: `Frame ${idx + 1} of ${framePaths.length}: ${path.basename(framePaths[idx])}`,
      });
      userContent.push(await readFileAsVisionPart(framePaths[idx]));
    }

    if (transcript) {
      userContent.push({
        type: 'text',
        text: `Transcript:\n${transcript.slice(0, 12000)}`,
      });
    }

    const analysis = await analyzeWithPrimaryVision([
      {
        role: 'system',
        content:
          'You are a grounded video analyst working from sampled frames and an optional transcript. ' +
          'Infer cautiously across time. Return concise markdown with sections: Overall Summary, Timeline, Visible Text, Audio/Transcript, Key Objects or People, Uncertainty.',
      },
      {
        role: 'user',
        content: userContent,
      },
    ]);

    return {
      success: true,
      stdout: analysis,
      data: {
        file_path: absPath,
        rel_path: path.relative(workspaceRoot, absPath).replace(/\\/g, '/'),
        output_dir: outputDirAbs,
        output_dir_rel: path.relative(workspaceRoot, outputDirAbs).replace(/\\/g, '/'),
        sample_count: framePaths.length,
        sample_frames: relFrames,
        transcript: transcript || null,
        extraction: analyzerResult,
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
    sample_count: 'How many visual samples to extract (default 6, max 8)',
    output_dir: 'Optional workspace-relative output directory for extracted artifacts',
    extract_audio: 'If true, extract audio when ffmpeg is available (default true)',
    transcribe: 'If true, attempt local whisper transcription when available (default true)',
  },
  jsonSchema: {
    type: 'object',
    required: ['file_path'],
    properties: {
      file_path: { type: 'string', description: 'Workspace-relative or absolute path to the video file' },
      prompt: { type: 'string', description: 'Optional analysis prompt or focus instruction' },
      sample_count: { type: 'number', description: 'Number of visual samples to extract (default 6, max 8)' },
      output_dir: { type: 'string', description: 'Optional workspace-relative output directory for extracted artifacts' },
      extract_audio: { type: 'boolean', description: 'Extract audio when ffmpeg is available' },
      transcribe: { type: 'boolean', description: 'Attempt local whisper transcription when available' },
    },
    additionalProperties: false,
  },
};
