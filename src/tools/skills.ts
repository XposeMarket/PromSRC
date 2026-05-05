/**
 * src/tools/skills.ts
 *
 * Skill helpers for the read-as-needed runtime:
 *   skill_list   - see what's available
 *   skill_read   - read a skill's SKILL.md by id
 *   skill_create - write a new skill to workspace/skills/<id>/SKILL.md
 *
 * Rich bundle skill tools (skill_resource_list/read/write/delete,
 * skill_import_bundle, skill_inspect, skill_manifest_write,
 * skill_create_bundle, skill_export_bundle, skill_update_from_source) are
 * core runtime tools implemented in subagent-executor.ts.
 */

import fs from 'fs';
import { ToolResult } from '../types.js';
import { SkillsManager } from '../gateway/skills-runtime/skills-manager.js';

export async function executeSkillList(
  _args: { compact?: boolean },
  skillsManager: SkillsManager,
): Promise<ToolResult> {
  skillsManager.scanSkills();
  const list = skillsManager.getCompactList();
  return {
    success: true,
    stdout: `Skills in ${skillsManager.getSkillsDir()}:\n\n${list}\n\nUse skill_read(id) to read the relevant SKILL.md.`,
  };
}

export async function executeSkillRead(
  args: { id: string },
  skillsManager: SkillsManager,
): Promise<ToolResult> {
  const id = String(args.id || '').trim();
  if (!id) return { success: false, error: 'id is required' };

  skillsManager.scanSkills();
  const skill = skillsManager.get(id);
  if (!skill) {
    return {
      success: false,
      error: `Skill "${id}" not found. Call skill_list to see available skills.`,
    };
  }

  try {
    return {
      success: true,
      stdout: fs.readFileSync(skill.filePath, 'utf-8'),
    };
  } catch {
    return {
      success: true,
      stdout: skill.instructions,
    };
  }
}

export async function executeSkillCreate(
  args: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    emoji?: string;
    triggers?: string;
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
        `Use skill_read("${skill.id}") when the skill is relevant.`,
    };
  } catch (e: any) {
    return { success: false, error: `skill_create failed: ${e.message}` };
  }
}

export const skillListTool = {
  name: 'skill_list',
  description: 'List available skills in the workspace, including bundle metadata and resources when available.',
  schema: { compact: 'boolean (optional)' },
};

export const skillReadTool = {
  name: 'skill_read',
  description: 'Read a skill by id. Returns the full SKILL.md instructions plus bundle resource hints when available.',
  schema: { id: 'string (required) - skill id from skill_list' },
};

export const skillCreateTool = {
  name: 'skill_create',
  description: 'Create a simple one-file skill and save it to workspace/skills/. For reusable workflows with resources, schemas, templates, or examples, prefer skill_create_bundle.',
  schema: {
    id: 'string (required) - kebab-case id, e.g. "python-debugger"',
    name: 'string (required) - human-readable name',
    description: 'string (required) - one-sentence description',
    instructions: 'string (required) - full markdown instructions for using this skill',
    emoji: 'string (optional)',
    triggers: 'string (optional) - comma-separated keywords for discovery metadata',
  },
};
