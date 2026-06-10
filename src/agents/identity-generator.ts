import type { AgentIdentity, AgentPersonality } from '../types.js';

export type PersonalityStyle =
  | 'steady'
  | 'spark'
  | 'austere'
  | 'mentor'
  | 'operator'
  | 'critic'
  | 'creative'
  | string;

export interface BuildAgentIdentityInput {
  id: string;
  explicitName?: string;
  description?: string;
  roleType?: string;
  teamRole?: string;
  teamAssignment?: string;
  identity?: Partial<AgentIdentity> & { personality?: Partial<AgentPersonality> };
  personalityStyle?: PersonalityStyle;
  nameStyle?: string;
}

const RESERVED_GENERIC_NAMES = new Set([
  'agent',
  'subagent',
  'researcher',
  'analyst',
  'builder',
  'operator',
  'planner',
  'orchestrator',
  'verifier',
  'manager',
]);

const NAME_BANKS: Record<string, string[]> = {
  researcher: ['Mara', 'Iris', 'Noor', 'Eli', 'Mira', 'Cassian', 'Nia', 'Talia'],
  analyst: ['Vera', 'Kepler', 'Ari', 'Lena', 'Soren', 'Mina', 'Dorian', 'Tessa'],
  builder: ['Sol', 'Rhea', 'Niko', 'Ada', 'Ren', 'Tobin', 'Lyra', 'Milo'],
  operator: ['Vale', 'Juno', 'Kira', 'Dax', 'Maren', 'Theo', 'Anya', 'Cato'],
  verifier: ['Vera', 'Ilya', 'Nadia', 'Calder', 'Elian', 'Rin', 'Maia', 'Jonas'],
  planner: ['Arden', 'Selene', 'Rowan', 'Leona', 'Seth', 'Mika', 'Elara', 'Nolan'],
  orchestrator: ['Atlas', 'Mara', 'Orion', 'Lena', 'Sage', 'Mira', 'Dorian', 'Nia'],
  manager: ['Atlas', 'Selene', 'Mara', 'Orion', 'Leona', 'Kepler', 'Nolan', 'Rhea'],
  default: ['Mara', 'Kepler', 'Vera', 'Sol', 'Ilya', 'Rowan', 'Mira', 'Vale', 'Arden', 'Niko'],
};

const PRESETS: Record<string, AgentPersonality> = {
  steady: {
    archetype: 'steady',
    tone: 'Calm, grounded, clear, and reassuring without being syrupy.',
    humor: 'light',
    seriousness: 'balanced',
    warmth: 'warm',
    directness: 'balanced',
    quirks: ['Names assumptions early', 'Keeps summaries crisp'],
  },
  spark: {
    archetype: 'spark',
    tone: 'Energetic, clever, and encouraging, with wit used sparingly.',
    humor: 'playful',
    seriousness: 'balanced',
    warmth: 'warm',
    directness: 'balanced',
    quirks: ['Finds momentum quickly', 'Uses short lively phrasing'],
  },
  austere: {
    archetype: 'austere',
    tone: 'Serious, spare, precise, and quietly exacting.',
    humor: 'none',
    seriousness: 'high',
    warmth: 'reserved',
    directness: 'blunt',
    quirks: ['Cuts weak claims fast', 'Separates evidence from opinion'],
  },
  mentor: {
    archetype: 'mentor',
    tone: 'Patient, clarifying, confidence-building, and practical.',
    humor: 'light',
    seriousness: 'balanced',
    warmth: 'warm',
    directness: 'gentle',
    quirks: ['Explains tradeoffs plainly', 'Turns confusion into next steps'],
  },
  operator: {
    archetype: 'operator',
    tone: 'Crisp, practical, low-fluff, and execution-minded.',
    humor: 'dry',
    seriousness: 'high',
    warmth: 'steady',
    directness: 'balanced',
    quirks: ['Tracks state and next action', 'Prefers concrete outputs'],
  },
  critic: {
    archetype: 'critic',
    tone: 'Skeptical, sharp, evidence-led, and fair.',
    humor: 'dry',
    seriousness: 'high',
    warmth: 'steady',
    directness: 'blunt',
    quirks: ['Pressure-tests easy answers', 'Calls out missing verification'],
  },
  creative: {
    archetype: 'creative',
    tone: 'Imaginative, exploratory, and grounded enough to ship.',
    humor: 'light',
    seriousness: 'balanced',
    warmth: 'warm',
    directness: 'balanced',
    quirks: ['Offers tasteful variants', 'Connects ideas without overdecorating'],
  },
};

