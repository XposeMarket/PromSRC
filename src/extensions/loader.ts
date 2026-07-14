import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseExtensionDescriptor } from './schema.js';
import type { LoadedExtensionDescriptor } from './types.js';

export const EXTENSION_DESCRIPTOR_FILENAME = 'prometheus.extension.json';

function walkForDescriptorFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.isFile() && entry.name === EXTENSION_DESCRIPTOR_FILENAME) {
        files.push(abs);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

export function resolveUserPluginsDir(): string {
  // Keep extension discovery independent from ConfigManager initialization;
  // config itself consults provider extension manifests during startup.
  const projectConfig = path.join(__dirname, '..', '..', '.prometheus');
  const configDir = process.env.PROMETHEUS_DATA_DIR
    ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus')
    : fs.existsSync(projectConfig) ? projectConfig : path.join(os.homedir(), '.prometheus');
  return path.join(configDir, 'user-plugins');
}

export function loadUserExtensionDescriptors(): LoadedExtensionDescriptor[] {
  const userDir = resolveUserPluginsDir();
  const descriptorFiles = walkForDescriptorFiles(userDir);
  return descriptorFiles.map((sourcePath) => {
    const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    const descriptor = parseExtensionDescriptor(raw, sourcePath);
    return { ...descriptor, sourcePath };
  });
}

export function resolveBundledExtensionsDir(): string {
  return path.join(__dirname, 'bundled');
}

export function loadBundledExtensionDescriptors(): LoadedExtensionDescriptor[] {
  const bundledDir = resolveBundledExtensionsDir();
  const descriptorFiles = walkForDescriptorFiles(bundledDir);

  return descriptorFiles.map((sourcePath) => {
    const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    const descriptor = parseExtensionDescriptor(raw, sourcePath);
    return { ...descriptor, sourcePath };
  });
}
