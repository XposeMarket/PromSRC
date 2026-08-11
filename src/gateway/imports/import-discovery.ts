import fs from 'fs';
import os from 'os';
import path from 'path';

import type { ImportAdapterId, ImportSourceBatch } from './import-types';

/**
 * Read-only discovery for the General settings import panel.
 *
 * Discovery intentionally looks only in well-known local agent locations and
 * inspects metadata (names, extensions, sizes) rather than transcript text or
 * credential contents. It never stages, parses, executes, or modifies a
 * source. The existing import job pipeline remains the safety gate.
 */

export type ImportDiscoveryKind = 'conversation' | 'setup';

export interface DiscoveredImportSource {
  id: string;
  provider: string;
  label: string;
  kind: ImportDiscoveryKind;
  adapter: ImportAdapterId;
  supportsProjects: boolean;
  /** Local path is returned only to the local settings client for preview. */
  sourcePath: string;
  transcriptCount: number;
  setupFileCount: number;
  bytes: number;
  capped: boolean;
  previewable: boolean;
  previewBlockReason?: string;
  /** Source-aware bounded batches, currently used for large Codex corpora. */
  batchable: boolean;
  batches?: ImportSourceBatch[];
  notes: string[];
}

export interface ImportDiscoveryResult {
  scannedAt: string;
  sources: DiscoveredImportSource[];
}

export interface ImportDiscoveryOptions {
  homeDir?: string;
  localAppData?: string;
  appData?: string;
  now?: () => Date;
}

interface ScanStats {
  files: number;
  bytes: number;
  transcriptCount: number;
  setupFileCount: number;
  capped: boolean;
}

interface CandidateDefinition {
  id: string;
  provider: string;
  label: string;
  kind: ImportDiscoveryKind;
  adapter: ImportAdapterId;
  supportsProjects: boolean;
  root: string;
  mode: 'directory' | 'file';
  includeWhen: (stats: ScanStats) => boolean;
  notes?: string[];
}

const MAX_SCAN_FILES = 4_000;
const MAX_SCAN_BYTES = 250 * 1024 * 1024;
const MAX_IMPORT_BATCH_BYTES = 200 * 1024 * 1024;
const MAX_SCAN_DEPTH = 7;
const MAX_EXPORT_DIRECTORY_ENTRIES = 200;

function defaultLocalAppData(homeDir: string): string {
  return process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
}

function defaultAppData(homeDir: string): string {
  return process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
}

function normalizedPath(value: string): string {
  return path.resolve(value);
}

