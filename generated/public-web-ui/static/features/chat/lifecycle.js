// Shared lifecycle events consumed by the split-pane and tab workspace.
export function dispatchDesktopChatLifecycle(name, detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent(`prometheus:${name}`, { detail }));
  } catch {}
}
