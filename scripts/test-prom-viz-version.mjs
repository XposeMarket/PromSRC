// Guards the Viz Kit cache-bust: the iframe loads /vendor/prom-viz/prom-viz.js?v=<PROM_VIZ_VERSION>
// with a 24h cache, so the query key must equal the kit's own version string.
import fs from 'node:fs';

const kit = fs.readFileSync('web-ui/vendor/prom-viz/prom-viz.js', 'utf8');
const utils = fs.readFileSync('web-ui/src/utils.js', 'utf8');
const kitVersion = (/version:\s*'([^']+)'/.exec(kit) || [])[1];
const busted = (/const PROM_VIZ_VERSION = '([^']+)'/.exec(utils) || [])[1];
const usesKey = utils.includes('prom-viz.js?v=${PROM_VIZ_VERSION}');

if (!kitVersion || !busted || !usesKey || kitVersion !== busted) {
  console.error(`[test-prom-viz-version] FAIL kit=${kitVersion} utils=${busted} usesKey=${usesKey}. Bump PROM_VIZ_VERSION in web-ui/src/utils.js whenever prom-viz.js version changes.`);
  process.exit(1);
}
console.log(`[test-prom-viz-version] ok ${kitVersion}`);
