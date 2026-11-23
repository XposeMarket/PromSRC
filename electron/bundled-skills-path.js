const path = require('node:path');

// Both inputs are release-filtered. Never fall back to the editable skill catalog.
function resolveSkillBundle(packaged, appRoot, resourcesPath) {
  return packaged ? path.join(resourcesPath, 'bundled-skills') : path.join(appRoot, 'generated', 'bundled-skills');
}
module.exports = { resolveSkillBundle };
