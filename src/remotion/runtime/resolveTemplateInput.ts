import {
  normalizeCreativeBrandKit,
  normalizeCreativeCaptionTrack,
  normalizeCreativeMotionInput,
  type CreativeCaptionTrack,
  type CreativeMotionInput,
} from '../../gateway/creative/contracts';
import { getCreativeMotionTemplate } from './templateRegistry';
import { resolveCreativeSocialPreset } from './socialPresets';

function firstTextValue(...values: any[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function splitCaptionText(text: string) {
  const sentenceParts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentenceParts.length > 1) return sentenceParts;
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 7) {
    chunks.push(words.slice(index, index + 7).join(' '));
  }
  return chunks.length ? chunks : [text];
}

function createCaptionTrackFromPlainText(raw: any, durationMs: number): CreativeCaptionTrack | null {
  const text = firstTextValue(
    raw.caption,
    raw.captionText,
    raw.transcript,
    raw.text?.caption,
    raw.text?.body,
    raw.body,
    raw.subtitle,
    raw.text?.subtitle,
  );
  if (!text) return null;
  const chunks = splitCaptionText(text);
  const segmentDuration = Math.max(900, Math.round(durationMs / Math.max(1, chunks.length)));
  return normalizeCreativeCaptionTrack({
    id: 'auto_captions',
    source: 'plain-text',
    segments: chunks.map((chunk, index) => {
      const startMs = Math.min(durationMs - 1, index * segmentDuration);
      const endMs = index >= chunks.length - 1 ? durationMs : Math.min(durationMs, startMs + segmentDuration);
      return {
        id: `caption_${index + 1}`,
        startMs,
        endMs,
        text: chunk,
      };
    }),
  });
}

export function resolveCreativeMotionInput(raw: any = {}): CreativeMotionInput {
  const template = getCreativeMotionTemplate(raw.templateId) || getCreativeMotionTemplate('caption-reel-v2') || getCreativeMotionTemplate('caption-reel');
  const preset = resolveCreativeSocialPreset(raw.socialFormat);
  const durationMs = Number(raw.durationMs) || template?.defaultDurationMs || preset.durationMs;
  const requestedPresetId = String(raw.presetId || '').trim();
  const templatePreset = template?.presets?.find((candidate) => candidate.id === requestedPresetId) || template?.presets?.[0] || null;
  const normalizedCaptions = normalizeCreativeCaptionTrack(raw.captions);
  const captions = normalizedCaptions?.segments?.length
    ? normalizedCaptions
    : (template?.id === 'caption-reel' || template?.id === 'caption-reel-v2' ? createCaptionTrackFromPlainText(raw, durationMs) : null);
  const merged = {
    ...raw,
    templateId: template?.id || raw.templateId || 'caption-reel-v2',
    presetId: templatePreset?.id || null,
    socialFormat: preset.id,
    width: Number(raw.width) || preset.width,
    height: Number(raw.height) || preset.height,
    fps: Number(raw.fps || raw.frameRate) || preset.fps,
    durationMs,
    brand: normalizeCreativeBrandKit(raw.brand),
    captions,
    style: {
      ...(templatePreset?.style || {}),
      ...(raw.style && typeof raw.style === 'object' ? raw.style : {}),
    },
  };
  return normalizeCreativeMotionInput(merged);
}

export function validateCreativeMotionInput(input: CreativeMotionInput): { ok: boolean; warnings: string[]; blockers: string[] } {
  const template = getCreativeMotionTemplate(input.templateId);
  const warnings: string[] = [];
  const blockers: string[] = [];
  if (!template) blockers.push(`Unknown motion template "${input.templateId}".`);
  if ((input.templateId === 'caption-reel' || input.templateId === 'caption-reel-v2') && !input.captions?.segments?.length) {
    blockers.push('Caption Reel requires captions.segments or transcript-derived caption segments.');
  }
  if (input.templateId === 'audio-visualizer' && !input.audioAnalysis?.waveformPeaks?.length) {
    blockers.push('Audio Visualizer requires audioAnalysis.waveformPeaks.');
  }
  if (input.templateId === 'product-promo' && !input.text.title && !input.assets.length) {
    warnings.push('Product Promo works best with a title and at least one screenshot or visual asset.');
  }
  return { ok: blockers.length === 0, warnings, blockers };
}
