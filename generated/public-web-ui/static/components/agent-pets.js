/**
 * Agent pixel pets: one tiny sprite identity for every agent surface
 * (desktop Subagents/Teams, mobile tiles/chips, sidebar, voice).
 * Pure ES module: no DOM, no network, no assets. Safe in desktop, mobile and node tests.
 *
 * Grid chars: . transparent | o outline | k eye | w white | b body | s shade | a accent
 */
const OUTLINE = '#1f2128';
const EYE = '#15161a';
const WHITE = '#ffffff';
const GRID = 12;

export const AGENT_PETS = Object.freeze([
  { id: 'byte', name: 'Byte', colors: { b: '#c9ced6', s: '#9aa1ad', a: '#5eead4' }, grid: [
    '.....aa.....',
    '.....oo.....',
    '..oooooooo..',
    '.obbbbbbbbo.',
    '.obkkbbkkbo.',
    '.obkwbbkwbo.',
    '.obbbbbbbbo.',
    '.obbsaasbbo.',
    '.osbbbbbbso.',
    '..oooooooo..',
    '...os..so...',
    '...oo..oo...'] },
  { id: 'ember', name: 'Ember', colors: { b: '#f2994a', s: '#c8602a', a: '#ffd36b' }, grid: [
    '.....oo.....',
    '....oaao....',
    '...oaaaao...',
    '..oabaabao..',
    '..obbbbbbo..',
    '.obbbbbbbbo.',
    '.obkbbbbkbo.',
    '.obkbbbbkbo.',
    '.osbbaabbso.',
    '..osbbbbso..',
    '...oossoo...',
    '....oooo....'] },
  { id: 'hoot', name: 'Hoot', colors: { b: '#9a7656', s: '#74563b', a: '#f4c95d' }, grid: [
    '..o......o..',
    '..oo....oo..',
    '..oboooobo..',
    '.obbbbbbbbo.',
    '.owwbbbbwwo.',
    '.owkbbbbkwo.',
    '.obbbaabbbo.',
    '.obsbbbbsbo.',
    '.obbsbbsbbo.',
    '..obbbbbbo..',
    '..oooooooo..',
    '...aa..aa...'] },
  { id: 'wisp', name: 'Wisp', colors: { b: '#a78bfa', s: '#7c5fd6', a: '#e9ddff' }, grid: [
    '....oooo....',
    '..ooaabboo..',
    '.oabbbbbbbo.',
    '.obbbbbbbbo.',
    'obbkbbbbkbbo',
    'obbkbbbbkbbo',
    'obbbbssbbbbo',
    'obbbbbbbbbbo',
    'osbbsbbsbbso',
    '.o.bo..ob.o.',
    '..o.o..o.o..',
    '............'] },
  { id: 'beetle', name: 'Beetle', colors: { b: '#ef6b5b', s: '#b8443a', a: '#ffb4a8' }, grid: [
    '...o....o...',
    '....o..o....',
    '...oooooo...',
    '..okwkkwko..',
    '.obbboobbbo.',
    'obkbboobbkbo',
    'obbbboobbbbo',
    'obbkboobkbbo',
    '.obbboobbbo.',
    '..obbbbbbo..',
    '.o.oooooo.o.',
    '............'] },
  { id: 'kit', name: 'Kit', colors: { b: '#f2994a', s: '#c8602a', a: '#fff1de' }, grid: [
    '.o........o.',
    '.oo......oo.',
    '.obo....obo.',
    '.obboooobbo.',
    '.obbbbbbbbo.',
    'obbkbbbbkbbo',
    'oaabbbbbbaao',
    '.oaaakkaaao.',
    '..oaaaaaao..',
    '...oobboo...',
    '..obbbbbbo..',
    '..oooooooo..'] },
  { id: 'ribbit', name: 'Ribbit', colors: { b: '#4ade80', s: '#22a35a', a: '#bbf7d0' }, grid: [
    '............',
    '.ooo....ooo.',
    'owkwo..owkwo',
    'obbbbbbbbbbo',
    'obbbbbbbbbbo',
    'obkbbbbbbkbo',
    'obbkkkkkkbbo',
    '.obaaaaaabo.',
    '.obaaaaaabo.',
    '..obbbbbbo..',
    '.oobo..oboo.',
    '............'] },
  { id: 'noir', name: 'Noir', colors: { b: '#4b5160', s: '#353a45', a: '#f4c95d' }, grid: [
    '.o........o.',
    '.oo......oo.',
    '.obo....obo.',
    '.obboooobbo.',
    '.obbbbbbbbo.',
    'obbaabbaabbo',
    'obbkabbakbbo',
    'obbbbssbbbbo',
    '.obbbbbbbbo.',
    '..oooooooo..',
    '..obo..obo..',
    '..oo....oo..'] },
  { id: 'mallow', name: 'Mallow', colors: { b: '#f5f0e6', s: '#d9cfbf', a: '#f9a8b8' }, grid: [
    '............',
    '...oooooo...',
    '..obbbbbbo..',
    '.obbbbbbbbo.',
    '.obkbbbbkbo.',
    '.obkbbbbkbo.',
    '.oabbkkbbao.',
    '.obbbbbbbbo.',
    '.osbbbbbbso.',
    '..osssssso..',
    '...oooooo...',
    '............'] },
  { id: 'pip', name: 'Pip', colors: { b: '#38bdf8', s: '#0e86b8', a: '#fbbf24' }, grid: [
    '.....oo.....',
    '....obbo....',
    '...obbbbo...',
    '..obbbbbbo..',
    '.obkbbbbkbo.',
    '.obbbaabbbo.',
    '.obbbbbbbbo.',
    'obbsbbbbsbbo',
    'osbbbbbbbbso',
    '.osbbbbbbso.',
    '..oooooooo..',
    '...aa..aa...'] },
  { id: 'shroom', name: 'Shroom', colors: { b: '#e8e2d4', s: '#c9bfa9', a: '#e05c5c' }, grid: [
    '....oooo....',
    '..ooaawaoo..',
    '.oaawaaaawo.',
    'oaaaaaaawaao',
    'oawaaaaaaaao',
    'oooooooooooo',
    '..obbbbbbo..',
    '..obkbbkbo..',
    '..obbbbbbo..',
    '..osbbbbso..',
    '...oooooo...',
    '............'] },
  { id: 'gloop', name: 'Gloop', colors: { b: '#60a5fa', s: '#2f6fc9', a: '#dbeafe' }, grid: [
    '............',
    '............',
    '.....oo.....',
    '....oabo....',
    '...oabbbo...',
    '..obbbbbbo..',
    '.obbkbbkbbo.',
    '.obbkbbkbbo.',
    'obbbbbbbbbbo',
    'obbbbssbbbbo',
    'osssssssssso',
    '.oooooooooo.'] },
]);

