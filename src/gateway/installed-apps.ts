import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config/config.js';

const execFileAsync = promisify(execFile);

export interface InstalledAppLaunchMethod {
  type: 'shortcut' | 'exe' | 'aumid';
  target: string;
  args?: string;
}

export interface InstalledAppRecord {
  id: string;
  displayName: string;
  aliases: string[];
  executablePath?: string;
  shortcutPath?: string;
  appUserModelId?: string;
  packageFamilyName?: string;
  processNameHints: string[];
  windowTitleHints: string[];
  installSources: string[];
  launchMethods: InstalledAppLaunchMethod[];
  lastScannedAt: number;
}

export interface InstalledAppInventory {
  generatedAt: number;
  apps: InstalledAppRecord[];
}

export interface InstalledAppSearchResult extends InstalledAppRecord {
  score: number;
  matchedOn: string[];
}

interface InstalledAppAliasStore {
  [appId: string]: string[];
}

interface RawInstalledAppItem {
  sourceType?: string;
  displayName?: string;
  appId?: string;
  shortcutPath?: string;
  targetPath?: string;
  arguments?: string;
  description?: string;
  workingDirectory?: string;
  packageFamilyName?: string;
}

interface InstalledAppAccumulator {
  displayName: string;
  aliases: Set<string>;
  executablePath?: string;
  shortcutPath?: string;
  appUserModelId?: string;
  packageFamilyName?: string;
  processNameHints: Set<string>;
  windowTitleHints: Set<string>;
  installSources: Set<string>;
  launchMethods: Map<string, InstalledAppLaunchMethod>;
}

interface InventoryOptions {
  refresh?: boolean;
  maxAgeMs?: number;
}

const DEFAULT_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function getConfigDir(): string {
  try {
    return getConfig().getConfigDir();
  } catch {
    return path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), '.prometheus');
  }
}

function getInventoryCachePath(): string {
  return path.join(getConfigDir(), 'installed-apps.json');
}

function getAliasStorePath(): string {
  return path.join(getConfigDir(), 'installed-app-aliases.json');
}

function ensureStorageDir(): void {
  fs.mkdirSync(getConfigDir(), { recursive: true });
}

function normalizeWinPath(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return path.resolve(raw);
  } catch {
    return raw;
  }
}

function normalizeLookupText(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqStrings(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function parseJsonMaybe(raw: string): any {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function loadAliasStore(): InstalledAppAliasStore {
  ensureStorageDir();
  const file = getAliasStorePath();
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const out: InstalledAppAliasStore = {};
    for (const [appId, aliases] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(aliases)) continue;
      out[appId] = uniqStrings(aliases.map((alias) => String(alias || '').trim()));
    }
    return out;
  } catch {
    return {};
  }
}

function saveAliasStore(store: InstalledAppAliasStore): void {
  ensureStorageDir();
  fs.writeFileSync(getAliasStorePath(), JSON.stringify(store, null, 2), 'utf-8');
}

function loadInventoryCache(): InstalledAppInventory | null {
  ensureStorageDir();
  const file = getInventoryCachePath();
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!parsed || !Array.isArray(parsed.apps)) return null;
    return {
      generatedAt: Math.floor(Number(parsed.generatedAt) || 0),
      apps: parsed.apps as InstalledAppRecord[],
    };
  } catch {
    return null;
  }
}

function saveInventoryCache(inventory: InstalledAppInventory): void {
  ensureStorageDir();
  fs.writeFileSync(getInventoryCachePath(), JSON.stringify(inventory, null, 2), 'utf-8');
}

async function runPowerShell(script: string, timeoutMs: number = 120000): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('Installed app discovery is currently supported on Windows only.');
  }
  const { stdout, stderr } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const out = String(stdout || '').trim();
  const err = String(stderr || '').trim();
  if (err && !out) throw new Error(err.slice(0, 800));
  return out;
}

function makeInstalledAppId(input: {
  appUserModelId?: string;
  shortcutPath?: string;
  executablePath?: string;
  displayName: string;
}): string {
  const rawKey =
    normalizeLookupText(input.appUserModelId)
    || normalizeWinPath(input.shortcutPath)
    || normalizeWinPath(input.executablePath)
    || normalizeLookupText(input.displayName);
  return `app_${crypto.createHash('sha1').update(rawKey).digest('hex').slice(0, 16)}`;
}

