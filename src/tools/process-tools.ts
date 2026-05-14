import { ToolResult } from '../types.js';
import { getProcessSupervisor } from '../gateway/process/supervisor.js';
import { validateShellRequest } from './shell.js';

function ok(data: any, stdout?: string): ToolResult {
  return { success: true, data, stdout };
}

export const runCommandTool = {
  name: 'run_command_supervised',
  description: 'Run a command through the Prometheus process supervisor and return the captured result when it exits',
  schema: {
    command: 'string (required) - Command to run',
    cwd: 'string (optional) - Working directory',
    timeoutMs: 'number (optional) - Timeout in milliseconds',
    noOutputTimeoutMs: 'number (optional) - No-output timeout in milliseconds',
  },
  execute: async (args: any): Promise<ToolResult> => {
    const validation = validateShellRequest({ command: args.command, cwd: args.cwd });
    if (!validation.ok) return validation.result;
    const run = await getProcessSupervisor().spawn({
      command: validation.command,
      cwd: validation.cwd,
      mode: 'foreground',
      timeoutMs: args.timeoutMs == null ? 120000 : Number(args.timeoutMs),
      noOutputTimeoutMs: args.noOutputTimeoutMs == null ? undefined : Number(args.noOutputTimeoutMs),
      title: args.title ? String(args.title) : undefined,
    });
    const exit = await run.wait();
    const text = [exit.stdout, exit.stderr].filter(Boolean).join('\n').trim();
    return {
      success: exit.exitCode === 0,
      stdout: text,
      stderr: exit.stderr,
      exitCode: exit.exitCode ?? 0,
      data: { runId: run.runId, run: getProcessSupervisor().get(run.runId), exit },
      error: exit.exitCode === 0 ? undefined : exit.stderr || `Command exited with ${exit.exitCode ?? 'unknown status'}`,
    };
  },
};

export const startProcessTool = {
  name: 'start_process',
  description: 'Start a long-running command as a supervised background process and return a runId',
  schema: {
    command: 'string (required) - Command to start',
    cwd: 'string (optional) - Working directory',
    title: 'string (optional) - Human-friendly process title',
    noOutputTimeoutMs: 'number (optional) - Kill if no output arrives within this many milliseconds',
  },
  execute: async (args: any): Promise<ToolResult> => {
    const validation = validateShellRequest({ command: args.command, cwd: args.cwd });
    if (!validation.ok) return validation.result;
    const run = await getProcessSupervisor().spawn({
      command: validation.command,
      cwd: validation.cwd,
      mode: 'background',
      title: args.title ? String(args.title) : undefined,
      noOutputTimeoutMs: args.noOutputTimeoutMs == null ? undefined : Number(args.noOutputTimeoutMs),
      stdinMode: args.stdin === true ? 'pipe' : 'ignore',
    });
    return ok({ runId: run.runId, run: run.record }, `Started ${run.runId}`);
  },
};

export const processStatusTool = {
  name: 'process_status',
  description: 'List supervised process runs, or inspect one run by runId',
  schema: {
    runId: 'string (optional) - Specific run id',
    limit: 'number (optional) - Max runs to list',
  },
  execute: async (args: any): Promise<ToolResult> => {
    const supervisor = getProcessSupervisor();
    const runId = String(args.runId || args.run_id || '').trim();
    if (runId) return ok({ run: supervisor.get(runId) });
    return ok({ runs: supervisor.list(Number(args.limit || 50)) });
  },
};

export const processLogTool = {
  name: 'process_log',
  description: 'Read stdout/stderr logs for a supervised process run',
  schema: {
    runId: 'string (required) - Process run id',
    maxChars: 'number (optional) - Max characters to return',
  },
  execute: async (args: any): Promise<ToolResult> => {
    const runId = String(args.runId || args.run_id || '').trim();
    if (!runId) return { success: false, error: 'runId is required' };
    const log = getProcessSupervisor().log(runId, Number(args.maxChars || 200000));
    return ok(log, log.combined);
  },
};

export const processWaitTool = {
  name: 'process_wait',
  description: 'Wait for a running supervised process to exit',
  schema: {
    runId: 'string (required) - Process run id',
  },
  execute: async (args: any): Promise<ToolResult> => {
    const runId = String(args.runId || args.run_id || '').trim();
    if (!runId) return { success: false, error: 'runId is required' };
    const exit = await getProcessSupervisor().wait(runId);
    if (!exit) return { success: false, error: `No active process with runId ${runId}` };
    return {
      success: exit.exitCode === 0,
      stdout: [exit.stdout, exit.stderr].filter(Boolean).join('\n'),
      stderr: exit.stderr,
      exitCode: exit.exitCode ?? 0,
      data: { exit, run: getProcessSupervisor().get(runId) },
    };
  },
};

export const processKillTool = {
  name: 'process_kill',
  description: 'Kill a running supervised process',
  schema: {
    runId: 'string (required) - Process run id',
  },
  execute: async (args: any): Promise<ToolResult> => {
    const runId = String(args.runId || args.run_id || '').trim();
    if (!runId) return { success: false, error: 'runId is required' };
    const killed = getProcessSupervisor().cancel(runId);
    return ok({ killed, runId }, killed ? `Killed ${runId}` : `No active process ${runId}`);
  },
};

export const processSubmitTool = {
  name: 'process_submit',
  description: 'Send a line of stdin to a running supervised process',
  schema: {
    runId: 'string (required) - Process run id',
    data: 'string (optional) - Text to send before Enter',
  },
  execute: async (args: any): Promise<ToolResult> => {
    const runId = String(args.runId || args.run_id || '').trim();
    if (!runId) return { success: false, error: 'runId is required' };
    const okWrite = getProcessSupervisor().write(runId, String(args.data || ''), true);
    return ok({ ok: okWrite, runId }, okWrite ? `Submitted input to ${runId}` : `Could not write to ${runId}`);
  },
};

export const allProcessTools = [
  runCommandTool,
  startProcessTool,
  processStatusTool,
  processLogTool,
  processWaitTool,
  processKillTool,
  processSubmitTool,
];
