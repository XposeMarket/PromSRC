/**
 * Ad / video templates as data, plus a planner that turns a template into project ops.
 */

export type TemplateAspect = '9:16' | '1:1' | '16:9';
export type ShotRole = 'hook' | 'problem' | 'product' | 'demo' | 'reaction' | 'payoff' | 'cta' | 'broll' | 'establish';

export interface TemplateShot {
  title: string;
  role: ShotRole;
  durationSec: number;
  camera?: string;
  prompt: string;
  line?: string;
  usesProduct?: boolean;
  usesCharacter?: boolean;
  chainFromPrevious?: boolean;
}

export interface VideoTemplate {
  id: string;
  name: string;
  description: string;
  aspect: TemplateAspect;
  durationSec: number;
  defaultVideoModel?: string;
  needs: { product?: boolean; character?: boolean };
  /** native = the on-screen creator speaks the lines (UGC); voiceover = narrator track. */
  audioMode?: 'native' | 'voiceover';
  voice?: { provider: 'openai'; voice: string };
  captions: { enabled: boolean; style: 'bold' | 'pop' | 'minimal' | 'karaoke' };
  music: { builtin: 'pulse' | 'chill' | 'none'; volume: number };
  shots: TemplateShot[];
  hookVariants?: string[];
}

export interface TemplateSummary {
  id: string; name: string; description: string; aspect: TemplateAspect;
  durationSec: number; shotCount: number; needs: VideoTemplate['needs'];
}

export interface TemplateVars { brief?: string; product?: string; character?: string; brand?: string }
export interface TemplateIds { productCharId?: string; personCharId?: string }
export interface TemplatePlan {
  ops: Array<{ op: string; [key: string]: any }>;
  music: VideoTemplate['music'];
  hookVariants: string[];
}

