/**
 * Persistent cross-project video library: reusable cast (people/products) and brand kits.
 * Stored under <workspacePath>/video-library/{cast,brands}/<id>/.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type CastKind = 'person' | 'product';
export interface VoiceRef { provider: 'openai' | 'xai'; voice: string }

export interface CastMember {
  id: string;
  name: string;
  kind: CastKind;
  anchors: string[];
  refs: string[];
  notes?: string;
  identity?: Record<string, string>;
  voice?: VoiceRef;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BrandKit {
  id: string;
  name: string;
  logo?: string;
  colors: string[];
  fonts?: { heading?: string; body?: string };
  voice?: VoiceRef;
  tone?: string;
  promptSuffix?: string;
  tagline?: string;
  cta?: string;
  castIds: string[];
  productIds: string[];
  watermark?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryOp { op: string; [key: string]: any }

const ID_RE = /^(cast|brand)_[a-f0-9]{10}$/;

function newLibId(prefix: 'cast' | 'brand'): string {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function assertId(id: string, prefix: 'cast' | 'brand'): string {
  if (typeof id !== 'string' || !ID_RE.test(id) || !id.startsWith(prefix + '_')) {
    throw new Error(`Invalid ${prefix} id: ${String(id)}`);
  }
  return id;
}

function isInside(root: string, p: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(p);
  return t === r || t.startsWith(r + path.sep);
}

function wsAbs(ws: string, rel: string): string {
  const abs = path.resolve(ws, rel);
  if (!isInside(ws, abs)) throw new Error(`Path escapes workspace: ${rel}`);
  return abs;
}

function wsRel(ws: string, abs: string): string {
  return path.relative(path.resolve(ws), abs).split(path.sep).join('/');
}

export function libraryRoot(ws: string): string {
  return path.join(path.resolve(ws), 'video-library');
}
function castDir(ws: string, id: string): string {
  const d = path.join(libraryRoot(ws), 'cast', assertId(id, 'cast'));
  if (!isInside(libraryRoot(ws), d)) throw new Error('Path traversal');
  return d;
}
function brandDir(ws: string, id: string): string {
  const d = path.join(libraryRoot(ws), 'brands', assertId(id, 'brand'));
  if (!isInside(libraryRoot(ws), d)) throw new Error('Path traversal');
  return d;
}

/** Copy a workspace-relative file into dir (unless already inside). Returns new workspace-relative path. */
function importFile(ws: string, dir: string, rel: string): string {
  const abs = wsAbs(ws, rel);
  if (isInside(dir, abs)) return wsRel(ws, abs);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`File not found: ${rel}`);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(abs);
  const base = path.basename(abs, ext);
  let dest = path.join(dir, base + ext);
  let n = 1;
  while (fs.existsSync(dest)) {
    // identical content => reuse
    try {
      if (fs.readFileSync(dest).equals(fs.readFileSync(abs))) return wsRel(ws, dest);
    } catch { /* ignore */ }
    dest = path.join(dir, `${base}-${n++}${ext}`);
  }
  fs.copyFileSync(abs, dest);
  return wsRel(ws, dest);
}

function uniq(a: string[]): string[] { return Array.from(new Set(a)); }

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}
function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---------------- Cast ----------------

