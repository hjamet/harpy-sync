import { App, requestUrl } from "obsidian";

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

export class AssetManager {
  app: App;
  importRoot: string;
  attachmentsFolder: string;
  // Cache to avoid double downloads in the same session
  downloadCache = new Map<string, string>();

  constructor(app: App, importRoot: string) {
    this.app = app;
    this.importRoot = importRoot;
    this.attachmentsFolder = importRoot ? `${importRoot}/_attachments` : "_attachments";
  }

  /**
   * Helper to ensure all parent directories exist for a given path.
   */
  async ensureFolderExists(path: string): Promise<void> {
    if (!path) return;
    const parts = path.split("/").filter((p) => p !== "");
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const exists = await this.app.vault.adapter.exists(currentPath);
      if (!exists) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch (e) {
          // Ignore if folders are created concurrently
        }
      }
    }
  }

  /**
   * Downloads a URL and saves it into the vault attachments folder.
   * Returns the vault-relative path of the downloaded asset, or null if download failed.
   */
  async downloadUrl(url: string, prefixName: string): Promise<string | null> {
    if (!url || typeof url !== "string" || !url.startsWith("http")) {
      return null;
    }

    // Check memory cache first
    if (this.downloadCache.has(url)) {
      return this.downloadCache.get(url)!;
    }

    try {
      // Ensure attachments folder exists
      await this.ensureFolderExists(this.attachmentsFolder);

      // Determine extension from url or fallback to png
      const extensionMatch = url.split("?")[0].split("#")[0].match(/\.([a-zA-Z0-9]+)$/);
      const ext = extensionMatch ? extensionMatch[1] : "png";

      // Clean prefix name
      const cleanPrefix = prefixName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      const urlHash = hashString(url);
      const fileName = `${cleanPrefix}_${urlHash}.${ext}`;
      const localPath = `${this.attachmentsFolder}/${fileName}`;

      // Check if file already exists in vault
      const exists = await this.app.vault.adapter.exists(localPath);
      if (exists) {
        this.downloadCache.set(url, localPath);
        return localPath;
      }

      // Download using Obsidian's requestUrl
      const response = await requestUrl({
        url: url,
        method: "GET",
      });

      if (response.status >= 400) {
        console.warn(`Failed to download asset: ${url} (status: ${response.status})`);
        return null;
      }

      // Write arrayBuffer to vault
      await this.app.vault.createBinary(localPath, response.arrayBuffer);
      this.downloadCache.set(url, localPath);
      return localPath;
    } catch (error) {
      console.error(`AssetManager: error downloading asset from ${url}:`, error);
      return null;
    }
  }

  /**
   * Translates a local path into an Obsidian markdown image/file embed.
   */
  toObsidianLink(localPath: string | null): string {
    if (!localPath) return "";
    // Return standard obsidian embed syntax: ![[path/to/file.png]]
    return `![[${localPath}]]`;
  }
}
