import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from './workspace-context.js';
import type { ToolResult } from '../types.js';

const execFileAsync = promisify(execFile);

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/json': '.json',
  'text/plain': '.txt',
  'text/html': '.html',
};

function getWorkspaceRoot(): string {
  const globalWorkspace = getConfig().getConfig().workspace.path;
  return getActiveWorkspace(globalWorkspace);
}

function sanitizeFilename(input: string): string {
  const trimmed = String(input || '').trim().replace(/^[/\\]+/, '');
  const base = path.basename(trimmed || 'download');
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'download';
}

function ensurePathInWorkspace(workspaceRoot: string, requested: string): string {
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(path.join(workspaceRoot, requested));
  const rel = path.relative(workspaceRoot, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${requested}" is outside workspace.`);
  }
  return candidate;
}

function ensureOutputDir(workspaceRoot: string, outputDir?: string): { absDir: string; relDir: string } {
  const absDir = ensurePathInWorkspace(workspaceRoot, outputDir || 'downloads');
  const relDir = path.relative(workspaceRoot, absDir).replace(/\\/g, '/') || '.';
  return { absDir, relDir };
}

function inferExtension(filename: string, contentType: string): string {
  const currentExt = path.extname(filename);
  if (currentExt) return currentExt;
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  return MIME_EXTENSIONS[mime] || '';
}

function parseContentDispositionFilename(contentDisposition: string | null): string {
  const raw = String(contentDisposition || '');
  const utf8Match = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = raw.match(/filename\s*=\s*"([^"]+)"/i) || raw.match(/filename\s*=\s*([^;]+)/i);
  return plainMatch?.[1]?.trim() || '';
}

function inferFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = path.posix.basename(parsed.pathname || '').trim();
    if (lastSegment && lastSegment !== '/') return lastSegment;
    return parsed.hostname.replace(/[^a-z0-9.-]/gi, '_');
  } catch {
    return 'download';
  }
}

function buildUniqueFilePath(absDir: string, requestedName: string): string {
  const safeName = sanitizeFilename(requestedName);
  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;
  let candidate = path.join(absDir, safeName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(absDir, `${stem}_${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

type DownloadUrlArgs = {
  url: string;
  filename?: string;
  output_dir?: string;
};

export async function executeDownloadUrl(args: DownloadUrlArgs): Promise<ToolResult> {
  const workspaceRoot = getWorkspaceRoot();
  const url = String(args?.url || '').trim();
  if (!url) return { success: false, error: 'url is required' };

  try {
    const { absDir } = ensureOutputDir(workspaceRoot, args.output_dir);
    await fsp.mkdir(absDir, { recursive: true });

    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Prometheus/1.0',
      },
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Download failed (${response.status} ${response.statusText}) for ${url}`,
      };
    }

    const contentType = String(response.headers.get('content-type') || '').trim();
    const dispositionName = parseContentDispositionFilename(response.headers.get('content-disposition'));
    let requestedName = sanitizeFilename(
      String(args.filename || dispositionName || inferFilenameFromUrl(String(response.url || url))),
    );
    const inferredExt = inferExtension(requestedName, contentType);
    if (inferredExt && !path.extname(requestedName)) requestedName += inferredExt;

    const absPath = buildUniqueFilePath(absDir, requestedName);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fsp.writeFile(absPath, buffer);

    const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
    return {
      success: true,
      stdout: `Downloaded URL to ${relPath} (${buffer.length} bytes).`,
      data: {
        url,
        final_url: response.url,
        path: absPath,
        rel_path: relPath,
        bytes: buffer.length,
        content_type: contentType || null,
        status: response.status,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: `download_url failed: ${String(error?.message || error)}`,
    };
  }
}

type DownloadMediaArgs = {
  url: string;
  output_dir?: string;
  audio_only?: boolean;
};

type YtDlpRunner = {
  cmd: string;
  preArgs: string[];
  label: string;
};