export const AGENT_PET_STATES = Object.freeze(['idle', 'working', 'done', 'failed', 'paused']);

const PET_BY_ID = new Map(AGENT_PETS.map((pet) => [pet.id, pet]));
const overrides = new Map(); // agentId -> explicit pet id, filled from /api/agents
const svgCache = new Map();

function hash(value) {
  let h = 5381;
  const s = String(value || '');
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function cleanId(value) {
  return String(value ?? '').trim().toLowerCase();
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function isAgentPetId(value) {
  return PET_BY_ID.has(cleanId(value));
}

/** Record explicit pets from an /api/agents list so id-only callers render the chosen pet. */
export function rememberAgentPets(agents) {
  for (const agent of Array.isArray(agents) ? agents : []) {
    const id = cleanId(agent?.id);
    if (!id) continue;
    const pet = cleanId(agent?.pet);
    if (pet && PET_BY_ID.has(pet)) overrides.set(id, pet);
    else overrides.delete(id);
  }
}

/** Accepts an agent object ({ id, pet }) or a bare agent id string. */
export function resolveAgentPetId(agent) {
  const id = cleanId(typeof agent === 'string' ? agent : agent?.id);
  const explicit = typeof agent === 'object' && agent ? cleanId(agent.pet) : '';
  if (explicit && PET_BY_ID.has(explicit)) return explicit;
  const remembered = overrides.get(id);
  if (remembered) return remembered;
  return AGENT_PETS[hash(id || 'agent') % AGENT_PETS.length].id;
}

/** The pet an agent gets when no pet is set (what "Auto" shows). */
export function autoAgentPetId(agentId) {
  return AGENT_PETS[hash(cleanId(agentId) || 'agent') % AGENT_PETS.length].id;
}

export function getAgentPet(agent) {
  return PET_BY_ID.get(resolveAgentPetId(agent));
}

function fillFor(pet, ch) {
  if (ch === 'o') return OUTLINE;
  if (ch === 'k') return EYE;
  if (ch === 'w') return WHITE;
  return pet.colors[ch] || pet.colors.b;
}

function petSvgBody(pet) {
  if (svgCache.has(pet.id)) return svgCache.get(pet.id);
  let out = '';
  pet.grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') { x++; continue; }
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      out += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${fillFor(pet, ch)}"/>`;
      x = end;
    }
  });
  svgCache.set(pet.id, out);
  return out;
}

