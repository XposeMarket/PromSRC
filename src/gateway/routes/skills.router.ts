// Skills API routes
import { Router } from 'express';
import { SkillsManager } from '../skills-runtime/skills-manager';
import { recoverSkillsIfEmpty } from '../skills-runtime/skill-windows';
import { activeTasks as _activeTasks } from '../chat/chat-state';

export const router = Router();

let _sm: InstanceType<typeof SkillsManager>;
export function setSkillsRouterManager(sm: InstanceType<typeof SkillsManager>): void { _sm = sm; }

/** Legacy — orchestration telemetry removed; kept for server compatibility. */
export function setSkillsRouterDeps(_deps: { getOrchestrationSessionStats: (s: string) => any }): void {}

router.get('/api/skills', async (_req, res) => {
  recoverSkillsIfEmpty();
  _sm.scanSkills();

  const skills = _sm.getAll().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    emoji: s.emoji,
    version: s.version,
    kind: s.kind,
    resources: s.resources,
    requiredTools: s.requiredTools,
    categories: s.categories,
    validation: s.validation,
    eligible: true,
    eligibleReason: undefined as string | undefined,
  }));
  res.json({ success: true, skills, skillsDir: _sm.getSkillsDir() });
});

router.get('/api/skills/:id', (req, res) => {
  const skill = _sm.get(req.params.id);
  if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  res.json({ success: true, skill });
});

router.post('/api/skills', (req, res) => {
  try {
    const { id, name, description, emoji, instructions } = req.body;
    if (!name || !instructions) { res.status(400).json({ success: false, error: 'Name and instructions required' }); return; }
    const skillId = id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const skill = _sm.createSkill({ id: skillId, name, description: description || '', emoji: emoji || '🧩', instructions });
    res.json({ success: true, skill: { id: skill.id, name: skill.name, description: skill.description, emoji: skill.emoji } });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/skills/import', async (req, res) => {
  try {
    const { source, id, overwrite } = req.body || {};
    if (!source) { res.status(400).json({ success: false, error: 'source required' }); return; }
    const skills = await _sm.importBundles(String(source), { id: id ? String(id) : undefined, overwrite: overwrite === true });
    res.json({ success: true, skills, skill: skills[0] });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/skills/bundle', (req, res) => {
  try {
    const { id, name, description, instructions, emoji, version, triggers, categories, requiredTools, permissions, resources, overwrite } = req.body || {};
    if (!id || !name || !instructions) { res.status(400).json({ success: false, error: 'id, name, and instructions required' }); return; }
    const toArray = (value: any) => Array.isArray(value)
      ? value.map((v) => String(v || '').trim()).filter(Boolean)
      : String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
    const skill = _sm.createBundle({
      id: String(id),
      name: String(name),
      description: description ? String(description) : '',
      instructions: String(instructions),
      emoji: emoji ? String(emoji) : undefined,
      version: version ? String(version) : undefined,
      triggers: toArray(triggers),
      categories: toArray(categories),
      requiredTools: toArray(requiredTools),
      permissions: permissions && typeof permissions === 'object' ? permissions : undefined,
      resources: Array.isArray(resources) ? resources : [],
      overwrite: overwrite === true,
    });
    res.json({ success: true, skill });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/api/skills/:id/inspect', (req, res) => {
  const inspection = _sm.inspect(req.params.id);
  if (!inspection) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  res.json({ success: true, skill: inspection });
});

router.post('/api/skills/:id/resources', (req, res) => {
  try {
    const { path, content, type, description, addToManifest } = req.body || {};
    if (!path) { res.status(400).json({ success: false, error: 'path required' }); return; }
    const skill = _sm.writeResource(req.params.id, String(path), String(content ?? ''), {
      type: type ? String(type) : undefined,
      description: description ? String(description) : undefined,
      addToManifest: addToManifest !== false,
    });
    res.json({ success: true, skill });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/api/skills/:id/resources', (req, res) => {
  try {
    const resourcePath = String((req.query.path || (req.body as any)?.path || '') as string);
    if (!resourcePath) { res.status(400).json({ success: false, error: 'path required' }); return; }
    const skill = _sm.deleteResource(req.params.id, resourcePath, { removeFromManifest: (req.body as any)?.removeFromManifest !== false });
    res.json({ success: true, skill });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/skills/:id/export', async (req, res) => {
  try {
    const exported = await _sm.exportBundle(req.params.id, req.body?.outputPath ? String(req.body.outputPath) : undefined);
    res.json({ success: true, exported });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/skills/:id/update-from-source', async (req, res) => {
  try {
    const skills = await _sm.updateFromSource(req.params.id, { overwrite: req.body?.overwrite !== false });
    res.json({ success: true, skills });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/api/skills/:id', (req, res) => {
  const existing = _sm.get(req.params.id);
  if (!existing) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  const { name, description, emoji, instructions } = req.body;
  try {
    const fs = require('fs') as typeof import('fs');
    const lines = [
      '---',
      `name: ${name ?? existing.name}`,
      `description: ${description ?? existing.description}`,
      `emoji: "${emoji ?? existing.emoji}"`,
      `version: ${existing.version}`,
    ];
    if (existing.triggers.length) lines.push(`triggers: ${existing.triggers.join(', ')}`);
    lines.push('---');
    const content = lines.join('\n') + '\n\n' + (instructions ?? existing.instructions);
    fs.writeFileSync(existing.filePath, content, 'utf-8');
    _sm.scanSkills();
    const updated = _sm.get(req.params.id);
    if (!updated) { res.status(404).json({ success: false, error: 'Skill not found after update' }); return; }
    res.json({ success: true, skill: { id: updated.id, name: updated.name, description: updated.description, emoji: updated.emoji } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/skills/:id', (req, res) => {
  const ok = _sm.deleteSkill(req.params.id);
  if (!ok) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  res.json({ success: true });
});

router.get('/api/task-status', (req, res) => {
  const sessionId = (req.query.sessionId as string) || 'default';
  const task = _activeTasks.get(sessionId);
  if (!task) { res.json({ active: false }); return; }
  res.json({ active: task.status === 'running', ...task, journal: task.journal.slice(-10) });
});