async function detectYtDlpRunner(): Promise<YtDlpRunner | null> {
  const candidates: YtDlpRunner[] = [
    { cmd: 'yt-dlp', preArgs: [], label: 'yt-dlp' },
    { cmd: 'python', preArgs: ['-m', 'yt_dlp'], label: 'python -m yt_dlp' },
    { cmd: 'py', preArgs: ['-m', 'yt_dlp'], label: 'py -m yt_dlp' },
  ];

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.cmd, [...candidate.preArgs, '--version'], {
        timeout: 8_000,
        windowsHide: true,
        maxBuffer: 512 * 1024,
      });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function parseDownloadedPaths(output: string, outputDir: string): string[] {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const paths = new Set<string>();
  for (const line of lines) {
    const maybePath = path.isAbsolute(line) ? line : path.resolve(outputDir, line);
    if (fs.existsSync(maybePath)) paths.add(maybePath);
  }
  return Array.from(paths);
}

export async function executeDownloadMedia(args: DownloadMediaArgs): Promise<ToolResult> {
  const workspaceRoot = getWorkspaceRoot();
  const url = String(args?.url || '').trim();
  if (!url) return { success: false, error: 'url is required' };

  try {
    const runner = await detectYtDlpRunner();
    if (!runner) {
      return {
        success: false,
        error: 'download_media requires yt-dlp. Install `yt-dlp` or Python package `yt_dlp` on this machine.',
      };
    }

    const { absDir } = ensureOutputDir(workspaceRoot, args.output_dir || 'downloads/media');
    await fsp.mkdir(absDir, { recursive: true });

    const commandArgs = [
      ...runner.preArgs,
      '--no-playlist',
      '--restrict-filenames',
      '--windows-filenames',
      '--newline',
      '--print',
      'after_move:filepath',
      '-P',
      absDir,
      '-o',
      '%(title).80s [%(id)s].%(ext)s',
      '--merge-output-format',
      'mp4',
    ];

    if (args.audio_only === true) {
      commandArgs.push('-x', '--audio-format', 'mp3');
    }

    commandArgs.push(url);

    const { stdout, stderr } = await execFileAsync(runner.cmd, commandArgs, {
      cwd: workspaceRoot,
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });

    let downloadedPaths = parseDownloadedPaths(stdout, absDir);
    if (downloadedPaths.length === 0) {
      downloadedPaths = parseDownloadedPaths(stderr, absDir);
    }

    if (downloadedPaths.length === 0) {
      return {
        success: false,
        error: `download_media finished but no saved file path was detected.\n${String(stderr || stdout || '').slice(0, 1000)}`,
      };
    }

    const files = downloadedPaths.map((absPath) => {
      const stat = fs.statSync(absPath);
      return {
        path: absPath,
        rel_path: path.relative(workspaceRoot, absPath).replace(/\\/g, '/'),
        bytes: stat.size,
      };
    });

    return {
      success: true,
      stdout: `Downloaded media to ${files.map((f) => f.rel_path).join(', ')} using ${runner.label}.`,
      data: {
        url,
        audio_only: args.audio_only === true,
        runner: runner.label,
        files,
        stderr: String(stderr || '').slice(0, 2000),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: `download_media failed: ${String(error?.message || error)}`,
    };
  }
}

export const downloadUrlTool = {
  name: 'download_url',
  description: 'Download a URL directly into the workspace downloads folder.',
  execute: executeDownloadUrl,
  schema: {
    url: 'Remote URL to download',
    filename: 'Optional output filename',
    output_dir: 'Optional workspace-relative output directory (default: downloads)',
  },
  jsonSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Remote URL to download' },
      filename: { type: 'string', description: 'Optional output filename' },
      output_dir: { type: 'string', description: 'Workspace-relative output directory' },
    },
    additionalProperties: false,
  },
};

export const downloadMediaTool = {
  name: 'download_media',
  description: 'Download media from a supported page URL using yt-dlp into the workspace.',
  execute: executeDownloadMedia,
  schema: {
    url: 'Page URL for the video/audio/media item',
    output_dir: 'Optional workspace-relative output directory (default: downloads/media)',
    audio_only: 'If true, extract audio only',
  },
  jsonSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Page URL for the media item' },
      output_dir: { type: 'string', description: 'Workspace-relative output directory' },
      audio_only: { type: 'boolean', description: 'Extract audio only' },
    },
    additionalProperties: false,
  },
};
