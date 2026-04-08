/**
 * src/tools/skills.ts
 *
 * Simple skill tools the AI uses directly:
 *   skill_list   — see what's available
 *   skill_enable — activate a skill, get its full instructions back
 *   skill_disable — deactivate when done
 *   skill_create  — write a new skill to workspace/skills/<id>/SKILL.md
 *
 * Auto-scan happens in executeAutoMatchSkills(), called from server-v2.ts
 * before each tool dispatch.
 */

import { ToolResult } from '../types.js';
import { SkillsManager } from '../gateway/skills-runtime/skills-manager.js';

// ─── Skill activation window (per session) ───────────────────────────────────

export interface SkillWindow {
  triggeredAtTurn: number;   // history.length when enabled
  lastActiveAtTurn: number;  // updated each turn the skill is present
  reassessCount: number;     // consecutive turns without disable after turn 2
}

// ─── skill_list ───────────────────────────────────────────────────────────────

export async function executeSkillList(
  args: { compact?: boolean },
  skillsManager: SkillsManager,
): Promise<ToolResult> {
  skillsManager.scanSkills(); // always fresh
  const list = skillsManager.getCompactList();
  return {
    success: true,
    stdout: `Skills in ${skillsManager.getSkillsDir()}:\n\n${list}\n\nUse skill_enable(id) to activate one.`,
  };
}

// ─── skill_enable ─────────────────────────────────────────────────────────────

export async function executeSkillEnable(
  args: { id: string },
  skillsManager: SkillsManager,
  activationWindows: Map<string, Map<string, SkillWindow>>,
  sessionId: string,
  turnNumber: number,
): Promise<ToolResult> {
  skillsManager.scanSkills();
  const skill = skillsManager.get(args.id);
  if (!skill) {
    return {
      success: false,
      error: `Skill "${args.id}" not found. Call skill_list to see available skills.`,
    };
  }

  // Register activation window
  if (!activationWindows.has(sessionId)) activationWindows.set(sessionId, new Map());
  activationWindows.get(sessionId)!.set(args.id, {
    triggeredAtTurn: turnNumber,
    lastActiveAtTurn: turnNumber,
    reassessCount: 0,
  });

  const body = skill.instructions.length > 2000
    ? skill.instructions.slice(0, 2000) + '\n...(see full SKILL.md in workspace/skills/' + args.id + '/)'
    : skill.instructions;

  return {
    success: true,
    stdout: `Skill "${skill.name}" is now active for this task.\n\n${skill.emoji} **${skill.name}**\n\n${body}\n\nCall skill_disable("${args.id}") when this task is complete.`,
  };
}

// ─── skill_disable ────────────────────────────────────────────────────────────

export async function executeSkillDisable(
  args: { id: string },
  activationWindows: Map<string, Map<string, SkillWindow>>,
  sessionId: string,
): Promise<ToolResult> {
  const sessionWindows = activationWindows.get(sessionId);
  if (!sessionWindows?.has(args.id)) {
    return { success: true, stdout: `Skill "${args.id}" was not active.` };
  }
  sessionWindows.delete(args.id);
  return { success: true, stdout: `Skill "${args.id}" deactivated.` };
}

// ─── skill_create ─────────────────────────────────────────────────────────────

export async function executeSkillCreate(
  args: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    emoji?: string;
    triggers?: string; // comma-separated keywords
  },
  skillsManager: SkillsManager,
): Promise<ToolResult> {
  if (!args.id?.trim()) return { success: false, error: 'id is required' };
  if (!args.name?.trim()) return { success: false, error: 'name is required' };
  if (!args.instructions?.trim()) return { success: false, error: 'instructions is required' };

  try {
    const triggers = args.triggers
      ? args.triggers.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      : [];

    const skill = skillsManager.createSkill({
      id: args.id,
      name: args.name,
      description: args.description || '',
      emoji: args.emoji,
      triggers,
      instructions: args.instructions,
    });

    return {
      success: true,
      stdout: `Skill "${skill.name}" created at ${skill.filePath}.\n\n` +
        `Triggers: ${triggers.length ? triggers.join(', ') : 'none (always-on when enabled)'}\n` +
        `Use skill_enable("${skill.id}") to activate it now, or it will auto-enable when triggers match.`,
    };
  } catch (e: any) {
    return { success: false, error: `skill_create failed: ${e.message}` };
  }
}

// ─── Auto-match: called before each tool dispatch ─────────────────────────────

/**
 * Check if any installed skills have triggers matching the current tool name
 * or recent message. If so, auto-enable them for this session.
 *
 * Returns the list of skill IDs that were newly auto-enabled (so server-v2
 * can log/notify).
 */
export function executeAutoMatchSkills(
  toolName: string,
  messageText: string,
  skillsManager: SkillsManager,
  activationWindows: Map<string, Map<string, SkillWindow>>,
  sessionId: string,
  turnNumber: number,
): string[] {
  const matches = skillsManager.findMatchingSkills(toolName, messageText);
  if (!matches.length) return [];

  if (!activationWindows.has(sessionId)) activationWindows.set(sessionId, new Map());
  const sessionWindows = activationWindows.get(sessionId)!;

  const newlyEnabled: string[] = [];
  for (const id of matches) {
    if (!sessionWindows.has(id)) {
      sessionWindows.set(id, {
        triggeredAtTurn: turnNumber,
        lastActiveAtTurn: turnNumber,
        reassessCount: 0,
      });
      newlyEnabled.push(id);
      console.log(`[Skills] Auto-enabled "${id}" (matched tool: ${toolName})`);
    }
  }
  return newlyEnabled;
}

// ─── Tool export objects (for registry) ───────────────────────────────────────

export const skillListTool = {
  name: 'skill_list',
  description: 'List available skills in the workspace. Always call this before skill_enable.',
  schema: { compact: 'boolean (optional)' },
};

export const skillEnableTool = {
  name: 'skill_enable',
  description: 'Activate a skill for the current task. Returns the full skill instructions.',
  schema: { id: 'string (required) — skill id from skill_list' },
};

export const skillDisableTool = {
  name: 'skill_disable',
  description: 'Deactivate a skill when its task is complete. Always call this when done.',
  schema: { id: 'string (required)' },
};

export const skillCreateTool = {
  name: 'skill_create',
  description: 'Create a new skill and save it to workspace/skills/. Use this when you develop a reusable workflow, technique, or procedure that would be useful for future tasks.',
  schema: {
    id: 'string (required) — kebab-case id, e.g. "python-debugger"',
    name: 'string (required) — human-readable name',
    description: 'string (required) — one-sentence description',
    instructions: 'string (required) — full markdown instructions for using this skill',
    emoji: 'string (optional) — single emoji',
    triggers: 'string (optional) — comma-separated keywords that auto-activate this skill, e.g. "python,debug,error"',
  },
};
