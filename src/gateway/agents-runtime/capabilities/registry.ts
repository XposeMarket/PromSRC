import { automationCapabilityExecutor } from './automation-executor';
import { memoryCapabilityExecutor } from './memory-executor';
import { platformCapabilityExecutor } from './platform-executor';
import { skillsCapabilityExecutor } from './skills-executor';
import { teamAgentCapabilityExecutor } from './team-agent-executor';
import { webMediaCapabilityExecutor } from './web-media-executor';
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

export async function executeRegisteredCapabilityTool(
  ctx: CapabilityExecutionContext,
): Promise<CapabilityDispatchResult> {
  const executor = CAPABILITY_EXECUTORS.find((candidate) => candidate.canHandle(ctx.name));
  if (!executor) return { handled: false };
  return {
    handled: true,
    result: await executor.execute(ctx),
  };
}

export function getRegisteredCapabilityExecutors(): readonly CapabilityExecutor[] {
  return CAPABILITY_EXECUTORS;
}