function isProbablyShortcutTarget(value?: string | null): boolean {
  const ext = path.extname(String(value || '').trim()).toLowerCase();
  return ext === '.exe' || ext === '.bat' || ext === '.cmd' || ext === '.com' || ext === '.lnk';
}

function isLikelyNoiseExecutable(baseName: string): boolean {
  const name = baseName.toLowerCase();
  if (!name) return true;
  return (
    /^unins\d*$/i.test(name)
    || /(uninstall|installer|setup|update|updater|crashpad|helper|elevation_service|notification_helper|maintenance|repair|service)$/i.test(name)
    || /squirrel/i.test(name)
  );
}

function pickBetterDisplayName(current: string, incoming: string): string {
  const next = String(incoming || '').trim();
  const prev = String(current || '').trim();
  if (!prev) return next;
  if (!next) return prev;
  const prevNorm = normalizeLookupText(prev);
  const nextNorm = normalizeLookupText(next);
  if (!prevNorm) return next;
  if (!nextNorm) return prev;
  const prevHasSpaces = /\s/.test(prev);
  const nextHasSpaces = /\s/.test(next);
  if (!prevHasSpaces && nextHasSpaces) return next;
  if (prevNorm === path.parse(prevNorm).name && nextNorm.length > prevNorm.length + 2) return next;
  if (next.length > prev.length + 6) return next;
  return prev;
}

function addLaunchMethod(acc: InstalledAppAccumulator, method: InstalledAppLaunchMethod | null | undefined): void {
  if (!method?.type || !method.target) return;
  const key = `${method.type}:${normalizeWinPath(method.target) || method.target.toLowerCase()}:${String(method.args || '').trim()}`;
  if (!acc.launchMethods.has(key)) acc.launchMethods.set(key, method);
}

function mergeAccumulator(base: InstalledAppAccumulator, incoming: InstalledAppAccumulator): InstalledAppAccumulator {
  base.displayName = pickBetterDisplayName(base.displayName, incoming.displayName);
  if (!base.executablePath && incoming.executablePath) base.executablePath = incoming.executablePath;
  if (!base.shortcutPath && incoming.shortcutPath) base.shortcutPath = incoming.shortcutPath;
  if (!base.appUserModelId && incoming.appUserModelId) base.appUserModelId = incoming.appUserModelId;
  if (!base.packageFamilyName && incoming.packageFamilyName) base.packageFamilyName = incoming.packageFamilyName;
  incoming.aliases.forEach((alias) => base.aliases.add(alias));
  incoming.processNameHints.forEach((hint) => base.processNameHints.add(hint));
  incoming.windowTitleHints.forEach((hint) => base.windowTitleHints.add(hint));
  incoming.installSources.forEach((source) => base.installSources.add(source));
  for (const method of incoming.launchMethods.values()) addLaunchMethod(base, method);
  return base;
}

function createAccumulatorFromRaw(item: RawInstalledAppItem): InstalledAppAccumulator | null {
  const displayName = String(item.displayName || '').trim();
  const shortcutPath = normalizeWinPath(item.shortcutPath);
  const targetPath = normalizeWinPath(item.targetPath);
  const appUserModelId = String(item.appId || '').trim();
  const packageFamilyName = String(item.packageFamilyName || '').trim() || (appUserModelId.includes('!') ? appUserModelId.split('!')[0] : '');
  const targetBase = path.parse(targetPath).name;
  const shortcutBase = path.parse(shortcutPath).name;
  const chosenName = displayName || shortcutBase || targetBase;
  if (!chosenName) return null;
  if (!displayName && !appUserModelId && !shortcutPath && !targetPath) return null;
  if (!appUserModelId && !shortcutPath && targetBase && isLikelyNoiseExecutable(targetBase)) return null;
  const acc: InstalledAppAccumulator = {
    displayName: chosenName,
    aliases: new Set<string>(),
    executablePath: targetPath && isProbablyShortcutTarget(targetPath) && path.extname(targetPath).toLowerCase() === '.exe' ? targetPath : undefined,
    shortcutPath: shortcutPath || undefined,
    appUserModelId: appUserModelId || undefined,
    packageFamilyName: packageFamilyName || undefined,
    processNameHints: new Set<string>(),
    windowTitleHints: new Set<string>(),
    installSources: new Set<string>(),
    launchMethods: new Map<string, InstalledAppLaunchMethod>(),
  };

  if (displayName) {
    acc.aliases.add(displayName);
    acc.windowTitleHints.add(displayName);
  }
  if (shortcutBase && normalizeLookupText(shortcutBase) !== normalizeLookupText(displayName)) {
    acc.aliases.add(shortcutBase);
    acc.windowTitleHints.add(shortcutBase);
  }
  if (targetBase && !isLikelyNoiseExecutable(targetBase)) {
    acc.aliases.add(targetBase);
    acc.processNameHints.add(targetBase);
  }
  if (item.description) acc.windowTitleHints.add(String(item.description).trim());
  if (item.sourceType) acc.installSources.add(String(item.sourceType).trim());

  if (shortcutPath) {
    addLaunchMethod(acc, {
      type: 'shortcut',
      target: shortcutPath,
    });
  }
  if (acc.executablePath) {
    addLaunchMethod(acc, {
      type: 'exe',
      target: acc.executablePath,
      args: String(item.arguments || '').trim() || undefined,
    });
  }
  if (appUserModelId) {
    addLaunchMethod(acc, {
      type: 'aumid',
      target: appUserModelId,
    });
  }

  return acc;
}

