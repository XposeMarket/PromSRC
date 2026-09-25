/**
 * Plugin hook runtime (Claude Code / Codex hooks.json protocol).
 *
 * Hooks come only from imported plugins whose ledger has hooksApproved=true.
 * Each hook is a shell command that receives the event as JSON on stdin:
 *   { hook_event_name, session_id, cwd, tool_name, tool_input, tool_response?, prometheus_tool_name }
 * PreToolUse can block the tool: exit code 2 (stderr = reason), or stdout JSON
 * {"decision":"block","reason":...} / {"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":...}}.
 * Everything else is observe-only. Hooks never see secrets beyond the tool args
 * the model already produced, run with a hard timeout, and a hook failure never
 * fails the tool (fail-open, except an explicit block decision).
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { listImportedPlugins, type ImportedPluginLedger } from './import-service.js';

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'UserPromptSubmit' | 'Stop' | 'SessionStart' | 'SessionEnd';

interface ActiveHook { pluginId: string; pluginDir: string; event: string; matcher?: string; command: string; timeoutSec: number }

/** Claude tool names that plugin matchers target, mapped from Prometheus tools. */
const CLAUDE_TOOL_ALIASES: Array<[RegExp, string]> = [
  [/^(run_command|run_command_supervised|terminal|shell|start_process|workspace_run)$/, 'Bash'],
  [/^(workspace_edit|find_replace|replace_lines|insert_after|delete_lines|apply_workspace_patchset)$/, 'Edit'],
  [/^(write_file|create_file)$/, 'Write'],
  [/^(workspace_read|read_file|read_files_batch)$/, 'Read'],
  [/^(search_files|grep|workspace_code_nav)$/, 'Grep'],
  [/^(file_tree|list_directory)$/, 'Glob'],
  [/^web_fetch$/, 'WebFetch'],
  [/^web_search$/, 'WebSearch'],
  [/^(background_ops|spawn_subagent)$/, 'Task'],
];

export function claudeToolName(prometheusName: string): string {
  for (const [re, name] of CLAUDE_TOOL_ALIASES) if (re.test(prometheusName)) return name;
  return prometheusName;
}

let cache: { at: number; key: string; hooks: ActiveHook[] } | null = null;

function ledgerKey(dir: string): string {
  try {
    return fs.readdirSync(dir).map((d) => {
      try { return `${d}:${fs.statSync(path.join(dir, d, 'imported-plugin.json')).mtimeMs}`; } catch { return d; }
    }).join('|');
  } catch { return ''; }
}

export function loadActiveHooks(userPluginsDir?: string): ActiveHook[] {
  let dir = userPluginsDir || '';
  if (!dir) {
    try { dir = require('../loader.js').resolveUserPluginsDir(); } catch { return []; }
  }
  const now = Date.now();
  if (cache && now - cache.at < 5_000) return cache.hooks;
  const key = ledgerKey(dir);
  if (cache && cache.key === key) { cache.at = now; return cache.hooks; }
  const hooks: ActiveHook[] = [];
  for (const ledger of listImportedPlugins(dir) as ImportedPluginLedger[]) {
    if (!ledger.hooksApproved) continue;
    for (const h of ledger.hooks || []) {
      if (h.type !== 'command' || !h.command) continue;
      hooks.push({ pluginId: ledger.id, pluginDir: ledger.pluginDir, event: h.event, matcher: h.matcher, command: h.command, timeoutSec: Math.max(1, Math.min(60, h.timeoutSec || 10)) });
    }
  }
  cache = { at: now, key, hooks };
  return hooks;
}

export function invalidatePluginHookCache(): void { cache = null; }

function matches(hook: ActiveHook, toolName?: string): boolean {
  if (!hook.matcher || hook.matcher === '*' || !toolName) return true;
  try {
    const re = new RegExp(`^(?:${hook.matcher})$`);
    return re.test(claudeToolName(toolName)) || re.test(toolName);
  } catch {
    return hook.matcher === toolName || hook.matcher === claudeToolName(toolName);
  }
}

