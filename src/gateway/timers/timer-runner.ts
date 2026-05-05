import {
  getDueMainChatTimers,
  updateMainChatTimer,
  type MainChatTimer,
} from './timer-store';
import {
  broadcastWS,
  isModelBusy,
  setModelBusy,
} from '../comms/broadcaster';

type RunInteractiveTurn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  reasoningOptions?: any,
  attachments?: any,
  modelOverride?: string,
) => Promise<{ type: string; text: string; thinking?: string; toolResults?: any[]; artifacts?: any[] }>;

export interface MainChatTimerRunnerDeps {
  runInteractiveTurn: RunInteractiveTurn;
  tickMs?: number;
}

export class MainChatTimerRunner {
  private timer: NodeJS.Timeout | null = null;
  private runningTimerId: string | null = null;
  private readonly runInteractiveTurn: RunInteractiveTurn;
  private readonly tickMs: number;

  constructor(deps: MainChatTimerRunnerDeps) {
    this.runInteractiveTurn = deps.runInteractiveTurn;
    this.tickMs = Math.max(1000, Math.floor(Number(deps.tickMs) || 5000));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.warn('[TimerRunner] tick failed:', err?.message || err));
    }, this.tickMs);
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
    this.tick().catch(() => {});
    console.log(`[TimerRunner] Started - ticking every ${this.tickMs}ms`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.runningTimerId) return;
    if (isModelBusy()) {
      for (const due of getDueMainChatTimers().slice(0, 10)) {
        if (due.status === 'pending') {
          updateMainChatTimer(due.id, { status: 'due_waiting' });
          broadcastWS({ type: 'timer_waiting', timer: due, sessionId: due.sessionId });
        }
      }
      return;
    }
    const next = getDueMainChatTimers()[0];
    if (!next) return;
    await this.fireTimer(next);
  }

  private async fireTimer(timer: MainChatTimer): Promise<void> {
    this.runningTimerId = timer.id;
    const firedAt = new Date().toISOString();
    updateMainChatTimer(timer.id, { status: 'running', firedAt });
    setModelBusy(true);

    const firedUserMessage = [
      '[Timer fired]',
      `User asked earlier: ${timer.instruction}`,
      `Timer label: ${timer.label}`,
      `Scheduled for: ${timer.dueAt}`,
      'Proceed now as if the user just sent this request.',
      'When finished, reply directly with the actual outcome or acknowledgement. Do not show or quote this timer payload.',
    ].join('\n');

    broadcastWS({
      type: 'timer_fired',
      timer: { ...timer, status: 'running', firedAt },
      sessionId: timer.sessionId,
    });

    const abortSignal = { aborted: false };
    const sendSSE = (event: string, data: any) => {
      broadcastWS({
        type: 'timer_sse',
        timerId: timer.id,
        sessionId: timer.sessionId,
        eventType: event,
        ...(data && typeof data === 'object' ? data : { message: String(data ?? '') }),
      });
    };

    try {
      const result = await this.runInteractiveTurn(
        firedUserMessage,
        timer.sessionId,
        sendSSE,
        undefined,
        abortSignal,
        `[Timer ${timer.id}] This is a delayed main-chat user turn. Treat it like the user just sent it in this same chat session.`,
      );
      const text = String(result?.text || '').trim();
      updateMainChatTimer(timer.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        resultPreview: text.slice(0, 500),
      });
      broadcastWS({
        type: 'timer_done',
        timerId: timer.id,
        sessionId: timer.sessionId,
        timer,
        message: {
          role: 'assistant',
          content: text,
          timestamp: Date.now(),
          channel: 'system',
          channelLabel: 'timer',
        },
        result: text,
      });
    } catch (err: any) {
      const error = String(err?.message || err || 'Timer failed');
      updateMainChatTimer(timer.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error,
      });
      broadcastWS({
        type: 'timer_failed',
        timerId: timer.id,
        sessionId: timer.sessionId,
        timer,
        error,
        message: {
          role: 'assistant',
          content: `Timer failed: ${error}`,
          timestamp: Date.now(),
          channel: 'system',
          channelLabel: 'timer',
        },
      });
    } finally {
      setModelBusy(false);
      this.runningTimerId = null;
    }
  }
}
