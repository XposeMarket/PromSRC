/**
 * file-op-direct.ts
 *
 * Lightweight file-operation utilities for the chat router.
 * Replaces file-op-v2.ts — all secondary-AI orchestration logic removed.
 * The primary model handles file operations directly without a secondary advisor.
 */

import path from 'path';
import fs from 'fs';
import { getConfig } from '../config/config';

// ─── File operation type classification ──────────────────────────────────────

export type FileOpType =
  | 'CHAT'
  | 'FILE_ANALYSIS'
  | 'FILE_CREATE'
  | 'FILE_EDIT'
  | 'BROWSER_OP'
  | 'DESKTOP_OP';

export interface FileOpClassification {
  type: FileOpType;
  reason: string;
}

export interface FileOpSettings {
  enabled: boolean;
  checkpointing_enabled: boolean;
  watchdog_no_progress_cycles: number;
}

export function resolveFileOpSettings(): FileOpSettings {
  return {
    enabled: true,
    checkpointing_enabled: true,
    watchdog_no_progress_cycles: 4,
  };
}

export function classifyFileOpType(message: string): FileOpClassification {
  const m = String(message || '').toLowerCase();

  if (/\b(browser|chrome|firefox|edge|navigate|open.*url|go to http)\b/.test(m)) {
    return { type: 'BROWSER_OP', reason: 'browser keyword detected' };
  }
  if (/\b(desktop|screenshot|click.*window|focus.*window|type.*into|press.*key)\b/.test(m)) {
    return { type: 'DESKTOP_OP', reason: 'desktop keyword detected' };
  }
  if (/\b(create|write|generate|scaffold|build|make)\b.*\b(file|component|module|class|function|script|page|route)\b/.test(m)) {
    return { type: 'FILE_CREATE', reason: 'file creation keyword detected' };
  }
  if (/\b(edit|update|fix|refactor|modify|change|replace|rewrite|patch|add to|insert into|remove from)\b.*\b(file|function|class|method|line|code)\b/.test(m)) {
    return { type: 'FILE_EDIT', reason: 'file edit keyword detected' };
  }
  if (/\b(read|analyze|review|summarize|explain|show me|what does|check)\b.*\b(file|code|function|class)\b/.test(m)) {
    return { type: 'FILE_ANALYSIS', reason: 'file analysis keyword detected' };
  }

  return { type: 'CHAT', reason: 'no file operation detected' };
}

// ─── Progress watchdog ────────────────────────────────────────────────────────

export class FileOpProgressWatchdog {
  private noProgressCycles: number;
  private stallCount = 0;

  constructor(noProgressCycles = 4) {
    this.noProgressCycles = noProgressCycles;
  }

  recordProgress(): void {
    this.stallCount = 0;
  }

  recordNoProgress(): boolean {
    this.stallCount++;
    return this.stallCount >= this.noProgressCycles;
  }

  isStalled(): boolean {
    return this.stallCount >= this.noProgressCycles;
  }

  reset(): void {
    this.stallCount = 0;
  }
}

// ─── File mutation classification helpers ────────────────────────────────────

const FILE_MUTATION_TOOLS = new Set([
  'create_file', 'write', 'write_file',
  'replace_lines', 'find_replace', 'insert_after', 'delete_lines',
  'edit', 'apply_patch', 'append_file', 'delete_file', 'move_file', 'mkdir',
]);

const FILE_CREATE_TOOLS = new Set(['create_file', 'write', 'write_file']);

const FILE_EDIT_TOOLS = new Set([
  'replace_lines', 'find_replace', 'insert_after', 'delete_lines',
  'edit', 'apply_patch', 'append_file',
]);

export function isFileMutationTool(toolName: string): boolean {
  return FILE_MUTATION_TOOLS.has(String(toolName || ''));
}

export function isFileCreateTool(toolName: string): boolean {
  return FILE_CREATE_TOOLS.has(String(toolName || ''));
}

export function isFileEditTool(toolName: string): boolean {
  return FILE_EDIT_TOOLS.has(String(toolName || ''));
}

export function extractFileToolTarget(toolName: string, args: any): string | null {
  const a = args || {};
  const name = String(toolName || '');
  if (FILE_MUTATION_TOOLS.has(name)) {
    return String(a.filename || a.name || a.path || a.file || '').trim() || null;
  }
  return null;
}

export function estimateFileToolChange(
  toolName: string,
  args: any,
): { lines_changed: number; chars_changed: number } {
  const a = args || {};
  const content = String(a.content || a.new_content || a.text || '');
  const lines = content ? content.split('\n').length : 0;
  const chars = content.length;

  if (toolName === 'replace_lines') {
    const start = Number(a.start_line || 0);
    const end = Number(a.end_line || start);
    return { lines_changed: Math.max(lines, end - start + 1), chars_changed: chars };
  }
  if (toolName === 'delete_lines') {
    const start = Number(a.start_line || 0);
    const end = Number(a.end_line || start);
    return { lines_changed: end - start + 1, chars_changed: 0 };
  }
  return { lines_changed: lines, chars_changed: chars };
}

// ─── Signature helpers (for dedup/stall detection) ────────────────────────────

export function buildFailureSignature(toolName: string, args: any, errorMsg: string): string {
  const a = args || {};
  const target = String(a.filename || a.name || a.path || '').slice(0, 40);
  const err = String(errorMsg || '').slice(0, 80);
  return `${toolName}:${target}:${err}`;
}

export function buildPatchSignature(toolName: string, args: any): string {
  const a = args || {};
  const target = String(a.filename || a.name || a.path || '').slice(0, 40);
  const startLine = String(a.start_line || a.line || '');
  const contentHash = String(a.content || a.new_content || '').slice(0, 60);
  return `${toolName}:${target}:${startLine}:${contentHash}`;
}

// ─── Checkpoint persistence ───────────────────────────────────────────────────

export interface FileOpCheckpoint {
  goal: string;
  phase: 'plan' | 'execute' | 'verify' | 'repair' | 'done';
  owner: 'primary' | 'secondary';
  operation: FileOpType;
  files_changed: string[];
  last_verifier_findings: any[];
  patch_history_signatures: string[];
  next_action: string;
}

function getCheckpointPath(sessionId: string): string {
  const configDir = getConfig().getConfigDir();
  const checkpointsDir = path.join(configDir, 'fileop_checkpoints');
  fs.mkdirSync(checkpointsDir, { recursive: true });
  const safeId = String(sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return path.join(checkpointsDir, `${safeId}.json`);
}

export function loadFileOpCheckpoint(sessionId: string): FileOpCheckpoint | null {
  try {
    const p = getCheckpointPath(sessionId);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw) as FileOpCheckpoint;
  } catch {
    return null;
  }
}

export function saveFileOpCheckpoint(sessionId: string, checkpoint: FileOpCheckpoint): void {
  try {
    const p = getCheckpointPath(sessionId);
    fs.writeFileSync(p, JSON.stringify(checkpoint, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[FileOpDirect] Failed to save checkpoint:', err.message);
  }
}

export function clearFileOpCheckpoint(sessionId: string): void {
  try {
    const p = getCheckpointPath(sessionId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // non-fatal
  }
}
