/**
 * Bridge Client: Content-script side wrapper to send typed requests to main-world-bridge.js
 */

import {
  BRIDGE_CHANNEL,
  BridgeAction,
  BridgeRequestMessage,
  BridgeResponseMessage,
} from "../types";

export class MainWorldBridgeClient {
  private static requestIdCounter = 1;
  private static readonly pendingCalls: Map<
    string,
    {
      resolve: (result: any) => void;
      reject: (error: any) => void;
      timer: number;
    }
  > = new Map();
  private static isListening = false;

  public static initialize(): void {
    if (this.isListening) return;
    this.isListening = true;

    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return;

      const data = event.data as BridgeResponseMessage;
      if (!data || data.channel !== BRIDGE_CHANNEL || data.direction !== "FROM_MAIN_WORLD") {
        return;
      }

      const pending = this.pendingCalls.get(data.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCalls.delete(data.id);

        if (data.success) {
          pending.resolve(data.result);
        } else {
          pending.reject(new Error(data.error || "Unknown error in Main World Bridge"));
        }
      }
    });
  }

  /**
   * Inject the main world bridge script into the page DOM
   */
  public static injectBridgeScript(): boolean {
    if (document.getElementById("__harpy_main_world_bridge_script__")) {
      return true;
    }

    try {
      const script = document.createElement("script");
      script.id = "__harpy_main_world_bridge_script__";
      script.src = chrome.runtime.getURL("injected/main-world-bridge.js");
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
      console.log("[HarpyBridgeClient] Injected main-world-bridge.js script tag");
      return true;
    } catch (err) {
      console.error("[HarpyBridgeClient] Failed to inject script tag:", err);
      return false;
    }
  }

  /**
   * Call an action in the MAIN_WORLD context
   */
  public static call<T = any>(action: BridgeAction, payload?: any, timeoutMs = 10000): Promise<T> {
    this.initialize();

    return new Promise((resolve, reject) => {
      const id = `req_${Date.now()}_${this.requestIdCounter++}`;

      const timer = window.setTimeout(() => {
        if (this.pendingCalls.has(id)) {
          this.pendingCalls.delete(id);
          reject(new Error(`Main World Bridge call '${action}' (id: ${id}) timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingCalls.set(id, { resolve, reject, timer });

      const message: BridgeRequestMessage = {
        channel: BRIDGE_CHANNEL,
        direction: "FROM_CONTENT_SCRIPT",
        id,
        action,
        payload,
      };

      window.postMessage(message, "*");
    });
  }

  /**
   * Ping bridge to check if initialized
   */
  public static async ping(): Promise<boolean> {
    try {
      const res = await this.call("PING", undefined, 3000);
      return !!res?.pong;
    } catch {
      return false;
    }
  }

  /**
   * Get Angular status from MAIN_WORLD
   */
  public static async getAngularStatus(): Promise<any> {
    return this.call("GET_ANGULAR_STATUS");
  }

  /**
   * Get Component Data by CSS selector
   */
  public static async getComponentData(selector: string, maxDepth = 2): Promise<any> {
    return this.call("GET_COMPONENT_DATA", { selector, maxDepth });
  }

  /**
   * Trigger Angular change detection
   */
  public static async triggerChangeDetection(selector?: string): Promise<any> {
    return this.call("TRIGGER_CHANGE_DETECTION", { selector });
  }

  /**
   * Evaluate expression in MAIN_WORLD
   */
  public static async evalInMainWorld(code: string): Promise<any> {
    return this.call("EVAL_EXPRESSION", { code });
  }
}
