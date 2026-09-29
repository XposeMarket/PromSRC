/**
 * Captions for generative video projects: cue building from voiceover lines
 * (word-level timing distributed by syllable weight, no STT round trip) and
 * ASS subtitle generation for libass burn-in with four TikTok-style presets.
 */
import type { CaptionCue, CaptionStyle, VideoProject } from './project.js';

const MAX_WORDS_PER_CUE = 3;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Split a line into timed words across [startMs, startMs+durMs], weighted by syllables + punctuation pauses. */
export function timeWords(text: string, startMs: number, durMs: number): Array<{ text: string; startMs: number; endMs: number }> {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || durMs <= 0) return [];
  const weights = words.map((w) => syllables(w) + (/[,.!?;:]$/.test(w) ? 0.8 : 0) + 0.35);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Array<{ text: string; startMs: number; endMs: number }> = [];
  let t = startMs;
  words.forEach((w, i) => {
    const d = (weights[i] / total) * durMs;
    out.push({ text: w, startMs: Math.round(t), endMs: Math.round(t + d) });
    t += d;
  });
  return out;
}

/**
 * Build caption cues from the VO clips on the timeline (so captions follow
 * the edit), chunked into 1-3 word pop cues with per-word timing.
 */
export function buildCaptionCues(p: VideoProject): CaptionCue[] {
  const vo = p.tracks.find((t) => t.kind === 'audio' && t.label === 'VO');
  const cues: CaptionCue[] = [];
  const voClips = vo ? p.clips.filter((c) => c.trackId === vo.id).sort((a, b) => a.startMs - b.startMs) : [];
  const shotByPath = new Map(p.shots.filter((s) => s.voiceover?.path).map((s) => [s.voiceover!.path, s]));
  for (const clip of voClips) {
    if (!('assetPath' in clip.source)) continue;
    const shot = shotByPath.get(clip.source.assetPath);
    const text = shot?.voiceover?.text || shot?.line;
    if (!text) continue;
    // Leave a short tail so words don't hang past the audio.
    const dur = Math.max(300, (clip.outMs - clip.inMs) - 120);
    const words = timeWords(text, clip.startMs + 60, dur);
    for (let i = 0; i < words.length; i += MAX_WORDS_PER_CUE) {
      // Break early on punctuation so cues read naturally.
      let chunk = words.slice(i, i + MAX_WORDS_PER_CUE);
      const cut = chunk.findIndex((w) => /[,.!?;:]$/.test(w.text));
      if (cut >= 0 && cut < chunk.length - 1) { chunk = chunk.slice(0, cut + 1); i -= MAX_WORDS_PER_CUE - chunk.length; }
      cues.push({ startMs: chunk[0].startMs, endMs: chunk[chunk.length - 1].endMs, text: chunk.map((w) => w.text).join(' '), words: chunk });
    }
  }
  return cues;
}

function assTime(ms: number): string {
  const t = Math.max(0, Math.round(ms / 10));
  const cs = t % 100;
  const s = Math.floor(t / 100) % 60;
  const m = Math.floor(t / 6000) % 60;
  const h = Math.floor(t / 360000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function assEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, ' ');
}

const ACCENT = '&H0000E5FF&'; // warm yellow (BGR)

/** ASS document for libass. Styles scale with the canvas. */
export function buildAss(cues: CaptionCue[], style: CaptionStyle, width: number, height: number): string {
  const short = Math.min(width, height);
  const size = Math.round(short * (style === 'minimal' ? 0.055 : 0.085));
  const outline = Math.max(2, Math.round(size * (style === 'minimal' ? 0.06 : 0.1)));
  const marginV = Math.round(height * (height > width ? 0.24 : 0.12));
  const font = style === 'minimal' ? 'Segoe UI Semibold' : 'Arial Black';
  const borderStyle = style === 'minimal' ? 3 : 1;
  const back = style === 'minimal' ? '&H80000000' : '&H64000000';
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${font},${size},&H00FFFFFF,${ACCENT},&H00000000,${back},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${style === 'minimal' ? 0 : 2},2,${Math.round(width * 0.06)},${Math.round(width * 0.06)},${marginV},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines: string[] = [];
  for (const cue of cues) {
    const words = cue.words?.length ? cue.words : [{ text: cue.text, startMs: cue.startMs, endMs: cue.endMs }];
    const upper = style === 'bold' || style === 'pop';
    const fmt = (w: string) => assEscape(upper ? w.toUpperCase() : w);
    if (style === 'karaoke') {
      // Whole cue visible; each word fills with the accent as it is spoken.
      const body = words.map((w) => `{\\kf${Math.max(1, Math.round((w.endMs - w.startMs) / 10))}}${fmt(w.text)}`).join(' ');
      lines.push(`Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Cap,,0,0,0,,{\\1c&H00FFFFFF&\\2c${ACCENT}}${body}`);
    } else if (style === 'pop') {
      // One event per active word: that word in accent + scale bounce, the rest white.
      words.forEach((active, i) => {
        const body = words.map((w, j) => (j === i ? `{\\c${ACCENT}}${fmt(w.text)}{\\c&H00FFFFFF&}` : fmt(w.text))).join(' ');
        const bounce = i === 0 ? '{\\fscx78\\fscy78\\t(0,110,\\fscx100\\fscy100)}' : '';
        const end = i === words.length - 1 ? cue.endMs : words[i + 1].startMs;
        lines.push(`Dialogue: 0,${assTime(active.startMs)},${assTime(end)},Cap,,0,0,0,,${bounce}${body}`);
      });
    } else {
      const fade = style === 'minimal' ? '{\\fad(80,80)}' : '{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}';
      lines.push(`Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Cap,,0,0,0,,${fade}${words.map((w) => fmt(w.text)).join(' ')}`);
    }
  }
  return [...header, ...lines, ''].join('\n');
}
