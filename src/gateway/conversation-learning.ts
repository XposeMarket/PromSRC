// src/gateway/conversation-learning.ts
// CIS Phase 1 — Post-session conversation learning.
//
// After each session ends, this module extracts business facts from the
// conversation and writes them to BUSINESS.md and entity files automatically.
// Called from server-v2.ts on session close / compaction.
//
// Zero risk: purely additive writes. Never modifies existing source files.

import fs from 'fs';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LearningResult {
  businessFactsWritten: number;
  entitiesUpdated: string[];
  skipped: boolean;
  reason?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Minimum conversation length worth scanning
const MIN_MESSAGES = 4;

// Max chars of conversation to send for extraction (keep tokens bounded)
const MAX_CONVO_CHARS = 6000;

// Sections in BUSINESS.md we know how to write to
const BUSINESS_SECTIONS = [
  'Company', 'Team', 'Active Clients', 'Products & Services',
  'Active Projects', 'Key Vendors & Tools', 'Approval Thresholds',
  'Company Policies', 'Important Dates', 'Notes',
];

// ─── extractAndWrite ─────────────────────────────────────────────────────────
// Main entry point. Pass the session message history and workspace path.
// Uses a simple heuristic scan — no LLM call, no network, no risk.

export async function extractAndWrite(
  messages: ConversationMessage[],
  workspacePath: string,
): Promise<LearningResult> {

  if (messages.length < MIN_MESSAGES) {
    return { businessFactsWritten: 0, entitiesUpdated: [], skipped: true, reason: 'too short' };
  }

  // Build a condensed transcript (user turns only, trimmed)
  const transcript = messages
    .filter(m => m.role === 'user')
    .map(m => m.content.trim())
    .join('\n')
    .slice(0, MAX_CONVO_CHARS);

  const facts = scanForBusinessFacts(transcript);
  const entities = scanForEntities(transcript);

  let businessFactsWritten = 0;
  const entitiesUpdated: string[] = [];

  // ── Write to BUSINESS.md ──────────────────────────────────────────────────
  if (facts.length > 0) {
    const businessPath = path.join(workspacePath, 'BUSINESS.md');
    if (fs.existsSync(businessPath)) {
      let content = fs.readFileSync(businessPath, 'utf-8');
      for (const fact of facts) {
        const sectionHeader = `## ${fact.section}`;
        if (content.includes(sectionHeader)) {
          // Append under the existing section, before the next ##
          const insertMarker = `${sectionHeader}\n`;
          const insertPos = content.indexOf(insertMarker) + insertMarker.length;
          const line = `- ${fact.value}  <!-- learned ${todayDate()} -->\n`;
          // Only write if this exact value isn't already present
          if (!content.includes(fact.value)) {
            content = content.slice(0, insertPos) + line + content.slice(insertPos);
            businessFactsWritten++;
          }
        } else {
          // Append new section at the end
          content += `\n## ${fact.section}\n- ${fact.value}  <!-- learned ${todayDate()} -->\n`;
          businessFactsWritten++;
        }
      }
      fs.writeFileSync(businessPath, content, 'utf-8');
    }
  }

  // ── Write entity files ────────────────────────────────────────────────────
  for (const entity of entities) {
    const dir = path.join(workspacePath, 'entities', entity.type + 's');
    const filePath = path.join(dir, `${entity.slug}.md`);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(filePath)) {
      // Create minimal entity file from what we learned
      const templatePath = path.join(dir, '_template.md');
      let content = fs.existsSync(templatePath)
        ? fs.readFileSync(templatePath, 'utf-8')
            .replace(/\[.*?\]/g, '')  // strip template placeholders
        : `# ${entity.name}\n# File: entities/${entity.type}s/${entity.slug}.md\n`;

      content = `# ${entity.name}\n# Last Updated: ${todayDate()}\n\n## Overview\n- **Name:** ${entity.name}\n\n## Notes\n- First seen in conversation on ${todayDate()}\n`;
      fs.writeFileSync(filePath, content, 'utf-8');
      entitiesUpdated.push(`${entity.type}s/${entity.slug}.md (created)`);
    } else {
      // Append to notes section if entity has new info
      if (entity.note) {
        let content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes(entity.note)) {
          const notesMarker = '## Notes\n';
          if (content.includes(notesMarker)) {
            const pos = content.indexOf(notesMarker) + notesMarker.length;
            content = content.slice(0, pos) + `- ${entity.note}  [${todayDate()}]\n` + content.slice(pos);
          } else {
            content += `\n## Notes\n- ${entity.note}  [${todayDate()}]\n`;
          }
          // Update Last Updated line
          content = content.replace(/# Last Updated: .+/, `# Last Updated: ${todayDate()}`);
          fs.writeFileSync(filePath, content, 'utf-8');
          entitiesUpdated.push(`${entity.type}s/${entity.slug}.md (updated)`);
        }
      }
    }
  }

  return { businessFactsWritten, entitiesUpdated, skipped: false };
}

