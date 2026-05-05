import type { CreativeSocialFormat } from '../../gateway/creative/contracts';

export type CreativeSocialPreset = {
  id: CreativeSocialFormat;
  label: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
};

export const CREATIVE_SOCIAL_PRESETS: Record<CreativeSocialFormat, CreativeSocialPreset> = {
  reel: {
    id: 'reel',
    label: 'Reel / TikTok',
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 15000,
    safeArea: { top: 160, right: 80, bottom: 260, left: 80 },
  },
  short: {
    id: 'short',
    label: 'YouTube Short',
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 30000,
    safeArea: { top: 160, right: 80, bottom: 280, left: 80 },
  },
  story: {
    id: 'story',
    label: 'Story',
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 15000,
    safeArea: { top: 120, right: 72, bottom: 220, left: 72 },
  },
  square: {
    id: 'square',
    label: 'Square',
    width: 1080,
    height: 1080,
    fps: 30,
    durationMs: 12000,
    safeArea: { top: 96, right: 80, bottom: 120, left: 80 },
  },
  feed45: {
    id: 'feed45',
    label: 'Feed 4:5',
    width: 1080,
    height: 1350,
    fps: 30,
    durationMs: 12000,
    safeArea: { top: 100, right: 80, bottom: 140, left: 80 },
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube 16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 30000,
    safeArea: { top: 80, right: 120, bottom: 120, left: 120 },
  },
};

export function resolveCreativeSocialPreset(raw: any): CreativeSocialPreset {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'feed' || normalized === '4:5') return CREATIVE_SOCIAL_PRESETS.feed45;
  if (normalized === '16:9') return CREATIVE_SOCIAL_PRESETS.youtube;
  if (normalized === '1:1') return CREATIVE_SOCIAL_PRESETS.square;
  return CREATIVE_SOCIAL_PRESETS[normalized as CreativeSocialFormat] || CREATIVE_SOCIAL_PRESETS.reel;
}
