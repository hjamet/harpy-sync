import { App, Modal, Setting, Notice } from "obsidian";
import { parseBeyondPaperBundle, BeyondPaper } from "@harpy/core";
import { VaultAdapter } from "../adapters/vault-adapter";

export class ImportModal extends Modal {
  private file: File | null = null;
  private importRoot: string;
  private adapter: VaultAdapter;
  private onComplete?: () => void;

  constructor(app: App, defaultFolder: string = "Harpy Import", onComplete?: () => void) {
    super(app);
    this.importRoot = defaultFolder;
    this.adapter = new VaultAdapter(app);
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Import Harpy Campaign (.bypp)" });

    // 1. File Selector
    const fileSetting = new Setting(contentEl)
      .setName("Choose .bypp bundle file")
      .setDesc("Select the exported Beyond Paper (.bypp) campaign JSON file from your machine.");

    const fileInput = fileSetting.controlEl.createEl("input", {
      type: "file",
      attr: { accept: ".bypp,.json" },
    });

    fileInput.addEventListener("change", (e: any) => {
      if (e.target.files && e.target.files.length > 0) {
        this.file = e.target.files[0];
      }
    });

    // 2. Destination Folder
    new Setting(contentEl)
      .setName("Destination Folder")
      .setDesc("The folder inside your vault where the campaign notes will be imported. Leave empty for vault root.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Harpy Import")
          .setValue(this.importRoot)
          .onChange((value) => {
            this.importRoot = value.trim();
          })
      );

    // 3. Progress Container (hidden initially)
    const progressContainer = contentEl.createEl("div", {
      cls: "harpy-progress-container",
      attr: {
        style:
          "margin-top: 20px; display: none; padding: 15px; border-radius: 6px; background-color: var(--background-secondary);",
      },
    });

    const progressText = progressContainer.createEl("div", {
      text: "Preparing import...",
      attr: { style: "font-weight: bold; margin-bottom: 8px;" },
    });

    const progressBarOuter = progressContainer.createEl("div", {
      attr: {
        style:
          "width: 100%; height: 10px; background-color: var(--background-modifier-border); border-radius: 5px; overflow: hidden;",
      },
    });

    const progressBarInner = progressBarOuter.createEl("div", {
      attr: {
        style:
          "width: 0%; height: 100%; background-color: var(--interactive-accent); transition: width 0.1s ease;",
      },
    });

    // 4. Action Buttons
    const buttonContainer = contentEl.createEl("div", {
      attr: { style: "margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;" },
    });

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());

    const importButton = buttonContainer.createEl("button", {
      text: "Import",
      cls: "mod-cta",
    });

    importButton.addEventListener("click", async () => {
      if (!this.file) {
        new Notice("Please select a .bypp file to import.");
        return;
      }

      // Hide inputs and display progress
      fileSetting.settingEl.style.display = "none";
      buttonContainer.style.display = "none";
      progressContainer.style.display = "block";

      try {
        progressText.innerText = "Reading file...";
        const fileContent = await this.file.text();

        progressText.innerText = "Parsing and validating campaign bundle...";
        const rawJson = JSON.parse(fileContent);
        const bundle: BeyondPaper = parseBeyondPaperBundle(rawJson);

        progressText.innerText = "Importing campaign elements...";
        const report = await this.adapter.importBundle(
          bundle,
          this.importRoot,
          (current, total, itemName) => {
            const percent = Math.round((current / total) * 100);
            progressBarInner.style.width = `${percent}%`;
            progressText.innerText = `[${current}/${total}] Importing ${itemName}...`;
          }
        );

        new Notice(
          `Successfully imported "${bundle.name || "Campaign"}" (${report.importedEntities} entities, ${report.importedBattleMaps} battlemaps)!`
        );

        if (report.errors.length > 0) {
          console.warn("Import warnings:", report.errors);
        }

        if (this.onComplete) {
          this.onComplete();
        }
        this.close();
      } catch (error: any) {
        console.error("Import failed:", error);
        new Notice(`Import failed: ${error.message || error}`);
        this.close();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
