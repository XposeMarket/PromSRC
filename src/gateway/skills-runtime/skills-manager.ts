/**
 * skills-manager.ts
 *
 * Skills are SKILL.md files in <workspace>/skills/<id>/SKILL.md.
 * The AI reads them directly — no enable/disable ceremony needed.
 *
 * How it works:
 *   1. Skills are scanned from disk and exposed via skill_list / skill_read.
 *   2. Each turn: inject a short skills policy (no catalog, no full skill bodies)
 *      telling the model when to use skill_list and skill_read (required for execution-like turns).
 *   3. AI creates skills with skill_create → writes SKILL.md → appears next turn.
 *
 * No session windows, no activation turns, no prompt-time catalog injection.
 */

import fs from 'fs';
import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description: string;
  emoji: string;
  version: string;
  /** Comma-separated keywords — if any match a tool name or message, auto-enable */
  triggers: string[];
  enabled: boolean;
  instructions: string;
  filePath: string;
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const raw = content.trim();
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const end = raw.indexOf('---', 3);
  if (end === -1) return { fm: {}, body: raw };

  const fm: Record<string, string> = {};
  for (const line of raw.slice(3, end).split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[m[1].trim()] = val;
  }
  return { fm, body: raw.slice(end + 3).trim() };
}

// ─── SkillsManager ────────────────────────────────────────────────────────────

export class SkillsManager {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  /** id → enabled. Persisted to skills_state.json next to the skills dir */
  private enabledState: Record<string, boolean> = {};

  constructor(workspaceOrSkillsDir: string) {
    // Accept either a workspace path (will append /skills) or a direct skills dir
    this.skillsDir = workspaceOrSkillsDir.endsWith('skills')
      ? workspaceOrSkillsDir
      : path.join(workspaceOrSkillsDir, 'skills');

    fs.mkdirSync(this.skillsDir, { recursive: true });
    this.loadState();
    this.scanSkills();
  }

