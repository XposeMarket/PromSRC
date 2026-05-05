import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CreativeMotionInput } from '../../../gateway/creative/contracts';

function activeSegment(input: CreativeMotionInput, atMs: number) {
  const segments = input.captions?.segments || [];
  return segments.find((segment) => atMs >= segment.startMs && atMs <= segment.endMs) || segments[0] || null;
}

export function CaptionReel(input: CreativeMotionInput) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const atMs = Math.round((frame / fps) * 1000);
  const segment = activeSegment(input, atMs);
  const brand = input.brand;
  const progress = Math.min(1, Math.max(0, atMs / Math.max(1, input.durationMs || 12000)));
  const scale = interpolate(frame % 30, [0, 10, 30], [0.96, 1, 1], { extrapolateRight: 'clamp' });
  const background = brand?.colors.background || '#101828';
  const accent = brand?.colors.accent || '#ffcf33';
  const text = brand?.colors.text || '#ffffff';

  return (
    <AbsoluteFill style={{
      background,
      color: text,
      fontFamily: brand?.fonts.heading || 'Inter, Arial, sans-serif',
      padding: 86,
      justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 20% 20%, ${accent}33, transparent 34%), linear-gradient(145deg, transparent, rgba(255,255,255,0.08))`,
      }} />
      <div style={{ position: 'relative', zIndex: 1, transform: `scale(${scale})` }}>
        {input.text?.title ? (
          <div style={{
            fontSize: 52,
            fontWeight: 800,
            marginBottom: 34,
            color: accent,
            lineHeight: 1.02,
          }}>
            {input.text.title}
          </div>
        ) : null}
        <div style={{
          fontSize: 86,
          lineHeight: 1.02,
          fontWeight: 900,
          letterSpacing: 0,
          textShadow: '0 18px 60px rgba(0,0,0,0.34)',
        }}>
          {segment?.text || 'Add caption text to bring this reel to life.'}
        </div>
        {input.text?.cta ? (
          <div style={{
            marginTop: 46,
            display: 'inline-flex',
            padding: '18px 28px',
            background: accent,
            color: '#111827',
            fontSize: 34,
            fontWeight: 800,
            borderRadius: 999,
          }}>
            {input.text.cta}
          </div>
        ) : null}
      </div>
      <div style={{
        position: 'absolute',
        left: 86,
        right: 86,
        bottom: 92,
        height: 12,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.18)',
        overflow: 'hidden',
      }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: accent }} />
      </div>
    </AbsoluteFill>
  );
}
