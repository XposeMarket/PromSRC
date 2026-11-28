import {
  claimMainChatTimerForRun,
  getDueMainChatTimers,
  getMainChatTimerMode,
  listMainChatTimers,
  updateMainChatTimer,
  type MainChatTimer,
} from './timer-store';
import { addMessage, flushSession, getMainChatGoal, getSession } from '../session';
import {
  broadcastWS,
  setModelBusy,
} from '../comms/broadcaster';
import { deliverToTargets, type DeliveryDeps } from '../delivery-router';
import {
  getLiveRuntime,
  hasTerminalRuntimeCheckpoint,
  isSteerableChatRuntimeKind,
  listLiveRuntimes,
  onRuntimeSteersDelivered,
} from '../live-runtime-registry';
import type { ChatSteerInternalOptions } from '../routes/chat/steer';

type RunInteractiveTurn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean; signal?: AbortSignal },
  callerContext?: string,
  reasoningOptions?: any,
  attachments?: any,
  modelOverride?: string,
) => Promise<{ type: string; text: string; thinking?: string; toolResults?: any[]; artifacts?: any[] }>;

export interface TimerSteerRequest {
  sessionId: string;
  /** Model-facing payload. */
  message: string;
  /** What the thread shows at the steer boundary. */
  displayMessage: string;
  contextSummary: string;
  clientRequestId: string;
}

export interface TimerSteerResult {
  ok: boolean;
  eventId?: string;
  runtimeId?: string;
  error?: string;
}

export interface TimerReminderMessage {
  role: 'assistant';
  content: string;
  timestamp: number;
  channel: 'system';
  channelLabel: string;
  messageId: string;
  messageKind: string;
}

export interface MainChatTimerRunnerDeps {
  runInteractiveTurn: RunInteractiveTurn;
  tickMs?: number;
  telegramChannel?: any;
  /** True when this chat has a turn running in this process that can read steers. */
  hasSteerableTurn?: (sessionId: string) => boolean;
  /**
   * Queue the fired timer into that running turn. ok:false when it could not be
   * queued. Without it, every `run` timer takes the separate-turn path.
   */
  steerActiveTurn?: (request: TimerSteerRequest) => TimerSteerResult;
  /** True while the runtime that holds a timer steer can still read it. */
  isRuntimeActive?: (runtimeId: string) => boolean;
  /** Subscribe to steers reaching the model (provider call returned); returns unsubscribe. */
  onSteersDelivered?: (listener: (eventIds: string[]) => void) => () => void;
  /** Save a model-free reminder message in its chat. */
  postReminder?: (sessionId: string, message: TimerReminderMessage) => void;
  /** Push a reminder to the user's devices. Best effort. */
  pushReminder?: (timer: MainChatTimer, text: string) => void | Promise<void>;
  broadcast?: (payload: any) => void;
}

interface SteeredTimer {
  timer: MainChatTimer;
  runtimeId: string;
  firedAt: string;
}

function clip(text: string, max: number): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function defaultHasSteerableTurn(sessionId: string): boolean {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  return listLiveRuntimes().some((runtime) => (
    isSteerableChatRuntimeKind(runtime.kind)
    && String(runtime.sessionId || '') === sid
    // A runtime mirrored from a draining gateway reads its steers in that
    // process, where this runner cannot see the read happen.
    && !(Number(runtime.remoteHostPid || 0) > 0)
    && !hasTerminalRuntimeCheckpoint(runtime)
  ));
}

/** Body for applyChatSteer (src/gateway/routes/chat/steer.ts) when a timer fires mid-turn. */
export function timerChatSteerBody(request: TimerSteerRequest): Record<string, any> {
  return {
    sessionId: request.sessionId,
    message: request.message,
    displayMessage: request.displayMessage,
    source: 'timer',
    clientRequestId: request.clientRequestId,
  };
}

