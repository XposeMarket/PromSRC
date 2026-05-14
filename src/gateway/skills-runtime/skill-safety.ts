import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { canReadSkillResource } from './skill-package';

export type SkillSafetySeverity = 'info' | 'warn' | 'critical';
export type SkillSafetyVerdict = 'safe' | 'warn' | 'critical';

export interface SkillSafetyFinding {
  id: string;
  severity: SkillSafetySeverity;
  message: string;
  file?: string;
  excerpt?: string;
}

export interface SkillSafetyScan {
  verdict: SkillSafetyVerdict;
  findings: SkillSafetyFinding[];
  scannedAt: string;
  contentHash: string;
}

const FINDING_RULES: Array<{
  id: string;
  severity: SkillSafetySeverity;
  message: string;
  pattern: RegExp;
}> = [
  {
    id: 'prompt-injection-ignore-instructions',
    severity: 'critical',
    message: 'Tells the agent to ignore or override higher-priority instructions.',
    pattern: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|system|developer)\s+instructions?\b/i,
  },
  {
    id: 'prompt-injection-system-prompt',
    severity: 'critical',
    message: 'References hidden/system/developer prompt extraction or replacement.',
    pattern: /\b(system prompt|developer message|hidden instructions?|reveal.*instructions?|print.*system)\b/i,
  },
  {
    id: 'permission-bypass',
    severity: 'critical',
    message: 'Encourages bypassing tool permissions, approval, sandbox, or policy checks.',
    pattern: /\b(bypass|disable|circumvent)\s+(approval|permission|sandbox|policy|guardrail|safety)\b/i,
  },
  {
    id: 'secret-exfiltration',
    severity: 'critical',
    message: 'Appears to send secrets or process environment data to an external endpoint.',
    pattern: /\b(process\.env|env\s*\||\$[A-Z0-9_]{6,}|secret|api[_-]?key|token)\b[\s\S]{0,140}\b(curl|wget|fetch|http|https|post|upload)\b/i,
  },
  {
    id: 'shell-pipe-to-shell',
    severity: 'critical',
    message: 'Uses a remote download piped directly into a shell.',
    pattern: /\b(curl|wget)\b[^\n|;]{0,180}\|\s*(sh|bash|zsh|pwsh|powershell)\b/i,
  },
  {
    id: 'destructive-delete',
    severity: 'warn',
    message: 'Contains broad destructive deletion guidance.',
    pattern: /\b(rm\s+-rf|Remove-Item\b[\s\S]{0,80}-Recurse|del\s+\/s)\b/i,
  },
  {
    id: 'unsafe-permissions',
    severity: 'warn',
    message: 'Contains unsafe broad permission changes.',
    pattern: /\bchmod\s+777\b|\bicacls\b[\s\S]{0,80}\bEveryone\b[\s\S]{0,40}\bF\b/i,
  },
  {
    id: 'unreviewed-background-install',
    severity: 'warn',
    message: 'Contains package install or remote execution guidance that should be reviewed.',
    pattern: /\b(npm\s+i|pip\s+install|brew\s+install|irm\s+https?:\/\/|Invoke-WebRequest\s+https?:\/\/)\b/i,
  },
];

function hashText(parts: string[]): string {
  const h = crypto.createHash('sha256');
  for (const part of parts) {
    h.update(part);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

function excerptFor(text: string, matchIndex: number): string {
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(text.length, matchIndex + 180);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function verdictFor(findings: SkillSafetyFinding[]): SkillSafetyVerdict {
  if (findings.some((f) => f.severity === 'critical')) return 'critical';
  if (findings.some((f) => f.severity === 'warn')) return 'warn';
  return 'safe';
}

export function scanSkillText(content: string, file = 'SKILL.md'): SkillSafetyScan {
  const text = String(content || '');
  const findings: SkillSafetyFinding[] = [];
  for (const rule of FINDING_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    findings.push({
      id: rule.id,
      severity: rule.severity,
      message: rule.message,
      file,
      excerpt: excerptFor(text, match.index),
    });
  }
  return {
    verdict: verdictFor(findings),
    findings,
    scannedAt: new Date().toISOString(),
    contentHash: hashText([file, text]),
  };
}

export function mergeSkillSafetyScans(scans: SkillSafetyScan[]): SkillSafetyScan {
  const findings = scans.flatMap((scan) => scan.findings);
  return {
    verdict: verdictFor(findings),
    findings,
    scannedAt: new Date().toISOString(),
    contentHash: hashText(scans.map((scan) => scan.contentHash)),
  };
}

export function scanSkillDirectory(rootDir: string, maxFiles = 80): SkillSafetyScan {
  const scans: SkillSafetyScan[] = [];
  const root = path.resolve(rootDir);
  const stack = [root];
  let scanned = 0;

  while (stack.length && scanned < maxFiles) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.history') continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (path.basename(rel).toLowerCase() !== 'skill.json' && !canReadSkillResource(rel)) continue;
      try {
        const stat = fs.statSync(abs);
        if (stat.size > 512_000) continue;
        scans.push(scanSkillText(fs.readFileSync(abs, 'utf-8'), rel));
        scanned++;
      } catch {}
      if (scanned >= maxFiles) break;
    }
  }

  if (!scans.length) {
    return {
      verdict: 'safe',
      findings: [],
      scannedAt: new Date().toISOString(),
      contentHash: hashText([root]),
    };
  }
  return mergeSkillSafetyScans(scans);
}

export function assertSkillScanAllowed(scan: SkillSafetyScan, label: string): void {
  if (scan.verdict !== 'critical') return;
  const first = scan.findings.find((finding) => finding.severity === 'critical');
  throw new Error(
    `${label} blocked by skill safety scanner: ${first?.id || 'critical-finding'}${first?.message ? ` - ${first.message}` : ''}`,
  );
}

export function ensureSkillSafetyDirs(skillsDir: string): void {
  for (const name of ['.quarantine', '.proposals', '.archive', '.history']) {
    fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
  }
}
