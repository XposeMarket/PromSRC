import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config.js';

export interface BrowserKnowledgeRecord {
  name: string;
  aliases: string[];
  selector: string;
  selectors: string[];
  tagName: string;
  id: string;
  text: string;
  url: string;
  savedAt: number;
  updatedAt: number;
}

export interface BrowserKnowledgeElement extends BrowserKnowledgeRecord {}
export interface BrowserKnowledgeItemRoot extends BrowserKnowledgeRecord {}

export type BrowserKnowledgeExtractionFieldType = 'text' | 'href' | 'src' | 'attr' | 'html';

export interface BrowserKnowledgeExtractionField {
  selector: string;
  type: BrowserKnowledgeExtractionFieldType;
  attribute?: string;
  required?: boolean;
}

export interface BrowserKnowledgeExtractionSchema {
  name: string;
  aliases: string[];
  itemRoot: string;
  containerSelector: string;
  dedupeKey: string;
  limit: number;
  fields: Record<string, BrowserKnowledgeExtractionField>;
  url: string;
  savedAt: number;
  updatedAt: number;
}

export interface BrowserSiteKnowledge {
  hostname: string;
  updatedAt: number;
  elements: BrowserKnowledgeElement[];
  itemRoots: BrowserKnowledgeItemRoot[];
  extractionSchemas: BrowserKnowledgeExtractionSchema[];
}

export interface SaveBrowserKnowledgeElementInput {
  name: string;
  selector?: string;
  tagName?: string;
  id?: string;
  text?: string;
  url?: string;
  aliases?: string[];
}

export interface SaveBrowserKnowledgeExtractionSchemaInput {
  name: string;
  itemRoot?: string;
  containerSelector?: string;
  dedupeKey?: string;
  limit?: number;
  fields?: Record<string, Partial<BrowserKnowledgeExtractionField> | null | undefined>;
  url?: string;
  aliases?: string[];
}

const CACHE_TTL_MS = 30_000;
const siteKnowledgeCache = new Map<string, { ts: number; data: BrowserSiteKnowledge }>();

