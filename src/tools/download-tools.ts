
async function resolveDenoRuntimePath(): Promise<string> {
  const executableName = path.basename(process.execPath).toLowerCase();
  const directCandidates = [
    process.env.PROMETHEUS_DENO_PATH || '',
    executableName === 'deno' || executableName === 'deno.exe' ? process.execPath : '',
    ...String(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, process.platform === 'win32' ? 'deno.exe' : 'deno')),
    ...(process.platform === 'win32'
      ? [
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Prometheus', 'runtime', 'deno', 'deno.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'deno', 'bin', 'deno.exe'),
        ]
      : ['/usr/local/bin/deno', '/usr/bin/deno']),
  ];
  const direct = directCandidates.find((candidate) => {
    try {
      return Boolean(candidate && fs.existsSync(candidate) && /deno(?:\.exe)?$/i.test(path.basename(candidate)));
    } catch {
      return false;
    }
  });
  if (direct) return direct;

  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(locator, ['deno'], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 128 * 1024,
    });
    const located = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    if (located && fs.existsSync(located)) return located;
  } catch {
    // A JavaScript runtime is optional for non-YouTube extractors.
  }
  return '';
}

  // Node remains a fallback, but current yt-dlp releases require a supported runtime version.



async function resolveNodeRuntimePath(): Promise<string> {
  const executableName = path.basename(process.execPath).toLowerCase();
  const directCandidates = [
    process.env.PROMETHEUS_NODE_PATH || '',
    executableName === 'node' || executableName === 'node.exe' ? process.execPath : '',
    ...String(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node')),
    ...(process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
        ]
      : ['/usr/local/bin/node', '/usr/bin/node']),
  ];
  const direct = directCandidates.find((candidate) => {
    try {
      return Boolean(candidate && fs.existsSync(candidate) && /node(?:\.exe)?$/i.test(path.basename(candidate)));
    } catch {
      return false;
    }
  });
  if (direct) return direct;

  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(locator, ['node'], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 128 * 1024,
    });
    const located = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    if (located && fs.existsSync(located)) return located;
  } catch {
    // Node is optional for yt-dlp; extraction still works without EJS support.
  }
  return '';
}
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from './workspace-context.js';
import type { ToolResult } from '../types.js';
import { resolveRuntimeBinary } from '../runtime/dependencies.js';

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

/**
 * Rewrite human-facing GitHub URLs into direct raw asset URLs so download_url
 * saves the actual file instead of the rendered HTML viewer page.
 *   github.com/owner/repo/blob/<ref>/<path>  → raw.githubusercontent.com/owner/repo/<ref>/<path>
 *   github.com/owner/repo/raw/<ref>/<path>   → raw.githubusercontent.com/owner/repo/<ref>/<path>
 * Returns the rewritten URL plus an optional note, or a hardError when the URL
 * points at a whole repo/tree (which clone_repo should handle instead).
 */
export function normalizeDownloadUrl(url: string): { url: string; note?: string; hardError?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url };
  }
  if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return { url };

  const parts = parsed.pathname.replace(/^\/+/, '').split('/');
  const [owner, repo, kind, ref, ...rest] = parts;
  if (!owner || !repo) return { url };

  if ((kind === 'blob' || kind === 'raw') && ref && rest.length) {
    const filePath = rest.join('/');
    return {
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
      note: 'Rewrote GitHub blob URL to raw.githubusercontent.com for direct file download.',
    };
  }

  // Whole repo or a directory tree — download_url cannot fetch these as a file.
  if (!kind || kind === 'tree') {
    return {
      url,
      hardError:
        'This is a GitHub repository or directory URL, not a single file. Use clone_repo(repo, paths?) to pull the repo or specific files into the workspace.',
    };
  }

  return { url };
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
  const rawUrl = String(args?.url || '').trim();
  if (!rawUrl) return { success: false, error: 'url is required' };

  const normalized = normalizeDownloadUrl(rawUrl);
  if (normalized.hardError) return { success: false, error: normalized.hardError };
  const url = normalized.url;

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
      stdout: `Downloaded URL to ${relPath} (${buffer.length} bytes).${normalized.note ? ' ' + normalized.note : ''}`,
      data: {
        url,
        requested_url: rawUrl !== url ? rawUrl : undefined,
        note: normalized.note,
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
  /** Internal caller override. MKV safely contains YouTube AV1 + Opus without lossy transcoding. */
  merge_output_format?: 'mp4' | 'mkv';
  signal?: AbortSignal;
  onProgress?: (progress: DownloadMediaProgress) => void;
};

