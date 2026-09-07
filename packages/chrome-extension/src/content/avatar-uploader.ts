/**
 * Avatar Uploader: In-Browser Automation for Harpy.gg Entity Avatar Image Upload
 * Interacts with Harpy's entity edit dialog and h-image-picker component.
 */

import { DomAutomation } from "./dom-automation";

export interface UploadAvatarOptions {
  /** Base64 string (with or without data URL prefix), or remote URL */
  imageData?: string;
  /** Image URL to fetch and upload directly */
  imageUrl?: string;
  /** Custom file name (default: 'avatar.png') */
  fileName?: string;
  /** MIME type (default: 'image/png') */
  mimeType?: string;
  /** Timeout for DOM operations in ms (default: 15000) */
  timeoutMs?: number;
}

export interface UploadAvatarResult {
  success: boolean;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  error?: string;
}

export class AvatarUploader {
  /**
   * Uploads an avatar image to the currently opened Harpy entity via DOM automation.
   */
  public static async uploadAvatar(options: UploadAvatarOptions): Promise<UploadAvatarResult> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const fileName = options.fileName || "avatar.png";
    const mimeType = options.mimeType || this.inferMimeType(fileName, options.imageData || options.imageUrl);

    try {
      // 1. Prepare File Object
      const file = await this.prepareFile(options, fileName, mimeType);
      if (!file) {
        throw new Error("No valid image data or URL provided for avatar upload");
      }

      console.log(`🦅 [AvatarUploader] Prepared avatar file '${file.name}' (${file.size} bytes, ${file.type})`);

      // 2. Open Edit Dialog
      await this.ensureEditDialogOpen(timeoutMs);

      // 3. Locate File Input in h-image-picker
      const fileInput = await this.findFileInput(timeoutMs);
      if (!fileInput) {
        throw new Error("Could not find image picker file input 'h-image-picker input[type=\"file\"].input-fileUpload'");
      }

      // 4. Inject File via DataTransfer & trigger change/input events
      await this.injectFileToInput(fileInput, file);

      // 5. Short pause to allow preview generation and component state update
      await this.sleep(400);

      // 6. Click Save Button & wait for dialog to close
      await this.saveAndCloseDialog(timeoutMs);

      console.log(`🦅 [AvatarUploader] Avatar upload completed successfully for '${file.name}'`);
      return {
        success: true,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      };
    } catch (err: any) {
      console.error("🦅 [AvatarUploader] Avatar upload failed:", err);
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  }

  /**
   * Ensures the Entity Edit Dialog (h-entity-form-dialog) is open.
   */
  private static async ensureEditDialogOpen(timeoutMs: number): Promise<void> {
    const existingDialog = document.querySelector("h-entity-form-dialog");
    if (existingDialog && window.getComputedStyle(existingDialog).display !== "none") {
      return;
    }

    // 1. Find Settings button
    const settingsButton = this.findSettingsButton();
    if (!settingsButton) {
      throw new Error(
        "Could not find settings button 'button[aria-label=\"Paramètres\"]' on active Harpy entity page"
      );
    }

    console.log("🦅 [AvatarUploader] Clicking settings button...");
    await DomAutomation.click(settingsButton, { highlight: true });
    await this.sleep(250);

    // 2. Find and click "Éditer" button
    const editButton = await this.findEditMenuOption(timeoutMs);
    if (!editButton) {
      throw new Error("Could not find 'Éditer' option in settings menu");
    }

    console.log("🦅 [AvatarUploader] Clicking 'Éditer' button...");
    await DomAutomation.click(editButton, { highlight: true });

    // 3. Wait for dialog to appear
    await DomAutomation.waitForElement("h-entity-form-dialog", timeoutMs);
    await this.sleep(200);
  }

  /**
   * Finds the Settings button (e.g. button[aria-label="Paramètres"]).
   */
  private static findSettingsButton(): HTMLElement | null {
    // Exact aria-label matches
    const exactMatch = document.querySelector<HTMLElement>(
      'button[aria-label="Paramètres"], button[aria-label="Settings"], button[aria-label*="Paramètre"]'
    );
    if (exactMatch) return exactMatch;

    // Search by title or text or icon
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, sl-icon-button, [role='button']"));
    for (const btn of buttons) {
      const aria = (btn.getAttribute("aria-label") || btn.getAttribute("title") || "").toLowerCase();
      const text = (btn.innerText || btn.textContent || "").toLowerCase();
      if (aria.includes("paramètre") || aria.includes("settings") || text.includes("paramètre") || text.includes("settings")) {
        return btn;
      }
    }

    return null;
  }

