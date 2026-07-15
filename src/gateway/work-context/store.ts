import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import type { WorkContextPacket } from './contracts';

function safeSessionId(sessionId: string): string {
  return String(sessionId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'default';
}

function rootDir(): string {
  return path.join(getConfig().getConfigDir(), 'work-context');
}

function packetPath(sessionId: string): string {
  return path.join(rootDir(), `${safeSessionId(sessionId)}.json`);
}

function normalizePacket(raw: any): WorkContextPacket | null {
  if (!raw || typeof raw !== 'object' || Number(raw.version) !== 1) return null;
  const sessionId = String(raw.sessionId || '').trim();
  if (!sessionId) return null;
  return {
    ...raw,
    version: 1,
    sessionId,
    revision: Math.max(0, Number(raw.revision) || 0),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    completedSteps: Array.isArray(raw.completedSteps) ? raw.completedSteps.slice(-24) : [],
    pendingSteps: Array.isArray(raw.pendingSteps) ? raw.pendingSteps.slice(-16) : [],
    evidenceRefs: Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs.map(String).slice(-32) : [],
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts.slice(-32) : [],
    metrics: {
      startedAt: Number(raw.metrics?.startedAt) || Number(raw.createdAt) || Date.now(),
      totalToolCalls: Math.max(0, Number(raw.metrics?.totalToolCalls) || 0),
      discoveryToolCalls: Math.max(0, Number(raw.metrics?.discoveryToolCalls) || 0),
      mutationToolCalls: Math.max(0, Number(raw.metrics?.mutationToolCalls) || 0),
      verificationToolCalls: Math.max(0, Number(raw.metrics?.verificationToolCalls) || 0),
      accumulatedToolMs: Math.max(0, Number(raw.metrics?.accumulatedToolMs) || 0),
      firstTargetAt: Number(raw.metrics?.firstTargetAt) || undefined,
      firstMutationAt: Number(raw.metrics?.firstMutationAt) || undefined,
      verifiedAt: Number(raw.metrics?.verifiedAt) || undefined,
      requestToVerifiedMs: Number(raw.metrics?.requestToVerifiedMs) || undefined,
      estimatedNonToolMs: Number(raw.metrics?.estimatedNonToolMs) || undefined,
    },
    generic: {
      relevantPaths: Array.isArray(raw.generic?.relevantPaths) ? raw.generic.relevantPaths.map(String).slice(-40) : [],
      decisions: Array.isArray(raw.generic?.decisions) ? raw.generic.decisions.map(String).slice(-20) : [],
      lastTool: raw.generic?.lastTool ? String(raw.generic.lastTool) : undefined,
      updatedAt: Number(raw.generic?.updatedAt) || Number(raw.updatedAt) || Date.now(),
    },
  } as WorkContextPacket;
}

export function loadWorkContextPacket(sessionId: string): WorkContextPacket | null {
  const filePath = packetPath(sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizePacket(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch {
    return null;
  }
}

export function saveWorkContextPacket(packet: WorkContextPacket, maxBytes = 96_000): WorkContextPacket {
  fs.mkdirSync(rootDir(), { recursive: true });
  const normalized = normalizePacket(packet);
  if (!normalized) throw new Error('Invalid work context packet.');
  normalized.revision += 1;
  normalized.updatedAt = Date.now();
  let text = JSON.stringify(normalized, null, 2);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    normalized.completedSteps = normalized.completedSteps.slice(-10);
    normalized.evidenceRefs = normalized.evidenceRefs.slice(-12);
    normalized.artifacts = normalized.artifacts.slice(-16);
    normalized.generic.decisions = normalized.generic.decisions.slice(-8);
    if (normalized.browser) normalized.browser.namedTargets = normalized.browser.namedTargets.slice(-12);
    if (normalized.desktop) normalized.desktop.semanticTargets = normalized.desktop.semanticTargets.slice(-12);
    if (normalized.creative) normalized.creative.sourceAssets = normalized.creative.sourceAssets.slice(-16);
    if (normalized.coding) normalized.coding.targets = normalized.coding.targets.slice(-20);
    text = JSON.stringify(normalized, null, 2);
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`Work context packet exceeds ${maxBytes} bytes after compaction.`);
  }
  const finalPath = packetPath(normalized.sessionId);
  const tmpPath = `${finalPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, text, 'utf-8');
  try {
    fs.renameSync(tmpPath, finalPath);
  } catch {
    try { fs.unlinkSync(finalPath); } catch { /* absent */ }
    fs.renameSync(tmpPath, finalPath);
  }
  return normalized;
}

export function deleteWorkContextPacket(sessionId: string): void {
  try { fs.unlinkSync(packetPath(sessionId)); } catch { /* already absent */ }
}

export function getWorkContextPacketPath(sessionId: string): string {
  return packetPath(sessionId);
}

export function listWorkContextPackets(): WorkContextPacket[] {
  const root = rootDir();
  if (!fs.existsSync(root)) return [];
  const packets: WorkContextPacket[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const packet = normalizePacket(JSON.parse(fs.readFileSync(path.join(root, entry.name), 'utf-8')));
      if (packet) packets.push(packet);
    } catch {
      // Ignore corrupt packets in aggregate diagnostics; the individual path remains inspectable.
    }
  }
  return packets.sort((a, b) => b.updatedAt - a.updatedAt);
}
