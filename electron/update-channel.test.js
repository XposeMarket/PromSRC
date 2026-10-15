'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_UPDATE_CHANNEL,
  normalizeUpdateChannel,
  normalizeUpdaterSettings,
  isReleaseInChannel,
  shouldAllowDowngrade,
  applyUpdateChannelPreferences,
} = require('./update-channel');

test('update channel defaults legacy and invalid settings to Stable', () => {
  assert.equal(DEFAULT_UPDATE_CHANNEL, 'stable');
  assert.equal(normalizeUpdateChannel(), 'stable');
  assert.equal(normalizeUpdateChannel('BETA'), 'beta');
  assert.equal(normalizeUpdateChannel('nightly'), 'stable');
  assert.deepEqual(normalizeUpdaterSettings({ autoUpdateEnabled: false }), {
    autoUpdateEnabled: false,
    updateChannel: 'stable',
  });
});

test('Stable rejects prereleases and only permits beta to stable downgrade', () => {
  assert.equal(isReleaseInChannel({ version: '1.4.0-beta.1' }, 'stable'), false);
  assert.equal(isReleaseInChannel({ version: '1.4.0', isPrerelease: false }, 'stable'), true);
  assert.equal(isReleaseInChannel({ version: '1.4.0-rc.1' }, 'beta'), true);
  assert.equal(shouldAllowDowngrade('1.4.0-beta.1', 'stable'), true);
  assert.equal(shouldAllowDowngrade('1.4.0', 'stable'), false);

  const updater = {};
  applyUpdateChannelPreferences(updater, 'beta', '1.4.0-beta.1');
  assert.deepEqual(updater, { channel: 'beta', allowPrerelease: true, allowDowngrade: false });

  applyUpdateChannelPreferences(updater, 'stable', '1.4.0-beta.1');
  assert.deepEqual(updater, { channel: 'latest', allowPrerelease: false, allowDowngrade: true });

  applyUpdateChannelPreferences(updater, 'stable', '1.4.0');
  assert.equal(updater.allowDowngrade, false);
});
