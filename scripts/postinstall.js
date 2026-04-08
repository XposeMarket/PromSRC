/**
 * scripts/postinstall.js
 *
 * Runs automatically after `npm install` via the "postinstall" package.json hook.
 * Also called explicitly by the Electron first-run setup in main.js.
 *
 * Ensures all document skill runtime dependencies are installed:
 *   mammoth   — DOCX reading
 *   docx      — DOCX writing
 *   pdf-parse — PDF text extraction
 *   xlsx      — Excel read/write (SheetJS)
 *
 * playwright and tesseract.js are already in package.json dependencies
 * and will be installed by the normal `npm install` — no action needed here.
 *
 * Safe to run multiple times — checks before installing.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT     = path.join(__dirname, '..');
const NM       = path.join(ROOT, 'node_modules');
const PACKAGES = ['mammoth', 'docx', 'pdf-parse', 'xlsx'];

const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const dim    = (s) => `\x1b[2m${s}\x1b[0m`;

function isInstalled(pkg) {
  try {
    require.resolve(path.join(NM, pkg, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

function installPackage(pkg) {
  // First attempt with offline cache preference (faster for subsequent installs)
  try {
    execSync(`npm install ${pkg} --save --prefer-offline --no-audit --no-fund`, {
      cwd: ROOT, stdio: 'pipe',
    });
    return true;
  } catch {
    // Second attempt — full network install
    try {
      execSync(`npm install ${pkg} --save --no-audit --no-fund`, {
        cwd: ROOT, stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }
}

function run() {
  console.log('\n' + dim('─'.repeat(52)));
  console.log('  Prometheus — document skill dependency check');
  console.log(dim('─'.repeat(52)));

  const missing = PACKAGES.filter(p => !isInstalled(p));
  const present = PACKAGES.filter(p =>  isInstalled(p));

  present.forEach(p => console.log(`  ${green('✓')} ${p}`));

  if (!missing.length) {
    console.log(`\n  ${green('All document skill packages present.')}`);
    console.log(dim('─'.repeat(52)) + '\n');
    return;
  }

  console.log(`\n  ${yellow('Installing:')} ${missing.join(', ')}`);
  console.log(dim('  (runs once — subsequent launches are instant)\n'));

  const failed = [];
  for (const pkg of missing) {
    process.stdout.write(`  Installing ${pkg}...`);
    if (installPackage(pkg)) {
      console.log(` ${green('done')}`);
    } else {
      console.log(` ${red('FAILED')}`);
      failed.push(pkg);
    }
  }

  if (failed.length) {
    console.warn(`\n  ${yellow('Warning:')} could not install: ${failed.join(', ')}`);
    console.warn('  Fix manually: npm install ' + failed.join(' '));
  } else {
    console.log(`\n  ${green('All packages installed.')}`);
  }

  console.log(dim('─'.repeat(52)) + '\n');
}

run();
