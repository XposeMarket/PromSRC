// src/gateway/prompt-context.ts
// Full prompt context assembly — workspace memory, personality, tool hints, skill windows.
// Extracted from server-v2.ts (Step 12 of Phase 3 refactor).

import path from 'path';
import fs from 'fs';
import { hookBus } from './hooks';
import { SkillsManager } from './skills-runtime/skills-manager';
import { getConfig } from '../config/config';
import { getActivatedSkillIds, getActivatedSkillResources, getActivatedToolCategories, isBusinessContextEnabled } from './session';
import { searchMemoryIndex } from './memory-index/index';
import { getPublicBuildAllowedCategories, isPublicDistributionBuild } from '../runtime/distribution.js';
import { buildCisContextBlock } from './business/cis-context-builder';
import { loadSoul } from '../config/soul-loader';
import { PROMPT_CACHE_MARKER } from '../providers/LLMProvider';

// ─── Prompt-cache assembly ─────────────────────────────────────────────────────
// Splits the system prompt into a STABLE (cacheable) prefix and a VOLATILE
// (per-turn) tail, joined by PROMPT_CACHE_MARKER. The content is identical to the
// old flat ordering — only volatile fragments (today's notes, retrieved memory,
// CIS/skill turn context) are moved AFTER the stable bulk so providers can cache
// the prefix. Adapters consume/strip the marker; it never reaches a model.
function assembleContext(
  stableParts: Array<string | undefined | null | false>,
  volatileParts: Array<string | undefined | null | false>,
): string {
  const stable = stableParts.filter(Boolean) as string[];
  const volatile = volatileParts.filter(Boolean) as string[];
  const stableStr = stable.join('\n\n');
  const volatileStr = volatile.join('\n\n');
  if (!stableStr && !volatileStr) return '';
  if (!stableStr) return '\n\n' + volatileStr;
  if (!volatileStr) return '\n\n' + stableStr;
  return '\n\n' + stableStr + PROMPT_CACHE_MARKER + volatileStr;
}

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
  profile?: 'default' | 'switch_model' | 'local_llm' | 'teach_mode' | 'voice_agent';
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

