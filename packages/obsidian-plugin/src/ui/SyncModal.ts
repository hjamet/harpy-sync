import { App, Modal, Setting, Notice } from "obsidian";
import { parseBeyondPaperBundle, BeyondPaper } from "@harpy/core";
import { VaultAdapter, SyncReport } from "../adapters/vault-adapter";

export class SyncModal extends Modal {
  private file: File | null = null;
  private campaignFolder: string;
  private adapter: VaultAdapter;

  constructor(app: App, defaultFolder: string = "Harpy Import") {
    super(app);
    this.campaignFolder = defaultFolder;
    this.adapter = new VaultAdapter(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "3-Way Sync Harpy Campaign" });

    // 1. Remote Bundle File Selector
    const fileSetting = new Setting(contentEl)
      .setName("Remote .bypp bundle")
      .setDesc("Select the remote .bypp bundle file to synchronize against.");

    const fileInput = fileSetting.controlEl.createEl("input", {
      type: "file",
      attr: { accept: ".bypp,.json" },
    });

    fileInput.addEventListener("change", (e: any) => {
      if (e.target.files && e.target.files.length > 0) {
        this.file = e.target.files[0];
      }
    });

    // 2. Campaign Folder
    new Setting(contentEl)
      .setName("Local Campaign Folder")
      .setDesc("The local folder containing your markdown campaign notes.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Harpy Import")
          .setValue(this.campaignFolder)
          .onChange((value) => {
            this.campaignFolder = value.trim();
          })
      );

    // 3. Results Container (hidden initially)
    const resultsContainer = contentEl.createEl("div", {
      cls: "harpy-sync-results",
      attr: { style: "margin-top: 20px; display: none;" },
    });

    // 4. Action Buttons
    const buttonContainer = contentEl.createEl("div", {
      attr: { style: "margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;" },
    });

    const closeButton = buttonContainer.createEl("button", { text: "Close" });
    closeButton.addEventListener("click", () => this.close());

    const analyzeButton = buttonContainer.createEl("button", {
      text: "Analyze & Sync",
      cls: "mod-cta",
    });

    analyzeButton.addEventListener("click", async () => {
      if (!this.file) {
        new Notice("Please select a remote .bypp bundle file.");
        return;
      }

      if (!this.campaignFolder) {
        new Notice("Please specify a local campaign folder.");
        return;
      }

      new Notice("Analyzing 3-way synchronization differences...");
      try {
        const fileText = await this.file.text();
        const rawJson = JSON.parse(fileText);
        const remoteBundle: BeyondPaper = parseBeyondPaperBundle(rawJson);

        const report: SyncReport = await this.adapter.syncCampaign(this.campaignFolder, remoteBundle);

        resultsContainer.empty();
        resultsContainer.style.display = "block";

        resultsContainer.createEl("h3", { text: "Synchronization Report" });

        const summaryBox = resultsContainer.createEl("div", {
          attr: {
            style:
              "display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; text-align: center;",
          },
        });

        const addStat = (label: string, value: number, color: string) => {
          const card = summaryBox.createEl("div", {
            attr: {
              style: `padding: 10px; border-radius: 6px; background-color: var(--background-secondary); border-left: 4px solid ${color};`,
            },
          });
          card.createEl("div", { text: String(value), attr: { style: "font-size: 1.3em; font-weight: bold;" } });
          card.createEl("div", { text: label, attr: { style: "font-size: 0.85em; color: var(--text-muted);" } });
        };

        addStat("No Change", report.noChange, "var(--text-muted)");
        addStat("Local Newer", report.appliedLocal, "var(--color-blue)");
        addStat("Remote Newer", report.appliedRemote, "var(--color-green)");
        addStat("Conflicts", report.conflicts, "var(--color-red)");

        if (report.items.length > 0) {
          const table = resultsContainer.createEl("table", {
            attr: { style: "width: 100%; border-collapse: collapse; margin-top: 10px;" },
          });
          const thead = table.createEl("thead");
          const headerRow = thead.createEl("tr");
          headerRow.createEl("th", { text: "Entity", attr: { style: "text-align: left; padding: 6px;" } });
          headerRow.createEl("th", { text: "Action", attr: { style: "text-align: left; padding: 6px;" } });
          headerRow.createEl("th", { text: "Status", attr: { style: "text-align: left; padding: 6px;" } });

          const tbody = table.createEl("tbody");
          for (const item of report.items) {
            const tr = tbody.createEl("tr", {
              attr: { style: "border-bottom: 1px solid var(--background-modifier-border);" },
            });
            tr.createEl("td", { text: item.displayName, attr: { style: "padding: 6px;" } });
            tr.createEl("td", { text: item.action, attr: { style: "padding: 6px;" } });
            const statusCell = tr.createEl("td", { attr: { style: "padding: 6px;" } });
            if (item.hasConflicts) {
              statusCell.createEl("span", {
                text: "⚠️ Conflict",
                attr: { style: "color: var(--color-red); font-weight: bold;" },
              });
            } else {
              statusCell.createEl("span", {
                text: "✓ OK",
                attr: { style: "color: var(--color-green);" },
              });
            }
          }
        }

        new Notice(
          `Sync analysis complete! ${report.items.length} entities analyzed (${report.conflicts} conflicts).`
        );
      } catch (error: any) {
        console.error("Sync analysis failed:", error);
        new Notice(`Sync failed: ${error.message || error}`);
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
