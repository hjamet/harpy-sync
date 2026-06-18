import { App, TFile, TFolder } from "obsidian";
import { Entity, Page, Chunk, RandomTable, Tag, Variable, Asset, BeyondPaper } from "../types";
import { stripFrontmatter } from "../import/markdown-builder";
import { sanitizeFileName } from "../import/parser";

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
        files.push(child);
      } else if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, files);
      }
    }
  }

  /**
   * Scans a vault folder and builds a valid Beyond Paper (.bypp) campaign bundle.
   */
  async scanFolder(folderPath: string, campaignName: string): Promise<BeyondPaper> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      throw new Error(`Folder not found: ${folderPath}`);
    }

    const mdFiles: TFile[] = [];
    this.collectMarkdownFiles(folder, mdFiles);

    const entities: Entity[] = [];
    const pages: Page[] = [];
    const chunks: Chunk[] = [];
    const randomTables: RandomTable[] = [];
    const tags: Tag[] = [];
    const variables: Variable[] = [];
    const assets: Asset[] = [];

    // Helper map to deduplicate tags and variables by name
    const tagMap = new Map<string, string>(); // name -> uid
    const varMap = new Map<string, string>(); // name -> uid

    for (const file of mdFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};

      const fileContent = await this.app.vault.read(file);
      const cleanContent = stripFrontmatter(fileContent);

      const entityUid = frontmatter["harpy-uid"] || generateUid();
      const entityType = frontmatter["type"] || "note";
      const displayName = file.basename;

      // 1. Process Tags
      const tagsUid: string[] = [];
      const fileTags: string[] = frontmatter["tags"] || [];
      for (const tagName of fileTags) {
        let tagUid = tagMap.get(tagName);
        if (!tagUid) {
          tagUid = generateUid();
          tagMap.set(tagName, tagUid);
          // Check if this tag represents a subfolder name (to preserve folder structure tag setting)
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

      // 2. Process Variables
      const entityData: Record<string, any> = {};
      const fileVars = frontmatter["variables"] || {};
      for (const [varName, varVal] of Object.entries(fileVars)) {
        let varUid = varMap.get(varName);
        if (!varUid) {
          varUid = generateUid();
          varMap.set(varName, varUid);
          const varType = typeof varVal === "number" ? "number" : typeof varVal === "boolean" ? "boolean" : "text";
          variables.push({
            uid: varUid,
            name: varName,
            datasetsUids: [],
            isMandatory: false,
            isHiddenFromSheet: false,
            label: varName,
            type: varType,
            defaultValue: ""
          } as any);
        }
        entityData[varUid] = varVal;
      }

      // 3. Parse Markdown content to build Pages & Chunks
      const pagesOrder: string[] = [];
      const { description, parsedPages } = this.parseMarkdownStructure(cleanContent);

      // Add profile image link to assets if present in description
      let profileUrl = "";
      const profileMatch = description.match(/!\[\[(.*?)\]\]/);
      if (profileMatch) {
        profileUrl = profileMatch[1];
      }

      // Process standard pages and chunks
      for (const parsedPage of parsedPages) {
        const pageUid = generateUid();
        pagesOrder.push(pageUid);

        const chunksOrder: string[] = [];
        
        // Parse the page content into chunks (text, random tables, galleries)
        const pageChunks = this.parsePageChunks(parsedPage.contentLines, randomTables, assets);
        for (const chunk of pageChunks) {
          chunksOrder.push(chunk.uid);
          chunks.push(chunk);
        }

        pages.push({
          uid: pageUid,
          name: parsedPage.name,
          type: "standard",
          chunksOrder
        });
      }

      // 4. Assemble Entity
      entities.push({
        uid: entityUid,
        name: sanitizeFileName(displayName),
        displayName,
        description: description.replace(/!\[\[.*?\]\]\n?/, "").trim(), // Strip profile img embed from description
        tagsUid,
        type: entityType,
        originalUrl: profileUrl,
        pagesOrder,
        data: entityData,
        assetUids: []
      } as any);
    }

    return {
      version: 2,
      format: "bypp",
      name: campaignName,
      exportedAt: new Date().toISOString(),
      bundleVersion: "1.0.0",
      entities,
      pages,
      chunks,
      variables,
      tags,
      tagCategories: [],
      randomTables,
      assets,
      sheets: [],
      dataTables: [],
      scenes: [],
      sceneMaps: [],
      sceneBackgrounds: [],
      widgets: []
    } as any;
  }

  /**
   * Splits markdown text into an entity description and page headers.
   */
  private parseMarkdownStructure(content: string): { description: string; parsedPages: { name: string; contentLines: string[] }[] } {
    const lines = content.split("\n");
    let descriptionLines: string[] = [];
    let currentPage: { name: string; contentLines: string[] } | null = null;
    const parsedPages: { name: string; contentLines: string[] }[] = [];

    for (const line of lines) {
      if (line.startsWith("# ")) {
        const pageName = line.substring(2).trim();
        currentPage = { name: pageName, contentLines: [] };
        parsedPages.push(currentPage);
      } else {
        if (currentPage) {
          currentPage.contentLines.push(line);
        } else {
          descriptionLines.push(line);
        }
      }
    }

    return {
      description: descriptionLines.join("\n").trim(),
      parsedPages
    };
  }

  /**
   * Parses page lines into chunks, extracting tables and image galleries.
   */
  private parsePageChunks(lines: string[], randomTables: RandomTable[], assets: Asset[]): Chunk[] {
    const chunks: Chunk[] = [];
    let currentTextLines: string[] = [];

    const flushText = () => {
      if (currentTextLines.length > 0) {
        const textContent = currentTextLines.join("\n").trim();
        // Convert Obsidian wikilinks back to /entity/UID format if possible
        // (For simplicity in v1, we can leave wikilinks as text since Harpy supports text)
        if (textContent) {
          chunks.push({
            uid: generateUid(),
            name: "",
            type: "text",
            content: textContent,
            blockStyle: {},
            headingLevel: 0,
            headingMode: "none"
          } as any);
        }
        currentTextLines = [];
      }
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Detect callout random table
      if (line.startsWith("> [!example] Random Table:")) {
        flushText();
        const titleMatch = line.match(/> \[!example\] Random Table:\s*(.*?)\s*(?:\(Dice:\s*(.*?)\))?$/);
        const tableTitle = titleMatch ? titleMatch[1].trim() : "Random Table";
        const diceFormula = titleMatch && titleMatch[2] ? titleMatch[2].trim() : "1d100";

        const rows: any[] = [];
        i++;
        while (i < lines.length && lines[i].startsWith(">")) {
          const rowLine = lines[i];
          const rowMatch = rowLine.match(/^>\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|/);
          if (rowMatch) {
            const rollStr = rowMatch[1].trim();
            const rowContent = rowMatch[2].trim();
            if (rollStr !== "Roll" && !rollStr.startsWith("---")) {
              const rollNum = parseInt(rollStr, 10);
              rows.push({
                uid: generateUid(),
                range: isNaN(rollNum) ? 0 : rollNum,
                content: rowContent
              });
            }
          }
          i++;
        }

        const tableUid = generateUid();
        randomTables.push({
          uid: tableUid,
          title: tableTitle,
          diceFormula,
          rows
        });

        chunks.push({
          uid: generateUid(),
          name: tableTitle,
          type: "random",
          randomTableUid: tableUid,
          folded: false,
          blockStyle: {},
          headingLevel: 0,
          headingMode: "none"
        } as any);
        continue;
      }

      // Detect gallery links in a line
      const imageRegex = /!\[\[(.*?)\]\]/g;
      const imagesInLine = [...line.matchAll(imageRegex)].map((m) => m[1]);
      if (imagesInLine.length > 0 && line.replace(imageRegex, "").trim() === "") {
        flushText();
        const assetUids: string[] = [];
        for (const imgName of imagesInLine) {
          let asset = assets.find((a) => a.name === imgName || a.uid === imgName) as Asset | undefined;
          if (!asset) {
            const assetUid = generateUid();
            const newAsset: Asset = {
              uid: assetUid,
              name: imgName,
              type: "image",
              originalUrl: imgName,
              thumbnailUrl: imgName,
              dimensions: { width: 0, height: 0 }
            } as any;
            assets.push(newAsset);
            asset = newAsset;
          }
          assetUids.push(asset.uid);
        }


        chunks.push({
          uid: generateUid(),
          name: "Gallery",
          type: "gallery",
          assetUids,
          blockStyle: {},
          headingLevel: 0,
          headingMode: "none"
        } as any);

        i++;
        continue;
      }

      currentTextLines.push(line);
      i++;
    }

    flushText();
    return chunks;
  }
}
