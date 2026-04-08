// src/gateway/teams/notify-bridge.ts
// CIS Phase 2 — Manager → Main Chat notification bridge.
//
// Teams write completion events here. Events are:
//   1. Persisted to pending.json (survives gateway restarts)
//   2. Immediately pushed via WebSocket broadcast (live delivery — no user message needed)
//
// Fix: setNotifyBroadcastFn() wires the WS push at boot so team events
// arrive in the UI the moment they fire, not when the user next chats.

import fs from 'fs';
import path from 'path';

// ─── Live push function (injected at boot by server-v2.ts) ───────────────────

let _broadcastFn: ((data: object) => void) | null = null;

export function setNotifyBroadcastFn(fn: (data: object) => void): void {
  _broadcastFn = fn;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotifyEventType =
  | 'team_report_ready'
  | 'team_task_complete'
  | 'team_error'
  | 'analysis_ready';

export interface PendingEvent {
  id: string;
  type: NotifyEventType;
  teamId: string;
  teamName?: string;
  payload: Record<string, any>;
  createdAt: string; // ISO
}

export interface PendingEventStore {
  events: PendingEvent[];
}

// ─── Path ─────────────────────────────────────────────────────────────────────

function getEventsPath(workspacePath: string): string {
  return path.join(workspacePath, 'events', 'pending.json');
}

// ─── Read / Write ─────────────────────────────────────────────────────────────

function readStore(workspacePath: string): PendingEventStore {
  try {
    const p = getEventsPath(workspacePath);
    if (!fs.existsSync(p)) return { events: [] };
    const raw = fs.readFileSync(p, 'utf-8').trim();
    if (!raw || raw === '{}') return { events: [] };
    const parsed = JSON.parse(raw);
    return { events: Array.isArray(parsed.events) ? parsed.events : [] };
  } catch {
    return { events: [] };
  }
}

function writeStore(workspacePath: string, store: PendingEventStore): void {
  const p = getEventsPath(workspacePath);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Push a completion event from a team manager into the pending queue.
 * Called by deploy-analysis-team.ts and team-manager-runner.ts after work completes.
 */
export function notifyMainAgent(
  workspacePath: string,
  teamId: string,
  eventType: NotifyEventType,
  payload: Record<string, any>,
  teamName?: string,
  originatingSessionId?: string,
): PendingEvent {
  const store = readStore(workspacePath);
  const event: PendingEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type: eventType,
    teamId,
    teamName,
    payload,
    createdAt: new Date().toISOString(),
  };
  store.events = [...store.events, event].slice(-50);
  writeStore(workspacePath, store);
  console.log(`[notify-bridge] Event queued: ${eventType} from team ${teamId}`);

  // Live push via WebSocket — arrives in UI immediately, no user message needed
  if (_broadcastFn) {
    try {
      _broadcastFn({
        type: 'team_event',
        message: formatEventMessage(event),
        eventType: event.type,
        teamId: event.teamId,
        teamName: event.teamName,
        payload: event.payload,
        originatingSessionId: originatingSessionId || undefined,
      });
      console.log(`[notify-bridge] Live push sent for ${eventType}`);
    } catch (err: any) {
      console.warn(`[notify-bridge] Live push failed (event still in queue): ${err?.message}`);
    }
  }

  return event;
}

/**
 * Drain all pending events — returns them and clears the queue.
 * Called by server-v2.ts on each response cycle.
 */
export function drainPendingEvents(workspacePath: string): PendingEvent[] {
  const store = readStore(workspacePath);
  if (store.events.length === 0) return [];
  const events = [...store.events];
  writeStore(workspacePath, { events: [] });
  return events;
}

/**
 * Peek at pending events without clearing — used for status checks.
 */
export function peekPendingEvents(workspacePath: string): PendingEvent[] {
  return readStore(workspacePath).events;
}

/**
 * Format a pending event into a human-readable message for injection into chat.
 */
export function formatEventMessage(event: PendingEvent): string {
  const name = event.teamName ? `"${event.teamName}"` : event.teamId;
  switch (event.type) {
    case 'team_report_ready':
    case 'analysis_ready': {
      const reportPath = event.payload.reportPath || event.payload.report_path || '';
      const url = event.payload.url || '';
      const summary = event.payload.summary || '';
      return [
        `📊 **Analysis complete** — team ${name} has finished.`,
        url ? `Site: ${url}` : '',
        summary ? `Summary: ${summary}` : '',
        reportPath ? `Report saved to: ${reportPath}` : '',
      ].filter(Boolean).join('\n');
    }
    case 'team_task_complete': {
      if (event.payload?.reason === 'goal_complete') {
        const managerMessage = String(event.payload.managerMessage || '').trim();
        const turns = Number(event.payload.turns || 0);
        const preview = managerMessage ? managerMessage.slice(0, 400) : '';
        return [
          `🎯 **Team goal complete** — ${name}`,
          turns > 0 ? `Turns: ${turns}` : '',
          preview ? `Manager summary: ${preview}` : '',
        ].filter(Boolean).join('\n');
      }
      const task = event.payload.task || '';
      const result = event.payload.result || '';
      return [
        `✅ **Team task complete** — ${name}`,
        task ? `Task: ${task}` : '',
        result ? `Result: ${result.slice(0, 400)}` : '',
      ].filter(Boolean).join('\n');
    }
    case 'team_error': {
      const error = event.payload.error || 'Unknown error';
      return `⚠️ **Team error** — ${name}: ${error}`;
    }
    default:
      return `📬 Event from team ${name}: ${event.type}`;
  }
}