function knowledgeRootDir(): string {
  const dir = path.join(getConfig().getConfigDir(), 'browser-knowledge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanHostname(hostname: string): string {
  return String(hostname || '').replace(/^www\./i, '').trim().toLowerCase();
}

function normalizeUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function normalizeName(input: string): string {
  return String(input || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function knowledgeFilePath(hostname: string): string {
  const safe = cleanHostname(hostname).replace(/[^a-z0-9._-]+/gi, '_') || 'unknown-site';
  return path.join(knowledgeRootDir(), `${safe}.json`);
}

function sortRecords<T extends BrowserKnowledgeRecord>(records: T[]): T[] {
  return records
    .slice()
    .sort((a, b) => (Number(b.updatedAt || b.savedAt || 0) || 0) - (Number(a.updatedAt || a.savedAt || 0) || 0));
}

function sortSchemas(records: BrowserKnowledgeExtractionSchema[]): BrowserKnowledgeExtractionSchema[] {
  return records
    .slice()
    .sort((a, b) => (Number(b.updatedAt || b.savedAt || 0) || 0) - (Number(a.updatedAt || a.savedAt || 0) || 0));
}

function normalizeExtractionFieldType(input: string): BrowserKnowledgeExtractionFieldType {
  const raw = String(input || '').trim().toLowerCase();
  return raw === 'href' || raw === 'src' || raw === 'attr' || raw === 'html' ? raw : 'text';
}

function normalizeExtractionField(raw: any): BrowserKnowledgeExtractionField | null {
  if (!raw || typeof raw !== 'object') return null;
  const selector = String(raw.selector || '').trim();
  if (!selector) return null;
  const type = normalizeExtractionFieldType(String(raw.type || 'text'));
  const field: BrowserKnowledgeExtractionField = {
    selector,
    type,
  };
  const attribute = String(raw.attribute || '').trim();
  if (attribute) field.attribute = attribute;
  if (raw.required != null) field.required = raw.required === true;
  return field;
}

function normalizeExtractionFields(raw: any): Record<string, BrowserKnowledgeExtractionField> {
  const fields: Record<string, BrowserKnowledgeExtractionField> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fields;
  for (const [fieldName, value] of Object.entries(raw)) {
    const cleanName = String(fieldName || '').trim();
    if (!cleanName) continue;
    const normalized = normalizeExtractionField(value);
    if (!normalized) continue;
    fields[cleanName] = normalized;
  }
  return fields;
}

function normalizeRecords(raw: any): BrowserKnowledgeRecord[] {
  if (!Array.isArray(raw)) return [];
  return sortRecords(
    raw.map((entry) => ({
      name: String(entry?.name || '').trim(),
      aliases: uniqueStrings(Array.isArray(entry?.aliases) ? entry.aliases : []),
      selector: String(entry?.selector || '').trim(),
      selectors: uniqueStrings(Array.isArray(entry?.selectors) ? entry.selectors : [entry?.selector as string]),
      tagName: String(entry?.tagName || '').trim(),
      id: String(entry?.id || '').trim(),
      text: String(entry?.text || '').trim(),
      url: String(entry?.url || '').trim(),
      savedAt: Number(entry?.savedAt || 0) || 0,
      updatedAt: Number(entry?.updatedAt || entry?.savedAt || 0) || 0,
    })).filter((entry) => entry.name),
  );
}

function normalizeExtractionSchemas(raw: any): BrowserKnowledgeExtractionSchema[] {
  if (!Array.isArray(raw)) return [];
  return sortSchemas(
    raw.map((entry) => ({
      name: String(entry?.name || '').trim(),
      aliases: uniqueStrings(Array.isArray(entry?.aliases) ? entry.aliases : []),
      itemRoot: String(entry?.itemRoot || '').trim(),
      containerSelector: String(entry?.containerSelector || entry?.container_selector || '').trim(),
      dedupeKey: String(entry?.dedupeKey || entry?.dedupe_key || '').trim(),
      limit: Math.min(Math.max(Number(entry?.limit || 50) || 50, 1), 500),
      fields: normalizeExtractionFields(entry?.fields),
      url: String(entry?.url || '').trim(),
      savedAt: Number(entry?.savedAt || 0) || 0,
      updatedAt: Number(entry?.updatedAt || entry?.savedAt || 0) || 0,
    })).filter((entry) => entry.name && entry.containerSelector && Object.keys(entry.fields).length > 0),
  );
}

function saveBrowserSiteKnowledge(site: BrowserSiteKnowledge): void {
  const clean = cleanHostname(site.hostname);
  if (!clean) return;
  const payload: BrowserSiteKnowledge = {
    hostname: clean,
    updatedAt: Number(site.updatedAt || Date.now()) || Date.now(),
    elements: sortRecords(Array.isArray(site.elements) ? site.elements : []),
    itemRoots: sortRecords(Array.isArray(site.itemRoots) ? site.itemRoots : []),
    extractionSchemas: sortSchemas(Array.isArray(site.extractionSchemas) ? site.extractionSchemas : []),
  };
  const filePath = knowledgeFilePath(clean);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  siteKnowledgeCache.set(clean, { ts: Date.now(), data: payload });
}

function matchRecordByName<T extends { name: string; aliases?: string[] }>(records: T[], name: string): T | null {
  const target = normalizeName(name);
  if (!target) return null;
  return records.find((entry) => {
    if (normalizeName(entry.name) === target) return true;
    return Array.isArray(entry.aliases) && entry.aliases.some((alias) => normalizeName(alias) === target);
  }) || null;
}

function saveNamedRecordForUrl<T extends BrowserKnowledgeRecord>(
  url: string,
  input: SaveBrowserKnowledgeElementInput,
  collectionName: 'elements' | 'itemRoots',
): { site: BrowserSiteKnowledge; saved: T } {
  const hostname = getBrowserKnowledgeHostnameFromUrl(url);
  if (!hostname) throw new Error('Cannot save browser memory without a valid site URL.');
  const rawName = String(input?.name || '').trim();
  if (!rawName) throw new Error('A name is required.');

  const now = Date.now();
  const site = loadBrowserSiteKnowledge(hostname);
  const records = collectionName === 'elements' ? site.elements : site.itemRoots;
  const normalizedTarget = normalizeName(rawName);
  const selector = String(input?.selector || '').trim();
  const index = records.findIndex((entry) => {
    if (normalizeName(entry.name) === normalizedTarget) return true;
    return Array.isArray(entry.aliases) && entry.aliases.some((alias) => normalizeName(alias) === normalizedTarget);
  });

  const previous = index >= 0 ? records[index] : null;
  const id = String(input?.id || previous?.id || '').trim();
  const saved = {
    name: rawName,
    aliases: uniqueStrings([
      ...(previous?.aliases || []),
      ...(previous && normalizeName(previous.name) !== normalizedTarget ? [previous.name] : []),
      ...(Array.isArray(input?.aliases) ? input.aliases : []),
    ]).filter((alias) => normalizeName(alias) !== normalizedTarget),
    selector: selector || previous?.selector || (id ? `#${id}` : ''),
    selectors: uniqueStrings([
      selector,
      ...(previous?.selectors || []),
      previous?.selector,
      id ? `#${id}` : '',
    ]),
    tagName: String(input?.tagName || previous?.tagName || '').trim(),
    id,
    text: String(input?.text || previous?.text || '').trim(),
    url: String(url || input?.url || previous?.url || '').trim(),
    savedAt: Number(previous?.savedAt || now) || now,
    updatedAt: now,
  } as T;

  if (index >= 0) records.splice(index, 1, saved);
  else records.unshift(saved);

  site.updatedAt = now;
  site.elements = sortRecords(site.elements);
  site.itemRoots = sortRecords(site.itemRoots);
  site.extractionSchemas = sortSchemas(site.extractionSchemas);
  saveBrowserSiteKnowledge(site);
  return { site, saved };
}

export function getBrowserKnowledgeHostnameFromUrl(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    return cleanHostname(parsed.hostname);
  } catch {
    return '';
  }
}

export function loadBrowserSiteKnowledge(hostname: string): BrowserSiteKnowledge {
  const clean = cleanHostname(hostname);
  if (!clean) return { hostname: '', updatedAt: 0, elements: [], itemRoots: [], extractionSchemas: [] };
  const cached = siteKnowledgeCache.get(clean);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const filePath = knowledgeFilePath(clean);
  let data: BrowserSiteKnowledge = { hostname: clean, updatedAt: 0, elements: [], itemRoots: [], extractionSchemas: [] };
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<BrowserSiteKnowledge>;
      data = {
        hostname: clean,
        updatedAt: Number(raw?.updatedAt || 0) || 0,
        elements: normalizeRecords(raw?.elements),
        itemRoots: normalizeRecords((raw as any)?.itemRoots),
        extractionSchemas: normalizeExtractionSchemas((raw as any)?.extractionSchemas),
      };
    }
  } catch {
    data = { hostname: clean, updatedAt: 0, elements: [], itemRoots: [], extractionSchemas: [] };
  }

  siteKnowledgeCache.set(clean, { ts: Date.now(), data });
  return data;
}

