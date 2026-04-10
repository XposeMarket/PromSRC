const fs = require('fs');
const path = require('path');

function patchBetterSqlite3ForElectron33() {
  const bindingGypPath = path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'binding.gyp');
  if (!fs.existsSync(bindingGypPath)) {
    console.log('[patch-electron-native-deps] better-sqlite3 binding.gyp not found, skipping');
    return;
  }

  const original = fs.readFileSync(bindingGypPath, 'utf-8');
  const patched = original
    .replace(/-std=c\+\+17/g, '-std=c++20')
    .replace(/\/std:c\+\+17/g, '/std:c++20');

  if (patched === original) {
    console.log('[patch-electron-native-deps] better-sqlite3 already patched for C++20');
    return;
  }

  fs.writeFileSync(bindingGypPath, patched, 'utf-8');
  console.log('[patch-electron-native-deps] Updated better-sqlite3 binding.gyp to C++20');
}

patchBetterSqlite3ForElectron33();
