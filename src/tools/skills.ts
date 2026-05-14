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
import { resolveSkillsRoot } from '../skills/store.js';
import { getConfig } from '../config/config.js';
import { scanSkillDirectory } from '../gateway/skills-runtime/skill-safety.js';
import {
  applySkillCuratorSuggestion,
  listSkillCuratorSuggestions,
  rejectSkillCuratorSuggestion,
  runSkillCurator,
  type SkillCuratorMode,
} from '../gateway/skills-runtime/skill-curator.js';

let defaultSkillsManager: SkillsManager | null = null;

function getDefaultSkillsManager(): SkillsManager {
  if (!defaultSkillsManager) defaultSkillsManager = new SkillsManager(resolveSkillsRoot());
  return defaultSkillsManager;
}

function parseCsv(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function skillOk(stdout: string, data?: any): ToolResult {
  return { success: true, stdout, ...(data !== undefined ? { data } : {}) };
}

function skillErr(error: string): ToolResult {
  return { success: false, error };
}

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
  execute: (args: any) => executeSkillList(args, getDefaultSkillsManager()),
  schema: { compact: 'boolean (optional)' },
  jsonSchema: { type: 'object', properties: {}, additionalProperties: true },
};

export const skillReadTool = {
  name: 'skill_read',
  description: 'Read a skill by id. Returns the full SKILL.md instructions plus bundle resource hints when available.',
  execute: (args: any) => executeSkillRead(args, getDefaultSkillsManager()),
  schema: { id: 'string (required) - skill id from skill_list' },
  jsonSchema: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', description: 'Skill ID from skill_list.' } },
    additionalProperties: true,
  },
};

export const skillCreateTool = {
  name: 'skill_create',
  description: 'Create a simple one-file skill and save it to workspace/skills/. For reusable workflows with resources, schemas, templates, or examples, prefer skill_create_bundle.',
  execute: (args: any) => executeSkillCreate(args, getDefaultSkillsManager()),
  schema: {
    id: 'string (required) - kebab-case id, e.g. "python-debugger"',
    name: 'string (required) - human-readable name',
    description: 'string (required) - one-sentence description',
    instructions: 'string (required) - full markdown instructions for using this skill',
    emoji: 'string (optional)',
    triggers: 'string (optional) - comma-separated keywords for discovery metadata',
  },
  jsonSchema: {
    type: 'object',
    required: ['id', 'name', 'instructions'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      instructions: { type: 'string' },
      emoji: { type: 'string' },
      triggers: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const skillResourceListTool = {
  name: 'skill_resource_list',
  description: 'List templates, schemas, examples, docs, and other text resources bundled with a skill.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    if (!id) return skillErr('id is required. Call skill_list first.');
    sm.scanSkills();
    const skill = sm.get(id);
    if (!skill) return skillErr(`Skill "${id}" not found.`);
    const resources = sm.listResources(id);
    if (!resources.length) return skillOk(`Skill "${skill.id}" has no declared or discovered resources.`);
    const lines = resources.map((r: any) => `- ${r.path} (${r.type || 'resource'})${r.description ? ` - ${r.description}` : ''}`);
    return skillOk(`Resources for ${skill.name} (${skill.id}):\n${lines.join('\n')}`);
  },
  schema: { id: 'string (required) - skill id from skill_list' },
  jsonSchema: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
    additionalProperties: true,
  },
};

export const skillResourceReadTool = {
  name: 'skill_resource_read',
  description: 'Read a text resource from inside a bundled skill. Use paths from skill_resource_list.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    const resourcePath = String(args?.path || args?.resource_path || '').trim();
    const maxChars = Number(args?.max_chars ?? args?.maxChars);
    if (!id) return skillErr('id is required.');
    if (!resourcePath) return skillErr('path is required.');
    sm.scanSkills();
    const result = sm.readResource(id, resourcePath, Number.isFinite(maxChars) ? maxChars : undefined);
    if (!result.ok) return skillErr(result.error);
    return skillOk(`Resource ${id}/${result.path}${result.truncated ? ' (truncated)' : ''}:\n\n${result.content}`);
  },
  schema: {
    id: 'string (required) - skill id from skill_list',
    path: 'string (required) - resource path from skill_resource_list',
    max_chars: 'number (optional) - explicit cap; omit to return the full resource',
  },
  jsonSchema: {
    type: 'object',
    required: ['id', 'path'],
    properties: {
      id: { type: 'string' },
      path: { type: 'string' },
      max_chars: { type: 'number' },
    },
    additionalProperties: true,
  },
};

