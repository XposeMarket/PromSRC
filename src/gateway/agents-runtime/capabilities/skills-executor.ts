import fs from 'fs';
import { parseJsonLike, type ToolResult } from '../../tool-builder';
import { activateSkillForSession } from '../../session';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';

const SKILL_TOOL_NAMES = new Set([
  'skill_list',
  'skill_read',
  'skill_resource_list',
  'skill_resource_read',
  'skill_import_bundle',
  'skill_inspect',
  'skill_manifest_write',
  'skill_create_bundle',
  'skill_resource_write',
  'skill_resource_delete',
  'skill_export_bundle',
  'skill_update_from_source',
  'skill_create',
]);

function splitCsv(value: any): string[] {
  return Array.isArray(value)
    ? value.map((v: any) => String(v || '').trim()).filter(Boolean)
    : String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function stripSkillEmojiFrontmatter(content: string): string {
  const raw = String(content || '');
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return raw;
  const frontmatter = raw.slice(0, end)
    .split('\n')
    .filter((line) => !/^\s*emoji\s*:/i.test(line))
    .join('\n');
  return frontmatter + raw.slice(end);
}

export const skillsCapabilityExecutor: CapabilityExecutor = {
  id: 'skills',

  canHandle(name: string): boolean {
    return SKILL_TOOL_NAMES.has(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, deps, sessionId } = ctx;

    switch (name) {
      case 'skill_list': {
        deps.skillsManager.scanSkills();
        const all = deps.skillsManager.getAll();
        if (all.length === 0) {
          return { name, args, result: 'No skills installed yet. Use skill_create to save a new one.', error: false };
        }
        const slLines = all.map((s: any) => {
          const bits = [
            `${s.id}`,
            s.kind === 'bundle' ? `v${s.version} [bundle: ${(s.resources || []).length} resources]` : '[simple]',
            Array.isArray(s.requiredTools) && s.requiredTools.length ? `[tools: ${s.requiredTools.join(',')}]` : '',
            Array.isArray(s.triggers) && s.triggers.length ? `[triggers: ${s.triggers.join(',')}]` : '',
            `- ${s.description || '(no description)'}`,
          ].filter(Boolean);
          return bits.join(' ');
        }).join('\n');
        return {
          name, args,
          result: `${all.length} skill${all.length !== 1 ? 's' : ''} available:\n${slLines}\n\nTo read a skill: skill_read("<id>")\nFor bundled resources: skill_resource_list("<id>") then skill_resource_read(id, path)\nFor metadata/provenance: skill_inspect("<id>")\nTo install a downloaded bundle: skill_import_bundle(source)\nTo enrich imported bundle metadata: skill_manifest_write(id, manifest)\nTo maintain bundle resources: skill_resource_write(id, path, content) or skill_resource_delete(id, path)\nTo export/update bundles: skill_export_bundle(id), skill_update_from_source(id)\nTo save a bundle skill: skill_create_bundle(...)\nTo save a simple one-file skill: skill_create(id, name, instructions, ...)`,
          error: false,
        };
      }

      case 'skill_read': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) {
          return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        }
        activateSkillForSession(sessionId, skill.id);
        try {
          const content = stripSkillEmojiFrontmatter(fs.readFileSync(skill.filePath, 'utf-8'));
          const resourceLines = Array.isArray(skill.resources) && skill.resources.length
            ? [
              '',
              'Resources:',
              ...skill.resources.map((r: any) => `- ${r.path} (${r.type})${r.description ? ` - ${r.description}` : ''}`),
              '',
              `Use skill_resource_read({"id":"${skill.id}","path":"<resource path>"}) to load a resource.`,
            ].join('\n')
            : '';
          const manifestLines = [
            `${skill.name} (${skill.id}) ${skill.kind === 'bundle' ? `v${skill.version} bundle` : 'simple skill'}`,
            skill.description ? `Description: ${skill.description}` : '',
            Array.isArray(skill.requiredTools) && skill.requiredTools.length ? `Required tools: ${skill.requiredTools.join(', ')}` : '',
            skill.status && skill.status !== 'ready' ? `Status: ${skill.status}` : '',
            skill.validation && !skill.validation.ok ? `Validation errors: ${skill.validation.errors.join('; ')}` : '',
            resourceLines,
          ].filter(Boolean).join('\n');
          return { name, args, result: `${manifestLines}\n\nInstructions:\n${content}`, error: false };
        } catch {
          return { name, args, result: `${skill.name} (${skillId})\n\n${skill.instructions}`, error: false };
        }
      }

      case 'skill_resource_list': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        const resources = deps.skillsManager.listResources(skillId);
        if (!resources.length) return { name, args, result: `Skill "${skill.id}" has no declared or discovered resources.`, error: false };
        const lines = resources.map((r: any) => {
          const size = Number.isFinite(Number(r.sizeBytes)) ? `, ${r.sizeBytes} bytes` : '';
          return `- ${r.path} (${r.type}${size})${r.description ? ` - ${r.description}` : ''}`;
        }).join('\n');
        return {
          name, args,
          result: `Resources for ${skill.name} (${skill.id}):\n${lines}\n\nRead one with skill_resource_read({"id":"${skill.id}","path":"<resource path>"}).`,
          error: false,
        };
      }

      case 'skill_resource_read': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required.', error: true };
        if (!resourcePath) return { name, args, result: 'ERROR: path is required.', error: true };
        const maxChars = args.max_chars ? Number(args.max_chars) : undefined;
        const result = deps.skillsManager.readResource(skillId, resourcePath, Number.isFinite(maxChars) ? maxChars : undefined);
        if (!result.ok) return { name, args, result: `skill_resource_read failed: ${result.error}`, error: true };
        const skill = deps.skillsManager.get(skillId);
        activateSkillForSession(sessionId, skill?.id || skillId);
        return {
          name, args,
          result: `Resource ${skillId}/${result.path}${result.truncated ? ' (truncated)' : ''}:\n\n${result.content}`,
          error: false,
        };
      }

      case 'skill_import_bundle': {
        const source = String(args.source || args.url || args.path || '').trim();
        if (!source) return { name, args, result: 'skill_import_bundle: source is required (directory, .zip path, GitHub tree URL, or https URL to a .zip).', error: true };
        try {
          const imported = await deps.skillsManager.importBundles(source, {
            id: args.id ? String(args.id) : undefined,
            overwrite: args.overwrite === true,
          });
          const lines = imported.map((skill: any) =>
            `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources) - ${skill.description || skill.name}`
          ).join('\n');
          return {
            name, args,
            result: `Imported ${imported.length} skill${imported.length !== 1 ? 's' : ''}:\n${lines}\n\nUse skill_read("<id>") to inspect one.`,
            error: false,
          };
        } catch (importErr: any) {
          return { name, args, result: `skill_import_bundle failed: ${importErr.message}`, error: true };
        }
      }

      case 'skill_inspect': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const inspection = deps.skillsManager.inspect(skillId);
        if (!inspection) return { name, args, result: `Skill "${skillId}" not found.`, error: true };
        return {
          name, args,
          result: JSON.stringify(inspection, null, 2),
          error: false,
        };
      }

      case 'skill_manifest_write': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required.', error: true };
        const manifestArg = args.manifest;
        const manifest = typeof manifestArg === 'string' ? parseJsonLike(manifestArg) : manifestArg;
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
          return { name, args, result: 'ERROR: manifest must be an object or JSON object string.', error: true };
        }
        try {
          const updated = deps.skillsManager.writeManifestOverlay(skillId, manifest, {
            changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : undefined,
            evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
            appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          });
          return {
            name, args,
            result: `Wrote manifest overlay for ${updated.name} (${updated.id}) at ${updated.overlayPath || '(overlay path unavailable)'}. Manifest source: ${updated.manifestSource}.`,
            error: false,
          };
        } catch (manifestErr: any) {
          return { name, args, result: `skill_manifest_write failed: ${manifestErr.message}`, error: true };
        }
      }

      case 'skill_create_bundle': {
        const scId = String(args.id || '').trim();
        const scName = String(args.name || '').trim();
        const scInstructions = String(args.instructions || '').trim();
        if (!scId) return { name, args, result: 'skill_create_bundle: id is required', error: true };
        if (!scName) return { name, args, result: 'skill_create_bundle: name is required', error: true };
        if (!scInstructions) return { name, args, result: 'skill_create_bundle: instructions is required', error: true };
        try {
          const skill = deps.skillsManager.createBundle({
            id: scId,
            name: scName,
            description: args.description ? String(args.description).trim() : '',
            instructions: scInstructions,
            version: args.version ? String(args.version) : undefined,
            triggers: splitCsv(args.triggers),
            categories: splitCsv(args.categories),
            requiredTools: splitCsv(args.requiredTools || args.required_tools),
            permissions: args.permissions && typeof args.permissions === 'object' ? args.permissions : undefined,
            resources: Array.isArray(args.resources) ? args.resources : [],
            overwrite: args.overwrite === true,
          });
          return {
            name, args,
            result: `Bundle skill "${skill.name}" created at ${skill.rootDir}. Resources: ${skill.resources.length}. Use skill_read("${skill.id}") to inspect it.`,
            error: false,
          };
        } catch (bundleErr: any) {
          return { name, args, result: `skill_create_bundle failed: ${bundleErr.message}`, error: true };
        }
      }

      case 'skill_resource_write': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        const content = String(args.content ?? '');
        if (!skillId) return { name, args, result: 'skill_resource_write: id is required', error: true };
        if (!resourcePath) return { name, args, result: 'skill_resource_write: path is required', error: true };
        try {
          const updated = deps.skillsManager.writeResource(skillId, resourcePath, content, {
            type: args.type ? String(args.type) : undefined,
            description: args.description ? String(args.description) : undefined,
            addToManifest: args.addToManifest !== false,
            change: {
              changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : undefined,
              evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
              appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
              reason: args.reason ? String(args.reason) : undefined,
            },
          });
          return {
            name, args,
            result: `Wrote ${resourcePath} in skill "${updated.id}". Resources now: ${updated.resources.length}.`,
            error: false,
          };
        } catch (resourceErr: any) {
          return { name, args, result: `skill_resource_write failed: ${resourceErr.message}`, error: true };
        }
      }

      case 'skill_resource_delete': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        if (!skillId) return { name, args, result: 'skill_resource_delete: id is required', error: true };
        if (!resourcePath) return { name, args, result: 'skill_resource_delete: path is required', error: true };
        try {
          const updated = deps.skillsManager.deleteResource(skillId, resourcePath, {
            removeFromManifest: args.removeFromManifest !== false,
          });
          return {
            name, args,
            result: `Deleted ${resourcePath} from skill "${updated.id}". Resources now: ${updated.resources.length}.`,
            error: false,
          };
        } catch (deleteErr: any) {
          return { name, args, result: `skill_resource_delete failed: ${deleteErr.message}`, error: true };
        }
      }

      case 'skill_export_bundle': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_export_bundle: id is required', error: true };
        try {
          const exported = await deps.skillsManager.exportBundle(skillId, args.outputPath ? String(args.outputPath) : undefined);
          return {
            name, args,
            result: `Exported skill "${skillId}" to ${exported.path} (${exported.bytes} bytes).`,
            error: false,
          };
        } catch (exportErr: any) {
          return { name, args, result: `skill_export_bundle failed: ${exportErr.message}`, error: true };
        }
      }

      case 'skill_update_from_source': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_update_from_source: id is required', error: true };
        try {
          const updated = await deps.skillsManager.updateFromSource(skillId, { overwrite: args.overwrite !== false });
          const lines = updated.map((skill: any) => `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources)`).join('\n');
          return {
            name, args,
            result: `Updated ${updated.length} skill${updated.length !== 1 ? 's' : ''} from stored source:\n${lines}`,
            error: false,
          };
        } catch (updateErr: any) {
          return { name, args, result: `skill_update_from_source failed: ${updateErr.message}`, error: true };
        }
      }

      case 'skill_create': {
        const scId = String(args.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const scName = String(args.name || '').trim();
        const scInstructions = String(args.instructions || '').trim();
        if (!scId) return { name, args, result: 'skill_create: id is required', error: true };
        if (!scName) return { name, args, result: 'skill_create: name is required', error: true };
        if (!scInstructions) return { name, args, result: 'skill_create: instructions is required', error: true };
        try {
          const scSkill = deps.skillsManager.createSkill({
            id: scId,
            name: scName,
            description: args.description ? String(args.description).trim() : '',
            instructions: scInstructions,
          });
          return {
            name, args,
            result: `Skill "${scSkill.name}" created at ${scSkill.filePath}.\nUse skill_read("${scSkill.id}") to verify it, or skill_list() to see all skills.`,
            error: false,
          };
        } catch (scErr: any) {
          return { name, args, result: `skill_create failed: ${scErr.message}`, error: true };
        }
      }

      default:
        return { name, args, result: `Unhandled skill tool: ${name}`, error: true };
    }
  },
};
