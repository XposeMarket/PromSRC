'use strict';

const UPDATE_CHANNELS = new Set(['stable', 'beta']);
const DEFAULT_UPDATE_CHANNEL = 'stable';

function normalizeUpdateChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  return UPDATE_CHANNELS.has(channel) ? channel : DEFAULT_UPDATE_CHANNEL;
}

function normalizeUpdaterSettings(parsed) {
  return {
    autoUpdateEnabled: parsed?.autoUpdateEnabled !== false,
    updateChannel: normalizeUpdateChannel(parsed?.updateChannel),
  };
}

function isPrereleaseVersion(version) {
  return /-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*/.test(String(version || '').trim());
}

function isReleaseInChannel(info, updateChannel) {
  const channel = normalizeUpdateChannel(updateChannel);
  const prerelease = info?.isPrerelease === true || isPrereleaseVersion(info?.version);
  return channel === 'beta' || !prerelease;
}

function shouldAllowDowngrade(currentVersion, updateChannel) {
  // Do not broadly accept older Stable builds. This narrow exception allows an
  // intentional beta → stable rollback when the installed build is prerelease.
  return normalizeUpdateChannel(updateChannel) === 'stable' && isPrereleaseVersion(currentVersion);
}

function applyUpdateChannelPreferences(autoUpdater, updateChannel, currentVersion) {
  if (!autoUpdater) return;
  const channel = normalizeUpdateChannel(updateChannel);
  autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest';
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.allowDowngrade = shouldAllowDowngrade(currentVersion, channel);
}

module.exports = {
  DEFAULT_UPDATE_CHANNEL,
  UPDATE_CHANNELS,
  normalizeUpdateChannel,
  normalizeUpdaterSettings,
  isPrereleaseVersion,
  isReleaseInChannel,
  shouldAllowDowngrade,
  applyUpdateChannelPreferences,
};