export const skillInspectTool = {
  name: 'skill_inspect',
  description: 'Inspect normalized skill metadata, resources, provenance, required tools, permissions, and validation.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    if (!id) return skillErr('id is required. Call skill_list first.');
    sm.scanSkills();
    const inspection = sm.inspect(id);
    if (!inspection) return skillErr(`Skill "${id}" not found.`);
    return skillOk(JSON.stringify(inspection, null, 2), inspection);
  },
  schema: { id: 'string (required) - skill id from skill_list' },
  jsonSchema: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
    additionalProperties: true,
  },
};

export const skillImportBundleTool = {
  name: 'skill_import_bundle',
  description: 'Install skill bundle(s) from a local directory, zip, HTTPS zip URL, or GitHub tree URL.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const source = String(args?.source || '').trim();
    if (!source) return skillErr('source is required.');
    try {
      const imported = await sm.importBundles(source, {
        id: args?.id ? String(args.id) : undefined,
        overwrite: args?.overwrite === true,
      });
      const lines = imported.map((skill: any) => `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources) - ${skill.description || skill.name}`);
      return skillOk(`Imported ${imported.length} skill${imported.length !== 1 ? 's' : ''}:\n${lines.join('\n')}`, imported);
    } catch (err: any) {
      return skillErr(`skill_import_bundle failed: ${err.message}`);
    }
  },
  schema: {
    source: 'string (required) - directory path, zip path, HTTPS zip URL, or GitHub tree URL',
    id: 'string (optional) - override ID for a single skill bundle',
    overwrite: 'boolean (optional) - replace existing skill',
  },
  jsonSchema: {
    type: 'object',
    required: ['source'],
    properties: {
      source: { type: 'string' },
      id: { type: 'string' },
      overwrite: { type: 'boolean' },
    },
    additionalProperties: true,
  },
};

export const skillManifestWriteTool = {
  name: 'skill_manifest_write',
  description: 'Write a Prometheus-owned manifest overlay for an installed skill.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    const manifest = args?.manifest && typeof args.manifest === 'object' ? args.manifest : null;
    if (!id) return skillErr('id is required.');
    if (!manifest) return skillErr('manifest object is required.');
    try {
      const updated = sm.writeManifestOverlay(id, manifest);
      return skillOk(`Updated manifest overlay for skill "${updated.id}".`, updated);
    } catch (err: any) {
      return skillErr(`skill_manifest_write failed: ${err.message}`);
    }
  },
  schema: {
    id: 'string (required) - installed skill id',
    manifest: 'json object (required) - manifest overlay',
  },
  jsonSchema: {
    type: 'object',
    required: ['id', 'manifest'],
    properties: {
      id: { type: 'string' },
      manifest: { type: 'object' },
    },
    additionalProperties: true,
  },
};

export const skillCreateBundleTool = {
  name: 'skill_create_bundle',
  description: 'Create a bundled skill with SKILL.md, skill.json, optional resources, metadata, and permissions.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || '').trim();
    const name = String(args?.name || '').trim();
    const instructions = String(args?.instructions || '').trim();
    if (!id) return skillErr('id is required.');
    if (!name) return skillErr('name is required.');
    if (!instructions) return skillErr('instructions is required.');
    try {
      const skill = sm.createBundle({
        id,
        name,
        description: String(args?.description || '').trim(),
        instructions,
        emoji: args?.emoji ? String(args.emoji) : undefined,
        version: args?.version ? String(args.version) : undefined,
        triggers: parseCsv(args?.triggers),
        categories: parseCsv(args?.categories),
        requiredTools: parseCsv(args?.requiredTools || args?.required_tools),
        requires: args?.requires && typeof args.requires === 'object' ? args.requires : undefined,
        assignment: args?.assignment && typeof args.assignment === 'object' ? args.assignment : undefined,
        toolBinding: args?.toolBinding && typeof args.toolBinding === 'object' ? args.toolBinding : undefined,
        permissions: args?.permissions && typeof args.permissions === 'object' ? args.permissions : undefined,
        resources: Array.isArray(args?.resources) ? args.resources : undefined,
        overwrite: args?.overwrite === true,
      });
      return skillOk(`Bundle skill "${skill.name}" created at ${skill.rootDir}. Resources: ${skill.resources.length}.`, skill);
    } catch (err: any) {
      return skillErr(`skill_create_bundle failed: ${err.message}`);
    }
  },
  schema: {
    id: 'string (required) - unique kebab-case skill id',
    name: 'string (required) - human readable name',
    instructions: 'string (required) - full SKILL.md instructions',
    resources: 'json array (optional) - resource objects with path/content/type/description',
  },
  jsonSchema: {
    type: 'object',
    required: ['id', 'name', 'instructions'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      instructions: { type: 'string' },
      emoji: { type: 'string' },
      version: { type: 'string' },
      triggers: { type: 'string' },
      categories: { type: 'string' },
      requiredTools: { type: 'string' },
      requires: { type: 'object' },
      assignment: { type: 'object' },
      toolBinding: { type: 'object' },
      permissions: { type: 'object' },
      resources: { type: 'array' },
      overwrite: { type: 'boolean' },
    },
    additionalProperties: true,
  },
};

