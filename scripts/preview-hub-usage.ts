/** Local read-only visual verification harness. No gateway writes or synthetic telemetry.
 * npx tsx scripts/preview-hub-usage.ts <absolute model-usage.jsonl> [port=4317]
 * Then node scripts/capture-hub-usage.mjs [port=4317] [output-directory]
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { aggregateHubUsageAnalytics } from '../src/gateway/hub-usage-analytics.js';
const log = process.argv[2];
if (!log || !fs.existsSync(log)) throw new Error('Pass an existing model-usage.jsonl (read-only).');
const events = fs.readFileSync(log, 'utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const app = express();
app.get('/api/hub/usage-analytics', (req,res) => res.json({ success:true, ...aggregateHubUsageAnalytics(events,{range:req.query.range,provider:req.query.provider}) }));
app.get('/hub-preview', (_req,res) => res.type('html').send(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles/hub.css"><style>:root{--panel:#17191c;--panel-2:#202328;--line:#30343a;--text:#edeef1;--muted:#9ca3ae;background:#101214;font-family:system-ui}*{box-sizing:border-box}body{margin:0;padding:28px}main{max-width:1384px;margin:auto}button,select{font-family:inherit}@media(max-width:600px){body{padding:16px}}html[data-theme=light]{--panel:#fff;--panel-2:#f1f3f5;--line:#dde0e4;--text:#181b20;--muted:#606873;background:#f7f8fa}</style></head><body><main><section id="hub-usage" class="hub-usage" aria-label="Usage analytics"></section></main><script type="module">import {activateHubUsage} from '/src/pages/HubUsage.js';activateHubUsage();</script></body></html>`));
// The production output is served first; source fallback supports inspecting a new unbuilt worktree.
app.use(express.static(path.resolve('generated/public-web-ui')));
app.use(express.static(path.resolve('web-ui')));
app.listen(Number(process.argv[3] || 4317),'127.0.0.1',() => console.log(`Read-only Hub preview on http://127.0.0.1:${process.argv[3] || 4317}/hub-preview; ${events.length} real log events`));