/** Gateway-internal applyChatSteer options for a timer steer. */
export function timerChatSteerOptions(request: TimerSteerRequest): ChatSteerInternalOptions {
  return {
    kind: 'timer_fired',
    contextSummary: request.contextSummary,
    channel: 'system',
    channelLabel: 'timer',
    workflowLabel: 'Timer fired during this turn',
    // A timer is not the user's answer to a pending question or approval.
    notifyWaiters: false,
    localRuntimeOnly: true,
  };
}

export function timerSteerResultFromChatSteer(result: { status: number; body: any } | null | undefined): TimerSteerResult {
  const body: any = result?.body || {};
  return {
    ok: result?.status === 200 && body.ok === true,
    eventId: body.eventId ? String(body.eventId) : undefined,
    runtimeId: body.runtimeId ? String(body.runtimeId) : undefined,
    error: body.error ? String(body.error) : undefined,
  };
}

function defaultIsRuntimeActive(runtimeId: string): boolean {
  const runtime = getLiveRuntime(runtimeId);
  return !!runtime && !hasTerminalRuntimeCheckpoint(runtime);
}

function defaultOnSteersDelivered(listener: (eventIds: string[]) => void): () => void {
  return onRuntimeSteersDelivered((events) => listener(events.map((event) => event.id)));
}

