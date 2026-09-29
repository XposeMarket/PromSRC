import fs from 'fs';
import path from 'path';

const marker = Symbol.for('prometheus.gatewayExitDiagnosticsInstalled');
const processWithMarker = process as NodeJS.Process & { [marker]?: boolean };

function appendExitDiagnostic(type: string, details: Record<string, unknown> = {}): void {
  try {
    const logDir = path.join(process.cwd(), '.prometheus', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'gateway-exit-diagnostics.ndjson'), `${JSON.stringify({
      timestamp: new Date().toISOString(),
      type,
      pid: process.pid,
      ...details,
    })}\n`, 'utf8');
  } catch {
    // Exit diagnostics must never interfere with gateway shutdown.
  }
}

function installBrokenPipeGuards(): void {
  // The gateway is supervised through a pipe. A disconnected supervisor or
  // WebSocket relay can make a later console/log write emit EPIPE; without a
  // listener Node treats that as an uncaught exception and tears down the
  // gateway, interrupting active Brain runs and every other long-lived job.
  for (const [name, stream] of [['stdout', process.stdout], ['stderr', process.stderr]] as const) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error?.code === 'EPIPE') return;
      appendExitDiagnostic('output_stream_error', {
        stream: name,
        error: error?.stack || error?.message || String(error),
      });
    });
  }
}

if (!processWithMarker[marker]) {
  processWithMarker[marker] = true;
  installBrokenPipeGuards();

  const originalExit = process.exit.bind(process) as typeof process.exit;
  process.exit = ((code?: string | number | null | undefined): never => {
    appendExitDiagnostic('process_exit_called', {
      code: code ?? process.exitCode ?? 0,
      stack: new Error('process.exit call site').stack,
    });
    return originalExit(code as number | undefined);
  }) as typeof process.exit;

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    appendExitDiagnostic('uncaught_exception', {
      origin,
      error: error?.stack || error?.message || String(error),
    });
  });

  process.on('exit', (code) => {
    appendExitDiagnostic('process_exit', { code });
  });

  // A stray rejected promise (e.g. Playwright's dialog auto-close racing an
  // already-dismissed dialog: "Protocol error (Page.handleJavaScriptDialog):
  // No dialog is showing") used to hit Node's default and kill the whole
  // gateway with code 1, taking every chat, team and Brain run with it. Record
  // it and keep serving; genuine faults still surface in the diagnostics log.
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : null;
    appendExitDiagnostic('unhandled_rejection', {
      error: error?.stack || error?.message || String(reason),
    });
    try {
      console.error('[gateway] Unhandled promise rejection (gateway kept alive):', error?.message || String(reason));
    } catch {
      // Logging must never throw from the rejection handler.
    }
  });
}