const TEMPLATES: VideoTemplate[] = [
  {
    id: 'ugc-testimonial',
    name: 'UGC Testimonial',
    description: 'Authentic creator-style selfie testimonial: car hook, product reveal, reaction, lifestyle payoff, CTA.',
    aspect: '9:16', durationSec: 15,
    needs: { product: true, character: true },
    audioMode: 'native',
    voice: { provider: 'openai', voice: 'nova' },
    captions: { enabled: true, style: 'karaoke' },
    music: { builtin: 'pulse', volume: 0.18 },
    shots: [
      { title: 'Car selfie hook', role: 'hook', durationSec: 3, camera: 'handheld selfie, arm-length',
        prompt: '{character} sitting in the driver seat of a parked car, holding phone at arm length, talking excitedly to camera, 24mm front-camera look, soft window daylight on face, slight handheld wobble, natural skin texture, vertical smartphone footage',
        line: 'Okay, I need to talk about {product}.', usesCharacter: true },
      { title: 'Product crack open', role: 'product', durationSec: 3, camera: 'macro close-up, slow push-in',
        prompt: 'Extreme close-up of hands opening {product}, 100mm macro, shallow depth of field, crisp detail on packaging, warm daylight from side, slow push-in, satisfying tactile moment',
        line: 'Look at this. Seriously.', usesProduct: true, usesCharacter: true },
      { title: 'Try it reaction', role: 'reaction', durationSec: 3, camera: 'handheld medium close-up',
        prompt: '{character} trying {product} for the first time, eyes widen, genuine delighted reaction, nods at camera, 35mm handheld medium close-up, soft natural light, casual home setting',
        line: 'Wait. This is actually so good.', usesProduct: true, usesCharacter: true, chainFromPrevious: true },
      { title: 'Lifestyle payoff', role: 'payoff', durationSec: 3, camera: 'gimbal follow, medium wide',
        prompt: '{character} using {product} during a bright everyday moment outdoors, golden hour backlight, 35mm gimbal follow shot, relaxed smile, candid lifestyle feel, {brief}',
        line: "It's literally part of my routine now.", usesProduct: true, usesCharacter: true },
      { title: 'Hold-up CTA', role: 'cta', durationSec: 3, camera: 'static selfie, eye level',
        prompt: '{character} holding {product} up next to their face toward the camera, smiling, product label facing lens, 24mm selfie framing, even soft light, slight lean-in toward lens',
        line: 'Link is below. Go get {product}.', usesProduct: true, usesCharacter: true },
    ],
    hookVariants: [
      '{character} in a parked car, whispering to camera like sharing a secret, phone at arm length, soft window light, handheld vertical selfie',
      '{character} walking down a sunny sidewalk holding phone at arm length, saying "stop scrolling", 24mm front-camera, natural handheld motion',
      'Close-up of {character} face mid-laugh, pulling {product} into frame from below, 24mm selfie, bright daylight',
    ],
  },
  {
    id: 'product-demo',
    name: 'Product Demo',
    description: 'Clean studio demo: hero reveal, feature in use, detail, result, end card.',
    aspect: '9:16', durationSec: 18,
    needs: { product: true },
    voice: { provider: 'openai', voice: 'alloy' },
    captions: { enabled: true, style: 'bold' },
    music: { builtin: 'pulse', volume: 0.22 },
    shots: [
      { title: 'Hero reveal', role: 'hook', durationSec: 4, camera: 'slow orbit, 50mm',
        prompt: '{product} standing on a seamless studio sweep, rim light sculpting edges, soft haze, 50mm slow 90-degree orbit, glossy reflections, premium commercial look',
        line: 'Meet {product}.', usesProduct: true },
      { title: 'In use', role: 'demo', durationSec: 4, camera: 'overhead top-down, slight push',
        prompt: 'Hands using {product} on a clean tabletop, top-down overhead 35mm, bright diffused softbox light, smooth slow push-in, clear demonstration of how it works, {brief}',
        line: 'Here is how it works in seconds.', usesProduct: true },
      { title: 'Detail macro', role: 'product', durationSec: 3, camera: 'macro slider',
        prompt: 'Macro detail of {product} materials and texture, 100mm macro lens, lateral slider move, specular highlights, shallow depth of field',
        line: 'Built with details that matter.', usesProduct: true, chainFromPrevious: true },
      { title: 'Result', role: 'payoff', durationSec: 4, camera: 'medium, gentle dolly out',
        prompt: 'The finished result of using {product} in a bright modern home, 35mm gentle dolly out, natural window light, satisfied mood',
        line: 'Better results, zero hassle.', usesProduct: true },
      { title: 'End card', role: 'cta', durationSec: 3, camera: 'locked-off center frame',
        prompt: '{product} centered on a clean colored backdrop with negative space for text, locked-off camera, soft top light, subtle slow rotation, {brand} brand colors',
        line: 'Get {product} from {brand} today.', usesProduct: true },
    ],
    hookVariants: [
      '{product} dropping into frame in slow motion onto a studio surface, 120fps look, dramatic top light',
      'Split-second whip pan revealing {product} on a pedestal, 35mm, crisp studio light',
    ],
  },
  {
    id: 'cinematic-trailer',
    name: 'Cinematic Trailer',
    description: 'Moody 16:9 teaser with epic establishing shots, character beats and a title reveal. Sparse VO.',
    aspect: '16:9', durationSec: 25,
    needs: { character: true },
    voice: { provider: 'openai', voice: 'onyx' },
    captions: { enabled: false, style: 'minimal' },
    music: { builtin: 'chill', volume: 0.35 },
    shots: [
      { title: 'Establishing vista', role: 'establish', durationSec: 5, camera: 'aerial drone, slow push',
        prompt: 'Sweeping aerial of a vast landscape at blue hour, anamorphic 2.39 look, volumetric fog in valleys, slow forward drone push, cinematic teal and amber grade, {brief}' },
      { title: 'Character intro', role: 'hook', durationSec: 5, camera: 'slow dolly-in, 85mm',
        prompt: '{character} standing still, turning head toward camera, 85mm anamorphic close-up, hard side key light, drifting dust particles, slow dolly-in, shallow depth of field',
        line: 'Everything changes tonight.', usesCharacter: true },
      { title: 'Rising tension', role: 'broll', durationSec: 5, camera: 'handheld tracking',
        prompt: '{character} moving fast through a dim corridor, handheld tracking from behind, flickering practical lights, motion blur, 35mm anamorphic, high contrast',
        usesCharacter: true, chainFromPrevious: true },
      { title: 'Climax beat', role: 'payoff', durationSec: 5, camera: 'low angle, slow motion',
        prompt: 'Low-angle slow-motion shot of {character} facing a burst of light and wind, coat and hair blowing, 24mm anamorphic, lens flares, epic scale',
        usesCharacter: true },
      { title: 'Title card', role: 'cta', durationSec: 5, camera: 'locked-off, slow push',
        prompt: 'Dark atmospheric backdrop with drifting smoke and embers, space for title text, very slow push-in, single cool backlight, {brand}',
        line: 'Coming soon.' },
    ],
  },
  {
    id: 'explainer',
    name: 'Explainer',
    description: 'Voiceover-led 16:9 explainer: problem, solution, how it works, benefit, CTA.',
    aspect: '16:9', durationSec: 30,
    needs: { character: true },
    voice: { provider: 'openai', voice: 'alloy' },
    captions: { enabled: true, style: 'minimal' },
    music: { builtin: 'chill', volume: 0.15 },
    shots: [
      { title: 'The problem', role: 'problem', durationSec: 6, camera: 'static medium, 35mm',
        prompt: '{character} at a cluttered desk looking frustrated at a laptop, 35mm medium shot, cool overcast window light, subtle slow push-in, realistic office',
        line: 'Most teams waste hours on work that should take minutes.', usesCharacter: true },
      { title: 'The solution', role: 'product', durationSec: 6, camera: 'slow dolly across',
        prompt: 'Clean bright workspace, screen glowing with a simple interface for {product}, 50mm slow lateral dolly, warm soft key light, optimistic mood',
        line: '{product} fixes that. {brief}', usesProduct: true },
      { title: 'How it works', role: 'demo', durationSec: 6, camera: 'over-the-shoulder',
        prompt: 'Over-the-shoulder shot of {character} using {product} on a laptop, 50mm, shallow depth of field on the screen, soft daylight, smooth slight push',
        line: 'Set it up once, and it runs on its own.', usesProduct: true, usesCharacter: true, chainFromPrevious: true },
      { title: 'The benefit', role: 'payoff', durationSec: 6, camera: 'gimbal medium wide',
        prompt: '{character} leaving the office relaxed at golden hour, 35mm gimbal follow, warm backlight, calm confident smile',
        line: 'You get your time back for what actually matters.', usesCharacter: true },
      { title: 'Call to action', role: 'cta', durationSec: 6, camera: 'locked-off wide',
        prompt: 'Minimal branded backdrop in {brand} colors with soft gradient light and open negative space for logo and text, very slow push-in',
        line: 'Try {product} free today at {brand}.' },
    ],
  },
  {
    id: 'before-after',
    name: 'Before / After',
    description: 'Vertical transformation ad: dull before, product moment, striking after, reaction, CTA.',
    aspect: '9:16', durationSec: 15,
    needs: { product: true, character: true },
    audioMode: 'native',
    voice: { provider: 'openai', voice: 'shimmer' },
    captions: { enabled: true, style: 'pop' },
    music: { builtin: 'pulse', volume: 0.2 },
    shots: [
      { title: 'Before', role: 'problem', durationSec: 3, camera: 'static medium, flat light',
        prompt: '{character} looking unimpressed in a mirror, flat dull overhead light, desaturated tones, 35mm static medium shot, the before state, {brief}',
        line: 'This was me last month.', usesCharacter: true },
      { title: 'Product moment', role: 'product', durationSec: 3, camera: 'macro push-in',
        prompt: 'Close-up of hands applying or using {product}, 100mm macro, crisp side light, slow push-in, clean texture detail',
        line: 'Then I found {product}.', usesProduct: true, usesCharacter: true },
      { title: 'After', role: 'payoff', durationSec: 3, camera: 'same framing as before, slow push',
        prompt: '{character} in the same mirror framing, now glowing and confident, warm bright golden light, vibrant color, 35mm slow push-in, the after state',
        line: 'And now? Look at this.', usesCharacter: true, chainFromPrevious: true },
      { title: 'Reaction', role: 'reaction', durationSec: 3, camera: 'handheld selfie',
        prompt: '{character} grinning and turning toward the camera, handheld 24mm selfie, soft daylight, playful energy',
        line: "Honestly didn't think it would work.", usesCharacter: true },
      { title: 'CTA', role: 'cta', durationSec: 3, camera: 'static close-up',
        prompt: '{character} holding {product} to camera, label facing lens, 50mm close-up, clean soft light, {brand} colors in background',
        line: 'Try {product}. Link below.', usesProduct: true, usesCharacter: true },
    ],
    hookVariants: [
      'Split-screen feel: {character} dull on the left, radiant on the right, 35mm, contrasting light',
    ],
  },
  {
    id: 'local-business-promo',
    name: 'Local Business Promo',
    description: 'Vertical promo for small businesses (pizza shop, barbershop, cafe): storefront, craft, customer, owner, offer.',
    aspect: '9:16', durationSec: 20,
    needs: { character: true },
    voice: { provider: 'openai', voice: 'echo' },
    captions: { enabled: true, style: 'bold' },
    music: { builtin: 'pulse', volume: 0.2 },
    shots: [
      { title: 'Storefront', role: 'establish', durationSec: 4, camera: 'slow gimbal push toward door',
        prompt: 'Exterior of {brand} storefront at dusk, warm glowing windows and signage, street life passing, 24mm slow gimbal push toward the entrance, inviting neighborhood feel, {brief}',
        line: 'Right here in the neighborhood, {brand}.' },
      { title: 'The craft', role: 'demo', durationSec: 4, camera: 'macro, slow slider',
        prompt: 'Close-up of skilled hands at work crafting {product}, 85mm shallow depth of field, warm practical light, steam or fine detail visible, slow lateral slider',
        line: 'Every {product} made by hand, every time.', usesProduct: true },
      { title: 'Happy customer', role: 'reaction', durationSec: 4, camera: 'handheld medium',
        prompt: 'A happy customer enjoying {product}, genuine laugh, 35mm handheld medium shot, warm interior light, bustling friendly atmosphere',
        line: 'Our regulars keep coming back.', usesProduct: true },
      { title: 'Owner to camera', role: 'hook', durationSec: 4, camera: 'static medium close-up, 50mm',
        prompt: '{character}, the owner, standing behind the counter, smiling and speaking directly to camera, 50mm medium close-up, warm key light, shop softly blurred behind',
        line: "I'm proud of what we built here.", usesCharacter: true },
      { title: 'Offer CTA', role: 'cta', durationSec: 4, camera: 'slow pull back',
        prompt: '{character} handing {product} across the counter toward camera, 35mm slow pull back revealing the shop, warm welcoming light, space for offer text',
        line: 'Stop by {brand} this week. First visit is on us.', usesProduct: true, usesCharacter: true, chainFromPrevious: true },
    ],
    hookVariants: [
      'Fast push through the front door of {brand} into a lively interior, 24mm gimbal, warm light',
      'Overhead shot of {product} being finished and slid toward camera, 35mm, warm practical light',
    ],
  },
  {
    id: 'faceless-youtube',
    name: 'Faceless YouTube (long-form)',
    description: 'Narrated 16:9 long-form: mostly Ken Burns stills with a video beat every few segments, voiceover, captions, music. Use the faceless action to size it (8-40 segments).',
    aspect: '16:9', durationSec: 120,
    needs: {},
    audioMode: 'voiceover',
    voice: { provider: 'openai', voice: 'onyx' },
    captions: { enabled: true, style: 'bold' },
    music: { builtin: 'chill', volume: 0.12 },
    shots: [
      { title: 'Cold open', role: 'hook', durationSec: 20, prompt: 'Striking establishing image that sets up {brief}', line: 'Here is something most people never learn about {brief}.' },
      { title: 'Context', role: 'establish', durationSec: 25, prompt: 'Illustrative scene giving context for {brief}', line: 'To understand it, we have to start at the beginning.' },
      { title: 'Turn', role: 'broll', durationSec: 25, prompt: 'Dramatic turning-point image about {brief}', line: 'And then everything changed.' },
      { title: 'Payoff', role: 'payoff', durationSec: 20, prompt: 'Reflective closing image about {brief}', line: 'That is why it still matters today.' },
      { title: 'Outro', role: 'cta', durationSec: 15, prompt: 'Calm closing wide shot, space for an end card', line: 'Subscribe for the next one.' },
    ],
  },
];