function defaultPostReminder(sessionId: string, message: TimerReminderMessage): void {
  // A re-fire after a crash between saving and marking done must not post twice.
  const alreadyPosted = getSession(sessionId).history.some((entry: any) => entry?.messageId === message.messageId);
  if (!alreadyPosted) {
    addMessage(sessionId, message as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    flushSession(sessionId);
  }
  broadcastWS({ type: 'session_history_changed', sessionId, timestamp: Date.now(), source: 'timer_reminder' });
}

async function defaultPushReminder(timer: MainChatTimer, text: string): Promise<void> {
  const webPush: any = await import('../notifications/web-push');
  if (typeof webPush?.sendWebPushToAll !== 'function') return;
  const { mobileRouteForSession } = await import('../notifications/session-route');
  await webPush.sendWebPushToAll({
    title: 'Reminder',
    body: clip(text, 240),
    url: `/?source=pwa#${mobileRouteForSession(timer.sessionId)}`,
    tag: `timer_${timer.id}`,
    data: { kind: 'timer_reminder', sessionId: timer.sessionId, timerId: timer.id },
  });
}

/**
 * Fires due main-chat timers. Three delivery paths, cheapest first:
 * - `notify` timers post a reminder and push it, with no model call.
 * - `run` timers whose chat already has a turn running are folded into that
 *   turn as a live steer instead of costing a second turn. The timer stays
 *   `running` until the turn actually reads the steer; if the turn ends first,
 *   it runs as its own turn, and a restart re-fires it.
 * - Otherwise the timer runs as its own turn (one timer turn at a time).
 */
export class MainChatTimerRunner {
  private timer: NodeJS.Timeout | null = null;
  private runningTimerId: string | null = null;
  private ticking = false;
  private unsubscribeSteers: (() => void) | null = null;
  private readonly steered = new Map<string, SteeredTimer>();
  private readonly fallbackQueue: Array<{ timer: MainChatTimer; firedAt: string }> = [];
  private readonly runInteractiveTurn: RunInteractiveTurn;
  private readonly tickMs: number;
  private readonly deliveryDeps: DeliveryDeps;
  private readonly hasSteerableTurn: (sessionId: string) => boolean;
  private readonly steerActiveTurn: ((request: TimerSteerRequest) => TimerSteerResult) | null;
  private readonly isRuntimeActive: (runtimeId: string) => boolean;
  private readonly onSteersDelivered: (listener: (eventIds: string[]) => void) => () => void;
  private readonly postReminder: (sessionId: string, message: TimerReminderMessage) => void;
  private readonly pushReminder: (timer: MainChatTimer, text: string) => void | Promise<void>;
  private readonly broadcast: (payload: any) => void;

  constructor(deps: MainChatTimerRunnerDeps) {
    this.runInteractiveTurn = deps.runInteractiveTurn;
    this.tickMs = Math.max(1000, Math.floor(Number(deps.tickMs) || 5000));
    this.broadcast = deps.broadcast || broadcastWS;
    this.deliveryDeps = { telegramChannel: deps.telegramChannel, broadcastWS: this.broadcast };
    this.hasSteerableTurn = deps.hasSteerableTurn || defaultHasSteerableTurn;
    this.steerActiveTurn = deps.steerActiveTurn || null;
    this.isRuntimeActive = deps.isRuntimeActive || defaultIsRuntimeActive;
    this.onSteersDelivered = deps.onSteersDelivered || defaultOnSteersDelivered;
    this.postReminder = deps.postReminder || defaultPostReminder;
    this.pushReminder = deps.pushReminder || defaultPushReminder;
  }

  start(): void {
    if (this.timer) return;
    this.subscribeSteerReads();
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.warn('[TimerRunner] tick failed:', err?.message || err));
    }, this.tickMs);
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
    this.tick().catch(() => {});
    console.log(`[TimerRunner] Started - ticking every ${this.tickMs}ms`);
  }

  /**
   * Stop firing timers. Keeps listening for timer steers already folded into a
   * running turn: a draining gateway (warm handoff) stops its schedulers but
   * still finishes its turns, and must still record those timers as delivered.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** stop() plus drop the delivery listener (tests / full teardown). */
  dispose(): void {
    this.stop();
    this.unsubscribeSteers?.();
    this.unsubscribeSteers = null;
  }

  /** Listen for steer delivery without starting the interval (tests drive tick() directly). */
  subscribeSteerReads(): void {
    if (this.unsubscribeSteers) return;
    this.unsubscribeSteers = this.onSteersDelivered((eventIds) => this.handleSteersDelivered(eventIds));
  }

  /** Timers folded into a running turn and not yet read by it. */
  listSteeredTimerIds(): string[] {
    return Array.from(this.steered.values()).map((entry) => entry.timer.id);
  }

  /** One scheduling pass. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Due timers stay pending through a queued restart and fire on the replacement.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        if (require('../runtime/gateway-restart-queue').isGatewayRestartDrainActive?.()) return;
      } catch { /* queue unavailable in isolated tests */ }
      this.reconcileSteeredTimers();
      this.startQueuedFallback();
      for (const timer of getDueMainChatTimers()) {
        if (!this.ownerGoalStillActive(timer)) continue;
        if (getMainChatTimerMode(timer) === 'notify') {
          await this.fireReminder(timer);
          continue;
        }
        if (this.trySteerIntoActiveTurn(timer)) continue;
        // One timer turn at a time. The rest wait for the next pass.
        if (this.runningTimerId) continue;
        // fireTimer claims and records the running timer before its first await,
        // so the next iteration already sees runningTimerId.
        void this.fireTimer(timer).catch((err) => console.warn('[TimerRunner] timer turn failed:', err?.message || err));
      }
    } finally {
      this.ticking = false;
    }
  }

  private ownerGoalStillActive(timer: MainChatTimer): boolean {
    if (!timer.origin?.goalId) return true;
    const goal = getMainChatGoal(timer.sessionId);
    if (goal && goal.id === timer.origin.goalId && !goal.userStoppedAt && goal.status === 'active') return true;
    updateMainChatTimer(timer.id, { status: 'cancelled', error: 'owning goal no longer active', completedAt: new Date().toISOString() });
    return false;
  }

  private async fireTimer(timer: MainChatTimer): Promise<void> {
    if (!this.ownerGoalStillActive(timer)) return;
    const firedAt = new Date().toISOString();
    // Claim it for this process. Null means it is no longer due: cancelled, or
    // already running in another gateway process (warm handoff). Do not run it.
    if (!claimMainChatTimerForRun(timer.id, firedAt)) return;
    await this.runTimerTurn(timer, firedAt);
  }

  /** Run an already-claimed timer as its own chat turn. */
  private async runTimerTurn(timer: MainChatTimer, firedAt: string): Promise<void> {
    this.runningTimerId = timer.id;
    setModelBusy(true);

    const firedUserMessage = [
      '[Timer fired]',
      `User asked earlier: ${timer.instruction}`,
      `Timer label: ${timer.label}`,
      `Scheduled for: ${timer.dueAt}`,
      'Proceed now as if the user just sent this request.',
      'When finished, reply directly with the actual outcome or acknowledgement. Do not show or quote this timer payload.',
    ].join('\n');

    this.broadcast({
      type: 'timer_fired',
      timer: { ...timer, status: 'running', firedAt },
      sessionId: timer.sessionId,
      delivery: 'turn',
    });

    const abortController = new AbortController();
    const abortSignal = { aborted: false, signal: abortController.signal };
    const sendSSE = (event: string, data: any) => {
      this.broadcast({
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
      if (abortSignal.aborted) {
        // The turn was cut off (watchdog, restart, user stop). Record that
        // instead of a silent "completed" with an empty preview.
        const reason = String((abortSignal as any).reason || (abortController.signal as any).reason || 'aborted');
        throw new Error(`Timer turn was interrupted before it finished (${reason.slice(0, 120)}). Say "continue" to resume it.`);
      }
      const completedTimer = updateMainChatTimer(timer.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        resultPreview: text.slice(0, 500),
      }) || timer;
      if (timer.delivery?.telegram === true && text) {
        await deliverToTargets({
          text,
          target: 'telegram',
          sessionId: timer.sessionId,
          source: 'timer_done',
        }, this.deliveryDeps).catch((err) => {
          console.warn('[TimerRunner] telegram delivery failed:', err?.message || err);
        });
      }
      this.broadcast({
        type: 'timer_done',
        timerId: timer.id,
        sessionId: timer.sessionId,
        timer: completedTimer,
        delivery: 'turn',
        voiceIfActive: timer.delivery?.voiceIfActive === true || timer.delivery?.voice_if_active === true,
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
      this.markFailed(timer, String(err?.message || err || 'Timer failed'));
    } finally {
      setModelBusy(false);
      this.runningTimerId = null;
    }
  }

  /**
   * Fold a due `run` timer into the turn already running in its chat. Returns
   * true when the timer needs nothing more from this pass.
   */
  private trySteerIntoActiveTurn(timer: MainChatTimer): boolean {
    // Goal continuations drive their own goal turn; telegram/voice delivery
    // needs the timer's own reply text. Those keep the separate-turn path.
    const steer = this.steerActiveTurn;
    if (!steer) return false;
    if (timer.origin?.goalId) return false;
    if (timer.delivery?.telegram === true || timer.delivery?.voiceIfActive === true || timer.delivery?.voice_if_active === true) return false;
    if (!this.hasSteerableTurn(timer.sessionId)) return false;

    const firedAt = new Date().toISOString();
    const claimed = claimMainChatTimerForRun(timer.id, firedAt);
    if (!claimed) return true; // cancelled, or another gateway owns it

    let result: TimerSteerResult;
    try {
      result = steer({
        sessionId: timer.sessionId,
        message: `User asked earlier: ${timer.instruction}`,
        displayMessage: `⏰ Timer: ${clip(timer.instruction, 280)}`,
        contextSummary: `Timer "${clip(timer.label, 120)}" (${timer.id}), scheduled for ${timer.dueAt}, fired at ${firedAt}.`,
        clientRequestId: `timer_fired:${timer.id}`,
      });
    } catch (err: any) {
      result = { ok: false, error: String(err?.message || err) };
    }
    if (!result.ok || !result.eventId || !result.runtimeId) {
      // The turn ended between the check and the steer. Hand the timer back so
      // the separate-turn path picks it up.
      updateMainChatTimer(timer.id, { status: 'due_waiting', firedAt: undefined, ownerPid: undefined, ownerStartedAt: undefined });
      return false;
    }
    this.steered.set(result.eventId, { timer: claimed, runtimeId: result.runtimeId, firedAt });
    this.broadcast({
      type: 'timer_fired',
      timer: claimed,
      sessionId: timer.sessionId,
      delivery: 'live_steer',
      runtimeId: result.runtimeId,
      eventId: result.eventId,
    });
    return true;
  }

  private handleSteersDelivered(eventIds: string[]): void {
    for (const eventId of eventIds) {
      const entry = this.steered.get(eventId);
      if (!entry) continue;
      this.steered.delete(eventId);
      try {
        const completed = updateMainChatTimer(entry.timer.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          resultPreview: 'Delivered into the turn that was already running in this chat.',
        }) || entry.timer;
        this.broadcast({
          type: 'timer_done',
          timerId: entry.timer.id,
          sessionId: entry.timer.sessionId,
          timer: completed,
          delivery: 'live_steer',
        });
      } catch (err: any) {
        console.warn('[TimerRunner] could not record steered timer as delivered:', err?.message || err);
      }
    }
  }

  /** A turn that ended without reading its timer steer hands the timer to the separate-turn path. */
  private reconcileSteeredTimers(): void {
    for (const [eventId, entry] of Array.from(this.steered.entries())) {
      if (this.isRuntimeActive(entry.runtimeId)) continue;
      this.steered.delete(eventId);
      this.fallbackQueue.push({ timer: entry.timer, firedAt: entry.firedAt });
      this.broadcast({
        type: 'timer_waiting',
        timer: entry.timer,
        sessionId: entry.timer.sessionId,
        reason: 'turn_ended_before_reading_timer',
      });
    }
  }

  private startQueuedFallback(): void {
    while (!this.runningTimerId && this.fallbackQueue.length) {
      const next = this.fallbackQueue.shift()!;
      const current = listMainChatTimers({ sessionId: next.timer.sessionId, includeDone: true })
        .find((timer) => timer.id === next.timer.id);
      // Cancelled or otherwise settled while it waited.
      if (!current || current.status !== 'running') continue;
      void this.runTimerTurn(current, next.firedAt).catch((err) => console.warn('[TimerRunner] fallback timer turn failed:', err?.message || err));
    }
  }

  /** `notify` timers: post the reminder and push it. No model call. */
  private async fireReminder(timer: MainChatTimer): Promise<void> {
    const firedAt = new Date().toISOString();
    const claimed = claimMainChatTimerForRun(timer.id, firedAt);
    if (!claimed) return;
    const text = `⏰ Reminder: ${timer.instruction}`;
    const message: TimerReminderMessage = {
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
      channel: 'system',
      channelLabel: 'timer',
      messageId: `timer-reminder:${timer.id}`,
      messageKind: 'timer_reminder',
    };
    this.broadcast({ type: 'timer_fired', timer: claimed, sessionId: timer.sessionId, delivery: 'notify' });
    try {
      // Save before marking done: a crash in between re-fires the timer, and
      // the messageId keeps that from posting twice.
      this.postReminder(timer.sessionId, message);
      const completed = updateMainChatTimer(timer.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        resultPreview: text.slice(0, 500),
      }) || claimed;
      this.broadcast({
        type: 'timer_done',
        timerId: timer.id,
        sessionId: timer.sessionId,
        timer: completed,
        delivery: 'notify',
        voiceIfActive: timer.delivery?.voiceIfActive === true || timer.delivery?.voice_if_active === true,
        message,
        result: text,
      });
    } catch (err: any) {
      this.markFailed(claimed, String(err?.message || err || 'Reminder failed'));
      return;
    }
    // Delivery side effects never decide the timer's outcome.
    Promise.resolve()
      .then(() => this.pushReminder(claimed, timer.instruction))
      .catch((err) => console.warn('[TimerRunner] reminder push failed:', err?.message || err));
    if (timer.delivery?.telegram === true) {
      deliverToTargets({ text, target: 'telegram', sessionId: timer.sessionId, source: 'timer_done' }, this.deliveryDeps)
        .catch((err) => console.warn('[TimerRunner] telegram delivery failed:', err?.message || err));
    }
  }

  private markFailed(timer: MainChatTimer, error: string): void {
    updateMainChatTimer(timer.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error,
    });
    this.broadcast({
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
  }
}
