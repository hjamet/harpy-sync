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
 * Strips visual HTML tags (spans, fonts, styles, inline CSS attributes, etc.)
 * while keeping clean Markdown structure and text content.
 */
export function stripVisualHtml(content: string): string {
  if (!content) return "";
  let text = content;

  // 1. Remove <style> and <script> blocks completely (with inner content)
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // 2. Convert HTML block/break elements to clean line breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?(p|div)\b[^>]*>/gi, "\n");

  // 3. Strip visual wrapper tags (span, font, center, mark) preserving inner text
  text = text.replace(/<\/?(span|font|center|mark)\b[^>]*>/gi, "");

  // 4. Strip visual style/class attributes from any remaining HTML elements
  text = text.replace(/\s*(?:style|class|color|bgcolor|align|face|size)=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 5. Clean up excessive newlines resulting from tag replacements
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
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
  // Map of written file paths to entity UIDs to prevent filename collisions
  usedPaths = new Map<string, string>();

  constructor(app: App, index: BundleIndex, assetManager: AssetManager) {
    this.app = app;
    this.index = index;
    this.assetManager = assetManager;
  }

  /**
   * Writes global campaign metadata manifest file (_harpy_manifest.json) into vault.
   */
  async writeManifestFile(folderPath: string): Promise<void> {
    const manifestPath = folderPath ? `${folderPath}/_harpy_manifest.json` : "_harpy_manifest.json";
    const manifestData = {
      version: this.index.bundle.version,
      format: this.index.bundle.format,
      name: this.index.bundle.name,
      exportedAt: this.index.bundle.exportedAt,
      bundleVersion: this.index.bundle.bundleVersion,
      license: this.index.bundle.license,
      licenseVersion: this.index.bundle.licenseVersion,
      attribution: this.index.bundle.attribution,
      variables: this.index.bundle.variables || [],
      tags: this.index.bundle.tags || [],
      tagCategories: this.index.bundle.tagCategories || [],
      sheets: this.index.bundle.sheets || [],
      dataTables: this.index.bundle.dataTables || [],
      scenes: this.index.bundle.scenes || [],
      sceneMaps: this.index.bundle.sceneMaps || [],
      sceneBackgrounds: this.index.bundle.sceneBackgrounds || [],
      widgets: this.index.bundle.widgets || []
    };

    await this.assetManager.ensureFolderExists(folderPath);
    const content = JSON.stringify(manifestData, null, 2);
    const existingFile = this.app.vault.getAbstractFileByPath(manifestPath);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(manifestPath, content);
    }
  }

  /**
   * Generates the complete Markdown string for an entity.
   */
  async buildEntityMarkdown(entity: Entity): Promise<string> {
    const lines: string[] = [];

    const exportedAt = this.index.bundle.exportedAt || new Date().toISOString();
    const displayName = entity.displayName || entity.name;

    // 1. Generate YAML Frontmatter
    const frontmatter: Record<string, any> = {
      "harpy-uid": entity.uid,
      "uid": entity.uid,
      displayName: displayName,
      "harpy-last-sync": exportedAt,
      "lastSync": exportedAt,
      type: entity.type,
      tags: this.index.getEntityTagNames(entity),
    };

    if (entity.data && typeof entity.data === "object") {
      frontmatter["harpy-data"] = entity.data;
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
      const cleanDesc = resolveEntityLinks(stripVisualHtml(entity.description), this.index);
      if (cleanDesc) {
        lines.push(cleanDesc);
        lines.push("");
      }
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
    const nameAttr = page.name ? ` name="${encodeURIComponent(page.name)}"` : "";
    const typeAttr = page.type ? ` type="${page.type}"` : "";
    lines.push(`<!-- harpy:page uid="${page.uid}"${nameAttr}${typeAttr} -->`);

    if (page.name) {
      lines.push(`# ${page.name}`);
      lines.push("");
    }

    if (page.chunksOrder) {
      for (const chunkUid of page.chunksOrder) {
        const chunk = this.index.chunks.get(chunkUid);
        if (chunk) {
          await this.renderChunk(chunk, lines);
        }
      }
    }
  }

  /**
   * Renders a single Chunk.
   */
  private async renderChunk(chunk: Chunk, lines: string[]): Promise<void> {
    const nameAttr = chunk.name ? ` name="${encodeURIComponent(chunk.name)}"` : "";
    const typeAttr = ` type="${chunk.type}"`;
    lines.push(`<!-- harpy:chunk uid="${chunk.uid}"${typeAttr}${nameAttr} -->`);

    switch (chunk.type) {
      case "text": {
        if (chunk.content) {
          const cleanText = resolveEntityLinks(stripVisualHtml(chunk.content), this.index);
          if (cleanText) {
            lines.push(cleanText);
          }
        }
        lines.push("");
        break;
      }

      case "textProxy": {
        if (chunk.chunkUid) {
          const targetChunk = this.index.chunks.get(chunk.chunkUid);
          if (targetChunk) {
            await this.renderChunkContent(targetChunk, lines);
          }
        }
        lines.push("");
        break;
      }

      case "gallery": {
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
          }
        }
        lines.push("");
        break;
      }

      case "random": {
        if (chunk.randomTableUid) {
          const table = this.index.randomTables.get(chunk.randomTableUid);
          if (table) {
            this.renderRandomTable(table, lines);
          }
        }
        lines.push("");
        break;
      }

      default: {
        if (chunk.content) {
          const cleanText = resolveEntityLinks(stripVisualHtml(chunk.content), this.index);
          if (cleanText) {
            lines.push(cleanText);
          }
        }
        lines.push("");
        break;
      }
    }
  }

  /**
   * Helper to render the inner content of a target chunk (e.g. for textProxy).
   */
  private async renderChunkContent(chunk: Chunk, lines: string[]): Promise<void> {
    if (chunk.type === "text" && chunk.content) {
      const cleanText = resolveEntityLinks(stripVisualHtml(chunk.content), this.index);
      if (cleanText) {
        lines.push(cleanText);
        lines.push("");
      }
    } else if (chunk.type === "random" && chunk.randomTableUid) {
      const table = this.index.randomTables.get(chunk.randomTableUid);
      if (table) {
        this.renderRandomTable(table, lines);
      }
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
      const sortedRows = [...table.rows].sort((a, b) => (a.range ?? 0) - (b.range ?? 0));
      for (const row of sortedRows) {
        const rollStr = row.range !== undefined ? row.range.toString() : "-";
        const content = row.content ? resolveEntityLinks(stripVisualHtml(row.content), this.index).replace(/\n/g, " ") : "";
        lines.push(`> | ${rollStr} | ${content} |`);
      }
    }
    lines.push("");
  }

  /**
   * Writes the entity to a vault markdown file, resolving filename collisions if required.
   */
  async writeEntityFile(entity: Entity, folderPath: string): Promise<void> {
    const baseName = sanitizeFileName(entity.displayName || entity.name);
    let fileName = `${baseName}.md`;
    let filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    // Resolve file name collisions for different entities
    if (this.usedPaths.has(filePath) && this.usedPaths.get(filePath) !== entity.uid) {
      fileName = `${baseName}_${entity.uid}.md`;
      filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
    }
    this.usedPaths.set(filePath, entity.uid);

    await this.assetManager.ensureFolderExists(folderPath);

    const newContent = await this.buildEntityMarkdown(entity);
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, newContent);
    } else {
      await this.app.vault.create(filePath, newContent);
    }
  }
}
