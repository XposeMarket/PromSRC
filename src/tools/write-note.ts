/**
 * write-note.ts — Intraday notes tool
 *
 * write_note: appends a timestamped note to today's intraday notes file.
 * Stored in workspace/memory/YYYY-MM-DD-intraday-notes.md
 * Intended for subagents and scheduled jobs to log observations, run summaries,
 * errors, and progress notes WITHOUT touching persona files (SOUL.md / USER.md).
 *
 * This is the correct tool for subagents to use instead of memory_read/memory_browse/persona_update.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config.js';
import { ToolResult } from '../types.js';

export async function executeWriteNote(args: {
  content: string;
  tag?: string;
}): Promise<ToolResult> {
  const content = String(args?.content || '').trim();
  if (!content) {
    return { success: false, error: 'content is required' };
  }

  const tag = args?.tag ? String(args.tag).trim().replace(/[^a-z0-9_\-]/gi, '') : '';

  try {
    const workspacePath = getConfig().getWorkspacePath();
    const memDir = path.join(workspacePath, 'memory');

    // Ensure memory directory exists
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }

    const today = new Date().toISOString().slice(0, 10);
    const notesPath = path.join(memDir, `${today}-intraday-notes.md`);

    const ts = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const tagStr = tag ? ` [${tag}]` : '';
    const entry = `[${ts}]${tagStr} ${content}\n`;

    fs.appendFileSync(notesPath, entry, 'utf-8');

    return {
      success: true,
      stdout: `Note written to ${today}-intraday-notes.md: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`,
      data: {
        file: `memory/${today}-intraday-notes.md`,
        tag: tag || undefined,
        timestamp: ts,
      },
    };
  } catch (err: any) {
    return { success: false, error: `write_note failed: ${err.message}` };
  }
}

export const writeNoteTool = {
  name: 'write_note',
  description:
    'Write a timestamped note to today\'s intraday notes file (workspace/memory/YYYY-MM-DD-intraday-notes.md). ' +
    'ONLY call this tool when there is genuinely something worth capturing for future reference: ' +
    '(1) during or after a scheduled/background task — log run summaries, errors, progress, or self-improvement observations; ' +
    '(2) when the user or AI completes something significant — e.g. a file was edited, a feature was built, a task finished, a decision was made; ' +
    '(3) when the user shares something that should be tracked across sessions but is too transient for permanent memory (current project state, last edits, what was just completed). ' +
    'Do NOT call this for: casual conversation, greetings, simple questions, one-line answers, purely informational replies, or any turn where nothing actionable or session-relevant occurred. ' +
    'Ask yourself: would a colleague need to know this to pick up where we left off? If no — skip it. ' +
    'Notes are scoped to today and auto-cleared the next day. ' +
    'This is the correct tool for subagents to record notes — do NOT use memory_read, memory_browse, persona_read, or persona_update for this purpose.',
  execute: executeWriteNote,
  schema: {
    content: 'string (required) — the note text to append',
    tag: 'string (optional) — short label for filtering, e.g. "news_harvester", "error", "summary"',
  },
  jsonSchema: {
    type: 'object',
    required: ['content'],
    properties: {
      content: {
        type: 'string',
        description: 'The note text to append to today\'s intraday notes file.',
      },
      tag: {
        type: 'string',
        description: 'Optional short label/category for this note (e.g. "news_harvester", "error", "run_summary")',
      },
    },
    additionalProperties: false,
  },
};
