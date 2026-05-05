import React from 'react';
import { Composition } from 'remotion';
import type { CreativeMotionInput } from '../gateway/creative/contracts';
import { CaptionReel } from './templates/CaptionReel/CaptionReel';
import { CaptionReelV2 } from './templates/CaptionReelV2/CaptionReelV2';
import { ProductPromo } from './templates/ProductPromo/ProductPromo';
import { AudioVisualizer } from './templates/AudioVisualizer/AudioVisualizer';

const defaultCaptionReelProps: CreativeMotionInput = {
  templateId: 'caption-reel',
  presetId: 'clean-creator',
  socialFormat: 'reel',
  width: 1080,
  height: 1920,
  fps: 30,
  durationMs: 15000,
  brand: null,
  assets: [],
  captions: null,
  audioAnalysis: null,
  text: {
    title: 'Caption Reel',
    subtitle: '',
    body: '',
    cta: '',
  },
  style: {},
};

const defaultProductPromoProps: CreativeMotionInput = {
  ...defaultCaptionReelProps,
  templateId: 'product-promo',
  presetId: 'saas-launch',
  captions: null,
  text: {
    title: 'Launch the thing',
    subtitle: 'A polished product promo with motion, callouts, and CTA.',
    body: 'Reusable templates|Animated captions|Export-ready QA',
    cta: 'Try it now',
  },
};

const defaultAudioVisualizerProps: CreativeMotionInput = {
  ...defaultCaptionReelProps,
  templateId: 'audio-visualizer',
  presetId: 'podcast-audiogram',
  durationMs: 30000,
  audioAnalysis: {
    status: 'ready',
    sourceType: 'empty',
    source: '',
    resolvedPath: null,
    resolvedPathRelative: null,
    analyzedAt: null,
    durationMs: 30000,
    sampleRate: null,
    channels: null,
    bitRate: null,
    codec: null,
    mimeType: null,
    size: null,
    waveformBucketCount: 96,
    waveformPeaks: Array.from({ length: 96 }, (_, index) => Math.abs(Math.sin(index * 0.42))),
    cachePath: null,
    cachePathRelative: null,
    error: null,
  },
  text: {
    title: 'Audio Visualizer',
    subtitle: 'Waveform, captions, progress, and audio-reactive accents.',
    body: 'Now playing in Prometheus Creative.',
    cta: '',
  },
};

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="CaptionReel"
        component={CaptionReel}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultCaptionReelProps}
        calculateMetadata={({ props }) => {
          const fps = Math.max(1, Number(props.fps) || 30);
          const durationMs = Math.max(1000, Number(props.durationMs) || 15000);
          return {
            width: Math.max(1, Number(props.width) || 1080),
            height: Math.max(1, Number(props.height) || 1920),
            fps,
            durationInFrames: Math.max(1, Math.ceil((durationMs / 1000) * fps)),
          };
        }}
      />
      <Composition
        id="CaptionReelV2"
        component={CaptionReelV2}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ ...defaultCaptionReelProps, templateId: 'caption-reel-v2', presetId: 'bold-tiktok-v2' }}
        calculateMetadata={({ props }) => {
          const fps = Math.max(1, Number(props.fps) || 30);
          const durationMs = Math.max(1000, Number(props.durationMs) || 15000);
          return {
            width: Math.max(1, Number(props.width) || 1080),
            height: Math.max(1, Number(props.height) || 1920),
            fps,
            durationInFrames: Math.max(1, Math.ceil((durationMs / 1000) * fps)),
          };
        }}
      />
      <Composition
        id="ProductPromo"
        component={ProductPromo}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProductPromoProps}
        calculateMetadata={({ props }) => {
          const fps = Math.max(1, Number(props.fps) || 30);
          const durationMs = Math.max(1000, Number(props.durationMs) || 15000);
          return {
            width: Math.max(1, Number(props.width) || 1080),
            height: Math.max(1, Number(props.height) || 1920),
            fps,
            durationInFrames: Math.max(1, Math.ceil((durationMs / 1000) * fps)),
          };
        }}
      />
      <Composition
        id="AudioVisualizer"
        component={AudioVisualizer}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultAudioVisualizerProps}
        calculateMetadata={({ props }) => {
          const fps = Math.max(1, Number(props.fps) || 30);
          const durationMs = Math.max(1000, Number(props.durationMs) || 30000);
          return {
            width: Math.max(1, Number(props.width) || 1080),
            height: Math.max(1, Number(props.height) || 1920),
            fps,
            durationInFrames: Math.max(1, Math.ceil((durationMs / 1000) * fps)),
          };
        }}
      />
    </>
  );
}