export function loadVoiceAgentMemory(workspacePath: string, maxChars: number = 5000): string {
  const candidates = ['VOICEAGENT.md', 'voiceagent.md'];
  for (const filename of candidates) {
    const content = loadWorkspaceFile(workspacePath, filename, maxChars);
    if (content) return content;
  }
  return '';
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
      ...result.hits.map((h) => {
        const citation = h.citation
          ? ` | citation=${h.citation.sourcePath}${h.citation.sourceStartLine ? `:${h.citation.sourceStartLine}` : ''} | authority=${h.citation.authority} | status=${h.citation.status}`
          : ` | source=${h.sourceType} | path=${h.sourcePath}`;
        return `- score=${h.score} | layer=${h.layer || 'evidence'} | record=${h.recordId}${citation} | ${h.preview}`;
      }),
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
  web: `WEB: shopping_search_products(query,merchant?,max_results?,provider?,include_metadata?)→fast normalized product cards and product carousel using existing web search/fetch only, no shopping API key. web_search_multi(query,max_results?)→all configured providers, including xAI X Search when connected. web_search_single(query,provider?,max_results?)→one provider (default Settings preferred; provider=tinyfish|tavily|google|brave|ddg|xai). web_search(query,max_results?,multi_engine?,provider?)→legacy combined tool. web_fetch(url)→full page text. Search first, then fetch.
Product/shopping rule: for product carousels, shopping comparisons, prices, ratings, or store-specific product lists, call shopping_search_products first. Use browser/page extraction only when this result is incomplete or needs visual/login verification.
Strategy: for complex topics call web_search 2–3× with different query angles; scan snippets; web_fetch the 1–3 most relevant URLs.
Use web_search_single with provider:"tavily" to test Tavily-only; use web_search_single with provider:"google" to test Google-only; use provider:"xai" for X-backed social search. Use web_search_multi for broad coverage.
Site search: web_search("site:reddit.com keyword"). Fallback: web_fetch a direct URL (reuters.com, apnews.com, bbc.com).
Fetch routing: web_fetch for static pages; browser_get_page_text for JS-heavy or login-gated pages.`,

  browser: `BROWSER: browser_doctor() diagnoses browser automation health. browser_open(url) defaults to observe="screenshot" after navigation and uses the Prometheus browser profile by default. Use target="user_chrome" only when the user explicitly asks for their Chrome profile in main chat; background agents, tasks, and subagents keep their own isolated Prometheus profiles and CDP ports. browser_snapshot() refreshes DOM refs. browser_vision_screenshot() captures viewport image. browser_click(@ref|element), browser_fill(@ref|element,text), browser_drag(from_ref|coords->to_ref|coords), browser_upload_file(ref?|selector,file_path|file_paths), browser_press_key(key), browser_type(text), browser_wait(ms), browser_click_and_download(@ref), browser_get_page_text(element?). download_url(url,filename?). download_media(url,audio_only?). generate_image(prompt, aspect_ratio?, provider?, model?). generate_video(prompt, image?, video?, mode?, duration?, resolution?). browser_close().
OBSERVE MODES: observe="none" tiny ack and lowest latency; "compact" small URL/title/focus/DOM-count summary; "delta" changed DOM refs after the action; "snapshot" full fresh DOM refs in the result; "screenshot" fresh visual observation. Defaults: browser_open/browser_upload_file/browser_vision_click/browser_run_js screenshot; browser_click/browser_fill/browser_drag/browser_click_and_download/browser_scroll_collect/browser_vision_type delta; browser_type/browser_snapshot snapshot; browser_wait/browser_scroll/browser_press_key/browser_get_page_text/browser_get_focused_item/browser_send_to_telegram none. Use capture_after=true on click/fill/type/scroll/drag as shorthand for observe="snapshot" when you need fresh refs immediately.
RULES: visual-first workflow. Vision screenshots are highest-confidence on dynamic/SPA UIs. If DOM refs or JS-derived assumptions are uncertain, stale, or contradictory, take a fresh browser_vision_screenshot and trust that evidence first. After browser actions, rely on the default observation unless state likely changed in a way you must inspect; override with observe="none" on cheap deterministic actions when speed matters, observe="snapshot" for new refs, or observe="screenshot" for visual confirmation. Treat browser_run_js as fallback for cases where snapshot/vision still cannot identify the target. For high-impact final submits/posts/sends/purchases/deletes, prepare the browser UI, call request_final_action_approval, then pass final_action_approval_id to the exact final browser_click/browser_press_key. The approved final browser action returns post-action visual evidence automatically; inspect it, verify that the approved action actually succeeded, and only then report completion or explain the visible uncertainty/failure. Composer fills show "COMPOSER SUBMIT BUTTON: @N" — click it immediately unless it is a high-impact final action requiring request_final_action_approval first. j/k nav: call browser_get_focused_item only when focus is unclear or you need to confirm position after navigation. Use ⌨️ SITE SHORTCUTS when shown; save new ones with save_site_shortcut().
MEDIA SELECTION: when choosing an image/video on X, Google Images, or similar pages, first enumerate candidates via browser_snapshot/browser_extract_structured using nearby text, alt text, username, timestamp, href, or src. Rank candidates by text match to the request, then take browser_vision_screenshot to visually confirm the intended item before downloading. Prefer download_url for direct asset URLs and browser_click_and_download for browser-triggered downloads.`,

  desktop: `DESKTOP: desktop_doctor() diagnoses tool health. desktop_get_monitors()→monitor indices+bounds. desktop_screenshot()→screen+monitors+screenshot_id (capture=all|primary|monitor_index=N; mode="som" overlays numbered UI elements). desktop_window_screenshot(name|handle|active, mode?)→single app window crop+screenshot_id. desktop_click(x,y, coordinate_space?, screenshot_id?, verify?) or desktop_click(element:N, screenshot_id) is an actual mouse click; use element only from a SOM screenshot. If the target point is not known yet, take a screenshot first, then click with coordinates from that image or a SOM element. desktop_scroll/drag use the same targeting model and optional verification. desktop_type/press_key. Clipboard get/set. desktop_list_installed_apps(filter?) and desktop_find_installed_app(query) return stable app_id values; prefer desktop_launch_app(app_id=...) over guessing raw app names. Screenshot/get_monitors first; prefer coordinate_space="capture" with screenshot_id when clicking from screenshot pixels, or coordinate_space="window" for app-local coords. capture_after=true can return a post-action screenshot. Leave verify on auto unless speed matters. Focus before click/type. Routine desktop interaction is approval-free; for high-impact final submits/posts/sends/purchases/deletes, prepare the UI, call request_final_action_approval, then pass final_action_approval_id to the exact final desktop_click/desktop_press_key. The approved final desktop action returns a post-action capture automatically; inspect it, verify that the approved action actually succeeded, and only then report completion or explain the visible uncertainty/failure. Non-interrupting background desktop work requires an isolated worker target: use desktop_background_status, desktop_background_prepare_sandbox, then desktop_background_command instead of host desktop clicks/keys.`,

  files: isPublicDistributionBuild()
    ? `FILES: file_stats(path)→line count+size+modified (check this first on unknown files). read_file(path, start_line?, num_lines?)→windowed contents+line nums (e.g. start_line:200,num_lines:100 reads lines 200–300). grep_file(path, pattern, context_lines?)→matching lines in one file. search_files(directory?, pattern, file_glob?)→multi-file matches across workspace. find_replace/replace_lines/insert_after/delete_lines→edit. create_file/delete_file/mkdir/list_directory.
MANDATORY EDIT ROUTE: For workspace file edits, native file tools are the default and expected path: file_stats/read_file or grep_file first, then find_replace/replace_lines/insert_after/delete_lines/write_file/create_file. Do not use run_command, Python, PowerShell, sed, or node scripts to edit files unless the user explicitly asks for shell editing or the native tools cannot perform the transformation.
WORKSPACE ONLY: In the public app, file tools operate on the user workspace and generated app data only. Always read before editing.`
    : `FILES: file_stats(path)→line count+size+modified (check this first on unknown files). read_file(path, start_line?, num_lines?)→windowed contents+line nums (e.g. start_line:200,num_lines:100 reads lines 200–300). grep_file(path, pattern, context_lines?)→matching lines in one file. search_files(directory?, pattern, file_glob?)→multi-file matches across workspace. find_replace/replace_lines/insert_after/delete_lines→edit. create_file/delete_file/mkdir/list_directory.
	SOURCE CODE REFERENCE FILES: self/index.md is the canonical Prometheus architecture/debug map. Read it with read_file('self/index.md'), not read_source. Use the split self/* files it points to when you only need one subsystem.
	SRC SURFACES (read-only by default): source_stats|src_stats(file), read_source(file,start_line?,num_lines?), list_source(directory?), and grep_source(pattern, directory?, file_glob?) inspect src/. WEB-UI SURFACES (read-only by default): webui_source_stats|webui_stats(file), read_webui_source(file,start_line?,num_lines?), list_webui_source(directory?), and grep_webui_source(pattern, directory?, file_glob?) inspect web-ui/. PROM-ROOT SURFACE (dev/proposal only): list_prom, prom_file_stats, read_prom_file, and grep_prom inspect allowlisted Prometheus project-root files/directories such as scripts/, electron/, build/, dist/, src/, web-ui/, and .prometheus/.
	Write (approved dev source sessions only): use request_dev_source_edit for fast user approval in the current dev chat, or write_proposal execution_mode="code_change" for the full proposal lane. request_dev_source_edit must include a grounded plan: user_request, reasoning, evidence with file/line findings, current_state, fix, steps, expected_workflow, verification, and completion_note_tag (default dev_edit_complete). expected_workflow should explain exactly what happens after approval and after edits apply live: scoped tool unlock, verification/preflight, restart/reload/checkpoint behavior, completion note, and final response shape. After approval, follow that declared plan and prefer read_dev_sources plus apply_dev_source_patchset for file tasks; use tiny source tools only for one-off emergency edits. Approved fallback write tools remain: src/: find_replace_source, replace_lines_source, insert_after_source, delete_lines_source, write_source, delete_source; web-ui/: find_replace_webui_source, replace_lines_webui_source, insert_after_webui_source, delete_lines_webui_source, write_webui_source, delete_webui_source; allowlisted prom-root proposal scope only: find_replace_prom, replace_lines_prom, insert_after_prom, delete_lines_prom, write_prom_file, delete_prom_file. Prometheus Mobile is part of the web UI source tree: edit mobile app source under web-ui/src/mobile/*, never hand-edit generated/public-web-ui/static/mobile/* except for emergency verification, and finalize quick live mobile edits with prom_apply_dev_changes changed_surfaces:["mobile"]. For quick live dev edits, finalize with prom_apply_dev_changes rather than raw npm run build; use mode="verify_only" for a no-restart preflight or mode="apply_live" to sync/build/restart/reload. After apply_live/restart/reload succeeds, call write_note with the approved completion_note_tag and dev_edit_id so the dev-edit plan can close before the final user summary. Proposal/code_exec lanes are isolated sandboxes: verify them with the canonical run_command build inside the sandbox, and do not call prom_apply_dev_changes there.
	MANDATORY EDIT ROUTE: For workspace file edits, native file tools are the default and expected path: file_stats/read_file or grep_file first, then find_replace/replace_lines/insert_after/delete_lines/write_file/create_file. Do not use run_command, Python, PowerShell, sed, or node scripts to edit files unless the user explicitly asks for shell editing or the native tools cannot perform the transformation.
	EDIT PRIORITY: Always inspect before editing. For source-controlled Prometheus code, prefer batch tools first: read_dev_sources for multi-file inspection, then apply_dev_source_patchset for approved edits. Use tiny source tools only for one-off emergency edits. For normal workspace files, prefer read_files_batch for multi-file inspection, then apply_patchset for grouped edits; use file_stats/search_files/grep_file/read_file and find_replace/replace_lines/insert_after/delete_lines/write_file/create_file/delete_file only when a narrow one-off tool is faster or safer.`,

  task: `TASK: task_control(action,...) — list/get/resume/rerun/pause/delete. task_control(list) returns active tasks AND cron jobs in one call. Do NOT use read_file for task state.`,

  schedule: `SCHEDULE: schedule_job(action,...) — list/create/update/pause/resume/delete/run_now. Confirm before mutating.
Use team_id to schedule a managed team run: the team manager wakes first, derives the run from team goal/memory, and dispatches members. Otherwise scheduled jobs are owned by schedule-owner subagents by default. If subagent_id is omitted, one is created/assigned automatically; do not claim a schedule is assigned to the raw main session.
instruction_prompt must be FULLY SELF-CONTAINED — write as if briefing a fresh agent with zero context. Include: target URL/account, exact step-by-step actions, constraints, success criteria. Labels like "Post to X daily" are invalid — give the agent nothing to act on.`,

  browser_vision: `VISION MODE: Few DOM elements — canvas/WebGL/SPA. browser_vision_screenshot()→viewport PNG. browser_vision_click(x,y)→pixel coords from image. browser_vision_type(x,y,text)→focus+type. Vision screenshot is the primary source of truth in this mode. Workflow: screenshot → pick coords → click/type. Switch back to browser_click(@ref) when element count exceeds 10.`,

  shell: `SHELL/RUN COMMANDS: activate workspace_write before using run_command, start_process, or process_* tools. Use run_command(command)→stdout/stderr/exit for bounded terminal tasks (git/npm/python/curl). Use start_process plus process_status/process_log/process_wait/process_kill/process_submit for dev servers, watchers, long builds, renders, and interactive CLIs. Use browser_* for websites, desktop_* for UI interaction.`,

  memory: `MEMORY: memory_browse(file)→categories. memory_write(file,category,content)→add/update fact. memory_read(file)→full contents. file="user"|"soul"|"memory". Use user for user profile facts, soul for operating rules, memory for durable long-term context and decisions.
LONG-TERM RETRIEVAL: memory_search(query, mode?, ...filters)→SQLite/FTS/vector-ranked hits with operational/evidence layers, citations, authority, status, and source spans when available. memory_read_record(record_id)→full source record. memory_search_project(project_id, query) and memory_search_timeline(query, date_from?, date_to?) for scoped retrieval. memory_get_related(record_id) expands to connected context.
OBSIDIAN: Obsidian is an optional external app connector. After it is connected in the Connections panel and external_apps is active, connector_obsidian_status/connect_vault/sync/writeback link local vault notes into Prometheus as obsidian_note evidence. Notes tagged #prometheus/memory, #prometheus/decision, #prometheus/preference, #prometheus/rule, or with prometheus-memory frontmatter can be promoted into operational memory.
TRIGGERS: use retrieval when user asks about previous discussions, older decisions, historical project context, what changed over time, or "what did we decide" questions.
GRAPH/DIAGNOSTICS: memory_graph_snapshot() returns relation graph nodes/edges; memory_index_refresh() forces reindex from workspace/audit.
SEARCH MODES: quick(default)=fast focused retrieval; deep=broad recall; project=project-scoped; timeline=chronological history.`,

  integrations: `INTEGRATIONS: mcp_server_manage(action,...)→MCP lifecycle (list/upsert/import/connect/disconnect/delete/list_tools). webhook_manage(action,...)→webhook settings (enabled/token/path). integration_quick_setup(action,...)→one-shot presets (supabase/github/windows/brave/postgres/sqlite/filesystem/memory).`,

  media_assets: `MEDIA ASSETS: download_url(url,filename?) and download_media(url,audio_only?) retrieve remote assets. analyze_image/analyze_video inspect uploaded or downloaded media. Use browser_automation for browser-triggered downloads and media_assets for direct URL/media processing.`,

  media_quality: `MEDIA QUALITY: image_check_contrast, image_check_text_overflow, image_detect_empty_regions, image_get_bounds_summary, image_get_element_at_point, image_get_overlaps, video_render_frame, video_render_contact_sheet, video_check_audio_sync, and video_check_caption_timing validate visual/video output. Activate when checking layout polish, frame rendering, captions, or audio timing.`,

  automations: `AUTOMATIONS: schedule_job is core for normal list/create/update/pause/resume/delete/run_now. Activate automations for deeper operator tools: schedule_job_detail/history/log_search/outputs/patch/stuck_control inspect and repair scheduled runs; automation_dashboard returns a unified operator snapshot. Confirm before mutating existing jobs. Prompts must be self-contained for a fresh future agent.`,

  external_apps: `EXTERNAL APPS: connector_list is core for discovery. Activating external_apps loads only tools for connectors currently connected in the Connections panel, such as Gmail, GitHub, Slack, Notion, Google Drive, Reddit, HubSpot, Salesforce, Stripe, GA4, Obsidian, X/Twitter, or xAI/Grok. Check connector_list first when connection status matters.`,

  social_intelligence: `SOCIAL INTELLIGENCE: social_intel(platform, handle, mode?) analyzes social profiles and persists structured findings under entities/social. Use for profile metrics, engagement analysis, growth trajectory, and content recommendations.`,

  proposal_admin: `PROPOSAL ADMIN: edit_proposal updates pending proposals before approval. Use only for proposal metadata/details/diff revisions, not for executing source edits directly.`,

  mcp_server_tools: `MCP SERVER TOOLS: dynamic tools from connected MCP servers appear as mcp__serverId__toolName. Use mcp_server_manage(action:"list_tools") or integration_admin first when you need to inspect available MCP tools. Use only trusted connected servers.`,

  creative_mode: `CREATIVE TOOLS: normal main-chat creative editor tools. Use creative_* and hyperframes_* directly for editable image/video/canvas/studio work, and use Creative/HyperFrames skills for workflow guidance. Workspace selection is editor state, not an assistant runtime mode. Use generate_image/generate_video for one-shot AI media without opening an editable workspace.`,

  debug: isPublicDistributionBuild()
    ? `DEBUG: Use workspace files, logs, audit records, generated artifacts, and visible runtime state to diagnose issues in the public app build. Do not assume Prometheus source or dev-only self reference files are available.`
    : `DEBUG: For Prometheus internal/runtime errors, inspect self/index.md first, then use workspace logs/audit when relevant: list_directory('audit'), search_files(directory:'audit', pattern:...), and read_file(...) on specific transcripts, task records, or compaction summaries. For Prometheus source errors in dev/private builds, use read_source/grep_source for src/ errors or read_webui_source/grep_webui_source for web-ui errors. For running compiled-backend mismatches, compare src/ with dist/ through prom-root read tools when available.`,

  agents: `AGENTS: agent_list()→all agents. agent_info(id)→details. spawn_subagent(id, task_prompt, create_if_missing?, run_now?)→run or create a standalone agent. message_subagent(agent_id,message,context?)→send a background message to a standalone non-team subagent and return a task id. delete_agent(id, confirm:true)→remove.
RULES: Always agent_list() first. Never spawn to list/inspect — use agent_list(). spawn_subagent creates/starts standalone one-off agents. message_subagent is for plain agent-to-agent handoff with an existing standalone subagent; its work/results stay in the subagent task panel so main chat can continue.`,

  teams: `TEAMS: ask_team_coordinator(goal, context?) for multi-agent team work. spawn_subagent() for single standalone agent tasks.
WHEN TO USE EACH:
  → spawn_subagent/message_subagent: one standalone non-team agent, one focused task or background handoff
  → ask_team_coordinator: multiple agents needed, parallel workstreams, complex goal that benefits from roles (planner+builder+verifier etc.)
TEAM OPS: Do NOT call team_manage directly from main chat — ask_team_coordinator handles it. reply_to_team(team_id, msg) is the only direct team call — use it when a coordinator is waiting on your reply.`,

  skills: `SKILLS: Before browser/desktop actions, file edits, or multi-step execution, call skill_list() first. If relevant, call skill_read(id) and follow it. Treat skills as living workflow playbooks: while working, notice missing triggers, clearer steps, better tool order, reusable examples, templates, guardrails, and resources that would make the skill more useful next time. After a complex task (roughly 5+ tool calls), a tricky error fix, or a non-trivial workflow discovery, maintain the skill system while the evidence is fresh: if an existing skill was outdated, incomplete, wrong, or missing an example/template/reference, update it in the same turn with skill_resource_write/delete and skill_manifest_write; if no skill fits and the workflow is reusable, create a durable playbook with skill_create_bundle when resources/examples/templates/schemas would help, or skill_create for a simple one-file skill. For bundled skills, use skill_resource_list(id) and skill_resource_read(id,path) to load references/templates/examples only as needed, and add focused resources such as examples/, templates/, schemas/, prompts/, or references/ rather than bloating SKILL.md. Use skill_inspect(id) for normalized metadata/provenance. Use skill_manifest_write(id,manifest), skill_resource_write(id,path,content), skill_resource_delete(id,path), skill_import_bundle(source), skill_export_bundle(id), skill_update_from_source(id), and skill_create_bundle(...) when managing reusable bundle skills. For conversational replies, respond directly and do not force skill maintenance chatter. Skills that are not maintained become liabilities. Skill tools are core tools (always available).`,

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
  workspace_write: `${TOOL_BLOCKS.files}\n\n${TOOL_BLOCKS.shell}`,
  file_ops: `${TOOL_BLOCKS.files}\n\n${TOOL_BLOCKS.shell}`,
  shell: `${TOOL_BLOCKS.files}\n\n${TOOL_BLOCKS.shell}`,
  commands: `${TOOL_BLOCKS.files}\n\n${TOOL_BLOCKS.shell}`,
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
    const tinyfishKey = cfg.resolveSecret(s.tinyfish_api_key);
    const tavilyKey = cfg.resolveSecret(s.tavily_api_key);
    const googleKey = cfg.resolveSecret(s.google_api_key);
    const googleCx = cfg.resolveSecret(s.google_cx);
    const braveKey = cfg.resolveSecret(s.brave_api_key);
    const ps: string[] = [];
    if (tinyfishKey) ps.push(preferred === 'tinyfish' ? 'TinyFish (primary)' : 'TinyFish');
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
    ['workspace_write', 'workspace_write (workspace file mutations plus run_command/start_process/process_* tools)'],
    ['prometheus_source_read', 'prometheus_source_read (inspect Prometheus src/, web-ui/, and allowlisted root files)'],
    ['prometheus_source_write', 'prometheus_source_write (edit Prometheus app/source files for approved dev tasks)'],
    ['advanced_memory', 'advanced_memory (memory graph, timeline, related records, project search, index refresh)'],
    ['media_assets', 'media_assets (download/analyze images, video, audio, remote assets)'],
    ['media_quality', 'media_quality (layout/video QA: contrast, overflow, frame renders, caption/audio timing)'],
    ['automations', 'automations (schedule detail/history/outputs/patch/stuck control/dashboard)'],
    ['integration_admin', 'integration_admin (MCP server setup, webhooks, integration quick setup)'],
    ['external_apps', 'external_apps (Gmail, GitHub, Slack, Notion, Drive, Reddit, HubSpot, Salesforce, Stripe, GA4, Obsidian)'],
    ['connectors', 'connectors (alias for external_apps; loads only connected app tools — use connector_list to see what\'s connected)'],
    ['social_intelligence', 'social_intelligence (social profile analysis and recommendations)'],
    ['proposal_admin', 'proposal_admin (edit pending proposals before approval)'],
    ['mcp_server_tools', 'mcp_server_tools (dynamic mcp__server__tool functions from connected servers)'],
    ['composite_tools', 'composite_tools (saved multi-step tools and composite management)'],
    ['creative_mode', 'creative_mode (creative editor tools)'],
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

  const menu = `[TOOLS] Core tools loaded (file read/search, web, basic memory, skill tools including skill_list/skill_read/skill_resource_*/skill_inspect/skill_manifest_write/skill_import_bundle/skill_create_bundle, tasks, schedule_job, switch_model, set_current_model, update_heartbeat, write_proposal, ask_team_coordinator). Activate additional categories as needed:
  ${categoryMenu}
  Preferred category IDs are the names in the menu above; legacy IDs like browser, file_ops, team_ops, connectors, and mcp still work as aliases.
  Use: request_tool_category({"category":"browser"}) — stays active for the whole session. Full reference: read_file('TOOLS.md')

[FILE EDIT ROUTING] For workspace edits, activate/use file_ops and follow: file_stats/read_file or grep_file first, then find_replace/replace_lines/insert_after/delete_lines/write_file/create_file. Do not use run_command, Python, PowerShell, sed, or node scripts as the default file editor.

[RUN COMMAND ROUTING] For shell/dev-server/process work, activate workspace_write. Use run_command for bounded commands; use start_process plus process_status/process_log/process_wait/process_kill/process_submit for long-running or interactive commands.

[PROPOSAL LANES] When using write_proposal, set execution_mode explicitly:
- code_change: Prometheus dev self-edit only. Use only for exact src/ and/or web-ui/ affected_files, include execution_steps, executor_prompt, risk_tier, and required src proposal headings. Do not use code_change for prom-root/config/build scripts unless the proposal lane explicitly supports that scope.
- action: approve and perform/trigger/create something exactly once. Use for team starts, scheduled runs, artifacts, and bounded workflows. Include 3-7 execution_steps and requires_build=false.
- review: read-mostly verification/audit/report. Do not mutate unless the proposal explicitly approves that exact mutation. Include evidence/resource refs and 3-7 execution_steps.

[SEARCH] Providers: ${searchProviders}.
WHEN: freshness (today/latest/current/price), high-stakes facts, named entity lookup, uncertainty ("not sure if…"). Skip for timeless well-known facts.
SHOPPING: for products, shopping comparisons, prices, ratings, or product carousels, call shopping_search_products first. It uses the existing web search/fetch stack and emits carousel-ready product cards without requiring shopping API keys. Use browser tools only to fill missing fields, inspect a JS-heavy page, or verify a specific product visually.
HOW: complex topics → call web_search 2–3× with different angles (not the same query twice). Scan snippets → web_fetch the 1–3 most relevant URLs. Add site:domain.com to target a source.
FETCH STRATEGY: web_fetch for static articles/docs (fast). browser_get_page_text for JS-heavy/login-gated pages (slower, use when web_fetch returns empty/broken).
ITERATE: if first search misses, rephrase the query or try a broader/narrower angle before giving up.
For broad coverage use web_search_multi(query,max_results?) or web_search(..., provider:"multi"). For provider checks use web_search_single(query, provider:"tinyfish"|"tavily"|"google"|"brave"|"ddg"|"xai") and inspect provider metadata/banner; do not use site:google-owned domains as provider proof.

[WRITE NOTE] write_note(content, tag?) is always available — use it to preserve context between sessions.
WHEN TO WRITE: something was discussed, decided, or discovered that future sessions should know about; a file/task/plan step completed; data gathered from browser/desktop/API mid-task.
SKIP: casual chat, greetings, simple Q&A, turns where nothing actionable happened.
SPEED RULE: if write_note is the only action in your turn, call switch_model('low') first — it reverts automatically after.
DURING PLANS/TASKS: write a note at each meaningful step — capturing gathered data, intermediate results, or blockers keeps context recoverable if the task is interrupted.

[MEMORY CONTINUITY] Memory search is Prometheus' long-term recall. Use memory_search before answering from memory when the user asks about previous discussions, decisions, recurring preferences, project history, older tasks, "what did we decide", "what happened before", or any answer that depends on continuity. Use memory_read_record for important hits and memory_get_related to expand useful context. Use memory_search_timeline when chronology matters.

[BUSINESS CONTEXT] BUSINESS.md is available but not auto-injected by default. Use business_context_mode({"action":"enable"}) when ongoing work needs persistent business/company context across this session. Use "status" to check the mode and "disable" to turn it back off. Enabling returns the current BUSINESS.md snapshot immediately so you can use it in the same turn. Business entity tools are core: list_entities(type?), read_entity(type,id), write_entity(type,id,content), append_entity_event(type,id,event,display_name?,source?,confidence?). Use entities for clients, contacts, projects, vendors, and social accounts; use BUSINESS.md for company-level profile, offers, policies, and priorities.

[TEAMS & AGENTS] Two delegation paths — pick the right one:
  → spawn_subagent('id', task, ...) — create/run one standalone non-team agent. message_subagent(id,message) — send a background message to an existing standalone agent; returns task_id and keeps the conversation/result in the subagent task panel. Requires team_ops category.
  → ask_team_coordinator(goal) — always available (core). Multi-agent teams with roles. Use when: parallel workstreams, multiple specializations needed, or task is too large for one agent context.
Do NOT call team_manage directly. reply_to_team(team_id, msg) is the only direct team call — use only when a coordinator is waiting on your reply.

[MODEL ROUTING] Default: primary model (powerful, for complex work). Call switch_model(tier, reason) EARLY when the task is clearly lighter.
  → If the user asks to change the AI's current/live primary model, call set_current_model("provider/model"). Do not use set_agent_model for that; set_agent_model is only for future-agent defaults/routes.
  → 'low' (speed): single command, file read/summary, write_note only, quick lookups.
  → 'medium' (careful): multi-step analysis or structured work that doesn't need full primary model power.
  → Stay on primary: ${isPublicDistributionBuild() ? 'proposal work, deep reasoning, auth/security/build, anything expensive if wrong.' : 'src/ edits, proposals, deep reasoning, auth/security/build, anything expensive if wrong.'}
  → Mixed intent rule: if a turn contains BOTH memory work (memory_write/write_note) and a separate actionable task, prefer background_spawn for the memory sidecar so primary execution continues in parallel.
  → If you choose not to spawn and you used switch_model for a memory side action, continue executing the user's remaining task in the same turn (do not stop after memory).
  Auto-reverts after turn end — never switch back manually.

${BG_AGENT_RUNTIME_HINT}`;
  const activeCategoryList = Array.from(activatedCategories)
    .map((category) => String(category || '').trim())
    .filter(Boolean);
  const activeCategoryHint = activeCategoryList.length > 0
    ? `\n\n[ACTIVE_TOOL_CATEGORIES] Already active for this session: ${activeCategoryList.join(', ')}. Do not request these categories again; use their tools directly when relevant.`
    : '';
  const baseMenu = `${menu}${activeCategoryHint}\n\n${TOOL_BLOCKS.skills}`;

  if (activatedCategories.size === 0) return baseMenu;

  const activePolicies: string[] = [];
  for (const cat of activatedCategories) {
    if (CATEGORY_POLICIES[cat]) activePolicies.push(CATEGORY_POLICIES[cat]);
  }

  if (activePolicies.length === 0) return baseMenu;
  return baseMenu + '\n\n' + activePolicies.join('\n\n');
}

