// Test fixture for gateway-restart-outcome.regression.ts. It deliberately
// reproduces the old broadcaster.ts pattern: a dynamic import() of lifecycle
// from a NON-entry module, which under tsx source mode evaluates a second
// lifecycle instance. Fixtures are excluded from the stateful-dynamic-import
// guard; product code must use require() or a static import instead.
export async function loadLifecycleDynamically(): Promise<any> {
  return import('../../lifecycle.js');
}
