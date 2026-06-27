import fs from 'fs';
import path from 'path';

export type AgentProfilePackIssueSeverity = 'error' | 'warning' | 'info';

export interface AgentProfilePackIssue {
  severity: AgentProfilePackIssueSeverity;
  code: string;
  message: string;
  file?: string;
}

export interface AgentProfilePackPreview {
  success: boolean;
  packPath: string;
  root: string;
  manifest: any;
  profile: any;
  agent: any;
  skills: Array<{ slug: string; path: string; exists: boolean }>;
  provenance: Record<string, any>;
  scanner: {
    status: 'passed' | 'warning' | 'failed';
    checkedFiles: number;
    issues: AgentProfilePackIssue[];
  };
  installPlan: {
    agentId: string;
    agentWorkspace: string;
    files: Array<{ source: string; target: string; action: 'copy' | 'write' }>;
    skills: Array<{ slug: string; source: string; target: string; action: 'copy_directory' }>;
  };
}

export interface InstallAgentProfilePackOptions {
  packPath: string;
  workspacePath: string;
  skillsDir?: string;
  overwrite?: boolean;
}

export interface InstallAgentProfilePackResult {
  preview: AgentProfilePackPreview;
  agent: any;
  copiedFiles: string[];
  copiedSkills: string[];
  installRecordPath: string;
}

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.svg', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.toml', '.ini', '.cfg', '.conf', '.xml', '.csv', '.log',
]);

const SECRET_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
  { code: 'private_key', pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/i, message: 'Private key material detected.' },
  { code: 'env_secret', pattern: /\b(?:api[_-]?key|secret|token|password|refresh[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}/i, message: 'Token-shaped secret assignment detected.' },
  { code: 'aws_key', pattern: /\bAKIA[0-9A-Z]{16}\b/, message: 'AWS access key pattern detected.' },
  { code: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/, message: 'GitHub token pattern detected.' },
  { code: 'openai_key', pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/, message: 'OpenAI-style API key pattern detected.' },
];

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseScalar(raw: string): any {
  const value = raw.trim();
  if (value === '') return '';
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseScalar(part.trim()));
  }
  return value;
}

export function parseAgentProfileYaml(text: string): any {
  const root: any = {};
  const stack: Array<{ indent: number; value: any; pendingKey?: string }> = [{ indent: -1, value: root }];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)?.[0].length || 0;
    const trimmed = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    let parent = stack[stack.length - 1].value;

    if (trimmed.startsWith('- ')) {
      const itemText = trimmed.slice(2).trim();
      const frame = stack[stack.length - 1];
      if (!Array.isArray(parent)) {
        const grand = stack[stack.length - 2]?.value;
        const key = frame.pendingKey;
        if (!grand || !key) throw new Error(`Invalid YAML list near: ${rawLine}`);
        parent = [];
        grand[key] = parent;
        frame.value = parent;
      }
      if (itemText.includes(': ')) {
        const [key, ...rest] = itemText.split(':');
        const obj: any = { [key.trim()]: parseScalar(rest.join(':').trim()) };
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }

    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const rest = trimmed.slice(idx + 1).trim();
    if (!isPlainObject(parent)) throw new Error(`Invalid YAML object key near: ${rawLine}`);
    if (rest === '') {
      const child: any = {};
      parent[key] = child;
      stack.push({ indent, value: child, pendingKey: key });
    } else {
      parent[key] = parseScalar(rest);
    }
  }

  return root;
}

function safeSlug(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent-profile-pack';
}

function ensureInside(child: string, parent: string, label: string): string {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  const rel = path.relative(resolvedParent, resolvedChild);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${label} must stay inside ${resolvedParent}`);
  }
  return resolvedChild;
}

export function resolveAgentProfilePackPath(inputPath: string, workspacePath: string): string {
  const raw = String(inputPath || '').trim();
  if (!raw) throw new Error('pack path is required');
  const workspace = path.resolve(workspacePath || process.cwd());
  let candidate = raw;
  if (!path.isAbsolute(candidate)) {
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
    candidate = normalized === 'workspace' || normalized.startsWith('workspace/')
      ? path.join(workspace, normalized.replace(/^workspace\/?/, ''))
      : path.join(workspace, candidate);
  }
  const resolved = ensureInside(candidate, workspace, 'Agent Profile Pack path');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Agent Profile Pack directory not found: ${resolved}`);
  }
  return resolved;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readManifest(packRoot: string): any {
  const manifestPath = path.join(packRoot, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) throw new Error('manifest.yaml is required');
  return parseAgentProfileYaml(fs.readFileSync(manifestPath, 'utf-8'));
}

