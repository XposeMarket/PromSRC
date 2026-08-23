import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import { executeBrainThoughtTool, isBrainThoughtTool } from '../../brain/brain-thought-runtime.js';

export const brainThoughtCapabilityExecutor: CapabilityExecutor = {
  id: 'brain-thought',
  canHandle(name: string): boolean {
    return isBrainThoughtTool(name);
  },
  async execute(ctx: CapabilityExecutionContext) {
    const { name, args, sessionId } = ctx;
    try {
      return { name, args, result: executeBrainThoughtTool(sessionId, name, args), error: false };
    } catch (err: any) {
      return { name, args, result: `${name} failed: ${err?.message || String(err)}`, error: true };
    }
  },
};