// ─── scanForBusinessFacts ─────────────────────────────────────────────────────
// Pattern-based scan for business facts in user messages.

interface BusinessFact {
  section: string;
  value: string;
}

function scanForBusinessFacts(text: string): BusinessFact[] {
  const facts: BusinessFact[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const l = line.trim();
    if (!l || l.length < 5) continue;

    // Company name
    if (/my company (is|called|named)/i.test(l) || /we('re| are) called/i.test(l)) {
      const match = l.match(/(?:company|called|named)\s+["']?([A-Z][A-Za-z0-9 &.'-]+)["']?/);
      if (match) facts.push({ section: 'Company', value: `Name: ${match[1]}` });
    }

    // Team members
    if (/my (co-founder|partner|cto|ceo|developer|designer|employee|teammate)/i.test(l)) {
      const match = l.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is\s+(?:my|our)\s+(\w+)/i);
      if (match) facts.push({ section: 'Team', value: `${match[1]} | ${match[2]}` });
    }

    // Clients
    if (/(?:client|customer|account)\s+(?:is|called|named)/i.test(l) || /working with\s+([A-Z])/i.test(l)) {
      const match = l.match(/(?:client|customer|working with)\s+["']?([A-Z][A-Za-z0-9 &.'-]+)["']?/i);
      if (match) facts.push({ section: 'Active Clients', value: match[1] });
    }

    // Products/services
    if (/(?:our|my) (?:product|service|app|tool|platform|software) (?:is|called)/i.test(l)) {
      const match = l.match(/(?:product|service|app|tool|platform)\s+(?:is\s+)?(?:called\s+)?["']?([A-Z][A-Za-z0-9 &.'-]+)["']?/i);
      if (match) facts.push({ section: 'Products & Services', value: match[1] });
    }

    // Vendors / tools
    if (/we use\s+([A-Z])/i.test(l) || /our (?:stack|tools) include/i.test(l)) {
      const match = l.match(/we use\s+([A-Za-z0-9 ,&.'-]+?)(?:\s+for|\s+to|\.)/i);
      if (match) facts.push({ section: 'Key Vendors & Tools', value: match[1].trim() });
    }
  }

  return facts;
}

// ─── scanForEntities ─────────────────────────────────────────────────────────
// Detect named entities (clients, projects) mentioned in the conversation.

interface DetectedEntity {
  type: 'client' | 'project' | 'vendor' | 'contact' | 'social';
  name: string;
  slug: string;
  note?: string;
}

function scanForEntities(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  // Client names — "working with Acme" / "client Acme Corp" / "Acme is a client"
  const clientRe = /(?:client|working with|account)\s+([A-Z][A-Za-z0-9 &.'-]{2,30})/gi;
  for (const m of text.matchAll(clientRe)) {
    const name = m[1].trim();
    if (name.split(' ').length <= 4) {
      entities.push({ type: 'client', name, slug: toSlug(name) });
    }
  }

  // Project names — "project called X" / "the X project"
  const projectRe = /(?:project called|the\s+)([A-Z][A-Za-z0-9 &.'-]{2,30})\s+project/gi;
  for (const m of text.matchAll(projectRe)) {
    const name = m[1].trim();
    entities.push({ type: 'project', name, slug: toSlug(name) });
  }

  // Deduplicate by slug
  const seen = new Set<string>();
  return entities.filter(e => {
    if (seen.has(e.slug)) return false;
    seen.add(e.slug);
    return true;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}