function resolvePackFile(packRoot: string, relPath: any, label: string): string {
  const rel = String(relPath || '').trim();
  if (!rel) throw new Error(`${label} path is required`);
  return ensureInside(path.join(packRoot, rel), packRoot, label);
}

function walkFiles(root: string, maxFiles = 700): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    if (out.length >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(full);
      if (out.length >= maxFiles) return;
    }
  };
  visit(root);
  return out;
}

function scanPack(packRoot: string): AgentProfilePackPreview['scanner'] {
  const issues: AgentProfilePackIssue[] = [];
  const files = walkFiles(packRoot);
  for (const filePath of files) {
    const rel = path.relative(packRoot, filePath).replace(/\\/g, '/');
    const base = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    if (base === '.env' || base.endsWith('.pem') || base.endsWith('.key')) {
      issues.push({ severity: 'error', code: 'blocked_file_type', message: 'Credential-like files are not allowed in profile packs.', file: rel });
    }
    if (stat.size > 2_000_000) {
      issues.push({ severity: 'warning', code: 'large_file', message: 'Large file should be reviewed before marketplace publishing.', file: rel });
    }
    if (!TEXT_EXTENSIONS.has(ext) || stat.size > 500_000) continue;
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.pattern.test(text)) {
        issues.push({ severity: 'error', code: pattern.code, message: pattern.message, file: rel });
      }
    }
  }
  const hasError = issues.some((issue) => issue.severity === 'error');
  const hasWarning = issues.some((issue) => issue.severity === 'warning');
  return { status: hasError ? 'failed' : hasWarning ? 'warning' : 'passed', checkedFiles: files.length, issues };
}

function copyDirectory(source: string, target: string): string[] {
  const copied: string[] = [];
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dest = path.join(target, entry.name);
    if (entry.isDirectory()) copied.push(...copyDirectory(src, dest));
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(dest);
    }
  }
  return copied;
}

export function previewAgentProfilePack(inputPath: string, workspacePath: string, skillsDir?: string): AgentProfilePackPreview {
  const root = resolveAgentProfilePackPath(inputPath, workspacePath);
  const manifest = readManifest(root);
  const issues: AgentProfilePackIssue[] = [];
  if (manifest.schema !== 'ai.agent.profile.v1') issues.push({ severity: 'error', code: 'unsupported_schema', message: 'Only ai.agent.profile.v1 packs are supported.' });
  if (!manifest.id) issues.push({ severity: 'error', code: 'missing_id', message: 'manifest.id is required.' });
  if (!manifest.name) issues.push({ severity: 'error', code: 'missing_name', message: 'manifest.name is required.' });

  const profilePath = resolvePackFile(root, manifest?.harnessTargets?.prometheus?.profile || 'harness/prometheus/subagent.profile.json', 'Prometheus profile');
  if (!fs.existsSync(profilePath)) throw new Error(`Prometheus profile not found: ${profilePath}`);
  const profile = readJson(profilePath);
  const agentId = safeSlug(profile.id || manifest.slug || manifest.id);
  const personaRel = String(profile.personaPath || manifest?.persona?.system_prompt || 'prompts/persona.md');
  const personaPath = resolvePackFile(root, personaRel, 'Persona prompt');
  if (!fs.existsSync(personaPath)) issues.push({ severity: 'error', code: 'missing_persona', message: `Persona prompt not found: ${personaRel}`, file: personaRel });

  const skillEntries = Array.isArray(manifest.skills) ? manifest.skills : [];
  const skills: AgentProfilePackPreview['skills'] = skillEntries.map((entry: any) => {
    const slug = safeSlug(entry?.slug || entry?.name || entry?.path);
    const rel = String(entry?.path || `skills/${slug}`).trim();
    const source = resolvePackFile(root, rel, `Skill ${slug}`);
    return { slug, path: source, exists: fs.existsSync(source) && fs.statSync(source).isDirectory() };
  });
  for (const skill of skills) {
    if (!skill.exists) issues.push({ severity: 'error', code: 'missing_skill', message: `Skill directory not found for ${skill.slug}`, file: path.relative(root, skill.path).replace(/\\/g, '/') });
  }

  const scanner = scanPack(root);
  scanner.issues.unshift(...issues);
  scanner.status = scanner.issues.some((issue) => issue.severity === 'error') ? 'failed' : scanner.issues.some((issue) => issue.severity === 'warning') ? 'warning' : 'passed';

  const agentWorkspace = path.join(workspacePath, '.prometheus', 'subagents', agentId);
  const marketplaceProfile = {
    schema: manifest.schema,
    packId: manifest.id,
    packSlug: manifest.slug || agentId,
    packVersion: manifest.version || profile?.provenance?.packVersion || '0.0.0',
    publisher: manifest?.publisher?.name || manifest?.publisher?.id || profile?.provenance?.publisher || 'Unknown publisher',
    sourcePath: root,
    importedAt: null,
    installRecord: path.join(agentWorkspace, 'marketplace-install.json'),
    verificationStatus: manifest?.seller?.verificationRequiredForPublicListing ? 'required_for_public_listing' : 'local_preview',
    scannerStatus: scanner.status,
  };

  const agent = {
    id: agentId,
    name: String(profile.displayName || manifest.name || agentId),
    description: String(profile.description || manifest.description || ''),
    workspace: agentWorkspace,
    executionWorkspace: workspacePath,
    allowedWorkPaths: [workspacePath],
    model: profile?.model?.default && profile.model.default !== 'auto' ? String(profile.model.default) : undefined,
    tools: profile.tools || manifest?.permissions?.tools || undefined,
    skillIds: skills.map((skill) => skill.slug),
    subagentType: 'marketplace_pack',
    createdBy: 'agent_profile_pack_importer',
    createdAt: Date.now(),
    marketplaceProfile,
  };

  const files: AgentProfilePackPreview['installPlan']['files'] = [
    { source: personaPath, target: path.join(agentWorkspace, 'system_prompt.md'), action: 'copy' as const },
    { source: path.join(root, 'README.md'), target: path.join(agentWorkspace, 'README.md'), action: 'copy' as const },
    { source: path.join(root, 'SECURITY.md'), target: path.join(agentWorkspace, 'SECURITY.md'), action: 'copy' as const },
    { source: path.join(root, 'manifest.yaml'), target: path.join(agentWorkspace, 'manifest.yaml'), action: 'copy' as const },
  ].filter((item) => fs.existsSync(item.source));

  return {
    success: scanner.status !== 'failed',
    packPath: root,
    root,
    manifest,
    profile,
    agent,
    skills,
    provenance: marketplaceProfile,
    scanner,
    installPlan: {
      agentId,
      agentWorkspace,
      files,
      skills: skills.map((skill) => ({
        slug: skill.slug,
        source: skill.path,
        target: path.join(skillsDir || path.join(workspacePath, 'skills'), skill.slug),
        action: 'copy_directory' as const,
      })),
    },
  };
}

