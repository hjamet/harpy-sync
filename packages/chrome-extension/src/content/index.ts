/**
 * Content Script Entry Point: In-Browser Automation & Obsidian Sync Bridge
 * Injected automatically on https://*.harpy.gg/*
 */

import { TokenExtractor } from "./token-extractor";
import { DomAutomation } from "./dom-automation";
import { HarpyWsClient } from "./ws-client";
import { MainWorldBridgeClient } from "./bridge-client";
import { AvatarUploader, UploadAvatarOptions } from "./avatar-uploader";
import { CodexSync, CodexSyncOptions } from "./codex-sync";
import { SheetSync, SheetSyncOptions } from "./sheet-sync";
import { HarpyContext, FirebaseTokenData, ExtensionRuntimeMessage } from "../types";
import { FirestoreRestClient } from "@harpy/core";

class HarpyContentBridge {
  private tokenExtractor: TokenExtractor;
  private wsClient: HarpyWsClient;
  private currentContext: HarpyContext | null = null;
  private latestToken: FirebaseTokenData | null = null;

  constructor() {
    console.log("🦅 [HarpySync] Initializing Content Script on", window.location.href);

    this.tokenExtractor = new TokenExtractor();
    this.wsClient = new HarpyWsClient({
      url: "ws://127.0.0.1:18765",
      debug: true,
    });

    this.init();
  }

  private async init(): Promise<void> {
    // 1. Inject Main World Bridge script for Angular integration
    MainWorldBridgeClient.injectBridgeScript();

    // 2. Setup RPC Handlers
    this.registerRpcMethods();

    // 3. Start Token Watcher
    this.tokenExtractor.startTokenWatcher((tokenData) => {
      this.latestToken = tokenData;
      this.updateContext();
      // Notify WebSocket server if connected
      if (this.wsClient.isConnected() && tokenData) {
        this.wsClient.notify("harpy.tokenUpdated", {
          uid: tokenData.uid,
          email: tokenData.email,
          expirationTime: tokenData.expirationTime,
        });
      }
      this.notifyRuntimeStatus();
    }, 10000);

    // 4. Connect WebSocket
    this.wsClient.onStatusChange((status) => {
      console.log(`[HarpySync] WS Status: ${status}`);
      this.notifyRuntimeStatus();
    });
    this.wsClient.connect();

    // 5. Setup Chrome Extension Runtime message listener
    this.setupRuntimeMessaging();

    // Initial context update
    await this.updateContext();
    console.log("🦅 [HarpySync] Content Bridge ready!");
  }

