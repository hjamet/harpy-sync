import { TFile, App, stringifyYaml } from "obsidian";
import { BundleIndex, sanitizeFileName } from "./parser";
import { AssetManager } from "./asset-manager";
import { Entity, Page, Chunk, RandomTable, Scene, SceneMap, SceneBackground } from "../types";

/**
 * Strips the top YAML frontmatter block from a file's content.
 */
export function stripFrontmatter(content: string): string {
  if (!content) return "";
  const trimmed = content.trimStart();
  if (trimmed.startsWith("---")) {
    const parts = trimmed.split("---");
    if (parts.length >= 3) {
      return parts.slice(2).join("---").trim();
    }
  }
  return content.trim();
}

/**
 * Formats a variable value according to its definition schema in the bundle index.
 */
export function formatVariableValue(val: any, variable: any, index: BundleIndex): string | null {
  if (val === undefined || val === null || val === "") return null;

  // Handle Choice variables
  if (variable?.type === "choice" && variable.options) {
    if (Array.isArray(val)) {
      const labels = val.map((v) => {
        const opt = variable.options.find((o: any) => o.uid === v || o.id === v);
        return opt ? (opt.label || opt.name || opt.title || opt.value || v) : v;
      });
      return labels.join(", ");
    }
    const opt = variable.options.find((o: any) => o.uid === val || o.id === val);
    if (opt) return opt.label || opt.name || opt.title || opt.value || String(val);
  }

  // Handle Entity References
  if (variable?.type === "entityRef" && typeof val === "string" && index) {
    const targetEntity = index.entities.get(val);
    if (targetEntity) {
      return `[[${targetEntity.displayName || targetEntity.name}]]`;
    }
  }

  // Handle Data Table References
  if (variable?.type === "dataTableRef" && typeof val === "string" && index) {
    const dt = index.dataTables.get(val);
    if (dt) return (dt as any).name || val;
    for (const dataTable of index.dataTables.values()) {
      if (dataTable.rows) {
        const row = dataTable.rows.find((r) => r.uid === val);
        if (row && row.data) {
          const firstVal = Object.values(row.data).find((v) => typeof v === "string" && v);
          if (firstVal) return String(firstVal);
        }
      }
    }
  }

  // Handle Booleans
  if (typeof val === "boolean") {
    return val ? "Oui" : "Non";
  }

  // Handle Objects / Arrays
  if (typeof val === "object") {
    return JSON.stringify(val);
  }

  return String(val);
}

/**
 * Cleans HTML content, resolves dynamic variables (<span data-variable="...">),
 * and converts HTML elements into clean Markdown structure.
 */
