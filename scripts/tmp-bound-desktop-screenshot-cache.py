from pathlib import Path

p = Path('src/gateway/desktop-tools.ts')
text = p.read_text(encoding='utf-8')

old_state = """interface DesktopSessionState {\n  lastPacket?: DesktopAdvisorPacket;\n}\n\nconst sessions = new Map<string, DesktopSessionState>();\nconst DESKTOP_PACKET_TTL_MS = 15 * 60 * 1000;\n"""
new_state = """interface DesktopSessionState {\n  lastPacket?: DesktopAdvisorPacket;\n}\n\ninterface SessionHistory {\n  prevPacket?: DesktopAdvisorPacket;\n  lastPacket?: DesktopAdvisorPacket;\n}\n\nconst sessions = new Map<string, DesktopSessionState>();\nconst sessionHistory = new Map<string, SessionHistory>();\nconst DESKTOP_PACKET_TTL_MS = 15 * 60 * 1000;\nconst DESKTOP_SESSION_CACHE_LIMIT = Math.max(2, Number(process.env.PROMETHEUS_DESKTOP_SESSION_CACHE_LIMIT || 24) || 24);\n"""
if old_state not in text:
    raise SystemExit('desktop session state anchor not found')
text = text.replace(old_state, new_state, 1)

old_late = """interface SessionHistory {\n  prevPacket?: DesktopAdvisorPacket;\n  lastPacket?: DesktopAdvisorPacket;\n}\n\nconst sessionHistory = new Map<string, SessionHistory>();\n"""
if old_late not in text:
    raise SystemExit('late session history anchor not found')
text = text.replace(old_late, '', 1)

old_register = """function registerDesktopPacket(sessionId: string, packet: DesktopAdvisorPacket): void {\n  pruneDesktopPacketIndex(packet.capturedAt);\n  desktopPacketIndex.set(packet.screenshotId, {\n    sessionId,\n    packet,\n    expiresAt: packet.capturedAt + DESKTOP_PACKET_TTL_MS,\n  });\n}\n\nfunction markDesktopStateChanged(): void {\n"""
new_register = """function registerDesktopPacket(sessionId: string, packet: DesktopAdvisorPacket): void {\n  pruneDesktopPacketIndex(packet.capturedAt);\n  desktopPacketIndex.set(packet.screenshotId, {\n    sessionId,\n    packet,\n    expiresAt: packet.capturedAt + DESKTOP_PACKET_TTL_MS,\n  });\n}\n\nfunction pruneDesktopSessionCaches(now: number = Date.now()): void {\n  for (const [sessionId, state] of sessions.entries()) {\n    const capturedAt = Number(state.lastPacket?.capturedAt || 0);\n    if (!capturedAt || capturedAt + DESKTOP_PACKET_TTL_MS <= now) {\n      sessions.delete(sessionId);\n      sessionHistory.delete(sessionId);\n    }\n  }\n\n  if (sessions.size > DESKTOP_SESSION_CACHE_LIMIT) {\n    const oldest = [...sessions.entries()]\n      .sort((a, b) => Number(a[1].lastPacket?.capturedAt || 0) - Number(b[1].lastPacket?.capturedAt || 0));\n    for (const [sessionId] of oldest.slice(0, sessions.size - DESKTOP_SESSION_CACHE_LIMIT)) {\n      sessions.delete(sessionId);\n      sessionHistory.delete(sessionId);\n    }\n  }\n\n  for (const sessionId of sessionHistory.keys()) {\n    if (!sessions.has(sessionId)) sessionHistory.delete(sessionId);\n  }\n}\n\nfunction markDesktopStateChanged(): void {\n"""
if old_register not in text:
    raise SystemExit('desktop packet register anchor not found')
text = text.replace(old_register, new_register, 1)

old_store = """function storeDesktopPacket(sessionId: string, packet: DesktopAdvisorPacket): void {\n  sessions.set(sessionId, { lastPacket: packet });\n  registerDesktopPacket(sessionId, packet);\n}\n"""
new_store = """function storeDesktopPacket(sessionId: string, packet: DesktopAdvisorPacket): void {\n  pruneDesktopSessionCaches(packet.capturedAt);\n  sessions.set(sessionId, { lastPacket: packet });\n  registerDesktopPacket(sessionId, packet);\n  pruneDesktopSessionCaches(packet.capturedAt);\n}\n"""
if old_store not in text:
    raise SystemExit('storeDesktopPacket anchor not found')
text = text.replace(old_store, new_store, 1)

old_history = """  // Capture previous packet before overwriting\n  const existing = sessions.get(sessionId);\n"""
new_history = """  // Capture previous packet before overwriting. Expired session images are\n  // discarded first so history never revives a packet past its cache lifetime.\n  pruneDesktopSessionCaches();\n  const existing = sessions.get(sessionId);\n"""
if old_history not in text:
    raise SystemExit('desktop history anchor not found')
text = text.replace(old_history, new_history, 1)

old_get = """export function getDesktopAdvisorPacket(sessionId: string): DesktopAdvisorPacket | null {\n  const state = sessions.get(sessionId);\n  if (!state?.lastPacket) return null;\n  return state.lastPacket;\n}\n"""
new_get = """export function getDesktopAdvisorPacket(sessionId: string): DesktopAdvisorPacket | null {\n  pruneDesktopSessionCaches();\n  const state = sessions.get(sessionId);\n  if (!state?.lastPacket) return null;\n  return state.lastPacket;\n}\n"""
if old_get not in text:
    raise SystemExit('getDesktopAdvisorPacket anchor not found')
text = text.replace(old_get, new_get, 1)

p.write_text(text, encoding='utf-8')

reg = Path('scripts/test-desktop-cache-contract.mjs')
reg.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/gateway/desktop-tools.ts', 'utf8');

assert.match(source, /const DESKTOP_SESSION_CACHE_LIMIT = Math\.max\(/, 'desktop session screenshot cache must have a hard entry bound');
assert.match(source, /capturedAt \+ DESKTOP_PACKET_TTL_MS <= now/, 'desktop session screenshots must expire on the same TTL as screenshot IDs');
assert.match(source, /sessions\.delete\(sessionId\);\s*sessionHistory\.delete\(sessionId\);/, 'current and previous screenshot caches must be evicted together');
assert.match(source, /export function getDesktopAdvisorPacket[\s\S]*?pruneDesktopSessionCaches\(\);/, 'reads must prune expired screenshot packets, not only future writes');
assert.match(source, /function storeDesktopPacket[\s\S]*?pruneDesktopSessionCaches\(packet\.capturedAt\);[\s\S]*?sessions\.set/, 'writes must prune before retaining another base64 screenshot packet');

console.log('desktop screenshot cache contract regression: ok');
''', encoding='utf-8')
print('desktop screenshot cache patch applied')