  private registerRpcMethods(): void {
    // ==========================================
    // 1. System & Health
    // ==========================================
    this.wsClient.registerHandler("harpy.ping", async () => {
      return {
        pong: true,
        timestamp: Date.now(),
        url: window.location.href,
        title: document.title,
        wsStatus: this.wsClient.getStatus(),
      };
    });

    // ==========================================
    // 2. Context & Session
    // ==========================================
    this.wsClient.registerHandler("harpy.getContext", async () => {
      await this.updateContext();
      return this.currentContext;
    });

    this.wsClient.registerHandler("harpy.getToken", async () => {
      const token = await this.tokenExtractor.getValidToken();
      return token;
    });

    this.wsClient.registerHandler("harpy.refreshToken", async () => {
      const result = await this.tokenExtractor.extractToken();
      if (result.success && result.tokenData) {
        this.latestToken = result.tokenData;
        await this.updateContext();
        return result.tokenData;
      }
      throw new Error(result.error || "Failed to refresh token");
    });

    // ==========================================
    // 3. Avatar Upload Module (avatar-uploader.ts)
    // ==========================================
    this.wsClient.registerHandler("harpy.uploadAvatar", async (params: UploadAvatarOptions) => {
      console.log("🦅 [HarpySync] Invoking AvatarUploader with params:", {
        fileName: params.fileName,
        mimeType: params.mimeType,
        hasImageData: !!params.imageData,
        imageUrl: params.imageUrl,
      });
      return AvatarUploader.uploadAvatar(params);
    });

    // ==========================================
    // 4. Codex & TinyMCE Sync Module (codex-sync.ts)
    // ==========================================
    this.wsClient.registerHandler("harpy.syncCodex", async (params: CodexSyncOptions) => {
      console.log("🦅 [HarpySync] Invoking CodexSync with", params?.pages?.length, "pages");
      return CodexSync.syncCodex(params);
    });

    // ==========================================
    // 5. Pathfinder 1e Sheet Sync Module (sheet-sync.ts)
    // ==========================================
    this.wsClient.registerHandler("harpy.syncSheet", async (params: SheetSyncOptions) => {
      console.log("🦅 [HarpySync] Invoking SheetSync with variables:", Object.keys(params?.variables || {}));
      return SheetSync.syncSheet(params);
    });

    // ==========================================
    // 6. Entity Retrieval (get_harpy_entity)
    // ==========================================
    this.wsClient.registerHandler("harpy.getEntity", async (params: {
      entityId?: string;
      worldId?: string;
      includeChunks?: boolean;
      includeVariables?: boolean;
    }) => {
      await this.updateContext();
      const entityId = params?.entityId || this.currentContext?.entityId;
      const worldId = params?.worldId || this.currentContext?.worldId;

      if (!entityId) {
        throw new Error("No entityId provided and no active entity open in current Harpy tab.");
      }

      return this.fetchEntityDetails(entityId, worldId, params);
    });

    // ==========================================
    // 7. Entity Creation & Update
    // ==========================================
    this.wsClient.registerHandler("harpy.createEntity", async (params: {
      name: string;
      type?: string;
      worldId?: string;
      folder?: string;
      tags?: string[];
      variables?: Record<string, any>;
      content?: string;
    }) => {
      await this.updateContext();
      const worldId = params?.worldId || this.currentContext?.worldId;
      if (!worldId) {
        throw new Error("worldId is required to create an entity.");
      }

      return this.createEntity(worldId, params);
    });

    this.wsClient.registerHandler("harpy.updateEntity", async (params: {
      entityId: string;
      worldId?: string;
      name?: string;
      folder?: string;
      tags?: string[];
      variables?: Record<string, any>;
      content?: string;
      updateMask?: string[];
    }) => {
      await this.updateContext();
      const worldId = params?.worldId || this.currentContext?.worldId;
      if (!worldId) {
        throw new Error("worldId is required to update an entity.");
      }

      return this.updateEntity(worldId, params.entityId, params);
    });

    this.wsClient.registerHandler("harpy.listEntities", async (params: {
      worldId?: string;
      type?: string;
      tags?: string[];
      folder?: string;
      search?: string;
      limit?: number;
    }) => {
      await this.updateContext();
      const worldId = params?.worldId || this.currentContext?.worldId;
      if (!worldId) {
        throw new Error("worldId is required to list entities.");
      }

      return this.listEntities(worldId, params);
    });

    // ==========================================
    // 8. Low-level DOM Automation
    // ==========================================
    this.wsClient.registerHandler("harpy.dom.click", async (params: { selector: string; options?: any }) => {
      if (!params || !params.selector) throw new Error("Missing 'selector' parameter");
      const success = await DomAutomation.click(params.selector, {
        highlight: true,
        ...params.options,
      });
      return { success, selector: params.selector };
    });

    this.wsClient.registerHandler("harpy.dom.type", async (params: { selector: string; text: string; options?: any }) => {
      if (!params || !params.selector || typeof params.text !== "string") {
        throw new Error("Missing 'selector' or 'text' parameter");
      }
      const success = await DomAutomation.type(params.selector, params.text, {
        highlight: true,
        clearFirst: true,
        ...params.options,
      });
      return { success, selector: params.selector };
    });

    this.wsClient.registerHandler("harpy.dom.waitFor", async (params: { selector: string; timeoutMs?: number }) => {
      if (!params || !params.selector) throw new Error("Missing 'selector' parameter");
      const el = await DomAutomation.waitForElement(params.selector, params.timeoutMs);
      return { found: !!el, elementInfo: DomAutomation.extractElementInfo(el) };
    });

    this.wsClient.registerHandler("harpy.dom.waitForDisappear", async (params: { selector: string; timeoutMs?: number }) => {
      if (!params || !params.selector) throw new Error("Missing 'selector' parameter");
      const disappeared = await DomAutomation.waitForElementToDisappear(params.selector, params.timeoutMs);
      return { disappeared };
    });

    this.wsClient.registerHandler("harpy.dom.extract", async (params: { selector: string }) => {
      if (!params || !params.selector) throw new Error("Missing 'selector' parameter");
      const info = DomAutomation.extractElementInfo(params.selector);
      return { info };
    });

    this.wsClient.registerHandler("harpy.dom.highlight", async (params: { selector: string; durationMs?: number }) => {
      if (!params || !params.selector) throw new Error("Missing 'selector' parameter");
      const el = document.querySelector<HTMLElement>(params.selector);
      if (el) {
        DomAutomation.highlight(el, params.durationMs || 1000);
        return { success: true };
      }
      return { success: false, error: "Element not found" };
    });

    // ==========================================
    // 9. Angular Main World Bridge RPCs
    // ==========================================
    this.wsClient.registerHandler("harpy.bridge.call", async (params: { action: any; payload?: any; timeoutMs?: number }) => {
      if (!params || !params.action) throw new Error("Missing 'action' parameter");
      const result = await MainWorldBridgeClient.call(params.action, params.payload, params.timeoutMs);
      return result;
    });

    this.wsClient.registerHandler("harpy.bridge.angularStatus", async () => {
      return MainWorldBridgeClient.getAngularStatus();
    });

    this.wsClient.registerHandler("harpy.bridge.getComponent", async (params: { selector: string; maxDepth?: number }) => {
      if (!params || !params.selector) throw new Error("Missing 'selector' parameter");
      return MainWorldBridgeClient.getComponentData(params.selector, params.maxDepth);
    });

    this.wsClient.registerHandler("harpy.bridge.changeDetection", async (params: { selector?: string }) => {
      return MainWorldBridgeClient.triggerChangeDetection(params?.selector);
    });

    // ==========================================
    // 10. Table Actions
    // ==========================================
    this.wsClient.registerHandler("harpy.triggerAction", async (params: {
      actionType: string;
      worldId?: string;
      diceFormula?: string;
      tableUidOrName?: string;
      message?: string;
      entityId?: string;
      variableName?: string;
      variableDelta?: number;
      isSecret?: boolean;
    }) => {
      console.log("🦅 [HarpySync] Triggered Table Action:", params);
      return {
        status: "executed",
        actionType: params?.actionType,
        diceFormula: params?.diceFormula,
        message: params?.message,
        tableUidOrName: params?.tableUidOrName,
        entityId: params?.entityId,
        variableName: params?.variableName,
        variableDelta: params?.variableDelta,
        isSecret: params?.isSecret,
        timestamp: Date.now(),
      };
    });
  }

