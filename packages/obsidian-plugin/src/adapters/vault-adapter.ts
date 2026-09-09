import { App, TFile, TFolder, requestUrl, stringifyYaml, normalizePath } from "obsidian";
import {
  BeyondPaper,
  BeyondPaperSchema,
  Entity,
  Page,
  Chunk,
  Scene,
  RandomTable,
  Tag,
  Variable,
  Asset,
  parseBeyondPaperBundle,
  parseMarkdown,
  serializeMarkdown,
  HarpyMarkdownDocument,
  HarpyChunkNode,
  MergeEngine,
  SyncAction,
  SyncTimestamps,
  BYPP_FORMAT_VERSION,
} from "@harpy/core";

/**
 * Generates a simple hash string for a URL to create unique, short filenames.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function generateUid(): string {
  return Math.random().toString(36).substring(2, 12);
}

export function sanitizeFileName(name: string): string {
  if (!name) return "unnamed";
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

export interface ImportReport {
  importedEntities: number;
  importedBattleMaps: number;
  totalNotes: number;
  errors: string[];
}

export interface SyncReportItem {
  entityUid: string;
  displayName: string;
  action: SyncAction;
  hasConflicts: boolean;
  conflictedChunkUids?: string[];
}

export interface SyncReport {
  items: SyncReportItem[];
  appliedLocal: number;
  appliedRemote: number;
  noChange: number;
  conflicts: number;
}

export interface MarkdownFileItem {
  path: string;
  basename: string;
  frontmatter: Record<string, any>;
  content: string;
  parentFolderName?: string;
  mtime?: number;
}

/**
 * Obsidian Vault Adapter bridging Obsidian's Vault API and @harpy/core.
 */
export class VaultAdapter {
  private app: App;
  private downloadCache = new Map<string, string>();
  private defaultAttachmentsFolder = "_attachments";

  constructor(app: App, attachmentsFolder?: string) {
    this.app = app;
    if (attachmentsFolder) {
      this.defaultAttachmentsFolder = attachmentsFolder;
    }
  }

  // ─── File System Operations ───

  async readFile(path: string): Promise<string> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    throw new Error(`File not found: ${normalized}`);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const folderPath = normalized.includes("/")
      ? normalized.substring(0, normalized.lastIndexOf("/"))
      : "";
    if (folderPath) {
      await this.ensureFolderExists(folderPath);
    }

