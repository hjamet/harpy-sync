import { App, TFile, TFolder } from "obsidian";
import { Entity, Page, Chunk, RandomTable, Tag, Variable, Asset, BeyondPaper } from "../types";
import { stripFrontmatter } from "../import/markdown-builder";
import { sanitizeFileName } from "../import/parser";
import { BYPP_FORMAT_VERSION } from "bypp-format";

function generateUid(): string {
  return Math.random().toString(36).substring(2, 12);
}

export class VaultScanner {
  app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Recursively collects all markdown files under a given folder.
   */
  private collectMarkdownFiles(folder: TFolder, files: TFile[]): void {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        // Exclude manifest file from entity collection
        if (child.basename !== "_harpy_manifest") {
          files.push(child);
        }
      } else if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, files);
      }
    }
  }

  /**
   * Restores Obsidian wikilinks [[Entity Name|Text]] back to Harpy /entity/UID links.
   */
  private restoreEntityLinks(text: string, entityMap: Map<string, string>): string {
    if (!text) return "";
    return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, entityName, alias) => {
      const linkText = alias || entityName;
      const targetUid = entityMap.get(entityName.trim());
      if (targetUid) {
        return `[${linkText}](/entity/${targetUid})`;
      }
      return match;
    });
  }

  /**
   * Scans a vault folder and builds a valid Beyond Paper (.bypp) campaign bundle.
   */
  async scanFolder(folderPath: string, campaignName: string): Promise<BeyondPaper> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      throw new Error(`Folder not found: ${folderPath}`);
    }

    // Try loading _harpy_manifest.json if present
    let manifestData: any = null;
    const manifestPath = folderPath ? `${folderPath}/_harpy_manifest.json` : "_harpy_manifest.json";
    const manifestFile = this.app.vault.getAbstractFileByPath(manifestPath);
    if (manifestFile instanceof TFile) {
      try {
        const manifestContent = await this.app.vault.read(manifestFile);
        manifestData = JSON.parse(manifestContent);
      } catch (e) {
        console.warn("VaultScanner: could not parse _harpy_manifest.json:", e);
      }
    }

    const mdFiles: TFile[] = [];
    this.collectMarkdownFiles(folder, mdFiles);

    const entities: Entity[] = [];
    const pages: Page[] = [];
    const chunks: Chunk[] = [];
    const randomTables: RandomTable[] = [];
    const assets: Asset[] = [];

    // Pre-populate global campaign arrays from manifest
    const variables: Variable[] = manifestData?.variables ? [...manifestData.variables] : [];
    const tags: Tag[] = manifestData?.tags ? [...manifestData.tags] : [];
    const tagCategories = manifestData?.tagCategories || [];
    const sheets = manifestData?.sheets || [];
    const dataTables = manifestData?.dataTables || [];
    const scenes = manifestData?.scenes || [];
    const sceneMaps = manifestData?.sceneMaps || [];
    const sceneBackgrounds = manifestData?.sceneBackgrounds || [];
    const widgets = manifestData?.widgets || [];

    // Helper maps to deduplicate tags and variables
    const tagMap = new Map<string, string>(); // name -> uid
    tags.forEach((t) => tagMap.set(t.name, t.uid));

    const varMap = new Map<string, string>(); // name -> uid
    variables.forEach((v) => varMap.set(v.name, v.uid));

    // Pass 1: Build entity map (name / displayName -> harpy-uid)
    const entityMap = new Map<string, string>();
    const fileCacheList: { file: TFile; frontmatter: Record<string, any>; cleanContent: string; entityUid: string; displayName: string }[] = [];

    for (const file of mdFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};
      const fileContent = await this.app.vault.read(file);
      const cleanContent = stripFrontmatter(fileContent);

      const entityUid = frontmatter["harpy-uid"] || frontmatter["uid"] || generateUid();
      const displayName = frontmatter["displayName"] || file.basename;

      entityMap.set(displayName, entityUid);
      entityMap.set(sanitizeFileName(displayName), entityUid);
      entityMap.set(file.basename, entityUid);

      fileCacheList.push({ file, frontmatter, cleanContent, entityUid, displayName });
    }

    // Pass 2: Process files, parse pages/chunks with HTML metadata tags, and construct .bypp structure
    for (const item of fileCacheList) {
      const { file, frontmatter, cleanContent, entityUid, displayName } = item;
      const entityType = frontmatter["type"] || "note";

      // 1. Process Tags
      const tagsUid: string[] = [];
      const rawTags = frontmatter["tags"];
      const fileTags: string[] = Array.isArray(rawTags)
        ? rawTags
        : typeof rawTags === "string"
        ? [rawTags]
        : [];
      for (const tagName of fileTags) {
        if (typeof tagName !== "string" || !tagName.trim()) continue;
        let tagUid = tagMap.get(tagName);
        if (!tagUid) {
          tagUid = generateUid();
          tagMap.set(tagName, tagUid);
          const isFolder = file.parent ? file.parent.name === tagName : false;
          tags.push({
            uid: tagUid,
            name: tagName,
            categoryUid: "",
            useAsFolder: isFolder
          });
        }
        tagsUid.push(tagUid);
      }

      // 2. Process Variables & Entity Data
      let entityData: Record<string, any> = {};
      if (frontmatter["harpy-data"] && typeof frontmatter["harpy-data"] === "object" && !Array.isArray(frontmatter["harpy-data"])) {
        entityData = frontmatter["harpy-data"];
      } else {
        const rawVars = frontmatter["variables"];
        const fileVars = rawVars && typeof rawVars === "object" && !Array.isArray(rawVars) ? rawVars : {};
        for (const [varName, varVal] of Object.entries(fileVars)) {
          let varObj = variables.find((v) => v.name === varName || v.label === varName || v.uid === varName);
          let varUid = varObj?.uid || varMap.get(varName);
          if (!varUid) {
            varUid = generateUid();
            varMap.set(varName, varUid);
            const varType = typeof varVal === "number" ? "number" : typeof varVal === "boolean" ? "boolean" : "text";
            const defaultVal = varType === "number" ? 0 : varType === "boolean" ? false : "";
            variables.push({
              uid: varUid,
              name: varName,
              datasetsUids: [],
              isMandatory: false,
              isHiddenFromSheet: false,
              label: varName,
              type: varType,
              defaultValue: defaultVal
            } as any);
          }
          entityData[varUid] = varVal;
        }
      }
      if (!entityData || typeof entityData !== "object" || Array.isArray(entityData)) {
        entityData = {};
      }

      // 3. Parse Markdown content (extract HTML metadata tags for Pages & Chunks)
      const { description, profileUrl, pages: filePages, chunks: fileChunks } = this.parseMarkdownContent(
        cleanContent,
        displayName,
        randomTables,
        assets,
        entityMap
      );

      const pagesOrder: string[] = [];
      for (const page of filePages) {
        pagesOrder.push(page.uid);
        pages.push({
          ...page,
          entityUid
        });
      }

      for (const chunk of fileChunks) {
        chunks.push(chunk);
      }

      // 4. Assemble Entity
      entities.push({
        uid: entityUid,
        name: sanitizeFileName(displayName),
        displayName,
        description: this.restoreEntityLinks(description, entityMap),
        tagsUid,
        type: entityType,
        originalUrl: profileUrl.startsWith("http") ? profileUrl : undefined,
        pagesOrder,
        data: entityData,
        assetUids: []
      } as any);
    }

    return {
      version: manifestData?.version || BYPP_FORMAT_VERSION,
      format: manifestData?.format || "bypp",
      name: manifestData?.name || campaignName,
      exportedAt: new Date().toISOString(),
      bundleVersion: manifestData?.bundleVersion || "1.0.0",
      license: manifestData?.license || "ARR",
      licenseVersion: manifestData?.licenseVersion || "4.0",
      attribution: manifestData?.attribution || { authorName: "Obsidian Export" },
      entities,
      pages,
      chunks,
      variables,
      tags,
      tagCategories,
      randomTables,
      assets,
      sheets,
      dataTables,
      scenes,
      sceneMaps,
      sceneBackgrounds,
      widgets
    } as any;
  }

  /**
   * Splits markdown text into entity description and page blocks, using invisible HTML tags when present.
   */
  private parseMarkdownContent(
    cleanContent: string,
    displayName: string,
    randomTables: RandomTable[],
    assets: Asset[],
    entityMap: Map<string, string>
  ): { description: string; profileUrl: string; pages: Page[]; chunks: Chunk[] } {
    const lines = cleanContent.split("\n");

    const descriptionLines: string[] = [];
    const pageBlocks: { uid: string | null; name: string; lines: string[] }[] = [];
    let currentBlock: { uid: string | null; name: string; lines: string[] } | null = null;

    const hasPageTags = /<!--\s*harpy:page\s+/i.test(cleanContent);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Regex matching invisible HTML page tag: <!-- harpy:page ... -->
      const pageTagMatch = line.match(/<!--\s*harpy:page\s+([^>]*?)-->/i);

      if (pageTagMatch) {
        const tagAttrs = pageTagMatch[1];
        const uidM = tagAttrs.match(/\buid=["']([^"']+)["']/i);
        const nameM = tagAttrs.match(/\bname=["']([^"']+)["']/i);
        const typeM = tagAttrs.match(/\btype=["']([^"']+)["']/i);

        const pageUid = uidM ? uidM[1] : generateUid();
        let pageName = nameM ? decodeURIComponent(nameM[1]) : "";
        const pageType = typeM ? typeM[1] : "standard";

        if (i + 1 < lines.length && lines[i + 1].startsWith("# ")) {
          const headerName = lines[i + 1].substring(2).trim();
          if (headerName) pageName = headerName;
          i++; // Skip the # Page Name header line
        }

        currentBlock = { uid: pageUid, name: pageName, type: pageType, lines: [] };
        pageBlocks.push(currentBlock);
        continue;
      }

      // Matching Markdown header # Page Name
      if (line.startsWith("# ")) {
        const headerTitle = line.substring(2).trim();

        if (currentBlock !== null) {
          currentBlock = { uid: null, name: headerTitle, type: "standard", lines: [] };
          pageBlocks.push(currentBlock);
        } else {
          if (headerTitle === displayName) {
            // Main entity title header - skip
          } else if (!hasPageTags) {
            currentBlock = { uid: null, name: headerTitle, type: "standard", lines: [] };
            pageBlocks.push(currentBlock);
          } else {
            descriptionLines.push(line);
          }
        }
        continue;
      }

      if (currentBlock !== null) {
        currentBlock.lines.push(line);
      } else {
        descriptionLines.push(line);
      }
    }

    const descriptionText = descriptionLines.join("\n").trim();
    let profileUrl = "";
    const profileMatch = descriptionText.match(/!\[\[(.*?)\]\]/);
    if (profileMatch) {
      profileUrl = profileMatch[1];
    }
    const finalDescription = descriptionText.replace(/!\[\[.*?\]\]\n?/, "").trim();

    const pages: Page[] = [];
    const chunks: Chunk[] = [];

    for (const block of pageBlocks) {
      const pageUid = block.uid || generateUid();
      const chunksOrder: string[] = [];

      const parsedChunks = this.parsePageChunks(block.lines, randomTables, assets, entityMap);
      for (const chunk of parsedChunks) {
        chunksOrder.push(chunk.uid);
        chunks.push(chunk);
      }

      pages.push({
        uid: pageUid,
        name: block.name,
        type: (block as any).type || "standard",
        chunksOrder
      });
    }

    return {
      description: finalDescription,
      profileUrl,
      pages,
      chunks
    };
  }

  /**
   * Parses page lines into Chunks, reconstructing original chunk UIDs from invisible HTML tags when present.
   */
  private parsePageChunks(
    lines: string[],
    randomTables: RandomTable[],
    assets: Asset[],
    entityMap: Map<string, string>
  ): Chunk[] {
    const chunks: Chunk[] = [];

    interface RawChunk {
      explicitUid: string | null;
      explicitType: string;
      explicitName: string;
      lines: string[];
    }

    const rawChunks: RawChunk[] = [];
    let currentRaw: RawChunk | null = null;

    for (const line of lines) {
      // Regex matching invisible HTML chunk tag: <!-- harpy:chunk ... -->
      const chunkTagMatch = line.match(/<!--\s*harpy:chunk\s+([^>]*?)-->/i);

      if (chunkTagMatch) {
        if (currentRaw !== null) {
          rawChunks.push(currentRaw);
        }
        const tagAttrs = chunkTagMatch[1];
        const uidM = tagAttrs.match(/\buid=["']([^"']+)["']/i);
        const typeM = tagAttrs.match(/\btype=["']([^"']+)["']/i);
        const nameM = tagAttrs.match(/\bname=["']([^"']+)["']/i);

        const explicitUid = uidM ? uidM[1] : null;
        const explicitType = typeM ? typeM[1] : "text";
        const explicitName = nameM ? decodeURIComponent(nameM[1]) : "";
        currentRaw = { explicitUid, explicitType, explicitName, lines: [] };
      } else {
        if (currentRaw === null) {
          currentRaw = { explicitUid: null, explicitType: "text", explicitName: "", lines: [] };
        }
        currentRaw.lines.push(line);
      }
    }

    if (currentRaw !== null) {
      rawChunks.push(currentRaw);
    }

    for (const raw of rawChunks) {
      const chunkUid = raw.explicitUid || generateUid();
      const blockLines = raw.lines;
      const rawText = blockLines.join("\n").trim();

      if (!rawText && !raw.explicitUid) {
        continue;
      }

      // Check if chunk is a Random Table callout
      const calloutIndex = blockLines.findIndex((l) =>
        l.startsWith("> [!example] Random Table:") || l.startsWith("> [!info] Random Table:")
      );
      if (calloutIndex !== -1) {
        const headerLine = blockLines[calloutIndex];
        const titleMatch = headerLine.match(/> \[!(?:example|info|quote)\] Random Table:\s*(.*?)\s*(?:\(Dice:\s*(.*?)\))?$/i);
        const tableTitle = titleMatch ? titleMatch[1].trim() : raw.explicitName || "Random Table";
        const diceFormula = titleMatch && titleMatch[2] ? titleMatch[2].trim() : "1d100";

        const rows: any[] = [];
        for (let k = calloutIndex + 1; k < blockLines.length; k++) {
          const rowLine = blockLines[k];
          if (!rowLine.startsWith(">")) break;

          const rowMatch = rowLine.match(/^>\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|/);
          if (rowMatch) {
            const rollStr = rowMatch[1].trim();
            const rowContent = rowMatch[2].trim();
            if (rollStr !== "Roll" && !rollStr.startsWith("---")) {
              const rollNum = parseInt(rollStr, 10);
              rows.push({
                uid: generateUid(),
                range: isNaN(rollNum) ? 0 : rollNum,
                content: this.restoreEntityLinks(rowContent, entityMap)
              });
            }
          }
        }

        const tableUid = generateUid();
        randomTables.push({
          uid: tableUid,
          title: tableTitle,
          diceFormula,
          rows
        });

        chunks.push({
          uid: chunkUid,
          name: tableTitle,
          type: "random",
          randomTableUid: tableUid,
          folded: false
        } as Chunk);
        continue;
      }

      // Check if chunk is a Gallery (contains image embeds)
      const imageRegex = /!\[\[(.*?)\]\]/g;
      const imagesInBlock = [...blockLines.join("\n").matchAll(imageRegex)].map((m) => m[1]);
      const textWithoutImages = blockLines.join("\n").replace(imageRegex, "").trim();

      if (imagesInBlock.length > 0 && textWithoutImages === "") {
        const assetUids: string[] = [];
        for (const imgName of imagesInBlock) {
          let asset = assets.find((a) => a.name === imgName || a.uid === imgName);
          if (!asset) {
            const assetUid = generateUid();
            const isUrl = imgName.startsWith("http");
            asset = {
              uid: assetUid,
              name: imgName,
              type: "image",
              originalUrl: isUrl ? imgName : undefined,
              thumbnailUrl: isUrl ? imgName : undefined,
              dimensions: { width: 0, height: 0 }
            } as Asset;
            assets.push(asset);
          }
          assetUids.push(asset.uid);
        }

        chunks.push({
          uid: chunkUid,
          name: raw.explicitName || "Gallery",
          type: "gallery",
          assetUids
        } as Chunk);
        continue;
      }

      // Default to Text chunk
      const restoredContent = this.restoreEntityLinks(rawText, entityMap);
      const chunkType = (raw.explicitType && raw.explicitType !== "random" && raw.explicitType !== "gallery") ? raw.explicitType : "text";
      chunks.push({
        uid: chunkUid,
        name: raw.explicitName || "",
        type: chunkType,
        content: restoredContent
      } as Chunk);
    }

    return chunks;
  }
}
