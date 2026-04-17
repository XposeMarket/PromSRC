// src/gateway/prompt-context.ts
// Full prompt context assembly — workspace memory, personality, tool hints, skill windows.
// Extracted from server-v2.ts (Step 12 of Phase 3 refactor).

import path from 'path';
import fs from 'fs';
import { hookBus } from './hooks';
import { SkillsManager } from './skills-runtime/skills-manager';
import { getConfig } from '../config/config';
import { getActivatedToolCategories } from './session';
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
  triggeredAtTurn: number;   // history.length when first enabled
  lastActiveAtTurn: number;  // history.length when skill_enable was last called
  reassessCount: number;     // consecutive reassessment turns without disable
}

export interface BuildPersonalityContextOptions {
  profile?: 'default' | 'switch_model' | 'local_llm';
}

// ─── buildBootStartupSnapshot ────────────────────────────────────────────────────
// Builds a pre-fetched runtime data snapshot for BOOT.md startup context.
// Takes listTasksFn as a dependency to avoid importing task-store here.
export function buildBootStartupSnapshot(
  workspacePath: string,
  listTasksFn: (opts: { status: string[] }) => Array<{ id: string; status: string; title: string; plan?: unknown[]; currentStepIndex?: number }>,
): string {
  const lines: string[] = [];
  lines.push(`workspace_path: ${workspacePath}`);

  try {
    const blocked = listTasksFn({ status: ['paused', 'stalled', 'needs_assistance'] }).slice(0, 12);
    if (blocked.length === 0) {
      lines.push('blocked_tasks: none');
    } else {
      lines.push('blocked_tasks:');
      for (const t of blocked) {
        const total = Math.max(1, Number(t.plan?.length || 0));
        const step = Math.min(total, Math.max(1, Number(t.currentStepIndex || 0) + 1));
        lines.push(`- [${t.id}] [${t.status}] ${t.title} (step ${step}/${total})`);
      }
    }
  } catch (err: any) {
    lines.push(`blocked_tasks: unavailable (${String(err?.message || err || 'unknown')})`);
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterdayDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const memDir = path.join(workspacePath, 'memory');

  // Read recent intraday notes (today then yesterday as fallback) for boot context.
  // These are the structured ### [TAG] entries written by write_note — the real signal.
  const todayIntraday = path.join(memDir, `${today}-intraday-notes.md`);
  const yesterdayIntraday = path.join(memDir, `${yesterday}-intraday-notes.md`);
  const intradayFileToRead = fs.existsSync(todayIntraday) ? todayIntraday : fs.existsSync(yesterdayIntraday) ? yesterdayIntraday : null;
  if (intradayFileToRead) {
    try {
      const intradayContent = fs.readFileSync(intradayFileToRead, 'utf-8').trim();
      const intradayFilename = path.basename(intradayFileToRead);
      lines.push(`recent_notes (${intradayFilename} — last 2000 chars):`);
      lines.push(intradayContent.slice(-2000));
    } catch {
      lines.push('recent_notes: unreadable');
    }
  } else {
    lines.push('recent_notes: none yet today');
  }

  try {
    const dirents = fs.readdirSync(workspacePath, { withFileTypes: true });
    const topFiles = dirents.filter(d => d.isFile()).map(d => d.name);
    const tmpFiles = topFiles.filter((f) => /_tmp(\.|$)/i.test(f)).slice(0, 20);
    lines.push(`tmp_files: ${tmpFiles.length ? tmpFiles.join(', ') : 'none'}`);

    const todoHead: string[] = [];
    for (const file of topFiles.slice(0, 200)) {
      try {
        const head = fs.readFileSync(path.join(workspacePath, file), 'utf-8')
          .split('\n')
          .slice(0, 5)
          .join('\n');
        if (/\bTODO\b/i.test(head)) {
          todoHead.push(file);
          if (todoHead.length >= 20) break;
        }
      } catch {
        // skip unreadable files
      }
    }
    lines.push(`todo_in_first_5_lines: ${todoHead.length ? todoHead.join(', ') : 'none'}`);
  } catch (err: any) {
    lines.push(`workspace_scan: unavailable (${String(err?.message || err || 'unknown')})`);
  }

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

function loadFullMemoryProfile(
  workspacePath: string,
  filename: 'USER.md' | 'SOUL.md' | 'MEMORY.md',
  maxChars?: number,
): string {
  try {
    const filePath = path.join(workspacePath, filename);
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const cleaned = stripMemoryToolHints(content);
    if (typeof maxChars !== 'number' || maxChars <= 0 || cleaned.length <= maxChars) return cleaned;
    return `${cleaned.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...[truncated]`;
  } catch {
    return '';
  }
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
  const FILES = ['read file', 'write file', 'edit file', 'create file', 'modify', 'replace', 'open file', 'delete file', 'rename', 'copy file', 'make a file', 'update the file', 'change the file', 'save to'];
  const TASK = ['task', 'background', 'run this', 'start a', 'status', 'paused', 'resume', 'in progress', 'what tasks', 'running tasks'];
  const SCHEDULE = ['schedule', 'every day', 'every week', 'at ', 'recurring', 'cron', 'automate', 'remind me', 'daily', 'weekly'];
  const SHELL = ['run command', 'execute', 'terminal', 'powershell', 'script', 'command line', 'cmd', 'bash'];
  // Much stricter MEMORY detection — only explicit memory operations, not casual conversation
  const MEMORY = ['remember this', 'note that', 'save that', 'write that down', 'dont forget', "don't forget", 'update my memory', 'add to my memory', 'save to memory', 'memory note', 'remember:', 'note:', 'update memory', 'memory write'];
  const DEBUG = ['why', 'error', 'failed', 'how does', 'architecture', 'debug', 'caused', 'broke', 'not working', 'explain how', 'whats wrong', "what's wrong"];
  const TEAMS = ['team', 'sub-team', 'sub team', 'managed team', 'team manager', 'team chat', 'team members'];
  const INTEGRATIONS = ['integration', 'integrations', 'mcp', 'model context protocol', 'webhook', 'supabase', 'connect service', 'connect to'];
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

  browser: `BROWSER: browser_open(url)→snapshot. browser_snapshot()→refresh. browser_vision_screenshot()→viewport image. browser_click(@ref). browser_fill(@ref,text). browser_press_key(key). browser_wait(ms). browser_get_page_text()→full text incl. iframes (use when <12 elements). browser_close(). Chrome persistent profile (pre-logged-in).
RULES: visual-first workflow. Vision screenshots are highest-confidence on dynamic/SPA UIs. If DOM refs or JS-derived assumptions are uncertain, stale, or contradictory, take a fresh browser_vision_screenshot and trust that evidence first. After browser actions, prefer a fresh browser_snapshot (or browser_vision_screenshot when UI is ambiguous) before the next decision. Treat browser_run_js as fallback for cases where snapshot/vision still cannot identify the target. Composer fills show "COMPOSER SUBMIT BUTTON: @N" — click it immediately, nothing else. j/k nav: call browser_get_focused_item after each keypress to confirm position. Use ⌨️ SITE SHORTCUTS when shown; save new ones with save_site_shortcut().`,

  desktop: `DESKTOP: desktop_get_monitors()→monitor indices+bounds. desktop_screenshot()→screen+monitors (capture=all|primary|monitor_index=N). desktop_window_screenshot(name|handle|active)→single app window crop. desktop_click(x,y) (supports monitor_relative+monitor_index). desktop_type/press_key. desktop_scroll/drag. desktop_find_window/focus_window. Clipboard get/set. Screenshot/get_monitors first; focus before click/type. After desktop actions, prefer another screenshot before choosing the next action when UI likely changed.`,

  files: isPublicDistributionBuild()
    ? `FILES: file_stats(path)→line count+size+modified (check this first on unknown files). read_file(path, start_line?, num_lines?)→windowed contents+line nums (e.g. start_line:200,num_lines:100 reads lines 200–300). grep_file(path, pattern, context_lines?)→matching lines in one file. search_files(directory?, pattern, file_glob?)→multi-file matches across workspace. find_replace/replace_lines/insert_after/delete_lines→edit. create_file/delete_file/mkdir/list_directory.
WORKSPACE ONLY: In the public app, file tools operate on the user workspace and generated app data only. Always read before editing.`
    : `FILES: file_stats(path)→line count+size+modified (check this first on unknown files). read_file(path, start_line?, num_lines?)→windowed contents+line nums (e.g. start_line:200,num_lines:100 reads lines 200–300). grep_file(path, pattern, context_lines?)→matching lines in one file. search_files(directory?, pattern, file_glob?)→multi-file matches across workspace. find_replace/replace_lines/insert_after/delete_lines→edit. create_file/delete_file/mkdir/list_directory.
SRC SURFACES (read-only for all): source_stats|src_stats (src/ file metadata), read_source|list_source|grep_source (src/). webui_source_stats|webui_stats (web-ui/ file metadata), read_webui_source|list_webui_source|grep_webui_source (web-ui/). Write (proposal/code_exec only): find_replace_source|replace_lines_source|insert_after_source|delete_lines_source|write_source for src/; *_webui_source for web-ui/.
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

  skills: `SKILLS: Before browser/desktop actions, file edits, or multi-step execution, call skill_list() first. If relevant, call skill_read(id) and follow it. For conversational replies, respond directly. skill_list/skill_read/skill_create are core tools (always available).`,

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
  browser: TOOL_BLOCKS.browser,
  desktop: TOOL_BLOCKS.desktop,
  team_ops: `${TOOL_BLOCKS.agents}\n\n${TOOL_BLOCKS.teams}`,
  scheduling: TOOL_BLOCKS.schedule,
  ...(isPublicDistributionBuild() ? {} : { source_write: `${TOOL_BLOCKS.files}` }),
  integrations: TOOL_BLOCKS.integrations,
  composites: 'COMPOSITES: Activate when the user wants to create, inspect, edit, delete, list, or run saved multi-step composite tools. Composite management tools are not core; request the composites category first.',
};

// ─── buildToolsContext ────────────────────────────────────────────────────────
// Builds the [TOOLS] system prompt block dynamically based on activated categories.
// Base: compact category menu. Expands with policy text as categories are activated.

const BG_AGENT_RUNTIME_HINT = `BACKGROUND AGENTS: background_spawn(task_prompt, id?) runs a parallel agent. Prefer spawning when work is independent and can run concurrently, especially for sidecar tasks (memory updates, repo scans, web lookups, data gathering) while you continue the primary flow. task_prompt must be fully self-contained (no references to "the conversation"). Don't call background_join/status unless explicitly needed — finalization gate auto-collects. Background agents use bg_plan_declare/bg_plan_advance for their own planning.`;

export function buildToolsContext(activatedCategories: Set<string>): string {
  // Build dynamic search provider summary inline (getConfig already imported at top of file)
  let searchProviders = 'DuckDuckGo (fallback)';
  try {
    const cfg = getConfig();
    const data = (cfg.getConfig() as any);
    const s = data.search || {};
    const preferred = String(s.preferred_provider || 'ddg').toLowerCase();
    const ps: string[] = [];
    if (s.tavily_api_key) ps.push(preferred === 'tavily' ? 'Tavily (primary)' : 'Tavily');
    if (s.google_api_key && s.google_cx) ps.push(preferred === 'google' ? 'Google (primary)' : 'Google');
    if (s.brave_api_key)  ps.push(preferred === 'brave'  ? 'Brave (primary)'  : 'Brave');
    ps.push(preferred === 'ddg' ? 'DuckDuckGo (primary)' : 'DuckDuckGo (fallback)');
    searchProviders = ps.join(', ');
  } catch { /* use default */ }

  const runtimeCategoryDefs: Array<[string, string]> = [
    ['browser', 'browser (20 tools)'],
    ['desktop', 'desktop (26 tools)'],
    ['team_ops', 'team_ops (19 tools)'],
    ['source_write', 'source_write (10 tools)'],
    ['integrations', 'integrations (5 tools)'],
    ['connectors', 'connectors (34 tools: Gmail, GitHub, Slack, Notion, Drive, Reddit, HubSpot, Salesforce, Stripe, GA4 — use connector_list to see what\'s connected)'],
    ['composites', 'composites (saved multi-step tools and composite management)'],
  ];
  const allowedCategoryIds = new Set(getPublicBuildAllowedCategories(runtimeCategoryDefs.map(([id]) => id)));
  const categoryMenu = runtimeCategoryDefs
    .filter(([id]) => allowedCategoryIds.has(id))
    .map(([, label]) => label)
    .join(' | ');

  const menu = `[TOOLS] Core tools loaded (file ops, web, memory, shell, skills via skill_list/skill_read/skill_create, tasks, schedule_job, switch_model, update_heartbeat, write_proposal, ask_team_coordinator). Activate additional categories as needed:
  ${categoryMenu}
  Use: request_tool_category({"category":"browser"}) — stays active for the whole session. Full reference: read_file('TOOLS.md')

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
    setCurrentTurn(sessionId, historyLength);
    await hookBus.fire({ type: 'agent:bootstrap', sessionId, workspacePath, bootstrapFiles: [], timestamp: Date.now() });
    return buildLocalModelPersonalityCtx(timeString, userMemory);
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
    if (extraCats) {
      for (const ec of extraCats) {
        if (ec === 'browser_vision' || ec === 'browser') activatedCatsTeam.add('browser');
        else activatedCatsTeam.add(ec);
      }
    }
    const parts = [
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
    : `[REFERENCE_FILES] Architecture/debug context: read_source('SELF.md'). Agent workspace context: read_source('AGENTS.md').`;

  const parts = [
    user ? `[USER]\n${user}` : '',
    soul ? `[SOUL]\n${soul}` : '',
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
