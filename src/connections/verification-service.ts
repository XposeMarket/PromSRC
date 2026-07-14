export type ConnectionVerificationCheck =
  | 'authentication'
  | 'registration'
  | 'exposure'
  | 'safe_read'
  | 'custom';

export interface ConnectionVerificationStepResult {
  check: ConnectionVerificationCheck;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
  durationMs: number;
}

export interface ConnectionVerificationReport {
  connectionId: string;
  ok: boolean;
  state: 'verified' | 'degraded' | 'reauth_required' | 'failed';
  startedAt: string;
  completedAt: string;
  checks: ConnectionVerificationStepResult[];
  registeredTools: string[];
  exposedTools: string[];
}

export interface ConnectionVerificationTarget {
  connectionId: string;
  serviceId: string;
  requestedCapabilities?: string[];
  requireSafeRead?: boolean;
}

export interface ConnectionVerificationRuntime {
  checkAuthentication(target: ConnectionVerificationTarget): Promise<{ ok: boolean; message?: string; reauthRequired?: boolean; details?: Record<string, unknown> }>;
  listRegisteredTools(target: ConnectionVerificationTarget): Promise<string[]>;
  listExposedTools(target: ConnectionVerificationTarget): Promise<string[]>;
  runSafeRead?(target: ConnectionVerificationTarget): Promise<{ ok: boolean; message?: string; details?: Record<string, unknown> }>;
}

export interface ConnectionVerifier {
  id: string;
  supports?(target: ConnectionVerificationTarget): boolean;
  verify(target: ConnectionVerificationTarget): Promise<{ ok: boolean; message?: string; details?: Record<string, unknown> }>;
}

async function timed<T>(operation: () => Promise<T>, timeoutMs: number): Promise<{ value: T; durationMs: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Verification step timed out after ${timeoutMs}ms.`)), timeoutMs);
    });
    return { value: await Promise.race([operation(), timeout]), durationMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export class ConnectionVerificationService {
  private readonly verifiers = new Map<string, ConnectionVerifier>();

  constructor(
    private readonly runtime: ConnectionVerificationRuntime,
    private readonly timeoutMs = 15_000,
  ) {}

  register(verifier: ConnectionVerifier): () => void {
    if (!verifier.id.trim()) throw new Error('Connection verifier id is required.');
    if (this.verifiers.has(verifier.id)) throw new Error(`Connection verifier "${verifier.id}" is already registered.`);
    this.verifiers.set(verifier.id, verifier);
    return () => this.verifiers.delete(verifier.id);
  }

  async verify(target: ConnectionVerificationTarget): Promise<ConnectionVerificationReport> {
    const startedAt = new Date().toISOString();
    const checks: ConnectionVerificationStepResult[] = [];
    let registeredTools: string[] = [];
    let exposedTools: string[] = [];
    let reauthRequired = false;

    const run = async (
      check: ConnectionVerificationCheck,
      operation: () => Promise<{ ok: boolean; message?: string; details?: Record<string, unknown> }>,
    ): Promise<void> => {
      try {
        const { value, durationMs } = await timed(operation, this.timeoutMs);
        checks.push({ check, ok: value.ok, message: value.message || (value.ok ? 'Passed.' : 'Failed.'), details: value.details, durationMs });
      } catch (error: any) {
        checks.push({ check, ok: false, message: String(error?.message || error), durationMs: 0 });
      }
    };

    await run('authentication', async () => {
      const result = await this.runtime.checkAuthentication(target);
      reauthRequired = result.reauthRequired === true;
      return result;
    });

    await run('registration', async () => {
      registeredTools = sortedUnique(await this.runtime.listRegisteredTools(target));
      return { ok: registeredTools.length > 0, message: registeredTools.length ? `${registeredTools.length} tool(s) registered.` : 'No tools registered.' };
    });

    await run('exposure', async () => {
      exposedTools = sortedUnique(await this.runtime.listExposedTools(target));
      const missing = exposedTools.filter((tool) => !registeredTools.includes(tool));
      return {
        ok: missing.length === 0 && exposedTools.length > 0,
        message: missing.length ? `Exposed tools are not registered: ${missing.join(', ')}.` : `${exposedTools.length} tool(s) exposed.`,
        details: missing.length ? { missing } : undefined,
      };
    });

    if (target.requireSafeRead !== false) {
      await run('safe_read', async () => {
        if (!this.runtime.runSafeRead) return { ok: false, message: 'No safe-read verification probe is configured.' };
        return this.runtime.runSafeRead(target);
      });
    }

    for (const verifier of this.verifiers.values()) {
      if (verifier.supports && !verifier.supports(target)) continue;
      await run('custom', () => verifier.verify(target));
    }

    const ok = checks.length > 0 && checks.every((check) => check.ok);
    const succeeded = checks.filter((check) => check.ok).length;
    const state = reauthRequired ? 'reauth_required' : ok ? 'verified' : succeeded > 0 ? 'degraded' : 'failed';
    return { connectionId: target.connectionId, ok, state, startedAt, completedAt: new Date().toISOString(), checks, registeredTools, exposedTools };
  }
}
