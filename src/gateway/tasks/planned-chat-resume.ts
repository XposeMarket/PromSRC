import { collectNeedsYouItems } from '../needs-you-collect';

import { getPlannedChatRunDetail, listPlannedChatRuns, recordPlannedChatProgress, recordPlannedChatActivity, finishPlannedChatRun, resumePlannedChatRun } from './planned-chat-runs';
import { listLiveRuntimes, registerLiveRuntime, finishLiveRuntime } from '../live-runtime-registry';
import { sessionExists } from '../session';

const resuming = new Set<string>();
/** Continue the original chat through its normal admission/approval pipeline. */
export async function continuePlannedChat(id: string, runTurn?: typeof import('../routes/chat/pipeline/interactive-turn').runInteractiveTurn): Promise<{ success: boolean; error?: string; sessionId?: string }> {
  const row = getPlannedChatRunDetail(id);
  if (!row || !sessionExists(row.sessionId)) return { success: false, error: 'Original chat not found.' };
  const sid = row.sessionId;
  if (collectNeedsYouItems().some(item => item.sessionId === sid)) return { success: false, error: 'Answer the pending request in the original chat before resuming.' };
  if (row.status !== 'paused' || resuming.has(sid) || listLiveRuntimes().some(r => r.kind === 'main_chat' && r.sessionId === sid)) return { success: false, error: 'This chat is already running or is not resumable.' };
  if (listPlannedChatRuns().find(r => r.sessionId === sid)?.runtimeId !== row.runtimeId) return { success: false, error: 'A newer plan exists. Resume the latest task instead.' };
  resuming.add(sid);
  try {
    const runInteractiveTurn = runTurn || (await import('../routes/chat/pipeline/interactive-turn')).runInteractiveTurn;
    const controller = new AbortController();
    const signal = { aborted: false, signal: controller.signal };
    const runtimeId = registerLiveRuntime({ kind: 'main_chat', label: 'Resumed planned chat', sessionId: sid, source: 'web', detail: row.title, abortSignal: signal,
      onAbort: () => { signal.aborted = true; controller.abort(); }, recoveryPolicy: 'mark_interrupted',
      recoveryData: { message: 'Continue the unfinished plan from its saved progress.', origin: { channel: 'web', surface: 'desktop_web', device: 'desktop' } } });
    const message = 'Continue the unfinished plan from its saved progress. Do not repeat completed steps.';
    const context = `Saved plan: ${row.title}\n${row.runtimeProgress.items.map((item, i) => `${i + 1}. [${item.status}] ${item.text}`).join('\n')}\nKeep completed steps. Use complete_plan_step only with verified evidence.`;
    resumePlannedChatRun(row.runtimeId, runtimeId, sid);
    // handleChat restores the prior plan before the first progress event; retain its lineage.
    let failed = false;
    void runInteractiveTurn(message, sid, (event, data) => {
      if (event === 'progress_state') recordPlannedChatProgress(runtimeId, sid, data, row.title, row.runtimeId, row.originPrompt);
      if (event === 'error') failed = true;
      recordPlannedChatActivity(runtimeId, event, data);
    }, undefined, signal, context, undefined, undefined, undefined, undefined, { runtimeId }, sid.startsWith('mobile_') ? { channel: 'mobile', surface: 'mobile_app', device: 'phone' } : undefined)
      .catch(error => { failed = true; console.warn('[planned-chat] Resume failed:', error); })
      .finally(() => { finishPlannedChatRun(runtimeId, signal.aborted ? 'interrupted' : failed ? 'failed' : 'completed'); finishLiveRuntime(runtimeId); resuming.delete(sid); });
    return { success: true, sessionId: sid };
  } catch (error: any) { resuming.delete(sid); return { success: false, error: String(error?.message || error) }; }
}
