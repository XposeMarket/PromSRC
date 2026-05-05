import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CreativeMotionInput } from '../../../gateway/creative/contracts';

function assetSource(asset: any): string {
  return String(asset?.src || asset?.source || asset?.path || asset?.url || '').trim();
}

function benefits(input: CreativeMotionInput): string[] {
  const raw = input.text.body || input.text.subtitle || 'Reusable templates|Animated captions|Export-ready creative QA';
  return raw
    .split(/\n+|\||;|•/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function ProductPromo(input: CreativeMotionInput) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const brand = input.brand;
  const background = brand?.colors.background || '#07111F';
  const text = brand?.colors.text || '#F8FAFC';
  const accent = brand?.colors.accent || '#7CFFB2';
  const accent2 = brand?.colors.secondary || '#60A5FA';
  const title = input.text.title || 'Product Launch';
  const subtitle = input.text.subtitle || input.text.body || 'Show the product, call out the value, and land the CTA.';
  const cta = input.text.cta || 'Try it now';
  const media = assetSource(input.assets?.[0]);
  const intro = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const mediaIn = spring({ frame: Math.max(0, frame - 18), fps, config: { damping: 20, stiffness: 110 } });
  const progress = Math.min(1, Math.max(0, frame / Math.max(1, Math.round(((input.durationMs || 12000) / 1000) * fps))));
  const safeX = Math.round(width * 0.075);
  const isVertical = height >= width;

  return (
    <AbsoluteFill style={{ background, color: text, fontFamily: brand?.fonts.body || 'Inter, Manrope, Arial, sans-serif', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 15% 12%, ${accent}44, transparent 28%), radial-gradient(circle at 85% 72%, ${accent2}33, transparent 32%)`,
      }} />
      <div style={{
        position: 'absolute',
        left: safeX,
        top: Math.round(height * 0.09),
        width: isVertical ? width - safeX * 2 : Math.round(width * 0.46),
        opacity: intro,
        transform: `translateY(${interpolate(intro, [0, 1], [34, 0])}px)`,
      }}>
        <div style={{ color: accent, fontSize: Math.round(Math.min(width * 0.042, 42)), fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 }}>
          Feature drop
        </div>
        <div style={{ marginTop: 16, fontFamily: brand?.fonts.heading || 'Sora, Inter, sans-serif', fontSize: Math.round(Math.min(width * (isVertical ? 0.095 : 0.054), 104)), lineHeight: 0.98, fontWeight: 950, letterSpacing: 0 }}>
          {title}
        </div>
        <div style={{ marginTop: 22, color: 'rgba(248,250,252,0.78)', fontSize: Math.round(Math.min(width * 0.044, 44)), lineHeight: 1.18, fontWeight: 720 }}>
          {subtitle}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        left: isVertical ? safeX : Math.round(width * 0.54),
        right: safeX,
        top: isVertical ? Math.round(height * 0.38) : Math.round(height * 0.16),
        height: isVertical ? Math.round(height * 0.28) : Math.round(height * 0.58),
        borderRadius: 34,
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.16)',
        boxShadow: '0 34px 120px rgba(0,0,0,0.42)',
        overflow: 'hidden',
        opacity: mediaIn,
        transform: `translateY(${interpolate(mediaIn, [0, 1], [48, 0])}px) scale(${interpolate(mediaIn, [0, 1], [0.94, 1])})`,
      }}>
        {media ? (
          <Img src={media} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 36, borderRadius: 24, background: `linear-gradient(135deg, ${accent}33, ${accent2}22)`, display: 'grid', placeItems: 'center', fontSize: Math.round(Math.min(width * 0.052, 56)), fontWeight: 950 }}>
            Product visual
          </div>
        )}
      </div>

      <div style={{
        position: 'absolute',
        left: safeX,
        right: safeX,
        bottom: Math.round(height * 0.11),
        display: 'grid',
        gridTemplateColumns: isVertical ? '1fr' : 'repeat(2, 1fr)',
        gap: 16,
      }}>
        {benefits(input).map((benefit, index) => {
          const beat = spring({ frame: Math.max(0, frame - 30 - index * 8), fps, config: { damping: 18, stiffness: 140 } });
          return (
            <div key={benefit} style={{
              padding: '20px 24px',
              borderRadius: 22,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.14)',
              opacity: beat,
              transform: `translateX(${interpolate(beat, [0, 1], [-28, 0])}px)`,
              fontSize: Math.round(Math.min(width * 0.038, 38)),
              fontWeight: 850,
            }}>
              <span style={{ color: accent, marginRight: 12 }}>0{index + 1}</span>{benefit}
            </div>
          );
        })}
      </div>

      <div style={{ position: 'absolute', left: safeX, bottom: Math.round(height * 0.045), display: 'inline-flex', padding: '16px 24px', borderRadius: 999, background: accent, color: '#06101F', fontSize: Math.round(Math.min(width * 0.04, 40)), fontWeight: 950 }}>
        {cta}
      </div>
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: `${progress * 100}%`, height: 8, background: `linear-gradient(90deg, ${accent}, ${accent2})` }} />
    </AbsoluteFill>
  );
}
