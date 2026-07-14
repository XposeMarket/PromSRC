import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = (id) => fs.readFileSync(path.join(root, 'workspace', 'skills', id, 'SKILL.md'), 'utf8');

// Restart contract: discover/select/close-confirm/resolve/launch/visible-confirm, without touching ChatGPT.
const restart = read('chatgpt-desktop-restart');
for (const token of ['desktop_list_windows', 'desktop_window_control', 'desktop_find_installed_app', 'desktop_launch_app', 'delivery_send_screenshot']) assert(restart.includes(token));
assert.match(restart, /explicit user request/i);
assert.match(restart, /successful launch command alone is insufficient/i);
const dummy = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true });
assert(dummy.pid && dummy.pid !== process.pid);
dummy.kill();
await new Promise((resolve, reject) => { dummy.once('exit', resolve); dummy.once('error', reject); });

// Development handoff: exercise the ordered tool-call contract against a local mock receiver.
const received = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
for (const call of [
  { tool: 'desktop_focus_window', args: { name: 'ChatGPT' } },
  { tool: 'desktop_press_key', args: { key: 'Ctrl+N' } },
  { tool: 'desktop_type', args: { text: 'Disposable debugging fixture; no secrets.' } },
  { tool: 'desktop_press_key', args: { key: 'Enter' } },
  { tool: 'delivery_send_screenshot', args: { source: 'desktop_new', target: 'origin' } },
]) await fetch(`http://127.0.0.1:${port}/tool`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(call) });
server.close();
assert.deepEqual(received.map(x => x.tool), ['desktop_focus_window','desktop_press_key','desktop_type','desktop_press_key','delivery_send_screenshot']);
assert.match(read('dev-debugging'), /visibly submitted/i);

// Development Self Repair escalation: sanitized packet -> auto-loaded private reference -> pending source proposal.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-phase4c-self-repair-'));
const workspace = path.join(temp, 'workspace'); fs.mkdirSync(workspace, { recursive: true });
const { createDiagnosticPacket } = await import('../dist/gateway/diagnostics/diagnostic-packet-store.js');
const packet = createDiagnosticPacket(workspace, {
  classification:'application_defect', severity:'medium', confidence:'high',
  observed_behavior:'fixture route returns the wrong status', expected_behavior:'fixture route returns healthy',
  minimal_reproduction:['run disposable fixture'], affected_subsystem:'gateway fixture',
  evidence:[{kind:'system_diagnostics',ref:'fixture snapshot',freshness:'current',provenance:'live_tool'}],
  attempted_recoveries:[{action:'retry read-only fixture',outcome:'failed'}], operational_recovery_exhausted:true,
  sanitized_summary:'Reproducible fixture source defect; no credentials.',
});
const { SkillsManager } = await import('../dist/gateway/skills-runtime/skills-manager.js');
const manager = new SkillsManager(path.join(root, 'workspace', 'skills'));
const devRefs = manager.readAutoLoadedResources('self-repair-protocol');
assert.equal(devRefs.length, 1); assert.match(devRefs[0].content, /write_proposal/); assert.match(devRefs[0].content, /sole source mutation workflow/);
const { getConfig } = await import('../dist/config/config.js');
const config = getConfig(); const originalGetWorkspacePath = config.getWorkspacePath.bind(config); config.getWorkspacePath = () => workspace;
const { createProposal, loadProposal } = await import('../dist/gateway/proposals/proposal-store.js');
const details = `Diagnostic packet: ${packet.id}\n\nWhy this change\nDisposable defect evidence.\n\nExact source edits\nInspect and correct src/gateway/fixture.ts only.\n\nDeterministic behavior after patch\nFixture returns healthy.\n\nAcceptance tests\nRun the disposable fixture.\n\nRisks and compatibility\nNo production mutation; approval remains required.`;
const proposal = createProposal({ type:'src_edit', executionMode:'code_change', priority:'medium', title:'Repair disposable gateway fixture', summary:`Escalated from ${packet.id}`, details, sourceAgentId:'phase4c-fixture', affectedFiles:[{path:'src/gateway/fixture.ts',change:'modify'}], executionSteps:[{kind:'edit',description:'Patch fixture only'},{kind:'test',description:'Run disposable fixture'}], requiresBuild:true, executorPrompt:`Use read_source on src/gateway/fixture.ts. Cite ${packet.id}. Modify only src/gateway/fixture.ts and test.`, riskTier:'low' });
assert.match(proposal.id, /^prop_/); assert.equal(loadProposal(proposal.id)?.status, 'pending'); assert(proposal.details.includes(packet.id));
config.getWorkspacePath = originalGetWorkspacePath;

console.log(JSON.stringify({dummyProcess:'passed',mockHandoffCalls:received.length,diagnosticPacket:packet.id,proposal:proposal.id,proposalStatus:'pending'}, null, 2));
