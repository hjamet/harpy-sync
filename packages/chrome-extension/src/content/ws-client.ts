/**
 * Autonomous WebSocket Client with JSON-RPC 2.0 Router and Exponential Backoff Reconnection
 * Connects to the local Harpy Sync daemon (default: ws://127.0.0.1:18765)
 */

import {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcErrorObject,
  JsonRpcErrorCode,
  WsConnectionStatus,
  WsClientOptions,
} from "../types";

type MethodHandler = (params: any, id?: JsonRpcId) => Promise<any> | any;
type StatusListener = (status: WsConnectionStatus) => void;
type ErrorListener = (error: Error) => void;

export class HarpyWsClient {
  private url: string;
  private ws: WebSocket | null = null;
  private status: WsConnectionStatus = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private nextRequestId = 1;

  private readonly options: Required<WsClientOptions>;
  private readonly handlers: Map<string, MethodHandler> = new Map();
  private readonly pendingRequests: Map<
    JsonRpcId,
    {
      resolve: (result: any) => void;
      reject: (error: any) => void;
      timeout: number;
    }
  > = new Map();

  private readonly statusListeners: Set<StatusListener> = new Set();
  private readonly errorListeners: Set<ErrorListener> = new Set();

  constructor(options: WsClientOptions = {}) {
    this.options = {
      url: options.url || "ws://127.0.0.1:18765",
      reconnectInitialDelayMs: options.reconnectInitialDelayMs || 1000,
      reconnectMaxDelayMs: options.reconnectMaxDelayMs || 30000,
      reconnectFactor: options.reconnectFactor || 1.5,
      pingIntervalMs: options.pingIntervalMs || 15000,
      requestTimeoutMs: options.requestTimeoutMs || 30000,
      debug: options.debug ?? false,
    };
    this.url = this.options.url;
  }

