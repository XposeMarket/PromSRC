/**
 * Motion / VFX / look presets (Higgsfield-style one-tap effects), as data.
 * A shot opts in with shot.presetId; composePrompt appends the suffix and
 * camera move, and negativePrompt/durationSec act as soft defaults.
 */
export type PresetGroup = 'camera' | 'vfx' | 'look';

export interface VideoPreset {
  id: string;
  group: PresetGroup;
  label: string;
  promptSuffix: string;
  camera?: string;
  negativePrompt?: string;
  recommendedModels?: string[];
  durationSec?: number;
}

const P = (group: PresetGroup, id: string, label: string, promptSuffix: string, extra: Partial<VideoPreset> = {}): VideoPreset =>
  ({ id, group, label, promptSuffix, ...extra });

export const PRESETS: VideoPreset[] = [
  // camera
  P('camera', 'dolly-in', 'Dolly in', 'Smooth dolly-in toward the subject, steady cinematic move.', { camera: 'dolly in' }),
  P('camera', 'dolly-out', 'Dolly out', 'Smooth dolly-out revealing the surroundings.', { camera: 'dolly out' }),
  P('camera', 'crane-up', 'Crane up', 'Camera cranes up and over the subject into a high wide view.', { camera: 'crane up' }),
  P('camera', 'orbit-360', 'Orbit 360', 'Camera orbits a full 360 degrees around the subject, subject stays centered.', { camera: '360 orbit' }),
  P('camera', 'whip-pan', 'Whip pan', 'Fast whip pan with motion blur into the subject.', { camera: 'whip pan' }),
  P('camera', 'handheld', 'Handheld', 'Handheld camera, natural micro-shake, documentary feel.', { camera: 'handheld' }),
  P('camera', 'fpv-dive', 'FPV drone dive', 'FPV drone dives from high above, rushing down toward the subject at speed.', { camera: 'FPV drone dive', durationSec: 5 }),
  P('camera', 'crash-zoom', 'Crash zoom', 'Sudden crash zoom onto the subject\'s face.', { camera: 'crash zoom' }),
  P('camera', 'bullet-time', 'Bullet time', 'Bullet-time: action frozen in slow motion while the camera arcs around it.', { camera: 'bullet time arc' }),
  P('camera', 'dutch-roll', 'Dutch roll', 'Camera rolls into a tilted dutch angle, uneasy energy.', { camera: 'dutch roll' }),
  P('camera', 'top-down', 'Top-down', 'Overhead top-down shot looking straight down.', { camera: 'top-down overhead' }),
  P('camera', 'slow-push-in', 'Slow push-in', 'Very slow, subtle push-in, intimate and calm.', { camera: 'slow push-in' }),
  // vfx
  P('vfx', 'melting', 'Melting', 'The subject slowly melts like hot wax, dripping realistically.', { negativePrompt: 'static, no motion' }),
  P('vfx', 'world-morph', 'World morphing', 'The environment morphs and reshapes around the subject into a new world.'),
  P('vfx', 'floating-fall', 'Floating fall', 'The subject falls weightlessly through the air in slow motion, hair and clothes floating.'),
  P('vfx', 'disintegrate', 'Disintegrate', 'The subject disintegrates into glowing particles that drift away on the wind.'),
  P('vfx', 'liquid-metal', 'Liquid metal', 'The subject turns into flowing liquid chrome metal, reflective and fluid.'),
  P('vfx', 'explosion-reveal', 'Explosion reveal', 'A cinematic explosion bursts behind and reveals the subject walking forward.'),
  P('vfx', 'levitation', 'Levitation', 'The subject gently levitates off the ground, objects around float upward.'),
  P('vfx', 'freeze-time', 'Freeze time', 'Time freezes: everything stops mid-motion except the subject, who moves through the frozen scene.'),
  P('vfx', 'portal', 'Portal', 'A glowing portal opens and the subject steps through into another place.'),
  P('vfx', 'glitch', 'Glitch', 'Digital glitch effect, RGB split and datamosh bursts over the subject.'),
  P('vfx', 'set-on-fire', 'Set on fire', 'Flames engulf the scene dramatically while the subject stays calm.', { negativePrompt: 'injury, gore' }),
  P('vfx', 'turn-to-stone', 'Turn to stone', 'The subject slowly turns to cracked grey stone, spreading from the feet up.'),
  P('vfx', 'paint-splash', 'Paint splash transform', 'A wave of colorful paint splashes over the subject and transforms their outfit and the scene.'),
  // look
  P('look', 'film-35mm', '35mm film', 'Shot on 35mm film, natural grain, warm halation, shallow depth of field.'),
  P('look', 'vhs-90s', 'VHS 90s', '1990s VHS camcorder look, scanlines, chroma bleed, date stamp vibe.'),
  P('look', 'anime-cel', 'Anime cel', 'Hand-drawn anime cel-shaded style, bold outlines, vibrant colors.'),
  P('look', 'claymation', 'Claymation', 'Stop-motion claymation style, plasticine textures, slight frame jitter.'),
  P('look', 'noir', 'Noir', 'Black-and-white film noir, hard shadows, venetian-blind light.'),
  P('look', 'neon-cyberpunk', 'Neon cyberpunk', 'Neon cyberpunk night, magenta and cyan lights, rain-slick reflections.'),
  P('look', 'golden-hour', 'Golden hour', 'Golden hour sunlight, long warm shadows, glowing rim light.'),
  P('look', 'studio-white', 'Product studio white', 'Clean seamless white studio backdrop, soft box lighting, premium product commercial.'),
];

export function listPresets(group?: string): VideoPreset[] {
  return group ? PRESETS.filter((p) => p.group === group) : PRESETS.slice();
}

export function getPreset(id: string | undefined): VideoPreset | undefined {
  if (!id) return undefined;
  return PRESETS.find((p) => p.id === id);
}
