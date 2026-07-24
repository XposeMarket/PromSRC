import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { resolveRuntimeBinary } from '../../runtime/dependencies';
import { type CreativeSequenceDoc, type CreativeSequenceStorage, loadCreativeSequence, saveCreativeSequence } from './sequence';
import { lintComposition } from './composition';

export type CreativeSequenceQaReceipt = {
  kind: 'prometheus-creative-sequence-qa';
  version: 1;
  sequenceId: string;
  variantId: string | null;
  artifact: { path: string; sha256: string; bytes: number };
  media: { durationSeconds: number | null; width: number | null; height: number | null; frameRate: string | null; hasVideo: boolean; hasAudio: boolean; decodePassed: boolean };
  compositionLintPassed: boolean;
  checks: Array<{ code: string; passed: boolean; message: string }>;
  passed: boolean;
  warnings: string[];
  createdAt: string;
};

function workspaceFile(storage: CreativeSequenceStorage, raw: string): string {
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(storage.workspacePath, raw);
  const relative = path.relative(storage.workspacePath, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Sequence QA artifact must be inside the workspace.');
  return absolute;
}

function sha256(filePath: string): string {
  const hash = createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    do {
      bytes = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function probe(filePath: string): any {
  const ffprobe = resolveRuntimeBinary('ffprobe');
  const text = execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(text);
}

function decode(filePath: string): boolean {
  const ffmpeg = resolveRuntimeBinary('ffmpeg');
  execFileSync(ffmpeg, ['-v', 'error', '-i', filePath, '-map', '0:v:0?', '-map', '0:a:0?', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  return true;
}

export function qaCreativeSequenceExport(storage: CreativeSequenceStorage, input: { sequenceId: string; artifactPath: string; variantId?: string | null }): { receipt: CreativeSequenceQaReceipt; receiptPath: string; sequence: CreativeSequenceDoc } {
  const sequence = loadCreativeSequence(storage, input.sequenceId);
  const artifactPath = workspaceFile(storage, input.artifactPath);
  if (!fs.existsSync(artifactPath)) throw new Error(`Sequence export not found: ${input.artifactPath}`);
  const selectedVariant = input.variantId ? sequence.variants.find((variant) => variant.id === input.variantId) || null : null;
  const composition = selectedVariant?.composition || sequence.composition;
  const lint = lintComposition(composition);
  const metadata = probe(artifactPath);
  const video = (metadata.streams || []).find((stream: any) => stream.codec_type === 'video');
  const audio = (metadata.streams || []).find((stream: any) => stream.codec_type === 'audio');
  const durationSeconds = Number(metadata.format?.duration || video?.duration || audio?.duration);
  let decodePassed = false;
  try { decodePassed = decode(artifactPath); } catch { decodePassed = false; }
  const expectedDuration = composition.durationMs / 1000;
  const checks = [
    { code: 'composition_lint', passed: lint.ok, message: lint.ok ? 'Composition lint passed.' : lint.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('; ') },
    { code: 'video_stream', passed: !!video, message: video ? `Video stream ${video.codec_name || 'unknown'} present.` : 'Video stream missing.' },
    { code: 'decode', passed: decodePassed, message: decodePassed ? 'Full decode passed.' : 'Full decode failed.' },
    { code: 'dimensions', passed: !!video && Number(video.width) === composition.width && Number(video.height) === composition.height, message: `Expected ${composition.width}x${composition.height}; got ${video?.width || 0}x${video?.height || 0}.` },
    { code: 'duration', passed: Number.isFinite(durationSeconds) && Math.abs(durationSeconds - expectedDuration) <= Math.max(0.35, expectedDuration * 0.02), message: `Expected about ${expectedDuration.toFixed(3)}s; got ${Number.isFinite(durationSeconds) ? durationSeconds.toFixed(3) : 'unknown'}s.` },
  ];
  const dialogueExpected = sequence.sources.some((source) => source.hasAudio === true);
  if (dialogueExpected) checks.push({ code: 'audio_stream', passed: !!audio, message: audio ? `Audio stream ${audio.codec_name || 'unknown'} present.` : 'Expected source audio, but output has no audio stream.' });
  const warnings: string[] = [];
  if (sequence.audio.dialogueNormalization.enabled) warnings.push('Dialogue loudness policy is recorded; measured LUFS verification remains pending until the loudnorm analysis stage writes measurements.');
  if (sequence.audio.musicDucking.enabled) warnings.push('Music ducking policy is recorded; measured attenuation verification remains pending until the master audio stage writes measurements.');
  const receipt: CreativeSequenceQaReceipt = {
    kind: 'prometheus-creative-sequence-qa', version: 1, sequenceId: sequence.id, variantId: selectedVariant?.id || null,
    artifact: { path: path.relative(storage.workspacePath, artifactPath).replace(/\\/g, '/'), sha256: sha256(artifactPath), bytes: fs.statSync(artifactPath).size },
    media: { durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null, width: video ? Number(video.width) : null, height: video ? Number(video.height) : null, frameRate: video?.avg_frame_rate || null, hasVideo: !!video, hasAudio: !!audio, decodePassed },
    compositionLintPassed: lint.ok, checks, passed: checks.every((check) => check.passed), warnings, createdAt: new Date().toISOString(),
  };
  const receiptDir = path.join(storage.creativeDir, 'qa');
  fs.mkdirSync(receiptDir, { recursive: true });
  const receiptPath = path.join(receiptDir, `${sequence.id}-${selectedVariant?.id || 'master'}-qa.json`);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
  const relativeReceiptPath = path.relative(storage.workspacePath, receiptPath).replace(/\\/g, '/');
  if (selectedVariant) {
    selectedVariant.exportPath = receipt.artifact.path;
    selectedVariant.qaReceiptPath = relativeReceiptPath;
    selectedVariant.status = receipt.passed ? 'qa_passed' : 'qa_failed';
  } else {
    sequence.masterRender.exportPath = receipt.artifact.path;
    sequence.masterRender.qaReceiptPath = relativeReceiptPath;
    sequence.masterRender.status = receipt.passed ? 'qa_passed' : 'qa_failed';
  }
  saveCreativeSequence(storage, sequence);
  return { receipt, receiptPath, sequence };
}
