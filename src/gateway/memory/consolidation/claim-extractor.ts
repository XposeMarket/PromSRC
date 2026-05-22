import fs from 'fs';
import path from 'path';
import { claimId } from './store';
import type { MemoryClaim, MemoryClaimType } from './types';

type SourceDoc = {
  sourceType: string;
  sourcePath: string;
  text: string;
  updatedAt: string;
};

function listFilesRecursive(root: string, maxFiles = 80): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.(json|jsonl|md|txt)$/i.test(entry.name)) out.push(abs);
      if (out.length >= maxFiles) return;
    }
  };
  walk(root);
  return out;
}

function readSourceDocs(workspacePath: string, limit: number): SourceDoc[] {
  const auditRoot = path.join(workspacePath, 'audit');
  const roots = ['chats', 'tasks', 'proposals', 'memory', 'projects'].map(dir => path.join(auditRoot, dir));
  const files = roots.flatMap(root => listFilesRecursive(root, Math.ceil(limit / roots.length))).slice(0, limit);
  return files.flatMap(absPath => {
    try {
      const st = fs.statSync(absPath);
      const raw = fs.readFileSync(absPath, 'utf-8');
      const text = raw.length > 18000 ? raw.slice(-18000) : raw;
      const sourcePath = path.relative(auditRoot, absPath).replace(/\\/g, '/');
      return [{ sourceType: inferSourceType(sourcePath), sourcePath, text, updatedAt: st.mtime.toISOString() }];
    } catch {
      return [];
    }
  });
}

function inferSourceType(sourcePath: string): string {
  if (sourcePath.startsWith('tasks/')) return 'task_state';
  if (sourcePath.startsWith('proposals/')) return 'proposal_state';
  if (sourcePath.startsWith('memory/')) return 'memory_note';
  if (sourcePath.startsWith('projects/')) return 'project_state';
  if (sourcePath.startsWith('chats/')) return 'chat_session';
  return 'audit_misc';
}

function normalizeClaimText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
}

function looksLikeNoise(line: string): boolean {
  const text = String(line || '').trim();
  if (!text) return true;
  if (/^(```|import\s+|export\s+|const\s+|let\s+|var\s+|function\s+|class\s+|<\/?[a-z])/i.test(text)) return true;
  if (/^\s*[{[\]},:"'0-9._-]+\s*$/.test(text)) return true;
  if (/^\[[^\]]+\]\s+(debug|trace|info|warn|error)\b/i.test(text)) return true;
  if (/^(at\s+\S+\s+\(|error:|warning:|stack trace)/i.test(text)) return true;
  if (/https?:\/\/\S+/.test(text) && text.length < 160) return true;
  return false;
}

function canonicalKey(type: MemoryClaimType, text: string, projectId: string | null): string {
  const base = normalizeClaimText(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `${type}:${projectId || 'root'}:${base || 'claim'}`;
}

function buildClaim(type: MemoryClaimType, text: string, source: SourceDoc, authority: string, confidence: number): MemoryClaim {
  const body = normalizeClaimText(text);
  const projectMatch = body.match(/\bproject[:\s]+([a-z0-9_-]{3,80})/i);
  const projectId = projectMatch?.[1] || null;
  const key = canonicalKey(type, body, projectId);
  const now = new Date().toISOString();
  return {
    id: claimId(`${key}:${source.sourcePath}:${body}`),
    type,
    canonicalKey: key,
    title: `${type.replace(/_/g, ' ')}: ${body.slice(0, 96)}`,
    summary: body,
    body,
    sourceRefs: [{
      sourceType: source.sourceType,
      sourcePath: source.sourcePath,
      confidence,
    }],
    confidence,
    authority,
    status: 'proposed',
    supersedes: [],
    supersededBy: [],
    createdAt: now,
    updatedAt: now,
    projectId,
    entities: {},
  };
}

function extractFromLine(line: string, source: SourceDoc): MemoryClaim[] {
  const trimmed = normalizeClaimText(line);
  if (trimmed.length < 12) return [];
  if (looksLikeNoise(trimmed)) return [];
  const claims: MemoryClaim[] = [];
  const patterns: Array<[MemoryClaimType, RegExp, string, number]> = [
    ['user_correction', /^(?:[-*]\s*)?(?:correction|actually|not that|instead remember|user corrected)\b[:\s-]+(.+)/i, 'user_correction', 0.94],
    ['preference', /^(?:[-*]\s*)?(?:user prefers|user preference|preference|prefers|prefer|likes|wants)\b[:\s-]+(.+)/i, 'explicit_user_instruction', 0.86],
    ['decision', /^(?:[-*]\s*)?(?:we decided|decided to|decision|final decision)\b[:\s-]+(.+)/i, 'verified_task_outcome', 0.84],
    ['rule', /^(?:[-*]\s*)?(?:rule|always remember|never remember|must remember|should not remember|always use|never use|must use|should not use)\b[:\s-]+(.+)/i, 'explicit_user_instruction', 0.78],
    ['task_outcome', /^(?:[-*]\s*)?(?:completed|shipped|fixed|implemented|resolved)\b[:\s-]+(.+)/i, 'verified_task_outcome', 0.76],
    ['open_loop', /^(?:[-*]\s*)?(?:todo|follow up|open loop|pending|blocked)\b[:\s-]+(.+)/i, 'assistant_inference', 0.68],
    ['project_fact', /^(?:[-*]\s*)?(?:project fact|architecture|current state)\b[:\s-]+(.+)/i, 'assistant_inference', 0.66],
  ];
  for (const [type, regex, authority, confidence] of patterns) {
    const match = trimmed.match(regex);
    if (!match?.[1] || match[1].length <= 8) continue;
    if ((type === 'task_outcome' || type === 'open_loop') && !['task_state', 'proposal_state', 'project_state', 'chat_session'].includes(source.sourceType)) continue;
    claims.push(buildClaim(type, match[1], source, authority, confidence));
  }
  return claims;
}

export function extractMemoryClaims(workspacePath: string, options?: { maxSources?: number; maxClaims?: number }): MemoryClaim[] {
  const docs = readSourceDocs(workspacePath, Math.max(10, Math.min(400, Number(options?.maxSources || 120))));
  const claims: MemoryClaim[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const lines = doc.text.split(/\r?\n/).flatMap(line => {
      if (line.length <= 1200) return [line];
      return line.split(/[.!?]\s+/);
    });
    for (const line of lines) {
      for (const claim of extractFromLine(line, doc)) {
        if (seen.has(claim.canonicalKey)) continue;
        seen.add(claim.canonicalKey);
        claims.push(claim);
        if (claims.length >= Math.max(1, Math.min(500, Number(options?.maxClaims || 80)))) return claims;
      }
    }
  }
  return claims;
}
