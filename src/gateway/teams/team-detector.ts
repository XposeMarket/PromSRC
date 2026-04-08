/**
 * team-detector.ts — Automatic Team Suggestion
 *
 * Watches agent creation / config changes and suggests forming a team when
 * 2+ agents appear to be related (shared topic, same schedule pattern, etc.)
 *
 * Called from:
 *   - POST /api/agents (after creating an agent)
 *   - PUT /api/agents/:id (after updating an agent)
 *
 * Returns a TeamSuggestion or null. The suggestion is sent to the client via
 * WebSocket as { type: 'team_suggestion', suggestion } so the UI can show a
 * prompt: "Would you like me to create a Team for these agents?"
 */

import { getAgents } from '../../config/config';
import { getTeamMemberAgentIds } from './managed-teams';
import type { AgentDefinition } from '../../types';

// ─── Dismissal Memory ──────────────────────────────────────────────────────────
// Persists for the lifetime of the gateway process. A candidate group (identified
// by its sorted agent IDs) is suppressed once dismissed so the same suggestion
// never re-fires on the next agent create/update.

const _dismissedCandidates = new Set<string>();

function makeCandidateKey(agentIds: string[]): string {
  return [...agentIds].sort().join(',');
}

/**
 * Mark a candidate group as dismissed. Call this when the user clicks
 * "No thanks" / closes the team suggestion prompt.
 */
export function dismissTeamSuggestion(candidateAgentIds: string[]): void {
  _dismissedCandidates.add(makeCandidateKey(candidateAgentIds));
}

export interface TeamSuggestion {
  suggestedName: string;
  suggestedEmoji: string;
  suggestedContext: string;
  candidateAgentIds: string[];
  candidateAgentNames: string[];
  confidence: number;           // 0–1
  reason: string;
}

// ─── Keyword clusters used for topic detection ─────────────────────────────────

const TOPIC_CLUSTERS: Array<{ keywords: string[]; label: string; emoji: string }> = [
  {
    keywords: ['twitter', 'x.com', 'tweet', 'poster', 'replier', 'liker', 'x account', 'social'],
    label: 'X (Twitter) Account',
    emoji: '🐦',
  },
  {
    keywords: ['linkedin', 'linkedin post', 'linkedin connect'],
    label: 'LinkedIn',
    emoji: '💼',
  },
  {
    keywords: ['reddit', 'subreddit', 'post reddit'],
    label: 'Reddit',
    emoji: '🤖',
  },
  {
    keywords: ['research', 'web search', 'report', 'analyst', 'scrape'],
    label: 'Research',
    emoji: '🔬',
  },
  {
    keywords: ['code review', 'bug', 'changelog', 'deploy', 'ci', 'github'],
    label: 'Dev',
    emoji: '💻',
  },
  {
    keywords: ['email', 'newsletter', 'inbox', 'reply email'],
    label: 'Email',
    emoji: '📧',
  },
  {
    keywords: ['discord', 'server', 'moderator', 'discord bot'],
    label: 'Discord',
    emoji: '🎮',
  },
  {
    keywords: ['news', 'headlines', 'digest', 'briefing'],
    label: 'News',
    emoji: '📰',
  },
];

function normalizeText(s: string): string {
  return (s || '').toLowerCase().replace(/[_-]/g, ' ');
}

function agentTextContent(a: AgentDefinition): string {
  return normalizeText([a.name, a.description || '', a.id].join(' '));
}

function detectTopicCluster(agents: AgentDefinition[]): { label: string; emoji: string; matchedAgents: AgentDefinition[] } | null {
  for (const cluster of TOPIC_CLUSTERS) {
    const matched = agents.filter(a => {
      const text = agentTextContent(a);
      return cluster.keywords.some(kw => text.includes(kw));
    });
    if (matched.length >= 2) {
      return { label: cluster.label, emoji: cluster.emoji, matchedAgents: matched };
    }
  }
  return null;
}

function detectScheduleCluster(agents: AgentDefinition[]): AgentDefinition[] {
  // Group agents by schedule hour — if 2+ run in the same hour window, they might be a team
  const scheduled = agents.filter(a => a.cronSchedule);
  if (scheduled.length < 2) return [];

  // Extract hour from cron (field index 1 in 5-field cron)
  const hourGroups: Record<string, AgentDefinition[]> = {};
  for (const a of scheduled) {
    const parts = (a.cronSchedule || '').trim().split(/\s+/);
    if (parts.length < 5) continue;
    const hourField = parts[1];
    const key = isNaN(Number(hourField)) ? hourField : `h${hourField}`;
    hourGroups[key] = [...(hourGroups[key] || []), a];
  }

  for (const group of Object.values(hourGroups)) {
    if (group.length >= 2) return group;
  }
  return [];
}

/**
 * Run team detection across all current agents.
 * Returns a suggestion if a candidate group is found that isn't already in a team.
 */
export function detectTeamCandidate(): TeamSuggestion | null {
  const allAgents = getAgents() as AgentDefinition[];
  const teamMemberIds = getTeamMemberAgentIds();

  // Filter out agents already in a team
  const freeAgents = allAgents.filter(a => !teamMemberIds.has(a.id) && !a.default);
  if (freeAgents.length < 2) return null;

  // Try topic cluster first (highest signal)
  const topicMatch = detectTopicCluster(freeAgents);
  if (topicMatch) {
    const candidateAgentIds = topicMatch.matchedAgents.map(a => a.id);
    if (_dismissedCandidates.has(makeCandidateKey(candidateAgentIds))) return null;
    return {
      suggestedName: `${topicMatch.label} Team`,
      suggestedEmoji: topicMatch.emoji,
      suggestedContext: `Manage ${topicMatch.label} activities autonomously. The manager will coordinate the subagents, review their performance after each run, and continuously improve their prompts and schedules.`,
      candidateAgentIds,
      candidateAgentNames: topicMatch.matchedAgents.map(a => a.name),
      confidence: 0.90,
      reason: `${topicMatch.matchedAgents.length} agents share ${topicMatch.label} keywords`,
    };
  }

  // Fall back to schedule cluster
  const scheduleGroup = detectScheduleCluster(freeAgents);
  if (scheduleGroup.length >= 2) {
    const candidateAgentIds = scheduleGroup.map(a => a.id);
    if (_dismissedCandidates.has(makeCandidateKey(candidateAgentIds))) return null;
    return {
      suggestedName: 'Scheduled Team',
      suggestedEmoji: '⏰',
      suggestedContext: 'Coordinate these scheduled agents under a manager for automatic performance review and improvement.',
      candidateAgentIds,
      candidateAgentNames: scheduleGroup.map(a => a.name),
      confidence: 0.65,
      reason: `${scheduleGroup.length} agents run on similar schedules`,
    };
  }

  return null;
}

/**
 * Run detection after a new agent is created/updated.
 * Returns a suggestion to broadcast over WebSocket, or null.
 */
export function checkForTeamSuggestion(newAgentId?: string): TeamSuggestion | null {
  return detectTeamCandidate();
}
