// src/gateway/prompt-context.ts
// Full prompt context assembly — workspace memory, personality, tool hints, skill windows.
// Extracted from server-v2.ts (Step 12 of Phase 3 refactor).

import path from 'path';
import fs from 'fs';
import { hookBus } from './hooks';
import { SkillsManager } from './skills-runtime/skills-manager';
import { getConfig, getAgents } from '../config/config';
import { getActivatedSkillIds, getActivatedSkillResources, getActivatedToolCategories, isBusinessContextEnabled } from './session';
import { searchMemoryIndex } from './memory-index/index';
import { getPublicBuildAllowedCategories, isPublicDistributionBuild } from '../runtime/distribution.js';
import { buildCisContextBlock } from './business/cis-context-builder';
import { loadSoul, loadPrometheusRuntimeContract, loadVoiceSoul } from '../config/soul-loader';
import { getRuntimeActorContext, loadRuntimeActorMemoryContext } from './runtime-actor';
import { PROMPT_CACHE_MARKER } from '../providers/LLMProvider';
import { TOOL_CATEGORY_MANIFEST, TOOL_CATEGORY_MENU_ORDER } from '../runtime/tool-category-manifest';
import {
  getInstructionResolverMode,
  resolveStage3PilotPolicyDecision,
} from '../runtime/instruction-segment-registry';
import {
  resolveStage4MenuSegmentDecision,
  type Stage4InstructionIntents,
  type Stage4MenuSegmentId,
} from '../runtime/instruction-intent-detector';

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

