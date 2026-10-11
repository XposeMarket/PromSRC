import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { curatorContentFingerprint, getSkillCuratorStatus, listSkillCuratorSuggestions, mergeSuggestions, rejectSkillCuratorSuggestion, restoreSkillCuratorSuggestion, type SkillCuratorSuggestion } from './skill-curator';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-rejections-'));
try {
  const now = new Date().toISOString();
  const candidate = { id: 'sc_13e6', createdAt: now, updatedAt: now, status: 'pending', skillId: 'file-surgery', title: 'duplicate', reason: 'weak lesson', evidence: ['session:a'], risk: 'low', change: { kind: 'write_resource', path: 'lesson.md', content: 'Read first, then edit.' }, scan: { verdict: 'safe' } } as SkillCuratorSuggestion;
  const file = path.join(root, 'Brain', 'skill-curator', 'suggestions.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([candidate, { ...candidate, id: 'existing_duplicate' }]));
  const rejected = rejectSkillCuratorSuggestion(root, candidate.id)!;
  assert.equal(listSkillCuratorSuggestions(root)[0].status, 'rejected', 'rejection survives a fresh disk read');
  assert.equal(rejected.rejectedFingerprint, curatorContentFingerprint(candidate));
  assert.equal(listSkillCuratorSuggestions(root)[1].status, 'suppressed', 'existing duplicate is removed from the pending queue too');
  assert.equal((getSkillCuratorStatus(root).recent as unknown[]).length, 0, 'default future queue excludes rejection');
  assert.equal((getSkillCuratorStatus(root, { statusFilter: 'rejected' }).recent as unknown[]).length, 1);
  const duplicate = { ...candidate, id: 'sc_3ca7', evidence: ['session:b'], change: { ...candidate.change, content: 'READ first,  then edit.' } };
  assert.equal(mergeSuggestions([rejected], [duplicate]).filter((row) => row.status === 'pending').length, 0, 'new id and formatting do not revive the same content');
  assert.equal(mergeSuggestions([rejected], [{ ...candidate, change: { ...candidate.change, content: 'Inspect the actual failure and run the focused regression before retrying.' } }]).filter((row) => row.status === 'pending').length, 1, 'materially changed behavior can resurface without waiting');
  assert.equal(mergeSuggestions([{ ...rejected, suppressedUntil: '2000-01-01T00:00:00Z' }], [duplicate])[0].status, 'pending', 'expiry allows reconsideration');
  assert.equal(restoreSkillCuratorSuggestion(root, candidate.id)?.status, 'pending', 'explicit restore overrides suppression');
  assert.equal((getSkillCuratorStatus(root).recent as unknown[]).length, 1);
  console.log('skill curator rejection regression: ok');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
