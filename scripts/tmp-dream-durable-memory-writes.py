from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) The model-facing surface is the unified `memory` tool. Dream still
# allowed the now-internal compatibility name `memory_write`, which meant the
# strict handleChat allowlist removed the only writable memory tool.
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "          'memory_browse',\n          'memory_write',\n",
    "          'memory_browse',\n          'memory',\n",
)

# Make the prompt name the capability it actually receives and give
# contradiction correction a deterministic surgical operation.
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "If 0 items pass all 4 gates: write nothing to memory. This is normal.\n\nFor items that pass:\n",
    "If 0 items pass all 4 gates: write nothing to memory. This is normal.\n\nMemory mutation tool contract:\n- Add a new durable item with memory(action=\"write\", file=\"user|soul|memory\", category=\"...\", content=\"...\").\n- Correct one existing durable bullet with memory(action=\"update\", file=\"user|soul|memory\", category=\"...\", previous_content=\"exact current bullet text after '- '\", content=\"replacement text\").\n- For update, copy previous_content exactly from the current file. The operation fails rather than guessing if zero or multiple bullets match.\n- Do not use generic workspace_edit/file-edit tools on USER.md, SOUL.md, or MEMORY.md in this pass.\n\nFor items that pass:\n",
)
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "  - Edit USER.md for: user identity, preferences, projects, communication style, workflow rules\n  - Edit SOUL.md for: Prometheus behavior rules, tool policies, operating constraints\n  - Edit MEMORY.md for: durable long-term context, decisions, and historical through-lines\n",
    "  - Use memory(action=\"write\"|\"update\") with file=\"user\" for: user identity, preferences, projects, communication style, workflow rules\n  - Use memory(action=\"write\"|\"update\") with file=\"soul\" for: Prometheus behavior rules, tool policies, operating constraints\n  - Use memory(action=\"write\"|\"update\") with file=\"memory\" for: durable long-term context, decisions, and historical through-lines\n",
)

# 2) Extend only the compact unified memory schema. Legacy memory_write remains
# an internal executor compatibility name and is not re-exposed to models.
replace_once(
    'src/gateway/tools/defs/file-web-memory.ts',
    "description: 'Unified lightweight memory wrapper. Set action=\"write\" to save a durable fact, action=\"read\" to read USER.md/SOUL.md/MEMORY.md, or action=\"search\" to retrieve relevant long-term memory. In a distinct manager/agent runtime only file=\"memory\" is allowed for file access and resolves to that actor’s private MEMORY.md; it never falls back to main memory.',",
    "description: 'Unified lightweight memory wrapper. Set action=\"write\" to add a durable fact, action=\"update\" to replace one exact existing durable bullet, action=\"read\" to read USER.md/SOUL.md/MEMORY.md, or action=\"search\" to retrieve relevant long-term memory. In a distinct manager/agent runtime only file=\"memory\" is allowed for file access and resolves to that actor’s private MEMORY.md; it never falls back to main memory.',",
)
replace_once(
    'src/gateway/tools/defs/file-web-memory.ts',
    "action: { type: 'string', enum: ['write', 'read', 'search'], description: 'Memory operation to perform.' },\n            file: { type: 'string', enum: ['user', 'soul', 'memory'], description: 'For write/read: \"user\" for USER.md, \"soul\" for SOUL.md, or \"memory\" for MEMORY.md.' },\n            category: { type: 'string', description: 'For write: category section name, such as coding, communication_style, or projects.' },\n            content: { type: 'string', description: 'For write: the specific, concise fact or update to save.' },\n",
    "action: { type: 'string', enum: ['write', 'update', 'read', 'search'], description: 'Memory operation to perform.' },\n            file: { type: 'string', enum: ['user', 'soul', 'memory'], description: 'For write/update/read: \"user\" for USER.md, \"soul\" for SOUL.md, or \"memory\" for MEMORY.md.' },\n            category: { type: 'string', description: 'For write/update: category section name, such as coding, communication_style, projects, or Personality.' },\n            previous_content: { type: 'string', description: 'For update: exact current bullet text after the leading \"- \". The update fails if zero or multiple bullets in the category match.' },\n            content: { type: 'string', description: 'For write/update: the specific, concise durable fact to save. A fresh date stamp is added automatically.' },\n",
)

# 3) Capability implementation: route unified update internally, canonicalize
# category matching so `personality` correctly targets an existing
# `## Personality` section, and perform exact single-bullet replacement.
executor = Path('src/gateway/agents-runtime/capabilities/memory-executor.ts')
text = executor.read_text(encoding='utf-8')

