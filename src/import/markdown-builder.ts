import { TFile, App, stringifyYaml } from "obsidian";
import { BundleIndex, sanitizeFileName } from "./parser";
import { AssetManager } from "./asset-manager";
import { Entity, Page, Chunk, RandomTable } from "../types";

/**
 * Strips the top YAML frontmatter block from a file's content.
 */
export function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const parts = content.split("---");
    if (parts.length >= 3) {
      return parts.slice(2).join("---").trim();
    }
  }
  return content.trim();
}

/**
 * Resolves internal Harpy links to native Obsidian wikilinks.
 */
export function resolveEntityLinks(text: string, index: BundleIndex): string {
  if (!text) return "";
  
  // Replace Markdown links of the form [Name](/entity/UID) or [Name](harpy://entity/UID)
  let resolved = text.replace(/\[([^\]]+)\]\((?:https?:\/\/harpy\.gg)?\/entity\/([a-zA-Z0-9_-]+)\)/g, (match, linkText, uid) => {
    const targetEntity = index.entities.get(uid);
    if (targetEntity) {
      const entityName = targetEntity.displayName || targetEntity.name;
      return `[[${entityName}|${linkText}]]`;
    }
    return match;
  });

  // Replace raw /entity/UID URLs with [[Entity Name]]
  resolved = resolved.replace(/(?:https?:\/\/harpy\.gg)?\/entity\/([a-zA-Z0-9_-]+)/g, (match, uid) => {
    const targetEntity = index.entities.get(uid);
    if (targetEntity) {
      return `[[${targetEntity.displayName || targetEntity.name}]]`;
    }
    return match;
  });

  return resolved;
}

/**
 * Builds the Markdown representation of a campaign entity.
 */
export class MarkdownBuilder {
  app: App;
  index: BundleIndex;
  assetManager: AssetManager;

  constructor(app: App, index: BundleIndex, assetManager: AssetManager) {
    this.app = app;
    this.index = index;
    this.assetManager = assetManager;
  }