  /**
   * Finds the 'Éditer' button in the opened menu or dropdown.
   */
  private static async findEditMenuOption(timeoutMs = 5000): Promise<HTMLElement | null> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      // 1. Direct text search in menu items and buttons
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, sl-menu-item, [role="menuitem"], .dropdown-item, .mat-menu-item, h-menu-item'
        )
      );

      for (const el of candidates) {
        const text = (el.innerText || el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        if (text === "éditer" || text === "editer" || text === "edit" || aria.includes("éditer") || aria.includes("edit")) {
          return el;
        }
      }

      await this.sleep(100);
    }
    return null;
  }

  /**
   * Locates the file input inside the image picker.
   */
  private static async findFileInput(timeoutMs: number): Promise<HTMLInputElement | null> {
    const selector = 'h-image-picker input[type="file"].input-fileUpload, h-image-picker input[type="file"], input[type="file"].input-fileUpload, input[type="file"]';
    try {
      return await DomAutomation.waitForElement<HTMLInputElement>(selector, timeoutMs);
    } catch {
      return document.querySelector<HTMLInputElement>(selector);
    }
  }

  /**
   * Injects a File into an HTMLInputElement using DataTransfer and dispatches change/input events.
   */
  private static async injectFileToInput(input: HTMLInputElement, file: File): Promise<void> {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;

    // Trigger standard input & change events
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true, composed: true }));

    // If Shoelace or Angular custom wrapper is present, notify it
    const picker = input.closest("h-image-picker");
    if (picker) {
      picker.dispatchEvent(new CustomEvent("change", { bubbles: true, composed: true, detail: { file } }));
      picker.dispatchEvent(new CustomEvent("file-selected", { bubbles: true, composed: true, detail: { file } }));
    }
  }

  /**
   * Finds the Save button in the dialog, clicks it, and waits for the dialog to disappear.
   */
  private static async saveAndCloseDialog(timeoutMs: number): Promise<void> {
    // Find Save button: h-entity-form-dialog h-dialog-actions button
    const saveButtonSelector =
      'h-entity-form-dialog h-dialog-actions button, h-entity-form-dialog h-dialog-actions sl-button, h-entity-form-dialog button[type="submit"], h-dialog-actions button';

    let saveButton = document.querySelector<HTMLElement>(saveButtonSelector);

    if (!saveButton) {
      // Search inside dialog for button with text "Enregistrer" or "Save"
      const dialog = document.querySelector("h-entity-form-dialog");
      if (dialog) {
        const buttons = Array.from(dialog.querySelectorAll<HTMLElement>("button, sl-button"));
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || "").toLowerCase();
          if (text.includes("enregistrer") || text.includes("save") || text.includes("valider")) {
            saveButton = btn;
            break;
          }
        }
      }
    }

    if (!saveButton) {
      throw new Error("Could not find Save button 'h-entity-form-dialog h-dialog-actions button' to submit avatar");
    }

    console.log("🦅 [AvatarUploader] Clicking Save button...");
    await DomAutomation.click(saveButton, { highlight: true });

    // Wait for dialog to disappear
    try {
      await DomAutomation.waitForElementToDisappear("h-entity-form-dialog", timeoutMs);
    } catch {
      console.warn("🦅 [AvatarUploader] Timeout waiting for dialog to disappear, proceeding.");
    }
  }

  /**
   * Prepares a File object from options (base64 string, data URL, or remote URL).
   */
  private static async prepareFile(
    options: UploadAvatarOptions,
    fileName: string,
    mimeType: string
  ): Promise<File | null> {
    if (options.imageData) {
      const data = options.imageData;
      if (data.startsWith("data:")) {
        // Base64 Data URL: data:image/png;base64,iVBORw...
        const match = data.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const detectedMime = match[1];
          const rawBase64 = match[2];
          return this.base64ToFile(rawBase64, fileName, detectedMime);
        }
      }
      // Raw base64 string
      return this.base64ToFile(data, fileName, mimeType);
    }

    if (options.imageUrl) {
      // Remote URL -> Fetch blob
      const res = await fetch(options.imageUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch avatar image from URL '${options.imageUrl}': HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const detectedMime = blob.type || mimeType;
      return new File([blob], fileName, { type: detectedMime });
    }

    return null;
  }

  /**
   * Converts a base64 string into a File object.
   */
  public static base64ToFile(base64Data: string, fileName: string, mimeType = "image/png"): File {
    const cleanBase64 = base64Data.replace(/^data:image\/[a-zA-Z+]+;base64,/, "").trim();
    const byteCharacters = atob(cleanBase64);
    const byteArrays: Uint8Array[] = [];

    const sliceSize = 1024;
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      byteArrays.push(new Uint8Array(byteNumbers));
    }

    const blob = new Blob(byteArrays, { type: mimeType });
    return new File([blob], fileName, { type: mimeType, lastModified: Date.now() });
  }

  /**
   * Helper to infer MIME type from file extension or content.
   */
  private static inferMimeType(fileName: string, dataUrlOrUrl?: string): string {
    if (dataUrlOrUrl && dataUrlOrUrl.startsWith("data:")) {
      const match = dataUrlOrUrl.match(/^data:([^;]+);/);
      if (match) return match[1];
    }

    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "gif":
        return "image/gif";
      case "svg":
        return "image/svg+xml";
      default:
        return "image/png";
    }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