function mergeCandidateKeys(acc: InstalledAppAccumulator): string[] {
  const keys: string[] = [];
  if (acc.appUserModelId) keys.push(`aumid:${normalizeLookupText(acc.appUserModelId)}`);
  if (acc.packageFamilyName) keys.push(`package:${normalizeLookupText(acc.packageFamilyName)}`);
  if (acc.shortcutPath) keys.push(`shortcut:${normalizeWinPath(acc.shortcutPath).toLowerCase()}`);
  if (acc.executablePath) keys.push(`exe:${normalizeWinPath(acc.executablePath).toLowerCase()}`);
  const nameKey = normalizeLookupText(acc.displayName);
  if (nameKey) keys.push(`name:${nameKey}`);
  return uniqStrings(keys);
}

function finalizeAccumulator(acc: InstalledAppAccumulator, generatedAt: number, aliasStore: InstalledAppAliasStore): InstalledAppRecord {
  const launchMethods = Array.from(acc.launchMethods.values()).sort((a, b) => {
    const order = (method: InstalledAppLaunchMethod) => (method.type === 'shortcut' ? 0 : method.type === 'exe' ? 1 : 2);
    return order(a) - order(b) || a.target.localeCompare(b.target);
  });
  const id = makeInstalledAppId({
    appUserModelId: acc.appUserModelId,
    shortcutPath: acc.shortcutPath,
    executablePath: acc.executablePath,
    displayName: acc.displayName,
  });
  const manualAliases = aliasStore[id] || [];
  const aliases = uniqStrings([
    acc.displayName,
    ...Array.from(acc.aliases),
    ...manualAliases,
  ]).sort((a, b) => a.localeCompare(b));

  return {
    id,
    displayName: acc.displayName,
    aliases,
    executablePath: acc.executablePath,
    shortcutPath: acc.shortcutPath,
    appUserModelId: acc.appUserModelId,
    packageFamilyName: acc.packageFamilyName,
    processNameHints: uniqStrings(Array.from(acc.processNameHints)).sort((a, b) => a.localeCompare(b)),
    windowTitleHints: uniqStrings(Array.from(acc.windowTitleHints)).sort((a, b) => a.localeCompare(b)),
    installSources: uniqStrings(Array.from(acc.installSources)).sort((a, b) => a.localeCompare(b)),
    launchMethods,
    lastScannedAt: generatedAt,
  };
}

async function scanInstalledAppsFromWindows(): Promise<InstalledAppInventory> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$items = New-Object System.Collections.Generic.List[object]
$wsh = $null
try { $wsh = New-Object -ComObject WScript.Shell } catch {}

function Add-ItemRow {
  param(
    [string]$SourceType,
    [string]$DisplayName,
    [string]$AppId,
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$Arguments,
    [string]$Description,
    [string]$WorkingDirectory,
    [string]$PackageFamilyName
  )
  if ([string]::IsNullOrWhiteSpace($DisplayName) -and [string]::IsNullOrWhiteSpace($AppId) -and [string]::IsNullOrWhiteSpace($TargetPath) -and [string]::IsNullOrWhiteSpace($ShortcutPath)) {
    return
  }
  $items.Add([PSCustomObject]@{
    sourceType = $SourceType
    displayName = $DisplayName
    appId = $AppId
    shortcutPath = $ShortcutPath
    targetPath = $TargetPath
    arguments = $Arguments
    description = $Description
    workingDirectory = $WorkingDirectory
    packageFamilyName = $PackageFamilyName
  }) | Out-Null
}

