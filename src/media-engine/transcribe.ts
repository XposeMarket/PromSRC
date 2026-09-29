/**
 * Transcribe what generated clips actually say, with word timing, so native
 * dialogue can be captioned from the clip audio instead of a TTS script.
 *
 * Primary: local openai-whisper (free, offline, word timestamps). One Python
 * process per batch so the model loads once. Fallback: OpenAI whisper-1
 * verbose_json with word granularity. Segments Whisper marks as non-speech are
 * dropped so ambience never turns into invented captions.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { runFfmpeg } from './engine.js';
import { fromWorkspaceRel, loadProject, mutateProject, selectedTake, type Shot, type TakeTranscript } from './project.js';

export type Word = { text: string; startMs: number; endMs: number };
export interface RawTranscript { text: string; words: Word[]; provider: string }
export type Transcriber = (wavPaths: string[]) => Promise<Array<RawTranscript | null>>;

let override: Transcriber | null = null;
/** Tests inject a deterministic transcriber (no Python / network). */
export function setTranscriberForTests(fn: Transcriber | null): void { override = fn; }

const PY_PROGRAM = String.raw`
import json, sys, wave
import numpy as np
import whisper
args = json.load(open(sys.argv[1], encoding='utf-8'))
model = whisper.load_model(args['model'])
out = []
for p in args['paths']:
    try:
        w = wave.open(p, 'rb')
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        w.close()
        r = model.transcribe(audio, fp16=False, word_timestamps=True, condition_on_previous_text=False, language=args.get('language'))
        words = []
        for s in r.get('segments', []):
            if s.get('no_speech_prob', 0) > 0.6 and s.get('avg_logprob', 0) < -0.8:
                continue
            for x in s.get('words', []) or []:
                t = (x.get('word') or '').strip()
                if t:
                    words.append({'text': t, 'startMs': int(round(x['start'] * 1000)), 'endMs': int(round(x['end'] * 1000)), 'p': float(x.get('probability', 1.0))})
        out.append({'text': ' '.join(x['text'] for x in words), 'words': words})
    except Exception as e:
        out.append({'error': str(e)[:300]})
print('@@JSON@@' + json.dumps(out))
`;

function pythonCandidates(): string[] {
  const roots = process.platform === 'win32'
    ? ['C:\\Python314\\python.exe', 'C:\\Python313\\python.exe', 'C:\\Python312\\python.exe', 'C:\\Python311\\python.exe']
      .concat(['Python314', 'Python313', 'Python312', 'Python311'].map((v) => path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', v, 'python.exe')))
      .filter((c) => fs.existsSync(c))
    : [];
  return [...new Set([process.env.PYTHON, process.env.PYTHON_EXE, ...roots, 'python', 'python3', 'py'].filter(Boolean) as string[])];
}

function runPython(python: string, script: string, argFile: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, argFile], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`whisper timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.includes('@@JSON@@')) resolve(stdout.slice(stdout.indexOf('@@JSON@@') + 8));
      else reject(new Error(`exit ${code}: ${stderr.slice(-300)}`));
    });
  });
}

async function localWhisper(wavs: string[]): Promise<Array<RawTranscript | null>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-stt-'));
  const script = path.join(dir, 'stt.py');
  const argFile = path.join(dir, 'args.json');
  fs.writeFileSync(script, PY_PROGRAM, 'utf8');
  const model = process.env.PROMETHEUS_WHISPER_MODEL || 'base.en';
  fs.writeFileSync(argFile, JSON.stringify({ model, paths: wavs, language: model.endsWith('.en') ? undefined : undefined }), 'utf8');
  const errs: string[] = [];
  try {
    for (const py of pythonCandidates()) {
      try {
        const raw = JSON.parse(await runPython(py, script, argFile, 60_000 + wavs.length * 45_000));
        return raw.map((r: any) => (r && !r.error ? { text: String(r.text || ''), words: r.words || [], provider: `whisper-${model}` } : null));
      } catch (e: any) {
        errs.push(`${py}: ${String(e?.message || e).slice(0, 160)}`);
        if (/timed out/.test(String(e?.message))) break;
      }
    }
    throw new Error(`Local Whisper unavailable: ${errs.join(' | ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function openAiWhisper(wav: string): Promise<RawTranscript> {
  const gp = await import('../gateway/creative/generative-pipeline.js');
  const cands = await gp.openAiVoiceAuthCandidates();
  const env = String(process.env.OPENAI_API_KEY || '').trim();
  const tokens = [...(env ? [env] : []), ...cands.map((c) => c.token)].filter((t, i, a) => a.indexOf(t) === i);
  const errs: string[] = [];
  for (const token of tokens) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), path.basename(wav));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!r.ok) { errs.push(`${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`); continue; }
    const data: any = await r.json();
    const words: Word[] = (data.words || []).map((w: any) => ({ text: String(w.word || '').trim(), startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000) })).filter((w: Word) => w.text);
    return { text: String(data.text || '').trim(), words, provider: 'openai-whisper-1' };
  }
  throw new Error(`OpenAI transcription failed: ${errs.join(' | ') || 'not connected'}`);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, '');

