import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {createRequire} from 'node:module';
import {getConnectorLogoUrl, colorLogoStyle} from '../web-ui/src/features/connectors/connector-logo-runtime.js';
const require=createRequire(import.meta.url);require('tsx/cjs');
const {listHostedMcpCatalog}=require('../src/gateway/hosted-mcp-catalog.ts');
const manifests=kind=>{const dir=new URL(`../src/extensions/bundled/${kind}/`,import.meta.url);return readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory() && !d.name.startsWith('_')).map(d=>JSON.parse(readFileSync(new URL(`${d.name}/prometheus.extension.json`,dir))).id);};
const connectors=manifests('connectors'), presets=manifests('mcp_presets'), hosted=listHostedMcpCatalog().map(p=>p.id);
for(const id of [...connectors,...hosted,...presets,'shopmonkey','websembli_mail','godot-mcp-runtime']){
 const url=getConnectorLogoUrl(id);assert.match(url,/^\/static\/assets\/connectors\/[a-z0-9]+\.(svg|png)$/,id);
 if(!['memory','filesystem'].includes(id))assert.ok(!url.includes('modelcontextprotocol'),id);
 const bytes=readFileSync(new URL('../web-ui/src/'+url.slice('/static/'.length),import.meta.url));
 if(url.endsWith('.svg'))assert.match(bytes.toString(),/<path\b/);else {assert.equal(bytes.readUInt32BE(0),0x89504e47);assert.match(colorLogoStyle(id),/mask:none/);}
}
for(const id of hosted)assert.equal(getConnectorLogoUrl(`mcp-hosted-${id}`),getConnectorLogoUrl(id));
assert.equal(getConnectorLogoUrl('unknown_connector'),'');assert.equal(getConnectorLogoUrl('memory_search'),'');
console.log(`PASS: ${connectors.length} connectors, ${hosted.length} hosted services, ${presets.length} MCP presets, local connectors and Godot. All resolve to real local assets.`);