function resolveBash(): string | null {
  const candidates = [process.env.PROMETHEUS_BASH_PATH, 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].filter(Boolean) as string[];
  if (process.platform !== 'win32') return '/bin/sh';
  return candidates.find((c) => fs.existsSync(c)) || null;
}

export interface HookRunResult { pluginId: string; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; blocked?: string; additionalContext?: string }

function runHook(hook: ActiveHook, payload: Record<string, unknown>): Promise<HookRunResult> {
  return new Promise((resolve) => {
    const root = path.join(hook.pluginDir, 'files').replace(/\\/g, '/');
    const command = hook.command.replace(/\$\{(CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|PLUGIN_ROOT)\}/g, root);
    const bash = resolveBash();
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: root, PROMETHEUS_PLUGIN_ROOT: root, PROMETHEUS_PLUGIN_ID: hook.pluginId };
    const child = bash
      ? spawn(bash, ['-c', command], { cwd: String(payload.cwd || process.cwd()), env, windowsHide: true })
      : spawn(command, { cwd: String(payload.cwd || process.cwd()), env, shell: true, windowsHide: true });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, hook.timeoutSec * 1000);
    child.stdout?.on('data', (d) => { if (stdout.length < 16_000) stdout += String(d); });
    child.stderr?.on('data', (d) => { if (stderr.length < 8_000) stderr += String(d); });
    child.on('error', (err) => { stderr += String(err?.message || err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result: HookRunResult = { pluginId: hook.pluginId, exitCode: code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut };
      if (code === 2) result.blocked = result.stderr || `Blocked by plugin hook ${hook.pluginId}`;
      try {
        const out = JSON.parse(result.stdout);
        if (out?.decision === 'block') result.blocked = String(out.reason || `Blocked by plugin hook ${hook.pluginId}`);
        const hso = out?.hookSpecificOutput;
        if (hso?.permissionDecision === 'deny') result.blocked = String(hso.permissionDecisionReason || `Denied by plugin hook ${hook.pluginId}`);
        if (typeof hso?.additionalContext === 'string') result.additionalContext = hso.additionalContext;
      } catch { /* plain-text stdout is fine */ }
      resolve(result);
    });
    try { child.stdin?.end(JSON.stringify(payload)); } catch {}
  });
}

export interface HookDispatchInput { event: HookEvent; sessionId?: string; cwd?: string; toolName?: string; toolInput?: unknown; toolResponse?: unknown; prompt?: string }

/** Run all approved hooks for an event. Returns the first block reason (PreToolUse only) plus all results. */
export async function dispatchPluginHooks(input: HookDispatchInput, userPluginsDir?: string): Promise<{ blocked?: string; results: HookRunResult[] }> {
  let hooks: ActiveHook[] = [];
  try { hooks = loadActiveHooks(userPluginsDir).filter((h) => h.event === input.event && matches(h, input.toolName)); } catch { return { results: [] }; }
  if (!hooks.length) return { results: [] };
  const payload = {
    hook_event_name: input.event,
    session_id: input.sessionId || '',
    cwd: input.cwd || process.cwd(),
    ...(input.toolName ? { tool_name: claudeToolName(input.toolName), prometheus_tool_name: input.toolName, tool_input: input.toolInput ?? {} } : {}),
    ...(input.toolResponse !== undefined ? { tool_response: input.toolResponse } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
  };
  const results = await Promise.all(hooks.map((h) => runHook(h, payload).catch((err) => ({ pluginId: h.pluginId, exitCode: null, stdout: '', stderr: String(err), timedOut: false }) as HookRunResult)));
  const blocked = input.event === 'PreToolUse' ? results.find((r) => r.blocked)?.blocked : undefined;
  return { blocked, results };
}

/** Cheap check so the tool hot path skips all work when no hooks are approved. */
export function hasActivePluginHooks(event?: HookEvent): boolean {
  try { return loadActiveHooks().some((h) => !event || h.event === event); } catch { return false; }
}