/** Whisper's classic phantom outputs on music/ambience with no real speech. */
const PHANTOMS = new Set(['you', 'thankyou', 'thanksforwatching', 'thankyouforwatching', 'bye', 'okay', 'oh', 'mm', 'mmm', 'hmm', 'uh', 'um', 'music']);

/**
 * Drop hallucinated speech: a whole transcript that is one short phantom
 * phrase, or words Whisper itself was unsure of when they stand alone.
 */
export function dropPhantomSpeech(words: Array<Word & { p?: number }>): Word[] {
  const kept = words.filter((w) => w.p === undefined || w.p >= 0.2 || words.length > 3);
  const joined = norm(kept.map((w) => w.text).join(''));
  if (kept.length <= 3 && PHANTOMS.has(joined)) return [];
  if (kept.length === 1 && (kept[0].p ?? 1) < 0.6) return [];
  return kept.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }));
}

/**
 * When Whisper heard the scripted line (same word count, most words match),
 * adopt the script's spelling/punctuation (brand names like "VOLT") and keep
 * Whisper's timing. Anything else stays exactly as heard.
 */
export function snapToScript(words: Word[], line?: string): Word[] {
  if (!line) return words;
  const script = line.trim().split(/\s+/).filter(Boolean);
  if (script.length !== words.length || !words.length) return words;
  const hits = script.filter((w, i) => norm(w) === norm(words[i].text)).length;
  if (hits / script.length < 0.6) return words;
  return words.map((w, i) => ({ ...w, text: script[i] }));
}

async function toWav(videoAbs: string, outAbs: string): Promise<boolean> {
  const { code } = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', videoAbs, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outAbs], 60_000);
  return code === 0 && fs.existsSync(outAbs) && fs.statSync(outAbs).size > 2000;
}

/**
 * Transcribe every selected video take (missing ones unless force). Stores
 * take.transcript. Free with local Whisper.
 */
export async function transcribeTakes(ws: string, projectId: string, args: { shotIds?: string[]; force?: boolean } = {}): Promise<{
  transcribed: Array<{ shotId: string; title: string; text: string; words: number; provider: string }>;
  skipped: string[]; failed: string[];
}> {
  const p = loadProject(ws, projectId);
  const targets: Array<{ shot: Shot; takeId: string; abs: string }> = [];
  const skipped: string[] = [];
  for (const shot of p.shots) {
    if (args.shotIds?.length && !args.shotIds.includes(shot.id)) continue;
    const take = selectedTake(shot);
    if (!take || take.kind !== 'video') continue;
    if (take.transcript && !args.force) { skipped.push(shot.title); continue; }
    targets.push({ shot, takeId: take.id, abs: fromWorkspaceRel(ws, take.path) });
  }
  const failed: string[] = [];
  if (!targets.length) return { transcribed: [], skipped, failed };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-wav-'));
  const results = new Map<string, RawTranscript>();
  try {
    const wavs: Array<{ key: string; wav: string }> = [];
    const silent = new Set<string>();
    for (const t of targets) {
      const wav = path.join(tmp, `${t.takeId}.wav`);
      if (await toWav(t.abs, wav)) wavs.push({ key: t.takeId, wav });
      else silent.add(t.takeId); // no audio stream: nothing is said
    }
    for (const k of silent) results.set(k, { text: '', words: [], provider: 'no-audio' });
    if (wavs.length) {
      let out: Array<RawTranscript | null> = [];
      let localErr = '';
      try { out = await (override || localWhisper)(wavs.map((w) => w.wav)); }
      catch (e: any) { localErr = String(e?.message || e); out = wavs.map(() => null); }
      for (let i = 0; i < wavs.length; i++) {
        let r = out[i];
        if (!r && !override) {
          try { r = await openAiWhisper(wavs[i].wav); }
          catch (e: any) { failed.push(`${targets.find((t) => t.takeId === wavs[i].key)?.shot.title}: ${localErr ? `${localErr.slice(0, 120)}; ` : ''}${String(e?.message || e).slice(0, 160)}`); }
        }
        if (r) results.set(wavs[i].key, r);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const transcribed: Array<{ shotId: string; title: string; text: string; words: number; provider: string }> = [];
  await mutateProject(ws, projectId, 'transcribe', (proj) => {
    for (const t of targets) {
      const r = results.get(t.takeId);
      if (!r) continue;
      const shot = proj.shots.find((s) => s.id === t.shot.id);
      const take = shot?.takes.find((x) => x.id === t.takeId);
      if (!shot || !take) continue;
      const words = snapToScript(dropPhantomSpeech(r.words), shot.line);
      const transcript: TakeTranscript = { text: words.map((w) => w.text).join(' '), words, provider: r.provider, at: Date.now() };
      take.transcript = transcript;
      transcribed.push({ shotId: shot.id, title: shot.title, text: transcript.text, words: words.length, provider: r.provider });
    }
  });
  return { transcribed, skipped, failed };
}
