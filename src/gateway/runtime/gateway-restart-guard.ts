import type { LiveRuntimeSnapshot } from '../live-runtime-registry';

type RestartRuntime = Pick<LiveRuntimeSnapshot, 'sessionId' | 'status' | 'abortRequestedAt' | 'completedAt' | 'label' | 'recoveryData'>;
const owner = (runtime: RestartRuntime) => String(runtime.recoveryData?.ownerSessionId || runtime.recoveryData?.originatingSessionId || runtime.recoveryData?.parentSessionId || runtime.sessionId || '');

/** Include all runtime kinds and remote mirrors, not just foreground chats. */
export function otherActiveRestartRuntimes(runtimes: RestartRuntime[], callerSessionId: string): RestartRuntime[] {
  const caller = runtimes.find((runtime) => runtime.sessionId === callerSessionId);
  const callerOwner = caller ? owner(caller) : callerSessionId;
  return runtimes.filter((runtime) => runtime.status === 'running' && !runtime.abortRequestedAt
    && !runtime.completedAt && owner(runtime) !== callerOwner);
}

export function restartDeferredMessage(runtimes: RestartRuntime[]): string {
  return `Restart deferred: ${runtimes.length} other active turn(s): ${runtimes.map((runtime) => `${owner(runtime) || 'unknown session'} (${String(runtime.label || 'running').slice(0, 80)})`).join(', ')}. Wait for them to finish, or call again with force:true if the user explicitly asked.`;
}
