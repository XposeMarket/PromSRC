// Route-owned mobile stylesheet loader.
//
// mobile-data-base.js is data only. Styles are installed by the surface that
// owns them so secondary routes do not inherit chat-only late CSS by accident.
const STYLE_DEFINITIONS = Object.freeze({
  shell: Object.freeze([
    Object.freeze({
      id: 'pm-mobile-demo-glass-style',
      file: 'mobile-liquid-glass-demo.css',
      layer: 'shell',
      version: 'pm-v303-2026-08-23-aug12-glass-crosscheck',
      attribute: 'data-prom-mobile-demo-glass-style',
      query: 'drawer-tabs=white-v1',
    }),
  ]),
  chat: Object.freeze([
    Object.freeze({
      id: 'pm-mobile-composer-stack-style',
      file: 'mobile-composer-stack.css',
      layer: 'components',
      version: 'pm-v305-2026-08-24-background-agent-polish',
      attribute: 'data-prom-mobile-composer-stack-style',
    }),
  ]),
  voice: Object.freeze([
    Object.freeze({
      id: 'pm-mobile-voice-route-style',
      file: 'mobile-voice.css',
      layer: 'route',
      version: 'pm-v1-2026-08-24-route-owner',
      attribute: 'data-prom-mobile-voice-route-style',
    }),
  ]),
  settings: Object.freeze([
    Object.freeze({
      id: 'pm-mobile-settings-route-style',
      file: 'mobile-settings.css',
      layer: 'route',
      version: 'pm-v1-2026-08-24-route-owner',
      attribute: 'data-prom-mobile-settings-route-style',
    }),
  ]),
});

function styleRegistry() {
  if (typeof window === 'undefined') return null;
  const registry = window.__pmMobileStyleOwners || (window.__pmMobileStyleOwners = {
    owners: {},
    activations: [],
  });
  if (!registry.owners || typeof registry.owners !== 'object') registry.owners = {};
  if (!Array.isArray(registry.activations)) registry.activations = [];
  return registry;
}

function ensureStyle(owner, definition) {
  if (typeof document === 'undefined' || !definition) return null;
  let link = document.getElementById(definition.id);
  if (!link) {
    link = document.createElement('link');
    link.id = definition.id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  const query = definition.query ? `?v=${definition.version}&${definition.query}` : `?v=${definition.version}`;
  const relativeUrl = new URL(`../styles/${definition.file}${query}`, import.meta.url);
  // Source modules resolve next to web-ui/src/styles during development. The
  // production bundler moves this module into /build/chunks, while the
  // intentionally route-owned CSS remains an independently cacheable static
  // asset under /static/styles.
  if (relativeUrl.pathname.includes('/build/')) {
    relativeUrl.pathname = `/static/styles/${definition.file}`;
  }
  link.href = relativeUrl.href;
  link.dataset.promMobileStyleOwner = owner;
  if (definition.attribute) link.setAttribute(definition.attribute, '1');
  return link;
}

export function ensureMobileStyleOwner(owner) {
  const cleanOwner = String(owner || '').trim().toLowerCase();
  const definitions = STYLE_DEFINITIONS[cleanOwner];
  if (!definitions) return [];
  const links = definitions.map((definition) => ensureStyle(cleanOwner, definition)).filter(Boolean);
  const registry = styleRegistry();
  if (registry) {
    registry.owners[cleanOwner] = definitions.map((definition) => Object.freeze({
      id: definition.id,
      file: definition.file,
      layer: definition.layer,
    }));
    registry.activations.push({ owner: cleanOwner, at: Date.now(), count: links.length });
    if (registry.activations.length > 40) registry.activations.splice(0, registry.activations.length - 40);
  }
  if (typeof document !== 'undefined') {
    document.body?.setAttribute('data-pm-mobile-route-owner', cleanOwner);
  }
  return links;
}

export function ensureMobileShellStyles() {
  return ensureMobileStyleOwner('shell');
}

export function ensureMobileChatStyles() {
  return ensureMobileStyleOwner('chat');
}

export function ensureMobileVoiceStyles() {
  return ensureMobileStyleOwner('voice');
}

export function ensureMobileSettingsStyles() {
  return ensureMobileStyleOwner('settings');
}

export function mobileStyleOwnerDefinitions() {
  return STYLE_DEFINITIONS;
}
