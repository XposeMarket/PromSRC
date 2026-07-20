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

if (!processWithMarker[marker]) {
  processWithMarker[marker] = true;

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
}