old = """function resolveMemoryFile(file: any): { key: 'user' | 'memory' | 'soul'; filename: string } {
  const raw = String(file || 'user').toLowerCase().trim();
"""
new = """function normalizeMemoryCategory(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

interface MemoryCategorySection {
  headerStart: number;
  bodyStart: number;
  end: number;
  heading: string;
}

function findMemoryCategorySection(content: string, category: string): MemoryCategorySection | null {
  const wanted = normalizeMemoryCategory(category);
  if (!wanted) return null;
  const headingRe = /^##[ \\t]+(.+?)\\s*$/gm;
  const matches: Array<{ index: number; end: number; heading: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(content)) !== null) {
    matches.push({ index: match.index, end: headingRe.lastIndex, heading: String(match[1] || '').trim() });
  }
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    if (normalizeMemoryCategory(current.heading) !== wanted) continue;
    return {
      headerStart: current.index,
      bodyStart: current.end,
      end: index + 1 < matches.length ? matches[index + 1].index : content.length,
      heading: current.heading,
    };
  }
  return null;
}

function resolveMemoryFile(file: any): { key: 'user' | 'memory' | 'soul'; filename: string } {
  const raw = String(file || 'user').toLowerCase().trim();
"""
if text.count(old) != 1:
    raise SystemExit('memory executor helper insertion anchor mismatch')
text = text.replace(old, new, 1)

old = """      const delegateName = action === 'write'
        ? 'memory_write'
        : action === 'read'
          ? 'memory_read'
          : action === 'search'
            ? 'memory_search'
            : '';
"""
new = """      const delegateName = action === 'write'
        ? 'memory_write'
        : action === 'update'
          ? 'memory_update'
          : action === 'read'
            ? 'memory_read'
            : action === 'search'
              ? 'memory_search'
              : '';
"""
if text.count(old) != 1:
    raise SystemExit('memory wrapper delegate anchor mismatch')
text = text.replace(old, new, 1)
text = text.replace(
    "result: 'memory: action must be \"write\", \"read\", or \"search\"',",
    "result: 'memory: action must be \"write\", \"update\", \"read\", or \"search\"',",
    1,
)
text = text.replace("  'memory_write',\n", "  'memory_write',\n  'memory_update',\n", 1)

