// Read-only, 60-second live gateway probe. Never records message bodies or credentials.
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const WebSocket = createRequire(require('path').resolve(__dirname, '../../package.json'))('ws');
const endpoint = '127.0.0.1:32470';
const seconds = 60;
const duration = seconds * 1000;
const result = { startedAt: new Date().toISOString(), endpoint, seconds, frames: {}, status: { latenciesMs: [], errors: 0 }, errors: [] };
function shape(value, depth = 0) {
  if (typeof value === 'string') return { kind: 'string', bytes: Buffer.byteLength(value) };
  if (Array.isArray(value)) return { kind: 'array', length: value.length, first: depth < 2 ? shape(value[0], depth+1) : undefined };
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, depth < 2 ? shape(v,depth+1) : typeof v]));
  return value;
}
const ws = new WebSocket(`ws://${endpoint}/ws`);
ws.on('error', error => result.errors.push(`ws:${error.message}`));
ws.on('close', (code, reason) => result.errors.push(`ws-close:${code}:${String(reason).slice(0,60)}`));
ws.on('message', buffer => {
  try {
    const frame = JSON.parse(buffer.toString());
    const type = String(frame.type || '<unknown>');
    const bytes = buffer.length;
    const stat = result.frames[type] ||= { count: 0, bytes: 0, max: 0, largest: [] };
    stat.count++; stat.bytes += bytes; stat.max = Math.max(stat.max,bytes);
    stat.largest.push({ bytes, shape: shape(frame) });
    stat.largest.sort((a,b) => b.bytes - a.bytes);
    stat.largest.length = Math.min(stat.largest.length,3);
  } catch(e) { result.errors.push(`parse:${e.message}`); }
});
function poll() {
  const start = performance.now();
  const req = http.get(`http://${endpoint}/api/status`, res => {
    res.resume(); res.on('end', () => result.status.latenciesMs.push(Math.round((performance.now()-start)*10)/10));
  });
  req.on('error', () => result.status.errors++);
  req.setTimeout(3000, () => req.destroy(new Error('timeout')));
}
const timer = setInterval(poll,250); poll();
setTimeout(() => {
  clearInterval(timer); ws.close();
  const a = result.status.latenciesMs.sort((x,y) => x-y);
  result.status.summary = { count:a.length, p50:a[Math.floor(a.length*.5)], p95:a[Math.floor(a.length*.95)], max:a.at(-1), over250:a.filter(x=>x>250).length };
  delete result.status.latenciesMs;
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(__dirname+'/live-metrics.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({ status:result.status, frames:Object.fromEntries(Object.entries(result.frames).map(([k,v])=>[k,{count:v.count,bytes:v.bytes,max:v.max}])), errors:result.errors },null,2));
},duration);