  /**
   * Connect to the WebSocket server
   */
  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      this.log("Already connecting or connected");
      return;
    }

    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    this.log(`Connecting to ${this.url}...`);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
    } catch (err: any) {
      this.log(`WebSocket constructor error: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect the WebSocket
   */
  public disconnect(): void {
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
    this.rejectAllPendingRequests(new Error("WebSocket disconnected by user"));
  }

  /**
   * Register a JSON-RPC 2.0 method handler
   */
  public registerHandler(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
    this.log(`Registered RPC method: '${method}'`);
  }

  /**
   * Unregister a JSON-RPC method handler
   */
  public unregisterHandler(method: string): void {
    this.handlers.delete(method);
  }

  /**
   * Find a handler with alternate name support
   */
  public getHandler(method: string): MethodHandler | undefined {
    let handler = this.handlers.get(method);
    if (!handler) {
      const altMethod = method.includes("/")
        ? method.replace(/\//g, ".")
        : method.replace(/\./g, "/");
      handler = this.handlers.get(altMethod);
    }
    return handler;
  }

  /**
   * Directly execute a registered handler by name
   */
  public async executeHandler(method: string, params?: any): Promise<any> {
    const handler = this.getHandler(method);
    if (!handler) {
      throw new Error(`Handler '${method}' not found`);
    }
    return handler(params);
  }

  /**
   * Send a JSON-RPC 2.0 request and await the response
   */
  public request<T = any>(method: string, params?: any, timeoutMs?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(new Error(`Cannot send RPC request '${method}': WebSocket is not connected (status: ${this.status})`));
      }

      const id = this.nextRequestId++;
      const payload: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`RPC request '${method}' (id: ${id}) timed out after ${timeoutMs || this.options.requestTimeoutMs}ms`));
        }
      }, timeoutMs || this.options.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.sendRaw(JSON.stringify(payload));
    });
  }

  /**
   * Send a JSON-RPC 2.0 notification (no response expected)
   */
  public notify(method: string, params?: any): void {
    if (!this.isConnected()) {
      this.log(`Dropping notification '${method}': WebSocket not connected`);
      return;
    }

    const payload: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.sendRaw(JSON.stringify(payload));
  }

  /**
   * Get current connection status
   */
  public getStatus(): WsConnectionStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === "connected" && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public getUrl(): string {
    return this.url;
  }

  public setUrl(newUrl: string): void {
    if (this.url !== newUrl) {
      this.url = newUrl;
      if (this.isConnected() || this.status === "connecting") {
        this.disconnect();
        this.connect();
      }
    }
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  public onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  // ==========================================
  // Internal WebSocket Event Handlers
  // ==========================================

  private handleOpen(): void {
    this.log("WebSocket connected successfully!");
    this.reconnectAttempts = 0;
    this.setStatus("connected");
    this.startHeartbeat();

    // Announce presence
    this.notify("harpy.clientReady", {
      client: "harpy-chrome-extension",
      url: typeof window !== "undefined" ? window.location.href : "background-service-worker",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "Chrome-ServiceWorker",
      timestamp: Date.now(),
    });
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    try {
      const data = JSON.parse(event.data);
      this.log(`Incoming message:`, data);

      if (Array.isArray(data)) {
        // Batch processing
        for (const item of data) {
          await this.processIncomingJsonRpc(item);
        }
      } else if (typeof data === "object" && data !== null) {
        await this.processIncomingJsonRpc(data);
      }
    } catch (err: any) {
      this.log(`Error parsing incoming WebSocket message: ${err.message}`);
      this.sendErrorResponse(null, JsonRpcErrorCode.ParseError, "Invalid JSON received");
    }
  }

  private async processIncomingJsonRpc(msg: any): Promise<void> {
    // 1. Is it a response to an outgoing request?
    if ("id" in msg && ("result" !== undefined || "error" !== undefined) && !("method" in msg)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || `RPC Error code: ${msg.error.code}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 2. Is it an incoming request or notification from server?
    if ("method" in msg && typeof msg.method === "string") {
      const isRequest = "id" in msg && msg.id !== undefined && msg.id !== null;
      let handler = this.handlers.get(msg.method);
      if (!handler) {
        const altMethod = msg.method.includes("/")
          ? msg.method.replace(/\//g, ".")
          : msg.method.replace(/\./g, "/");
        handler = this.handlers.get(altMethod);
      }

      if (!handler) {
        if (isRequest) {
          this.sendErrorResponse(
            msg.id,
            JsonRpcErrorCode.MethodNotFound,
            `Method '${msg.method}' not found on client extension`
          );
        }
        return;
      }

      try {
        const result = await handler(msg.params, isRequest ? msg.id : undefined);
        if (isRequest) {
          this.sendSuccessResponse(msg.id, result);
        }
      } catch (err: any) {
        if (isRequest) {
          this.sendErrorResponse(
            msg.id,
            JsonRpcErrorCode.InternalError,
            err.message || String(err),
            err.stack
          );
        }
      }
    }
  }

  private handleError(event: Event): void {
    this.log("WebSocket error event:", event);
    const err = new Error("WebSocket error occurred");
    this.errorListeners.forEach((listener) => listener(err));
  }

  private handleClose(event: CloseEvent): void {
    this.log(`WebSocket closed (code: ${event.code}, reason: ${event.reason || "none"})`);
    this.clearTimers();
    this.rejectAllPendingRequests(new Error(`WebSocket connection closed: code ${event.code}`));
    this.setStatus("disconnected");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      this.options.reconnectInitialDelayMs * Math.pow(this.options.reconnectFactor, this.reconnectAttempts - 1),
      this.options.reconnectMaxDelayMs
    );
    const jitter = delay * 0.1 * (Math.random() - 0.5);
    const finalDelay = Math.max(500, Math.round(delay + jitter));

    this.setStatus("reconnecting");
    this.log(`Scheduling reconnect attempt #${this.reconnectAttempts} in ${finalDelay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, finalDelay) as unknown as number;
  }

  private startHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);

    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        this.notify("harpy.ping", { timestamp: Date.now() });
      }
    }, this.options.pingIntervalMs) as unknown as number;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendSuccessResponse(id: JsonRpcId, result: any): void {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      result: result ?? null,
    };
    this.sendRaw(JSON.stringify(res));
  }

  private sendErrorResponse(id: JsonRpcId | null, code: number, message: string, data?: any): void {
    const errorObj: JsonRpcErrorObject = { code, message };
    if (data !== undefined) errorObj.data = data;

    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      error: errorObj,
    };
    this.sendRaw(JSON.stringify(res));
  }

  private sendRaw(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private rejectAllPendingRequests(error: Error): void {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timeout);
      req.reject(error);
    }
    this.pendingRequests.clear();
  }

  private setStatus(newStatus: WsConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((listener) => listener(newStatus));
    }
  }

  private log(...args: any[]): void {
    if (this.options.debug) {
      console.log("[HarpyWsClient]", ...args);
    }
  }
}
