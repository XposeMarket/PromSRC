import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = path.join(__dirname, 'ffmpeg.exe');
const out = path.join(__dirname, 'verification');
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
const times = [1, 7, 14, 22, 31, 38, 43];
for (const t of times) {
  const result = spawnSync(ffmpeg, ['-y','-ss',String(t),'-i',path.join(__dirname,'final.mp4'),'-frames:v','1',path.join(out,`t${String(t).padStart(2,'0')}.png`)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const stat = await fs.stat(path.join(__dirname, 'final.mp4'));
console.log(JSON.stringify({ finalMp4: path.join(__dirname,'final.mp4'), bytes: stat.size, sampleFrames: times.map(t=>`verification/t${String(t).padStart(2,'0')}.png`) }, null, 2));
