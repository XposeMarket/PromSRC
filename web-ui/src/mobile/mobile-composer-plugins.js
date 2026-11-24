import { installComposerControls, pluginLabel, decoratePluginMarkdown } from '../features/chat/composer-plugin-controls.js';

export function mount(commands, request) {
  installComposerControls('pm-chat-access', commands, request,
    () => { location.hash = '#mobile/settings/security'; },
    () => document.querySelector('#pm-composer-input')?.dispatchEvent(new Event('input', {bubbles:true})));
  return { pluginLabel, decoratePluginMarkdown };
}
