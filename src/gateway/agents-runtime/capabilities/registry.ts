import { automationCapabilityExecutor } from './automation-executor';
import { memoryCapabilityExecutor } from './memory-executor';
import { platformCapabilityExecutor } from './platform-executor';
import { skillsCapabilityExecutor } from './skills-executor';
import { teamAgentCapabilityExecutor } from './team-agent-executor';
import { webMediaCapabilityExecutor } from './web-media-executor';
import { estimateTextTokensForModel } from '../../context/model-context';
import type {
  CapabilityDispatchResult,
  CapabilityExecutionContext,
  CapabilityExecutor,
} from './types';

const CAPABILITY_EXECUTORS: CapabilityExecutor[] = [
  skillsCapabilityExecutor,
  automationCapabilityExecutor,
  teamAgentCapabilityExecutor,
  memoryCapabilityExecutor,
  platformCapabilityExecutor,
  webMediaCapabilityExecutor,
];

function attachCapabilityTelemetry(result: any, ctx: CapabilityExecutionContext, startedAt: number): any {
  const finishedAt = Date.now();
  const argsText = (() => { try { return JSON.stringify(ctx.args || {}); } catch { return String(ctx.args || ''); } })();
  const resultText = String(result?.result ?? result?.stdout ?? result?.data ?? result?.error ?? '');
  const argsTokens = estimateTextTokensForModel(argsText, 'openai');
  const resultTokens = estimateTextTokensForModel(resultText, 'openai');
  const telemetry = {
    ...(result?.extra?.telemetry || {}),
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    argsChars: argsText.length,
    resultChars: resultText.length,
    resultBytes: Buffer.byteLength(resultText, 'utf8'),
    argsTokens,
    resultTokens,
    totalTokens: argsTokens + resultTokens,
  };
  return { ...result, extra: { ...(result?.extra || {}), telemetry } };
}

export async function executeRegisteredCapabilityTool(
  ctx: CapabilityExecutionContext,
): Promise<CapabilityDispatchResult> {
  const executor = CAPABILITY_EXECUTORS.find((candidate) => candidate.canHandle(ctx.name));
  if (!executor) return { handled: false };
  const startedAt = Date.now();
  return {
    handled: true,
    result: attachCapabilityTelemetry(await executor.execute(ctx), ctx, startedAt),
  };
}

export function getRegisteredCapabilityExecutors(): readonly CapabilityExecutor[] {
  return CAPABILITY_EXECUTORS;
}
