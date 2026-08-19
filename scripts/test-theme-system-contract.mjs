import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'..');
const manifestPath=path.join(ROOT,'web-ui/src/theme-manifest.js');
const source=fs.readFileSync(manifestPath,'utf8');
const manifest=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const ids=manifest.THEME_PRESETS.map((theme)=>theme.id);
assert.deepEqual(ids,['light','gray','dark','blue','purple']);assert.equal(new Set(ids).size,ids.length);assert.equal(manifest.THEME_SCHEMA_VERSION,2);
for(const theme of manifest.THEME_PRESETS){
  assert.equal(theme.base,'dark');
  for(const key of ['background','backgroundSoft','surface','surfaceStrong','text','textMuted','border','borderStrong','accent','accentStrong','accentLight']) assert.ok(theme.colors[key],`${theme.id}: ${key}`);
  for(const key of ['background','surface','surfaceStrong','text','textMuted','accent','accentStrong']) assert.ok(theme.mobile[key],`${theme.id} mobile: ${key}`);
}
const imported=manifest.normalizeTheme({id:'Tokyo Night Example',colors:{background:'#1a1b26',text:'#c0caf5',accent:'#7aa2f7'}});
assert.equal(imported.id,'tokyo-night-example');assert.equal(imported.legacyProfile,'custom');
const vars=manifest.toLegacyVariables(imported);for(const key of ['--bg','--panel','--text','--brand','--composer-bg','--pm-bg','--pm-surface','--pm-text','--pm-accent']) assert.ok(vars[key],key);
const index=fs.readFileSync(path.join(ROOT,'web-ui/index.html'),'utf8');
const bootstrap=index.match(/window\.PROM_THEMES\s*=\s*\[([\s\S]*?)\n\s*\];/);assert.ok(bootstrap,'bootstrap registry');
const bootstrapIds=[...bootstrap[1].matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((match)=>match[1]);assert.deepEqual(bootstrapIds,ids,'bootstrap/manifest drift');
const themesCss=fs.readFileSync(path.join(ROOT,'web-ui/src/styles/themes.css'),'utf8');const mobileCss=fs.readFileSync(path.join(ROOT,'web-ui/src/styles/mobile.css'),'utf8');
for(const value of ['--bg: #050505','--bg: #2e2e2e','--bg: #07101f','--bg: #0c0518']) assert.ok(themesCss.includes(value),`desktop fingerprint ${value}`);
for(const value of ['--pm-bg:            #122444','--pm-bg:            #1e1138','--pm-bg:            #2e2e2e']) assert.ok(mobileCss.includes(value),`mobile fingerprint ${value}`);
for(const file of ['theme-manifest.js','theme-appearance.js','theme-runtime.js','performance.js']){
  const a=fs.readFileSync(path.join(ROOT,'web-ui/src',file),'utf8');const b=fs.readFileSync(path.join(ROOT,'generated/public-web-ui/static',file),'utf8');assert.equal(b,a,`${file} generated mirror`);
}
assert.equal(fs.readFileSync(path.join(ROOT,'generated/public-web-ui/static/styles/theme-contract.css'),'utf8'),fs.readFileSync(path.join(ROOT,'web-ui/src/styles/theme-contract.css'),'utf8'));
console.log('[theme-system-contract] manifest, compatibility mapping, visual fingerprints, and generated mirrors are valid');
