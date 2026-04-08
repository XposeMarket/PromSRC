/**
 * schedule-memory-tool.ts — update_schedule_memory tool
 *
 * Allows background tasks to write learned context, dedup keys, and notes
 * into the schedule's persistent memory. This is the post-task memory
 * extraction tool referenced in the Jarvis roadmap analysis.
 *
 * Used in the final step of scheduled task runs to capture:
 *   - Navigation shortcuts discovered
 *   - Content processed (as dedup keys to avoid repeats)
 *   - Outcome summaries
 *   - Any other learnings for the next run
 */

import { addDedupKey, addLearnedContext, setNote, loadScheduleMemory } from '../gateway/scheduling/schedule-memory.js';
import type { ToolResult } from '../types.js';

export interface ScheduleMemoryUpdateArgs {
  schedule_id: string;
  updates: Array<{
    type: 'dedup_key' | 'learned_context' | 'note';
    key?: string;          // required for dedup_key and note
    value: string;
  }>;
}

export async function executeUpdateScheduleMemory(args: ScheduleMemoryUpdateArgs): Promise<ToolResult> {
  if (!args?.schedule_id?.trim()) {
    return { success: false, error: 'schedule_id is required' };
  }

  if (!Array.isArray(args.updates) || args.updates.length === 0) {
    return { success: false, error: 'updates must be a non-empty array' };
  }

  const scheduleId = String(args.schedule_id).trim();
  const results: string[] = [];
  let written = 0;
  let skipped = 0;

  for (const update of args.updates.slice(0, 20)) { // max 20 updates per call
    const type = String(update.type || '').trim();
    const value = String(update.value || '').trim();
    const key = String(update.key || '').trim();

    if (!value) {
      skipped++;
      continue;
    }

    try {
      if (type === 'dedup_key') {
        if (!key) { skipped++; continue; }
        const added = addDedupKey(scheduleId, key, value);
        if (added) {
          results.push(`dedup_key[${key}]: added "${value.slice(0, 50)}"`);
          written++;
        } else {
          results.push(`dedup_key[${key}]: already present — skipped`);
          skipped++;
        }
      } else if (type === 'learned_context') {
        addLearnedContext(scheduleId, value);
        results.push(`learned_context: "${value.slice(0, 60)}"`);
        written++;
      } else if (type === 'note') {
        if (!key) { skipped++; continue; }
        setNote(scheduleId, key, value);
        results.push(`note[${key}]: "${value.slice(0, 60)}"`);
        written++;
      } else {
        results.push(`unknown type "${type}" — skipped`);
        skipped++;
      }
    } catch (err: any) {
      results.push(`error writing ${type}: ${err.message}`);
      skipped++;
    }
  }

  const mem = loadScheduleMemory(scheduleId);
  const summary = mem
    ? `Memory state: ${mem.learnedContext.length} learned items, ${Object.keys(mem.dedup).length} dedup keys, ${Object.keys(mem.notes).length} notes`
    : 'Memory not found';

  return {
    success: true,
    data: { written, skipped, schedule_id: scheduleId },
    stdout: `Updated schedule memory for ${scheduleId}:\n${results.join('\n')}\n\n${summary}`,
  };
}

export const scheduleMemoryTool = {
  name: 'update_schedule_memory',
  description:
    'Write facts, shortcuts, and dedup keys to this schedule\'s persistent memory. ' +
    'Use this at the end of scheduled task runs to capture what was learned: navigation shortcuts, ' +
    'URLs that worked, content IDs to avoid repeating, and any other context for the next run. ' +
    'Memory persists across all future runs of this schedule.',
  schema: {
    schedule_id: 'string (required) — the schedule/job ID this task belongs to',
    updates: 'array of {type, key?, value} objects to write to memory',
  },
  execute: executeUpdateScheduleMemory,
  jsonSchema: {
    type: 'object',
    required: ['schedule_id', 'updates'],
    properties: {
      schedule_id: {
        type: 'string',
        description: 'The schedule ID (job ID) to write memory for. Available in task context as scheduleId.',
      },
      updates: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'value'],
          properties: {
            type: {
              type: 'string',
              enum: ['dedup_key', 'learned_context', 'note'],
              description: 'dedup_key: store an ID to avoid repeating (e.g. tweet ID). learned_context: store a shortcut or insight. note: store a key=value pair.',
            },
            key: {
              type: 'string',
              description: 'Required for dedup_key and note types. The key/category name.',
            },
            value: {
              type: 'string',
              description: 'The value to store. For dedup_key: the ID. For learned_context: the insight. For note: the value.',
            },
          },
          additionalProperties: false,
        },
        description: 'List of memory updates to apply.',
        maxItems: 20,
      },
    },
    additionalProperties: false,
  },
};
