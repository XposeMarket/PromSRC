import assert from 'assert';
import { normalizeAgentsForSave } from './agent-normalize';

/**
 * Regression coverage for the optional `pet` field on agent config.
 *
 * - A valid pet id is kept (lowercased).
 * - An empty string clears the field (the key is omitted, so the UI falls back to auto/hash).
 * - Garbage values are dropped and never persisted.
 * - Other agent fields are untouched by the pet handling.
 */
function main(): void {
  const [kit] = normalizeAgentsForSave([{ id: 'a1', name: 'A', pet: 'Kit' }]);
  assert.equal(kit.pet, 'kit', 'valid pet ids are lowercased and kept');

  const [cleared] = normalizeAgentsForSave([{ id: 'a1', name: 'A', pet: '' }]);
  assert.equal('pet' in cleared, false, 'empty string drops the pet key (reset to auto)');

  const [spaces] = normalizeAgentsForSave([{ id: 'a1', name: 'A', pet: '   ' }]);
  assert.equal('pet' in spaces, false, 'whitespace-only pet is treated as empty');

  const [garbage] = normalizeAgentsForSave([{ id: 'a1', name: 'A', pet: '<img onerror=x>' }]);
  assert.equal('pet' in garbage, false, 'invalid pet values are dropped, never persisted');

  const [tooLong] = normalizeAgentsForSave([{ id: 'a1', name: 'A', pet: 'x'.repeat(25) }]);
  assert.equal('pet' in tooLong, false, 'pet ids longer than 24 chars are dropped');

  const [unset] = normalizeAgentsForSave([{ id: 'a1', name: 'A' }]);
  assert.equal('pet' in unset, false, 'agents without a pet keep no pet key');

  const [withEmoji] = normalizeAgentsForSave([{ id: 'a1', name: 'A', emoji: '🤖', pet: 'ember' }]);
  assert.equal(withEmoji.emoji, '🤖', 'legacy emoji is still preserved');
  assert.equal(withEmoji.pet, 'ember', 'pet coexists with emoji');

  console.log('agent-pet-normalize regression: ok');
}

main();