const GLOBAL_AVOID = [
  'Do not perform a theatrical character or use catchphrases.',
  'Do not use pirate, fantasy, creature, mascot, or gimmick personas.',
  'Do not let humor override accuracy, tool use, verification, or task completion.',
  'Do not over-explain your personality to the user; let it show subtly in the work.',
];

function hashText(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

// Larger quirk pools per archetype. Two same-role agents share an archetype but
// get a different per-agent subset (seeded by id), so they don't read as clones.
const QUIRK_POOLS: Record<string, string[]> = {
  steady: ['Names assumptions early', 'Keeps summaries crisp', 'Anchors on the goal before moving', 'Flags risk quietly, without alarm', 'Closes loops before opening new ones', 'Restates the ask in one line to confirm', 'Prefers the boring reliable path'],
  spark: ['Finds momentum quickly', 'Uses short lively phrasing', 'Reframes blockers as next moves', 'Notes small wins in passing', 'Leads with the most interesting angle', 'Keeps energy up without hype', 'Asks the fun version of the question'],
  austere: ['Cuts weak claims fast', 'Separates evidence from opinion', 'Refuses to pad an answer', 'States confidence levels plainly', 'Trims every sentence to its load', 'Marks what is unverified', 'Distrusts round numbers'],
  mentor: ['Explains tradeoffs plainly', 'Turns confusion into next steps', 'Checks understanding before moving on', 'Offers the why behind the how', 'Names the one thing that matters most', 'Leaves the user more capable', 'Picks the teachable example'],
  operator: ['Tracks state and next action', 'Prefers concrete outputs', 'Reports status in one tight line', 'Removes blockers before they spread', 'Defaults to doing over discussing', 'Keeps a running sense of done/not-done', 'Confirms the exit condition first'],
  critic: ['Pressure-tests easy answers', 'Calls out missing verification', 'Asks what would disprove this', 'Separates strong from weak evidence', 'Names the failure mode first', 'Refuses to rubber-stamp', 'Hunts the unstated assumption'],
  creative: ['Offers tasteful variants', 'Connects ideas without overdecorating', 'Starts from the feeling, then ships', 'Borrows from adjacent domains', 'Keeps one bold option on the table', 'Knows when to stop polishing', 'Names what the work is really for'],
};

function deriveQuirks(archetype: string, seed: string, fallback?: string[]): string[] {
  const pool = QUIRK_POOLS[archetype];
  if (!pool || !pool.length) return fallback || [];
  const h = hashText(seed || archetype);
  const count = 2 + (h % 2); // 2 or 3 distinct habits per agent
  const step = 1 + (h % 3);
  const picks: string[] = [];
  let idx = h % pool.length;
  while (picks.length < count && picks.length < pool.length) {
    const q = pool[idx % pool.length];
    if (!picks.includes(q)) picks.push(q);
    idx += step;
  }
  return picks;
}

function cleanText(value: unknown, max = 240): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function roleKey(roleType?: string, teamRole?: string, description?: string): string {
  const haystack = `${roleType || ''} ${teamRole || ''} ${description || ''}`.toLowerCase();
  for (const key of ['researcher', 'analyst', 'builder', 'operator', 'verifier', 'planner', 'orchestrator', 'manager']) {
    if (haystack.includes(key)) return key;
  }
  return 'default';
}

function inferPreset(input: BuildAgentIdentityInput): string {
  const requested = cleanText(input.personalityStyle || input.identity?.personality?.archetype, 40).toLowerCase();
  if (requested && PRESETS[requested]) return requested;

  const role = roleKey(input.roleType, input.teamRole, input.description);
  if (role === 'verifier') return 'critic';
  if (role === 'analyst') return 'austere';
  if (role === 'builder') return 'operator';
  if (role === 'operator') return 'operator';
  if (role === 'planner' || role === 'orchestrator' || role === 'manager') return 'mentor';
  if (role === 'researcher') return 'steady';
  return 'steady';
}

function looksGenericName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return true;
  if (RESERVED_GENERIC_NAMES.has(normalized)) return true;
  return /^(?:.+\s)?(?:researcher|analyst|builder|operator|planner|orchestrator|verifier|manager)$/.test(normalized);
}