export function listNamedBrowserElementsForUrl(url: string): BrowserKnowledgeElement[] {
  const hostname = getBrowserKnowledgeHostnameFromUrl(url);
  if (!hostname) return [];
  return loadBrowserSiteKnowledge(hostname).elements;
}

export function listNamedBrowserItemRootsForUrl(url: string): BrowserKnowledgeItemRoot[] {
  const hostname = getBrowserKnowledgeHostnameFromUrl(url);
  if (!hostname) return [];
  return loadBrowserSiteKnowledge(hostname).itemRoots;
}

export function listNamedBrowserExtractionSchemasForUrl(url: string): BrowserKnowledgeExtractionSchema[] {
  const hostname = getBrowserKnowledgeHostnameFromUrl(url);
  if (!hostname) return [];
  return loadBrowserSiteKnowledge(hostname).extractionSchemas;
}

export function matchNamedBrowserElementForUrl(url: string, name: string): BrowserKnowledgeElement | null {
  return matchRecordByName(listNamedBrowserElementsForUrl(url), name);
}

export function matchNamedBrowserItemRootForUrl(url: string, name: string): BrowserKnowledgeItemRoot | null {
  return matchRecordByName(listNamedBrowserItemRootsForUrl(url), name);
}

export function matchNamedBrowserExtractionSchemaForUrl(url: string, name: string): BrowserKnowledgeExtractionSchema | null {
  return matchRecordByName(listNamedBrowserExtractionSchemasForUrl(url), name);
}

export function saveNamedBrowserElementForUrl(
  url: string,
  input: SaveBrowserKnowledgeElementInput,
): { site: BrowserSiteKnowledge; saved: BrowserKnowledgeElement } {
  return saveNamedRecordForUrl<BrowserKnowledgeElement>(url, input, 'elements');
}

export function saveNamedBrowserItemRootForUrl(
  url: string,
  input: SaveBrowserKnowledgeElementInput,
): { site: BrowserSiteKnowledge; saved: BrowserKnowledgeItemRoot } {
  return saveNamedRecordForUrl<BrowserKnowledgeItemRoot>(url, input, 'itemRoots');
}

