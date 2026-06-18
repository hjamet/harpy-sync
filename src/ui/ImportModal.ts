import { App, Modal, Setting, Notice } from "obsidian";
import { parseBundle, BundleIndex } from "../import/parser";
import { AssetManager } from "../import/asset-manager";
import { MarkdownBuilder } from "../import/markdown-builder";

export class ImportModal extends Modal {
  private file: File | null = null;
  private importRoot: string = "Harpy Import";
  private onSubmit: () => void;

  constructor(app: App, onSubmit: () => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Import Harpy Campaign (.bypp)" });

    // 1. File Selector Setting
    const fileSetting = new Setting(contentEl)
      .setName("Choose .bypp bundle file")
      .setDesc("Select the exported Beyond Paper (.bypp) campaign JSON file from your machine.");
    
    const fileInput = fileSetting.controlEl.createEl("input", {
      type: "file",
      attr: { accept: ".bypp,.json" }
    });
    
    fileInput.addEventListener("change", (e: any) => {
      if (e.target.files && e.target.files.length > 0) {
        this.file = e.target.files[0];
      }
    });

    // 2. Import Destination Directory Setting
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

    // 3. Progress area (hidden by default)
    const progressContainer = contentEl.createEl("div", {
      cls: "harpy-progress-container",
      attr: { style: "margin-top: 20px; display: none; padding: 15px; border-radius: 6px; background-color: var(--background-secondary);" }
    });
    const progressText = progressContainer.createEl("div", {
      text: "Preparing import...",
      attr: { style: "font-weight: bold; margin-bottom: 8px;" }
    });
    const progressBarOuter = progressContainer.createEl("div", {
      attr: { style: "width: 100%; height: 10px; background-color: var(--background-modifier-border); border-radius: 5px; overflow: hidden;" }
    });
    const progressBarInner = progressBarOuter.createEl("div", {
      attr: { style: "width: 0%; height: 100%; background-color: var(--interactive-accent); transition: width 0.1s ease;" }
    });

    // 4. Action Buttons
    const buttonContainer = contentEl.createEl("div", {
      attr: { style: "margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;" }
    });

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());

    const importButton = buttonContainer.createEl("button", {
      text: "Import",
      cls: "mod-cta"
    });

    importButton.addEventListener("click", async () => {
      if (!this.file) {
        new Notice("Please select a .bypp file to import.");
        return;
      }

      // Hide inputs and show progress bar
      fileSetting.settingEl.style.display = "none";
      buttonContainer.style.display = "none";
      progressContainer.style.display = "block";

      try {
        progressText.innerText = "Reading file...";
        const fileContent = await this.file.text();
        
        progressText.innerText = "Parsing and validating campaign bundle...";
        const rawJson = JSON.parse(fileContent);
        const bundle = parseBundle(rawJson);

        progressText.innerText = "Indexing campaign contents...";
        const index = new BundleIndex(bundle);
        const assetManager = new AssetManager(this.app, this.importRoot);
        const builder = new MarkdownBuilder(this.app, index, assetManager);

        const entitiesCount = bundle.entities.length;
        progressText.innerText = `Importing ${entitiesCount} entities...`;

        let completed = 0;
        for (const entity of bundle.entities) {
          const folderPath = index.getEntityFolderPath(entity, this.importRoot);
          const entityName = entity.displayName || entity.name;
          
          progressText.innerText = `Importing entity [${completed + 1}/${entitiesCount}]: ${entityName}`;
          await builder.writeEntityFile(entity, folderPath);
          
          completed++;
          const percent = Math.round((completed / entitiesCount) * 100);
          progressBarInner.style.width = `${percent}%`;
        }

        new Notice(`Successfully imported "${bundle.name || "Campaign"}" (${entitiesCount} notes)!`);
        this.onSubmit();
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