export type DownloadMediaProgress = {
  phase: 'starting' | 'resolving' | 'downloading' | 'processing' | 'complete';
  message: string;
  percent?: string;
  speed?: string;
  eta?: string;
};

export type YtDlpRunner = {
  cmd: string;
  preArgs: string[];
  label: string;
};

async function detectYtDlpRunner(signal?: AbortSignal): Promise<YtDlpRunner | null> {
  const candidates: YtDlpRunner[] = [
    { cmd: 'yt-dlp', preArgs: [], label: 'yt-dlp' },
    { cmd: 'python', preArgs: ['-m', 'yt_dlp'], label: 'python -m yt_dlp' },
    { cmd: 'py', preArgs: ['-m', 'yt_dlp'], label: 'py -m yt_dlp' },
  ];

  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error('download canceled by user');
    try {
      await execFileAsync(candidate.cmd, [...candidate.preArgs, '--version'], {
        timeout: 8_000,
        windowsHide: true,
        maxBuffer: 512 * 1024,
        signal,
      });
      return candidate;
    } catch {
      if (signal?.aborted) throw new Error('download canceled by user');
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

const DOWNLOAD_MEDIA_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_MEDIA_MAX_BUFFER = 8 * 1024 * 1024;

function stopDownloadProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode != null) return;
  try { child.kill('SIGTERM'); } catch {}
  if (process.platform === 'win32') {
    // yt-dlp can launch ffmpeg. Kill only this child's process tree so an abort
    // cannot leave a detached downloader holding the gateway busy guard open.
    try {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.unref();
    } catch {}
  }
}

export async function runYtDlpProcess(
  runner: YtDlpRunner,
  commandArgs: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    onProgress?: (progress: DownloadMediaProgress) => void;
  },
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw new Error('download canceled by user');

  return await new Promise((resolve, reject) => {
    const child = spawn(runner.cmd, commandArgs, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let lastProgressAt = 0;
    let lastPhase = '';

    const emit = (progress: DownloadMediaProgress, force = false) => {
      const now = Date.now();
      if (!force && progress.phase === lastPhase && now - lastProgressAt < 1_500) return;
      lastPhase = progress.phase;
      lastProgressAt = now;
      try { options.onProgress?.(progress); } catch {}
    };
    const appendBounded = (current: string, chunk: Buffer | string) => {
      const next = current + String(chunk);
      return next.length > DOWNLOAD_MEDIA_MAX_BUFFER
        ? next.slice(next.length - DOWNLOAD_MEDIA_MAX_BUFFER)
        : next;
    };
    const inspectLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line) return;
      const marker = line.match(/__PROMETHEUS_PROGRESS__\s*\|([^|]*)\|([^|]*)\|([^|]*)/);
      if (marker) {
        const percent = marker[1].trim();
        const speed = marker[2].trim();
        const eta = marker[3].trim();
        emit({
          phase: 'downloading',
          message: `Downloading media${percent ? `: ${percent}` : ''}${speed ? ` at ${speed}` : ''}${eta && eta !== 'NA' ? ` (ETA ${eta})` : ''}`,
          percent: percent || undefined,
          speed: speed || undefined,
          eta: eta && eta !== 'NA' ? eta : undefined,
        });
      } else if (/\[(?:twitter|generic|youtube|x)\]|extracting url|downloading webpage|guest token/i.test(line)) {
        emit({ phase: 'resolving', message: 'Resolving the media source…' });
      } else if (/\[(?:merger|ffmpeg|extractaudio|fixup)\]/i.test(line)) {
        emit({ phase: 'processing', message: 'Processing the downloaded media…' });
      } else if (/\[download\].*(?:destination|has already been downloaded)/i.test(line)) {
        emit({ phase: 'downloading', message: 'Downloading media…' });
      }
    };
    const inspectChunk = (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n|\r/g)) inspectLine(line);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(keepalive);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      stopDownloadProcess(child);
      fail(new Error('download canceled by user'));
    };
    const timeout = setTimeout(() => {
      stopDownloadProcess(child);
      fail(new Error(`download timed out after ${Math.round(DOWNLOAD_MEDIA_TIMEOUT_MS / 60_000)} minutes`));
    }, DOWNLOAD_MEDIA_TIMEOUT_MS);
    timeout.unref?.();
    const keepalive = setInterval(() => {
      const phase: DownloadMediaProgress['phase'] = lastPhase === 'downloading' || lastPhase === 'processing'
        ? lastPhase
        : 'resolving';
      emit({
        phase,
        message: lastPhase === 'downloading'
          ? 'Download is still in progress…'
          : lastPhase === 'processing'
            ? 'Media processing is still in progress…'
            : 'Still resolving the media source…',
      }, true);
    }, 10_000);
    keepalive.unref?.();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
      inspectChunk(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
      inspectChunk(chunk);
    });
    child.once('error', (error) => fail(error));
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`yt-dlp exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}: ${String(stderr || stdout).slice(-1500)}`));
    });
  });
}

