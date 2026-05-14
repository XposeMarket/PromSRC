import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import type { ChatMessage, ContentPart, ModelUsage } from './LLMProvider';

export interface ModelUsageEvent {
  timestamp: string;
  provider: string;
  model: string;
  callType: 'chat' | 'generate';
  sessionId?: string;
  agentId?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  source: 'provider' | 'estimated';
  durationMs?: number;
}

function usageLogPath(): string {
  try {
    return path.join(getConfig().getConfigDir(), 'model-usage.jsonl');
  } catch {
    return path.join(process.cwd(), '.prometheus', 'model-usage.jsonl');
  }
}

function normalizeCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function contentToString(content: string | ContentPart[] | null | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content.map((part: any) => {
    if (part?.type === 'text') return String(part.text || '');
    if (part?.type === 'image_url') return '[image]';
    return '';
  }).filter(Boolean).join('\n');
}

export function estimateTextTokens(text: unknown): number {
  const value = String(text || '');
  if (!value) return 0;
  return Math.max(1, Math.ceil(value.length / 4));
}

export function estimateMessagesTokens(messages: ChatMessage[] | Array<any> | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, message: any) => {
    const roleCost = estimateTextTokens(message?.role || '');
    const contentCost = estimateTextTokens(contentToString(message?.content));
    const toolCost = Array.isArray(message?.tool_calls)
      ? estimateTextTokens(JSON.stringify(message.tool_calls))
      : 0;
    return sum + roleCost + contentCost + toolCost;
  }, 0);
}

export function normalizeUsage(usage: ModelUsage | undefined, fallback: {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}): Required<ModelUsage> {
  const inputTokens = normalizeCount(usage?.inputTokens ?? fallback.inputTokens);
  const outputTokens = normalizeCount(usage?.outputTokens ?? fallback.outputTokens);
  const reasoningTokens = normalizeCount(usage?.reasoningTokens ?? fallback.reasoningTokens);
  const cacheReadTokens = normalizeCount(usage?.cacheReadTokens);
  const cacheWriteTokens = normalizeCount(usage?.cacheWriteTokens);
  const explicitTotal = normalizeCount(usage?.totalTokens);
  const totalTokens = explicitTotal || inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    source: usage?.source || 'estimated',
  };
}

export function appendModelUsageEvent(event: Omit<ModelUsageEvent, 'timestamp'> & { timestamp?: string }): void {
  try {
    const full: ModelUsageEvent = {
      timestamp: event.timestamp || new Date().toISOString(),
      provider: String(event.provider || 'unknown'),
      model: String(event.model || 'unknown'),
      callType: event.callType,
      sessionId: event.sessionId,
      agentId: event.agentId,
      inputTokens: normalizeCount(event.inputTokens),
      outputTokens: normalizeCount(event.outputTokens),
      reasoningTokens: normalizeCount(event.reasoningTokens),
      cacheReadTokens: normalizeCount(event.cacheReadTokens),
      cacheWriteTokens: normalizeCount(event.cacheWriteTokens),
      totalTokens: normalizeCount(event.totalTokens),
      source: event.source || 'estimated',
      durationMs: normalizeCount(event.durationMs),
    };
    if (full.totalTokens <= 0) return;
    const filePath = usageLogPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(full) + '\n', 'utf-8');
  } catch {
    // Usage telemetry must never break a model call.
  }
}

export function readModelUsageEvents(): ModelUsageEvent[] {
  try {
    const filePath = usageLogPath();
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try { return JSON.parse(line) as ModelUsageEvent; } catch { return null; }
      })
      .filter((event): event is ModelUsageEvent => !!event);
  } catch {
    return [];
  }
}
