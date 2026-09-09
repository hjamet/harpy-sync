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

      // Download using Obsidian's requestUrl
      const response = await requestUrl({
        url: url,
        method: "GET",
      });

      if (response.status >= 400) {
        console.warn(`Failed to download asset: ${url} (status: ${response.status})`);
        return null;
      }

      if (!response.arrayBuffer) {
        console.warn(`Failed to download asset: empty response buffer from ${url}`);
        return null;
      }

      // Slice ArrayBufferView cleanly
      const view = ArrayBuffer.isView(response.arrayBuffer)
        ? (response.arrayBuffer as ArrayBufferView)
        : new Uint8Array(response.arrayBuffer);

      const cleanBuffer = view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength
      ) as ArrayBuffer;
      const bytes = new Uint8Array(cleanBuffer);

      // Reject HTML text error payloads (e.g. <!DOCTYPE or <html)
      const headerText = Array.from(bytes.slice(0, 20))
        .map((b) => String.fromCharCode(b))
        .join("")
        .trim()
        .toLowerCase();

      if (headerText.startsWith("<!do") || headerText.startsWith("<htm")) {
        console.warn(`AssetManager: Rejecting HTML error payload from ${url}`);
        return null;
      }

      // Validate magic bytes & dynamically assign correct extension
      let ext: string | null = null;
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

      if (!ext) {
        console.warn(`AssetManager: Invalid or unsupported image magic bytes from ${url}`);
        return null;
      }

      // Clean prefix name
      const cleanPrefix = (prefixName || "asset").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      const urlHash = hashString(url);
      const fileName = `${cleanPrefix}_${urlHash}.${ext}`;
      const localPath = `${this.attachmentsFolder}/${fileName}`;

      // Check if file already exists in vault with valid size (> 100 bytes)
      const exists = await this.app.vault.adapter.exists(localPath);
      if (exists) {
        const stat = await this.app.vault.adapter.stat(localPath);
        if (stat && stat.size > 100) {
          this.downloadCache.set(url, localPath);
          return localPath;
        }
      }

      // Write arrayBuffer to vault
      await this.app.vault.createBinary(localPath, cleanBuffer);
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