export function listTemplates(): TemplateSummary[] {
  return TEMPLATES.map((t) => ({
    id: t.id, name: t.name, description: t.description, aspect: t.aspect,
    durationSec: t.durationSec, shotCount: t.shots.length, needs: { ...t.needs },
  }));
}

export function getTemplate(id: string): VideoTemplate | null {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? (JSON.parse(JSON.stringify(t)) as VideoTemplate) : null;
}

const FALLBACK: Record<string, string> = {
  product: 'the product',
  character: 'the person',
  brand: '',
  brief: '',
};

/** Fill {key} placeholders; missing values fall back to generic nouns or are dropped cleanly. */
export function fillPlaceholders(text: string, vars: TemplateVars): string {
  const out = text.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = (vars as Record<string, string | undefined>)[k];
    if (v && v.trim()) return v.trim();
    return FALLBACK[k] ?? '';
  });
  return out
    .replace(/[{}]/g, '')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/,(\s*,)+/g, ',')
    .replace(/\b(at|from|in)\s*([.!?]|$)/g, '$2')
    .replace(/,\s*([.!?]|$)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function planFromTemplate(template: VideoTemplate, vars: TemplateVars = {}, ids: TemplateIds = {}): TemplatePlan {
  const shots = template.shots.map((s) => {
    const characterIds: string[] = [];
    if (s.usesProduct && ids.productCharId) characterIds.push(ids.productCharId);
    if (s.usesCharacter && ids.personCharId) characterIds.push(ids.personCharId);
    return {
      title: s.title,
      prompt: fillPlaceholders(s.prompt, vars),
      line: s.line ? fillPlaceholders(s.line, vars) : '',
      durationSec: s.durationSec,
      camera: s.camera ?? '',
      characterIds,
      chainFromPrevious: !!s.chainFromPrevious,
      anchorMode: 'reference' as const,
    };
  });
  const ops: TemplatePlan['ops'] = [
    { op: 'project.update', target: { aspect: template.aspect, durationSec: template.durationSec } },
    { op: 'plan.setShots', shots },
    { op: 'captions.set', enabled: template.captions.enabled, style: template.captions.style },
  ];
  if (template.voice) ops.push({ op: 'voice.set', provider: template.voice.provider, voice: template.voice.voice });
  return {
    ops,
    music: { ...template.music },
    hookVariants: (template.hookVariants ?? []).map((h) => fillPlaceholders(h, vars)),
  };
}
