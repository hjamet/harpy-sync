import { Plugin, Notice } from "obsidian";
import { HarpySyncSettings, DEFAULT_SETTINGS, HarpySyncSettingTab } from "./settings";
import { ImportModal } from "./ui/ImportModal";
import { ExportModal } from "./ui/ExportModal";
import { SyncModal } from "./ui/SyncModal";
import { VaultAdapter } from "./adapters/vault-adapter";

export default class HarpySyncPlugin extends Plugin {
  declare settings: HarpySyncSettings;
  vaultAdapter!: VaultAdapter;

  async onload() {
    await this.loadSettings();

    this.vaultAdapter = new VaultAdapter(this.app, this.settings.attachmentsFolder);

    console.log("Loading Harpy Sync Plugin...");

    // 1. Add Ribbon Icon for quick action
    const ribbonIconEl = this.addRibbonIcon("switch", "Harpy Sync", () => {
      this.openImportModal();
    });
    ribbonIconEl.addClass("harpy-sync-ribbon-class");

    // 2. Command: Import .bypp bundle
    this.addCommand({
      id: "import-bypp-bundle",
      name: "Import .bypp campaign bundle",
      callback: () => {
        this.openImportModal();
      },
    });

    // 3. Command: Export vault folder as .bypp bundle
    this.addCommand({
      id: "export-bypp-bundle",
      name: "Export campaign folder as .bypp bundle",
      callback: () => {
        this.openExportModal();
      },
    });

    // 4. Command: 3-Way Sync campaign with .bypp bundle
    this.addCommand({
      id: "sync-bypp-bundle",
      name: "3-Way Sync campaign with .bypp bundle",
      callback: () => {
        this.openSyncModal();
      },
    });

    // 5. Command: Validate active note against Harpy v3 standard
    this.addCommand({
      id: "validate-harpy-v3-note",
      name: "Validate active note against Harpy v3 standard",
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "md") {
          if (!checking) {
            this.validateActiveNote(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    // 6. Register Settings Tab
    this.addSettingTab(new HarpySyncSettingTab(this.app, this));
  }

  async validateActiveNote(file: import("obsidian").TFile) {
    try {
      const content = await this.app.vault.read(file);
      const { validateHarpyV3Markdown } = await import("@harpy/core");
      const result = validateHarpyV3Markdown(content, { entityName: file.basename });

      if (result.valid) {
        let msg = `✅ Note '${file.basename}' is strictly valid according to Harpy v3!`;
        if (result.warnings.length > 0) {
          msg += `\n⚠️ ${result.warnings.length} warning(s):\n- ${result.warnings.join("\n- ")}`;
        }
        new Notice(msg, 7000);
      } else {
        const errorList = result.errors.map((e) => `• ${e}`).join("\n");
        let msg = `❌ Note '${file.basename}' failed Harpy v3 validation:\n${errorList}`;
        if (result.warnings.length > 0) {
          msg += `\n⚠️ Warnings:\n${result.warnings.map((w) => `• ${w}`).join("\n")}`;
        }
        new Notice(msg, 10000);
      }
    } catch (err: any) {
      new Notice(`Error validating Harpy v3 note: ${err?.message || String(err)}`, 7000);
    }
  }

  onunload() {
    console.log("Unloading Harpy Sync Plugin...");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    if (this.vaultAdapter) {
      this.vaultAdapter = new VaultAdapter(this.app, this.settings.attachmentsFolder);
    }
  }

  openImportModal() {
    new ImportModal(this.app, this.settings.importFolder, () => {
      console.log("Harpy Sync: Import completed.");
    }).open();
  }

  openExportModal() {
    new ExportModal(
      this.app,
      this.settings.importFolder,
      this.settings.defaultExportPath,
      () => {
        console.log("Harpy Sync: Export completed.");
      }
    ).open();
  }

  openSyncModal() {
    new SyncModal(this.app, this.settings.importFolder).open();
  }
}