  /**
   * Fetches comprehensive entity data combining Firestore REST (if available) and Live DOM / Angular state.
   */
  private async fetchEntityDetails(
    entityId: string,
    worldId?: string,
    options?: { includeChunks?: boolean; includeVariables?: boolean }
  ): Promise<any> {
    const includeChunks = options?.includeChunks !== false;
    const includeVariables = options?.includeVariables !== false;

    let firestoreData: any = null;
    const token = await this.tokenExtractor.getValidToken();

    // 1. Try Firestore REST if token and worldId are available
    if (token && worldId) {
      try {
        const firestoreClient = new FirestoreRestClient({
          projectId: "harpy-gg",
          authToken: token.accessToken,
        });
        firestoreData = await firestoreClient.getDocument(`worlds/${worldId}/entities/${entityId}`);
      } catch (err: any) {
        console.warn("🦅 [HarpySync] Firestore REST fetch skipped/failed:", err.message);
      }
    }

    // 2. Extract DOM data from active page
    const domData = this.extractEntityDataFromDom();

    // 3. Merge data
    const name = firestoreData?.name || domData.name || "Untitled Entity";
    const type = firestoreData?.type || domData.type || "character";
    const avatar = firestoreData?.avatar || firestoreData?.photoUrl || domData.avatar || undefined;
    const folder = firestoreData?.folder || domData.folder || undefined;
    const tags = firestoreData?.tags || domData.tags || [];

    const variables: Record<string, any> = {};
    if (includeVariables) {
      if (firestoreData?.data && typeof firestoreData.data === "object") {
        Object.assign(variables, firestoreData.data);
      }
      if (firestoreData?.variables && typeof firestoreData.variables === "object") {
        Object.assign(variables, firestoreData.variables);
      }
      // Add / override with live sheet DOM variables
      Object.assign(variables, domData.variables);
    }

    const chunks: any[] = [];
    if (includeChunks) {
      if (Array.isArray(firestoreData?.chunks)) {
        chunks.push(...firestoreData.chunks);
      }
      if (domData.chunks.length > 0 && chunks.length === 0) {
        chunks.push(...domData.chunks);
      }
    }

    // Generate markdown representation
    const markdown = this.reconstructMarkdown({
      name,
      type,
      folder,
      tags,
      avatar,
      variables,
      chunks,
      body: domData.bodyText,
    });

    const entity = {
      id: entityId,
      uid: entityId,
      worldId: worldId || this.currentContext?.worldId,
      name,
      type,
      avatar,
      avatarUrl: avatar,
      folder,
      tags,
      createdAt: firestoreData?.createdAt,
      updatedAt: firestoreData?.updatedAt || Date.now(),
    };

    return {
      entity,
      avatar,
      variables,
      chunks,
      pages: domData.pages,
      markdown,
    };
  }