try {
  Get-StartApps | Sort-Object Name | ForEach-Object {
    $pkg = $null
    if ([string]$_.AppID -match '!') { $pkg = ([string]$_.AppID -split '!')[0] }
    Add-ItemRow -SourceType 'start_app' -DisplayName ([string]$_.Name) -AppId ([string]$_.AppID) -PackageFamilyName $pkg
  }
} catch {}

$startMenuRoots = @(
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

if ($wsh) {
  foreach ($root in $startMenuRoots) {
    Get-ChildItem -LiteralPath $root -Filter *.lnk -File -Recurse | ForEach-Object {
      try {
        $shortcut = $wsh.CreateShortcut($_.FullName)
        Add-ItemRow -SourceType 'start_menu_shortcut' -DisplayName ([System.IO.Path]::GetFileNameWithoutExtension($_.Name)) -ShortcutPath $_.FullName -TargetPath ([string]$shortcut.TargetPath) -Arguments ([string]$shortcut.Arguments) -Description ([string]$shortcut.Description) -WorkingDirectory ([string]$shortcut.WorkingDirectory)
      } catch {}
    }
  }
}

$appPathRoots = @(
  'Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths'
)

foreach ($root in $appPathRoots) {
  Get-ChildItem -LiteralPath $root | ForEach-Object {
    try {
      $props = Get-ItemProperty -LiteralPath $_.PSPath
      $target = $props.'(default)'
      if (-not $target) { $target = $props.'(Default)' }
      if ($target) {
        Add-ItemRow -SourceType 'app_paths' -DisplayName ([System.IO.Path]::GetFileNameWithoutExtension([string]$_.PSChildName)) -TargetPath ([string]$target)
      }
    } catch {}
  }
}

$windowsAppsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\\WindowsApps'
if (Test-Path $windowsAppsDir) {
  Get-ChildItem -LiteralPath $windowsAppsDir -Filter *.exe -File | ForEach-Object {
    Add-ItemRow -SourceType 'windows_apps_alias' -DisplayName ([System.IO.Path]::GetFileNameWithoutExtension($_.Name)) -TargetPath $_.FullName
  }
}

function Add-ExecutablesFromDir {
  param([string]$DirPath, [string]$SourceType)
  if (-not (Test-Path $DirPath)) { return }
  Get-ChildItem -LiteralPath $DirPath -Filter *.exe -File | ForEach-Object {
    Add-ItemRow -SourceType $SourceType -DisplayName ([System.IO.Path]::GetFileNameWithoutExtension($_.Name)) -TargetPath $_.FullName
  }
}

$installRoots = @(
  (Join-Path $env:LOCALAPPDATA 'Programs'),
  $env:ProgramFiles,
  ([Environment]::GetFolderPath('ProgramFilesX86'))
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

foreach ($root in $installRoots) {
  Add-ExecutablesFromDir -DirPath $root -SourceType 'install_root'
  Get-ChildItem -LiteralPath $root -Directory | ForEach-Object {
    Add-ExecutablesFromDir -DirPath $_.FullName -SourceType 'install_dir'
    Get-ChildItem -LiteralPath $_.FullName -Directory | ForEach-Object {
      Add-ExecutablesFromDir -DirPath $_.FullName -SourceType 'install_dir'
    }
  }
}

[PSCustomObject]@{
  generatedAt = [int64][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  items = $items
} | ConvertTo-Json -Depth 6 -Compress
`;

  const raw = await runPowerShell(script);
  const parsed = parseJsonMaybe(raw) || {};
  const generatedAt = Math.floor(Number(parsed.generatedAt) || Date.now() / 1000) * 1000;
  const items = Array.isArray(parsed.items) ? parsed.items as RawInstalledAppItem[] : [];
  const aliasStore = loadAliasStore();
  const keyToAccumulator = new Map<string, InstalledAppAccumulator>();
  const accumulators: InstalledAppAccumulator[] = [];

  for (const item of items) {
    const acc = createAccumulatorFromRaw(item);
    if (!acc) continue;
    const keys = mergeCandidateKeys(acc);
    let target = keys.map((key) => keyToAccumulator.get(key)).find(Boolean) || null;
    if (!target) {
      target = acc;
      accumulators.push(target);
    } else {
      mergeAccumulator(target, acc);
    }
    for (const key of mergeCandidateKeys(target)) {
      keyToAccumulator.set(key, target);
    }
  }

  const apps = accumulators
    .map((acc) => finalizeAccumulator(acc, generatedAt, aliasStore))
    .filter((app) => app.displayName && app.launchMethods.length > 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { generatedAt, apps };
}

function inventoryNeedsRefresh(inventory: InstalledAppInventory | null, maxAgeMs: number): boolean {
  if (!inventory || !Array.isArray(inventory.apps)) return true;
  const generatedAt = Math.floor(Number(inventory.generatedAt) || 0);
  if (generatedAt <= 0) return true;
  return Date.now() - generatedAt > maxAgeMs;
}

export function invalidateInstalledAppsCache(): void {
  const file = getInventoryCachePath();
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

export async function getInstalledAppsInventory(options?: InventoryOptions): Promise<InstalledAppInventory> {
  const refresh = options?.refresh === true;
  const maxAgeMs = Math.max(60_000, Math.floor(Number(options?.maxAgeMs || DEFAULT_CACHE_MAX_AGE_MS)));
  const cached = loadInventoryCache();
  if (!refresh && !inventoryNeedsRefresh(cached, maxAgeMs)) {
    return cached as InstalledAppInventory;
  }
  const fresh = await scanInstalledAppsFromWindows();
  saveInventoryCache(fresh);
  return fresh;
}

export async function getInstalledAppById(appId: string, options?: InventoryOptions): Promise<InstalledAppRecord | null> {
  const clean = String(appId || '').trim();
  if (!clean) return null;
  const inventory = await getInstalledAppsInventory(options);
  let app = inventory.apps.find((row) => row.id === clean) || null;
  if (!app && !options?.refresh) {
    app = (await getInstalledAppsInventory({ ...options, refresh: true })).apps.find((row) => row.id === clean) || null;
  }
  return app;
}

function scoreInstalledApp(app: InstalledAppRecord, query: string): { score: number; matchedOn: string[] } {
  const cleanQuery = normalizeLookupText(query);
  if (!cleanQuery) return { score: 0, matchedOn: [] };
  const queryTokens = cleanQuery.split(/\s+/).filter(Boolean);
  const matchedOn = new Set<string>();
  let score = 0;

  const checkValue = (value: string, label: string, weights: { exact: number; starts: number; contains: number; token: number }) => {
    const cleanValue = normalizeLookupText(value);
    if (!cleanValue) return;
    if (cleanValue === cleanQuery) {
      score += weights.exact;
      matchedOn.add(`${label}:exact`);
      return;
    }
    if (cleanValue.startsWith(cleanQuery)) {
      score += weights.starts;
      matchedOn.add(`${label}:prefix`);
    }
    if (cleanValue.includes(cleanQuery)) {
      score += weights.contains;
      matchedOn.add(`${label}:contains`);
    }
    const valueTokens = cleanValue.split(/\s+/).filter(Boolean);
    const tokenHits = queryTokens.filter((token) => valueTokens.some((valueToken) => valueToken === token || valueToken.startsWith(token))).length;
    if (tokenHits > 0) {
      score += tokenHits * weights.token;
      matchedOn.add(`${label}:token`);
    }
  };

  checkValue(app.displayName, 'name', { exact: 900, starts: 650, contains: 420, token: 110 });
  for (const alias of app.aliases) checkValue(alias, 'alias', { exact: 800, starts: 520, contains: 320, token: 90 });
  for (const proc of app.processNameHints) checkValue(proc, 'process', { exact: 760, starts: 500, contains: 280, token: 80 });
  for (const title of app.windowTitleHints) checkValue(title, 'title', { exact: 680, starts: 450, contains: 260, token: 70 });
  if (app.executablePath) checkValue(path.parse(app.executablePath).name, 'exe', { exact: 720, starts: 480, contains: 300, token: 85 });
  if (app.shortcutPath) checkValue(path.parse(app.shortcutPath).name, 'shortcut', { exact: 640, starts: 420, contains: 240, token: 60 });

  if (app.launchMethods.some((method) => method.type === 'shortcut')) score += 18;
  if (app.launchMethods.some((method) => method.type === 'exe')) score += 12;
  if (app.appUserModelId) score += 8;

  return { score, matchedOn: Array.from(matchedOn) };
}

export async function searchInstalledApps(query: string, options?: { limit?: number; refresh?: boolean }): Promise<InstalledAppSearchResult[]> {
  const clean = String(query || '').trim();
  if (!clean) return [];
  const inventory = await getInstalledAppsInventory({ refresh: options?.refresh });
  const limit = Math.min(Math.max(Number(options?.limit || 10) || 10, 1), 100);
  return inventory.apps
    .map((app) => {
      const rank = scoreInstalledApp(app, clean);
      return {
        ...app,
        score: rank.score,
        matchedOn: rank.matchedOn,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}

export async function listInstalledApps(filter: string = '', options?: { limit?: number; refresh?: boolean }): Promise<InstalledAppRecord[]> {
  const limit = Math.min(Math.max(Number(options?.limit || 50) || 50, 1), 500);
  const query = String(filter || '').trim();
  if (query) {
    return (await searchInstalledApps(query, { limit, refresh: options?.refresh })).map(({ score: _score, matchedOn: _matchedOn, ...app }) => app);
  }
  const inventory = await getInstalledAppsInventory({ refresh: options?.refresh });
  return inventory.apps.slice(0, limit);
}

function chooseLaunchMethod(app: InstalledAppRecord): InstalledAppLaunchMethod | null {
  if (!app.launchMethods.length) return null;
  return (
    app.launchMethods.find((method) => method.type === 'shortcut')
    || app.launchMethods.find((method) => method.type === 'exe')
    || app.launchMethods.find((method) => method.type === 'aumid')
    || null
  );
}

export async function resolveInstalledAppLaunch(appId: string): Promise<{ app: InstalledAppRecord; method: InstalledAppLaunchMethod } | null> {
  const app = await getInstalledAppById(appId);
  if (!app) return null;
  const method = chooseLaunchMethod(app);
  if (!method) return null;
  return { app, method };
}

export async function resolveInstalledAppLaunchByQuery(query: string): Promise<{ app: InstalledAppRecord; method: InstalledAppLaunchMethod } | null> {
  const matches = await searchInstalledApps(query, { limit: 3 });
  if (!matches.length) return null;
  const [top, second] = matches;
  const queryNorm = normalizeLookupText(query);
  const topExact = normalizeLookupText(top.displayName) === queryNorm || top.aliases.some((alias) => normalizeLookupText(alias) === queryNorm);
  if (!topExact && second && top.score < second.score + 180) {
    return null;
  }
  if (!topExact && top.score < 760) {
    return null;
  }
  const method = chooseLaunchMethod(top);
  if (!method) return null;
  return { app: top, method };
}

export function listInstalledAppAliases(): InstalledAppAliasStore {
  return loadAliasStore();
}

export async function saveInstalledAppAlias(appId: string, alias: string): Promise<InstalledAppRecord | null> {
  const cleanAppId = String(appId || '').trim();
  const cleanAlias = String(alias || '').trim();
  if (!cleanAppId || !cleanAlias) throw new Error('appId and alias are required.');
  const store = loadAliasStore();
  const next = uniqStrings([...(store[cleanAppId] || []), cleanAlias]);
  store[cleanAppId] = next;
  saveAliasStore(store);
  invalidateInstalledAppsCache();
  return getInstalledAppById(cleanAppId, { refresh: true });
}

export async function deleteInstalledAppAlias(appId: string, alias: string): Promise<InstalledAppRecord | null> {
  const cleanAppId = String(appId || '').trim();
  const cleanAlias = String(alias || '').trim();
  if (!cleanAppId || !cleanAlias) throw new Error('appId and alias are required.');
  const store = loadAliasStore();
  const aliases = (store[cleanAppId] || []).filter((entry) => entry.toLowerCase() !== cleanAlias.toLowerCase());
  if (aliases.length > 0) store[cleanAppId] = aliases;
  else delete store[cleanAppId];
  saveAliasStore(store);
  invalidateInstalledAppsCache();
  return getInstalledAppById(cleanAppId, { refresh: true });
}