old_write = """      case 'memory_write': {
        const { filename } = resolveMemoryFile(args.file);
        const category = String(args.category || '').trim().toLowerCase().replace(/\\s+/g, '_');
        const content = String(args.content || '').trim();
        if (!category) return { name, args, result: 'memory_write: category is required', error: true };
        if (!content) return { name, args, result: 'memory_write: content is required', error: true };
        let memoryPath = '';
        try { memoryPath = resolveMemoryPath(workspacePath, filename, sessionId); }
        catch (err: any) { return { name, args, result: `memory_write blocked: ${String(err?.message || err)}`, error: true }; }
        if (!fs.existsSync(memoryPath)) {
          fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
          fs.writeFileSync(memoryPath, `# ${filename}\\n\\n---\\n`, 'utf-8');
        }
        let fileContent = fs.readFileSync(memoryPath, 'utf-8');
        const entry = `- ${content} [${new Date().toISOString().split('T')[0]}]`;
        const sectionHeader = `## ${category}`;
        const sectionIdx = fileContent.indexOf(`\\n${sectionHeader}`);
        if (sectionIdx !== -1) {
          const afterHeader = sectionIdx + sectionHeader.length + 1;
          const nextSection = fileContent.indexOf('\\n## ', afterHeader);
          const insertAt = nextSection !== -1 ? nextSection : fileContent.length;
          fileContent = fileContent.slice(0, insertAt) + '\\n' + entry + fileContent.slice(insertAt);
        } else {
          const closingComment = fileContent.lastIndexOf('\\n---');
          const insertAt = closingComment !== -1 ? closingComment : fileContent.length;
          fileContent = fileContent.slice(0, insertAt) + '\\n\\n' + sectionHeader + '\\n' + entry + fileContent.slice(insertAt);
        }
        fs.writeFileSync(memoryPath, fileContent, 'utf-8');
        if (filename === 'MEMORY.md') invalidateMemoryAtomSnapshot(path.dirname(memoryPath));
        const actor = getRuntimeActorContext(sessionId);
        const scope = actor?.kind === 'agent' || actor?.kind === 'manager' ? `${actor.kind}:${actor.agentId || 'unknown'}` : 'main';
        return { name, args, result: `Written to ${scope} ${filename} [${category}]: ${content}`, error: false };
      }
"""
new_write = """      case 'memory_write': {
        const { filename } = resolveMemoryFile(args.file);
        const category = normalizeMemoryCategory(args.category);
        const content = String(args.content || '').trim();
        if (!category) return { name, args, result: 'memory_write: category is required', error: true };
        if (!content) return { name, args, result: 'memory_write: content is required', error: true };
        let memoryPath = '';
        try { memoryPath = resolveMemoryPath(workspacePath, filename, sessionId); }
        catch (err: any) { return { name, args, result: `memory_write blocked: ${String(err?.message || err)}`, error: true }; }
        if (!fs.existsSync(memoryPath)) {
          fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
          fs.writeFileSync(memoryPath, `# ${filename}\\n\\n---\\n`, 'utf-8');
        }
        let fileContent = fs.readFileSync(memoryPath, 'utf-8');
        const entry = `- ${content} [${new Date().toISOString().split('T')[0]}]`;
        const section = findMemoryCategorySection(fileContent, category);
        if (section) {
          const needsLeadingNewline = section.end > 0 && fileContent[section.end - 1] !== '\\n';
          const prefix = needsLeadingNewline ? '\\n' : '';
          fileContent = fileContent.slice(0, section.end) + prefix + entry + '\\n' + fileContent.slice(section.end);
        } else {
          const sectionHeader = `## ${category}`;
          const closingComment = fileContent.lastIndexOf('\\n---');
          const insertAt = closingComment !== -1 ? closingComment : fileContent.length;
          fileContent = fileContent.slice(0, insertAt) + '\\n\\n' + sectionHeader + '\\n' + entry + '\\n' + fileContent.slice(insertAt);
        }
        fs.writeFileSync(memoryPath, fileContent, 'utf-8');
        if (filename === 'MEMORY.md') invalidateMemoryAtomSnapshot(path.dirname(memoryPath));
        const actor = getRuntimeActorContext(sessionId);
        const scope = actor?.kind === 'agent' || actor?.kind === 'manager' ? `${actor.kind}:${actor.agentId || 'unknown'}` : 'main';
        return { name, args, result: `Written to ${scope} ${filename} [${category}]: ${content}`, error: false };
      }

      case 'memory_update': {
        const { filename } = resolveMemoryFile(args.file);
        const category = normalizeMemoryCategory(args.category);
        const previousContent = String(args.previous_content || '').trim();
        const content = String(args.content || '').trim();
        if (!category) return { name, args, result: 'memory_update: category is required', error: true };
        if (!previousContent) return { name, args, result: 'memory_update: previous_content is required', error: true };
        if (!content) return { name, args, result: 'memory_update: content is required', error: true };
        let memoryPath = '';
        try { memoryPath = resolveMemoryPath(workspacePath, filename, sessionId); }
        catch (err: any) { return { name, args, result: `memory_update blocked: ${String(err?.message || err)}`, error: true }; }
        if (!fs.existsSync(memoryPath)) return { name, args, result: `memory_update: ${filename} not found at ${memoryPath}`, error: true };

        const fileContent = fs.readFileSync(memoryPath, 'utf-8');
        const section = findMemoryCategorySection(fileContent, category);
        if (!section) return { name, args, result: `memory_update: category ${category} was not found in ${filename}`, error: true };
        const sectionText = fileContent.slice(section.bodyStart, section.end);
        const target = `- ${previousContent}`;
        const lines = sectionText.split(/\\r?\\n/);
        const matches = lines.reduce<number[]>((out, line, index) => {
          if (line.trim() === target) out.push(index);
          return out;
        }, []);
        if (matches.length !== 1) {
          return {
            name,
            args,
            result: `memory_update: expected exactly one exact bullet match in ${filename} [${section.heading}], found ${matches.length}`,
            error: true,
          };
        }
        lines[matches[0]] = `- ${content} [${new Date().toISOString().split('T')[0]}]`;
        const updatedSection = lines.join(sectionText.includes('\\r\\n') ? '\\r\\n' : '\\n');
        const updated = fileContent.slice(0, section.bodyStart) + updatedSection + fileContent.slice(section.end);
        fs.writeFileSync(memoryPath, updated, 'utf-8');
        if (filename === 'MEMORY.md') invalidateMemoryAtomSnapshot(path.dirname(memoryPath));
        const actor = getRuntimeActorContext(sessionId);
        const scope = actor?.kind === 'agent' || actor?.kind === 'manager' ? `${actor.kind}:${actor.agentId || 'unknown'}` : 'main';
        return { name, args, result: `Updated ${scope} ${filename} [${section.heading}]: ${previousContent} -> ${content}`, error: false };
      }
"""
if text.count(old_write) != 1:
    raise SystemExit('memory_write implementation anchor mismatch')
text = text.replace(old_write, new_write, 1)
executor.write_text(text, encoding='utf-8')

