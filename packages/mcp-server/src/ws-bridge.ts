import { WebSocketServer, WebSocket } from "ws";
import {
  HarpyTabState,
  JsonRpcRequest,
  JsonRpcResponse,
  WS_BRIDGE_PORT,
  WS_BRIDGE_HOST
} from "@harpy/core";

export interface ChromeClient {
  id: string;
  ws: WebSocket;
  tabId?: number;
  url?: string;
  worldId?: string;
  entityId?: string;
  entityType?: string;
  hasToken?: boolean;
  active?: boolean;
  lastSeen: number;
}

export interface WsBridgeOptions {
  port?: number;
  host?: string;
  heartbeatIntervalMs?: number;
}

export class HarpyWsBridge {
  private port: number;
  private host: string;
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ChromeClient>();
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private stateChangeListeners: Array<(state: HarpyTabState | null) => void> = [];

  constructor(options: WsBridgeOptions = {}) {
    this.port = options.port ?? WS_BRIDGE_PORT;
    this.host = options.host ?? WS_BRIDGE_HOST;
  }

  /**
   * Starts the WebSocket server.
   */
  public async start(): Promise<void> {
    if (this.wss) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host
        });

        this.wss.on("listening", () => {
          console.error(`[Harpy-MCP Bridge] WebSocket listening on ws://${this.host}:${this.port}`);
          this.startHeartbeat();
          resolve();
        });

        this.wss.on("connection", (ws: WebSocket) => {
          this.handleConnection(ws);
        });

        this.wss.on("error", (err: any) => {
          console.error(`[Harpy-MCP Bridge] WebSocket Server Error:`, err);
          reject(err);
        });
      } catch (err: any) {
        reject(err);
      }
    });
  }

  /**
   * Stops the WebSocket server and closes all connections.
   */
  public async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Cancel all pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timeout);
      req.reject(new Error(`WebSocket bridge stopped while request ${id} was pending`));
    }
    this.pendingRequests.clear();

    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => {
          this.wss = null;
          this.clients.clear();
          console.error(`[Harpy-MCP Bridge] WebSocket bridge stopped`);
          resolve();
        });
      });
    }
  }

  /**
   * Handles a new WebSocket client connection from Chrome Extension.
   */
  private handleConnection(ws: WebSocket): void {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const client: ChromeClient = {
      id: clientId,
      ws,
      lastSeen: Date.now(),
      active: true
    };

    this.clients.set(clientId, client);
    console.error(`[Harpy-MCP Bridge] Client connected: ${clientId} (Total: ${this.clients.size})`);

    ws.on("message", (raw: any) => {
      client.lastSeen = Date.now();
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf-8");
        const msg = JSON.parse(text);
        this.handleIncomingMessage(client, msg);
      } catch (err: any) {
        console.error(`[Harpy-MCP Bridge] Failed to parse message from ${clientId}:`, err);
      }
    });

    ws.on("close", () => {
      this.clients.delete(clientId);
      console.error(`[Harpy-MCP Bridge] Client disconnected: ${clientId} (Remaining: ${this.clients.size})`);
      this.notifyStateChange();
    });

    ws.on("error", (err: any) => {
      console.error(`[Harpy-MCP Bridge] Client error (${clientId}):`, err);
      this.clients.delete(clientId);
    });

    // Request initial state from client
    this.sendToClient(client, {
      type: "get_tab_state"
    });
  }

  /**
   * Handles incoming JSON messages from a connected Chrome extension tab.
   */
  private handleIncomingMessage(client: ChromeClient, msg: any): void {
    // 1. Handle JSON-RPC 2.0 Responses
    if (msg.jsonrpc === "2.0" && msg.id) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id);

        if (msg.error) {
          pending.reject(new Error(msg.error.message || `RPC Error (${msg.error.code})`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 2. Handle Tab State Announcements / Heartbeats / JSON-RPC Notifications
    if (
      msg.type === "tab_state" ||
      msg.type === "register" ||
      msg.state ||
      msg.method === "harpy.clientReady" ||
      msg.method === "harpy/clientReady" ||
      msg.method === "harpy.tokenUpdated" ||
      msg.method === "harpy/tokenUpdated" ||
      msg.method === "harpy.tabState" ||
      msg.method === "harpy/tabState"
    ) {
      const state = msg.params || msg.state || msg;
      client.tabId = state.tabId ?? client.tabId;
      client.url = state.url ?? client.url;
      client.worldId = state.worldId ?? client.worldId;
      client.entityId = state.entityId ?? client.entityId;
      client.entityType = state.entityType ?? client.entityType;
      client.hasToken = state.hasToken ?? (state.token || state.uid ? true : client.hasToken);
      client.active = state.active ?? true;

      // Parse worldId / entityId from url if missing
      if (client.url && (!client.worldId || !client.entityId)) {
        try {
          const parsedUrl = new URL(client.url);
          const parts = parsedUrl.pathname.split("/").filter(Boolean);
          for (let i = 0; i < parts.length; i++) {
            if (parts[i] === "worlds" || parts[i] === "world") {
              client.worldId = parts[i + 1] || client.worldId;
            } else if (parts[i] === "entities" || parts[i] === "entity") {
              client.entityId = parts[i + 1] || client.entityId;
            }
          }
        } catch {
          // ignore
        }
      }

      this.notifyStateChange();
      return;
    }

    // 3. Handle Ping
    if (msg.type === "ping" || msg.method === "harpy.ping" || msg.method === "harpy/ping") {
      this.sendToClient(client, { type: "pong", timestamp: Date.now() });
      return;
    }
  }

  /**
   * Sends a typed JSON-RPC request to a connected Chrome tab and awaits its response.
   */
  public sendRpcRequest<T = any>(
    method: string,
    params?: Record<string, any>,
    timeoutMs = 15000,
    preferredTabId?: number
  ): Promise<T> {
    const targetClient = this.resolveTargetClient(preferredTabId);
    if (!targetClient || targetClient.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error(
          `Harpy WebSocket bridge error: No active Chrome tab connected on ws://${this.host}:${this.port}. ` +
          `Please ensure Google Chrome is open with the Harpy extension active on a harpy.gg page.`
        )
      );
    }

    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rpcPayload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: reqId,
      method,
      params: params ?? {}
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(
          new Error(
            `RPC request '${method}' (id: ${reqId}) timed out after ${timeoutMs}ms. ` +
            `Make sure the Harpy tab is responsive in Chrome.`
          )
        );
      }, timeoutMs);

      this.pendingRequests.set(reqId, { resolve, reject, timeout });

      try {
        targetClient.ws.send(JSON.stringify(rpcPayload));
      } catch (err) {
        clearTimeout(timeout);
        this.pendingRequests.delete(reqId);
        reject(err);
      }
    });
  }

  /**
   * Resolves the best target Chrome client for a request.
   */
  private resolveTargetClient(preferredTabId?: number): ChromeClient | null {
    if (preferredTabId) {
      for (const client of this.clients.values()) {
        if (client.tabId === preferredTabId && client.ws.readyState === WebSocket.OPEN) {
          return client;
        }
      }
    }

    // Prefer active client with worldId or entityId
    let bestClient: ChromeClient | null = null;
    for (const client of this.clients.values()) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.active && (client.worldId || client.entityId)) {
        return client;
      }
      if (!bestClient || (client.worldId && !bestClient.worldId)) {
        bestClient = client;
      }
    }

    return bestClient;
  }

  /**
   * Returns the state of the active Harpy tab.
   */
  public getActiveTabState(): HarpyTabState {
    const client = this.resolveTargetClient();
    if (!client) {
      return {
        connected: false,
        timestamp: new Date().toISOString()
      };
    }

    return {
      connected: true,
      tabId: client.tabId,
      url: client.url,
      worldId: client.worldId,
      entityId: client.entityId,
      entityType: client.entityType,
      hasToken: client.hasToken ?? false,
      active: client.active ?? true,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Lists all connected Chrome tabs.
   */
  public getConnectedTabs(): HarpyTabState[] {
    const list: HarpyTabState[] = [];
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) {
        list.push({
          connected: true,
          tabId: c.tabId,
          url: c.url,
          worldId: c.worldId,
          entityId: c.entityId,
          entityType: c.entityType,
          hasToken: c.hasToken ?? false,
          active: c.active ?? false,
          timestamp: new Date(c.lastSeen).toISOString()
        });
      }
    }
    return list;
  }

  /**
   * Returns true if at least one Chrome tab is connected.
   */
  public isBridgeConnected(): boolean {
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  /**
   * Subscribes to tab state changes.
   */
  public onStateChange(listener: (state: HarpyTabState | null) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter((l) => l !== listener);
    };
  }

  private notifyStateChange(): void {
    const state = this.getActiveTabState();
    for (const listener of this.stateChangeListeners) {
      try {
        listener(state.connected ? state : null);
      } catch (e) {
        console.error("[Harpy-MCP Bridge] Error in state listener:", e);
      }
    }
  }

  private sendToClient(client: ChromeClient, msg: any): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of this.clients.entries()) {
        if (client.ws.readyState !== WebSocket.OPEN) {
          this.clients.delete(id);
          continue;
        }
        // If inactive for > 60s without ping response, send ping
        if (now - client.lastSeen > 30000) {
          this.sendToClient(client, { type: "ping" });
        }
        if (now - client.lastSeen > 90000) {
          console.error(`[Harpy-MCP Bridge] Client timed out: ${id}`);
          client.ws.terminate();
          this.clients.delete(id);
        }
      }
    }, 15000);
  }
}