export function listCast(ws: string, filter?: { kind?: CastKind }): CastMember[] {
  const root = path.join(libraryRoot(ws), 'cast');
  if (!fs.existsSync(root)) return [];
  const out: CastMember[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!ID_RE.test(name) || !name.startsWith('cast_')) continue;
    const m = readJson<CastMember>(path.join(root, name, 'cast.json'));
    if (!m) continue;
    if (filter?.kind && m.kind !== filter.kind) continue;
    out.push(m);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCast(ws: string, id: string): CastMember | null {
  return readJson<CastMember>(path.join(castDir(ws, id), 'cast.json'));
}

export function saveCast(ws: string, input: Partial<CastMember> & { name: string }): CastMember {
  if (!input.name || !String(input.name).trim()) throw new Error('Cast name required');
  const id = input.id ? assertId(input.id, 'cast') : newLibId('cast');
  const existing = input.id ? getCast(ws, id) : null;
  const dir = castDir(ws, id);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const anchors = uniq((input.anchors ?? existing?.anchors ?? []).map((r) => importFile(ws, dir, r)));
  const refs = uniq((input.refs ?? existing?.refs ?? []).map((r) => importFile(ws, dir, r)));
  const member: CastMember = {
    id,
    name: String(input.name).trim(),
    kind: input.kind ?? existing?.kind ?? 'person',
    anchors,
    refs,
    notes: input.notes ?? existing?.notes,
    identity: input.identity ?? existing?.identity,
    voice: input.voice ?? existing?.voice,
    tags: input.tags ?? existing?.tags,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  writeJson(path.join(dir, 'cast.json'), member);
  return member;
}

export function deleteCast(ws: string, id: string): boolean {
  const dir = castDir(ws, id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function castFromCharacter(
  ws: string,
  character: { name: string; anchors: string[]; refs: string[]; notes?: string; identity?: Record<string, string> },
  extra?: { kind?: CastKind; voice?: VoiceRef; tags?: string[] },
): CastMember {
  return saveCast(ws, {
    name: character.name,
    anchors: character.anchors ?? [],
    refs: character.refs ?? [],
    notes: character.notes,
    identity: character.identity,
    kind: extra?.kind ?? 'person',
    voice: extra?.voice,
    tags: extra?.tags,
  });
}

export function castToCharacterOp(member: CastMember): LibraryOp {
  return {
    op: 'character.upsert',
    name: member.name,
    anchors: [...member.anchors],
    refs: [...member.refs],
    notes: member.notes,
    identity: member.identity,
    kind: member.kind,
    castId: member.id,
  };
}

// ---------------- Brands ----------------

export function listBrands(ws: string): BrandKit[] {
  const root = path.join(libraryRoot(ws), 'brands');
  if (!fs.existsSync(root)) return [];
  const out: BrandKit[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!ID_RE.test(name) || !name.startsWith('brand_')) continue;
    const b = readJson<BrandKit>(path.join(root, name, 'brand.json'));
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getBrand(ws: string, id: string): BrandKit | null {
  return readJson<BrandKit>(path.join(brandDir(ws, id), 'brand.json'));
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function saveBrand(ws: string, input: Partial<BrandKit> & { name: string }): BrandKit {
  if (!input.name || !String(input.name).trim()) throw new Error('Brand name required');
  const id = input.id ? assertId(input.id, 'brand') : newLibId('brand');
  const existing = input.id ? getBrand(ws, id) : null;
  const dir = brandDir(ws, id);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const logoIn = input.logo ?? existing?.logo;
  const colors = (input.colors ?? existing?.colors ?? []).map((c) => String(c).trim());
  for (const c of colors) if (!HEX_RE.test(c)) throw new Error(`Invalid hex color: ${c}`);
  const ids = (a: string[] | undefined) => uniq((a ?? []).map((x) => assertId(x, 'cast')));
  const brand: BrandKit = {
    id,
    name: String(input.name).trim(),
    logo: logoIn ? importFile(ws, dir, logoIn) : undefined,
    colors,
    fonts: input.fonts ?? existing?.fonts,
    voice: input.voice ?? existing?.voice,
    tone: input.tone ?? existing?.tone,
    promptSuffix: input.promptSuffix ?? existing?.promptSuffix,
    tagline: input.tagline ?? existing?.tagline,
    cta: input.cta ?? existing?.cta,
    castIds: ids(input.castIds ?? existing?.castIds),
    productIds: ids(input.productIds ?? existing?.productIds),
    watermark: input.watermark ?? existing?.watermark,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  writeJson(path.join(dir, 'brand.json'), brand);
  return brand;
}

export function deleteBrand(ws: string, id: string): boolean {
  const dir = brandDir(ws, id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function brandToProjectOps(ws: string, brand: BrandKit): LibraryOp[] {
  const parts: string[] = [];
  if (brand.tone) parts.push(`${brand.tone} tone`);
  if (brand.promptSuffix) parts.push(brand.promptSuffix);
  if (brand.colors.length) parts.push(`brand color palette ${brand.colors.join(', ')}`);
  const ops: LibraryOp[] = [
    { op: 'style.upsert', name: `${brand.name} brand`, refs: [], promptSuffix: parts.join(', ') },
  ];
  for (const cid of uniq([...(brand.castIds ?? []), ...(brand.productIds ?? [])])) {
    const m = getCast(ws, cid);
    if (m) ops.push(castToCharacterOp(m));
  }
  ops.push({
    op: 'project.update',
    brand: { id: brand.id, name: brand.name, logo: brand.logo, colors: [...brand.colors], watermark: !!brand.watermark },
  });
  return ops;
}
