import path from 'node:path';

export interface GatewayDataDirOptions {
  installRoot: string;
  requestedDataDir?: string;
  selectedPort?: number;
  primaryInstance?: boolean;
  canonicalDevInstance?: boolean;
  newInstance?: boolean;
  autoInstance?: boolean;
  preferredPort?: number;
}

/** Resolve a gateway data root without mixing primary and isolated instances. */
export function resolveGatewayDataDir(options: GatewayDataDirOptions): string | undefined {
  const installRoot = path.resolve(options.installRoot);

  if (options.primaryInstance) {
    return path.resolve(options.requestedDataDir || installRoot);
  }

  const needsIsolatedData = options.canonicalDevInstance
    || options.newInstance
    || (options.autoInstance && options.selectedPort !== options.preferredPort);
  if (!options.requestedDataDir && !needsIsolatedData) return undefined;

  const dataRoot = path.resolve(options.requestedDataDir || installRoot);
  if (options.requestedDataDir || !options.selectedPort) return dataRoot;
  return path.join(dataRoot, '.prometheus-instances', `port-${options.selectedPort}`);
}
