import { App, PluginSettingTab, Setting } from "obsidian";
import type HarpySyncPlugin from "./main";

export interface HarpySyncSettings {
  defaultExportPath: string;
  importFolder: string;
  attachmentsFolder: string;
  autoSync: boolean;
}

export const DEFAULT_SETTINGS: HarpySyncSettings = {
  defaultExportPath: "harpy-export.bypp",
  importFolder: "Harpy Import",
  attachmentsFolder: "Harpy Import/_attachments",
  autoSync: false,
};

export class HarpySyncSettingTab extends PluginSettingTab {
  plugin: HarpySyncPlugin;

  constructor(app: App, plugin: HarpySyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Harpy Sync Settings" });

    new Setting(containerEl)
      .setName("Campaign import folder")
      .setDesc("The default folder inside your vault where campaign notes and battlemaps will be imported.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Harpy Import")
          .setValue(this.plugin.settings.importFolder)
          .onChange(async (value) => {
            this.plugin.settings.importFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default export file path")
      .setDesc("The vault-relative path where exported .bypp bundles will be saved.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. harpy-export.bypp")
          .setValue(this.plugin.settings.defaultExportPath)
          .onChange(async (value) => {
            this.plugin.settings.defaultExportPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Attachments folder")
      .setDesc("Folder path for downloaded profile images, maps, and sheet assets.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Harpy Import/_attachments")
          .setValue(this.plugin.settings.attachmentsFolder)
          .onChange(async (value) => {
            this.plugin.settings.attachmentsFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