export function saveNamedBrowserExtractionSchemaForUrl(
  url: string,
  input: SaveBrowserKnowledgeExtractionSchemaInput,
): { site: BrowserSiteKnowledge; saved: BrowserKnowledgeExtractionSchema } {
  const hostname = getBrowserKnowledgeHostnameFromUrl(url);
  if (!hostname) throw new Error('Cannot save an extraction schema without a valid site URL.');
  const rawName = String(input?.name || '').trim();
  if (!rawName) throw new Error('A schema name is required.');

  const now = Date.now();
  const site = loadBrowserSiteKnowledge(hostname);
  const normalizedTarget = normalizeName(rawName);
  const index = site.extractionSchemas.findIndex((entry) => {
    if (normalizeName(entry.name) === normalizedTarget) return true;
    return Array.isArray(entry.aliases) && entry.aliases.some((alias) => normalizeName(alias) === normalizedTarget);
  });
  const previous = index >= 0 ? site.extractionSchemas[index] : null;
  const fields = normalizeExtractionFields(input?.fields);
  if (!Object.keys(fields).length && !previous) {
    throw new Error('Extraction schemas need at least one valid field.');
  }

  const saved: BrowserKnowledgeExtractionSchema = {
    name: rawName,
    aliases: uniqueStrings([
      ...(previous?.aliases || []),
      ...(previous && normalizeName(previous.name) !== normalizedTarget ? [previous.name] : []),
      ...(Array.isArray(input?.aliases) ? input.aliases : []),
    ]).filter((alias) => normalizeName(alias) !== normalizedTarget),
    itemRoot: String(input?.itemRoot || previous?.itemRoot || '').trim(),
    containerSelector: String(input?.containerSelector || previous?.containerSelector || '').trim(),
    dedupeKey: String(input?.dedupeKey || previous?.dedupeKey || '').trim(),
    limit: Math.min(Math.max(Number(input?.limit || previous?.limit || 50) || 50, 1), 500),
    fields: Object.keys(fields).length ? fields : { ...(previous?.fields || {}) },
    url: String(url || input?.url || previous?.url || '').trim(),
    savedAt: Number(previous?.savedAt || now) || now,
    updatedAt: now,
  };

  if (!saved.containerSelector) {
    throw new Error('Extraction schemas need a container selector or saved item root.');
  }
  if (!Object.keys(saved.fields).length) {
    throw new Error('Extraction schemas need at least one valid field.');
  }

  if (index >= 0) site.extractionSchemas.splice(index, 1, saved);
  else site.extractionSchemas.unshift(saved);

  site.updatedAt = now;
  site.elements = sortRecords(site.elements);
  site.itemRoots = sortRecords(site.itemRoots);
  site.extractionSchemas = sortSchemas(site.extractionSchemas);
  saveBrowserSiteKnowledge(site);
  return { site, saved };
}

export function formatNamedBrowserElementsForUrl(url: string, limit = 8): string {
  const hostname = getBrowserKnowledgeHostnameFromUrl(url);
  if (!hostname) return '';
  const elementLimit = Math.max(1, Number(limit) || 8);
  const elements = listNamedBrowserElementsForUrl(url).slice(0, elementLimit);
  const itemRoots = listNamedBrowserItemRootsForUrl(url).slice(0, Math.max(4, Math.ceil(elementLimit / 2)));
  const extractionSchemas = listNamedBrowserExtractionSchemasForUrl(url).slice(0, Math.max(4, Math.ceil(elementLimit / 2)));
  if (!elements.length && !itemRoots.length && !extractionSchemas.length) return '';

  const lines = [`BROWSER MEMORY FOR ${hostname}:`];
  if (elements.length) {
    lines.push('  ELEMENTS:');
    for (const entry of elements) {
      const target = entry.selector || (entry.id ? `#${entry.id}` : '') || entry.tagName || 'element';
      const hint = entry.text ? ` :: ${entry.text.slice(0, 80)}` : '';
      lines.push(`    ${entry.name} -> ${target}${hint}`);
    }
  }
  if (itemRoots.length) {
    lines.push('  ITEM ROOTS:');
    for (const entry of itemRoots) {
      const target = entry.selector || (entry.id ? `#${entry.id}` : '') || entry.tagName || 'root';
      const hint = entry.text ? ` :: ${entry.text.slice(0, 80)}` : '';
      lines.push(`    ${entry.name} -> ${target}${hint}`);
    }
  }
  if (extractionSchemas.length) {
    lines.push('  EXTRACTION SCHEMAS:');
    for (const entry of extractionSchemas) {
      const fieldNames = Object.keys(entry.fields || {}).slice(0, 6).join(', ');
      const rootHint = entry.itemRoot ? ` @ ${entry.itemRoot}` : '';
      lines.push(`    ${entry.name}${rootHint} -> fields: ${fieldNames || 'none'}`);
    }
  }
  lines.push('Use saved element names with browser_click/browser_fill/browser_get_page_text, item root names with browser_extract_structured/browser_scroll_collect_v2, and saved schemas with schema_name.');
  return lines.join('\n');
}
