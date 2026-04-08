/**
 * evidence-bus-tool.ts
 *
 * Provides the `write_evidence` tool for workers and sub-agents to write
 * structured findings to the shared per-task evidence bus.
 *
 * Usage: call createEvidenceBusTool(taskId, stepIndex) to get a tool object
 * that can be registered with the tool registry for a specific task session.
 *
 * The bus is task-scoped: all agents participating in the same task share it.
 * The Manager reads the full bus when composing each step ExecutionBrief.
 */

import type { ToolResult } from '../types';
import {
  writeToEvidenceBus,
  isDedupKeyPresent,
  type EvidenceCategory,
} from '../gateway/tasks/task-store';

const VALID_CATEGORIES: EvidenceCategory[] = [
  'finding',
  'decision',
  'artifact',
  'error',
  'dedup_key',
];

export interface EvidenceBusToolArgs {
  category: string;
  value: string;
  key?: string;
  confidence?: number;
}

/**
 * Creates a write_evidence tool bound to a specific task and step.
 * Returns a tool object compatible with the SmallClaw tool registry.
 */
export function createEvidenceBusTool(taskId: string, stepIndex: number, agentId?: string) {
  return {
    name: 'write_evidence',
    description: [
      'Write a structured finding or fact to the shared task evidence bus.',
      'Use this to record important discoveries, decisions, artifacts, errors, or deduplication keys.',
      'The Manager reads the bus when planning each step — write findings here to share them across agents and runs.',
      '',
      'category options:',
      '  finding   — A discovered fact or piece of information.',
      '  decision  — A choice you made during execution.',
      '  artifact  — A file path, URL, or output reference.',
      '  error     — Something that failed (helps with retry context).',
      '  dedup_key — A key/value to prevent duplicate actions (e.g. already-posted tweet IDs).',
      '',
      'For dedup_key: set key= to the list name (e.g. "posted_tweet_ids") and value= to the new item.',
    ].join('\n'),
    schema: {
      category: 'string',
      value: 'string',
      key: 'string (optional)',
      confidence: 'number (optional, 0.0–1.0)',
    },
    jsonSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: VALID_CATEGORIES,
          description: 'Type of evidence entry.',
        },
        value: {
          type: 'string',
          description: 'The finding, fact, artifact path, or dedup value. Max 1000 chars.',
        },
        key: {
          type: 'string',
          description: 'Optional lookup key. Required for dedup_key category (e.g. "posted_tweet_ids").',
        },
        confidence: {
          type: 'number',
          description: 'Optional confidence score 0.0–1.0 for findings.',
        },
      },
      required: ['category', 'value'],
    },
    async execute(args: EvidenceBusToolArgs): Promise<ToolResult> {
      const category = String(args.category || '').trim() as EvidenceCategory;
      if (!VALID_CATEGORIES.includes(category)) {
        return {
          success: false,
          error: `Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`,
        };
      }

      const value = String(args.value || '').trim();
      if (!value) {
        return { success: false, error: 'value must not be empty.' };
      }

      const key = args.key ? String(args.key).trim() : undefined;

      if (category === 'dedup_key' && !key) {
        return { success: false, error: 'key is required for dedup_key category.' };
      }

      const confidence = typeof args.confidence === 'number'
        ? Math.min(1, Math.max(0, args.confidence))
        : undefined;

      // For dedup_key entries, check if the value already exists
      if (category === 'dedup_key' && key) {
        if (isDedupKeyPresent(taskId, key, value)) {
          return {
            success: true,
            stdout: `Dedup key "${key}" already contains "${value.slice(0, 80)}" — no duplicate written.`,
          };
        }
      }

      try {
        const entry = writeToEvidenceBus(taskId, {
          agentId,
          stepIndex,
          category,
          key,
          value,
          confidence,
        });

        const keyNote = key ? ` (key=${key})` : '';
        return {
          success: true,
          stdout: `Evidence written [${category}]${keyNote}: "${value.slice(0, 120)}" (id=${entry.id})`,
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Failed to write evidence: ${String(err?.message || err)}`,
        };
      }
    },
  };
}
