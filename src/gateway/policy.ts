/**
 * policy.ts — Phase 5 Policy Engine
 *
 * Evaluates every tool call against a tiered policy:
 *   READ   — pass through immediately, just log
 *   PROPOSE — return a draft proposal for user review
 *   COMMIT  — route to the existing approval / verification flow
 *
 * Policy rules are loaded from workspace/.prometheus/policy-rules.json
 * (or seeded with safe defaults if the file doesn't exist).
 *
 * The engine also emits AuditLogEntry records so every tool call is
 * traceable regardless of which tier it lands in.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config.js';
import { AuditLogEntry, PolicyRule } from '../types.js';

// ─── Default rules ──────────────────────────────────────────────────────────

export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  // File reads → READ (always pass through)
  {
    id: 'read-files',
    description: 'File read operations are always allowed',
    toolPattern: 'read|list|stat|memory_read|memory_browse',
    tier: 'read',
    riskScore: 0,
  },
  // Web reads → READ
  {
    id: 'web-reads',
    description: 'Web search and fetch are always allowed',
    toolPattern: 'web_search|web_fetch',
    tier: 'read',
    riskScore: 1,
  },
  // Shell execution → COMMIT (requires user approval)
  {
    id: 'shell-exec',
    description: 'Shell command execution requires approval',
    toolPattern: 'shell|run_command',
    tier: 'commit',
    riskScore: 8,
  },
  // File writes → PROPOSE (show user before committing)
  {
    id: 'file-writes',
    description: 'File write/delete/rename operations need proposal review',
    toolPattern: 'write|create_file|edit|delete|rename|copy|mkdir|append|apply_patch',
    tier: 'propose',
    riskScore: 5,
  },
  // Memory writes → PROPOSE
  {
    id: 'memory-writes',
    description: 'Memory write operations are proposed for review',
    toolPattern: 'memory_write',
    tier: 'propose',
    riskScore: 3,
  },
  // Desktop control → COMMIT
  {
    id: 'desktop-control',
    description: 'Desktop automation requires explicit approval',
    toolPattern: 'desktop_click|desktop_type|desktop_press|desktop_drag|desktop_launch|desktop_close',
    tier: 'commit',
    riskScore: 9,
  },
  // Browser automation → PROPOSE
  {
    id: 'browser-actions',
    description: 'Browser interaction steps are proposed before execution',
    toolPattern: 'browser_click|browser_fill|browser_press|browser_submit',
    tier: 'propose',
    riskScore: 6,
  },
  // Integration / outbound connectors → COMMIT
  {
    id: 'integrations-write',
    description: 'Outbound integration writes require approval',
    toolPattern: 'gmail_send|slack_post|github_create|notion_update|hubspot_write|salesforce_write|stripe_write',
    tier: 'commit',
    riskScore: 9,
  },
  // Vercel / deploy tooling → COMMIT
  {
    id: 'deploy-ops',
    description: 'Deployment operations require approval',
    toolPattern: 'vercel_deploy|vercel_env',
    tier: 'commit',
    riskScore: 10,
  },
  // Self-update → COMMIT
  {
    id: 'self-update',
    description: 'Self-update operations require approval',
    toolPattern: 'self_update|propose_repair',
    tier: 'commit',
    riskScore: 9,
  },
];

// ─── Types ───────────────────────────────────────────────────────────────────

export type PolicyTier = 'read' | 'propose' | 'commit';

export interface PolicyEvaluation {
  tier: PolicyTier;
  riskScore: number;
  reason: string;
  affectedSystems: string[];
  matchedRule: PolicyRule | null;
  /** For PROPOSE tier: a human-readable draft summary */
  proposalSummary?: string;
}

// ─── Policy engine ──────────────────────────────────────────────────────────

class PolicyEngine {
  private rules: PolicyRule[] = [];
  private rulesPath: string = '';

  constructor() {
    this.load();
  }

