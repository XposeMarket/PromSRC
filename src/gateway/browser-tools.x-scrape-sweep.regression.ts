import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'browser-tools.ts'), 'utf8');
const sweep = source.slice(source.indexOf('async function removeXScrapeProfileDir'), source.indexOf('/**\n * Kill X-scrape Chromes'));
assert.match(sweep, /await fs\.promises\.rm\(resolved, \{ recursive: true, force: true/);
assert.doesNotMatch(sweep, /fs\.rmSync\(/);
assert.match(source, /if \(await removeXScrapeProfileDir\(dir\)\) removedProfiles \+= 1;/);
console.log('PASS: X scrape orphan sweep uses awaited asynchronous recursive removal');
