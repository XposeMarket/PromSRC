import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CreativeMotionInput } from '../../../gateway/creative/contracts';

function peaks(input: CreativeMotionInput): number[] {
  const values = input.audioAnalysis?.waveformPeaks || [];
  if (values.length) return values.map((value) => Math.max(0.04, Math.min(1, Math.abs(Number(value) || 0))));
  return Array.from({ length: 96 }, (_, index) => 0.2 + Math.abs(Math.sin(index * 0.42)) * 0.65);
}

export function AudioVisualizer(input: CreativeMotionInput) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const brand = input.brand;
  const background = brand?.colors.background || '#09090F';
  const text = brand?.colors.text || '#F8FAFC';
  const accent = brand?.colors.accent || '#A78BFA';
  const accent2 = brand?.colors.secondary || '#22D3EE';
  const title = input.text.title || 'Audio Visualizer';
  const subtitle = input.text.subtitle || input.captions?.segments?.[0]?.text || 'Waveform, captions, progress, and audio-reactive motion.';
  const durationFrames = Math.max(1, Math.round(((input.durationMs || 15000) / 1000) * fps));
  const progress = Math.min(1, frame / durationFrames);
  const intro = spring({ frame, fps, config: { damping: 18, stiffness: 110 } });
  const waveform = peaks(input);
  const visibleBars = Math.min(84, Math.max(36, Math.floor(width / 16)));
  const safeX = Math.round(width * 0.075);
  const waveTop = Math.round(height * 0.52);
  const waveHeight = Math.round(height * 0.18);

  return (
    <AbsoluteFill style={{ background, color: text, fontFamily: brand?.fonts.body || 'Manrope, Inter, Arial, sans-serif', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 50% 22%, ${accent}40, transparent 28%), radial-gradient(circle at 18% 78%, ${accent2}30, transparent 34%)`,
      }} />
      <div style={{
        position: 'absolute',
        left: safeX,
        right: safeX,
        top: Math.round(height * 0.12),
        opacity: intro,
        transform: `translateY(${interpolate(intro, [0, 1], [36, 0])}px)`,
      }}>
        <div style={{ fontFamily: brand?.fonts.heading || 'Sora, Inter, sans-serif', fontSize: Math.round(Math.min(width * 0.1, 108)), lineHeight: 0.98, fontWeight: 950, letterSpacing: 0 }}>
          {title}
        </div>
        <div style={{ marginTop: 24, color: 'rgba(248,250,252,0.74)', fontSize: Math.round(Math.min(width * 0.046, 46)), lineHeight: 1.14, fontWeight: 760, maxWidth: Math.round(width * 0.82) }}>
          {subtitle}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        left: safeX,
        right: safeX,
        top: waveTop,
        height: waveHeight,
        display: 'flex',
        alignItems: 'center',
        gap: Math.max(4, Math.round(width * 0.006)),
      }}>
        {Array.from({ length: visibleBars }, (_, index) => {
          const sourceIndex = Math.floor((index / Math.max(1, visibleBars - 1)) * (waveform.length - 1));
          const base = waveform[sourceIndex] || 0.2;
          const sweep = Math.sin((frame * 0.16) + index * 0.36) * 0.18;
          const active = index / visibleBars <= progress;
          const h = Math.max(10, Math.round(waveHeight * Math.min(1, Math.max(0.08, base + sweep))));
          return (
            <div key={index} style={{
              flex: 1,
              height: h,
              borderRadius: 999,
              background: active ? `linear-gradient(180deg, ${accent}, ${accent2})` : 'rgba(255,255,255,0.16)',
              boxShadow: active ? `0 0 22px ${accent}44` : 'none',
            }} />
          );
        })}
      </div>

      <div style={{
        position: 'absolute',
        left: safeX,
        right: safeX,
        bottom: Math.round(height * 0.16),
        padding: `${Math.round(height * 0.028)}px ${Math.round(width * 0.052)}px`,
        borderRadius: 30,
        background: 'rgba(255,255,255,0.09)',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 28px 100px rgba(0,0,0,0.38)',
      }}>
        <div style={{ color: accent2, fontSize: Math.round(Math.min(width * 0.034, 34)), fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 }}>
          Now playing
        </div>
        <div style={{ marginTop: 12, fontSize: Math.round(Math.min(width * 0.054, 54)), lineHeight: 1.08, fontWeight: 900 }}>
          {input.text.body || input.text.cta || 'Audio-reactive scene powered by Prometheus Creative.'}
        </div>
      </div>

      <div style={{ position: 'absolute', left: safeX, right: safeX, bottom: Math.round(height * 0.065), height: 12, borderRadius: 999, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: `linear-gradient(90deg, ${accent}, ${accent2})` }} />
      </div>
    </AbsoluteFill>
  );
}