  // Load rules from disk (or seed defaults)
  private load(): void {
    try {
      const config = getConfig();
      const dataDir = config.getConfigDir();
      this.rulesPath = path.join(dataDir, 'policy-rules.json');

      if (fs.existsSync(this.rulesPath)) {
        const raw = JSON.parse(fs.readFileSync(this.rulesPath, 'utf-8'));
        if (Array.isArray(raw) && raw.length > 0) {
          this.rules = raw;
          console.log(`[Policy] Loaded ${this.rules.length} rules from ${this.rulesPath}`);
          return;
        }
      }
      // Seed defaults
      this.rules = [...DEFAULT_POLICY_RULES];
      this.save();
      console.log(`[Policy] Seeded ${this.rules.length} default policy rules`);
    } catch (err: any) {
      console.warn('[Policy] Could not load rules, using defaults:', err?.message || err);
      this.rules = [...DEFAULT_POLICY_RULES];
    }
  }

  // Persist current rules to disk
  private save(): void {
    try {
      if (this.rulesPath) {
        fs.mkdirSync(path.dirname(this.rulesPath), { recursive: true });
        fs.writeFileSync(this.rulesPath, JSON.stringify(this.rules, null, 2), 'utf-8');
      }
    } catch (err: any) {
      console.warn('[Policy] Could not save rules:', err?.message || err);
    }
  }

  /**
   * Evaluate a tool call against the loaded policy rules.
   * Returns a PolicyEvaluation describing which tier applies and why.
   */
  evaluateAction(
    actor: string,
    toolName: string,
    args: Record<string, any>
  ): PolicyEvaluation {
    const matchedRule = this.matchRule(toolName);

    if (matchedRule) {
      return {
        tier: matchedRule.tier,
        riskScore: matchedRule.riskScore,
        reason: matchedRule.description,
        affectedSystems: this.inferAffectedSystems(toolName, args),
        matchedRule,
        proposalSummary: matchedRule.tier !== 'read'
          ? this.buildProposalSummary(toolName, args)
          : undefined,
      };
    }

    // No matching rule → default to READ (least restrictive safe default)
    return {
      tier: 'read',
      riskScore: 0,
      reason: 'No policy rule matched — defaulting to READ (pass-through)',
      affectedSystems: [],
      matchedRule: null,
    };
  }

  // Find the most specific matching rule for a tool name
  private matchRule(toolName: string): PolicyRule | null {
    // Match in order; first match wins (rules are ordered by specificity above)
    for (const rule of this.rules) {
      const patterns = rule.toolPattern.split('|').map(p => p.trim());
      for (const pattern of patterns) {
        // Support glob-style prefix matching (e.g. "read" matches "read_file")
        if (
          toolName === pattern ||
          toolName.startsWith(pattern + '_') ||
          toolName.includes(pattern)
        ) {
          return rule;
        }
      }
    }
    return null;
  }

  // Infer which systems are affected by a tool call
  private inferAffectedSystems(toolName: string, args: Record<string, any>): string[] {
    const systems: string[] = [];
    if (/shell|run_command/.test(toolName)) systems.push('shell');
    if (/file|write|read|edit|delete|rename|copy|mkdir|append/.test(toolName)) {
      const p = args?.path || args?.file || '';
      systems.push(p ? `filesystem:${path.basename(String(p))}` : 'filesystem');
    }
    if (/web_|browser/.test(toolName)) systems.push('browser');
    if (/memory/.test(toolName)) systems.push('memory');
    if (/desktop/.test(toolName)) systems.push('desktop');
    if (/vercel/.test(toolName)) systems.push('vercel');
    if (/gmail|slack|github|notion|hubspot|salesforce|stripe/.test(toolName)) {
      systems.push('integration:' + toolName.split('_')[0]);
    }
    return systems;
  }

  // Build a human-readable summary for proposal/commit tier
  private buildProposalSummary(toolName: string, args: Record<string, any>): string {
    const argStr = Object.entries(args || {})
      .slice(0, 3)
      .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 60)}`)
      .join(', ');
    return `Tool "${toolName}" called with: ${argStr || '(no args)'}`;
  }

  // ── Rule management ────────────────────────────────────────────────────────

  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  addRule(rule: PolicyRule): void {
    this.rules = this.rules.filter(r => r.id !== rule.id);
    this.rules.push(rule);
    this.save();
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter(r => r.id !== id);
    this.save();
  }

  resetToDefaults(): void {
    this.rules = [...DEFAULT_POLICY_RULES];
    this.save();
  }

  reload(): void {
    this.load();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: PolicyEngine | null = null;

export function getPolicyEngine(): PolicyEngine {
  if (!_instance) _instance = new PolicyEngine();
  return _instance;
}
