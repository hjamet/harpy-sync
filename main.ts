import { App, Plugin, PluginSettingTab, Setting, Notice, FileSystemAdapter } from "obsidian";
// Import bypp schemas and migration tools
import { BeyondPaperSchema, migrate } from "bypp-format";

interface HarpySyncSettings {
  defaultExportPath: string;
}

const DEFAULT_SETTINGS: HarpySyncSettings = {
  defaultExportPath: "harpy-export.bypp"
};

export default class HarpySyncPlugin extends Plugin {
  settings: HarpySyncSettings;

  async onload() {
    await this.loadSettings();

    console.log("Loading Harpy Sync Plugin...");

    // Add ribbon icon for quick import trigger
    const ribbonIconEl = this.addRibbonIcon("switch", "Harpy Sync", (evt: MouseEvent) => {
      new Notice("Harpy Sync: Ready to import or export campaign data.");
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

    // Add command: Export vault as .bypp bundle
    this.addCommand({
      id: "export-bypp-bundle",
      name: "Export vault as .bypp bundle",
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
   * Skeletons for import/export logic
   */
  async handleImport() {
    new Notice("Importing campaign from .bypp bundle...");
    try {
      // Mock raw content for validation demonstration
      const mockRawContent = {
        version: 2,
        format: "bypp",
        metadata: {
          name: "Mock Campaign",
          createdAt: new Date().toISOString()
        },
        variables: [],
        entities: [],
        sheets: [],
        dataTables: []
      };

      // Demonstrate migration runtime
      console.log("Migrating bundle...");
      const migrated = migrate(mockRawContent);
      
      // Demonstrate Zod validation
      console.log("Validating bundle schema...");
      const bundle = BeyondPaperSchema.parse(migrated);

      new Notice(`Successfully validated campaign bundle: "${bundle.metadata.name}"!`);
      console.log("Parsed bundle:", bundle);
    } catch (error) {
      console.error("Failed to import bundle:", error);
      new Notice(`Import failed: ${error.message || error}`);
    }
  }

  async handleExport() {
    new Notice("Exporting vault as .bypp bundle...");
    // Future implementation will traverse markdown files to build a bundle
    new Notice(`Export location: ${this.settings.defaultExportPath}`);
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

    new Setting(containerEl)
      .setName("Default export file path")
      .setDesc("The file path where the exported .bypp bundle will be saved inside the vault.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. harpy-export.bypp")
          .setValue(this.plugin.settings.defaultExportPath)
          .onChange(async (value) => {
            this.plugin.settings.defaultExportPath = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
