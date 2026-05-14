#!/usr/bin/env node
/**
 * Downloads MobileSAM (encoder + decoder) and LaMa ONNX weights into
 * `<prometheus config dir>/models/`. Run once; the Creative Image extract-layers
 * pipeline expects these files. Overridable via env vars:
 *   PROMETHEUS_MOBILESAM_ENCODER_PATH, PROMETHEUS_MOBILESAM_DECODER_PATH, PROMETHEUS_LAMA_PATH
 *   PROMETHEUS_MOBILESAM_ENCODER_URL, PROMETHEUS_MOBILESAM_DECODER_URL, PROMETHEUS_LAMA_URL
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { URL } from 'node:url';

const CONFIG_DIR = process.env.PROMETHEUS_CONFIG_DIR
  || path.join(process.cwd(), '.prometheus');
const MODELS_DIR = path.join(CONFIG_DIR, 'models');
fs.mkdirSync(MODELS_DIR, { recursive: true });

const TARGETS = [
  {
    key: 'sam_encoder',
    file: 'mobile_sam_encoder.onnx',
    envUrl: 'PROMETHEUS_MOBILESAM_ENCODER_URL',
    urls: [
      'https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx',
    ],
  },
  {
    key: 'sam_decoder',
    file: 'mobile_sam_decoder.onnx',
    envUrl: 'PROMETHEUS_MOBILESAM_DECODER_URL',
    urls: [
      'https://huggingface.co/Acly/MobileSAM/resolve/main/sam_mask_decoder_multi.onnx',
    ],
  },
  {
    key: 'lama',
    file: 'lama.onnx',
    envUrl: 'PROMETHEUS_LAMA_URL',
    urls: [
      'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
      'https://huggingface.co/aka7774/lama-onnx/resolve/main/big-lama.onnx',
    ],
  },
  {
    key: 'rmbg',
    file: 'rmbg.onnx',
    envUrl: 'PROMETHEUS_RMBG_URL',
    optional: true,
    urls: [
      'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx',
      'https://huggingface.co/briaai/RMBG-2.0/resolve/main/onnx/model.onnx',
      'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx',
    ],
  },
];

function fetchToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const tmp = `${destPath}.part`;
    const out = fs.createWriteStream(tmp);
    let resolved = false;
    const cleanup = (err) => {
      if (resolved) return;
      resolved = true;
      out.close(() => {
        if (err) {
          try { fs.unlinkSync(tmp); } catch {}
          reject(err);
        } else {
          fs.renameSync(tmp, destPath);
          resolve();
        }
      });
    };

    const req = https.get(new URL(url), { headers: { 'User-Agent': 'prometheus-creative-models/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const next = res.headers.location;
        res.resume();
        if (!next) return cleanup(new Error(`Redirect without Location from ${url}`));
        fetchToFile(new URL(next, url).toString(), destPath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return cleanup(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      let lastPct = -1;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            process.stdout.write(`\r    ${pct}%   ${(received / 1e6).toFixed(1)}MB / ${(total / 1e6).toFixed(1)}MB   `);
          }
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        process.stdout.write('\n');
        cleanup();
      });
      res.on('error', cleanup);
      out.on('error', cleanup);
    });
    req.on('error', cleanup);
  });
}

async function downloadOne(target) {
  const dest = path.join(MODELS_DIR, target.file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    console.log(`✓ ${target.file} already present (${(fs.statSync(dest).size / 1e6).toFixed(1)}MB)`);
    return;
  }
  const urls = process.env[target.envUrl] ? [process.env[target.envUrl]] : target.urls;
  let lastErr = null;
  for (const url of urls) {
    console.log(`→ Fetching ${target.file} from ${url}`);
    try {
      await fetchToFile(url, dest);
      console.log(`✓ Saved ${dest}`);
      return;
    } catch (err) {
      console.warn(`  failed: ${err?.message || err}`);
      lastErr = err;
    }
  }
  throw new Error(`Could not download ${target.file}. Last error: ${lastErr?.message || lastErr}`);
}

(async () => {
  console.log(`Models directory: ${MODELS_DIR}`);
  for (const t of TARGETS) {
    try {
      await downloadOne(t);
    } catch (err) {
      console.error(`✗ ${t.file}: ${err?.message || err}`);
      console.error(`  Set ${t.envUrl}=<url> with a working mirror or place the file manually at ${path.join(MODELS_DIR, t.file)}.`);
      if (!t.optional) process.exitCode = 1;
    }
  }
  console.log('Done.');
})();