# 4) Permanent regression expands the wrapper contract: update is exact,
# category matching is case/format-insensitive, and failed matches do not mutate.
test = Path('src/gateway/agents-runtime/capabilities/memory-wrapper.regression.ts')
source = test.read_text(encoding='utf-8')
replace = """    const write = await execute({ action: 'write', file: 'memory', category: 'tests', content: 'wrapper wrote this' });
    assert.equal(write.error, false, write.result);

    const read = await execute({ action: 'read', file: 'memory' });
    assert.equal(read.error, false, read.result);
    assert.ok(read.result.includes('wrapper wrote this'));

    const emptySearch = await execute({ action: 'search', query: '' });
"""
with_new = """    const write = await execute({ action: 'write', file: 'memory', category: 'tests', content: 'wrapper wrote this' });
    assert.equal(write.error, false, write.result);

    const read = await execute({ action: 'read', file: 'memory' });
    assert.equal(read.error, false, read.result);
    assert.ok(read.result.includes('wrapper wrote this'));

    const writtenMemory = fs.readFileSync(path.join(workspacePath, 'MEMORY.md'), 'utf8');
    const writtenBullet = writtenMemory.split(/\\r?\\n/).find((line) => line.includes('wrapper wrote this'))?.replace(/^\\s*-\\s*/, '') || '';
    assert.ok(writtenBullet, 'write should create a durable bullet');
    const update = await execute({ action: 'update', file: 'memory', category: 'Tests', previous_content: writtenBullet, content: 'wrapper corrected this' });
    assert.equal(update.error, false, update.result);
    const afterUpdate = fs.readFileSync(path.join(workspacePath, 'MEMORY.md'), 'utf8');
    assert.ok(afterUpdate.includes('wrapper corrected this'));
    assert.ok(!afterUpdate.includes('wrapper wrote this'));

    const beforeMissing = afterUpdate;
    const missingUpdate = await execute({ action: 'update', file: 'memory', category: 'tests', previous_content: 'does not exist', content: 'must not be written' });
    assert.equal(missingUpdate.error, true);
    assert.equal(fs.readFileSync(path.join(workspacePath, 'MEMORY.md'), 'utf8'), beforeMissing, 'failed exact update must not mutate memory');

    fs.writeFileSync(path.join(workspacePath, 'SOUL.md'), '# Soul\\n\\n## Personality\\n- existing persona\\n', 'utf8');
    const soulWrite = await execute({ action: 'write', file: 'soul', category: 'personality', content: 'case-insensitive section match' });
    assert.equal(soulWrite.error, false, soulWrite.result);
    const soulText = fs.readFileSync(path.join(workspacePath, 'SOUL.md'), 'utf8');
    assert.ok(soulText.includes('## Personality'));
    assert.ok(soulText.includes('case-insensitive section match'));
    assert.ok(!soulText.includes('## personality'), 'writer must not create a duplicate normalized section beside an existing display heading');

    const emptySearch = await execute({ action: 'search', query: '' });
"""
if source.count(replace) != 1:
    raise SystemExit('memory wrapper regression anchor mismatch')
test.write_text(source.replace(replace, with_new, 1), encoding='utf-8')

# 5) Contract regression proves Dream's strict allowlist points at a real
# model-facing writable tool and never resurrects the internal legacy schema.
Path('src/gateway/brain/brain-dream-memory-contract.regression.ts').write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getFileWebMemoryTools } from '../tools/defs/file-web-memory.js';

const definitions = getFileWebMemoryTools();
const names = new Set(definitions.map((tool: any) => String(tool?.function?.name || '')));
assert.ok(names.has('memory'), 'unified model-facing memory tool must exist');
assert.ok(!names.has('memory_write'), 'legacy memory_write must remain internal rather than becoming a second model schema');
const memoryDef = definitions.find((tool: any) => tool?.function?.name === 'memory');
assert.ok(memoryDef?.function?.parameters?.properties?.action?.enum?.includes('update'), 'unified memory schema must expose exact update');
assert.ok(memoryDef?.function?.parameters?.properties?.previous_content, 'unified memory update must expose previous_content');

const runner = fs.readFileSync(path.join(process.cwd(), 'src/gateway/brain/brain-runner.ts'), 'utf8');
const dreamStart = runner.indexOf("`CONTEXT: Automated Brain Dream run for ${dateStr}");
assert.ok(dreamStart >= 0, 'Dream handleChat call must remain discoverable');
const filterStart = runner.indexOf('brainDreamToolFilter([', dreamStart);
const filterEnd = runner.indexOf(']),', filterStart);
assert.ok(filterStart >= 0 && filterEnd > filterStart, 'Dream tool allowlist must remain discoverable');
const dreamFilter = runner.slice(filterStart, filterEnd);
assert.match(dreamFilter, /'memory'/, 'Dream must allow the real unified writable memory tool');
assert.doesNotMatch(dreamFilter, /'memory_write'/, 'Dream must not allowlist an internal legacy name that has no model definition');
assert.match(runner, /memory\(action="update"/, 'Dream prompt must teach exact contradiction correction');
console.log('brain Dream durable-memory contract regression: ok');
''', encoding='utf-8')

print('Dream durable-memory patch applied')