function stripSkillEmojiFrontmatter(content: string): string {
  const raw = String(content || '');
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return raw;
  const frontmatter = raw.slice(0, end)
    .split('\n')
    .filter((line) => !/^\s*emoji\s*:/i.test(line))
    .join('\n');
  return frontmatter + raw.slice(end);
}

function buildActiveSkillsContext(sessionId: string, skillsManager: SkillsManager): string {
  const skillIds = Array.from(getActivatedSkillIds(sessionId));
  if (!skillIds.length) return '';

  const lines: string[] = ['[ACTIVE_SKILLS]'];
  for (const skillId of skillIds) {
    const skill = skillsManager.get(skillId);
    if (!skill) continue;
    lines.push(`Recently used: ${skill.id}.`);
    if (skill.description) lines.push(`Skill Description: ${skill.description}`);
    if (skill.kind === 'bundle') {
      const readResources = getActivatedSkillResources(sessionId, skillId);
      if (readResources.length) {
        lines.push(`Resources read: ${readResources.join(', ')}.`);
      }
    }
    lines.push(`Re-read with skill_read("${skill.id}") if you need the full instructions.`);
  }

  return lines.join('\n');
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
    const activeSkillCtxLocal = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return buildLocalModelPersonalityCtx(timeString, userMemory) + (business ? `\n\n[BUSINESS]\n${business}` : '') + (activeSkillCtxLocal ? `\n\n${activeSkillCtxLocal}` : '');
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
    const skillCtxTeach = skillsManager.buildTurnContext(messageText);
    const activeSkillCtxTeach = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        user ? `[USER]\n${user}` : '',
        soul ? `[SOUL]\n${soul}` : '',
        buildToolsContext(activatedCatsTeach),
      ],
      [skillCtxTeach, activeSkillCtxTeach],
    );
  }

  const allowLongTermSearch = executionMode === 'interactive' || executionMode === 'background_agent';
  const memorySearchRouting = allowLongTermSearch
    ? routeMemorySearchMode(messageText)
    : ({ mode: 'no_search', reason: 'execution_mode_skip' } as MemorySearchRouting);
  const retrievedMemoryCtx = allowLongTermSearch
    ? buildRetrievedMemoryContext(workspacePath, messageText, memorySearchRouting)
    : '';
  const cisContext = buildCisContextBlock(workspacePath, messageText, { force: isBusinessContextEnabled(sessionId) });
  const configSoul = loadSoul();

  if (profile === 'voice_agent') {
    const user = loadFullMemoryProfile(workspacePath, 'USER.md');
    const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md');
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    const memory = loadFullMemoryProfile(workspacePath, 'MEMORY.md', 8000);
    const voiceAgentMemory = loadVoiceAgentMemory(workspacePath);
    const today = new Date().toISOString().split('T')[0];
    const intradayPath = path.join(workspacePath, 'memory', `${today}-intraday-notes.md`);
    const intradayNotes = fs.existsSync(intradayPath) ? processIntradayNotes(fs.readFileSync(intradayPath, 'utf-8')) : '';
    const readCapped = (relativePath: string, maxChars: number): string => {
      try {
        const filePath = path.join(workspacePath, relativePath);
        if (!fs.existsSync(filePath)) return '';
        const raw = fs.readFileSync(filePath, 'utf-8').trim();
        return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n...[truncated]` : raw;
      } catch {
        return '';
      }
    };
    const selfIndex = isPublicDistributionBuild() ? '' : readCapped(path.join('self', 'index.md'), 3000);
    const voiceSelf = isPublicDistributionBuild() ? '' : readCapped(path.join('self', '06-image-voice.md'), 7000);
    const boot = readCapped('BOOT.md', 3000);
    let projectContextBlock = '';
    try {
      const { buildProjectContextBlock, findProjectBySessionId } = await import('./projects/project-store.js');
      if (findProjectBySessionId(sessionId)) {
        projectContextBlock = buildProjectContextBlock(sessionId) || '';
      }
    } catch {}
    const referenceHint = isPublicDistributionBuild()
      ? ''
      : `[REFERENCE_FILES] Architecture/debug context: self/index.md is the canonical workspace-root map. The Voice Agent has direct voice-system notes below and should dispatch to the worker if it needs to read more files.`;
    const skillCtx = skillsManager.buildTurnContext(messageText);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        configSoul ? `[PROMETHEUS_SOUL]\n${configSoul}` : '',
        user ? `[USER]\n${user}` : '',
        soul ? `[SOUL]\n${soul}` : '',
        business ? `[BUSINESS]\n${business}` : '',
        memory ? `[MEMORY]\n${memory}` : '',
        voiceAgentMemory ? `[VOICE_AGENT_MEMORY - voice-only routing and behavior notes]\n${voiceAgentMemory}` : '',
        projectContextBlock ? `[PROJECT_CONTEXT]\n${projectContextBlock}` : '',
        boot ? `[BOOT_MD - operational startup/workspace guidance, read-only]\n${boot}` : '',
        selfIndex ? `[SELF_INDEX]\n${selfIndex}` : '',
        voiceSelf ? `[SELF_VOICE_SECTION]\n${voiceSelf}` : '',
      ],
      [
        cisContext,
        retrievedMemoryCtx,
        intradayNotes ? `[TODAY_NOTES - read-only working context]\n${intradayNotes}` : '',
        referenceHint,
        skillCtx,
        activeSkillCtx,
      ],
    );
  }

  if (profile === 'switch_model') {
    const user = loadFullMemoryProfile(workspacePath, 'USER.md');
    const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md');
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    const memory = loadFullMemoryProfile(workspacePath, 'MEMORY.md', 8000);
    // switch_model starts a fresh generation context. Do not inherit the
    // interactive session's expanded tool categories, otherwise a lightweight
    // switch can receive the full schema payload from prior category opens.
    const activatedCatsSwitch = new Set<string>();
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsSwitch.add('browser');
        else activatedCatsSwitch.add(ec);
      }
    }
    const skillCtx = skillsManager.buildTurnContext(messageText);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        configSoul ? `[PROMETHEUS_SOUL]\n${configSoul}` : '',
        user ? `[USER]\n${user}` : '',
        soul ? `[SOUL]\n${soul}` : '',
        business ? `[BUSINESS]\n${business}` : '',
        memory ? `[MEMORY]\n${memory}` : '',
        buildToolsContext(activatedCatsSwitch),
      ],
      [cisContext, retrievedMemoryCtx, skillCtx, activeSkillCtx],
    );
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
    const skillCtx = skillsManager.buildTurnContext(messageText);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        user ? `[USER]\n${user}` : '',
        soul ? `[SOUL]\n${soul}` : '',
        memory ? `[MEMORY]\n${memory}` : '',
        business ? `[BUSINESS]\n${business}` : '',
        buildToolsContext(activatedCatsTeam),
      ],
      [cisContext, skillCtx, activeSkillCtx],
    );
  }

  // ── Path B: autonomous execution — full prompt, no changes ─────────────────
  const isAutonomous = executionMode === 'background_task' || executionMode === 'proposal_execution' || executionMode === 'cron' || executionMode === 'heartbeat';
  if (isAutonomous) {
    const isProposalExecution = executionMode === 'proposal_execution';
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    const soul = isProposalExecution ? configSoul : loadFullMemoryProfile(workspacePath, 'SOUL.md');
    // Proposal executors get only the approved task context plus the configured
    // Prometheus soul. Workspace MEMORY.md is intentionally excluded here.
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
    // Autonomous agents: same hint + pinned skills as interactive chat.
    const skillCtx = skillsManager.buildTurnContext(messageText);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        business ? `[BUSINESS]\n${business}` : '',
        soul ? `${isProposalExecution ? '[PROMETHEUS_SOUL]' : '[SOUL]'}\n${soul}` : '',
        memory ? `[MEMORY]\n${memory}` : '',
        projectContextBlock ? `[PROJECT_CONTEXT]\n${projectContextBlock}` : '',
        toolsBlockAuto,
      ],
      [
        cisContext,
        intradayNotes ? `[TODAY_NOTES]\n${intradayNotes}` : '',
        skillCtx,
        activeSkillCtx,
      ],
    );
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
    // First turn: still get the skills hint + any pinned skills.
    const skillCtxT1 = skillsManager.buildTurnContext(messageText);
    const activeSkillCtxT1 = buildActiveSkillsContext(sessionId, skillsManager);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        configSoul ? `[PROMETHEUS_SOUL]\n${configSoul}` : '',
        user ? `[USER]\n${user}` : '',
        soulT1 ? `[SOUL]\n${soulT1}` : '',
        business ? `[BUSINESS]\n${business}` : '',
        memory ? `[MEMORY]\n${memory}` : '',
        projectContextBlockT1 ? `[PROJECT_CONTEXT]\n${projectContextBlockT1}` : '',
        buildToolsContext(activatedCatsT1),
      ],
      [
        cisContext,
        retrievedMemoryCtx,
        intradayNotes ? `[TODAY_NOTES — read-only context, do NOT call write_note unless you complete something meaningful this turn]\n${intradayNotes}` : '',
        skillCtxT1,
        activeSkillCtxT1,
      ],
    );
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
    ? ''
    : `[REFERENCE_FILES] Architecture/debug context: self/index.md is the canonical workspace-root map; use read_file('self/index.md'). Follow its links to focused self/* subsystem files as needed.`;

  // Skills: one-liner hint + any pinned skills injected in full.
  const skillCtx = skillsManager.buildTurnContext(messageText);
  const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);

  await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
  return assembleContext(
    [
      configSoul ? `[PROMETHEUS_SOUL]\n${configSoul}` : '',
      user ? `[USER]\n${user}` : '',
      soul ? `[SOUL]\n${soul}` : '',
      business ? `[BUSINESS]\n${business}` : '',
      memory ? `[MEMORY]\n${memory}` : '',
      projectContextBlockT2 ? `[PROJECT_CONTEXT]\n${projectContextBlockT2}` : '',
      toolsBlock,
    ],
    [
      cisContext,
      retrievedMemoryCtx,
      intradayNotes ? `[TODAY_NOTES — read-only context, do NOT call write_note unless you complete something meaningful this turn]\n${intradayNotes}` : '',
      referenceHint,
      skillCtx,
      activeSkillCtx,
    ],
  );
}
