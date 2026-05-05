// src/gateway/prompt-context.ts
// Full prompt context assembly — workspace memory, personality, tool hints, skill windows.
// Extracted from server-v2.ts (Step 12 of Phase 3 refactor).

import path from 'path';
import fs from 'fs';
import { hookBus } from './hooks';
import { SkillsManager } from './skills-runtime/skills-manager';
import { getConfig } from '../config/config';
import { getActivatedToolCategories, isBusinessContextEnabled } from './session';
import { searchMemoryIndex } from './memory-index/index';
import { getPublicBuildAllowedCategories, isPublicDistributionBuild } from '../runtime/distribution.js';

// ─── Intraday notes processor ────────────────────────────────────────────────────
// Parses raw intraday file content into capped-length entries for context injection.
// Keeps only the last `maxEntries` notes and truncates each body to `maxCharsPerEntry` chars.
function processIntradayNotes(raw: string, maxEntries = 12, maxCharsPerEntry = 250): string {
  if (!raw) return '';
  // Split on section headers while keeping the header in each chunk
  const parts = raw.split(/(?=\n?### \[)/);
  const entries = parts.map(p => p.trim()).filter(p => p.startsWith('### ['));
  const recent = entries.slice(-maxEntries);
  return recent.map(entry => {
    const headerEnd = entry.indexOf('\n');
    if (headerEnd === -1) return entry;
    const header = entry.slice(0, headerEnd);
    const body = entry.slice(headerEnd + 1).trim();
    const truncated = body.length > maxCharsPerEntry ? body.slice(0, maxCharsPerEntry) + '…' : body;
    return `${header}\n${truncated}`;
  }).join('\n\n');
}

// ─── Types ───────────────────────────────────────────────────────────────────────
export interface SkillWindow {
  triggeredAtTurn: number;
  lastActiveAtTurn: number;
  reassessCount: number;
}

export interface BuildPersonalityContextOptions {
  profile?: 'default' | 'switch_model' | 'local_llm' | 'creative_design' | 'creative_image' | 'creative_canvas' | 'creative_video' | 'teach_mode';
}

function loadCreativeRuntimeGuide(profile: NonNullable<BuildPersonalityContextOptions['profile']>): string {
  const docName = profile === 'creative_video'
    ? 'video-mode.md'
    : profile === 'creative_design'
      ? 'design-mode.md'
      : 'image-mode.md';
  const toolDocName = profile === 'creative_video'
    ? 'video-tools.md'
    : profile === 'creative_image' || profile === 'creative_canvas'
      ? 'image-tools.md'
      : '';
  const readFirst = (candidates: string[]): string => {
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8').slice(0, 9000);
      } catch {}
    }
    return '';
  };
  const guide = readFirst([
    path.resolve(process.cwd(), 'workspace', 'creatives', 'modes', docName),
    path.resolve(process.cwd(), 'src', 'gateway', 'creative', 'prompts', docName),
    path.resolve(process.cwd(), 'dist', 'gateway', 'creative', 'prompts', docName),
  ]);
  const tools = toolDocName ? readFirst([
    path.resolve(process.cwd(), 'src', 'gateway', 'creative', 'tool-docs', toolDocName),
    path.resolve(process.cwd(), 'dist', 'gateway', 'creative', 'tool-docs', toolDocName),
  ]) : '';
  return [guide, tools].filter(Boolean).join('\n\n');
}

const BOOT_COMPACTION_EXCLUDE_SESSION_RE = /^(startup_connection_probe_|brain_|auto_boot_|auto_restart_|task_|cron_|background_|team_dispatch_|subagent_chat_)/i;

type BootCompactionSummary = {
  kind: string;
  sessionId: string;
  timestamp: number;
  timestampIso: string;
  summary: string;
};

type BootRunState = {
  lastRunAt?: number;
};

function getLocalDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseBootCompactionBlocks(sessionId: string, raw: string, fallbackTimestampMs: number): BootCompactionSummary[] {
  const blocks = String(raw || '')
    .split(/(?=^### \[[A-Z_]+\]\s+)/m)
    .map((part) => part.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const header = lines[0]?.match(/^### \[([A-Z_]+)\]\s+(.+)$/);
    if (!header) return null;
    const firstBlank = lines.findIndex((line, idx) => idx > 0 && !line.trim());
    const summaryLines = firstBlank === -1 ? lines.slice(1) : lines.slice(firstBlank + 1);
    const summary = summaryLines.join('\n').replace(/\s+/g, ' ').trim();
    if (!summary) return null;
    const timestampMs = Number.isFinite(Date.parse(header[2])) ? Date.parse(header[2]) : fallbackTimestampMs;
    return {
      kind: header[1],
      sessionId,
      timestamp: timestampMs,
      timestampIso: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : header[2],
      summary: summary.slice(0, 650),
    };
  }).filter((entry): entry is BootCompactionSummary => !!entry);
}

function readBootRunState(workspacePath: string): BootRunState | null {
  try {
    const statePath = path.join(workspacePath, '.prometheus', 'boot-md-state.json');
    if (!fs.existsSync(statePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const lastRunAt = Number(parsed.lastRunAt);
    return { lastRunAt: Number.isFinite(lastRunAt) ? lastRunAt : undefined };
  } catch {
    return null;
  }
}

function getBootRecentSinceTs(workspacePath: string): number {
  const now = Date.now();
  const windowStart24h = now - (24 * 60 * 60 * 1000);
  const bootState = readBootRunState(workspacePath);
  return Math.max(windowStart24h, Number(bootState?.lastRunAt || 0));
}

function readBootCompactionSummaries(workspacePath: string): string {
  try {
    const compactionDir = path.join(workspacePath, 'audit', 'chats', 'compactions');
    if (!fs.existsSync(compactionDir)) return 'compaction_summaries: none';
    const sinceTs = getBootRecentSinceTs(workspacePath);

    const files = fs.readdirSync(compactionDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .filter((name) => !BOOT_COMPACTION_EXCLUDE_SESSION_RE.test(name.replace(/\.md$/i, '')));

    const summaries = files.flatMap((name) => {
      const fullPath = path.join(compactionDir, name);
      try {
        const stat = fs.statSync(fullPath);
        const raw = fs.readFileSync(fullPath, 'utf-8');
        return parseBootCompactionBlocks(name.replace(/\.md$/i, ''), raw, stat.mtimeMs);
      } catch {
        return [];
      }
    })
      .filter((entry) => entry.timestamp >= sinceTs)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 6);

    if (summaries.length === 0) return 'compaction_summaries: none';

    return [
      `compaction_summaries (since ${new Date(sinceTs).toISOString()}):`,
      ...summaries.map((entry) => `- [${entry.timestampIso}] ${entry.sessionId} (${entry.kind}): ${entry.summary}`),
    ].join('\n');
  } catch (err: any) {
    return `compaction_summaries: unavailable (${String(err?.message || err || 'unknown')})`;
  }
}

type BootBrainArtifact = {
  kind: 'thought' | 'dream';
  relPath: string;
  timestamp: number;
  summary: string;
};

function compactSingleLine(value: string, maxChars = 320): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}...` : text;
}

function extractMarkdownSection(raw: string, heading: string): string {
  const lines = String(raw || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/.test(line.trim())) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

function extractBrainArtifactSummary(kind: 'thought' | 'dream', raw: string): string {
  if (kind === 'dream') {
    const section = extractMarkdownSection(raw, '## Day Summary');
    if (section) return compactSingleLine(section, 420);
  } else {
    const activity = extractMarkdownSection(raw, '## A. Activity Summary');
    if (activity) return compactSingleLine(activity, 420);
    const verdict = extractMarkdownSection(raw, '## E. Window Verdict');
    if (verdict) return compactSingleLine(verdict, 420);
  }

  const fallback = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && line !== '---');
  return compactSingleLine(fallback || '(summary unavailable)', 420);
}

function collectRecentBrainArtifacts(
  workspacePath: string,
  baseDir: string,
  suffix: '-thought.md' | '-dream.md',
  kind: 'thought' | 'dream',
  sinceTs: number,
): BootBrainArtifact[] {
  if (!fs.existsSync(baseDir)) return [];
  const out: BootBrainArtifact[] = [];
  const stack: string[] = [baseDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < sinceTs) continue;
        const raw = fs.readFileSync(fullPath, 'utf-8');
        out.push({
          kind,
          relPath: path.relative(workspacePath, fullPath).replace(/\\/g, '/'),
          timestamp: stat.mtimeMs,
          summary: extractBrainArtifactSummary(kind, raw),
        });
      } catch {
        continue;
      }
    }
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}

function readBrainLatestState(workspacePath: string): Record<string, any> | null {
  try {
    const statePath = path.join(workspacePath, 'Brain', 'state', 'latest.json');
    if (!fs.existsSync(statePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function formatBootBrainAttempt(kind: 'thought' | 'dream', latestState: Record<string, any>, sinceTs: number): string {
  const attemptAtRaw = kind === 'thought' ? latestState.lastThoughtAttemptAt : latestState.lastDreamAttemptAt;
  const attemptTs = Number.isFinite(Date.parse(String(attemptAtRaw || ''))) ? Date.parse(String(attemptAtRaw || '')) : NaN;
  if (!Number.isFinite(attemptTs) || attemptTs < sinceTs) return '';

  const status = String(kind === 'thought' ? latestState.lastThoughtStatus : latestState.lastDreamStatus || 'idle');
  const detail = kind === 'thought'
    ? (latestState.lastThoughtWindow ? `window ${latestState.lastThoughtWindow}` : '')
    : (latestState.lastDreamAttemptDate ? `target ${latestState.lastDreamAttemptDate}` : '');
  const errorText = compactSingleLine(String(kind === 'thought' ? latestState.lastThoughtError || '' : latestState.lastDreamError || ''), 220);
  const suffix = status === 'failed' && errorText
    ? `: ${errorText}`
    : '';
  return `- ${kind}_attempt [${new Date(attemptTs).toISOString()}] ${status}${detail ? ` (${detail})` : ''}${suffix}`;
}

function readBootBrainActivity(workspacePath: string): string {
  try {
    const sinceTs = getBootRecentSinceTs(workspacePath);
    const latestState = readBrainLatestState(workspacePath);
    const thoughtArtifacts = collectRecentBrainArtifacts(
      workspacePath,
      path.join(workspacePath, 'Brain', 'thoughts'),
      '-thought.md',
      'thought',
      sinceTs,
    );
    const dreamArtifacts = collectRecentBrainArtifacts(
      workspacePath,
      path.join(workspacePath, 'Brain', 'dreams'),
      '-dream.md',
      'dream',
      sinceTs,
    );

    const lines: string[] = [];
    if (latestState) {
      const thoughtAttempt = formatBootBrainAttempt('thought', latestState, sinceTs);
      const dreamAttempt = formatBootBrainAttempt('dream', latestState, sinceTs);
      if (thoughtAttempt) lines.push(thoughtAttempt);
      if (dreamAttempt) lines.push(dreamAttempt);
    }

    const recentArtifacts = [...thoughtArtifacts.slice(0, 2), ...dreamArtifacts.slice(0, 1)]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3);
    for (const artifact of recentArtifacts) {
      lines.push(
        `- ${artifact.kind}_file [${new Date(artifact.timestamp).toISOString()}] ${artifact.relPath}: ${artifact.summary || '(summary unavailable)'}`,
      );
    }

    const deduped = Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
    if (deduped.length === 0) return 'brain_activity: none';

    return [
      `brain_activity (since ${new Date(sinceTs).toISOString()}):`,
      ...deduped,
    ].join('\n');
  } catch (err: any) {
    return `brain_activity: unavailable (${String(err?.message || err || 'unknown')})`;
  }
}

// ─── buildBootStartupSnapshot ────────────────────────────────────────────────────
// Builds the lightweight BOOT.md snapshot used for the once-per-day startup
// message: yesterday's intraday notes, recent compaction summaries, and
// recent overnight brain/dream activity.
export function buildBootStartupSnapshot(
  workspacePath: string,
): string {
  const lines: string[] = [];
  lines.push(`workspace_path: ${workspacePath}`);
  lines.push('startup_focus: yesterday_intraday_notes_compactions_and_recent_brain_activity');

  const now = new Date();
  const yesterday = getLocalDateKey(new Date(now.getTime() - (24 * 60 * 60 * 1000)));
  const memDir = path.join(workspacePath, 'memory');

  // Read only yesterday's intraday notes for boot context. These are the
  // structured ### [TAG] entries written by write_note — the main carryover signal.
  const yesterdayIntraday = path.join(memDir, `${yesterday}-intraday-notes.md`);
  if (fs.existsSync(yesterdayIntraday)) {
    try {
      const intradayContent = fs.readFileSync(yesterdayIntraday, 'utf-8').trim();
      const processed = processIntradayNotes(intradayContent, 12, 300);
      const body = processed || intradayContent.slice(-2200) || '(empty)';
      const intradayFilename = path.basename(yesterdayIntraday);
      lines.push(`yesterday_intraday_notes (${intradayFilename}):`);
      lines.push(body);
    } catch {
      lines.push('yesterday_intraday_notes: unreadable');
    }
  } else {
    lines.push(`yesterday_intraday_notes (${yesterday}-intraday-notes.md): none`);
  }

  lines.push(readBootCompactionSummaries(workspacePath));
  lines.push(readBootBrainActivity(workspacePath));

  return lines.join('\n');
}

// ─── loadWorkspaceFile ────────────────────────────────────────────────────────────
export function loadWorkspaceFile(workspacePath: string, filename: string, maxChars: number = 500): string {
  try {
    const filePath = path.join(workspacePath, filename);
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content.length <= maxChars) return content;
    return content.slice(0, maxChars) + '\n...(truncated)';
  } catch { return ''; }
}

function loadBusinessContextProfile(workspacePath: string, maxChars: number = 4000): string {
  return loadWorkspaceFile(workspacePath, 'BUSINESS.md', maxChars);
}

function stripMemoryToolHints(content: string): string {
  if (!content) return content;
  const filtered = content
    .split('\n')
    .filter((line) => {
      const s = line.trim();
      if (!s) return true;
      if (/Prom builds this file over time/i.test(s)) return false;
      if (/This file is yours\. Prom builds and evolves it over time/i.test(s)) return false;
      if (/Use memory_browse\("user"\)/i.test(s)) return false;
      if (/Use memory_browse\("soul"\)/i.test(s)) return false;
      if (/memory_read\("user"\)/i.test(s)) return false;
      if (/memory_read\("soul"\)/i.test(s)) return false;
      return true;
    })
    .join('\n');
  return filtered.replace(/\n{3,}/g, '\n\n').trim();
}

function readMemoryProfileFile(filePath: string, maxChars?: number): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const cleaned = stripMemoryToolHints(content);
    if (typeof maxChars !== 'number' || maxChars <= 0 || cleaned.length <= maxChars) return cleaned;
    return `${cleaned.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...[truncated]`;
  } catch {
    return '';
  }
}

function loadFullMemoryProfile(
  workspacePath: string,
  filename: 'USER.md' | 'SOUL.md' | 'MEMORY.md',
  maxChars?: number,
  fallbackWorkspacePaths: string[] = [],
): string {
  const candidatePaths = [
    path.join(workspacePath, filename),
    ...fallbackWorkspacePaths
      .map((fallbackPath) => String(fallbackPath || '').trim())
      .filter(Boolean)
      .map((fallbackPath) => path.join(fallbackPath, filename)),
  ];
  const seen = new Set<string>();
  for (const candidatePath of candidatePaths) {
    const resolved = path.resolve(candidatePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const content = readMemoryProfileFile(resolved, maxChars);
    if (content) return content;
  }
  return '';
}

// ─── readDailyMemoryContext ───────────────────────────────────────────────────────
export function readDailyMemoryContext(workspacePath: string, maxTokens: number = 800): string {
  try {
    const memDir = path.join(workspacePath, 'memory');
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const sections: string[] = [];

    for (const day of [yesterday, today]) {
      const p = path.join(memDir, `${day}.md`);
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf-8').trim();
      if (!raw) continue;
      sections.push(`### Memory: ${day}\n${raw}`);
    }

    if (!sections.length) return '';

    let combined = sections.join('\n\n');
    const charLimit = Math.floor(maxTokens * 3.5);
    if (combined.length > charLimit) {
      combined = combined.slice(-charLimit);
    }
    return `\n\n## Recent Memory Notes\n${combined}`;
  } catch {
    return '';
  }
}

type MemorySearchRouting = {
  mode: 'no_search' | 'light_search' | 'deep_search';
  reason: string;
};

function routeMemorySearchMode(messageText: string): MemorySearchRouting {
  const text = String(messageText || '').toLowerCase();
  if (!text.trim()) return { mode: 'no_search', reason: 'empty_message' };

  const deepCues = [
    'everything we discussed',
    'all history',
    'across sessions',
    'over time',
    'timeline',
    'full context',
    'what changed',
    'comprehensive history',
    'all previous',
  ];
  if (deepCues.some((k) => text.includes(k))) return { mode: 'deep_search', reason: 'deep_cue' };

  const lightCues = [
    'previous',
    'earlier',
    'last time',
    'we talked about',
    'we decided',
    'decision',
    'history',
    'remember when',
    'past discussion',
    'what did we decide',
    'context from before',
  ];
  if (lightCues.some((k) => text.includes(k))) return { mode: 'light_search', reason: 'history_cue' };

  return { mode: 'no_search', reason: 'not_needed' };
}

function buildRetrievedMemoryContext(workspacePath: string, messageText: string, routing: MemorySearchRouting): string {
  if (routing.mode === 'no_search') return '';
  try {
    const searchMode = routing.mode === 'deep_search' ? 'deep' : 'quick';
    const limit = routing.mode === 'deep_search' ? 8 : 4;
    const result = searchMemoryIndex(workspacePath, {
      query: messageText,
      mode: searchMode as any,
      limit,
    });
    if (!Array.isArray(result.hits) || result.hits.length === 0) {
      return `[MEMORY_SEARCH_ROUTING]\nmode=${routing.mode}\nreason=${routing.reason}\nresults=none`;
    }
    const lines = [
      `[MEMORY_SEARCH_ROUTING]`,
      `mode=${routing.mode}`,
      `reason=${routing.reason}`,
      `results=${result.hits.length}`,
      `[MEMORY_RETRIEVED]`,
      ...result.hits.map((h) => `- score=${h.score} | record=${h.recordId} | source=${h.sourceType} | path=${h.sourcePath} | ${h.preview}`),
      `For deeper evidence, call memory_read_record(record_id).`,
    ];
    return lines.join('\n');
  } catch (err: any) {
    return `[MEMORY_SEARCH_ROUTING]\nmode=${routing.mode}\nreason=search_error\nerror=${String(err?.message || err)}`;
  }
}

// ─── detectToolCategories ─────────────────────────────────────────────────────────
export function detectToolCategories(text: string): Set<string> {
  const lower = String(text || '').toLowerCase();
  const cats = new Set<string>();
  const WEB = ['search', 'find', 'look up', 'google', 'what is', 'who is', 'news', 'latest', 'research', 'look into', 'check online', 'summarize', 'article', 'read about'];
  const BROWSER = [
    'open', 'login', 'log in', 'website', 'click', 'fill', 'form', 'navigate', 'go to', 'browse', 'sign in', 'download',
    'x.com', 'twitter', 'tweet', 'post on x', 'post to x', 'publish on x',
  ];
  const DESKTOP = ['desktop', 'screenshot', 'window', 'focus window', 'app', 'screen', 'type into', 'drag', 'clipboard'];
  const FILES = [
    'read file', 'write file', 'edit file', 'create file', 'modify', 'replace', 'open file',
    'delete file', 'rename', 'copy file', 'make a file', 'update the file', 'change the file',
    'save to', 'markdown edit', 'md edit', 'edit markdown', 'skill update', 'prompt update',
    'update instructions', 'change instructions',
  ];
  const TASK = ['task', 'background', 'run this', 'start a', 'status', 'paused', 'resume', 'in progress', 'what tasks', 'running tasks'];
  const SCHEDULE = ['schedule', 'every day', 'every week', 'at ', 'recurring', 'cron', 'automate', 'remind me', 'daily', 'weekly'];
  const SHELL = ['run command', 'execute', 'terminal', 'powershell', 'script', 'command line', 'cmd', 'bash'];
  // Much stricter MEMORY detection — only explicit memory operations, not casual conversation
  const MEMORY = ['remember this', 'note that', 'save that', 'write that down', 'dont forget', "don't forget", 'update my memory', 'add to my memory', 'save to memory', 'memory note', 'remember:', 'note:', 'update memory', 'memory write'];
  const DEBUG = ['why', 'error', 'failed', 'how does', 'architecture', 'debug', 'caused', 'broke', 'not working', 'explain how', 'whats wrong', "what's wrong"];
  const TEAMS = ['team', 'sub-team', 'sub team', 'managed team', 'team manager', 'team chat', 'team members'];
  const INTEGRATIONS = ['integration', 'integrations', 'mcp', 'model context protocol', 'webhook', 'supabase', 'connect service', 'connect to'];
  const MEDIA = ['download_url', 'download_media', 'analyze_image', 'analyze_video', 'download image', 'download video', 'analyze image', 'analyze video', 'media analysis'];
  const MEDIA_QUALITY = ['contrast', 'text overflow', 'empty region', 'bounds summary', 'element at point', 'overlap', 'contact sheet', 'render frame', 'audio sync', 'caption timing'];
  const AUTOMATIONS = ['schedule', 'scheduled', 'every day', 'every week', 'recurring', 'cron', 'automate', 'automation', 'remind me', 'daily', 'weekly'];
  const CREATIVE_MODE = ['creative mode', 'image mode', 'video mode', 'design mode', 'enter creative', 'exit creative'];
  const CONNECTORS = ['gmail', 'github', 'slack', 'notion', 'google drive', 'hubspot', 'salesforce', 'stripe', 'ga4', 'external app', 'connected app'];
  if (WEB.some(k => lower.includes(k))) cats.add('web');
  if (BROWSER.some(k => lower.includes(k))) cats.add('browser');
  if (DESKTOP.some(k => lower.includes(k))) cats.add('desktop');
  if (FILES.some(k => lower.includes(k))) cats.add('files');
  if (TASK.some(k => lower.includes(k))) cats.add('task');
  if (SCHEDULE.some(k => lower.includes(k))) cats.add('schedule');
  if (SHELL.some(k => lower.includes(k))) cats.add('shell');
  if (MEMORY.some(k => lower.includes(k))) cats.add('memory');
  if (DEBUG.some(k => lower.includes(k))) cats.add('debug');
  if (TEAMS.some(k => lower.includes(k))) cats.add('teams');
  if (INTEGRATIONS.some(k => lower.includes(k))) cats.add('integrations');
  if (MEDIA.some(k => lower.includes(k))) cats.add('media');
  if (MEDIA_QUALITY.some(k => lower.includes(k))) cats.add('media_quality');
  if (AUTOMATIONS.some(k => lower.includes(k))) cats.add('automations');
  if (CREATIVE_MODE.some(k => lower.includes(k))) cats.add('creative_mode');
  if (CONNECTORS.some(k => lower.includes(k))) cats.add('external_apps');
  const AGENT_BUILDER = ['workflow', 'agent builder', 'agentbuilder', 'architect workflow', 'deploy workflow', 'execute workflow', 'workflow template'];
  const agentBuilderConfigEnabled = (() => { try { return (getConfig().getConfig() as any)?.agent_builder?.enabled === true; } catch { return false; } })();
  if (agentBuilderConfigEnabled && AGENT_BUILDER.some(k => lower.includes(k))) cats.add('agent_builder');
  const AGENTS = ['agent', 'subagent', 'sub-agent', 'spawn', 'worker', 'agent_list', 'agent_info', 'spawn_agent', 'what agents', 'our agents', 'check the agent', 'who do we have', 'configure agent', 'create agent', 'new agent', 'delegate', 'automate with'];
  if (AGENTS.some(k => lower.includes(k))) cats.add('agents');
  const ROUTING = ['dispatch', 'route', 'routing', 'dispatch_to_agent', 'jarvis', 'send to agent', 'forward to', 'hand off', 'handoff'];
  if (ROUTING.some(k => lower.includes(k))) cats.add('routing');
  // DISABLED: Don't auto-add 'skills' — only add it if explicitly detected or user asks for execution
  // if (cats.size > 0) cats.add('skills');
  return cats;
}

// ─── readMemoryCategories ─────────────────────────────────────────────────────────
export function readMemoryCategories(workspacePath: string, file: 'user' | 'soul' | 'memory'): string[] {
  const filename = file === 'user'
    ? 'USER.md'
    : (file === 'soul' ? 'SOUL.md' : 'MEMORY.md');
  const filePath = path.join(workspacePath, filename);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const matches = content.match(/^##\s+([^\n]+)/gm) || [];
  return matches.map(m => m.replace(/^##\s+/, '').trim());
}

// ─── readMemorySnippets ───────────────────────────────────────────────────────────
export function readMemorySnippets(workspacePath: string, categories: string[]): string {
  if (categories.length === 0) return '';
  const snippets: string[] = [];
  for (const file of ['USER.md', 'SOUL.md', 'MEMORY.md']) {
    const filePath = path.join(workspacePath, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let inSection = false;
    let currentSection = '';
    const sectionLines: string[] = [];
    for (const line of lines) {
      const headingMatch = line.match(/^##\s+(.+)/);
      if (headingMatch) {
        if (inSection && sectionLines.length > 0) {
          snippets.push(`[${file}:${currentSection}]\n${sectionLines.join('\n')}`);
        }
        currentSection = headingMatch[1].trim();
        inSection = categories.some(cat => currentSection.toLowerCase().includes(cat.toLowerCase()) || cat.toLowerCase().includes(currentSection.toLowerCase()));
        sectionLines.length = 0;
      } else if (inSection && line.trim()) {
        sectionLines.push(line);
      }
    }
    if (inSection && sectionLines.length > 0) {
      snippets.push(`[${file}:${currentSection}]\n${sectionLines.join('\n')}`);
    }
  }
  return snippets.slice(0, 6).join('\n\n');
}

// ─── TOOL_BLOCKS and TOOL_TO_MEMORY_CATS ─────────────────────────────────────────
// These constants are consumed by buildPersonalityContext. Exported so
// consumers can extend or inspect them without importing server-v2.
export const TOOL_BLOCKS: Record<string, string> = {
  web: `WEB: web_search(query, max_results?, multi_engine?)→snippets+URLs. web_fetch(url)→full page text. Search first, then fetch.
Strategy: for complex topics call web_search 2–3× with different query angles; scan snippets; web_fetch the 1–3 most relevant URLs.
multi_engine:true queries all configured providers in parallel for broader coverage.
Site search: web_search("site:reddit.com keyword"). Fallback: web_fetch a direct URL (reuters.com, apnews.com, bbc.com).
Fetch routing: web_fetch for static pages; browser_get_page_text for JS-heavy or login-gated pages.`,

  browser: `BROWSER: browser_open(url)→compact ack unless observe="snapshot". browser_snapshot()→refresh DOM refs. browser_vision_screenshot()→viewport image. browser_click(@ref|element). browser_fill(@ref|element,text). browser_drag(from_ref|coords→to_ref|coords). browser_upload_file(ref?|selector,file_path|file_paths). browser_press_key(key). browser_wait(ms). browser_click_and_download(@ref). browser_get_page_text(element?)→full text incl. iframes or saved element details (use when <12 elements or when reading a named element). download_url(url,filename?). download_media(url,audio_only?). generate_image(prompt, aspect_ratio?, provider?, model?). browser_close(). Chrome persistent profile (pre-logged-in).
RULES: visual-first workflow. Vision screenshots are highest-confidence on dynamic/SPA UIs. If DOM refs or JS-derived assumptions are uncertain, stale, or contradictory, take a fresh browser_vision_screenshot and trust that evidence first. After browser actions, prefer a fresh browser_snapshot (or browser_vision_screenshot when UI is ambiguous) before the next decision only when state likely changed or you need updated state; use observe="none" on cheap deterministic actions when a tiny ack is sufficient. Treat browser_run_js as fallback for cases where snapshot/vision still cannot identify the target. Composer fills show "COMPOSER SUBMIT BUTTON: @N" — click it immediately, nothing else. j/k nav: call browser_get_focused_item only when focus is unclear or you need to confirm position after navigation. Use ⌨️ SITE SHORTCUTS when shown; save new ones with save_site_shortcut().
MEDIA SELECTION: when choosing an image/video on X, Google Images, or similar pages, first enumerate candidates via browser_snapshot/browser_extract_structured using nearby text, alt text, username, timestamp, href, or src. Rank candidates by text match to the request, then take browser_vision_screenshot to visually confirm the intended item before downloading. Prefer download_url for direct asset URLs and browser_click_and_download for browser-triggered downloads.`,

  desktop: `DESKTOP: desktop_get_monitors()→monitor indices+bounds. desktop_screenshot()→screen+monitors+screenshot_id (capture=all|primary|monitor_index=N). desktop_window_screenshot(name|handle|active)→single app window crop+screenshot_id. desktop_click(x,y, coordinate_space?, screenshot_id?, verify?) is an actual mouse click at those coordinates; never call it without numeric x and y. If the target point is not known yet, take a screenshot first, then click with coordinates from that image. desktop_scroll/drag use the same targeting model and optional verification. desktop_type/press_key. desktop_find_window/focus_window. Clipboard get/set. desktop_list_installed_apps(filter?) and desktop_find_installed_app(query) return stable app_id values; prefer desktop_launch_app(app_id=...) over guessing raw app names. Screenshot/get_monitors first; prefer coordinate_space="capture" with screenshot_id when clicking from screenshot pixels, or coordinate_space="window" for app-local coords. Leave verify on auto unless speed matters. Focus before click/type. After desktop actions, prefer another screenshot before choosing the next action when the UI likely changed or the outcome is ambiguous.`,

  files: isPublicDistributionBuild()
    ? `FILES: file_stats(path)→line count+size+modified (check this first on unknown files). read_file(path, start_line?, num_lines?)→windowed contents+line nums (e.g. start_line:200,num_lines:100 reads lines 200–300). grep_file(path, pattern, context_lines?)→matching lines in one file. search_files(directory?, pattern, file_glob?)→multi-file matches across workspace. find_replace/replace_lines/insert_after/delete_lines→edit. create_file/delete_file/mkdir/list_directory.
MANDATORY EDIT ROUTE: For workspace file edits, native file tools are the default and expected path: file_stats/read_file or grep_file first, then find_replace/replace_lines/insert_after/delete_lines/write_file/create_file. Do not use run_command, Python, PowerShell, sed, or node scripts to edit files unless the user explicitly asks for shell editing or the native tools cannot perform the transformation.
WORKSPACE ONLY: In the public app, file tools operate on the user workspace and generated app data only. Always read before editing.`
    : `FILES: file_stats(path)→line count+size+modified (check this first on unknown files). read_file(path, start_line?, num_lines?)→windowed contents+line nums (e.g. start_line:200,num_lines:100 reads lines 200–300). grep_file(path, pattern, context_lines?)→matching lines in one file. search_files(directory?, pattern, file_glob?)→multi-file matches across workspace. find_replace/replace_lines/insert_after/delete_lines→edit. create_file/delete_file/mkdir/list_directory.
	SRC SURFACES (read-only for all): source_stats|src_stats (src/ file metadata), read_source|list_source|grep_source (src/). webui_source_stats|webui_stats (web-ui/ file metadata), read_webui_source|list_webui_source|grep_webui_source (web-ui/). PROM-ROOT SURFACE (dev-only): list_prom, prom_file_stats, read_prom_file, grep_prom inspect allowlisted Prometheus project-root files/directories such as SELF.md, AGENTS.md, scripts/, electron/, build/, dist/, src/, web-ui/, and .prometheus/ without changing workspace tool semantics.
	Write (proposal/code_exec only): find_replace_source|replace_lines_source|insert_after_source|delete_lines_source|write_source|delete_source for src/; *_webui_source plus delete_webui_source for web-ui/; find_replace_prom|replace_lines_prom|insert_after_prom|delete_lines_prom|write_prom_file|delete_prom_file for allowlisted prom-root files.
	MANDATORY EDIT ROUTE: For workspace file edits, native file tools are the default and expected path: file_stats/read_file or grep_file first, then find_replace/replace_lines/insert_after/delete_lines/write_file/create_file. Do not use run_command, Python, PowerShell, sed, or node scripts to edit files unless the user explicitly asks for shell editing or the native tools cannot perform the transformation.
	EDIT PRIORITY: 1.find_replace_source (targeted, default) 2.replace_lines_source (non-unique text) 3.insert_after_source (add block) 4.delete_lines_source (remove) 5.write_source (new file/full rewrite). Always read before editing.`,

  task: `TASK: task_control(action,...) — list/get/resume/rerun/pause/delete. task_control(list) returns active tasks AND cron jobs in one call. Do NOT use read_file for task state.`,

  schedule: `SCHEDULE: schedule_job(action,...) — list/create/update/pause/resume/delete/run_now. Confirm before mutating.
instruction_prompt must be FULLY SELF-CONTAINED — write as if briefing a fresh agent with zero context. Include: target URL/account, exact step-by-step actions, constraints, success criteria. Labels like "Post to X daily" are invalid — give the agent nothing to act on.`,

  browser_vision: `VISION MODE: Few DOM elements — canvas/WebGL/SPA. browser_vision_screenshot()→viewport PNG. browser_vision_click(x,y)→pixel coords from image. browser_vision_type(x,y,text)→focus+type. Vision screenshot is the primary source of truth in this mode. Workflow: screenshot → pick coords → click/type. Switch back to browser_click(@ref) when element count exceeds 10.`,

  shell: `SHELL: run_command(command)→stdout/stderr/exit. For terminal tasks (git/npm/python/curl). Use browser_* for websites, desktop_* for UI interaction.`,

  memory: `MEMORY: memory_browse(file)→categories. memory_write(file,category,content)→add/update fact. memory_read(file)→full contents. file="user"|"soul"|"memory". Use user for user profile facts, soul for operating rules, memory for durable long-term context and decisions.
LONG-TERM RETRIEVAL: memory_search(query, mode?, ...filters)→ranked hits from indexed audit history. memory_read_record(record_id)→full source record. memory_search_project(project_id, query) and memory_search_timeline(query, date_from?, date_to?) for scoped retrieval. memory_get_related(record_id) expands to connected context.
TRIGGERS: use retrieval when user asks about previous discussions, older decisions, historical project context, what changed over time, or "what did we decide" questions.
GRAPH/DIAGNOSTICS: memory_graph_snapshot() returns relation graph nodes/edges; memory_index_refresh() forces reindex from workspace/audit.
SEARCH MODES: quick(default)=fast focused retrieval; deep=broad recall; project=project-scoped; timeline=chronological history.`,

  integrations: `INTEGRATIONS: mcp_server_manage(action,...)→MCP lifecycle (list/upsert/import/connect/disconnect/delete/list_tools). webhook_manage(action,...)→webhook settings (enabled/token/path). integration_quick_setup(action,...)→one-shot presets (supabase/github/windows/brave/postgres/sqlite/filesystem/memory).`,

  media_assets: `MEDIA ASSETS: download_url(url,filename?) and download_media(url,audio_only?) retrieve remote assets. analyze_image/analyze_video inspect uploaded or downloaded media. Use browser_automation for browser-triggered downloads and media_assets for direct URL/media processing.`,

  media_quality: `MEDIA QUALITY: image_check_contrast, image_check_text_overflow, image_detect_empty_regions, image_get_bounds_summary, image_get_element_at_point, image_get_overlaps, video_render_frame, video_render_contact_sheet, video_check_audio_sync, and video_check_caption_timing validate visual/video output. Activate when checking layout polish, frame rendering, captions, or audio timing.`,

  automations: `AUTOMATIONS: schedule_job(action,...) creates/updates/lists/pauses/resumes/deletes recurring or one-off jobs. schedule_job_detail/history/log_search/outputs/patch/stuck_control inspect and repair scheduled runs. Confirm before mutating existing jobs. Prompts must be self-contained for a fresh future agent.`,

  external_apps: `EXTERNAL APPS: connector_list is core for discovery. Activate external_apps for connected Gmail, GitHub, Slack, Notion, Google Drive, Reddit, HubSpot, Salesforce, Stripe, and GA4 tools. Check connector_list first when connection status matters.`,

  social_intelligence: `SOCIAL INTELLIGENCE: social_intel(platform, handle, mode?) analyzes social profiles and persists structured findings under entities/social. Use for profile metrics, engagement analysis, growth trajectory, and content recommendations.`,

  proposal_admin: `PROPOSAL ADMIN: edit_proposal updates pending proposals before approval. Use only for proposal metadata/details/diff revisions, not for executing source edits directly.`,

  mcp_server_tools: `MCP SERVER TOOLS: dynamic tools from connected MCP servers appear as mcp__serverId__toolName. Use mcp_server_manage(action:"list_tools") or integration_admin first when you need to inspect available MCP tools. Use only trusted connected servers.`,

  creative_mode: `CREATIVE MODE: enter_creative_mode and exit_creative_mode control dedicated creative runtimes. switch_creative_mode remains core and is the preferred router when choosing design/image/video mode.`,

  debug: isPublicDistributionBuild()
    ? `DEBUG: Use workspace files, logs, and visible runtime state to diagnose issues in the public app build.`
    : `DEBUG: read_source(file) for src/ errors, read_webui_source(file) for web-ui/. SELF.md has architecture overview. Read before diagnosing.`,

  agents: `AGENTS: agent_list()→all agents. agent_info(id)→details. spawn_subagent(id, task_prompt, create_if_missing?, run_now?)→run or create a standalone agent. message_subagent(agent_id,message,context?)→send a background message to a standalone non-team subagent and return a task id. delete_agent(id, confirm:true)→remove.
RULES: Always agent_list() first. Never spawn to list/inspect — use agent_list(). spawn_subagent creates/starts standalone one-off agents. message_subagent is for plain agent-to-agent handoff with an existing standalone subagent; its work/results stay in the subagent task panel so main chat can continue.`,

  teams: `TEAMS: ask_team_coordinator(goal, context?) for multi-agent team work. spawn_subagent() for single standalone agent tasks.
WHEN TO USE EACH:
  → spawn_subagent/message_subagent: one standalone non-team agent, one focused task or background handoff
  → ask_team_coordinator: multiple agents needed, parallel workstreams, complex goal that benefits from roles (planner+builder+verifier etc.)
TEAM OPS: Do NOT call team_manage directly from main chat — ask_team_coordinator handles it. reply_to_team(team_id, msg) is the only direct team call — use it when a coordinator is waiting on your reply.`,

  skills: `SKILLS: Before browser/desktop actions, file edits, or multi-step execution, call skill_list() first. If relevant, call skill_read(id) and follow it. For bundled skills, use skill_resource_list(id) and skill_resource_read(id,path) to load references/templates/examples only as needed. Use skill_inspect(id) for normalized metadata/provenance. Use skill_manifest_write(id,manifest), skill_resource_write(id,path,content), skill_resource_delete(id,path), skill_import_bundle(source), skill_export_bundle(id), skill_update_from_source(id), and skill_create_bundle(...) when managing reusable bundle skills. For conversational replies, respond directly. Skill tools are core tools (always available).`,

  agent_builder: `AGENT BUILDER (localhost:3005): search_workflow_templates(query) first → architect_workflow() only if no match → verify_workflow_credentials → deploy_workflow → create_node_subagent if needed.
STOP if credentials missing — tell user exactly what's needed with add_credential_url links. Workflows run inside Agent Builder — use execute_workflow_template(), NOT browser_* tools.`,
};

export const TOOL_TO_MEMORY_CATS: Record<string, string[]> = {
  web: ['web', 'research', 'search'],
  browser: ['browser', 'web'],
  files: ['files', 'coding', 'editing', 'development'],
  task: ['tasks', 'workflow'],
  schedule: ['schedule', 'automation'],
  shell: ['shell', 'commands'],
  memory: ['preferences', 'communication'],
  agents: ['agents', 'workflow', 'automation'],
  integrations: ['integrations', 'automation'],
};

// ─── Category Policies (injected when category is activated) ──────────────────
// Each entry maps a tool category to its usage policy/instructions block.
export const CATEGORY_POLICIES: Record<string, string> = {
  browser_automation: TOOL_BLOCKS.browser,
  browser: TOOL_BLOCKS.browser,
  desktop_automation: TOOL_BLOCKS.desktop,
  desktop: TOOL_BLOCKS.desktop,
  agents_and_teams: `${TOOL_BLOCKS.agents}\n\n${TOOL_BLOCKS.teams}`,
  team_ops: `${TOOL_BLOCKS.agents}\n\n${TOOL_BLOCKS.teams}`,
  automations: TOOL_BLOCKS.automations,
  scheduling: TOOL_BLOCKS.automations,
  workspace_write: TOOL_BLOCKS.files,
  file_ops: TOOL_BLOCKS.files,
  prometheus_source_read: TOOL_BLOCKS.debug,
  ...(isPublicDistributionBuild() ? {} : {
    prometheus_source_write: `${TOOL_BLOCKS.files}`,
    source_write: `${TOOL_BLOCKS.files}`,
  }),
  advanced_memory: TOOL_BLOCKS.memory,
  memory: TOOL_BLOCKS.memory,
  media_assets: TOOL_BLOCKS.media_assets,
  media: TOOL_BLOCKS.media_assets,
  media_quality: TOOL_BLOCKS.media_quality,
  integration_admin: TOOL_BLOCKS.integrations,
  integrations: TOOL_BLOCKS.integrations,
  external_apps: TOOL_BLOCKS.external_apps,
  connectors: TOOL_BLOCKS.external_apps,
  social_intelligence: TOOL_BLOCKS.social_intelligence,
  proposal_admin: TOOL_BLOCKS.proposal_admin,
  mcp_server_tools: TOOL_BLOCKS.mcp_server_tools,
  mcp: TOOL_BLOCKS.mcp_server_tools,
  composite_tools: 'COMPOSITE TOOLS: Activate when the user wants to create, inspect, edit, delete, list, or run saved multi-step composite tools. Composite management tools are not core; request composite_tools first.',
  composites: 'COMPOSITE TOOLS: Activate when the user wants to create, inspect, edit, delete, list, or run saved multi-step composite tools. Composite management tools are not core; request composite_tools first.',
  creative_mode: TOOL_BLOCKS.creative_mode,
};

// ─── buildToolsContext ────────────────────────────────────────────────────────
// Builds the [TOOLS] system prompt block dynamically based on activated categories.
// Base: compact category menu. Expands with policy text as categories are activated.

const BG_AGENT_RUNTIME_HINT = `BACKGROUND AGENTS: background_spawn(task_prompt, id?) runs a parallel agent. Prefer spawning when work is independent and can run concurrently, especially for sidecar tasks (memory updates, repo scans, web lookups, data gathering) while you continue the primary flow. task_prompt must be fully self-contained (no references to "the conversation"). The finalization gate waits for and merges same-turn background_spawn results before the final reply. Use background_wait(wait_ms:30000) when you intentionally want to pause this foreground turn while active background agents work before continuing. Don't call background_join/status unless explicitly needed. Background agents use bg_plan_declare/bg_plan_advance for their own planning.`;

export function buildToolsContext(activatedCategories: Set<string>): string {
  // Build dynamic search provider summary inline (getConfig already imported at top of file)
  let searchProviders = 'DuckDuckGo (fallback)';
  try {
    const cfg = getConfig();
    const data = (cfg.getConfig() as any);
    const s = data.search || {};
    const preferred = String(s.preferred_provider || 'ddg').toLowerCase();
    const tavilyKey = cfg.resolveSecret(s.tavily_api_key);
    const googleKey = cfg.resolveSecret(s.google_api_key);
    const googleCx = cfg.resolveSecret(s.google_cx);
    const braveKey = cfg.resolveSecret(s.brave_api_key);
    const ps: string[] = [];
    if (tavilyKey) ps.push(preferred === 'tavily' ? 'Tavily (primary)' : 'Tavily');
    if (googleKey && googleCx) ps.push(preferred === 'google' ? 'Google (primary)' : 'Google');
    if (braveKey)  ps.push(preferred === 'brave'  ? 'Brave (primary)'  : 'Brave');
    ps.push(preferred === 'ddg' ? 'DuckDuckGo (primary)' : 'DuckDuckGo (fallback)');
    searchProviders = ps.join(', ');
  } catch { /* use default */ }

  const runtimeCategoryDefs: Array<[string, string]> = [
    ['browser_automation', 'browser_automation (web UI control, forms, DOM/screenshot, shortcuts)'],
    ['desktop_automation', 'desktop_automation (OS windows, apps, clipboard, screenshots, mouse/keyboard)'],
    ['agents_and_teams', 'agents_and_teams (standalone subagents, managed teams, team chat, dispatches)'],
    ['workspace_write', 'workspace_write (workspace file mutations: find_replace/replace_lines/write_file/create_file)'],
    ['prometheus_source_read', 'prometheus_source_read (inspect Prometheus src/, web-ui/, and allowlisted root files)'],
    ['prometheus_source_write', 'prometheus_source_write (edit Prometheus app/source files for approved dev tasks)'],
    ['advanced_memory', 'advanced_memory (memory graph, timeline, related records, project search, index refresh)'],
    ['media_assets', 'media_assets (download/analyze images, video, audio, remote assets)'],
    ['media_quality', 'media_quality (layout/video QA: contrast, overflow, frame renders, caption/audio timing)'],
    ['automations', 'automations (schedule_job plus schedule detail/history/outputs/patch/stuck control)'],
    ['integration_admin', 'integration_admin (MCP server setup, webhooks, integration quick setup)'],
    ['external_apps', 'external_apps (Gmail, GitHub, Slack, Notion, Drive, Reddit, HubSpot, Salesforce, Stripe, GA4)'],
    ['connectors', 'connectors (34 tools: Gmail, GitHub, Slack, Notion, Drive, Reddit, HubSpot, Salesforce, Stripe, GA4 — use connector_list to see what\'s connected)'],
    ['social_intelligence', 'social_intelligence (social profile analysis and recommendations)'],
    ['proposal_admin', 'proposal_admin (edit pending proposals before approval)'],
    ['mcp_server_tools', 'mcp_server_tools (dynamic mcp__server__tool functions from connected servers)'],
    ['composite_tools', 'composite_tools (saved multi-step tools and composite management)'],
    ['creative_mode', 'creative_mode (enter/exit dedicated creative runtimes)'],
  ];
  const allowedCategoryIds: Set<string> = new Set(getPublicBuildAllowedCategories([
    'browser_automation',
    'desktop_automation',
    'agents_and_teams',
    'workspace_write',
    'prometheus_source_read',
    'prometheus_source_write',
    'advanced_memory',
    'media_assets',
    'media_quality',
    'automations',
    'external_apps',
    'integration_admin',
    'social_intelligence',
    'proposal_admin',
    'mcp_server_tools',
    'composite_tools',
    'creative_mode',
  ] as const));
  const categoryMenu = runtimeCategoryDefs
    .filter(([id]) => allowedCategoryIds.has(id))
    .map(([, label]) => label)
    .join(' | ');

  const menu = `[TOOLS] Core tools loaded (file read/search, web, basic memory, shell, skill tools including skill_list/skill_read/skill_resource_*/skill_inspect/skill_manifest_write/skill_import_bundle/skill_create_bundle, tasks, switch_model, update_heartbeat, write_proposal, ask_team_coordinator). Activate additional categories as needed:
  ${categoryMenu}
  Preferred category IDs are the names in the menu above; legacy IDs like browser, file_ops, team_ops, connectors, and mcp still work as aliases.
  Use: request_tool_category({"category":"browser"}) — stays active for the whole session. Full reference: read_file('TOOLS.md')

[FILE EDIT ROUTING] For workspace edits, activate/use file_ops and follow: file_stats/read_file or grep_file first, then find_replace/replace_lines/insert_after/delete_lines/write_file/create_file. Do not use run_command, Python, PowerShell, sed, or node scripts as the default file editor.

[SEARCH] Providers: ${searchProviders}.
WHEN: freshness (today/latest/current/price), high-stakes facts, named entity lookup, uncertainty ("not sure if…"). Skip for timeless well-known facts.
HOW: complex topics → call web_search 2–3× with different angles (not the same query twice). Scan snippets → web_fetch the 1–3 most relevant URLs. Add site:domain.com to target a source.
FETCH STRATEGY: web_fetch for static articles/docs (fast). browser_get_page_text for JS-heavy/login-gated pages (slower, use when web_fetch returns empty/broken).
ITERATE: if first search misses, rephrase the query or try a broader/narrower angle before giving up.
web_search runs all configured API providers in parallel by default (pass multi_engine:false to use single-provider fallback chain).

[WRITE NOTE] write_note(content, tag?) is always available — use it to preserve context between sessions.
WHEN TO WRITE: something was discussed, decided, or discovered that future sessions should know about; a file/task/plan step completed; data gathered from browser/desktop/API mid-task.
SKIP: casual chat, greetings, simple Q&A, turns where nothing actionable happened.
SPEED RULE: if write_note is the only action in your turn, call switch_model('low') first — it reverts automatically after.
DURING PLANS/TASKS: write a note at each meaningful step — capturing gathered data, intermediate results, or blockers keeps context recoverable if the task is interrupted.

[MEMORY CONTINUITY] Memory search is Prometheus' long-term recall. Use memory_search before answering from memory when the user asks about previous discussions, decisions, recurring preferences, project history, older tasks, "what did we decide", "what happened before", or any answer that depends on continuity. Use memory_read_record for important hits and memory_get_related to expand useful context. Use memory_search_timeline when chronology matters.

[BUSINESS CONTEXT] BUSINESS.md is available but not auto-injected by default. Use business_context_mode({"action":"enable"}) when ongoing work needs persistent business/company context across this session. Use "status" to check the mode and "disable" to turn it back off. Enabling returns the current BUSINESS.md snapshot immediately so you can use it in the same turn.

[TEAMS & AGENTS] Two delegation paths — pick the right one:
  → spawn_subagent('id', task, ...) — create/run one standalone non-team agent. message_subagent(id,message) — send a background message to an existing standalone agent; returns task_id and keeps the conversation/result in the subagent task panel. Requires team_ops category.
  → ask_team_coordinator(goal) — always available (core). Multi-agent teams with roles. Use when: parallel workstreams, multiple specializations needed, or task is too large for one agent context.
Do NOT call team_manage directly. reply_to_team(team_id, msg) is the only direct team call — use only when a coordinator is waiting on your reply.

[MODEL ROUTING] Default: primary model (powerful, for complex work). Call switch_model(tier, reason) EARLY when the task is clearly lighter.
  → 'low' (speed): single command, file read/summary, write_note only, quick lookups.
  → 'medium' (careful): multi-step analysis or structured work that doesn't need full primary model power.
  → Stay on primary: ${isPublicDistributionBuild() ? 'proposal work, deep reasoning, auth/security/build, anything expensive if wrong.' : 'src/ edits, proposals, deep reasoning, auth/security/build, anything expensive if wrong.'}
  → Mixed intent rule: if a turn contains BOTH memory work (memory_write/write_note) and a separate actionable task, prefer background_spawn for the memory sidecar so primary execution continues in parallel.
  → If you choose not to spawn and you used switch_model for a memory side action, continue executing the user's remaining task in the same turn (do not stop after memory).
  Auto-reverts after turn end — never switch back manually.

${BG_AGENT_RUNTIME_HINT}`;

  if (activatedCategories.size === 0) return menu;

  const activePolicies: string[] = [];
  for (const cat of activatedCategories) {
    if (CATEGORY_POLICIES[cat]) activePolicies.push(CATEGORY_POLICIES[cat]);
  }

  if (activePolicies.length === 0) return menu;
  return menu + '\n\n' + activePolicies.join('\n\n');
}

// ─── buildPersonalityContext ──────────────────────────────────────────────────────
// Takes skillsManager and getSessionSkillWindowsFn as dependencies to avoid
// circular imports with server-v2.
export async function buildPersonalityContext(
  sessionId: string,
  workspacePath: string,
  messageText: string,
  executionMode: string,
  historyLength: number,
  skillsManager: SkillsManager,
  getSessionSkillWindowsFn: (sessionId: string) => Map<string, SkillWindow>,
  setCurrentTurn: (sessionId: string, turn: number) => void,
  extraCats?: Set<string>,
  options?: BuildPersonalityContextOptions,
): Promise<string> {
  const profile = options?.profile || 'default';

  if (profile === 'creative_design' || profile === 'creative_image' || profile === 'creative_canvas' || profile === 'creative_video') {
    const creativeModeLabel = profile === 'creative_design'
      ? 'Prometheus Design'
      : profile === 'creative_image' || profile === 'creative_canvas'
        ? 'Prometheus Image'
        : 'Prometheus Video';
    const creativeDoc = loadCreativeRuntimeGuide(profile);
    const user = loadFullMemoryProfile(workspacePath, 'USER.md', 3000);
    const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md', 4000);
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    const skillCount = skillsManager.getAll().length;
    const creativeSkillHint = skillCount > 0
      ? `[SKILLS]\n${skillCount} reusable skill playbook${skillCount !== 1 ? 's are' : ' is'} available. Skill tools are core in Creative Mode with main-chat parity: every skill_* tool exposed by the runtime is allowed here. Use skill_list and skill_read when you need more creative instructions, references, patterns, or ideas. For bundled skills, use skill_resource_list and skill_resource_read to load only the specific resources you need, including templates, examples, docs, schemas, prompts, data, and references. Use skill_inspect when routing/metadata matters. When creating or maintaining reusable creative skills/bundles, use the bundle/resource/manifest/import/export/update/create skill tools as appropriate.`
      : '';
    let projectContextBlock = '';
    try {
      const { buildProjectContextBlock, findProjectBySessionId } = await import('./projects/project-store.js');
      if (findProjectBySessionId(sessionId)) {
        projectContextBlock = buildProjectContextBlock(sessionId) || '';
      }
    } catch {}
    const parts = [
      `[CREATIVE_MODE]\nActive mode: ${creativeModeLabel}\nStay in this specialized mode across turns until the user explicitly exits it or you intentionally call exit_creative_mode because the specialized workflow is clearly finished. Do not exit just because one edit, render, or export completed.\nCanvas is the primary workspace in this mode.\nOnly exit by calling exit_creative_mode when you are confident the user no longer needs this mode.`,
      creativeDoc ? `[CREATIVE_RUNTIME_GUIDE]\n${creativeDoc}` : '',
      user ? `[USER]\n${user}` : '',
      soul ? `[SOUL]\n${soul}` : '',
      business ? `[BUSINESS]\n${business}` : '',
      projectContextBlock ? `[PROJECT_CONTEXT]\n${projectContextBlock}` : '',
      creativeSkillHint,
    ].filter(Boolean);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
  }

  // ── Path LOCAL_LLM: tiny prompt for small local model primaries ───────────────
  // Activated only when isLocalPrimary() is true in chat.router.ts.
  // Returns a minimal personality context — time + condensed USER.md +
  // delegation instructions. No SOUL.md, no intraday notes, no tool blocks.
  // All existing paths below are completely untouched.
  if (profile === 'local_llm') {
    const { buildLocalModelPersonalityCtx, loadCondensedMemoryProfile, formatLocalModelTime } =
      await import('../config/local-model-prompts.js');
    const timeString  = formatLocalModelTime();
    const userMemory  = loadCondensedMemoryProfile(workspacePath);
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath, 900) : '';
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return buildLocalModelPersonalityCtx(timeString, userMemory) + (business ? `\n\n[BUSINESS]\n${business}` : '');
  }

  if (profile === 'teach_mode') {
    const user = loadFullMemoryProfile(workspacePath, 'USER.md', 2600);
    const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md', 3200);
    const activatedCatsTeach = getActivatedToolCategories(sessionId);
    activatedCatsTeach.add('browser');
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsTeach.add('browser');
        else activatedCatsTeach.add(ec);
      }
    }
    const parts = [
      user ? `[USER]\n${user}` : '',
      soul ? `[SOUL]\n${soul}` : '',
      buildToolsContext(activatedCatsTeach),
    ].filter(Boolean);
    const skillCtxTeach = skillsManager.buildTurnContext(messageText);
    if (skillCtxTeach) parts.push(skillCtxTeach);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
  }

  const allowLongTermSearch = executionMode === 'interactive' || executionMode === 'background_agent';
  const memorySearchRouting = allowLongTermSearch
    ? routeMemorySearchMode(messageText)
    : ({ mode: 'no_search', reason: 'execution_mode_skip' } as MemorySearchRouting);
  const retrievedMemoryCtx = allowLongTermSearch
    ? buildRetrievedMemoryContext(workspacePath, messageText, memorySearchRouting)
    : '';

  if (profile === 'switch_model') {
    const user = loadFullMemoryProfile(workspacePath, 'USER.md');
    const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md');
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    const memory = loadFullMemoryProfile(workspacePath, 'MEMORY.md', 8000);
    const activatedCatsSwitch = getActivatedToolCategories(sessionId);
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsSwitch.add('browser');
        else activatedCatsSwitch.add(ec);
      }
    }
    const parts = [
      user ? `[USER]\n${user}` : '',
      soul ? `[SOUL]\n${soul}` : '',
      business ? `[BUSINESS]\n${business}` : '',
      memory ? `[MEMORY]\n${memory}` : '',
      retrievedMemoryCtx,
      buildToolsContext(activatedCatsSwitch),
    ].filter(Boolean);
    const skillCtx = skillsManager.buildTurnContext(messageText);
    if (skillCtx) parts.push(skillCtx);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
  }
  // ── Path T: team subagents — lean prompt, team memory only ─────────────────
  if (executionMode === 'team_subagent') {
    const activatedCatsTeam = getActivatedToolCategories(sessionId);
    const mainWorkspacePath = getConfig().getWorkspacePath();
    const fallbackMemoryRoots = mainWorkspacePath && path.resolve(mainWorkspacePath) !== path.resolve(workspacePath)
      ? [mainWorkspacePath]
      : [];
    const user = loadFullMemoryProfile(workspacePath, 'USER.md', 3000, fallbackMemoryRoots);
    const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md', 4000, fallbackMemoryRoots);
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    // Keep MEMORY.md lighter than the normal autonomous path so team dispatches stay focused.
    const memory = loadFullMemoryProfile(workspacePath, 'MEMORY.md', 5000, fallbackMemoryRoots);
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsTeam.add('browser');
        else activatedCatsTeam.add(ec);
      }
    }
    const parts = [
      user ? `[USER]\n${user}` : '',
      soul ? `[SOUL]\n${soul}` : '',
      memory ? `[MEMORY]\n${memory}` : '',
      business ? `[BUSINESS]\n${business}` : '',
      buildToolsContext(activatedCatsTeam),
    ].filter(Boolean);
    const skillCtx = skillsManager.buildTurnContext(messageText);
    if (skillCtx) parts.push(skillCtx);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
  }

  // ── Path B: autonomous execution — full prompt, no changes ─────────────────
  const isAutonomous = executionMode === 'background_task' || executionMode === 'proposal_execution' || executionMode === 'cron' || executionMode === 'heartbeat';
  if (isAutonomous) {
    const isProposalExecution = executionMode === 'proposal_execution';
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    const soul = isProposalExecution ? '' : loadFullMemoryProfile(workspacePath, 'SOUL.md');
    const memory = isProposalExecution ? '' : loadFullMemoryProfile(workspacePath, 'MEMORY.md', 8000);
    // USER.md intentionally excluded from background tasks — user preferences are
    // not relevant to focused task execution and waste token budget.
    // AGENTS.md intentionally excluded from autonomous path — background tasks,
    // cron, and heartbeat sessions don't need agent workspace context.
    // Projects: inject context ONLY when session belongs to a project
    let projectContextBlock = '';
    try {
      const { buildProjectContextBlock, findProjectBySessionId } = await import('./projects/project-store.js');
      if (findProjectBySessionId(sessionId)) {
        projectContextBlock = buildProjectContextBlock(sessionId) || '';
      }
    } catch {}
    // Skip intraday notes for ALL autonomous sessions — background_task, cron, heartbeat,
    // and proposal executor sessions all have their own goal context and don't need daily notes.
    const skipIntraday = true;
    const today = new Date().toISOString().split('T')[0];
    const intradayPath = path.join(workspacePath, 'memory', `${today}-intraday-notes.md`);
    const intradayNotes = (!skipIntraday && fs.existsSync(intradayPath)) ? processIntradayNotes(fs.readFileSync(intradayPath, 'utf-8')) : '';
    // Fix 2: Don't inherit interactive session categories for cron/heartbeat runs.
    // task_* sessions manage their own categories explicitly (e.g. source_write for proposals).
    // Cron sessions (including sessionTarget:'main') start clean to avoid leaking 8+ interactive cats.
    const activatedCatsAuto = sessionId.startsWith('task_')
      ? getActivatedToolCategories(sessionId)
      : new Set<string>();
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsAuto.add('browser');
        else activatedCatsAuto.add(ec);
      }
    }
    const toolsBlockAuto = buildToolsContext(activatedCatsAuto);
    const parts = [
      business ? `[BUSINESS]\n${business}` : '',
      soul ? `[SOUL]\n${soul}` : '',
      memory ? `[MEMORY]\n${memory}` : '',
      projectContextBlock ? `[PROJECT_CONTEXT]\n${projectContextBlock}` : '',
      toolsBlockAuto,
      intradayNotes ? `[TODAY_NOTES]\n${intradayNotes}` : '',
    ].filter(Boolean);
    // Autonomous agents: same hint + pinned skills as interactive chat.
    const skillCtx = skillsManager.buildTurnContext(messageText);
    if (skillCtx) parts.push(skillCtx);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
  }

  // ── Path A: interactive chat — tiered ─────────────────────────────────────
  const user = loadFullMemoryProfile(workspacePath, 'USER.md');
  const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
  const memory = loadFullMemoryProfile(workspacePath, 'MEMORY.md', 8000);
  const today = new Date().toISOString().split('T')[0];
  const intradayPath = path.join(workspacePath, 'memory', `${today}-intraday-notes.md`);
  const _skipIntradayInteractive = sessionId.startsWith('proposal_') || executionMode === 'background_agent';
  const intradayNotes = (!_skipIntradayInteractive && fs.existsSync(intradayPath)) ? processIntradayNotes(fs.readFileSync(intradayPath, 'utf-8')) : '';

  // ── Tier 1: first message in session ──────────────────────────────────────
  if (historyLength === 0) {
    // Projects: inject context ONLY when session belongs to a project
    let projectContextBlockT1 = '';
    try {
      const { buildProjectContextBlock, findProjectBySessionId } = await import('./projects/project-store.js');
      if (findProjectBySessionId(sessionId)) {
        projectContextBlockT1 = buildProjectContextBlock(sessionId) || '';
      }
    } catch {}
    const soulT1 = loadFullMemoryProfile(workspacePath, 'SOUL.md');
    // Include tool category menu (auto-activation may have already run; show active state)
    const activatedCatsT1 = getActivatedToolCategories(sessionId);
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsT1.add('browser');
        else activatedCatsT1.add(ec);
      }
    }
    const parts = [
      user ? `[USER]\n${user}` : '',
      soulT1 ? `[SOUL]\n${soulT1}` : '',
      business ? `[BUSINESS]\n${business}` : '',
      memory ? `[MEMORY]\n${memory}` : '',
      retrievedMemoryCtx,
      projectContextBlockT1 ? `[PROJECT_CONTEXT]\n${projectContextBlockT1}` : '',
      intradayNotes ? `[TODAY_NOTES — read-only context, do NOT call write_note unless you complete something meaningful this turn]\n${intradayNotes}` : '',
      buildToolsContext(activatedCatsT1),
    ].filter(Boolean);
    // First turn: still get the skills hint + any pinned skills.
    const skillCtxT1 = skillsManager.buildTurnContext(messageText);
    if (skillCtxT1) parts.push(skillCtxT1);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
  }

  // ── Tier 2 / 3: subsequent messages ───────────────────────────────────────
  setCurrentTurn(sessionId, historyLength);

  // Projects: inject context ONLY when session belongs to a project
  let projectContextBlockT2 = '';
  try {
    const { buildProjectContextBlock, findProjectBySessionId } = await import('./projects/project-store.js');
    if (findProjectBySessionId(sessionId)) {
      projectContextBlockT2 = buildProjectContextBlock(sessionId) || '';
    }
  } catch {}

  const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md');

  // Build dynamic [TOOLS] block from session's activated categories
  const activatedCats = getActivatedToolCategories(sessionId);
  if (extraCats) {
    for (const ec of extraCats) {
      if (ec === 'browser_vision' || ec === 'browser') activatedCats.add('browser');
      else activatedCats.add(ec);
    }
  }
  const toolsBlock = buildToolsContext(activatedCats);

  // Reference hints — Prom reads these files when actually needed rather than
  // injecting partial snippets based on keyword guesses.
  const referenceHint = isPublicDistributionBuild()
    ? `[REFERENCE_FILES] Agent workspace context: read_file('AGENTS.md').`
    : `[REFERENCE_FILES] Architecture/debug context: read_source('SELF.md') or read_prom_file('SELF.md'). Agent workspace context: read_source('AGENTS.md') or read_prom_file('AGENTS.md').`;

  const parts = [
    user ? `[USER]\n${user}` : '',
    soul ? `[SOUL]\n${soul}` : '',
    business ? `[BUSINESS]\n${business}` : '',
    memory ? `[MEMORY]\n${memory}` : '',
    retrievedMemoryCtx,
    projectContextBlockT2 ? `[PROJECT_CONTEXT]\n${projectContextBlockT2}` : '',
    intradayNotes ? `[TODAY_NOTES — read-only context, do NOT call write_note unless you complete something meaningful this turn]\n${intradayNotes}` : '',
    toolsBlock,
    referenceHint,
  ].filter(Boolean);

  // Skills: one-liner hint + any pinned skills injected in full.
  const skillCtx = skillsManager.buildTurnContext(messageText);
  if (skillCtx) parts.push(skillCtx);

  await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
  return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
}