/** Agent run record -> pet state. Only uses fields that exist; unknown shapes are idle. */
export function agentPetStateFromRun(agent) {
  const run = agent?.lastRun;
  if (run?.inProgress) return 'working';
  if (agent?.paused === true || agent?.manager?.paused === true) return 'paused';
  const status = cleanId(run?.status);
  if (run?.error || status === 'failed' || status === 'error') return 'failed';
  return 'idle';
}

export function renderAgentPet(agent, { size = 24, state = 'idle', title = '', className = '' } = {}) {
  const pet = getAgentPet(agent);
  const px = Math.max(12, Math.min(96, Math.round(Number(size) || 24)));
  const st = AGENT_PET_STATES.includes(state) ? state : 'idle';
  const label = title || (typeof agent === 'object' && agent?.name) || pet.name;
  const extra = className ? ` ${esc(className)}` : '';
  return `<span class="agent-pet agent-pet--${st}${extra}" data-pet="${pet.id}" style="--agent-pet-size:${px}px" role="img" aria-label="${esc(label)}">`
    + `<svg width="${px}" height="${px}" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${petSvgBody(pet)}</svg></span>`;
}

/** Overlapping crew stack (team tiles, rows). */
export function renderAgentPetStack(agents, { size = 16, max = 5 } = {}) {
  const list = (Array.isArray(agents) ? agents : []).filter(Boolean);
  const shown = list.slice(0, Math.max(1, max));
  const more = list.length - shown.length;
  return `<span class="agent-pet-stack" style="--agent-pet-size:${size}px">${shown.map((a) => renderAgentPet(a, { size })).join('')}`
    + `${more > 0 ? `<span class="agent-pet-stack-more">+${more}</span>` : ''}</span>`;
}

/** Shared picker markup. Buttons carry data-agent-pet-choice ("" = Auto). Callers wire clicks + save. */
export function renderAgentPetPickerHtml(agent, { size = 32 } = {}) {
  const agentId = typeof agent === 'string' ? agent : agent?.id;
  const explicit = typeof agent === 'object' && agent ? cleanId(agent.pet) : (overrides.get(cleanId(agentId)) || '');
  const hasExplicit = PET_BY_ID.has(explicit);
  const cell = (choice, petId, label, on) => `<button type="button" class="agent-pet-choice${on ? ' is-selected' : ''}" data-agent-pet-choice="${choice}" aria-pressed="${on}">`
    + `${renderAgentPet({ id: agentId, pet: petId }, { size, title: label })}<span class="agent-pet-choice-label">${esc(label)}</span></button>`;
  return `<div class="agent-pet-picker" role="group" aria-label="Choose a pet">`
    + cell('', autoAgentPetId(agentId), 'Auto', !hasExplicit)
    + AGENT_PETS.map((p) => cell(p.id, p.id, p.name, explicit === p.id)).join('')
    + `</div>`;
}

/**
 * Shared picker wiring used by desktop SubagentsPage and mobile subagent detail.
 * Clicking [data-agent-pet-choice] saves `pet` ("" = Auto) through PUT /api/agents/:id.
 * On success: onSaved(choice) runs (callers refresh their cache and re-render) and a toast shows.
 * On failure: an error toast shows and the selection is NOT changed (onSaved is not called).
 * Uses window.api / window.showToast unless the caller passes its own.
 */
export function wireAgentPetPicker(root, agentId, onSaved, { api: apiFn, toast } = {}) {
  if (!root || !agentId) return;
  const doApi = apiFn || (typeof window !== 'undefined' ? window.api : null);
  const notify = toast || ((title, body, type) => { try { window.showToast?.(title, body, type); } catch (_) {} });
  root.querySelectorAll('[data-agent-pet-choice]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      const choice = btn.getAttribute('data-agent-pet-choice') || '';
      if (!doApi) return;
      try {
        await doApi('/api/agents/' + encodeURIComponent(agentId), { method: 'PUT', body: { pet: choice } });
        if (typeof onSaved === 'function') onSaved(choice);
        notify('Pet updated', '', 'success');
      } catch (err) {
        notify('Pet not saved', String(err?.message || err || 'Unknown error'), 'error');
      }
    });
  });
}