  /**
   * Extracts entity details directly from the active DOM.
   */
  private extractEntityDataFromDom(): {
    name?: string;
    type?: string;
    avatar?: string;
    folder?: string;
    tags: string[];
    variables: Record<string, any>;
    chunks: Array<{ uid: string; name: string; type: string; content: string }>;
    pages: Array<{ title: string; content: string }>;
    bodyText: string;
  } {
    // 1. Name
    const nameEl = document.querySelector<HTMLElement>(
      "h1.title, .entity-name, .entity-title, input.entity-name-input, h1"
    );
    const name = nameEl instanceof HTMLInputElement ? nameEl.value : nameEl?.innerText?.trim();

    // 2. Avatar
    const avatarImg = document.querySelector<HTMLImageElement>(
      "h-image-picker img, .entity-avatar img, img.avatar, img[src*='firebasestorage']"
    );
    const avatar = avatarImg?.src || undefined;

    // 3. Tags
    const tagElements = Array.from(document.querySelectorAll<HTMLElement>(".tag-item, .entity-tag, sl-tag"));
    const tags = tagElements.map((t) => t.innerText?.trim()).filter(Boolean);

    // 4. Variables from Sheet Drawer
    const variables: Record<string, any> = {};
    const sheetInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "h-sheet-drawer input, h-sheet-drawer textarea, h-character-sheet input, .character-sheet input"
      )
    );

    for (const input of sheetInputs) {
      const varName =
        input.getAttribute("data-var-name") ||
        input.getAttribute("name") ||
        input.getAttribute("id") ||
        input.getAttribute("aria-label");
      if (varName && input.value !== undefined && input.value !== "") {
        const num = Number(input.value);
        variables[varName] = isNaN(num) || input.value.trim() === "" ? input.value : num;
      }
    }

    // 5. Pages and Chunks from Codex
    const chunks: Array<{ uid: string; name: string; type: string; content: string }> = [];
    const pages: Array<{ title: string; content: string }> = [];

    const pageElements = Array.from(document.querySelectorAll<HTMLElement>("h-codex-page-tab, .page-item, nav.pages button"));
    for (let i = 0; i < pageElements.length; i++) {
      const pageTitle = pageElements[i].innerText?.trim() || `Page ${i + 1}`;
      pages.push({ title: pageTitle, content: "" });
    }

    const textBlocks = Array.from(
      document.querySelectorAll<HTMLElement>(".tox-tinymce, .text-block, .codex-block, div[contenteditable='true']")
    );
    for (let i = 0; i < textBlocks.length; i++) {
      const text = textBlocks[i].innerText?.trim() || "";
      if (text) {
        chunks.push({
          uid: `chunk_${i + 1}`,
          name: `Section ${i + 1}`,
          type: "text",
          content: text,
        });
      }
    }

    const bodyEl = document.querySelector<HTMLElement>(".entity-description, .codex-content, .body-content");
    const bodyText = bodyEl?.innerText?.trim() || "";

    return {
      name: name || undefined,
      avatar,
      tags,
      variables,
      chunks,
      pages,
      bodyText,
    };
  }

  /**
   * Reconstructs an Obsidian-compatible Markdown document with YAML frontmatter.
   */
  private reconstructMarkdown(data: {
    name: string;
    type?: string;
    folder?: string;
    tags?: string[];
    avatar?: string;
    variables?: Record<string, any>;
    chunks?: Array<{ uid: string; name?: string; content?: string }>;
    body?: string;
  }): string {
    const lines: string[] = ["---"];
    lines.push(`name: "${data.name.replace(/"/g, '\\"')}"`);
    if (data.type) lines.push(`type: "${data.type}"`);
    if (data.folder) lines.push(`folder: "${data.folder}"`);
    if (data.avatar) lines.push(`avatar: "${data.avatar}"`);
    if (data.tags && data.tags.length > 0) {
      lines.push(`tags: [${data.tags.map((t) => `"${t}"`).join(", ")}]`);
    }

    if (data.variables && Object.keys(data.variables).length > 0) {
      lines.push("variables:");
      for (const [k, v] of Object.entries(data.variables)) {
        if (typeof v === "number" || typeof v === "boolean") {
          lines.push(`  ${k}: ${v}`);
        } else {
          lines.push(`  ${k}: "${String(v).replace(/"/g, '\\"')}"`);
        }
      }
    }
    lines.push("---");
    lines.push("");
    lines.push(`# ${data.name}`);
    lines.push("");

    if (data.avatar) {
      lines.push(`![Avatar](${data.avatar})`);
      lines.push("");
    }

    if (data.body) {
      lines.push(data.body);
      lines.push("");
    }

    if (data.chunks && data.chunks.length > 0) {
      for (const chunk of data.chunks) {
        if (chunk.name) {
          lines.push(`## ${chunk.name}`);
        }
        if (chunk.content) {
          lines.push(chunk.content);
        }
        lines.push("");
      }
    }

    return lines.join("\n").trim();
  }

  /**
   * Creates an entity in Harpy via Firestore REST.
   */
  private async createEntity(worldId: string, params: any): Promise<any> {
    const token = await this.tokenExtractor.getValidToken();
    if (!token) {
      throw new Error("Cannot create entity: Firebase auth token not available");
    }

    const firestoreClient = new FirestoreRestClient({
      projectId: "harpy-gg",
      authToken: token.accessToken,
    });

    const entityPayload = {
      name: params.name,
      type: params.type || "character",
      folder: params.folder || "",
      tags: params.tags || [],
      data: params.variables || {},
      variables: params.variables || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const doc = await firestoreClient.createDocument(
      `worlds/${worldId}/entities`,
      undefined,
      entityPayload
    );

    return {
      success: true,
      entityId: (doc as any)?.id || (doc as any)?.name?.split("/").pop(),
      entity: doc,
    };
  }

  /**
   * Updates an entity in Harpy via Firestore REST updateMask.
   */
  private async updateEntity(worldId: string, entityId: string, params: any): Promise<any> {
    const token = await this.tokenExtractor.getValidToken();
    if (!token) {
      throw new Error("Cannot update entity: Firebase auth token not available");
    }

    const firestoreClient = new FirestoreRestClient({
      projectId: "harpy-gg",
      authToken: token.accessToken,
    });

    const patchData: Record<string, any> = {
      updatedAt: Date.now(),
    };

    if (params.name !== undefined) patchData.name = params.name;
    if (params.folder !== undefined) patchData.folder = params.folder;
    if (params.tags !== undefined) patchData.tags = params.tags;
    if (params.variables !== undefined) {
      patchData.variables = params.variables;
      patchData.data = params.variables;
    }

    const doc = await firestoreClient.patchDocument(
      `worlds/${worldId}/entities/${entityId}`,
      patchData,
      params.updateMask
    );

    return {
      success: true,
      entityId,
      updatedFields: params.updateMask || Object.keys(patchData),
      entity: doc,
    };
  }

  /**
   * Lists entities from a Harpy world via Firestore REST.
   */
  private async listEntities(worldId: string, params: any): Promise<any> {
    const token = await this.tokenExtractor.getValidToken();
    if (!token) {
      return { entities: [], total: 0 };
    }

    const firestoreClient = new FirestoreRestClient({
      projectId: "harpy-gg",
      authToken: token.accessToken,
    });

    const result = await firestoreClient.listDocuments(`worlds/${worldId}/entities`, {
      pageSize: params.limit || 50,
    });

    let entities = result.documents || [];

    if (params.type) {
      entities = entities.filter((e: any) => e.type === params.type);
    }
    if (params.folder) {
      entities = entities.filter((e: any) => e.folder === params.folder);
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      entities = entities.filter((e: any) => (e.name || "").toLowerCase().includes(q));
    }

    return {
      entities,
      total: entities.length,
      nextPageToken: result.nextPageToken,
    };
  }

  private async updateContext(): Promise<HarpyContext> {
    const url = window.location.href;
    const pathParts = window.location.pathname.split("/").filter(Boolean);

    let entityId: string | undefined;
    let worldId: string | undefined;
    let campaignId: string | undefined;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (part === "entities" || part === "entity") {
        entityId = pathParts[i + 1];
      } else if (part === "worlds" || part === "world") {
        worldId = pathParts[i + 1];
      } else if (part === "campaigns" || part === "campaign") {
        campaignId = pathParts[i + 1];
      }
    }

    if (!entityId && pathParts.length > 0) {
      const last = pathParts[pathParts.length - 1];
      if (last.length >= 16) {
        entityId = last;
      }
    }

    if (!this.latestToken) {
      this.latestToken = await this.tokenExtractor.getValidToken();
    }

    this.currentContext = {
      entityId,
      worldId,
      campaignId,
      token: this.latestToken?.accessToken,
      user: this.latestToken || undefined,
      currentUrl: url,
      title: document.title,
      timestamp: Date.now(),
    };

    return this.currentContext;
  }

  private setupRuntimeMessaging(): void {
    chrome.runtime.onMessage.addListener((message: ExtensionRuntimeMessage, _sender, sendResponse) => {
      switch (message.type) {
        case "GET_STATUS":
          sendResponse({
            wsStatus: this.wsClient.getStatus(),
            wsUrl: this.wsClient.getUrl(),
            isHarpyTab: true,
            tokenData: this.latestToken,
            harpyContext: this.currentContext,
          });
          break;

        case "EXTRACT_TOKEN":
          this.tokenExtractor
            .extractToken()
            .then((result) => {
              if (result.success && result.tokenData) {
                this.latestToken = result.tokenData;
                this.updateContext();
              }
              sendResponse(result);
            })
            .catch((err) => sendResponse({ success: false, error: err.message }));
          return true;

        case "RECONNECT_WS":
          this.wsClient.disconnect();
          this.wsClient.connect();
          sendResponse({ success: true, status: this.wsClient.getStatus() });
          break;

        case "RPC_REQUEST":
          this.wsClient
            .executeHandler(message.method, message.params)
            .then((result) => sendResponse({ success: true, result }))
            .catch((err) => sendResponse({ success: false, error: err.message || String(err) }));
          return true;

        default:
          sendResponse({ error: "Unknown message type" });
      }
      return false;
    });
  }

  private notifyRuntimeStatus(): void {
    try {
      chrome.runtime.sendMessage({
        type: "STATUS_UPDATE",
        payload: {
          wsStatus: this.wsClient.getStatus(),
          wsUrl: this.wsClient.getUrl(),
          tokenData: this.latestToken,
          harpyContext: this.currentContext,
        },
      }).catch(() => {
        // Ignore disconnected popup listeners
      });
    } catch {
      // Ignore
    }
  }
}

// Instantiate on document load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new HarpyContentBridge());
} else {
  new HarpyContentBridge();
}