export const skillResourceWriteTool = {
  name: 'skill_resource_write',
  description: 'Create or update a text resource inside an installed skill bundle.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    const resourcePath = String(args?.path || args?.resource_path || '').trim();
    if (!id) return skillErr('id is required.');
    if (!resourcePath) return skillErr('path is required.');
    try {
      const updated = sm.writeResource(id, resourcePath, String(args?.content || ''), {
        type: args?.type ? String(args.type) : undefined,
        description: args?.description ? String(args.description) : undefined,
        addToManifest: args?.addToManifest !== false && args?.add_to_manifest !== false,
      });
      return skillOk(`Wrote ${resourcePath} in skill "${updated.id}". Resources now: ${updated.resources.length}.`, updated);
    } catch (err: any) {
      return skillErr(`skill_resource_write failed: ${err.message}`);
    }
  },
  schema: {
    id: 'string (required) - installed skill id',
    path: 'string (required) - resource path',
    content: 'string (required) - text content',
  },
  jsonSchema: {
    type: 'object',
    required: ['id', 'path', 'content'],
    properties: {
      id: { type: 'string' },
      path: { type: 'string' },
      content: { type: 'string' },
      type: { type: 'string' },
      description: { type: 'string' },
      addToManifest: { type: 'boolean' },
    },
    additionalProperties: true,
  },
};

export const skillResourceDeleteTool = {
  name: 'skill_resource_delete',
  description: 'Delete a resource inside an installed skill bundle.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    const resourcePath = String(args?.path || args?.resource_path || '').trim();
    if (!id) return skillErr('id is required.');
    if (!resourcePath) return skillErr('path is required.');
    try {
      const updated = sm.deleteResource(id, resourcePath, {
        removeFromManifest: args?.removeFromManifest !== false && args?.remove_from_manifest !== false,
      });
      return skillOk(`Deleted ${resourcePath} from skill "${updated.id}". Resources now: ${updated.resources.length}.`, updated);
    } catch (err: any) {
      return skillErr(`skill_resource_delete failed: ${err.message}`);
    }
  },
  schema: {
    id: 'string (required) - installed skill id',
    path: 'string (required) - resource path from skill_resource_list',
  },
  jsonSchema: {
    type: 'object',
    required: ['id', 'path'],
    properties: {
      id: { type: 'string' },
      path: { type: 'string' },
      removeFromManifest: { type: 'boolean' },
    },
    additionalProperties: true,
  },
};

