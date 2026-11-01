import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canReadSkillResource, readSkillResourceText } from './skill-package';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-script-resource-'));
const rootDir = path.join(tmp, 'skill');
fs.mkdirSync(rootDir, { recursive: true });
const markerPath = path.join(tmp, 'script-was-executed.txt');

try {
  const extensions = [
    '.md', '.markdown', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.csv', '.tsv',
    '.html', '.htm', '.css', '.svg', '.xml', '.js', '.mjs', '.ts', '.tsx', '.py', '.sh',
    '.ps1', '.psm1', '.psd1', '.cmd', '.bat',
  ];

  for (const extension of extensions) {
    const upperExtension = extension.toUpperCase();
    const relPath = `resource${upperExtension}`;
    const content = `text fixture for ${upperExtension}\n`;
    fs.writeFileSync(path.join(rootDir, relPath), content, 'utf8');
    assert.equal(canReadSkillResource(relPath), true, `${upperExtension} should be a readable text resource`);
    const result = readSkillResourceText({ rootDir }, relPath);
    assert.equal(result.ok, true, `${upperExtension} should read successfully`);
    if (result.ok) {
      assert.equal(result.content, content, `${upperExtension} content should be preserved`);
      assert.equal(result.truncated, false);
    }
  }

  for (const extension of ['.ps1', '.psm1', '.psd1', '.cmd', '.bat']) {
    const upperExtension = extension.toUpperCase();
    const relPath = `sentinel${upperExtension}`;
    const command = extension === '.cmd' || extension === '.bat'
      ? `echo executed > "${markerPath}"\r\n`
      : `Set-Content -LiteralPath '${markerPath}' -Value executed\n`;
    fs.writeFileSync(path.join(rootDir, relPath), command, 'utf8');
    const result = readSkillResourceText({ rootDir }, relPath);
    assert.equal(result.ok, true, `${upperExtension} script should be read as text, not executed`);
    if (result.ok) assert.equal(result.content, command);
  }
  assert.equal(fs.existsSync(markerPath), false, 'reading script resources must never execute their sentinel command');

  for (const extension of ['.exe', '.dll']) {
    const relPath = `binary${extension}`;
    fs.writeFileSync(path.join(rootDir, relPath), Buffer.from([0x4d, 0x5a, 0, 0]));
    const result = readSkillResourceText({ rootDir }, relPath);
    assert.equal(result.ok, false, `${extension} binary resource must be rejected`);
  }

  const missing = readSkillResourceText({ rootDir }, 'missing.PS1');
  assert.equal(missing.ok, false, 'missing readable resource must return an error');
  if (!missing.ok) assert.match(missing.error, /not found/i);

  const outsidePath = path.join(tmp, 'outside.PS1');
  fs.writeFileSync(outsidePath, 'outside content\n', 'utf8');
  const traversal = readSkillResourceText({ rootDir }, '../outside.PS1');
  assert.equal(traversal.ok, false, 'parent traversal must be rejected');
  const absoluteEscape = readSkillResourceText({ rootDir }, outsidePath);
  assert.equal(absoluteEscape.ok, false, 'absolute path outside the skill root must be rejected');

  const longContent = '0123456789abcdef';
  fs.writeFileSync(path.join(rootDir, 'truncate.Ps1'), longContent, 'utf8');
  const truncated = readSkillResourceText({ rootDir }, 'truncate.Ps1', 7);
  assert.equal(truncated.ok, true);
  if (truncated.ok) {
    assert.equal(truncated.content, longContent.slice(0, 7));
    assert.equal(truncated.truncated, true);
  }

  console.log('skill-script-resource regression: ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