export function installAgentProfilePack(options: InstallAgentProfilePackOptions): InstallAgentProfilePackResult {
  const preview = previewAgentProfilePack(options.packPath, options.workspacePath, options.skillsDir);
  if (preview.scanner.status === 'failed') {
    throw new Error(`Pack failed validation: ${preview.scanner.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('; ')}`);
  }
  const agentWorkspace = preview.installPlan.agentWorkspace;
  if (fs.existsSync(agentWorkspace) && options.overwrite === false) {
    throw new Error(`Agent workspace already exists: ${agentWorkspace}`);
  }
  fs.mkdirSync(agentWorkspace, { recursive: true });
  const copiedFiles: string[] = [];
  for (const file of preview.installPlan.files) {
    fs.mkdirSync(path.dirname(file.target), { recursive: true });
    fs.copyFileSync(file.source, file.target);
    copiedFiles.push(file.target);
  }
  const copiedSkills: string[] = [];
  for (const skill of preview.installPlan.skills) {
    if (!fs.existsSync(skill.source)) continue;
    if (fs.existsSync(skill.target)) fs.rmSync(skill.target, { recursive: true, force: true });
    copiedSkills.push(...copyDirectory(skill.source, skill.target));
  }

  const importedAt = new Date().toISOString();
  const agent = {
    ...preview.agent,
    marketplaceProfile: {
      ...preview.agent.marketplaceProfile,
      importedAt,
      scannerStatus: preview.scanner.status,
    },
  };
  const installRecord = {
    schema: 'prometheus.agent_profile_pack_install.v1',
    installedAt: importedAt,
    packPath: preview.packPath,
    agentId: agent.id,
    packId: preview.manifest.id,
    packVersion: preview.manifest.version,
    publisher: preview.manifest.publisher || null,
    copiedFiles,
    copiedSkills,
    scanner: preview.scanner,
  };
  const installRecordPath = path.join(agentWorkspace, 'marketplace-install.json');
  fs.writeFileSync(installRecordPath, JSON.stringify(installRecord, null, 2), 'utf-8');
  fs.writeFileSync(path.join(agentWorkspace, 'config.json'), JSON.stringify({ marketplaceProfile: agent.marketplaceProfile, src_read_access: false, can_propose: false }, null, 2), 'utf-8');

  return { preview, agent, copiedFiles, copiedSkills, installRecordPath };
}

export function isMarketplaceImportedAgent(agent: any): boolean {
  return !!agent?.marketplaceProfile?.packId || agent?.subagentType === 'marketplace_pack' || agent?.createdBy === 'agent_profile_pack_importer';
}