export const skillExportBundleTool = {
  name: 'skill_export_bundle',
  description: 'Export an installed skill as a zip bundle.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    if (!id) return skillErr('id is required.');
    try {
      const exported = await sm.exportBundle(id, args?.outputPath ? String(args.outputPath) : undefined);
      return skillOk(`Exported skill "${id}" to ${exported.path} (${exported.bytes} bytes).`, exported);
    } catch (err: any) {
      return skillErr(`skill_export_bundle failed: ${err.message}`);
    }
  },
  schema: {
    id: 'string (required) - installed skill id',
    outputPath: 'string (optional) - output zip path',
  },
  jsonSchema: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
      outputPath: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const skillUpdateFromSourceTool = {
  name: 'skill_update_from_source',
  description: 'Refresh an imported skill from its stored provenance source.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    if (!id) return skillErr('id is required.');
    try {
      const updated = await sm.updateFromSource(id, { overwrite: args?.overwrite !== false });
      const lines = updated.map((skill: any) => `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources)`);
      return skillOk(`Updated ${updated.length} skill${updated.length !== 1 ? 's' : ''} from stored source:\n${lines.join('\n')}`, updated);
    } catch (err: any) {
      return skillErr(`skill_update_from_source failed: ${err.message}`);
    }
  },
  schema: {
    id: 'string (required) - installed skill id',
    overwrite: 'boolean (optional) - overwrite imported folder, default true',
  },
  jsonSchema: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
      overwrite: { type: 'boolean' },
    },
    additionalProperties: true,
  },
};

export const skillScanTool = {
  name: 'skill_scan',
  description: 'Run the Prometheus skill safety scanner against an installed skill.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const id = String(args?.id || args?.skill_id || '').trim();
    if (!id) return skillErr('id is required.');
    sm.scanSkills();
    const skill = sm.get(id);
    if (!skill) return skillErr(`Skill "${id}" not found.`);
    const scan = scanSkillDirectory(skill.rootDir);
    return skillOk(JSON.stringify(scan, null, 2), scan);
  },
  schema: { id: 'string (required) - installed skill id' },
  jsonSchema: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
    additionalProperties: true,
  },
};

export const skillCuratorTool = {
  name: 'skill_curator',
  description: 'Inspect or run the dedicated Brain Skill Curator. Actions: status, run, apply, reject.',
  execute: async (args: any): Promise<ToolResult> => {
    const sm = getDefaultSkillsManager();
    const workspacePath = getConfig().getWorkspacePath();
    const action = String(args?.action || 'status').trim().toLowerCase();
    try {
      if (action === 'status') {
        const suggestions = listSkillCuratorSuggestions(workspacePath);
        return skillOk(JSON.stringify({ suggestions }, null, 2), { suggestions });
      }
      if (action === 'run') {
        const rawMode = String(args?.mode || 'pending').trim();
        const mode: SkillCuratorMode = rawMode === 'dry-run' || rawMode === 'auto-safe' ? rawMode : 'pending';
        const result = runSkillCurator({ workspacePath, skillsManager: sm, mode });
        return skillOk(JSON.stringify(result, null, 2), result);
      }
      if (action === 'apply') {
        const id = String(args?.id || '').trim();
        if (!id) return skillErr('id is required for apply.');
        const result = applySkillCuratorSuggestion(workspacePath, sm, id);
        if (!result) return skillErr(`Suggestion "${id}" not found.`);
        return skillOk(`Applied skill curator suggestion ${id}.`, result);
      }
      if (action === 'reject') {
        const id = String(args?.id || '').trim();
        if (!id) return skillErr('id is required for reject.');
        const result = rejectSkillCuratorSuggestion(workspacePath, id);
        if (!result) return skillErr(`Suggestion "${id}" not found.`);
        return skillOk(`Rejected skill curator suggestion ${id}.`, result);
      }
      return skillErr(`Unknown skill_curator action: ${action}`);
    } catch (err: any) {
      return skillErr(`skill_curator failed: ${err.message}`);
    }
  },
  schema: {
    action: 'status|run|apply|reject',
    mode: 'dry-run|pending|auto-safe (for action=run)',
    id: 'string (for apply/reject)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      mode: { type: 'string' },
      id: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const allSkillTools = [
  skillListTool,
  skillReadTool,
  skillResourceListTool,
  skillResourceReadTool,
  skillImportBundleTool,
  skillInspectTool,
  skillManifestWriteTool,
  skillCreateBundleTool,
  skillResourceWriteTool,
  skillResourceDeleteTool,
  skillExportBundleTool,
  skillUpdateFromSourceTool,
  skillScanTool,
  skillCuratorTool,
  skillCreateTool,
];

export async function executeSkillTool(name: string, args: any = {}): Promise<ToolResult> {
  const tool = allSkillTools.find((candidate) => candidate.name === name);
  if (!tool) return skillErr(`Unknown skill tool: ${name}`);
  return tool.execute(args || {});
}
