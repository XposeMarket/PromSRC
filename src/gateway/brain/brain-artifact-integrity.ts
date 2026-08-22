import fs from 'fs';
import type { BrainCarryForwardDecisionFile } from './brain-continuity.js';
import { parseBrainCarryForwardDecision, parseBrainThoughtCapsules } from './brain-continuity.js';

export type BrainArtifactStatus = 'missing' | 'stale' | 'invalid' | 'valid';

export interface BrainThoughtCapsuleArtifactInspection {
  status: BrainArtifactStatus;
  count: number;
  error?: string;
}

export interface BrainCarryForwardArtifactInspection {
  status: BrainArtifactStatus;
  decision: BrainCarryForwardDecisionFile | null;
  error?: string;
}

function isFresh(filePath: string, runStartedAt: number): boolean {
  try {
    return fs.statSync(filePath).mtimeMs >= (runStartedAt - 5000);
  } catch {
    return false;
  }
}

export function inspectBrainThoughtCapsuleArtifact(
  filePath: string,
  runStartedAt: number,
): BrainThoughtCapsuleArtifactInspection {
  // Thought owns this artifact as part of its required output contract. Treat a
  // missing sidecar as invalid rather than recoverable so the runner cannot
  // synthesize [] and mark a busy Thought successful with all continuity lost.
  if (!fs.existsSync(filePath)) return { status: 'invalid', count: 0, error: 'required capsule sidecar is missing' };
  if (!isFresh(filePath, runStartedAt)) return { status: 'stale', count: 0 };
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsedRaw = JSON.parse(raw);
    if (!Array.isArray(parsedRaw)) {
      return { status: 'invalid', count: 0, error: 'capsule sidecar must be a JSON array' };
    }
    const parsed = parseBrainThoughtCapsules(raw);
    if (parsed.length !== parsedRaw.length) {
      return {
        status: 'invalid',
        count: parsed.length,
        error: `capsule sidecar contains ${parsedRaw.length - parsed.length} invalid entr${parsedRaw.length - parsed.length === 1 ? 'y' : 'ies'}`,
      };
    }
    return { status: 'valid', count: parsed.length };
  } catch (error: any) {
    return { status: 'invalid', count: 0, error: String(error?.message || error || 'invalid JSON') };
  }
}

export function inspectBrainCarryForwardArtifact(
  filePath: string,
  runStartedAt: number,
  targetDate: string,
): BrainCarryForwardArtifactInspection {
  if (!fs.existsSync(filePath)) return { status: 'missing', decision: null };
  if (!isFresh(filePath, runStartedAt)) return { status: 'stale', decision: null };
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsedRaw = JSON.parse(raw) as Record<string, unknown>;
    if (!parsedRaw || typeof parsedRaw !== 'object' || !Array.isArray(parsedRaw.items)) {
      return { status: 'invalid', decision: null, error: 'carry-forward sidecar must contain an items array' };
    }
    const decision = parseBrainCarryForwardDecision(raw);
    if (!decision) return { status: 'invalid', decision: null, error: 'carry-forward sidecar is not valid decision JSON' };
    if (decision.items.length !== parsedRaw.items.length) {
      return { status: 'invalid', decision: null, error: `carry-forward sidecar contains ${parsedRaw.items.length - decision.items.length} invalid item(s)` };
    }
    if (decision.targetDate !== targetDate) {
      return {
        status: 'invalid',
        decision: null,
        error: `carry-forward targetDate ${decision.targetDate} does not match ${targetDate}`,
      };
    }
    return { status: 'valid', decision };
  } catch (error: any) {
    return { status: 'invalid', decision: null, error: String(error?.message || error || 'invalid carry-forward JSON') };
  }
}
