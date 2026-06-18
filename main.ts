import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from "obsidian";
import { BeyondPaperSchema } from "bypp-format";
import { ImportModal } from "./src/ui/ImportModal";
import { VaultScanner } from "./src/export/scanner";

interface HarpySyncSettings {
  defaultExportPath: string;
  importFolder: string;
}

const DEFAULT_SETTINGS: HarpySyncSettings = {
  defaultExportPath: "harpy-export.bypp",
  importFolder: "Harpy Import"
};

export default class HarpySyncPlugin extends Plugin {
  declare settings: HarpySyncSettings;

  async onload() {
    await this.loadSettings();

    console.log("Loading Harpy Sync Plugin...");

    // Add ribbon icon for quick import trigger
    const ribbonIconEl = this.addRibbonIcon("switch", "Harpy Sync", (evt: MouseEvent) => {
      this.handleImport();
    });
    ribbonIconEl.addClass("harpy-sync-ribbon-class");

    // Add command: Import .bypp bundle
    this.addCommand({
      id: "import-bypp-bundle",
      name: "Import .bypp bundle",
      callback: () => {
        this.handleImport();
      }
    });

    // Add command: Export vault folder as .bypp bundle
    this.addCommand({
      id: "export-bypp-bundle",
      name: "Export campaign folder as .bypp bundle",
      callback: () => {
        this.handleExport();
      }
    });

    // Add settings tab
    this.addSettingTab(new HarpySyncSettingTab(this.app, this));
  }

  onunload() {
    console.log("Unloading Harpy Sync Plugin...");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Triggers the Import UI Modal
   */
  handleImport() {
    new ImportModal(this.app, () => {
      console.log("Import completed successfully.");
    }).open();
  }

  /**
   * Scans the campaign folder, builds and validates the .bypp bundle, and saves it.
   */
  async handleExport() {
    new Notice("Scanning campaign folder for export...");
    try {
      const scanner = new VaultScanner(this.app);
      const bundle = await scanner.scanFolder(this.settings.importFolder, this.settings.importFolder);

      // Validate package schema compatibility
      console.log("Validating exported bundle against BeyondPaperSchema...");
      BeyondPaperSchema.parse(bundle);

      const dataStr = JSON.stringify(bundle, null, 2);
      const exportPath = this.settings.defaultExportPath;
      
      const existingFile = this.app.vault.getAbstractFileByPath(exportPath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, dataStr);
      } else {
        await this.app.vault.create(exportPath, dataStr);
      }

      new Notice(`Successfully exported campaign to "${exportPath}"!`);
    } catch (error: any) {
      console.error("Export failed:", error);
      new Notice(`Export failed: ${error.message || error}`);
    }
  }
}

class HarpySyncSettingTab extends PluginSettingTab {
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
      .setName("Campaign folder")
      .setDesc("The folder in your vault containing campaign files to export.")
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
      .setDesc("The path where the exported .bypp bundle will be saved inside the vault.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. harpy-export.bypp")
          .setValue(this.plugin.settings.defaultExportPath)
          .onChange(async (value) => {
            this.plugin.settings.defaultExportPath = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}

