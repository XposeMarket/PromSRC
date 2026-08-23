const featurePromises = new Map();

function load(name, importer) {
  if (!featurePromises.has(name)) {
    featurePromises.set(name, importer().catch((error) => {
      featurePromises.delete(name);
      throw error;
    }));
  }
  return featurePromises.get(name);
}

export function loadProcessRunCards() {
  return load('process-run-cards', () => import('../../../components/ProcessRunCard.js'));
}

export function loadCodingDiffRenderer() {
  return load('coding-diff', () => import('../../../components/coding-diff.js'));
}

export function loadSourcePanelEnvironment() {
  return load('source-environment', () => import('../../../source-panel-environment.mjs'));
}

export function optionalChatDetailState() {
  return Object.freeze({ loadedOrLoading: Object.freeze([...featurePromises.keys()].sort()) });
}