export function cleanHtmlContent(content: string, entityData: Record<string, any> | undefined, index: BundleIndex): string {
  if (!content) return "";
  let text = content;

  // 1. Substitute dynamic variables (<span data-variable="UID">...</span>)
  text = text.replace(/<span\b[^>]*?\bdata-variable="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi, (match, varUid) => {
    const val = entityData ? entityData[varUid] : undefined;
    const variable = index ? index.variables.get(varUid) : null;
    const displayVal = formatVariableValue(val !== undefined ? val : (variable as any)?.defaultValue, variable, index);
    return displayVal !== null && displayVal !== undefined ? displayVal : "";
  });

  // 2. Remove <style> and <script> blocks completely (with inner content)
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // 3. Convert HTML Headings
  text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  text = text.replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  text = text.replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // 4. Convert HTML Lists
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  text = text.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n");

  // 5. Convert HTML line breaks and paragraph/div containers
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?(p|div)\b[^>]*>/gi, "\n");

  // 6. Convert inline styling (strong, b, em, i)
  text = text.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**");
  text = text.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");

  // 7. Convert HTML Table rows to Markdown table format
  text = text.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (match, rowContent) => {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      let cellText = cellMatch[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
      cells.push(cellText);
    }
    if (cells.length > 0) {
      return "| " + cells.join(" | ") + " |\n";
    }
    return "";
  });
  text = text.replace(/<\/?(table|tbody|thead|tfoot|colgroup|col)\b[^>]*>/gi, "\n");

  // 8. Strip visual wrapper tags (span, font, center, mark) preserving inner text
  text = text.replace(/<\/?(span|font|center|mark)\b[^>]*>/gi, "");

  // 9. Strip visual style/class attributes from any remaining HTML elements
  text = text.replace(/\s*(?:style|class|color|bgcolor|align|face|size)=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 10. Replace &nbsp; entity
  text = text.replace(/&nbsp;/gi, " ");

  // 11. Resolve internal Harpy entity links
  text = resolveEntityLinks(text, index);

  // 12. Clean up excessive newlines resulting from tag replacements
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

/**
 * Legacy wrapper function for backwards compatibility with tests and scanner.
 */
export function stripVisualHtml(content: string): string {
  if (!content) return "";
  let text = content;
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?(p|div)\b[^>]*>/gi, "\n");
  text = text.replace(/<\/?(span|font|center|mark)\b[^>]*>/gi, "");
  text = text.replace(/\s*(?:style|class|color|bgcolor|align|face|size)=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

/**
 * Resolves internal Harpy links to native Obsidian wikilinks.
 */
export function resolveEntityLinks(text: string, index: BundleIndex): string {
  if (!text) return "";
  
  // Replace HTML anchor links <a href="/entity/UID">Text</a> or <a href="harpy://entity/UID">Text</a>
  let resolved = text.replace(/<a\b[^>]*?\bhref="(?:https?:\/\/harpy\.gg)?\/entity\/([a-zA-Z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/gi, (match, uid, linkText) => {
    const targetEntity = index.entities.get(uid);
    if (targetEntity) {
      const entityName = targetEntity.displayName || targetEntity.name;
      const cleanLabel = linkText.replace(/<[^>]+>/g, "").trim();
      return `[[${entityName}|${cleanLabel || entityName}]]`;
    }
    return match;
  });

  // Replace Markdown links of the form [Name](/entity/UID) or [Name](harpy://entity/UID)
  resolved = resolved.replace(/\[([^\]]+)\]\((?:https?:\/\/harpy\.gg)?\/entity\/([a-zA-Z0-9_-]+)\)/g, (match, linkText, uid) => {
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
  async buildEntityMarkdown(entity: Entity, folderPath?: string): Promise<string> {
    const lines: string[] = [];

    const exportedAt = this.index.bundle.exportedAt || new Date().toISOString();
    const displayName = entity.displayName || entity.name;
    const targetFolderPath = folderPath !== undefined ? folderPath : this.index.getEntityFolderPath(entity, this.assetManager.importRoot || "");

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

    const scenesUids: string[] = (entity as any).scenesUids || (entity as any).scenes || [];
    if (scenesUids && scenesUids.length > 0) {
      frontmatter["scenesUids"] = scenesUids;
    }

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

    // 2.5 Add Callout Navigation (Chantier 3)
    const entityScenes: Scene[] = [];
    if (Array.isArray(scenesUids)) {
      for (const sUid of scenesUids) {
        const s = this.index.scenes.get(sUid);
        if (s && !entityScenes.some((sc) => sc.uid === s.uid)) {
          entityScenes.push(s);
        }
      }
    }
    for (const s of this.index.scenes.values()) {
      if ((s as any).entityUid === entity.uid && !entityScenes.some((sc) => sc.uid === s.uid)) {
        entityScenes.push(s);
      }
    }

    const navParts: string[] = ["[[#Fiche de personnage|📋 Fiche]]"];
    for (const scene of entityScenes) {
      const sceneName = scene.name || "Battle Map";
      const sanitizeName = sanitizeFileName(sceneName);
      const mapsFolder = targetFolderPath ? `${targetFolderPath}/Maps` : "Maps";
      const mapLinkPath = `${mapsFolder}/${sanitizeName}`;
      navParts.push(`[[${mapLinkPath}|🗺️ Battle Map : ${sceneName}]]`);
    }

    lines.push(`> [!info] 🧭 **Navigation** : ${navParts.join(" | ")}`);
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
      let descText = entity.description;
      const sheetSectionIdx = descText.indexOf("## Fiche de personnage");
      if (sheetSectionIdx !== -1) {
        descText = descText.substring(0, sheetSectionIdx).trim();
      }
      const cleanDesc = cleanHtmlContent(descText, entity.data, this.index);
      if (cleanDesc) {
        lines.push(cleanDesc);
        lines.push("");
      }
    }

    // 4. Render Character Sheets ('fiches' / 'character sheets')
    await this.renderCharacterSheets(entity, lines);

    // 5. Render Pages & Chunks
    const processedPageUids = new Set<string>();

    if (entity.pagesOrder) {
      for (const pageUid of entity.pagesOrder) {
        const page = this.index.pages.get(pageUid);
        if (page) {
          processedPageUids.add(page.uid);
          await this.renderPage(page, lines, entity.data);
        }
      }
    }

    for (const page of this.index.pages.values()) {
      if ((page as any).entityUid === entity.uid && !processedPageUids.has(page.uid)) {
        processedPageUids.add(page.uid);
        await this.renderPage(page, lines, entity.data);
      }
    }

    return lines.join("\n");
  }

  /**
   * Renders character sheets ('fiches') and variable data associated with an entity.
   */
  private async renderCharacterSheets(entity: Entity, lines: string[]): Promise<void> {
    if (!entity.data || typeof entity.data !== "object" || Object.keys(entity.data).length === 0) {
      return;
    }

    const sheets = this.index.bundle.sheets || [];
    const renderedVarUids = new Set<string>();
    let hasSheetSection = false;

    // 1. Group variables by defined sheets
    for (const sheet of sheets) {
      const sheetLines: string[] = [];
      if (sheet.widgetUids && sheet.widgetUids.length > 0) {
        for (const widgetUid of sheet.widgetUids) {
          const widget = this.index.bundle.widgets?.find((w) => w.uid === widgetUid);
          if (widget && widget.variableUid && !renderedVarUids.has(widget.variableUid)) {
            const vUid = widget.variableUid;
            const val = entity.data[vUid];
            const variable = this.index.variables.get(vUid);
            const formatted = formatVariableValue(val, variable, this.index);
            if (formatted !== null && formatted !== undefined && formatted.trim() !== "") {
              renderedVarUids.add(vUid);
              const label = variable?.name || variable?.label || vUid;
              const cleanVal = cleanHtmlContent(formatted.trim(), entity.data, this.index);
              if (cleanVal.includes("\n")) {
                sheetLines.push(`#### ${label}`);
                sheetLines.push(cleanVal);
                sheetLines.push("");
              } else {
                sheetLines.push(`- **${label}** : ${cleanVal}`);
              }
            }
          }
        }
      }

      if (sheetLines.length > 0 || sheet.name || sheet.originalUrl) {
        if (!hasSheetSection) {
          lines.push("## Fiche de personnage");
          lines.push("");
          hasSheetSection = true;
        }
        if (sheet.name) {
          lines.push(`### Fiche : ${sheet.name}`);
          lines.push("");
        }
        if (sheet.originalUrl) {
          const localPath = await this.assetManager.downloadUrl(sheet.originalUrl, `sheet_${sheet.name || sheet.uid}`);
          if (localPath) {
            lines.push(this.assetManager.toObsidianLink(localPath));
            lines.push("");
          }
        }
        if (sheetLines.length > 0) {
          lines.push(...sheetLines);
        }
        lines.push("");
      }
    }

    // 2. Render remaining variables in entity.data not assigned to any sheet
    const unrenderedLines: string[] = [];
    for (const [vUid, val] of Object.entries(entity.data)) {
      if (!renderedVarUids.has(vUid)) {
        const variable = this.index.variables.get(vUid);
        const formatted = formatVariableValue(val, variable, this.index);
        if (formatted !== null && formatted !== undefined && formatted.trim() !== "") {
          renderedVarUids.add(vUid);
          const label = variable?.name || variable?.label || vUid;
          const cleanVal = cleanHtmlContent(formatted.trim(), entity.data, this.index);
          if (cleanVal.includes("\n")) {
            unrenderedLines.push(`#### ${label}`);
            unrenderedLines.push(cleanVal);
            unrenderedLines.push("");
          } else {
            unrenderedLines.push(`- **${label}** : ${cleanVal}`);
          }
        }
      }
    }

    if (unrenderedLines.length > 0) {
      if (!hasSheetSection) {
        lines.push("## Fiche de personnage");
        lines.push("");
      } else {
        lines.push("### Informations complémentaires");
        lines.push("");
      }
      lines.push(...unrenderedLines);
      lines.push("");
    }
  }

  /**
   * Renders a single Page and its Chunks.
   */
  private async renderPage(page: Page, lines: string[], entityData?: Record<string, any>): Promise<void> {
    const nameAttr = (page as any).name ? ` name="${encodeURIComponent((page as any).name)}"` : "";
    const typeAttr = page.type ? ` type="${page.type}"` : "";
    lines.push(`<!-- harpy:page uid="${page.uid}"${nameAttr}${typeAttr} -->`);

    if ((page as any).name) {
      lines.push(`# ${(page as any).name}`);
      lines.push("");
    }

    if ((page as any).content) {
      const cleanPageContent = cleanHtmlContent((page as any).content, entityData, this.index);
      if (cleanPageContent) {
        lines.push(cleanPageContent);
        lines.push("");
      }
    }

    const pageChunkUids = (page as any).chunksOrder || (page as any).chunkUids || [];
    if (pageChunkUids.length > 0) {
      for (const chunkUid of pageChunkUids) {
        const chunk = this.index.chunks.get(chunkUid);
        if (chunk) {
          await this.renderChunk(chunk, lines, entityData);
        }
      }
    }
  }

  /**
   * Renders a single Chunk.
   */
  private async renderChunk(chunk: Chunk, lines: string[], entityData?: Record<string, any>): Promise<void> {
    const nameAttr = chunk.name ? ` name="${encodeURIComponent(chunk.name)}"` : "";
    const typeAttr = ` type="${chunk.type}"`;
    lines.push(`<!-- harpy:chunk uid="${chunk.uid}"${typeAttr}${nameAttr} -->`);

    if (chunk.name) {
      lines.push(`## ${chunk.name}`);
      lines.push("");
    }

    switch (chunk.type) {
      case "text": {
        if (chunk.content) {
          const cleanText = cleanHtmlContent(chunk.content, entityData, this.index);
          if (cleanText) {
            lines.push(cleanText);
          }
        }
        lines.push("");
        break;
      }

      case "textProxy" as any: {
        if ((chunk as any).chunkUid) {
          const targetChunk = this.index.chunks.get((chunk as any).chunkUid);
          if (targetChunk) {
            await this.renderChunkContent(targetChunk, lines, entityData);
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
        if ((chunk as any).content) {
          const cleanText = cleanHtmlContent((chunk as any).content, entityData, this.index);
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
  private async renderChunkContent(chunk: Chunk, lines: string[], entityData?: Record<string, any>): Promise<void> {
    if (chunk.type === "text" && chunk.content) {
      const cleanText = cleanHtmlContent(chunk.content, entityData, this.index);
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
        const content = row.content ? cleanHtmlContent(row.content, undefined, this.index).replace(/\n/g, " ") : "";
        lines.push(`> | ${rollStr} | ${content} |`);
      }
    }
    lines.push("");
  }

  /**
   * Generates the Markdown content for a Battle Map note.
   */
  async buildBattleMapMarkdown(scene: Scene, entity?: Entity, entityFolderPath: string = ""): Promise<{ content: string; mapPath: string }> {
    const lines: string[] = [];
    const exportedAt = this.index.bundle.exportedAt || new Date().toISOString();
    const sceneName = scene.name || "Battle Map";
    const sanitizeName = sanitizeFileName(sceneName);

    // Frontmatter
    const frontmatter: Record<string, any> = {
      "harpy-uid": scene.uid,
      "uid": scene.uid,
      displayName: sceneName,
      "harpy-last-sync": exportedAt,
      "lastSync": exportedAt,
      type: "battlemap",
    };
    if (scene.mapUid) frontmatter["mapUid"] = scene.mapUid;
    if (scene.backgroundUid) frontmatter["backgroundUid"] = scene.backgroundUid;
    if (entity) frontmatter["entityUid"] = entity.uid;

    lines.push("---");
    lines.push(stringifyYaml(frontmatter).trim());
    lines.push("---");
    lines.push("");

    // Title
    lines.push(`# 🗺️ Battle Map : ${sceneName}`);
    lines.push("");

    // Entity Link Back
    if (entity) {
      const entityName = entity.displayName || entity.name;
      lines.push(`**Entité** : [[${entityName}]]`);
      lines.push("");
    }

    // Download Background / Map Image
    let imageUrl = "";
    let gridData: any = null;

    if (scene.mapUid) {
      const sceneMap = this.index.sceneMaps.get(scene.mapUid);
      if (sceneMap) {
        imageUrl = (sceneMap as any).originalUrl || (sceneMap as any).thumbnailUrl || (sceneMap as any).url || (sceneMap as any).images?.[0] || "";
        gridData = sceneMap.grid;
      }
    }
    if (!imageUrl && scene.backgroundUid) {
      const sceneBg = this.index.sceneBackgrounds.get(scene.backgroundUid);
      if (sceneBg) {
        imageUrl = (sceneBg as any).originalUrl || (sceneBg as any).thumbnailUrl || (sceneBg as any).url || "";
      }
    }
    if (!imageUrl) {
      const asset = this.index.assets.get(scene.mapUid || scene.backgroundUid || scene.uid);
      if (asset) {
        imageUrl = asset.originalUrl || asset.thumbnailUrl || "";
      }
    }

    if (imageUrl) {
      const localPath = await this.assetManager.downloadUrl(imageUrl, `map_${sanitizeName}`);
      if (localPath) {
        lines.push(this.assetManager.toObsidianLink(localPath));
        lines.push("");
      }
    }

    // Grid & Scale Table
    if (gridData) {
      lines.push("### Spécifications de Grille & Échelle");
      lines.push("");
      lines.push("| Propriété | Valeur |");
      lines.push("| --- | --- |");
      lines.push(`| **Type de grille** | ${gridData.type || "square"} |`);
      lines.push(`| **Taille cellule** | ${gridData.size !== undefined ? gridData.size + " px" : "-"} |`);
      const scaleStr = gridData.sizeInUnit !== undefined && gridData.measureUnit ? `${gridData.sizeInUnit} ${gridData.measureUnit}` : "-";
      lines.push(`| **Échelle (unité)** | ${scaleStr} |`);
      lines.push(`| **Épaisseur ligne** | ${gridData.lineWidth !== undefined ? gridData.lineWidth + " px" : "-"} |`);
      lines.push("");
    }

    const mapsFolder = entityFolderPath ? `${entityFolderPath}/Maps` : "Maps";
    const mapPath = `${mapsFolder}/${sanitizeName}`;

    return { content: lines.join("\n"), mapPath };
  }

  /**
   * Writes dedicated Battle Map note file to vault.
   */
  async writeBattleMapFile(scene: Scene, entityFolderPath: string, entity?: Entity): Promise<string> {
    const { content, mapPath } = await this.buildBattleMapMarkdown(scene, entity, entityFolderPath);
    const filePath = `${mapPath}.md`;
    const folderPath = mapPath.substring(0, mapPath.lastIndexOf("/"));

    await this.assetManager.ensureFolderExists(folderPath);

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    return mapPath;
  }

  /**
   * Writes all Battle Map notes from bundle to vault.
   */
  async writeAllBattleMapFiles(importRoot: string): Promise<void> {
    if (!this.index.bundle.scenes || this.index.bundle.scenes.length === 0) return;
    for (const scene of this.index.bundle.scenes) {
      let linkedEntity: Entity | undefined;
      for (const entity of this.index.bundle.entities || []) {
        const scenesUids: string[] = (entity as any).scenesUids || (entity as any).scenes || [];
        if (scenesUids.includes(scene.uid) || (scene as any).entityUid === entity.uid) {
          linkedEntity = entity;
          break;
        }
      }
      const folderPath = linkedEntity ? this.index.getEntityFolderPath(linkedEntity, importRoot) : importRoot;
      await this.writeBattleMapFile(scene, folderPath, linkedEntity);
    }
  }

  /**
   * Writes the entity to a vault markdown file, resolving filename collisions if required.
   */
  async writeEntityFile(entity: Entity, folderPath: string): Promise<void> {
    const baseName = sanitizeFileName(entity.displayName || entity.name);

    // Security Exception: NEVER overwrite or alter Barnabé Limon Sec
    if (
      baseName === "Barnabé Limon Sec" ||
      baseName === "Barnabe Limon Sec" ||
      baseName.toLowerCase().includes("barnab") ||
      (entity.name && entity.name.toLowerCase().includes("barnab"))
    ) {
      console.log("Skipping protected canonical file: Barnabé Limon Sec");
      return;
    }

    let fileName = `${baseName}.md`;
    let filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    // Resolve file name collisions for different entities
    if (this.usedPaths.has(filePath) && this.usedPaths.get(filePath) !== entity.uid) {
      fileName = `${baseName}_${entity.uid}.md`;
      filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
    }
    this.usedPaths.set(filePath, entity.uid);

    await this.assetManager.ensureFolderExists(folderPath);

    const newContent = await this.buildEntityMarkdown(entity, folderPath);
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, newContent);
    } else {
      await this.app.vault.create(filePath, newContent);
    }

    // Write any linked Battle Map notes
    const scenesUids: string[] = (entity as any).scenesUids || (entity as any).scenes || [];
    const entityScenes: Scene[] = [];
    if (Array.isArray(scenesUids)) {
      for (const sUid of scenesUids) {
        const s = this.index.scenes.get(sUid);
        if (s && !entityScenes.some((sc) => sc.uid === s.uid)) entityScenes.push(s);
      }
    }
    for (const s of this.index.scenes.values()) {
      if ((s as any).entityUid === entity.uid && !entityScenes.some((sc) => sc.uid === s.uid)) {
        entityScenes.push(s);
      }
    }
    for (const scene of entityScenes) {
      await this.writeBattleMapFile(scene, folderPath, entity);
    }
  }
}