function existsAsRegularFile(value: string): boolean {
  try {
    const stat = fs.lstatSync(value);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function existsAsDirectory(value: string): boolean {
  try {
    const stat = fs.lstatSync(value);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isTranscriptFile(relativePath: string, adapter: ImportAdapterId): boolean {
  const lower = relativePath.replace(/\\/g, '/').toLowerCase();
  if (/\.(jsonl|json|md)$/i.test(lower) && /(session|transcript|conversation|history|rollout|chat|project)/i.test(lower)) return true;
  if (adapter === 'codex-local' && /\.jsonl$/i.test(lower)) return true;
  if (adapter === 'hermes-local' && /\.(jsonl|json)$/i.test(lower)) return true;
  if (adapter === 'claude-code-local' && /\.jsonl$/i.test(lower)) return true;
  if (adapter === 'openclaw-local' && /\.(jsonl|json)$/i.test(lower) && /(session|transcript|history|conversation)/i.test(lower)) return true;
  if (adapter === 'localclaw-local' && /\.(jsonl|json)$/i.test(lower) && /(session|transcript|history|conversation)/i.test(lower)) return true;
  if (adapter === 'cursor-local' && /\.(db|sqlite|sqlite3)$/i.test(lower)) return true;
  return false;
}

function isSetupFile(relativePath: string): boolean {
  const lower = relativePath.replace(/\\/g, '/').toLowerCase();
  return /(^|\/)(config|settings|mcp|servers?|skills?|memory|memories|connectors?|integrations?|permissions?|policy|agents?|claude\.md|agents\.md)(\/|\.|$)/i.test(lower)
    || /\.(json|yaml|yml|toml|env|md)$/i.test(lower);
}

function scanPath(root: string, adapter: ImportAdapterId, mode: CandidateDefinition['mode']): ScanStats {
  const stats: ScanStats = { files: 0, bytes: 0, transcriptCount: 0, setupFileCount: 0, capped: false };
  const visit = (current: string, relative: string, depth: number) => {
    if (stats.files >= MAX_SCAN_FILES) {
      stats.capped = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (stats.capped) return;
      const next = path.join(current, entry.name);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      let stat: fs.Stats;
      try { stat = fs.lstatSync(next); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (depth < MAX_SCAN_DEPTH) visit(next, nextRelative, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      stats.files += 1;
      stats.bytes += stat.size;
      if (isTranscriptFile(nextRelative, adapter)) stats.transcriptCount += 1;
      if (isSetupFile(nextRelative)) stats.setupFileCount += 1;
      if (stats.files >= MAX_SCAN_FILES) stats.capped = true;
    }
  };

  if (mode === 'file') {
    try {
      const stat = fs.lstatSync(root);
      if (!stat.isSymbolicLink() && stat.isFile()) {
        stats.files = 1;
        stats.bytes = stat.size;
        stats.transcriptCount = isTranscriptFile(path.basename(root), adapter) ? 1 : 0;
        stats.setupFileCount = isSetupFile(path.basename(root)) ? 1 : 0;
      }
    } catch { /* absent or unreadable */ }
    return stats;
  }
  if (existsAsDirectory(root)) visit(root, '', 0);
  return stats;
}

function listCodexRolloutFiles(root: string): Array<{ absolutePath: string; relativePath: string; bytes: number }> {
  const out: Array<{ absolutePath: string; relativePath: string; bytes: number }> = [];
  const walk = (current: string, relative: string, depth: number): void => {
    if (out.length >= 8_000 || depth > MAX_SCAN_DEPTH) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= 8_000) return;
      const next = path.join(current, entry.name);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      let stat: fs.Stats;
      try { stat = fs.lstatSync(next); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(next, nextRelative, depth + 1);
        continue;
      }
      if (stat.isFile() && /^rollout[-_].+\.jsonl$/i.test(entry.name)) {
        out.push({ absolutePath: next, relativePath: nextRelative.replace(/\\/g, '/'), bytes: stat.size });
      }
    }
  };
  walk(root, '', 0);
  // Newest date folders/files are presented first so the first bounded
  // previews are the most useful ones to review and select.
  return out.sort((a, b) => b.relativePath.localeCompare(a.relativePath));
}

function codexBatches(root: string): ImportSourceBatch[] {
  const files = listCodexRolloutFiles(root);
  const batches: ImportSourceBatch[] = [];
  let current: typeof files = [];
  let currentBytes = 0;
  let currentLabel = '';
  let part = 1;
  const flush = (): void => {
    if (!current.length) return;
    const relative = currentLabel.replace(/\\/g, '/');
    const dateLabel = relative.split('/').slice(0, 3).join('-') || 'Codex sessions';
    const label = `${dateLabel}${part > 1 ? ` · batch ${part}` : ''}`;
    const bytes = currentBytes;
    batches.push({
      id: `codex-${Buffer.from(`${relative}:${part}`).toString('base64url').slice(-28)}`,
      label,
      sourceFiles: current.map((file) => file.absolutePath),
      transcriptCount: current.length,
      bytes,
      previewable: bytes <= MAX_IMPORT_BATCH_BYTES,
      ...(bytes > MAX_IMPORT_BATCH_BYTES ? { previewBlockReason: 'This Codex batch still exceeds the safe batch limit; choose its files in smaller groups.' } : {}),
    });
    current = [];
    currentBytes = 0;
    part += 1;
  };
  for (const file of files) {
    const fileDate = file.relativePath.split('/').slice(0, 3).join('/');
    if (current.length && (fileDate !== currentLabel || currentBytes + file.bytes > MAX_IMPORT_BATCH_BYTES)) flush();
    if (!current.length && fileDate !== currentLabel) {
      currentLabel = fileDate;
      part = 1;
    }
    current.push(file);
    currentBytes += file.bytes;
  }
  flush();
  return batches;
}

function candidate(
  definition: Omit<CandidateDefinition, 'includeWhen'> & { includeWhen?: CandidateDefinition['includeWhen'] },
): CandidateDefinition {
  return {
    ...definition,
    includeWhen: definition.includeWhen || ((stats) => stats.transcriptCount > 0 || stats.setupFileCount > 0),
  };
}

function chatGptExportCandidates(homeDir: string): CandidateDefinition[] {
  const roots = [
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
  ];
  const out: CandidateDefinition[] = [];
  for (const root of roots) {
    if (!existsAsDirectory(root)) continue;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(root, { withFileTypes: true }).slice(0, MAX_EXPORT_DIRECTORY_ENTRIES); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (!(lower === 'conversations.json' || (/chatgpt|openai/.test(lower) && /\.(json|zip)$/i.test(lower)))) continue;
      const sourcePath = path.join(root, entry.name);
      out.push(candidate({
        id: `chatgpt-export-${Buffer.from(sourcePath).toString('base64url').slice(-24)}`,
        provider: 'chatgpt',
        label: 'ChatGPT official export',
        kind: 'conversation',
        adapter: 'chatgpt-export',
        supportsProjects: false,
        root: sourcePath,
        mode: 'file',
        includeWhen: (stats) => stats.files === 1,
        notes: ['Only official conversations.json or a clearly named ChatGPT/OpenAI export is surfaced automatically.'],
      }));
    }
  }
  return out;
}

function definitions(options: Required<Pick<ImportDiscoveryOptions, 'homeDir' | 'localAppData' | 'appData'>>): CandidateDefinition[] {
  const { homeDir, localAppData, appData } = options;
  return [
    candidate({
      id: 'hermes-conversations', provider: 'hermes', label: 'Hermes Agent', kind: 'conversation', adapter: 'hermes-local',
      supportsProjects: true,
      root: path.join(localAppData, 'hermes', 'sessions'), mode: 'directory',
      includeWhen: (stats) => stats.transcriptCount > 0,
      notes: ['Native Hermes session transcripts are previewed before import.'],
    }),
    candidate({
      id: 'hermes-setup', provider: 'hermes', label: 'Hermes MCP integrations', kind: 'setup', adapter: 'setup-config',
      supportsProjects: false,
      root: path.join(localAppData, 'hermes'), mode: 'directory',
      includeWhen: (stats) => stats.setupFileCount > 0,
      notes: ['Local MCP declarations only; secrets are redacted and must be reauthorized.'],
    }),
    candidate({
      id: 'codex-conversations', provider: 'codex', label: 'Codex', kind: 'conversation', adapter: 'codex-local',
      supportsProjects: true,
      root: path.join(homeDir, '.codex', 'sessions'), mode: 'directory',
      includeWhen: (stats) => stats.transcriptCount > 0,
      notes: ['Only local rollout/session artifacts are inspected; Codex private web history is not scraped.'],
    }),
    candidate({
      id: 'codex-mcp-integrations', provider: 'codex', label: 'Codex MCP integrations', kind: 'setup', adapter: 'setup-config',
      supportsProjects: false,
      root: path.join(homeDir, '.codex', 'config.toml'), mode: 'file',
      includeWhen: (stats) => stats.setupFileCount > 0,
      notes: ['Codex MCP server declarations are imported as disabled Prometheus integrations; provider plugin packages remain metadata only.'],
    }),
    candidate({
      id: 'claude-code-conversations', provider: 'claude', label: 'Claude Code', kind: 'conversation', adapter: 'claude-code-local',
      supportsProjects: true,
      root: path.join(homeDir, '.claude', 'projects'), mode: 'directory',
      includeWhen: (stats) => stats.transcriptCount > 0,
      notes: ['Local Claude Code project transcripts only.'],
    }),
    candidate({
      id: 'claude-code-setup', provider: 'claude', label: 'Claude Code MCP integrations', kind: 'setup', adapter: 'setup-config',
      supportsProjects: false,
      root: path.join(homeDir, '.claude'), mode: 'directory',
      includeWhen: (stats) => stats.setupFileCount > 0 && stats.bytes <= MAX_SCAN_BYTES,
      notes: ['Local MCP declarations only; credentials and tokens are not copied.'],
    }),
    candidate({
      id: 'claude-code-mcp-config', provider: 'claude', label: 'Claude MCP integrations', kind: 'setup', adapter: 'setup-config',
      supportsProjects: false,
      root: path.join(homeDir, '.claude.json'), mode: 'file',
      includeWhen: (stats) => stats.setupFileCount > 0,
      notes: ['Only local MCP declarations are read; no Claude web account or private UI scraping is used.'],
    }),
    candidate({
      id: 'claude-desktop-mcp-config', provider: 'claude', label: 'Claude Desktop MCP integrations', kind: 'setup', adapter: 'setup-config',
      supportsProjects: false,
      root: path.join(appData, 'Claude', 'claude_desktop_config.json'), mode: 'file',
      includeWhen: (stats) => stats.setupFileCount > 0,
      notes: ['Local Claude Desktop MCP declarations only; secrets require reauthorization in Prometheus.'],
    }),
    candidate({
      id: 'openclaw-conversations', provider: 'openclaw', label: 'OpenClaw', kind: 'conversation', adapter: 'openclaw-local',
      supportsProjects: true,
      root: path.join(homeDir, '.openclaw'), mode: 'directory',
      includeWhen: (stats) => stats.transcriptCount > 0,
      notes: ['OpenClaw gateway/session files are treated as historical data during import.'],
    }),
    candidate({
      id: 'openclaw-setup', provider: 'openclaw', label: 'OpenClaw MCP integrations', kind: 'setup', adapter: 'setup-config',
      supportsProjects: false,
      root: path.join(homeDir, '.openclaw'), mode: 'directory',
      includeWhen: (stats) => stats.setupFileCount > 0,
      notes: ['Local MCP declarations only; gateway credentials and pairing secrets require reauthorization.'],
    }),
    candidate({
      id: 'localclaw-conversations', provider: 'localclaw', label: 'LocalClaw', kind: 'conversation', adapter: 'localclaw-local',
      supportsProjects: true,
      root: path.join(homeDir, '.localclaw'), mode: 'directory',
      includeWhen: (stats) => stats.transcriptCount > 0,
      notes: ['LocalClaw artifacts are shown only when transcript-like files are present.'],
    }),
    candidate({
      id: 'localclaw-setup', provider: 'localclaw', label: 'LocalClaw MCP integrations', kind: 'setup', adapter: 'setup-config',
      supportsProjects: false,
      root: path.join(homeDir, '.localclaw'), mode: 'directory',
      includeWhen: (stats) => stats.setupFileCount > 0,
      notes: ['Local MCP declarations only; secrets are redacted and must be reauthorized.'],
    }),
    ...[
      path.join(appData, 'Cursor', 'User', 'History'),
      path.join(appData, 'Cursor', 'User', 'globalStorage'),
      path.join(localAppData, 'Cursor', 'User', 'History'),
      path.join(homeDir, '.cursor'),
    ].map((root, index) => candidate({
      id: `cursor-conversations-${index + 1}`, provider: 'cursor', label: 'Cursor', kind: 'conversation', adapter: 'cursor-local',
      supportsProjects: false,
      root, mode: 'directory',
      includeWhen: (stats) => stats.transcriptCount > 0,
      notes: ['Cursor local database/history artifacts are supported where the schema exposes transcript messages.'],
    })),
    ...chatGptExportCandidates(homeDir),
  ];
}

export function discoverImportSources(options: ImportDiscoveryOptions = {}): ImportDiscoveryResult {
  const homeDir = normalizedPath(options.homeDir || os.homedir());
  const localAppData = normalizedPath(options.localAppData || defaultLocalAppData(homeDir));
  const appData = normalizedPath(options.appData || defaultAppData(homeDir));
  const seen = new Set<string>();
  const sources: DiscoveredImportSource[] = [];

  for (const definition of definitions({ homeDir, localAppData, appData })) {
    const root = normalizedPath(definition.root);
    const dedupe = `${definition.kind}:${root.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (definition.mode === 'directory' ? !existsAsDirectory(root) : !existsAsRegularFile(root)) continue;
    const stats = scanPath(root, definition.adapter, definition.mode);
    if (!definition.includeWhen(stats)) continue;
    const notes = [...(definition.notes || [])];
    if (stats.capped) notes.push('Discovery reached its safety bound; build a preview to validate the complete selected source.');
    const previewable = !stats.capped && stats.bytes <= MAX_SCAN_BYTES;
    const previewBlockReason = previewable
      ? undefined
      : stats.capped
        ? 'This source is larger than the bounded discovery scan. Choose a smaller subfolder for preview.'
        : `This source exceeds the ${Math.round(MAX_SCAN_BYTES / 1024 / 1024)} MiB single-import safety limit. Choose a smaller subfolder.`;
    if (previewBlockReason) notes.push(previewBlockReason);
    const batches = definition.adapter === 'codex-local' && definition.kind === 'conversation' ? codexBatches(root) : [];
    if (batches.length > 1) notes.push(`Codex sessions are available as ${batches.length} bounded import batches; each batch gets its own preview, retry, and rollback record.`);
    sources.push({
      id: definition.id,
      provider: definition.provider,
      label: definition.label,
      kind: definition.kind,
      adapter: definition.adapter,
      supportsProjects: definition.supportsProjects,
      sourcePath: root,
      transcriptCount: stats.transcriptCount,
      setupFileCount: stats.setupFileCount,
      bytes: stats.bytes,
      capped: stats.capped,
      previewable,
      ...(previewBlockReason ? { previewBlockReason } : {}),
      batchable: batches.length > 0,
      ...(batches.length ? { batches } : {}),
      notes,
    });
  }

  const now = options.now || (() => new Date());
  return { scannedAt: now().toISOString(), sources };
}
