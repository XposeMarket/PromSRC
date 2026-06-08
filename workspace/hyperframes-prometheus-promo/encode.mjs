import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = path.join(__dirname, 'ffmpeg.exe');
const args = ['-y','-framerate','30','-i',path.join(__dirname,'frames','frame-%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(__dirname,'final.mp4')];
const result = spawnSync(ffmpeg, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
