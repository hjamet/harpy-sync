import { App, Modal, Setting, Notice } from "obsidian";
import { VaultAdapter } from "../adapters/vault-adapter";

export class ExportModal extends Modal {
  private campaignFolder: string;
  private exportPath: string;
  private campaignName: string = "";
  private adapter: VaultAdapter;
  private onComplete?: () => void;

  constructor(
    app: App,
    defaultFolder: string = "Harpy Import",
    defaultExportPath: string = "harpy-export.bypp",
    onComplete?: () => void
  ) {
    super(app);
    this.campaignFolder = defaultFolder;
    this.exportPath = defaultExportPath;
    this.adapter = new VaultAdapter(app);
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Export Campaign as Beyond Paper (.bypp)" });

    new Setting(contentEl)
      .setName("Campaign Folder")
      .setDesc("The folder inside your vault containing the campaign markdown notes.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Harpy Import")
          .setValue(this.campaignFolder)
          .onChange((value) => {
            this.campaignFolder = value.trim();
          })
      );

    new Setting(contentEl)
      .setName("Campaign Display Name")
      .setDesc("Optional override name for the exported campaign bundle (defaults to folder name).")
      .addText((text) =>
        text
          .setPlaceholder("e.g. My Campaign")
          .setValue(this.campaignName)
          .onChange((value) => {
            this.campaignName = value.trim();
          })
      );

    new Setting(contentEl)
      .setName("Export File Path")
      .setDesc("Vault destination path where the .bypp bundle file will be written.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. harpy-export.bypp")
          .setValue(this.exportPath)
          .onChange((value) => {
            this.exportPath = value.trim();
          })
      );

    const buttonContainer = contentEl.createEl("div", {
      attr: { style: "margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;" },
    });

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());

    const exportButton = buttonContainer.createEl("button", {
      text: "Export",
      cls: "mod-cta",
    });

    exportButton.addEventListener("click", async () => {
      if (!this.campaignFolder) {
        new Notice("Please specify a campaign folder to export.");
        return;
      }

      new Notice("Scanning and bundling campaign notes...");
      try {
        const bundle = await this.adapter.exportCampaign(this.campaignFolder, this.campaignName || undefined);
        const dataStr = JSON.stringify(bundle, null, 2);

        await this.adapter.writeFile(this.exportPath, dataStr);

        new Notice(
          `Successfully exported campaign "${bundle.name}" (${bundle.entities.length} entities) to "${this.exportPath}"!`
        );

        if (this.onComplete) {
          this.onComplete();
        }
        this.close();
      } catch (error: any) {
        console.error("Export failed:", error);
        new Notice(`Export failed: ${error.message || error}`);
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