  /** Directory where skills live */
  getSkillsDir(): string { return this.skillsDir; }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private statePath(): string {
    return path.join(this.skillsDir, '_state.json');
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.statePath())) {
        this.enabledState = JSON.parse(fs.readFileSync(this.statePath(), 'utf-8'));
      }
    } catch { this.enabledState = {}; }
  }

  private saveState(): void {
    try {
      fs.writeFileSync(this.statePath(), JSON.stringify(this.enabledState, null, 2));
    } catch (e) { console.error('[Skills] Failed to save state:', e); }
  }

  persistState(): void { this.saveState(); }

  // ── Scanning ─────────────────────────────────────────────────────────────────

  scanSkills(): void {
    this.loadState();
    this.skills.clear();

    if (!fs.existsSync(this.skillsDir)) return;

    for (const entry of fs.readdirSync(this.skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

      const skillMd = path.join(this.skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      try {
        const { fm, body } = parseFrontmatter(fs.readFileSync(skillMd, 'utf-8'));
        this.skills.set(entry.name, {
          id: entry.name,
          name: fm.name || entry.name,
          description: fm.description || '',
          emoji: fm.emoji || '🧩',
          version: fm.version || '1.0.0',
          triggers: fm.triggers
            ? fm.triggers.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
            : [],
          enabled: this.enabledState[entry.name] ?? false,
          instructions: body,
          filePath: skillMd,
        });
      } catch (e) {
        console.error(`[Skills] Failed to load ${entry.name}:`, e);
      }
    }

    console.log(`[Skills] ${this.skills.size} skills in ${this.skillsDir} (${this.getEnabledSkills().length} enabled)`);
  }

  // ── Accessors ────────────────────────────────────────────────────────────────

  getAll(): Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getEnabledSkills(): Skill[] {
    return this.getAll().filter(s => s.enabled);
  }

  get(id: string): Skill | undefined { return this.skills.get(id); }

  // ── Enable / Disable ─────────────────────────────────────────────────────────

  setEnabled(id: string, enabled: boolean): Skill | null {
    const skill = this.skills.get(id);
    if (!skill) return null;
    skill.enabled = enabled;
    this.enabledState[id] = enabled;
    this.saveState();
    return skill;
  }

  // ── Auto-match: check if any skill triggers match a message or tool name ────

  /**
   * Returns skills whose triggers overlap with the message text or tool name.
   * These get their full SKILL.md injected into the prompt for this turn.
   */
  findMatchingSkills(toolName: string, messageText?: string): string[] {
    const words = [
      ...toolName.toLowerCase().split(/\W+/),
      ...(messageText || '').toLowerCase().split(/\W+/),
    ].filter(Boolean);
    const matches: string[] = [];
    for (const skill of this.skills.values()) {
      if (skill.triggers.length === 0) continue;
      if (skill.triggers.some(t => words.some(w => w.includes(t) || t.includes(w)))) {
        matches.push(skill.id);
      }
    }
    return matches;
  }

  /**
   * Match skills against a user message only (no tool name).
   * Used at the start of each turn before any tool calls happen.
   */
  findMatchingSkillsForMessage(messageText: string): string[] {
    const words = messageText.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const matches: string[] = [];
    for (const skill of this.skills.values()) {
      if (skill.triggers.length === 0) continue;
      if (skill.triggers.some(t => words.some(w => w.includes(t) || t.includes(w)))) {
        matches.push(skill.id);
      }
    }
    return matches;
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  createSkill(data: {
    id: string;
    name: string;
    description: string;
    emoji?: string;
    triggers?: string[];
    instructions: string;
  }): Skill {
    const id = data.id
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!id) throw new Error('Invalid skill ID');

    const skillDir = path.join(this.skillsDir, id);
    fs.mkdirSync(skillDir, { recursive: true });

    const lines = [
      '---',
      `name: ${data.name}`,
      `description: ${data.description}`,
      `emoji: "${data.emoji || '🧩'}"`,
      `version: 1.0.0`,
    ];
    if (data.triggers?.length) {
      lines.push(`triggers: ${data.triggers.join(', ')}`);
    }
    lines.push('---');
    const content = lines.join('\n') + '\n\n' + data.instructions;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');

    this.enabledState[id] = false; // created but not auto-enabled
    this.saveState();
    this.scanSkills();

    const skill = this.skills.get(id);
    if (!skill) throw new Error('Skill creation failed');
    console.log(`[Skills] Created: ${id}`);
    return skill;
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  deleteSkill(id: string): boolean {
    if (!this.skills.has(id)) return false;
    try {
      fs.rmSync(path.join(this.skillsDir, id), { recursive: true, force: true });
      this.skills.delete(id);
      delete this.enabledState[id];
      this.saveState();
      return true;
    } catch { return false; }
  }

  // ── Compact index ─────────────────────────────────────────────────────────────

  getCompactList(): string {
    const all = this.getAll();
    if (!all.length) return 'No skills installed.';
    return all.map(s =>
      `${s.id} ${s.emoji} ${s.name}${s.triggers.length ? ` [triggers: ${s.triggers.join(',')}]` : ' [pinned]'} — ${s.description.slice(0, 80)}`
    ).join('\n');
  }

  // ── Prompt context ────────────────────────────────────────────────────────────

  /**
   * Main entry point — call once per turn.
   *
   * Inject a compact policy reminder only.
   * Skill discovery/reading happens through skill_list + skill_read tools.
   */
  buildTurnContext(_messageText: string, _maxCharsPerSkill = 3000): string {
    const all = this.getAll();
    if (!all.length) return '';

    const parts: string[] = [];

    parts.push(
      `[SKILLS] You have ${all.length} reusable skill playbook${all.length !== 1 ? 's' : ''}.\n` +
      `For greetings, small talk, quick Q&A, or confirmations: respond directly — do NOT call skill_list.\n` +
      `Before browser/desktop automation, file edits, or other execution-heavy work: call skill_list first.\n` +
      `If a relevant skill exists, call skill_read(id) and follow it before acting.\n` +
      `skill_list, skill_read, and skill_create are core tools (always available).\n` +
      `Save new reusable workflows with skill_create().`
    );

    return parts.join('\n\n');
  }

  /**
   * Legacy compat shim.
   */
  buildPromptContext(options?: {
    maxCharsPerSkill?: number;
    reassessSkills?: Array<{ id: string; name: string; emoji: string; turnsActive: number }>;
  }): string {
    return this.buildTurnContext('', options?.maxCharsPerSkill ?? 3000);
  }
}