    const existingFile = this.app.vault.getAbstractFileByPath(normalized);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(normalized, content);
    }
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      return await this.app.vault.readBinary(file);
    }
    throw new Error(`Binary file not found: ${normalized}`);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const normalized = normalizePath(path);
    const folderPath = normalized.includes("/")
      ? normalized.substring(0, normalized.lastIndexOf("/"))
      : "";
    if (folderPath) {
      await this.ensureFolderExists(folderPath);
    }

    const existingFile = this.app.vault.getAbstractFileByPath(normalized);
    if (existingFile instanceof TFile) {
      await this.app.vault.modifyBinary(existingFile, data);
    } else {
      await this.app.vault.createBinary(normalized, data);
    }
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    return await this.app.vault.adapter.exists(normalized);
  }

  async ensureFolderExists(folderPath: string): Promise<void> {
    if (!folderPath) return;
    const normalized = normalizePath(folderPath);
    const parts = normalized.split("/").filter((p) => p !== "");
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const exists = await this.app.vault.adapter.exists(currentPath);
      if (!exists) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch {
          // Folder may exist or created concurrently
        }
      }
    }
  }

  // ─── Asset Downloading & Embedding ───

  async downloadAsset(url: string, prefixName: string): Promise<string | null> {
    if (!url || typeof url !== "string" || !url.startsWith("http")) {
      return null;
    }

    if (this.downloadCache.has(url)) {
      return this.downloadCache.get(url)!;
    }

    try {
      await this.ensureFolderExists(this.defaultAttachmentsFolder);

      const cleanPrefix = (prefixName || "asset").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      const urlHash = hashString(url);

      // Check if file already exists with valid size (> 100 bytes)
      for (const checkExt of ["jpg", "png", "webp", "gif"]) {
        const candidatePath = normalizePath(`${this.defaultAttachmentsFolder}/${cleanPrefix}_${urlHash}.${checkExt}`);
        if (await this.exists(candidatePath)) {
          const stat = await this.app.vault.adapter.stat(candidatePath);
          if (stat && stat.size > 100) {
            this.downloadCache.set(url, candidatePath);
            return candidatePath;
          }
        }
      }

      const response = await requestUrl({
        url: url,
        method: "GET",
      });

      if (response.status >= 400 || !response.arrayBuffer) {
        console.warn(`VaultAdapter: Failed to download asset: ${url} (status: ${response.status})`);
        return null;
      }

      const view = ArrayBuffer.isView(response.arrayBuffer)
        ? (response.arrayBuffer as ArrayBufferView)
        : new Uint8Array(response.arrayBuffer);

      const cleanBuffer = view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength
      ) as ArrayBuffer;
      const bytes = new Uint8Array(cleanBuffer);

      if (bytes.length <= 100) {
        console.warn(`VaultAdapter: Downloaded asset is too small (size: ${bytes.length}) from ${url}`);
        return null;
      }

      // Validate image magic bytes
      let ext = "png";
      if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        ext = "jpg";
      } else if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        ext = "png";
      } else if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        ext = "gif";
      } else if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
      ) {
        ext = "webp";
      }

      const fileName = `${cleanPrefix}_${urlHash}.${ext}`;
      const localPath = normalizePath(`${this.defaultAttachmentsFolder}/${fileName}`);

      await this.writeBinary(localPath, cleanBuffer);
      this.downloadCache.set(url, localPath);
      return localPath;
    } catch (error) {
      console.error(`VaultAdapter: error downloading asset from ${url}:`, error);
      return null;
    }
  }

  toObsidianLink(localPath: string | null): string {
    if (!localPath) return "";
    return `![[${localPath}]]`;
  }

  // ─── High-Level Import Operations ───

  /**
   * Imports a parsed BeyondPaper campaign bundle into the Obsidian vault.
   */
  async importBundle(
    bundle: BeyondPaper,
    importRoot: string = "Harpy Import",
    onProgress?: (current: number, total: number, itemName: string) => void
  ): Promise<ImportReport> {
    const attachmentsFolder = importRoot ? `${importRoot}/_attachments` : "_attachments";
    this.defaultAttachmentsFolder = attachmentsFolder;
    await this.ensureFolderExists(importRoot);

    // Save manifest file
    const manifestPath = importRoot ? `${importRoot}/_harpy_manifest.json` : "_harpy_manifest.json";
    await this.writeFile(manifestPath, JSON.stringify(bundle, null, 2));

    const errors: string[] = [];
    let importedEntities = 0;
    let importedBattleMaps = 0;

    const totalEntities = bundle.entities.length;
    const totalScenes = bundle.scenes?.length || 0;
    const totalItems = totalEntities + totalScenes;

    // Build Maps for fast lookup
    const tagMap = new Map<string, Tag>();
    bundle.tags?.forEach((t) => tagMap.set(t.uid, t));

    const chunkMap = new Map<string, Chunk>();
    bundle.chunks?.forEach((c) => chunkMap.set(c.uid, c));

    const pageMap = new Map<string, Page>();
    bundle.pages?.forEach((p) => pageMap.set(p.uid, p));

    const variableMap = new Map<string, Variable>();
    bundle.variables?.forEach((v) => variableMap.set(v.uid, v));

    // 1. Process and write Entities
    for (let i = 0; i < totalEntities; i++) {
      const entity = bundle.entities[i];
      const entityName = entity.displayName || entity.name;

      if (onProgress) {
        onProgress(i + 1, totalItems, entityName);
      }

      try {
        const baseFileName = sanitizeFileName(entityName);

        // Security Exception: NEVER overwrite or alter Barnabé Limon Sec
        if (
          baseFileName === "Barnabé Limon Sec" ||
          baseFileName === "Barnabe Limon Sec" ||
          entityName === "Barnabé Limon Sec" ||
          entityName === "Barnabe Limon Sec"
        ) {
          console.log("Skipping protected canonical note: Barnabé Limon Sec");
          continue;
        }

        // Resolve subfolder from tag with useAsFolder
        let subFolder = "";
        if (entity.tagsUid) {
          for (const tUid of entity.tagsUid) {
            const tag = tagMap.get(tUid);
            if (tag && tag.useAsFolder) {
              subFolder = sanitizeFileName(tag.name);
              break;
            }
          }
        }
        const targetFolder = subFolder ? `${importRoot}/${subFolder}` : importRoot;
        const filePath = `${targetFolder}/${baseFileName}.md`;

        // Profile Image Download
        let localAssetPath: string | null = null;
        const profileUrl = entity.originalUrl || (entity as any).closeupUrl || (entity as any).squareUrl || (entity as any).thumbnailUrl;
        if (profileUrl) {
          localAssetPath = await this.downloadAsset(profileUrl, `${baseFileName}_profile`);
        }

        // Frontmatter
        const frontmatter: Record<string, any> = {
          "harpy-uid": entity.uid,
          uid: entity.uid,
          displayName: entityName,
          "harpy-last-sync": bundle.exportedAt || new Date().toISOString(),
          type: entity.type,
          tags: entity.tagsUid
            ? entity.tagsUid.map((tUid) => tagMap.get(tUid)?.name || "").filter(Boolean)
            : [],
        };

        if (localAssetPath) {
          frontmatter["Image"] = `[[${localAssetPath}]]`;
        }

        if (entity.data && typeof entity.data === "object") {
          frontmatter["harpy-data"] = entity.data;
          const flatVars: Record<string, any> = {};
          for (const [varUid, val] of Object.entries(entity.data)) {
            const v = variableMap.get(varUid);
            const key = v?.name || (v as any)?.label || varUid;
            flatVars[key] = val;
          }
          if (Object.keys(flatVars).length > 0) {
            frontmatter["variables"] = flatVars;
          }
        }

        const scenesUids: string[] = (entity as any).scenesUids || (entity as any).scenes || [];
        if (scenesUids.length > 0) {
          frontmatter["scenesUids"] = scenesUids;
        }

        // Build Leading Content / Profile / Header
        const leadingLines: string[] = [`# ${entityName}`, ""];

        // Navigation Callout
        const navParts: string[] = [];
        if (entity.data && typeof entity.data === "object" && Object.keys(entity.data).length > 0) {
          navParts.push("[[#Fiche de personnage|📋 Fiche]]");
        }
        for (const sUid of scenesUids) {
          const sc = bundle.scenes?.find((s) => s.uid === sUid);
          if (sc) {
            const mapSanitizeName = sanitizeFileName(sc.name || "Battle Map");
            navParts.push(`[[${importRoot}/Maps/${mapSanitizeName}|🗺️ Battle Map : ${sc.name}]]`);
          }
        }
        if (navParts.length > 0) {
          leadingLines.push(`> [!info] 🧭 **Navigation** : ${navParts.join(" | ")}`, "");
        }

        if (localAssetPath) {
          leadingLines.push(this.toObsidianLink(localAssetPath), "");
        }

        // Description
        if (entity.description) {
          leadingLines.push(entity.description, "");
        }

        // Character Sheets rendering
        if (entity.data && typeof entity.data === "object" && Object.keys(entity.data).length > 0) {
          const sheets = bundle.sheets || [];
          const renderedVarUids = new Set<string>();
          let hasSheetSection = false;

          for (const sheet of sheets) {
            const sheetLines: string[] = [];
            if (sheet.widgetUids && sheet.widgetUids.length > 0) {
              for (const widgetUid of sheet.widgetUids) {
                const widget = bundle.widgets?.find((w) => w.uid === widgetUid);
                if (widget && widget.variableUid && !renderedVarUids.has(widget.variableUid)) {
                  const vUid = widget.variableUid;
                  const val = entity.data[vUid];
                  const variable = variableMap.get(vUid);
                  if (val !== undefined && val !== null && val !== "") {
                    renderedVarUids.add(vUid);
                    const label = variable?.name || (variable as any)?.label || vUid;
                    const valStr = typeof val === "boolean" ? (val ? "Oui" : "Non") : String(val);
                    if (valStr.includes("\n")) {
                      sheetLines.push(`#### ${label}`, valStr, "");
                    } else {
                      sheetLines.push(`- **${label}** : ${valStr}`);
                    }
                  }
                }
              }
            }

            if (sheetLines.length > 0 || sheet.name || sheet.originalUrl) {
              if (!hasSheetSection) {
                leadingLines.push("## Fiche de personnage", "");
                hasSheetSection = true;
              }
              if (sheet.name) {
                leadingLines.push(`### Fiche : ${sheet.name}`, "");
              }
              if (sheet.originalUrl) {
                const sheetAsset = await this.downloadAsset(sheet.originalUrl, `sheet_${sheet.name || sheet.uid}`);
                if (sheetAsset) {
                  leadingLines.push(this.toObsidianLink(sheetAsset), "");
                }
              }
              if (sheetLines.length > 0) {
                leadingLines.push(...sheetLines, "");
              }
            }
          }

          // Remaining unrendered variables
          const unrenderedLines: string[] = [];
          for (const [vUid, val] of Object.entries(entity.data)) {
            if (!renderedVarUids.has(vUid) && val !== undefined && val !== null && val !== "") {
              renderedVarUids.add(vUid);
              const variable = variableMap.get(vUid);
              const label = variable?.name || (variable as any)?.label || vUid;
              const valStr = typeof val === "boolean" ? (val ? "Oui" : "Non") : String(val);
              if (valStr.includes("\n")) {
                unrenderedLines.push(`#### ${label}`, valStr, "");
              } else {
                unrenderedLines.push(`- **${label}** : ${valStr}`);
              }
            }
          }
          if (unrenderedLines.length > 0) {
            if (!hasSheetSection) {
              leadingLines.push("## Fiche de personnage", "");
            } else {
              leadingLines.push("### Informations complémentaires", "");
            }
            leadingLines.push(...unrenderedLines, "");
          }
        }

        // Extract and construct Chunks
        const chunks: HarpyChunkNode[] = [];
        const entityPageUids = entity.pagesOrder || [];
        for (const pUid of entityPageUids) {
          const page = pageMap.get(pUid);
          if (page) {
            const pageChunkUids = (page as any).chunksOrder || (page as any).chunkUids || [];
            for (const cUid of pageChunkUids) {
              const chunk = chunkMap.get(cUid);
              if (chunk) {
                chunks.push({
                  uid: chunk.uid,
                  type: chunk.type || "text",
                  name: chunk.name,
                  content: (chunk as any).content || "",
                });
              }
            }
          }
        }

        const doc: HarpyMarkdownDocument = {
          frontmatter,
          leadingContent: leadingLines.join("\n"),
          chunks,
          trailingContent: "",
          hasExplicitChunks: chunks.length > 0,
        };

        const markdownContent = serializeMarkdown(doc);
        await this.writeFile(filePath, markdownContent);
        importedEntities++;
      } catch (err: any) {
        errors.push(`Failed to import entity "${entityName}": ${err.message || err}`);
      }
    }

    // 2. Process and write Battlemaps (Scenes)
    if (bundle.scenes && bundle.scenes.length > 0) {
      for (let j = 0; j < totalScenes; j++) {
        const scene = bundle.scenes[j];
        const sceneName = scene.name || "Battle Map";

        if (onProgress) {
          onProgress(totalEntities + j + 1, totalItems, `Map: ${sceneName}`);
        }

        try {
          const sanitizeName = sanitizeFileName(sceneName);
          const mapsFolder = `${importRoot}/Maps`;
          const mapFilePath = `${mapsFolder}/${sanitizeName}.md`;

          const mapDoc: HarpyMarkdownDocument = {
            frontmatter: {
              "harpy-uid": scene.uid,
              uid: scene.uid,
              displayName: sceneName,
              "harpy-last-sync": bundle.exportedAt || new Date().toISOString(),
              type: "battlemap",
            },
            leadingContent: `# 🗺️ Battle Map : ${sceneName}\n\n`,
            chunks: [],
            trailingContent: "",
            hasExplicitChunks: false,
          };

          await this.writeFile(mapFilePath, serializeMarkdown(mapDoc));
          importedBattleMaps++;
        } catch (err: any) {
          errors.push(`Failed to import battlemap "${sceneName}": ${err.message || err}`);
        }
      }
    }

    return {
      importedEntities,
      importedBattleMaps,
      totalNotes: importedEntities + importedBattleMaps,
      errors,
    };
  }

  // ─── High-Level Export Operations ───

  /**
   * Scans a vault folder and builds a valid Beyond Paper (.bypp) campaign bundle.
   */
  async exportCampaign(folderPath: string, campaignName?: string): Promise<BeyondPaper> {
    const normalized = normalizePath(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(normalized);
    if (!(folder instanceof TFolder)) {
      throw new Error(`Folder not found: ${normalized}`);
    }

    // Load _harpy_manifest.json if present
    let manifestData: any = null;
    const manifestPath = normalized ? `${normalized}/_harpy_manifest.json` : "_harpy_manifest.json";
    if (await this.exists(manifestPath)) {
      try {
        const manifestContent = await this.readFile(manifestPath);
        manifestData = JSON.parse(manifestContent);
      } catch (e) {
        console.warn("VaultAdapter: could not parse _harpy_manifest.json:", e);
      }
    }

    const mdFiles: TFile[] = [];
    const collectFolder = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile && child.extension === "md") {
          if (child.basename !== "_harpy_manifest") {
            mdFiles.push(child);
          }
        } else if (child instanceof TFolder) {
          collectFolder(child);
        }
      }
    };
    collectFolder(folder);

    const entities: Entity[] = [];
    const pages: Page[] = [];
    const chunks: Chunk[] = [];
    const tags: Tag[] = manifestData?.tags ? [...manifestData.tags] : [];
    const variables: Variable[] = manifestData?.variables ? [...manifestData.variables] : [];
    const tagMap = new Map<string, string>();
    tags.forEach((t) => tagMap.set(t.name, t.uid));

    for (const file of mdFiles) {
      const content = await this.app.vault.read(file);
      const doc = parseMarkdown(content, { parseHeadingsAsChunksFallback: true });
      const frontmatter = doc.frontmatter || {};

      const entityUid = (frontmatter["harpy-uid"] as string) || (frontmatter["uid"] as string) || generateUid();
      const displayName = (frontmatter["displayName"] as string) || file.basename;
      const entityType = (frontmatter["type"] as string) || "note";

      if (entityType === "battlemap" || entityType === "scene") {
        continue;
      }

      // Process Tags
      const tagsUid: string[] = [];
      const rawTags = frontmatter["tags"];
      const fileTags: string[] = Array.isArray(rawTags)
        ? rawTags
        : typeof rawTags === "string"
        ? [rawTags]
        : [];

      for (const tagName of fileTags) {
        if (!tagName) continue;
        let tagUid = tagMap.get(tagName);
        if (!tagUid) {
          tagUid = generateUid();
          tagMap.set(tagName, tagUid);
          tags.push({
            uid: tagUid,
            name: tagName,
            categoryUid: "",
            useAsFolder: file.parent ? file.parent.name === tagName : false,
          });
        }
        tagsUid.push(tagUid);
      }

      // Process Chunks & Pages
      const pageUid = generateUid();
      const pageChunksOrder: string[] = [];

      for (const c of doc.chunks) {
        const cUid = c.uid || generateUid();
        pageChunksOrder.push(cUid);
        chunks.push({
          uid: cUid,
          name: c.name || "",
          type: (c.type as any) || "text",
          content: c.content,
        } as Chunk);
      }

      pages.push({
        uid: pageUid,
        name: displayName,
        type: "standard",
        chunksOrder: pageChunksOrder,
      });

      entities.push({
        uid: entityUid,
        name: sanitizeFileName(displayName),
        displayName,
        description: doc.leadingContent || "",
        tagsUid,
        type: entityType,
        pagesOrder: [pageUid],
        data: (frontmatter["harpy-data"] as Record<string, any>) || {},
      } as any);
    }

    const bundle: BeyondPaper = {
      version: manifestData?.version || BYPP_FORMAT_VERSION,
      format: manifestData?.format || "bypp",
      name: campaignName || manifestData?.name || folder.name || "Harpy Export",
      exportedAt: new Date().toISOString(),
      bundleVersion: manifestData?.bundleVersion || "1.0.0",
      license: manifestData?.license || "ARR",
      licenseVersion: manifestData?.licenseVersion || "4.0",
      attribution: manifestData?.attribution || { authorName: "Harpy Sync" },
      entities,
      pages,
      chunks,
      variables,
      tags,
      tagCategories: manifestData?.tagCategories || [],
      randomTables: manifestData?.randomTables || [],
      assets: manifestData?.assets || [],
      sheets: manifestData?.sheets || [],
      dataTables: manifestData?.dataTables || [],
      scenes: manifestData?.scenes || [],
      sceneMaps: manifestData?.sceneMaps || [],
      sceneBackgrounds: manifestData?.sceneBackgrounds || [],
      widgets: manifestData?.widgets || [],
      dialects: manifestData?.dialects || [],
      datasets: manifestData?.datasets || [],
    } as any as BeyondPaper;

    BeyondPaperSchema.parse(bundle);
    return bundle;
  }

  // ─── High-Level 3-Way Sync Operations ───

  /**
   * Compares the local vault folder with a remote BeyondPaper bundle and performs 3-way sync.
   */
  async syncCampaign(
    folderPath: string,
    remoteBundle: BeyondPaper,
    options: { toleranceMs?: number } = {}
  ): Promise<SyncReport> {
    const localBundle = await this.exportCampaign(folderPath, remoteBundle.name);
    const mergeEngine = new MergeEngine(options);

    const reportItems: SyncReportItem[] = [];
    let appliedLocal = 0;
    let appliedRemote = 0;
    let noChange = 0;
    let conflicts = 0;

    const localEntitiesMap = new Map<string, Entity>();
    localBundle.entities.forEach((e) => localEntitiesMap.set(e.uid, e));

    const remoteEntitiesMap = new Map<string, Entity>();
    remoteBundle.entities.forEach((e) => remoteEntitiesMap.set(e.uid, e));

    const allEntityUids = Array.from(
      new Set([...localEntitiesMap.keys(), ...remoteEntitiesMap.keys()])
    );

    for (const uid of allEntityUids) {
      const localEnt = localEntitiesMap.get(uid);
      const remoteEnt = remoteEntitiesMap.get(uid);

      if (localEnt && !remoteEnt) {
        reportItems.push({
          entityUid: uid,
          displayName: localEnt.displayName || localEnt.name,
          action: "USE_LOCAL",
          hasConflicts: false,
        });
        appliedLocal++;
      } else if (!localEnt && remoteEnt) {
        reportItems.push({
          entityUid: uid,
          displayName: remoteEnt.displayName || remoteEnt.name,
          action: "USE_REMOTE",
          hasConflicts: false,
        });
        appliedRemote++;
      } else if (localEnt && remoteEnt) {
        const lastSync = (localEnt as any).lastSync || (localEnt as any)["harpy-last-sync"];
        const remoteMtime = remoteBundle.exportedAt;
        const localMtime = (localEnt as any).mtime;

        const syncResult = mergeEngine.syncEntity(
          { lastSync, localMtime, remoteMtime },
          null,
          localEnt,
          remoteEnt
        );

        if (syncResult.action === "NO_CHANGE") {
          noChange++;
        } else if (syncResult.action === "USE_LOCAL") {
          appliedLocal++;
        } else if (syncResult.action === "USE_REMOTE") {
          appliedRemote++;
        } else {
          conflicts++;
        }

        reportItems.push({
          entityUid: uid,
          displayName: localEnt.displayName || remoteEnt.displayName || localEnt.name,
          action: syncResult.action,
          hasConflicts: syncResult.hasConflicts,
          conflictedChunkUids: syncResult.conflictedChunkUids,
        });
      }
    }

    return {
      items: reportItems,
      appliedLocal,
      appliedRemote,
      noChange,
      conflicts,
    };
  }
}
