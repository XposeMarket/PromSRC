const { Notice, Plugin, PluginSettingTab, Setting, requestUrl } = require('obsidian');

const DEFAULT_SETTINGS = {
  gatewayUrl: 'http://127.0.0.1:18789',
  vaultId: '',
  bridgeMode: 'read_only',
};

class PrometheusBridgePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addRibbonIcon('flame', 'Sync vault with Prometheus', () => this.syncVault());

    this.addCommand({
      id: 'sync-vault',
      name: 'Sync vault with Prometheus',
      callback: () => this.syncVault(),
    });

    this.addCommand({
      id: 'connect-current-vault',
      name: 'Connect current vault to Prometheus',
      callback: () => this.connectCurrentVault(),
    });

    this.addCommand({
      id: 'send-active-note-context',
      name: 'Send active note context to Prometheus',
      editorCallback: async (editor, view) => {
        const file = view.file;
        if (!file) {
          new Notice('No active markdown note.');
          return;
        }
        await this.sendActiveNoteContext(file.path, editor.getValue());
      },
    });

    this.addCommand({
      id: 'mark-active-note-memory',
      name: 'Mark active note as Prometheus memory',
      editorCallback: async (editor) => {
        const current = editor.getValue();
        if (/^---\n[\s\S]*?\nprometheus-memory:/m.test(current)) {
          new Notice('This note is already marked for Prometheus memory.');
          return;
        }
        if (current.startsWith('---\n')) {
          const end = current.indexOf('\n---', 4);
          if (end !== -1) {
            editor.setValue(`${current.slice(0, end)}\nprometheus-memory: true\nprometheus-memory-type: project_fact${current.slice(end)}`);
          }
        } else {
          editor.setValue(`---\nprometheus-memory: true\nprometheus-memory-type: project_fact\ntags:\n  - prometheus/memory\n---\n\n${current}`);
        }
        new Notice('Marked for Prometheus memory. Run sync when ready.');
      },
    });

    this.addSettingTab(new PrometheusBridgeSettingTab(this.app, this));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async api(path, body) {
    const url = `${String(this.settings.gatewayUrl || DEFAULT_SETTINGS.gatewayUrl).replace(/\/$/, '')}${path}`;
    const response = await requestUrl({
      url,
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Prometheus API ${response.status}: ${response.text || 'request failed'}`);
    }
    return response.json;
  }

  async connectCurrentVault() {
    try {
      const adapter = this.app.vault.adapter;
      const basePath = adapter && typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
      if (!basePath) {
        new Notice('Could not resolve the local vault path. Desktop Obsidian is required.');
        return;
      }
      const result = await this.api('/api/obsidian/vaults', {
        path: basePath,
        name: this.app.vault.getName(),
        mode: this.settings.bridgeMode || 'read_only',
        syncNow: true,
      });
      this.settings.vaultId = result?.vault?.id || this.settings.vaultId;
      await this.saveSettings();
      new Notice('Prometheus bridge connected and synced.');
    } catch (error) {
      new Notice(`Prometheus bridge failed: ${error.message}`);
    }
  }

  async syncVault() {
    try {
      const body = this.settings.vaultId ? { vaultId: this.settings.vaultId, force: true } : { force: true };
      const result = await this.api('/api/obsidian/sync', body);
      const sync = result?.sync || {};
      new Notice(`Prometheus synced: ${sync.indexed || 0} indexed, ${sync.removed || 0} removed.`);
    } catch (error) {
      new Notice(`Prometheus sync failed: ${error.message}`);
    }
  }

  async sendActiveNoteContext(relativePath, content) {
    try {
      await this.syncVault();
      const query = `${relativePath}\n${content.slice(0, 1200)}`;
      await this.api('/api/chat', {
        message: `Use Prometheus memory to reason about this Obsidian note:\n\n${query}`,
        sessionId: 'obsidian-bridge',
      });
      new Notice('Active note context sent to Prometheus.');
    } catch (error) {
      new Notice(`Could not send note context: ${error.message}`);
    }
  }
}

class PrometheusBridgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Prometheus Bridge' });

    new Setting(containerEl)
      .setName('Gateway URL')
      .setDesc('Local Prometheus gateway URL.')
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.gatewayUrl)
        .setValue(this.plugin.settings.gatewayUrl)
        .onChange(async (value) => {
          this.plugin.settings.gatewayUrl = value.trim() || DEFAULT_SETTINGS.gatewayUrl;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Bridge mode')
      .setDesc('Read-only indexes notes. Assisted and full allow Prometheus writeback.')
      .addDropdown((dropdown) => dropdown
        .addOption('read_only', 'Read-only')
        .addOption('assisted', 'Assisted writeback')
        .addOption('full', 'Full bridge')
        .setValue(this.plugin.settings.bridgeMode)
        .onChange(async (value) => {
          this.plugin.settings.bridgeMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Connect this vault')
      .setDesc('Registers the current vault with Prometheus and performs an initial sync.')
      .addButton((button) => button
        .setButtonText('Connect and sync')
        .setCta()
        .onClick(() => this.plugin.connectCurrentVault()));
  }
}

module.exports = PrometheusBridgePlugin;
