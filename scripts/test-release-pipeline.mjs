import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const workflows = '.github/workflows';
for (const file of fs.readdirSync(workflows).filter(f => /\.ya?ml$/.test(f))) {
  const workflow = yaml.load(fs.readFileSync(path.join(workflows, file), 'utf8'));
  assert(workflow.name && workflow.on && workflow.jobs, `${file}: missing workflow keys`);
  for (const job of Object.values(workflow.jobs)) assert(job.uses || (job['runs-on'] && Array.isArray(job.steps)), `${file}: invalid job`);
  console.log(`YAML OK: ${file}`);
}
const release = yaml.load(fs.readFileSync(`${workflows}/release.yml`, 'utf8'));
assert.deepEqual(release.on.push.tags, ['v*.*.*']);
assert(release.on.workflow_dispatch.inputs.tag.required);
assert(release.jobs.publish.env.GH_TOKEN.includes('secrets.RELEASE_GH_TOKEN'));
for (const [job, file] of [['regression','pr-regression'],['privacy','privacy-secret-scan'],['storage','storage-layout-contract']]) {
  assert.equal(release.jobs[job].uses, `./.github/workflows/${file}.yml`);
  const workflow = yaml.load(fs.readFileSync(`${workflows}/${file}.yml`, 'utf8'));
  assert(workflow.on.workflow_call.inputs.ref.required);
  const checkout = Object.values(workflow.jobs)[0].steps.find(s => s.uses?.startsWith('actions/checkout'));
  assert(checkout.with.ref.includes('inputs.ref'));
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-release-manifest-'));
try {
  const asset = Buffer.from('verified fixture installer');
  fs.writeFileSync(path.join(temp, 'Prometheus.exe'), asset);
  fs.writeFileSync(path.join(temp, 'Prometheus.exe.blockmap'), 'fixture blockmap');
  for (const version of ['1.1.0-beta.1','1.1.0-rc.1','1.1.0']) {
    for (const file of fs.readdirSync(temp).filter(f => f.endsWith('.yml'))) fs.unlinkSync(path.join(temp,file));
    const channel = /-(beta|rc)\./.exec(version)?.[1] || 'latest';
    fs.writeFileSync(path.join(temp, `${channel}.yml`), yaml.dump({version,files:[{url:'Prometheus.exe',sha512:crypto.createHash('sha512').update(asset).digest('base64') }]}));
    execFileSync(process.execPath,['scripts/release-manifests.mjs',temp,`v${version}`],{stdio:'pipe'});
    for (const name of ['latest','beta','rc']) assert.equal(yaml.load(fs.readFileSync(path.join(temp,`${name}.yml`),'utf8')).version,version);
  }
  fs.writeFileSync(path.join(temp,'Prometheus.exe'),'tampered');
  const bad = spawnSync(process.execPath,['scripts/release-manifests.mjs',temp,'v1.1.0'],{encoding:'utf8'});
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/SHA512 mismatch/);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log('PASS: reusable release gates, workflow structure, stable/beta/rc metadata and tamper rejection');