// ─── Live subagent roster block ───────────────────────────────────────────────
// Injects the current subagent count + human display names into the runtime
// system prompt so the main agent ALWAYS knows how many subagents exist and who
// they are (by name, not just technical id), without having to call agent_list.
function buildSubagentsRosterBlock(): string {
  try {
    const all = getAgents();
    // Subagents = everything except the default/main agent.
    const subs = all.filter((a: any) => a && a.default !== true && a.id !== 'main');
    if (subs.length === 0) {
      return `[SUBAGENTS] You currently have 0 subagents configured (only the default agent exists). If asked "how many subagents / who are they," answer: none yet.`;
    }
    const lines = subs.map((a: any) => {
      const displayName = a?.identity?.displayName || a?.name || a?.id;
      const desc = (a?.description || '').toString().trim();
      const shortDesc = desc.length > 140 ? desc.slice(0, 137) + '…' : desc;
      return `- ${displayName} (id: ${a.id})${shortDesc ? ` — ${shortDesc}` : ''}`;
    });
    return `[SUBAGENTS] You currently have ${subs.length} subagent${subs.length === 1 ? '' : 's'} configured. ALWAYS refer to each by their display name (not the technical id). When asked how many subagents exist or who they are, answer with this count and these names:\n${lines.join('\n')}`;
  } catch {
    return '';
  }
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
  profile?: 'default' | 'switch_model' | 'local_llm' | 'teach_mode' | 'voice_agent' | 'direct_subagent';
  excludedSkillIds?: string[];
  forcedSkillIds?: string[];
  instructionIntents?: Stage4InstructionIntents;
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
    // dev/project file patterns
    'package.json', 'tsconfig', '.env', 'dockerfile', 'makefile', 'gitignore',
    'index.html', '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.md',
    'workspace file', 'workspace files', 'workspace path', 'workspace directory',
    'directory created', 'folder', 'path:', 'file:', 'games/',
    'create a project', 'scaffold', 'new project', 'init project', 'project structure',
  ];
  const TASK = ['task', 'background', 'run this', 'start a', 'status', 'paused', 'resume', 'in progress', 'what tasks', 'running tasks'];
  const SCHEDULE = ['schedule', 'every day', 'every week', 'at ', 'recurring', 'cron', 'automate', 'remind me', 'daily', 'weekly'];
  const SHELL = [
    'run command', 'execute', 'terminal', 'powershell', 'script', 'command line', 'cmd', 'bash',
    // npm / node
    'npm', 'npx', 'node ', 'yarn', 'pnpm', 'bun ',
    // build / compile / test
    'build', 'compile', 'tsc', 'run build', 'run test', 'run tests', 'run lint', 'run dev',
    'run start', 'run script', 'run npm', 'run node', 'run the build', 'run the tests',
    'install deps', 'install dependencies', 'install packages',
    // git
    'git ', 'check git', 'git status', 'git commit', 'git push', 'git pull', 'git log',
    'git diff', 'git branch', 'git merge', 'git rebase', 'git stash',
    // other runtimes / tools
    'python', 'pip ', 'cargo', 'make ', 'docker', 'kubectl', 'deno',
    // server / dev server
    'start server', 'start dev', 'dev server', 'watch mode', 'hot reload',
    // lint / format
    'eslint', 'prettier', 'lint', 'format code',
    // deploy / ci
    'deploy', 'publish package', 'ci ', 'pipeline',
  ];
  // Much stricter MEMORY detection — only explicit memory operations, not casual conversation
  const MEMORY = ['remember this', 'note that', 'save that', 'write that down', 'dont forget', "don't forget", 'update my memory', 'add to my memory', 'save to memory', 'memory note', 'remember:', 'note:', 'update memory', 'memory write'];
  const DEBUG = ['why', 'error', 'failed', 'how does', 'architecture', 'debug', 'caused', 'broke', 'not working', 'explain how', 'whats wrong', "what's wrong"];
  const TEAMS = ['team', 'sub-team', 'sub team', 'managed team', 'team manager', 'team chat', 'team members'];
  const INTEGRATIONS = ['integration', 'integrations', 'mcp', 'model context protocol', 'webhook', 'supabase', 'connect service', 'connect to'];
  const MEDIA = ['download_url', 'download_media', 'analyze_image', 'analyze_video', 'download image', 'download video', 'analyze image', 'analyze video', 'media analysis'];
  const MEDIA_QUALITY = ['contrast', 'text overflow', 'empty region', 'bounds summary', 'element at point', 'overlap', 'contact sheet', 'render frame', 'audio sync', 'caption timing'];
  const AUTOMATIONS = ['schedule', 'scheduled', 'every day', 'every week', 'recurring', 'cron', 'automate', 'automation', 'remind me', 'daily', 'weekly'];
  const CONNECTORS = ['gmail', 'github', 'slack', 'notion', 'google drive', 'hubspot', 'salesforce', 'stripe', 'ga4', 'external app', 'connected app'];
  const SOURCE_READ = ['prometheus source', 'prom source', 'read source', 'inspect source', 'grep source', 'read webui source', 'webui source', 'source_read', 'prometheus_source_read'];
  const SOURCE_WRITE = ['edit prometheus source', 'change prometheus source', 'patch prometheus source', 'modify prometheus source', 'source_write', 'prometheus_source_write', 'dev source edit'];
  const explicitPromSourcePath = /(?:^|[\s("'`])(?:\.\/)?(?:src\/(?:gateway|runtime)(?:\/|$)|web-ui\/src(?:\/|$))/i.test(String(text || '').replace(/\\/g, '/'));
  const contextualPromSourcePath =
    /\bprometheus\b|\bpromsrc\b|\bgateway\b|\bdev[_ -]?source\b/i.test(lower)
    && /(?:^|[\s("'`])(?:\.\/)?(?:src|web-ui)\/[a-z0-9_.@/-]+/i.test(String(text || '').replace(/\\/g, '/'));
  const sourceMutationIntent = /\b(edit|change|patch|modify|fix|update|refactor|remove|add|implement)\b/i.test(lower);
  const SOCIAL_INTELLIGENCE = ['social intelligence', 'social profile', 'profile analysis', 'engagement analysis', 'growth trajectory', 'content recommendations', 'social_intel'];
  const PROPOSAL_ADMIN = ['edit proposal', 'update proposal', 'revise proposal', 'proposal admin', 'proposal_admin', 'pending proposal'];
  const MCP_SERVER_TOOLS = ['mcp server tools', 'mcp tools', 'mcp__', 'connected mcp', 'server tool', 'mcp_server_tools'];
  const COMPOSITE_TOOLS = ['composite tool', 'composite tools', 'saved tool', 'multi-step tool', 'composites', 'composite_tools'];
  const SKILLS_CATEGORY = ['skill create', 'create skill', 'update skill', 'skill authoring', 'skill manifest', 'skill resource', 'skill bundle', 'skill maintenance'];
  const MODEL_MANAGEMENT = ['agent model', 'agent models', 'model template', 'model templates', 'set agent model', 'agent model template', 'model_management'];
  const BUSINESS_CATEGORY = ['business entity', 'business entities', 'client entity', 'contact entity', 'vendor entity', 'project entity', 'business context', 'business profile'];
  if (WEB.some(k => lower.includes(k))) cats.add('web');
  if (BROWSER.some(k => lower.includes(k))) cats.add('browser');
  if (DESKTOP.some(k => lower.includes(k))) cats.add('desktop');
  if (FILES.some(k => lower.includes(k))) cats.add('files');
  if (TASK.some(k => lower.includes(k))) cats.add('task');
  if (SCHEDULE.some(k => lower.includes(k))) cats.add('schedule');
  if (SHELL.some(k => lower.includes(k))) cats.add('shell');
  if (MEMORY.some(k => lower.includes(k))) cats.add('memory');
  if (DEBUG.some(k => lower.includes(k))) cats.add('debug');
  if (TEAMS.some(k => lower.includes(k))) {
    cats.add('teams');
    cats.add('agents_and_teams');
  }
  if (INTEGRATIONS.some(k => lower.includes(k))) cats.add('integrations');
  if (MEDIA.some(k => lower.includes(k))) cats.add('media');
  if (AUTOMATIONS.some(k => lower.includes(k))) cats.add('automations');
  if (CONNECTORS.some(k => lower.includes(k))) cats.add('external_apps');
  if (SOURCE_READ.some(k => lower.includes(k)) || explicitPromSourcePath || contextualPromSourcePath) {
    cats.add('prometheus_source_read');
  }
  if (SOURCE_WRITE.some(k => lower.includes(k)) || ((explicitPromSourcePath || contextualPromSourcePath) && sourceMutationIntent)) {
    cats.add('prometheus_source_write');
  }
  if (SOCIAL_INTELLIGENCE.some(k => lower.includes(k))) cats.add('social_intelligence');
  if (PROPOSAL_ADMIN.some(k => lower.includes(k))) cats.add('proposal_admin');
  if (MCP_SERVER_TOOLS.some(k => lower.includes(k))) cats.add('mcp_server_tools');
  if (COMPOSITE_TOOLS.some(k => lower.includes(k))) cats.add('composite_tools');
  if (SKILLS_CATEGORY.some(k => lower.includes(k))) cats.add('skills');
  if (MODEL_MANAGEMENT.some(k => lower.includes(k))) cats.add('model_management');
  if (BUSINESS_CATEGORY.some(k => lower.includes(k))) cats.add('business');
  const AGENT_BUILDER = ['workflow', 'agent builder', 'agentbuilder', 'architect workflow', 'deploy workflow', 'execute workflow', 'workflow template'];
  const agentBuilderConfigEnabled = (() => { try { return (getConfig().getConfig() as any)?.agent_builder?.enabled === true; } catch { return false; } })();
  if (agentBuilderConfigEnabled && AGENT_BUILDER.some(k => lower.includes(k))) cats.add('agent_builder');
  const AGENTS = ['agent', 'subagent', 'sub-agent', 'spawn', 'worker', 'agent_list', 'agent_info', 'spawn_agent', 'what agents', 'our agents', 'check the agent', 'who do we have', 'configure agent', 'create agent', 'new agent', 'delegate', 'automate with'];
  if (AGENTS.some(k => lower.includes(k))) {
    cats.add('agents');
    cats.add('agents_and_teams');
  }
  const ROUTING = ['dispatch', 'route', 'routing', 'dispatch_to_agent', 'jarvis', 'send to agent', 'forward to', 'hand off', 'handoff'];
  if (ROUTING.some(k => lower.includes(k))) {
    cats.add('routing');
    cats.add('agents_and_teams');
  }
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
  web: `WEB: shopping_search_products(query,merchant?,max_results?,provider?,include_metadata?,include_images?)→fast normalized product cards and product carousel using existing web search/fetch only, no shopping API key. web_search(query,max_results?,multi_engine?,provider?,fetch_top_k?,fetch_max_chars?)→one unified search tool: provider="multi" or multi_engine=true queries every configured provider, provider=tinyfish|tavily|google|brave|ddg|xai targets one provider. web_fetch(url|urls,max_chars?,concurrency?,include_media?,include_thread?)→fetch one page or a small batch of URLs; exact X statuses use official oEmbed, while media and thread browser work are opt-in. Search first, then fetch.
Product/shopping rule: for product carousels, shopping comparisons, prices, ratings, or store-specific product lists, call shopping_search_products first. Use browser/page extraction only when this result is incomplete or needs visual/login verification.
Visual source rule: pass real source URLs to show_sources after research. It normalizes web/provider aliases and automatically fills missing page metadata and cached preview images; include any title/snippet/image fields already returned instead of discarding them.
Strategy: for complex topics call web_search 2–3× with different query angles; scan snippets; web_fetch the 1–3 most relevant URLs.
Use web_search with provider:"tavily" to test Tavily-only; use provider:"google" to test Google-only; use provider:"xai" for X-backed social search. Use provider:"multi" or multi_engine:true for broad coverage.
Site search: web_search("site:reddit.com keyword"). Fallback: web_fetch a direct URL (reuters.com, apnews.com, bbc.com).
Fetch routing: web_fetch for static pages; browser_get_page_text for JS-heavy or login-gated pages.`,

  browser: `BROWSER: use unified wrappers. browser_session(action:"doctor"|"set_profile_target"|"open"|"list_tabs"|"select_tab"|"new_tab"|"close_tab"|"close", ...) handles browser health, navigation/profile lanes, tabs, and close. browser_observe(action:"snapshot"|"snapshot_delta"|"screenshot"|"page_text"|"focused_item"|"wait"|"element_watch", ...) inspects state. browser_act(action:"click"|"fill"|"type"|"key"|"upload_file"|"scroll"|"drag"|"click_and_download"|"vision_click"|"vision_type", ...) performs page actions. browser_extract(action:"scroll_collect"|"scroll_collect_v2"|"extract_structured"|"run_js"|"network"|"console"|"accessibility"|"smoke_test"|"teach_verify", ...) handles scraping, JS fallback, diagnostics, QA, and Teach verification. download_url(url,filename?). download_media(url,audio_only?). generate_image(prompt, aspect_ratio?, provider?, model?). generate_video(prompt, image?, video?, mode?, duration?, resolution?).
OBSERVE MODES: observe="none" tiny ack and lowest latency; "compact" small URL/title/focus/DOM-count summary; "delta" changed DOM refs after the action; "snapshot" full fresh DOM refs in the result; "screenshot" fresh visual observation. Wrapper actions pass observe/capture_after through to the existing browser handlers. Use capture_after=true on click/fill/type/scroll/drag as shorthand for observe="snapshot" when you need fresh refs immediately.
RULES: visual-first workflow. Vision screenshots are highest-confidence on dynamic/SPA UIs. If DOM refs or JS-derived assumptions are uncertain, stale, or contradictory, take a fresh browser_observe(action:"screenshot") and trust that evidence first. After browser actions, rely on the default observation unless state likely changed in a way you must inspect; override with observe="none" on cheap deterministic actions when speed matters, observe="snapshot" for new refs, or observe="screenshot" for visual confirmation. Treat browser_extract(action:"run_js") as fallback for cases where snapshot/vision still cannot identify the target. For high-impact final submits/posts/sends/purchases/deletes, prepare the browser UI, call request_final_action_approval, then pass final_action_approval_id to the exact final browser_act(action:"click"|"key"). The approved final browser action returns post-action visual evidence automatically; inspect it, verify that the approved action actually succeeded, and only then report completion or explain the visible uncertainty/failure. Composer fills show "COMPOSER SUBMIT BUTTON: @N" - click it immediately unless it is a high-impact final action requiring request_final_action_approval first. j/k nav: call browser_observe(action:"focused_item") only when focus is unclear or you need to confirm position after navigation. Use SITE SHORTCUTS when shown; save new ones with save_site_shortcut().
MEDIA SELECTION: when choosing an image/video on X, Google Images, or similar pages, first enumerate candidates via browser_observe(action:"snapshot") or browser_extract(action:"extract_structured") using nearby text, alt text, username, timestamp, href, or src. Rank candidates by text match to the request, then take browser_observe(action:"screenshot") to visually confirm the intended item before downloading. Prefer download_url for direct asset URLs and browser_act(action:"click_and_download") for browser-triggered downloads.`,

  desktop: `DESKTOP: use unified wrappers. desktop_screen(action:"doctor"|"screenshot"|"region_screenshot"|"window_screenshot"|"monitors"|"wait_for_change"|"diff_screenshot"|"pixel_watch", ...) inspects visual/monitor state. desktop_apps(action:"list_apps"|"list_windows"|"list_installed_apps"|"find_installed_app"|"launch_app"|"close_app"|"process_list", ...) handles app/window discovery and lifecycle. desktop_window(action:"find"|"focus"|"control"|"state"|"screenshot"|"region_screenshot"|"text"|"accessibility_tree"|"click"|"type"|"key"|"scroll"|"drag", ...) is preferred for app-specific work and delegates to canonical window-scoped handlers. desktop_input(action:"click"|"drag"|"scroll"|"type"|"type_raw"|"key"|"wait"|"clipboard_get"|"clipboard_set", ...) is the host-desktop/global coordinate fallback. desktop_macro(action:"record"|"stop"|"replay"|"list"). desktop_background(action:"status"|"prepare_sandbox"|"command", command_action?, ...) targets the isolated background worker, not the host desktop.
VISUAL GROUNDING: use coarse-to-fine capture. Take a whole-window screenshot for orientation, then recapture the relevant panel with desktop_window(action:"region_screenshot", window_token, region:[x1,y1,x2,y2]) whenever labels are unreadable, controls are dense, an icon/loading indicator is small, or the image was normalized/downscaled. Region coordinates are window-relative and the crop occurs on the native capture before transport normalization, preserving real detail. For cross-window/desktop areas use desktop_screen(action:"region_screenshot", region:[x1,y1,x2,y2]) with virtual-desktop coordinates. Never magnify an already downscaled image and treat invented pixels as evidence; recapture the native source, and repeat with a tighter region if needed.
BOUNDED VISIBLE-TARGET FLOW: one whole-window orientation, one focused native region, one click, one verification. If the user says the target is visibly present, do not detour through accessibility, text extraction, Ctrl+K/Ctrl+P, search, or scrolling before attempting the grounded click. After one failed click, allow at most one tighter recapture, then report the blocker instead of looping.
Screenshot/monitor first; prefer coordinate_space="capture" with the fresh region screenshot_id when clicking from screenshot pixels, or coordinate_space="window" only for independently known app-local logical coords. With screenshot_id, an omitted coordinate_space defaults to capture. Screenshots are vision-first and skip OCR by default; pass ocr=true only when OCR is specifically needed, or use text/accessibility. Use SOM only when accessibility exposes useful target controls; if it returns only window chrome, take a native region screenshot without SOM. For an ordinary well-grounded click, omit verify (fast path); use verify="auto" only when the immediate result is ambiguous and verify="strict" only when stronger evidence is worth the latency. Strict likely-noop/uncertain verification is an ACTION_NOT_CONFIRMED error. Never claim navigation/open/select success from the fact that a click was issued: verify the requested target identity in the resulting header/content, and if it does not match, report failure. A likely-noop is not permission to retry neighboring pixels: re-observe, tighten the region, or use accessibility. capture_after=true can return a post-action screenshot. Focus before click/type. Routine desktop interaction is approval-free; for high-impact final submits/posts/sends/purchases/deletes, prepare the UI, call request_final_action_approval, then pass final_action_approval_id to the exact final desktop_window(action:"click"|"key") or desktop_input(action:"click"|"key"). The approved final desktop action returns a post-action capture automatically; inspect it, verify that the approved action actually succeeded, and only then report completion or explain the visible uncertainty/failure. Non-interrupting background desktop work requires desktop_background, not host desktop clicks/keys.`,

  files: isPublicDistributionBuild()
    ? `FILES: use unified wrappers in workspace_write. workspace_read(action:"stats"|"read"|"batch_read"|"grep"|"search"|"tree"|"list"|"exists", path/filename/directory, ...) inspects files. workspace_edit(action:"create"|"write"|"find_replace"|"replace_lines"|"insert_after"|"delete_lines"|"delete_file"|"mkdir"|"copy"|"move"|"copy_directory"|"move_directory"|"patchset"|"preview_patch"|"apply_patch", ...) mutates files. workspace_git(action:"status"|"diff"|"log"|"branch"|"commit"|"push"|"open_pr"). workspace_safety(action:"snapshot"|"restore"|"revert_last"|"scan_secrets"|"scan_large_files"|"operation_plan"|"preview_patch"). workspace_code_nav(action:"outline"|"symbols"|"definition"|"references").
FILE COST DISCIPLINE: Broad file outputs are context-expensive. Prefer workspace_read(action:"stats"|"grep"|"search") before reading; use workspace_read(action:"tree", max_depth:2, max_entries:180) for orientation; prefer single-file exact line windows over batch reads; batch_read is summary-first unless exact start_line/num_lines or content:true is provided. Use full:true/inline:true only when truly necessary.
MANDATORY EDIT ROUTE: For workspace file edits, native workspace wrappers are the default and expected path. Inspect enough to avoid blind edits: use workspace_read(action:"grep"/"search"/"stats"/"read") when the target is uncertain, but if the user/tool output already gives an exact file plus exact old text or line range, go directly to workspace_edit(action:"find_replace"/"replace_lines"/"insert_after"/"delete_lines") or workspace_edit(action:"patchset"). Edit tools verify the target and return post-edit context; do not re-read unless the result is ambiguous. Do not use terminal/Python/PowerShell/sed/node scripts to edit files unless the user explicitly asks for shell editing or native tools cannot perform the transformation.
WORKSPACE ONLY: In the public app, file tools operate on the user workspace and generated app data only. Do not edit blindly; direct exact-snippet edits are allowed because the tool fails safely when the target does not match.`
    : `FILES: use unified wrappers in workspace_write. workspace_read(action:"stats"|"read"|"batch_read"|"grep"|"search"|"tree"|"list"|"exists", path/filename/directory, ...) inspects files. workspace_edit(action:"create"|"write"|"find_replace"|"replace_lines"|"insert_after"|"delete_lines"|"delete_file"|"mkdir"|"copy"|"move"|"copy_directory"|"move_directory"|"patchset"|"preview_patch"|"apply_patch", ...) mutates files. workspace_run(action:"run"|"start"|"status"|"log"|"wait"|"kill"|"submit"|"test"|"lint"|"format"|"typecheck") handles shell/checks/processes. workspace_git(action:"status"|"diff"|"log"|"branch"|"commit"|"push"|"open_pr"). workspace_safety(action:"snapshot"|"restore"|"revert_last"|"scan_secrets"|"scan_large_files"|"operation_plan"|"preview_patch"). workspace_code_nav(action:"outline"|"symbols"|"definition"|"references").
	SOURCE CODE REFERENCE FILES: self/index.md is the canonical Prometheus architecture/debug map. Read it with workspace_read(action:"read", path:"self/index.md"), not read_source. Use the split self/* files it points to when you only need one subsystem.
	FILE COST DISCIPLINE: Broad file outputs are context-expensive. Prefer workspace_read(action:"stats"|"grep"|"search") before reading; use workspace_read(action:"tree", max_depth:2, max_entries:180) for orientation; prefer single-file exact line windows over batch reads; batch_read/dev_source_read(batch_read) is summary-first unless exact start_line/num_lines or content:true is provided. Use full:true/inline:true only when truly necessary.
	SRC/WEB-UI SURFACES (read-only by default): use dev_source_read(action:"list"|"stats"|"stats_batch"|"read"|"batch_read"|"grep"|"search", surface:"src"|"web-ui"|"prom-root", file/path/pattern, ...) to inspect Prometheus src/, web-ui/, and allowlisted prom-root files. For self-edit token savings, prefer dev_source_read(action:"grep"|"search"|"stats") first, dev_source_read(action:"batch_read", max_files:2, max_lines_per_file:80) for focused multi-file summaries or exact windows, file_tree(path:"src/..."|"web-ui/...", max_depth:2, max_entries:180) for compact structure, and search_files(directory:"src/..."|"web-ui/...") when you want search_files-style args that delegate to source grep.
	Write (approved dev source sessions only): use request_dev_source_edit for fast scoped approval in the current dev chat, or write_proposal execution_mode="code_change" for broad/risky changes that need the full proposal lane. request_dev_source_edit only needs exact files plus a short reason; add a concise plan/evidence only when the edit is non-trivial or touches safety/approval/runtime boundaries. After approval, edit only the approved scope, prefer dev_source_edit(action:"patchset") for grouped src/web-ui edits, verify with the narrowest relevant check or dev_source_edit(action:"verify_only"), then use dev_source_edit(action:"apply_live", changed_surfaces:[...]) as the shared-batch readiness boundary. If a file is queued behind another dev edit, call dev_source_edit(action:"await_files", dev_edit_id:"...") and reread the handed-off latest version before writing. apply_live may queue without restarting; when it does, stop retrying and do not write the completion note until that thread receives its own batch-live continuation. Mobile source is web-ui/src/mobile/*; do not hand-edit generated/public-web-ui/static/mobile/* except for emergency verification. After the coordinator confirms apply/restart/reload succeeded, write the completion note with the approved completion_note_tag/dev_edit_id and summarize changed files, verification, and live status. Proposal/code_exec lanes are isolated sandboxes: verify them with the canonical terminal build command inside the sandbox, and do not call apply_live there.
	MANDATORY EDIT ROUTE: For workspace file edits, native workspace wrappers are the default and expected path. Inspect enough to avoid blind edits: use workspace_read(action:"grep"/"search"/"stats"/"read") when the target is uncertain, but if the user/tool output already gives an exact file plus exact old text or line range, go directly to workspace_edit(action:"find_replace"/"replace_lines"/"insert_after"/"delete_lines") or workspace_edit(action:"patchset"). Edit tools verify the target and return post-edit context; do not re-read unless the result is ambiguous. Do not use terminal/Python/PowerShell/sed/node scripts to edit files unless the user explicitly asks for shell editing or native tools cannot perform the transformation.
	EDIT PRIORITY: For source-controlled Prometheus code, skip broad orientation when the file/symbol is already clear. Use dev_source_read(action:"grep"|"search") to locate unknown code, dev_source_read(action:"stats") for unfamiliar/large files, and exact dev_source_read(action:"read", start_line, num_lines) only when grep/edit output is not enough. After approval, prefer dev_source_edit(action:"patchset") for grouped src/web-ui edits; it returns post-edit context. For normal workspace files, prefer workspace_read(action:"search"|"grep") before reads, then workspace_edit(action:"patchset") for grouped edits; keep reads line-windowed for one-off work.`,

  task: `TASK: task_control(action,...) — list/get/resume/rerun/pause/delete. task_control(list) returns active tasks AND cron jobs in one call. For agent-owned runs and paused subagent recovery chats use agent_run_ops(action:"list"|"get"|"recover"|"resume"|"rerun",...). Do NOT use read_file for task state.`,

  schedule: `SCHEDULE: schedule_job(action,...) — list/create/update/pause/resume/delete/run_now. Confirm before mutating.
By default, scheduled jobs are owned by Prometheus itself. Omit subagent_id/team_id for normal schedules. Use subagent_id only when the user explicitly asks for a subagent owner or the task truly needs a specialized delegated agent. Use team_id to schedule a managed team run: the team manager wakes first, derives the run from team goal/memory, and dispatches members. If ownership is ambiguous and delegation would materially change the workflow, ask whether the user wants Prometheus itself or a subagent/team to own it.
instruction_prompt must be FULLY SELF-CONTAINED — write as if briefing a fresh agent with zero context. Include: target URL/account, exact step-by-step actions, constraints, success criteria. Labels like "Post to X daily" are invalid — give the agent nothing to act on.`,

  browser_vision: `VISION MODE: Few DOM elements — canvas/WebGL/SPA. browser_vision_screenshot()→viewport PNG. browser_vision_click(x,y)→pixel coords from image. browser_vision_type(x,y,text)→focus+type. Vision screenshot is the primary source of truth in this mode. Workflow: screenshot → pick coords → click/type. Switch back to browser_click(@ref) when element count exceeds 10.`,

  shell: `SHELL/RUN COMMANDS: activate workspace_write before command/process work. Use workspace_run(action:"run", command) for bounded commands and workspace_run(action:"start", command) for dev servers, watchers, long builds, renders, or interactive CLIs; manage runIds with workspace_run(action:"status"|"log"|"wait"|"kill"|"submit"). Default permissions enforce capability-based tool and command approval gates. Lite permissions bypass generic approval pauses for non-elevated tools while hard-blocked dangerous commands, explicit final-action/dev-edit approvals, and administrator commands remain gated. On Windows, set elevated:true only when administrator rights are actually required. Every elevated command uses the existing approval card as a fresh one-shot Approve/Reject decision; goals, Lite mode, trusted commands, and saved permissions never bypass it. The administrator broker requires UAC once when first installed, then later approved commands run hands-free without per-command UAC. Elevated background/start commands are unsupported. Use browser_* for websites, desktop_* for UI interaction.`,

  memory: `MEMORY: memory_browse(file)→categories. memory_write(file,category,content)→add/update fact. memory_read(file)→full contents. file="user"|"soul"|"memory". Use user for user profile facts, soul for operating rules, memory for durable long-term context and decisions.
LONG-TERM RETRIEVAL: memory_search(query, mode?, ...filters)→SQLite/FTS/vector-ranked hits with operational/evidence layers, citations, authority, status, and source spans when available. memory_read_record(record_id)→full source record. memory_search_project(project_id, query) and memory_search_timeline(query, date_from?, date_to?) for scoped retrieval. memory_get_related(record_id) expands to connected context.
OBSIDIAN: Obsidian is an optional external app connector. After it is connected in the Connections panel and external_apps is active, connector_obsidian_status/connect_vault/sync/writeback link local vault notes into Prometheus as obsidian_note evidence. Notes tagged #prometheus/memory, #prometheus/decision, #prometheus/preference, #prometheus/rule, or with prometheus-memory frontmatter can be promoted into operational memory.
TRIGGERS: use retrieval when user asks about previous discussions, older decisions, historical project context, what changed over time, or "what did we decide" questions.
GRAPH/DIAGNOSTICS: memory_graph_snapshot() returns relation graph nodes/edges; memory_index_refresh() forces reindex from workspace/audit.
SEARCH MODES: quick(default)=fast focused retrieval; deep=broad recall; project=project-scoped; timeline=chronological history.`,

  integrations: `INTEGRATIONS: connection_ops is the required normal setup path for connectors, MCP, APIs, CLIs, local resources, and model endpoints. Call discover with the user's natural service name, then plan/connect using the canonical match; unknown services return research_required so research official sources and pass only validated official metadata. Reuse/resume durable attempts and their user-action cards. Never request secrets in chat. Do not claim OAuth started unless the stored attempt is awaiting_oauth with an authorization action; do not claim connected or tools ready until verify returns connected. mcp_server_manage is advanced admin/debug only and must not bypass connection_ops for ordinary setup.`,

  media_assets: `MEDIA ASSETS: download_url(url,filename?) and download_media(url,audio_only?) retrieve remote assets. download_url auto-rewrites GitHub blob URLs to raw files. For a git/GitHub REPO (URL or owner/repo), use clone_repo(repo,paths?) to pull the whole repo or only specific files/dirs into the workspace (repos/<name>) — never fetch individual file URLs and re-type their contents. analyze_image/analyze_video inspect uploaded or downloaded media. Use browser_automation for browser-triggered downloads and media_assets for direct URL/media processing.`,

  media_quality: `MEDIA QUALITY: image_check_contrast, image_check_text_overflow, image_detect_empty_regions, image_get_bounds_summary, image_get_element_at_point, image_get_overlaps, video_render_frame, video_render_contact_sheet, video_check_audio_sync, and video_check_caption_timing validate visual/video output. Activate when checking layout polish, frame rendering, captions, or audio timing.`,

  automations: `AUTOMATIONS: schedule_job is core for normal list/create/update/pause/resume/delete/run_now. Activate automations for deeper operator tools: schedule_job_detail/history/log_search/outputs/patch/stuck_control inspect and repair scheduled runs; automation_dashboard returns a unified operator snapshot. prometheus_thread_ops controls other first-class Prometheus chat sessions: find/read/create/create_many/send/steer/interrupt/rename/pin/follow. Use create_many with follow=true when splitting work into independently visible threads that should continue in Goal mode and report back here. These are Prometheus sessions, not subagents or Codex threads. Confirm before mutating existing jobs. Prompts and new-thread objectives must be self-contained for a fresh session.`,

  external_apps: `EXTERNAL APPS: connector_list is core for discovery. Activating external_apps loads wrapper-first connected app tools. For X/Twitter and xAI/Grok use x_search_ops, x_posts, x_users, x_lists, x_dm, and x_admin. For Vercel use vercel_ops. Other connected app tools may still appear directly from their connectors. Check connector_list first when connection status matters.`,

  social_intelligence: `SOCIAL INTELLIGENCE: social_intel(platform, handle, mode?) analyzes social profiles and persists structured findings under entities/social. Use for profile metrics, engagement analysis, growth trajectory, and content recommendations.`,

  proposal_admin: `PROPOSAL ADMIN: edit_proposal updates pending proposals before approval. Use only for proposal metadata/details/diff revisions, not for executing source edits directly.`,

  mcp_server_tools: `MCP SERVER TOOLS: dynamic tools from connected MCP servers appear as mcp__serverId__toolName. Use mcp_server_manage(action:"list_tools") or integration_admin first when you need to inspect available MCP tools. Use only trusted connected servers.`,

  creative_mode: `CREATIVE TOOLS: wrapper-first editable Creative editor tools. Use creative_project for mode/state/history/project/export, creative_scene for canvas/scene/element/style operations, creative_image_ops for image assets/generation/layers/icons, creative_video_ops for shots/audio/timeline/composition/rendering, creative_hyperframes_ops for HyperFrames/HTML Motion, and creative_quality_ops for QA/layout/frame/text checks. Use Creative/HyperFrames skills for workflow guidance. Workspace selection is editor state, not an assistant runtime mode. Use generate_image/generate_video for one-shot AI media without opening an editable workspace.`,

  debug: isPublicDistributionBuild()
    ? `DEBUG: Use workspace files, logs, audit records, generated artifacts, and visible runtime state to diagnose issues in the public app build. Do not assume Prometheus source or dev-only self reference files are available.`
    : `DEBUG: For Prometheus internal/runtime errors, inspect self/index.md first, then use workspace logs/audit when relevant: workspace_read(action:"list", path:"audit"), workspace_read(action:"search", directory:"audit", pattern:...), and workspace_read(action:"read", path:...) on specific transcripts, task records, or compaction summaries. For Prometheus source errors in dev/private builds, use dev_source_read(action:"read"|"grep", surface:"src"|"web-ui", ...) for source errors. For running compiled-backend mismatches, compare src/ with dist/ through dev_source_read(surface:"prom-root") when available.`,

  agents: `AGENTS: chat_with_subagent(agent_id,message) is core for normal persistent chat/check-ins with a standalone non-team subagent. agent_run_ops(action,...) is core for existing agent-owned task runs and recovery chats. Activate agents_and_teams for wrappers: agent_ops(action:"list"|"info"|"spawn"|"update"|"delete"|"deploy_analysis_team"), agent_chat_ops(action:"talk"|"message"|"send"|"turn_request"|"reply_wait"|"thread_watch"), team_ops_wrapper(action:"manage"|"delete"|...), and team_collab_ops(...).
RULES: Use chat_with_subagent for Home-thread check-ins, status questions, planning, or casual collaboration when you know the agent_id. Use agent_run_ops(action:"list"|"get") to inspect existing subagent runs and agent_run_ops(action:"recover") to talk back and forth in a paused/stalled/failed run's recovery chat. Use agent_run_ops(action:"resume"|"rerun") only after an explicit recovery decision. Activate agents_and_teams and call agent_ops(action:"list") first when you need to discover/inspect/create agents. Use agent_chat_ops(action:"message") only when you want a new background task handoff whose working conversation/result stays in the subagent task panel.`,

  teams: `TEAMS: ask_team_coordinator(goal, context?) for multi-agent team work. spawn_subagent() for single standalone agent tasks.
WHEN TO USE EACH:
  → chat_with_subagent: core direct chat/check-in with a known standalone non-team agent
  → agent_ops/agent_chat_ops: agents_and_teams category; create/run one standalone non-team agent, focused task, or background handoff
  → ask_team_coordinator: multiple agents needed, parallel workstreams, complex goal that benefits from roles (planner+builder+verifier etc.)
TEAM OPS: Do NOT call granular team_manage directly from main chat. Use ask_team_coordinator for normal managed team work; use team_ops_wrapper/team_collab_ops only when you intentionally need lower-level managed-team operations.`,

  skills: `SKILLS (catalog + maintenance — routing rule lives in the [SKILLS] block): skills are living, reusable workflow playbooks, and the goal is to have one for essentially every workflow. Core skill tools are only skill_list and skill_read. For maintenance, first activate the skills category, then use skill_ops. After finishing real work (a multi-step task, a tricky fix, or any non-trivial workflow), maintain the system while evidence is fresh — update an outdated/incomplete/wrong skill in the same turn with skill_ops(action:"resource_write"|"resource_delete"|"update_metadata"|"manifest_write"), or create one if a reusable workflow had no fit with skill_ops(action:"create_bundle") for resource/template/example/schema-heavy skills or skill_ops(action:"create") for a one-file playbook. CRITICAL on create/update: set accurate trigger words/metadata — the kinds of requests that should surface this skill — so it auto-matches next time the same kind of work comes up. For trigger-only fixes, prefer skill_ops(action:"update_metadata", id, addTriggers) so existing triggers are preserved instead of rebuilding/replacing the whole skill. Load bundle resources only as needed via skill_ops(action:"resource_list", id) / skill_ops(action:"resource_read", id, path); add focused files under examples/templates/schemas/prompts/references rather than bloating SKILL.md. Don't force maintenance chatter into casual replies; an unmaintained or missing skill is a liability.`,

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
  creative_basic: TOOL_BLOCKS.creative_mode,
  creative_image: TOOL_BLOCKS.creative_mode,
  creative_video: TOOL_BLOCKS.creative_mode,
  creative_hyperframes: TOOL_BLOCKS.creative_mode,
  creative_quality: TOOL_BLOCKS.media_quality,
  skills: TOOL_BLOCKS.skills,
  model_management: 'MODEL MANAGEMENT: get/set agent model defaults and manage reusable agent model templates. switch_model and set_current_model are core; activate only for agent fleet model administration.',
  business: 'BUSINESS: list/read/write structured business entities and append entity events for clients, contacts, projects, vendors, and social accounts. business_context_mode is core for BUSINESS.md injection.',
};

// ─── buildToolsContext ────────────────────────────────────────────────────────
// Builds the [TOOLS] system prompt block dynamically based on activated categories.
// Base: compact category menu. Expands with policy text as categories are activated.

const TOOL_CATEGORY_MATCH_HINTS: Record<string, string> = {
  browser_automation: 'control and inspect browser pages with browser_session, browser_observe, browser_act, and browser_extract wrappers.',
  desktop_automation: 'control and inspect OS windows/apps with desktop_screen, desktop_apps, desktop_window, desktop_input, desktop_macro, and desktop_background wrappers.',
  agents_and_teams: 'list/create/update subagents with agent_ops, use agent_chat_ops, team_ops_wrapper, team_collab_ops, managed team tools, dispatch work, or background agent handoff tools. For normal known-agent chat, chat_with_subagent is core and does not need this category.',
  prometheus_source_read: 'inspect Prometheus app/source files with dev_source_read plus shared search_files/read_files_batch/file_tree helpers for src/ and web-ui/.',
  prometheus_source_write: 'edit Prometheus app/source files after approval with dev_source_edit; use request_dev_source_edit or an approved code_change proposal first.',
  social_intelligence: 'run social_intel for social profile metrics, engagement/growth analysis, and content recommendations.',
  proposal_admin: 'use edit_proposal to revise pending proposal metadata/details/diffs before approval.',
  mcp_server_tools: 'use dynamic mcp__server__tool functions exposed by connected MCP servers; inspect/setup servers with integration_admin first when needed.',
  composite_tools: 'manage or run saved multi-step tools: create_composite, get_composite, edit_composite, delete_composite, list_composites, plus saved composite tool names.',
  creative_basic: 'use creative_project and creative_scene wrappers for canvas/editor controls, scene, element, style, export, undo/redo, and project state work.',
  creative_image: 'use creative_image_ops for image/asset/layer/generation work, reusable assets, cutouts, icons, and image-derived scenes.',
  creative_video: 'use creative_video_ops for video, shot, storyboard, audio, caption, sequence, timeline, and composition work.',
  creative_hyperframes: 'use creative_hyperframes_ops for HyperFrames and HTML motion clip/template tools for source-backed animated videos.',
  creative_quality: 'use creative_quality_ops for frame renders, layout checks, text fit, contrast, overlaps, timing, and clip validation.',
  skills: 'author and maintain reusable skills with skill_ops: create/create_bundle, import/export/update bundles, update_metadata, manifest_write, resource read/write/delete/list, inspect, audit_all, and repair_metadata. Core skill tools are only skill_list and skill_read.',
  model_management: 'administer agent model routing/templates: get_agent_models, set_agent_model, list/save/update/apply/select/delete agent model templates.',
  business: 'manage structured entity files: list_entities, read_entity, write_entity, and append_entity_event for clients, contacts, projects, vendors, and social accounts.',
};

function buildToolCategoryMatchContext(messageText: string, activatedCategories: Set<string>): string {
  const detected = detectToolCategories(messageText);
  const allowed = new Set(getPublicBuildAllowedCategories(Object.keys(TOOL_CATEGORY_MATCH_HINTS) as any));
  const lines: string[] = [];
  for (const category of Object.keys(TOOL_CATEGORY_MATCH_HINTS)) {
    if (!detected.has(category)) continue;
    if (!allowed.has(category)) continue;
    if (activatedCategories.has(category)) continue;
    lines.push(
      `The user message may need category: ${category}.`,
      `Use request_tool_category({"category":"${category}","scope":"turn"}) if you need tools to ${TOOL_CATEGORY_MATCH_HINTS[category]}`,
      'Do not activate it if core tools are enough. Use scope=session only for explicit ongoing workflows.',
    );
  }
  return lines.length ? `[TOOL_CATEGORY_MATCH]\n${lines.join('\n')}` : '';
}

const BG_AGENT_RUNTIME_HINT = `BACKGROUND AGENTS: background_ops(action:"spawn", prompt) runs a full parallel agent that does real work and reports back. Reach for it proactively — it is a primary tool, not a last resort. Two patterns to default to:
  1) INVESTIGATE-FIRST: before committing to a multi-step path, an uncertain change, or a big answer, spawn an agent to dig in and report findings, then act on what it returns. e.g. "Let me investigate this properly" → background_ops({action:"spawn", prompt:"self-contained research/scan task"}) → proceed once it reports back. Prefer this over guessing or doing a long serial investigation inline.
  2) PARALLELIZE: when a piece of work is independent of what you're doing right now, spawn it to run concurrently instead of serially — gather data, scan the repo, run a web lookup, write a file, update memory, or prep one thing while you do another (e.g. browse a site while an agent builds a file). Don't do independent work one-at-a-time when it can overlap.
prompt MUST be fully self-contained: include exact paths, URLs, context, and instructions — the spawned agent has no access to "the conversation". The finalization gate waits for and merges same-turn background_ops spawn results before your final reply. Use background_ops(action:"wait", wait_ms) to intentionally pause the foreground turn while spawned agents finish before you continue. Don't call background_ops action="join"/"status" unless explicitly needed. Legacy background_* tools remain executable compatibility aliases but are hidden from the normal schema surface. Spawned agents plan with bg_plan_declare/bg_plan_advance.`;

export function buildToolsContext(activatedCategories: Set<string>, options?: { instructionIntents?: Stage4InstructionIntents }): string {
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

  const runtimeCategoryDefs: Array<[string, string]> = TOOL_CATEGORY_MENU_ORDER.map((id) => [
    id,
    `${id} (${TOOL_CATEGORY_MANIFEST[id].menuLabel})`,
  ]);
  const allowedCategoryIds: Set<string> = new Set(getPublicBuildAllowedCategories(TOOL_CATEGORY_MENU_ORDER));
  const categoryMenu = runtimeCategoryDefs
    .filter(([id]) => allowedCategoryIds.has(id))
    .map(([, label]) => label)
    .join(' | ');

  const legacyMenu = `[TOOLS] Core tools loaded (file read/search, web, basic memory, skill_list/skill_read only for core skill discovery, tasks, schedule_job, switch_model, set_current_model, update_heartbeat, write_proposal, ask_team_coordinator). Activate additional categories as needed:
  ${categoryMenu}
  Preferred category IDs are the names in the menu above; legacy IDs like browser, file_ops, team_ops, connectors, and mcp still work as aliases.
  Use: request_tool_category({"category":"browser_automation","scope":"turn"}) for the current user turn. Use scope=session only for explicit ongoing workflows; scope=next_turn keeps it through one follow-up turn; scope=ttl with turns keeps it for a bounded multi-turn workflow.

[FILE EDIT ROUTING] For workspace edits, activate/use workspace_write/file_ops. Use workspace_read(action:"grep"/"search"/"stats"/"read") when locating or understanding the target; if an exact file plus exact snippet/line range is already known, use workspace_edit(action:"find_replace"/"replace_lines"/"insert_after"/"delete_lines"/"patchset") directly. For obvious small single-file edits or bug fixes, do not call skill_list/skill_read just because broad file/frontend skills match; read a skill only when the user explicitly asks, the workflow is unfamiliar/high-risk, or the skill is needed for a specific non-obvious procedure. Edit tools fail safely and return post-edit context. Do not use workspace_run/terminal/Python/PowerShell/sed/node scripts as the default file editor.

[RUN COMMAND ROUTING] For shell/dev-server/process work, activate workspace_write. Use workspace_run(action:"run", command) for bounded commands; use workspace_run(action:"start", command) for long-running or interactive commands; manage runIds with workspace_run(action:"status"|"log"|"wait"|"kill"|"submit").

[PROPOSAL LANES] When using write_proposal, set execution_mode explicitly:
- code_change: Prometheus dev self-edit only. Use only for exact src/ and/or web-ui/ affected_files, include execution_steps, executor_prompt, risk_tier, and required src proposal headings. Do not use code_change for prom-root/config/build scripts unless the proposal lane explicitly supports that scope.
- action: approve and perform/trigger/create something exactly once. Use for team starts, scheduled runs, artifacts, and bounded workflows. Include 3-7 execution_steps and requires_build=false.
- review: read-mostly verification/audit/report. Do not mutate unless the proposal explicitly approves that exact mutation. Include evidence/resource refs and 3-7 execution_steps.

[SEARCH] Providers: ${searchProviders}.
WHEN: freshness (today/latest/current/price), high-stakes facts, named entity lookup, uncertainty ("not sure if…"). Skip for timeless well-known facts.
SHOPPING: for products, shopping comparisons, prices, ratings, or product carousels, call shopping_search_products first. It uses the existing web search/fetch stack and emits carousel-ready product cards without requiring shopping API keys. Use browser tools only to fill missing fields, inspect a JS-heavy page, or verify a specific product visually.
VISUAL SOURCES: after research, call show_sources with the real source URLs and all metadata already returned. Missing title/publisher/snippet/date/image fields are enriched from the pages and discovered images are cached locally.
HOW: complex topics → call web_search 2–3× with different angles (not the same query twice). Scan snippets → web_fetch the 1–3 most relevant URLs. Add site:domain.com to target a source.
FETCH STRATEGY: web_fetch for static articles/docs (fast). browser_get_page_text for JS-heavy/login-gated pages (slower, use when web_fetch returns empty/broken).
ITERATE: if first search misses, rephrase the query or try a broader/narrower angle before giving up.
For broad coverage use web_search(..., provider:"multi") or web_search(..., multi_engine:true). For provider checks use web_search(query, provider:"tinyfish"|"tavily"|"google"|"brave"|"ddg"|"xai") and inspect provider metadata/banner; do not use site:google-owned domains as provider proof.

[WRITE NOTE] write_note(content, tag?) is always available — use it to preserve context between sessions.
WHEN TO WRITE: something was discussed, decided, or discovered that future sessions should know about; a file/task/plan step completed; data gathered from browser/desktop/API mid-task.
SKIP: casual chat, greetings, simple Q&A, turns where nothing actionable happened.
SPEED RULE: if write_note is the only action in your turn, call switch_model('low') first — it reverts automatically after.
DURING PLANS/TASKS: write a note at each meaningful step — capturing gathered data, intermediate results, or blockers keeps context recoverable if the task is interrupted.

[MEMORY CONTINUITY] Memory search is Prometheus' long-term recall. Use memory_search before answering from memory when the user asks about previous discussions, decisions, recurring preferences, project history, older tasks, "what did we decide", "what happened before", or any answer that depends on continuity. Use memory_read_record for important hits and memory_get_related to expand useful context. Use memory_search_timeline when chronology matters.

[BUSINESS CONTEXT] BUSINESS.md is available but not auto-injected by default. Use business_context_mode({"action":"enable"}) when ongoing work needs persistent business/company context across this session. Use "status" to check the mode and "disable" to turn it back off. Enabling returns the current BUSINESS.md snapshot immediately so you can use it in the same turn. Business entity tools are core: list_entities(type?), read_entity(type,id), write_entity(type,id,content), append_entity_event(type,id,event,display_name?,source?,confidence?). Use entities for clients, contacts, projects, vendors, and social accounts; use BUSINESS.md for company-level profile, offers, policies, and priorities.

[TEAMS & AGENTS] Agent/task routes — pick the right one:
  → chat_with_subagent(id,message) — core normal persistent chat/check-in with a known standalone non-team agent.
  → agent_run_ops(action:"list"|"get"|"recover"|"resume"|"rerun",...) — core existing subagent/team-agent run inspection and task recovery chat. Use recover to talk in recovery mode; do not use Home chat for paused runs.
  → spawn_subagent('id', task, ...) — create/run one standalone non-team agent. message_subagent(id,message) — background handoff; returns task_id and keeps the conversation/result in the subagent task panel. agent_message_send/agent_turn_request/agent_reply_wait — lower-level mailbox/reply workflows. These require agents_and_teams/team_ops category.
  → ask_team_coordinator(goal) — always available (core). Multi-agent teams with roles. Use when: parallel workstreams, multiple specializations needed, or task is too large for one agent context.
Do NOT call team_manage directly. reply_to_team(team_id, msg) is the only direct team call — use only when a coordinator is waiting on your reply.

[MODEL ROUTING] Default: primary model (powerful, for complex work). Call switch_model(tier, reason) EARLY when the task is clearly lighter.
  → If the user asks to change the AI's current/live primary model, call set_current_model("provider/model"). Do not use set_agent_model for that; set_agent_model is only for future-agent defaults/routes.
  → 'low' (speed): single command, file read/summary, write_note only, quick lookups.
  → 'medium' (careful): multi-step analysis or structured work that doesn't need full primary model power.
  → Stay on primary: ${isPublicDistributionBuild() ? 'proposal work, deep reasoning, auth/security/build, anything expensive if wrong.' : 'src/ edits, proposals, deep reasoning, auth/security/build, anything expensive if wrong.'}
  → Mixed intent rule: if a turn contains BOTH memory work (memory_write/write_note) and a separate actionable task, prefer background_ops(action:"spawn") for the memory sidecar so primary execution continues in parallel.
  → If you choose not to spawn and you used switch_model for a memory side action, continue executing the user's remaining task in the same turn (do not stop after memory).
  Auto-reverts after turn end — never switch back manually.

${BG_AGENT_RUNTIME_HINT}`;
  const fallbackIntents: Stage4InstructionIntents = {
    file_edit_intent: true,
    command_execution_intent: true,
    proposal_workflow_intent: true,
    web_research_intent: true,
    business_context_intent: true,
    reasons: {},
  };
  const stage4Intents = options?.instructionIntents || fallbackIntents;
  const sectionBounds: Array<[Stage4MenuSegmentId, string, string]> = [
    ['tools.file_edit_routing', '[FILE EDIT ROUTING]', '[RUN COMMAND ROUTING]'],
    ['tools.run_command_routing', '[RUN COMMAND ROUTING]', '[PROPOSAL LANES]'],
    ['tools.proposal_lanes', '[PROPOSAL LANES]', '[SEARCH]'],
    ['tools.search_strategy', '[SEARCH]', '[WRITE NOTE]'],
    ['tools.business_context', '[BUSINESS CONTEXT]', '[TEAMS & AGENTS]'],
  ];
  let menu = legacyMenu;
  for (const [id, startHeading, nextHeading] of sectionBounds) {
    if (resolveStage4MenuSegmentDecision(id, stage4Intents).included) continue;
    const start = menu.indexOf(`\n\n${startHeading}`);
    const end = menu.indexOf(`\n\n${nextHeading}`, Math.max(0, start + 2));
    if (start >= 0 && end > start) menu = menu.slice(0, start) + menu.slice(end);
  }
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
    const policy = CATEGORY_POLICIES[cat];
    if (!policy) continue;
    const mode = getInstructionResolverMode();
    const pilotDecision = resolveStage3PilotPolicyDecision(cat, activatedCategories);
    if (mode === 'pilot' && pilotDecision.pilotCategory) {
      if (pilotDecision.included) activePolicies.push(policy);
      continue;
    }
    // legacy and shadow preserve the existing builder. Non-pilot categories
    // remain on the existing path in every mode during Stage 3.
    activePolicies.push(policy);
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
  if ((getSessionSkillWindowsFn as unknown) instanceof Set || getSessionSkillWindowsFn == null) {
    options = (setCurrentTurn && typeof setCurrentTurn === 'object' && !((setCurrentTurn as unknown) instanceof Set))
      ? (setCurrentTurn as unknown as BuildPersonalityContextOptions)
      : options;
    extraCats = (getSessionSkillWindowsFn as unknown) instanceof Set ? getSessionSkillWindowsFn as unknown as Set<string> : extraCats;
    getSessionSkillWindowsFn = (() => new Map<string, SkillWindow>()) as any;
    setCurrentTurn = (() => {}) as any;
  } else if (typeof setCurrentTurn !== 'function') {
    setCurrentTurn = (() => {}) as any;
  }
  const profile = options?.profile || 'default';
  const skillContextOptions = {
    sessionId,
    excludedSkillIds: options?.excludedSkillIds || [],
    forcedSkillIds: options?.forcedSkillIds || [],
  };

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
    const selectedSkillCtxLocal = skillsManager.buildTurnContext(messageText, skillContextOptions);
    const activeSkillCtxLocal = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return buildLocalModelPersonalityCtx(timeString, userMemory)
      + (business ? `\n\n[BUSINESS]\n${business}` : '')
      + (selectedSkillCtxLocal ? `\n\n${selectedSkillCtxLocal}` : '')
      + (activeSkillCtxLocal ? `\n\n${activeSkillCtxLocal}` : '');
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
    const toolCategoryMatchTeach = buildToolCategoryMatchContext(messageText, activatedCatsTeach);
    const skillCtxTeach = skillsManager.buildTurnContext(messageText, skillContextOptions);
    const activeSkillCtxTeach = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        user ? `[USER]\n${user}` : '',
        soul ? `[SOUL]\n${soul}` : '',
        buildToolsContext(activatedCatsTeach, { instructionIntents: options?.instructionIntents }),
      ],
      [toolCategoryMatchTeach, skillCtxTeach, activeSkillCtxTeach],
    );
  }

  const isDirectSubagentProfile = profile === 'direct_subagent';
  const runtimeActor = getRuntimeActorContext(sessionId);
  const isScheduledAgentActor = executionMode === 'cron' && runtimeActor?.kind === 'agent';
  const isInteractiveAgentSwitch = profile === 'switch_model'
    && executionMode === 'interactive'
    && runtimeActor?.kind === 'agent';
  // Main-chat memory retrieval is never inherited by a subagent runtime. A
  // subagent may still use an explicitly available memory tool when its task
  // calls for it, but no user/main memory is silently injected into its prompt.
  const allowLongTermSearch = executionMode === 'interactive' && !isDirectSubagentProfile && runtimeActor?.kind !== 'agent' && runtimeActor?.kind !== 'manager';
  const memorySearchRouting = allowLongTermSearch
    ? routeMemorySearchMode(messageText)
    : ({ mode: 'no_search', reason: 'execution_mode_skip' } as MemorySearchRouting);
  const retrievedMemoryCtx = allowLongTermSearch
    ? buildRetrievedMemoryContext(workspacePath, messageText, memorySearchRouting)
    : '';
  const cisContext = buildCisContextBlock(workspacePath, messageText, { force: isBusinessContextEnabled(sessionId) });
  const configSoul = loadSoul();

  if (profile === 'voice_agent') {
    const voiceSoulContract = loadVoiceSoul();
    const user = loadFullMemoryProfile(workspacePath, 'USER.md');
    const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md');
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
    const skillCtx = skillsManager.buildTurnContext(messageText, skillContextOptions);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        voiceSoulContract ? `[VOICE_SOUL]\n${voiceSoulContract}` : '',
        user ? `[USER]\n${user}` : '',
        soul ? `[SOUL]\n${soul}` : '',
        projectContextBlock ? `[PROJECT_CONTEXT]\n${projectContextBlock}` : '',
        boot ? `[BOOT_MD - operational startup/workspace guidance, read-only]\n${boot}` : '',
        selfIndex ? `[SELF_INDEX]\n${selfIndex}` : '',
        voiceSelf ? `[SELF_VOICE_SECTION]\n${voiceSelf}` : '',
      ],
      [
        retrievedMemoryCtx,
        referenceHint,
        skillCtx,
        activeSkillCtx,
      ],
    );
  }

  // A model switch starts a fresh generation, but it must not turn a named
  // agent/manager into main Prometheus by reloading Prom's USER/SOUL/MEMORY.
  if (profile === 'switch_model' && runtimeActor?.kind !== 'agent' && runtimeActor?.kind !== 'manager') {
    const user = loadFullMemoryProfile(workspacePath, 'USER.md');
    const soul = loadFullMemoryProfile(workspacePath, 'SOUL.md');
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    const memory = loadFullMemoryProfile(workspacePath, 'MEMORY.md');
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
    const toolCategoryMatchSwitch = buildToolCategoryMatchContext(messageText, activatedCatsSwitch);
    const skillCtx = skillsManager.buildTurnContext(messageText, skillContextOptions);
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
        buildToolsContext(activatedCatsSwitch, { instructionIntents: options?.instructionIntents }),
      ],
      [cisContext, retrievedMemoryCtx, toolCategoryMatchSwitch, skillCtx, activeSkillCtx],
    );
  }
  if (isDirectSubagentProfile || isScheduledAgentActor || isInteractiveAgentSwitch) {
    const runtimeContract = loadPrometheusRuntimeContract();
    const agentMemory = loadRuntimeActorMemoryContext(sessionId);
    const activatedCatsDirectSub = getActivatedToolCategories(sessionId);
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsDirectSub.add('browser');
        else activatedCatsDirectSub.add(ec);
      }
    }
    const toolCategoryMatchDirectSub = buildToolCategoryMatchContext(messageText, activatedCatsDirectSub);
    const skillCtx = skillsManager.buildTurnContext(messageText, skillContextOptions);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        runtimeContract ? `[PROMETHEUS_RUNTIME_CONTRACT]\n${runtimeContract}` : '',
        agentMemory ? `[AGENT_MEMORY - PRIVATE TO THIS AGENT]\nUse memory_read/memory_write with file="memory" for this file. USER/SOUL memory belongs to main Prometheus and is unavailable here.\n${agentMemory}` : '',
        buildToolsContext(activatedCatsDirectSub, { instructionIntents: options?.instructionIntents }),
      ],
      [
        toolCategoryMatchDirectSub,
        skillCtx,
        activeSkillCtx,
      ],
    );
  }

  // ── Path SUB: background/team subagents ────────────────────────────────────
  // Distinct agents receive the shared runtime contract, their private memory,
  // and their role/task context from callerContext.
  // They intentionally do not receive main Prometheus SOUL.md/config soul.
  if (executionMode === 'background_agent') {
    const runtimeContract = loadPrometheusRuntimeContract();
    const agentMemory = loadRuntimeActorMemoryContext(sessionId);
    const activatedCatsBackground = getActivatedToolCategories(sessionId);
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsBackground.add('browser');
        else activatedCatsBackground.add(ec);
      }
    }
    const toolCategoryMatchBackground = buildToolCategoryMatchContext(messageText, activatedCatsBackground);
    const skillCtx = skillsManager.buildTurnContext(messageText, skillContextOptions);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    const referenceHintBackground = isPublicDistributionBuild()
      ? ''
      : `[REFERENCE_FILES] Architecture/debug context: self/index.md is the canonical workspace-root map; use workspace_read(action:"read", path:"self/index.md"). Follow its links to focused self/* subsystem files as needed.`;
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        messageText ? `[Spawning Prompt from the Main Agent (or whomever is spawning it)]\n${messageText}` : '',
        runtimeContract ? `[PROMETHEUS_RUNTIME_CONTRACT]\n${runtimeContract}` : '',
        agentMemory ? `[AGENT_MEMORY - PRIVATE TO THIS AGENT]\nUse memory_read/memory_write with file="memory" for this file. USER/SOUL memory belongs to main Prometheus and is unavailable here.\n${agentMemory}` : '',
        buildToolsContext(activatedCatsBackground, { instructionIntents: options?.instructionIntents }),
      ],
      [
        toolCategoryMatchBackground,
        referenceHintBackground,
        skillCtx,
        activeSkillCtx,
      ],
    );
  }

  if (executionMode === 'team_subagent') {
    const runtimeContract = loadPrometheusRuntimeContract();
    const agentMemory = loadRuntimeActorMemoryContext(sessionId);
    const activatedCatsSub = getActivatedToolCategories(sessionId);
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsSub.add('browser');
        else activatedCatsSub.add(ec);
      }
    }
    const toolCategoryMatchSub = buildToolCategoryMatchContext(messageText, activatedCatsSub);
    const skillCtx = skillsManager.buildTurnContext(messageText, skillContextOptions);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    const referenceHintSub = isPublicDistributionBuild()
      ? ''
      : `[REFERENCE_FILES] Architecture/debug context: self/index.md is the canonical workspace-root map; use workspace_read(action:"read", path:"self/index.md"). Follow its links to focused self/* subsystem files as needed.`;
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        runtimeContract ? `[PROMETHEUS_RUNTIME_CONTRACT]\n${runtimeContract}` : '',
        agentMemory ? `[AGENT_MEMORY - PRIVATE TO THIS AGENT]\nUse memory_read/memory_write with file="memory" for this file. USER/SOUL memory belongs to main Prometheus and is unavailable here.\n${agentMemory}` : '',
        buildToolsContext(activatedCatsSub, { instructionIntents: options?.instructionIntents }),
      ],
      [
        toolCategoryMatchSub,
        referenceHintSub,
        skillCtx,
        activeSkillCtx,
      ],
    );
  }

  // Team managers are distinct named agents. They receive their own identity
  // from callerContext and their own memory here, never Prom's USER/SOUL/MEMORY.
  if (executionMode === 'team_manager') {
    const runtimeContract = loadPrometheusRuntimeContract();
    const agentMemory = loadRuntimeActorMemoryContext(sessionId, 8000);
    const activatedCatsManager = getActivatedToolCategories(sessionId);
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsManager.add('browser');
        else activatedCatsManager.add(ec);
      }
    }
    const toolCategoryMatchManager = buildToolCategoryMatchContext(messageText, activatedCatsManager);
    const skillCtx = skillsManager.buildTurnContext(messageText, skillContextOptions);
    const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return assembleContext(
      [
        runtimeContract ? `[PROMETHEUS_RUNTIME_CONTRACT]\n${runtimeContract}` : '',
        agentMemory ? `[AGENT_MEMORY - PRIVATE TO THIS MANAGER]\nUse memory_read/memory_write with file="memory" for this private file. Shared team truth belongs in team memory.json. USER/SOUL memory belongs to main Prometheus and is unavailable here.\n${agentMemory}` : '',
        buildToolsContext(activatedCatsManager, { instructionIntents: options?.instructionIntents }),
      ],
      [toolCategoryMatchManager, skillCtx, activeSkillCtx],
    );
  }

  // ── Path B: autonomous execution — full prompt, no changes ─────────────────
  // NOTE: 'cron' is intentionally NOT autonomous here — a Prometheus-owned scheduled
  // run gets its owner's normal (interactive/main-chat) stack. The lean "don't ask
  // questions, proceed" framing comes from the cron execution-mode block + the
  // [LAST RUN]/[SINCE LAST RUN] context injected into the run prompt, not from a
  // stripped personality.
  const isAutonomous = executionMode === 'background_task' || executionMode === 'proposal_execution' || executionMode === 'heartbeat';
  if (isAutonomous) {
    const isProposalExecution = executionMode === 'proposal_execution';
    const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
    const soul = isProposalExecution ? configSoul : loadFullMemoryProfile(workspacePath, 'SOUL.md');
    // Proposal executors get only the approved task context plus the configured
    // Prometheus soul. Workspace MEMORY.md is intentionally excluded here.
    const memory = isProposalExecution ? '' : loadFullMemoryProfile(workspacePath, 'MEMORY.md');
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
    const toolCategoryMatchAuto = buildToolCategoryMatchContext(messageText, activatedCatsAuto);
    const toolsBlockAuto = buildToolsContext(activatedCatsAuto, { instructionIntents: options?.instructionIntents });
    // Autonomous agents: same hint + pinned skills as interactive chat.
    const skillCtx = skillsManager.buildTurnContext(messageText, skillContextOptions);
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
        toolCategoryMatchAuto,
        intradayNotes ? `[TODAY_NOTES]\n${intradayNotes}` : '',
        skillCtx,
        activeSkillCtx,
      ],
    );
  }

  // ── Path A: interactive chat — tiered ─────────────────────────────────────
  const user = loadFullMemoryProfile(workspacePath, 'USER.md');
  const business = isBusinessContextEnabled(sessionId) ? loadBusinessContextProfile(workspacePath) : '';
  const memory = loadFullMemoryProfile(workspacePath, 'MEMORY.md');
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
    const toolCategoryMatchT1 = buildToolCategoryMatchContext(messageText, activatedCatsT1);
    // First turn: still get the skills hint + any pinned skills.
    const skillCtxT1 = skillsManager.buildTurnContext(messageText, skillContextOptions);
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
        buildToolsContext(activatedCatsT1, { instructionIntents: options?.instructionIntents }),
      ],
      [
        cisContext,
        retrievedMemoryCtx,
        toolCategoryMatchT1,
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
  const toolCategoryMatch = buildToolCategoryMatchContext(messageText, activatedCats);
  const toolsBlock = buildToolsContext(activatedCats, { instructionIntents: options?.instructionIntents });

  // Reference hints — Prom reads these files when actually needed rather than
  // injecting partial snippets based on keyword guesses.
  const referenceHint = isPublicDistributionBuild()
    ? ''
    : `[REFERENCE_FILES] Architecture/debug context: self/index.md is the canonical workspace-root map; use workspace_read(action:"read", path:"self/index.md"). Follow its links to focused self/* subsystem files as needed.`;

  // Skills: one-liner hint + any pinned skills injected in full.
  const skillCtx = skillsManager.buildTurnContext(messageText, skillContextOptions);
  const activeSkillCtx = buildActiveSkillsContext(sessionId, skillsManager);

  await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
  return assembleContext(
    [
      configSoul ? `[PROMETHEUS_SOUL]\n${configSoul}` : '',
      user ? `[USER]\n${user}` : '',
      soul ? `[SOUL]\n${soul}` : '',
      business ? `[BUSINESS]\n${business}` : '',
      memory ? `[MEMORY]\n${memory}` : '',
      buildSubagentsRosterBlock(),
      projectContextBlockT2 ? `[PROJECT_CONTEXT]\n${projectContextBlockT2}` : '',
      toolsBlock,
    ],
    [
      cisContext,
      retrievedMemoryCtx,
      toolCategoryMatch,
      intradayNotes ? `[TODAY_NOTES — read-only context, do NOT call write_note unless you complete something meaningful this turn]\n${intradayNotes}` : '',
      referenceHint,
      skillCtx,
      activeSkillCtx,
    ],
  );
}
