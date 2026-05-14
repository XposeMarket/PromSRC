export type ProcessRunState = 'starting' | 'running' | 'exiting' | 'exited';

export type ProcessTerminationReason =
  | 'exit'
  | 'signal'
  | 'manual_cancel'
  | 'overall_timeout'
  | 'no_output_timeout'
  | 'spawn_error';

export type ProcessSpawnMode = 'foreground' | 'background';

export interface ProcessRunRecord {
  runId: string;
  sessionId?: string;
  taskId?: string;
  codingSessionId?: string;
  command: string;
  cwd: string;
  mode: ProcessSpawnMode;
  title?: string;
  pid?: number;
  state: ProcessRunState;
  startedAt: string;
  updatedAt: string;
  lastOutputAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  terminationReason?: ProcessTerminationReason;
  timedOut?: boolean;
  noOutputTimedOut?: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  outputPreview: string;
}

export interface ProcessRunExit {
  runId: string;
  reason: ProcessTerminationReason;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  noOutputTimedOut: boolean;
}

export interface ProcessSpawnInput {
  command: string;
  cwd: string;
  mode?: ProcessSpawnMode;
  title?: string;
  sessionId?: string;
  taskId?: string;
  codingSessionId?: string;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  stdinMode?: 'ignore' | 'pipe';
  input?: string;
  captureOutput?: boolean;
}

export interface ProcessLogResult {
  runId: string;
  stdout: string;
  stderr: string;
  combined: string;
  stdoutBytes: number;
  stderrBytes: number;
  truncated: boolean;
}

export interface ManagedProcessRun {
  runId: string;
  pid?: number;
  record: ProcessRunRecord;
  wait: () => Promise<ProcessRunExit>;
  cancel: (reason?: ProcessTerminationReason) => void;
  write: (data: string) => boolean;
  closeStdin: () => boolean;
}