  /**
   * Generates the complete Markdown string for an entity.
   */
  async buildEntityMarkdown(entity: Entity): Promise<string> {
    const lines: string[] = [];

    // 1. Generate YAML Frontmatter
    const frontmatter: Record<string, any> = {
      "harpy-uid": entity.uid,
      "harpy-last-sync": this.index.bundle.exportedAt,
      type: entity.type,
      tags: this.index.getEntityTagNames(entity),
    };

    // Flatten variables in frontmatter
    if (entity.data && typeof entity.data === "object") {
      const flatVars: Record<string, any> = {};
      for (const [varUid, value] of Object.entries(entity.data)) {
        const variable = this.index.variables.get(varUid);
        if (variable) {
          const key = variable.name || variable.label || varUid;
          flatVars[key] = value;
        } else {
          flatVars[varUid] = value;
        }
      }
      if (Object.keys(flatVars).length > 0) {
        frontmatter["variables"] = flatVars;
      }
    }

    lines.push("---");
    lines.push(stringifyYaml(frontmatter).trim());
    lines.push("---");
    lines.push("");

    // 2. Add Title
    const displayName = entity.displayName || entity.name;
    lines.push(`# ${displayName}`);
    lines.push("");

    // 3. Add Profile Image and Description
    const profileUrl = entity.originalUrl || entity.closeupUrl || entity.squareUrl;
    if (profileUrl) {
      const localPath = await this.assetManager.downloadUrl(profileUrl, `${displayName}_profile`);
      if (localPath) {
        lines.push(this.assetManager.toObsidianLink(localPath));
        lines.push("");
      }
    }

    if (entity.description) {
      lines.push(resolveEntityLinks(entity.description, this.index));
      lines.push("");
    }

    // 4. Render Pages & Chunks
    if (entity.pagesOrder) {
      for (const pageUid of entity.pagesOrder) {
        const page = this.index.pages.get(pageUid);
        if (page) {
          await this.renderPage(page, lines);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Renders a single Page and its Chunks.
   */
  private async renderPage(page: Page, lines: string[]): Promise<void> {
    // We only render standard pages; entity pages are handled differently
    if (page.type === "standard") {
      lines.push(`# ${page.name}`);
      lines.push("");

      if (page.chunksOrder) {
        for (const chunkUid of page.chunksOrder) {
          const chunk = this.index.chunks.get(chunkUid);
          if (chunk) {
            await this.renderChunk(chunk, lines);
          }
        }
      }
    }
  }

  /**
   * Renders a single Chunk.
   */
  private async renderChunk(chunk: Chunk, lines: string[]): Promise<void> {
    switch (chunk.type) {
      case "text":
        if (chunk.content) {
          lines.push(resolveEntityLinks(chunk.content, this.index));
          lines.push("");
        }
        break;

      case "textProxy":
        // Look up target chunk
        if (chunk.chunkUid) {
          const targetChunk = this.index.chunks.get(chunk.chunkUid);
          if (targetChunk) {
            await this.renderChunk(targetChunk, lines);
          }
        }
        break;

      case "gallery":
        if (chunk.assetUids && chunk.assetUids.length > 0) {
          const galleryLines: string[] = [];
          for (const assetUid of chunk.assetUids) {
            const asset = this.index.assets.get(assetUid);
            if (asset) {
              let url = "";
              if (asset.type === "image") {
                url = asset.originalUrl || asset.thumbnailUrl || "";
              } else if (asset.type === "video") {
                url = asset.videoUrl || "";
              } else if (asset.type === "audio") {
                url = asset.audioUrl || "";
              }
              if (url) {
                const localPath = await this.assetManager.downloadUrl(url, asset.name || "gallery_asset");
                if (localPath) {
                  galleryLines.push(this.assetManager.toObsidianLink(localPath));
                }
              }
            }
          }
          if (galleryLines.length > 0) {
            lines.push(galleryLines.join(" "));
            lines.push("");
          }
        }
        break;

      case "random":
        if (chunk.randomTableUid) {
          const table = this.index.randomTables.get(chunk.randomTableUid);
          if (table) {
            this.renderRandomTable(table, lines);
          }
        }
        break;
    }
  }

  /**
   * Renders a Random Table as an Obsidian Callout.
   */
  private renderRandomTable(table: RandomTable, lines: string[]): void {
    const dice = table.diceFormula || "1d100";
    lines.push(`> [!example] Random Table: ${table.title || "Untitled Table"} (Dice: ${dice})`);
    lines.push(`> | Roll | Result |`);
    lines.push(`> | --- | --- |`);

    if (table.rows) {
      // Sort rows by range roll if they are numbers
      const sortedRows = [...table.rows].sort((a, b) => (a.range ?? 0) - (b.range ?? 0));
      for (const row of sortedRows) {
        const rollStr = row.range !== undefined ? row.range.toString() : "-";
        const content = row.content ? resolveEntityLinks(row.content, this.index).replace(/\n/g, " ") : "";
        lines.push(`> | ${rollStr} | ${content} |`);
      }
    }
    lines.push("");
  }

  /**
   * Writes the entity to a vault markdown file, handling conflict resolution if required.
   */
  async writeEntityFile(entity: Entity, folderPath: string): Promise<void> {
    const fileName = `${sanitizeFileName(entity.displayName || entity.name)}.md`;
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    // Check if parent directory exists, if not create it
    await this.assetManager.ensureFolderExists(folderPath);

    const newContent = await this.buildEntityMarkdown(entity);
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      // Check for conflict
      const cache = this.app.metadataCache.getFileCache(existingFile);
      const lastSyncStr = cache?.frontmatter?.["harpy-last-sync"];
      const fileMtime = existingFile.stat.mtime;

      if (lastSyncStr) {
        const lastSyncTime = Date.parse(lastSyncStr);
        // If file modified locally (allow a 2 second buffer for fs latency)
        if (!isNaN(lastSyncTime) && fileMtime > lastSyncTime + 2000) {
          // Sync Conflict: Keep both versions
          console.warn(`Harpy Sync: Conflict detected in note "${filePath}". Keep both versions.`);
          const existingText = await this.app.vault.read(existingFile);
          const localTextClean = stripFrontmatter(existingText);

          // Construct merged note
          const mergedLines: string[] = [];
          
          // Put the new YAML frontmatter at the very top (so Obsidian metadata matches the new synced state)
          const newFrontmatterOnly = newContent.match(/^---[\s\S]*?---/)?.[0] || "";
          const newContentClean = stripFrontmatter(newContent);

          mergedLines.push(newFrontmatterOnly);
          mergedLines.push("");
          mergedLines.push("> [!warning] Sync Conflict");
          mergedLines.push("> This note was modified both locally in Obsidian and on Harpy.gg. Both versions have been preserved below. Please resolve conflicts and clean this up.");
          mergedLines.push("");
          mergedLines.push("=== HARPY VERSION ===");
          mergedLines.push(newContentClean);
          mergedLines.push("");
          mergedLines.push("=== LOCAL VERSION ===");
          mergedLines.push(localTextClean);

          await this.app.vault.modify(existingFile, mergedLines.join("\n"));
          return;
        }
      }
      
      // No conflict: Overwrite
      await this.app.vault.modify(existingFile, newContent);
    } else {
      // File does not exist: Create it
      await this.app.vault.create(filePath, newContent);
    }
  }
}
