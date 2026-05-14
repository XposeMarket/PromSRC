import fs from 'fs';
import path from 'path';
import os from 'os';
import type { SkillPermissions } from './skill-package';
import type { SkillSafetyScan } from './skill-safety';

export interface SkillRequires {
  tools?: string[];
  toolCategories?: string[];
  connectors?: string[];
  env?: string[];
  bins?: string[];
  platforms?: string[];
  permissions?: Array<keyof SkillPermissions | string>;
}

export interface SkillAssignment {
  assignedAgents?: string[];
  assignedTeams?: string[];
  preferredAgent?: string;
}

export interface SkillToolBinding {
  requiredTools?: string[];
  recommendedToolCategories?: string[];
  defaultWorkflow?: string[];
  canSpawnSubagents?: boolean;
}

export interface SkillEligibility {
  status: 'ready' | 'needs_setup' | 'blocked' | 'quarantined' | 'unsupported';
  missing: {
    tools: string[];
    toolCategories: string[];
    connectors: string[];
    env: string[];
    bins: string[];
    permissions: string[];
  };
  reasons: string[];
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

function normalizePlatform(raw: string): string {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'mac' || v === 'macos' || v === 'darwin') return 'darwin';
  if (v === 'win' || v === 'windows' || v === 'win32') return 'win32';
  if (v === 'linux') return 'linux';
  return v;
}

function hasBin(binName: string): boolean {
  const raw = String(binName || '').trim();
  if (!raw) return false;
  const pathEnv = process.env.PATH || '';
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, raw + ext);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
      } catch {}
    }
  }
  return false;
}

export function normalizeRequires(value: unknown): SkillRequires {
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    tools: asArray(obj.tools || obj.requiredTools),
    toolCategories: asArray(obj.toolCategories || obj.tool_categories || obj.categories),
    connectors: asArray(obj.connectors),
    env: asArray(obj.env || obj.environment || obj.requiredEnvironment),
    bins: asArray(obj.bins || obj.commands || obj.requiredBins),
    platforms: asArray(obj.platforms || obj.os).map(normalizePlatform),
    permissions: asArray(obj.permissions),
  };
}

export function normalizeAssignment(value: unknown): SkillAssignment {
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    assignedAgents: asArray(obj.assignedAgents || obj.assigned_agents || obj.agents),
    assignedTeams: asArray(obj.assignedTeams || obj.assigned_teams || obj.teams),
    preferredAgent: String(obj.preferredAgent || obj.preferred_agent || '').trim() || undefined,
  };
}

export function normalizeToolBinding(value: unknown, requiredTools: string[] = []): SkillToolBinding {
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    requiredTools: asArray(obj.requiredTools || obj.required_tools).concat(requiredTools).filter((v, i, a) => a.indexOf(v) === i),
    recommendedToolCategories: asArray(obj.recommendedToolCategories || obj.recommended_tool_categories),
    defaultWorkflow: asArray(obj.defaultWorkflow || obj.default_workflow || obj.workflow),
    canSpawnSubagents: obj.canSpawnSubagents === true || obj.can_spawn_subagents === true,
  };
}

export function resolveSkillEligibility(params: {
  status?: string;
  safety?: SkillSafetyScan;
  requires?: SkillRequires;
  permissions?: SkillPermissions;
  availableTools?: string[];
  availableConnectors?: string[];
  availableToolCategories?: string[];
}): SkillEligibility {
  const req = params.requires || {};
  const availableTools = new Set((params.availableTools || []).map((v) => v.toLowerCase()));
  const availableConnectors = new Set((params.availableConnectors || []).map((v) => v.toLowerCase()));
  const availableToolCategories = new Set((params.availableToolCategories || []).map((v) => v.toLowerCase()));
  const missing = {
    tools: [] as string[],
    toolCategories: [] as string[],
    connectors: [] as string[],
    env: [] as string[],
    bins: [] as string[],
    permissions: [] as string[],
  };
  const reasons: string[] = [];

  const platforms = (req.platforms || []).map(normalizePlatform).filter(Boolean);
  if (platforms.length && !platforms.includes(process.platform)) {
    return {
      status: 'unsupported',
      missing,
      reasons: [`Unsupported on ${os.platform()}; skill requires ${platforms.join(', ')}`],
    };
  }

  for (const envName of req.env || []) {
    if (!process.env[envName]) missing.env.push(envName);
  }
  for (const bin of req.bins || []) {
    if (!hasBin(bin)) missing.bins.push(bin);
  }
  for (const tool of req.tools || []) {
    if (availableTools.size > 0 && !availableTools.has(tool.toLowerCase())) missing.tools.push(tool);
  }
  for (const cat of req.toolCategories || []) {
    if (availableToolCategories.size > 0 && !availableToolCategories.has(cat.toLowerCase())) missing.toolCategories.push(cat);
  }
  for (const connector of req.connectors || []) {
    if (availableConnectors.size > 0 && !availableConnectors.has(connector.toLowerCase())) missing.connectors.push(connector);
  }
  for (const permission of req.permissions || []) {
    const key = permission as keyof SkillPermissions;
    if (params.permissions && params.permissions[key] === false) missing.permissions.push(String(permission));
  }

  if (params.safety?.verdict === 'critical') {
    reasons.push('Skill has critical safety findings and is quarantined until reviewed.');
    return { status: 'quarantined', missing, reasons };
  }

  if (String(params.status || '').toLowerCase() === 'blocked') {
    reasons.push('Skill manifest marks this skill as blocked.');
    return { status: 'blocked', missing, reasons };
  }

  const missingCount = Object.values(missing).reduce((sum, items) => sum + items.length, 0);
  if (missingCount > 0 || String(params.status || '').toLowerCase() === 'needs_setup') {
    for (const [kind, items] of Object.entries(missing)) {
      if (items.length) reasons.push(`Missing ${kind}: ${items.join(', ')}`);
    }
    if (String(params.status || '').toLowerCase() === 'needs_setup' && !reasons.length) {
      reasons.push('Skill manifest marks this skill as needing setup.');
    }
    return { status: 'needs_setup', missing, reasons };
  }

  return { status: 'ready', missing, reasons };
}
