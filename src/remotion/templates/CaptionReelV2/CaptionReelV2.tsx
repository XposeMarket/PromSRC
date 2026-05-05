import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CreativeCaptionSegment, CreativeCaptionWord, CreativeMotionInput } from '../../../gateway/creative/contracts';

type StyleProfile = {
  background: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  headingFont: string;
  bodyFont: string;
  uppercase: boolean;
};

function profileFor(input: CreativeMotionInput): StyleProfile {
  const brand = input.brand;
  const preset = String(input.presetId || input.style?.preset || input.style?.energy || '').toLowerCase();
  const base = {
    background: brand?.colors.background || '#080A12',
    panel: 'rgba(13, 18, 32, 0.78)',
    text: brand?.colors.text || '#F8FAFC',
    muted: '#A7B0C4',
    accent: brand?.colors.accent || '#FFCB1F',
    accent2: brand?.colors.secondary || '#38BDF8',
    headingFont: brand?.fonts.heading || 'Bebas Neue, Impact, Arial Black, sans-serif',
    bodyFont: brand?.fonts.body || 'Manrope, Inter, Arial, sans-serif',
    uppercase: false,
  };
  if (preset.includes('editorial')) {
    return { ...base, background: brand?.colors.background || '#11100E', panel: 'rgba(255,255,255,0.08)', accent: brand?.colors.accent || '#F5E6C8', accent2: '#E879F9', headingFont: brand?.fonts.heading || 'Georgia, serif' };
  }
  if (preset.includes('professional') || preset.includes('linkedin')) {
    return { ...base, background: brand?.colors.background || '#0F172A', panel: 'rgba(15, 23, 42, 0.82)', accent: brand?.colors.accent || '#67E8F9', accent2: '#A7F3D0', headingFont: brand?.fonts.heading || 'Sora, Inter, sans-serif' };
  }
  if (preset.includes('startup') || preset.includes('tech')) {
    return { ...base, background: brand?.colors.background || '#08111F', panel: 'rgba(8, 17, 31, 0.74)', accent: brand?.colors.accent || '#7CFFB2', accent2: '#60A5FA', headingFont: brand?.fonts.heading || 'Space Grotesk, Sora, Inter, sans-serif' };
  }
  return { ...base, uppercase: true };
}

function segments(input: CreativeMotionInput): CreativeCaptionSegment[] {
  return input.captions?.segments?.length ? input.captions.segments : [{
    id: 'fallback',
    startMs: 0,
    endMs: input.durationMs || 12000,
    text: input.text.subtitle || input.text.body || 'Add caption text to bring this reel to life.',
    words: [],
  }];
}

function activeSegment(input: CreativeMotionInput, atMs: number): CreativeCaptionSegment {
  const all = segments(input);
  return all.find((segment) => atMs >= segment.startMs && atMs <= segment.endMs) || all[0];
}