export async function executeDownloadMedia(args: DownloadMediaArgs): Promise<ToolResult> {
  const workspaceRoot = getWorkspaceRoot();
  const url = String(args?.url || '').trim();
  if (!url) return { success: false, error: 'url is required' };

  try {
    args.onProgress?.({ phase: 'starting', message: 'Starting media download…' });
    if (args.signal?.aborted) throw new Error('download canceled by user');
    const runner = await detectYtDlpRunner(args.signal);
    if (!runner) {
      return {
        success: false,
        error: 'download_media requires yt-dlp. Install `yt-dlp` or Python package `yt_dlp` on this machine.',
      };
    }

    const { absDir } = ensureOutputDir(workspaceRoot, args.output_dir || 'downloads/media');
    await fsp.mkdir(absDir, { recursive: true });

    const ffmpegPath = resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
    const ffprobePath = resolveRuntimeBinary('ffprobe', { allowPathFallback: true });
    const mediaBinDirs = [...new Set([ffmpegPath, ffprobePath]
      .filter((value) => path.isAbsolute(value))
      .map((value) => path.dirname(value)))];
    const denoPath = await resolveDenoRuntimePath();
    const nodePath = denoPath ? '' : await resolveNodeRuntimePath();
    const jsRuntime = denoPath ? `deno:${denoPath}` : (nodePath ? `node:${nodePath}` : '');
    const commandArgs = [
      ...runner.preArgs,
      '--no-playlist',
      '--restrict-filenames',
      '--windows-filenames',
      '--newline',
      '--progress',
      '--progress-template',
      'download:__PROMETHEUS_PROGRESS__|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--socket-timeout',
      '30',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      '--print',
      'after_move:filepath',
      '-P',
      absDir,
      '-o',
      '%(title).80s [%(id)s].%(ext)s',
      '--merge-output-format',
      args.merge_output_format === 'mkv' ? 'mkv' : 'mp4',
      '--ffmpeg-location',
      ffmpegPath,
    ];
    if (jsRuntime) commandArgs.push('--js-runtimes', jsRuntime);

    if (args.audio_only === true) {
      commandArgs.push('-x', '--audio-format', 'mp3');
    }

    commandArgs.push(url);

    args.onProgress?.({ phase: 'resolving', message: 'Resolving the media source…' });
    const { stdout, stderr } = await runYtDlpProcess(runner, commandArgs, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PROMETHEUS_FFMPEG_PATH: ffmpegPath,
        PROMETHEUS_FFPROBE_PATH: ffprobePath,
        PATH: [...mediaBinDirs, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
      },
      signal: args.signal,
      onProgress: args.onProgress,
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

    args.onProgress?.({ phase: 'complete', message: `Media download complete: ${files.length} file${files.length === 1 ? '' : 's'} saved.` });

    return {
      success: true,
      stdout: `Downloaded media to ${files.map((f) => f.rel_path).join(', ')} using ${runner.label}.`,
      data: {
        url,
        audio_only: args.audio_only === true,
        runner: runner.label,
        ffmpeg_available: true,
        files,
        warnings: String(stderr || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => /warning/i.test(line)).slice(0, 5),
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
