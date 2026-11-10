/** Bounded review metadata. This is a preview, never an independent permission grant. */
export interface ContentReview {
  kind: 'post' | 'generation' | 'proposal';
  text: string;
  platform?: string;
  account?: string;
  visibility?: string;
  timing?: string;
  model?: string;
  cost?: string;
  media: Array<{ kind: 'image' | 'video'; path: string; label?: string; cover?: string }>;
}
function text(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new Error(`Review text must be a string of at most ${max} characters.`);
  return value;
}
/** Only existing authenticated workspace file delivery; never fetch remote/private URLs. */
export function reviewMediaPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f?#%]/.test(value)) throw new Error('Invalid review media path.');
  const path = value.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Review media must be workspace-relative.');
  if (!/\.(png|jpg|jpeg|webp|gif|avif|mp4|webm|mov)$/i.test(path)) throw new Error('Unsupported review media type.');
  return path;
}
export function normalizeContentReview(value: unknown): ContentReview | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('content_review must be an object.');
  const v = value as Record<string, any>;
  if (!['post', 'generation', 'proposal'].includes(v.kind)) throw new Error('Invalid content review kind.');
  if (v.media != null && (!Array.isArray(v.media) || v.media.length > 12)) throw new Error('Review supports at most 12 media items.');
  return {
    kind: v.kind, text: text(v.text, 32000) || '',
    platform: text(v.platform, 160), account: text(v.account, 240),
    visibility: text(v.visibility, 160), timing: text(v.timing, 240),
    model: text(v.model, 240), cost: text(v.cost, 400),
    media: (v.media || []).map((m: any) => {
      if (!m || !['image', 'video'].includes(m.kind)) throw new Error('Invalid review media kind.');
      const path = reviewMediaPath(m.path);
      if ((m.kind === 'video') !== /\.(mp4|webm|mov)$/i.test(path)) throw new Error('Media kind does not match file type.');
      const cover = m.cover == null ? undefined : reviewMediaPath(m.cover);
      if (cover && /\.(mp4|webm|mov)$/i.test(cover)) throw new Error('Cover must be an image.');
      return { kind: m.kind, path, label: text(m.label, 240), cover };
    }),
  };
}

/** Derive generation previews from the real gated tool arguments, not a second prompt. */
export function generationContentReview(toolName: string, args: Record<string, any>): ContentReview | undefined {
  if (!['generate_image', 'generate_video', 'media_generate', 'creative_generate_image_shot', 'creative_generate_video_shot'].includes(toolName)) return undefined;
  const refs = [args.start_image, args.image_path, ...(Array.isArray(args.reference_images) ? args.reference_images : [])].filter(Boolean);
  const media: ContentReview['media'] = [];
  for (const ref of refs.slice(0, 12)) {
    try { const path = reviewMediaPath(ref); if (!/\.(mp4|webm|mov)$/i.test(path)) media.push({kind:'image',path}); } catch { /* Remote references are not fetched through a review card. */ }
  }
  const settings = Object.fromEntries(['provider','model','count','aspect_ratio','size','duration','duration_seconds','resolution','quality'].filter(k => args[k] != null).map(k => [k,args[k]]));
  return normalizeContentReview({kind:'generation',text:String(args.prompt || args.description || '') + '\n\nSettings: ' + JSON.stringify(settings),model:String(args.model || args.provider || 'Selected provider default'),cost:'Usage/cost not quoted by this approval',media});
}