function splitLines(text: string, maxChars: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function activeWord(segment: CreativeCaptionSegment, atMs: number): string {
  const words = segment.words || [];
  const found = words.find((word: CreativeCaptionWord) => atMs >= word.startMs && atMs <= word.endMs);
  if (found?.text) return found.text.replace(/[^\w'-]/g, '').toLowerCase();
  const fallbackWords = segment.text.split(/\s+/).filter(Boolean);
  if (!fallbackWords.length) return '';
  const span = Math.max(1, segment.endMs - segment.startMs);
  const index = Math.min(fallbackWords.length - 1, Math.max(0, Math.floor(((atMs - segment.startMs) / span) * fallbackWords.length)));
  return fallbackWords[index].replace(/[^\w'-]/g, '').toLowerCase();
}

function wordIsActive(word: string, active: string): boolean {
  return word.replace(/[^\w'-]/g, '').toLowerCase() === active;
}

export function CaptionReelV2(input: CreativeMotionInput) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const atMs = Math.round((frame / fps) * 1000);
  const profile = profileFor(input);
  const segment = activeSegment(input, atMs);
  const segmentProgress = Math.min(1, Math.max(0, (atMs - segment.startMs) / Math.max(1, segment.endMs - segment.startMs)));
  const overallProgress = Math.min(1, Math.max(0, atMs / Math.max(1, input.durationMs || 12000)));
  const intro = spring({ frame, fps, config: { damping: 15, stiffness: 120, mass: 0.8 } });
  const punch = interpolate(frame % 24, [0, 5, 24], [1, 1.035, 1], { extrapolateRight: 'clamp' });
  const segmentFrame = Math.max(0, Math.round(((atMs - segment.startMs) / 1000) * fps));
  const segmentIn = spring({ frame: segmentFrame, fps, config: { damping: 18, stiffness: 170, mass: 0.7 } });
  const active = activeWord(segment, atMs);
  const maxChars = width < height ? 15 : 22;
  const lines = splitLines(segment.text, maxChars);
  const title = input.text.title || 'Caption Reel';
  const cta = input.text.cta || '';
  const isVertical = height >= width;
  const safeX = Math.round(width * (isVertical ? 0.075 : 0.09));
  const top = Math.round(height * (isVertical ? 0.1 : 0.08));
  const captionTop = Math.round(height * (isVertical ? 0.42 : 0.36));
  const captionSize = Math.round(Math.min(width * (isVertical ? 0.125 : 0.082), height * 0.09));
  const titleSize = Math.round(Math.min(width * (isVertical ? 0.105 : 0.052), 112));
  const cardY = Math.round(height * (isVertical ? 0.69 : 0.68));

  return (
    <AbsoluteFill style={{ background: profile.background, color: profile.text, overflow: 'hidden', fontFamily: profile.bodyFont }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: [
          `radial-gradient(circle at 18% 14%, ${profile.accent}55, transparent 27%)`,
          `radial-gradient(circle at 82% 76%, ${profile.accent2}33, transparent 30%)`,
          'linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 46%)',
        ].join(', '),
      }} />
      <div style={{
        position: 'absolute',
        left: safeX,
        right: safeX,
        top,
        transform: `translateY(${interpolate(intro, [0, 1], [36, 0])}px)`,
        opacity: intro,
      }}>
        <div style={{
          fontFamily: profile.headingFont,
          fontSize: titleSize,
          lineHeight: 0.96,
          fontWeight: 900,
          letterSpacing: 0,
          color: profile.text,
          textTransform: profile.uppercase ? 'uppercase' : 'none',
          textShadow: '0 16px 54px rgba(0,0,0,0.36)',
          maxWidth: isVertical ? width - safeX * 2 : Math.round(width * 0.66),
        }}>
          {title}
        </div>
        <div style={{ width: Math.round(width * 0.36), height: 10, borderRadius: 999, background: profile.accent, marginTop: 24, boxShadow: `0 0 42px ${profile.accent}66` }} />
      </div>

      <div style={{
        position: 'absolute',
        left: safeX,
        right: safeX,
        top: captionTop,
        transform: `translateY(${interpolate(segmentIn, [0, 1], [42, 0])}px) scale(${punch})`,
        opacity: segmentIn,
      }}>
        {lines.map((line, lineIndex) => (
          <div key={`${segment.id}-${lineIndex}`} style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: Math.max(8, Math.round(captionSize * 0.12)),
            marginBottom: Math.round(captionSize * 0.08),
          }}>
            {line.split(/\s+/).filter(Boolean).map((word, wordIndex) => {
              const hot = wordIsActive(word, active);
              return (
                <span key={`${word}-${wordIndex}`} style={{
                  display: 'inline-block',
                  padding: hot ? '0 0.12em' : 0,
                  borderRadius: 12,
                  background: hot ? profile.accent : 'transparent',
                  color: hot ? '#07111F' : profile.text,
                  fontSize: captionSize,
                  lineHeight: 0.98,
                  fontWeight: 950,
                  letterSpacing: 0,
                  textShadow: hot ? 'none' : '0 16px 60px rgba(0,0,0,0.42)',
                  transform: hot ? 'translateY(-0.03em) scale(1.04)' : 'none',
                }}>
                  {word}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{
        position: 'absolute',
        left: safeX,
        right: safeX,
        top: cardY,
        minHeight: Math.round(height * 0.13),
        padding: `${Math.round(height * 0.026)}px ${Math.round(width * 0.055)}px`,
        borderRadius: 28,
        background: profile.panel,
        border: '1px solid rgba(255,255,255,0.13)',
        boxShadow: '0 28px 90px rgba(0,0,0,0.35)',
        opacity: interpolate(frame, [12, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        transform: `translateY(${interpolate(frame, [12, 34], [36, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
      }}>
        <div style={{ color: profile.muted, fontSize: Math.round(Math.min(width * 0.032, 36)), fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 }}>
          Motion template system
        </div>
        <div style={{ marginTop: 12, color: profile.text, fontSize: Math.round(Math.min(width * 0.048, 50)), lineHeight: 1.12, fontWeight: 850 }}>
          {input.text.body || input.text.subtitle || 'Reusable motion, captions, presets, and export QA in one Creative workflow.'}
        </div>
        {cta ? (
          <div style={{ marginTop: 22, display: 'inline-flex', padding: '14px 22px', borderRadius: 999, background: profile.accent2, color: '#06101F', fontSize: Math.round(Math.min(width * 0.036, 38)), fontWeight: 900 }}>
            {cta}
          </div>
        ) : null}
      </div>

      <div style={{ position: 'absolute', left: safeX, right: safeX, bottom: Math.round(height * 0.055), height: 12, borderRadius: 999, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
        <div style={{ width: `${overallProgress * 100}%`, height: '100%', background: `linear-gradient(90deg, ${profile.accent}, ${profile.accent2})` }} />
      </div>
      <div style={{
        position: 'absolute',
        right: safeX,
        bottom: Math.round(height * 0.075),
        width: Math.max(80, Math.round(width * 0.16)),
        height: Math.max(80, Math.round(width * 0.16)),
        borderRadius: 999,
        border: `10px solid ${profile.accent}44`,
        borderTopColor: profile.accent,
        transform: `rotate(${Math.round(segmentProgress * 360)}deg)`,
        opacity: 0.72,
      }} />
    </AbsoluteFill>
  );
}
