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

  const skills = _sm.getAll().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    emoji: s.emoji,
    version: s.version,
    enabled: s.enabled,
    eligible: true,
    eligibleReason: undefined as string | undefined,
  }));
  res.json({ success: true, skills });
});

router.get('/api/skills/:id', (req, res) => {
  const skill = _sm.get(req.params.id);
  if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  res.json({ success: true, skill });
});

router.post('/api/skills/:id/toggle', async (req, res) => {
  const skillId = req.params.id;
  const current = _sm.get(skillId);
  if (!current) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }

  const skill = _sm.setEnabled(skillId, !current.enabled);
  if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }

  res.json({ success: true, skill: { id: skill.id, name: skill.name, enabled: skill.enabled } });
});

router.post('/api/skills', (req, res) => {
  try {
    const { id, name, description, emoji, instructions } = req.body;
    if (!name || !instructions) { res.status(400).json({ success: false, error: 'Name and instructions required' }); return; }
    const skillId = id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const skill = _sm.createSkill({ id: skillId, name, description: description || '', emoji: emoji || '🧩', instructions });
    res.json({ success: true, skill: { id: skill.id, name: skill.name, description: skill.description, emoji: skill.emoji, enabled: skill.enabled } });
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
    res.json({ success: true, skill: { id: updated.id, name: updated.name, description: updated.description, emoji: updated.emoji, enabled: updated.enabled } });
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
