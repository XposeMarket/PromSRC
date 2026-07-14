import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('workspace/skills/.manifests');
const upstream = [
  'embedded-captions', 'faceless-explainer', 'figma', 'general-video', 'hyperframes',
  'hyperframes-animation', 'hyperframes-core', 'hyperframes-creative', 'hyperframes-keyframes',
  'hyperframes-cli', 'hyperframes-registry', 'media-use', 'motion-graphics', 'music-to-video',
  'pr-to-video', 'product-launch-video', 'remotion-to-hyperframes', 'slideshow',
  'talking-head-recut', 'website-to-video',
];

function merge(id, patch) {
  const file = path.join(root, `${id}.skill.json`);
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
}

for (const id of upstream) {
  merge(id, {
    ownership: 'upstream-managed',
    implicitInvocation: false,
    status: id === 'hyperframes-cli' || id === 'hyperframes-registry' ? 'needs_setup' : 'ready',
    health: id === 'hyperframes-cli' || id === 'hyperframes-registry'
      ? {
          state: 'partial',
          reason: 'Prometheus retained its existing integration copy while the current official upstream version is staged for a controlled merge.',
          verifiedCapabilities: ['official_skill_installed_in_codex', 'prometheus_integration_reference'],
          blockedCapabilities: { upstream_merge: 'Merge current official references without discarding Prometheus-specific Creative Mode behavior.' },
          lastVerified: '2026-07-11',
        }
      : {
          state: 'ready',
          reason: 'Official skill pinned from heygen-com/hyperframes and restricted to explicit specialist selection by the Creative Director.',
          verifiedCapabilities: ['official_upstream_skill'],
          blockedCapabilities: {},
          lastVerified: '2026-07-11',
        },
  });
}

merge('prometheus-creative-director', {
  schemaVersion: 'prometheus-skill-bundle-v1',
  id: 'prometheus-creative-director',
  entrypoint: 'SKILL.md',
  categories: ['creative', 'video', 'orchestration'],
  triggers: [
    'make a complete video', 'create a finished video', 'produce a promo video',
    'build an explainer video', 'edit this video project', 'create a social video',
    'make a product launch video', 'produce motion graphics', 'create a music video',
    'build a video in creative mode', 'full video production', 'assemble a video timeline',
  ],
  requiredTools: ['creative'],
  status: 'ready',
  implicitInvocation: true,
  lifecycle: 'active',
  health: { state: 'ready', reason: 'Routes Creative Mode and official HyperFrames specialists without broad multi-skill loading.', verifiedCapabilities: ['creative_tool_routing', 'hyperframes_specialist_routing'], blockedCapabilities: {}, lastVerified: '2026-07-11' },
});

merge('prometheus-hyperframes-bridge', {
  schemaVersion: 'prometheus-skill-bundle-v1',
  id: 'prometheus-hyperframes-bridge',
  entrypoint: 'SKILL.md',
  categories: ['creative', 'video', 'hyperframes', 'integration'],
  triggers: ['use hyperframes in creative mode', 'import hyperframes into prometheus', 'hyperframes creative mode bridge', 'edit hyperframes on the prometheus timeline'],
  requiredTools: ['creative'],
  status: 'ready',
  implicitInvocation: false,
  lifecycle: 'active',
  health: { state: 'ready', reason: 'Maps official HyperFrames authoring to Prometheus Creative Mode tools and ownership boundaries.', verifiedCapabilities: ['tool_crosswalk', 'hybrid_workflow'], blockedCapabilities: {}, lastVerified: '2026-07-11' },
});

console.log(`Applied routing policy to ${upstream.length} official skills and 2 Prometheus integration skills.`);