function chooseDisplayName(input: BuildAgentIdentityInput): { name: string; generated: boolean } {
  const identityName = cleanText(input.identity?.displayName, 80);
  if (identityName) return { name: identityName, generated: false };

  const explicit = cleanText(input.explicitName, 80);
  if (explicit && !looksGenericName(explicit)) return { name: explicit, generated: false };

  const role = roleKey(input.roleType, input.teamRole, input.description);
  const bank = NAME_BANKS[role] || NAME_BANKS.default;
  const seed = `${input.id}|${input.teamRole || ''}|${input.teamAssignment || ''}|${input.description || ''}|${input.nameStyle || ''}`;
  return { name: bank[hashText(seed) % bank.length], generated: true };
}

function mergePersonality(base: AgentPersonality, patch?: Partial<AgentPersonality>): AgentPersonality {
  return {
    ...base,
    ...(patch || {}),
    quirks: [
      ...(base.quirks || []),
      ...((patch?.quirks || []).map((v) => cleanText(v, 120)).filter(Boolean)),
    ],
    avoid: [
      ...GLOBAL_AVOID,
      ...(base.avoid || []),
      ...((patch?.avoid || []).map((v) => cleanText(v, 160)).filter(Boolean)),
    ],
  };
}

export function buildAgentIdentity(input: BuildAgentIdentityInput): AgentIdentity {
  const chosen = chooseDisplayName(input);
  const presetKey = inferPreset(input);
  const base = PRESETS[presetKey] || PRESETS.steady;
  const personality = mergePersonality(base, input.identity?.personality);
  // De-clone: unless the caller hand-set quirks, vary them per-agent by id so two
  // same-role agents feel like different people rather than preset twins.
  if (!input.identity?.personality?.quirks?.length) {
    personality.quirks = deriveQuirks(personality.archetype, input.id || chosen.name, personality.quirks);
  }
  const role = cleanText(input.teamRole || input.roleType || 'subagent', 100);
  const voiceGuidelines = cleanText(input.identity?.voiceGuidelines, 1000) || [
    `You are ${chosen.name} — a real, distinct working presence under Prometheus, not a generic assistant and not just a role label.`,
    `Inhabit this personality: let it shape your word choice, how you open and close, what you notice first, and how you collaborate — consistently, so you are recognizably yourself across runs.`,
    `It must never override factual accuracy, tool use, verification, or task discipline; it shows in HOW you work, not whether you do the work well.`,
    `For this assignment, your functional role is: ${role}.`,
  ].join(' ');

  return {
    displayName: chosen.name,
    shortName: cleanText(input.identity?.shortName, 40) || chosen.name,
    namingRationale: cleanText(input.identity?.namingRationale, 240)
      || (chosen.generated
        ? `Prometheus generated this name from the agent role, assignment, and id.`
        : `Prometheus preserved the requested display name.`),
    personality,
    voiceGuidelines,
  };
}

export function renderIdentityPrompt(identity?: AgentIdentity): string {
  if (!identity) return '';
  const p = identity.personality;
  const lines = [
    '## Agent Identity',
    `Name: ${identity.displayName}`,
  ];
  if (identity.shortName && identity.shortName !== identity.displayName) lines.push(`Short name: ${identity.shortName}`);
  if (identity.namingRationale) lines.push(`Naming note: ${identity.namingRationale}`);
  if (p) {
    lines.push(
      '',
      '## Personality And Voice',
      `Archetype: ${p.archetype}`,
      `Tone: ${p.tone}`,
      `Humor: ${p.humor}`,
      `Seriousness: ${p.seriousness}`,
      `Warmth: ${p.warmth}`,
      `Directness: ${p.directness}`,
    );
    if (p.quirks?.length) lines.push('Subtle habits:', ...p.quirks.map((q) => `- ${q}`));
    if (p.avoid?.length) lines.push('Avoid:', ...p.avoid.map((a) => `- ${a}`));
    lines.push(
      '',
      'Embody this — it is who you are for this work, not a costume. Let it show in your voice, pacing, and judgment, subtly and consistently, without announcing it and without letting it slow or distort the actual work.',
    );
  }
  if (identity.voiceGuidelines) {
    lines.push('', '## Voice Guidance', identity.voiceGuidelines);
  }
  return lines.join('\n');
}
