'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const RESOURCES_DIR = path.join(ROOT, 'release-public', 'win-unpacked', 'resources');
const ASAR_PATH = path.join(RESOURCES_DIR, 'app.asar');

const BANNED_PATTERNS = [
  /^workspace(?:\/|$)/,
  /^\.prometheus(?:\/|$)/,
  /^teams(?:\/|$)/,
  /^src(?:\/|$)/,
  /^web-ui(?:\/|$)/,
  /^scripts(?:\/|$)/,
  /^bin(?:\/|$)/,
  /^\.git(?:\/|$)/,
  /^\.claude(?:\/|$)/,
  /^\.cursor(?:\/|$)/,
  /^\.vscode(?:\/|$)/,
  /^\.pip-cache(?:\/|$)/,
  /^\.pip-tmp(?:\/|$)/,
  /^\.tmp-py(?:\/|$)/,
  /^release(?:\/|$)/,
  /^release-public(?:\/|$)/,
  /^output(?:\/|$)/,
  /^tmp(?:\/|$)/,
  /(?:^|\/)downloads(?:\/|$)/,
  /(?:^|\/)uploads(?:\/|$)/,
  /(?:^|\/)node_modules\/(?:electron|electron-builder|typescript|eslint|tsx)(?:\/|$)/,
  /\.(?:log|docx|zip|mp4)$/i,
  /(?:^|\/)eng\.traineddata$/i,
  /(?:^|\/)(?:CIS|Context|PROPOSALS_ANALYSIS|Prometheus_CIS_Plan|Prometheus_Teams_CIS_Master_Plan|prometheus_browser_intelligence)(?:\.md|\.docx)?$/i,
  /(?:^|\/)(?:apply-local-llm-patch|b5-server-v2|write-chat-helpers|patch-server-v2|rebrand-html|rebrand-src|test-ollama|check-build|start-gateway)\.(?:js|mjs|bat)$/i,
];

function normalizeEntry(entry) {
  return String(entry).replace(/\\/g, '/').replace(/^\/+/, '');
}

function walk(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(fullPath, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function isBanned(entry) {
  const normalized = normalizeEntry(entry);
  return BANNED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function main() {
  if (!fs.existsSync(ASAR_PATH)) {
    throw new Error(`Public release app.asar not found: ${ASAR_PATH}`);
  }

  const appEntries = asar.listPackage(ASAR_PATH).map(normalizeEntry);
  const resourceEntries = walk(RESOURCES_DIR)
    .map(normalizeEntry)
    .filter((entry) => entry !== 'app.asar');

  const bannedAppEntries = appEntries.filter(isBanned);
  const bannedResourceEntries = resourceEntries.filter(isBanned);
  const banned = [
    ...bannedAppEntries.map((entry) => `app.asar:${entry}`),
    ...bannedResourceEntries.map((entry) => `resources:${entry}`),
  ];

  if (banned.length) {
    console.error('[verify-public-release] Found banned release contents:');
    for (const entry of banned.slice(0, 120)) console.error(`- ${entry}`);
    if (banned.length > 120) console.error(`...and ${banned.length - 120} more`);
    process.exit(1);
  }

  console.log(`[verify-public-release] OK: scanned ${appEntries.length} app.asar entries and ${resourceEntries.length} resource entries`);
}

main();
