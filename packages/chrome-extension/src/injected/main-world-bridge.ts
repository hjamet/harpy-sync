/**
 * Main World Bridge: Executed in the webpage's MAIN_WORLD execution context
 * Provides direct access to Angular 14-17+ internal APIs (window.ng), component state,
 * form controls, change detection, and window-level services.
 */

import {
  BRIDGE_CHANNEL,
  BridgeAction,
  BridgeRequestMessage,
  BridgeResponseMessage,
} from "../types";

declare global {
  interface Window {
    ng?: {
      getComponent: <T = any>(element: Element) => T | null;
      getContext: <T = any>(element: Element) => T | null;
      getDirectives: (element: Element) => any[];
      applyChanges: (component: any) => void;
      getRootComponents: (element: Element) => any[];
      getInjector: (element: Element) => any;
    };
    getAllAngularRootElements?: () => Element[];
    getAllAngularTestabilities?: () => any[];
    firebase?: any;
    __harpyBridgeInitialized?: boolean;
  }
}

(() => {
  if (window.__harpyBridgeInitialized) {
    console.log("[HarpyMainWorldBridge] Already initialized in MAIN_WORLD");
    return;
  }
  window.__harpyBridgeInitialized = true;

  console.log("🚀 [HarpyMainWorldBridge] Initialized in MAIN_WORLD context on", window.location.href);

  // Listen for messages from Content Script (isolated world)
  window.addEventListener("message", async (event: MessageEvent) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    const data = event.data as BridgeRequestMessage;
    if (!data || data.channel !== BRIDGE_CHANNEL || data.direction !== "FROM_CONTENT_SCRIPT") {
      return;
    }

    const { id, action, payload } = data;

    try {
      const result = await handleBridgeAction(action, payload);
      sendBridgeResponse(id, action, true, result);
    } catch (err: any) {
      sendBridgeResponse(id, action, false, undefined, err.message || String(err));
    }
  });

  async function handleBridgeAction(action: BridgeAction, payload: any): Promise<any> {
    switch (action) {
      case "PING":
        return {
          pong: true,
          timestamp: Date.now(),
          url: window.location.href,
          hasAngularNg: typeof window.ng !== "undefined",
          hasFirebase: typeof window.firebase !== "undefined",
        };

      case "GET_ANGULAR_STATUS": {
        const hasNg = typeof window.ng !== "undefined";
        const rootElements = window.getAllAngularRootElements ? window.getAllAngularRootElements() : [];
        const rootTags = rootElements.map((el) => el.tagName.toLowerCase());

        return {
          detected: hasNg || rootElements.length > 0,
          hasNgDebugApi: hasNg,
          rootElementsCount: rootElements.length,
          rootTags,
          url: window.location.href,
        };
      }

      case "EVAL_EXPRESSION": {
        if (!payload || typeof payload.code !== "string") {
          throw new Error("Payload 'code' is required for EVAL_EXPRESSION");
        }
        // Safely evaluate in main world scope
        const fn = new Function("window", "document", `return (${payload.code});`);
        const result = fn(window, document);
        return sanitizeObject(result);
      }

      case "GET_COMPONENT_DATA": {
        if (!payload || typeof payload.selector !== "string") {
          throw new Error("Payload 'selector' is required for GET_COMPONENT_DATA");
        }
        const el = document.querySelector(payload.selector);
        if (!el) {
          throw new Error(`Element not found for selector: '${payload.selector}'`);
        }

        if (!window.ng || !window.ng.getComponent) {
          return {
            found: true,
            tagName: el.tagName.toLowerCase(),
            hasNgDebug: false,
            attributes: extractAttributes(el),
          };
        }

        const component = window.ng.getComponent(el) || window.ng.getContext(el);
        if (!component) {
          return {
            found: true,
            tagName: el.tagName.toLowerCase(),
            componentFound: false,
          };
        }

        const componentName = component.constructor ? component.constructor.name : "AnonymousComponent";
        return {
          found: true,
          componentName,
          state: sanitizeObject(component, payload.maxDepth || 2),
        };
      }

      case "SET_CONTROL_VALUE": {
        if (!payload || typeof payload.selector !== "string" || payload.value === undefined) {
          throw new Error("Payload 'selector' and 'value' are required for SET_CONTROL_VALUE");
        }
        const el = document.querySelector<HTMLElement>(payload.selector);
        if (!el) {
          throw new Error(`Element not found for selector: '${payload.selector}'`);
        }

        // Try Angular NgControl if available
        let angularUpdated = false;
        if (window.ng && window.ng.getDirectives) {
          const directives = window.ng.getDirectives(el);
          for (const dir of directives) {
            if (dir && typeof dir.control !== "undefined" && typeof dir.control.setValue === "function") {
              dir.control.setValue(payload.value, { emitEvent: true });
              if (typeof dir.control.updateValueAndValidity === "function") {
                dir.control.updateValueAndValidity();
              }
              angularUpdated = true;
              break;
            }
          }
        }

        // Also trigger native input / change
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.value = payload.value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // Apply Angular Change Detection
        if (window.ng && window.ng.applyChanges) {
          const comp = window.ng.getComponent(el) || window.ng.getContext(el);
          if (comp) {
            window.ng.applyChanges(comp);
          }
        }

        return { success: true, angularUpdated };
      }

      case "TRIGGER_CHANGE_DETECTION": {
        let appliedCount = 0;
        if (window.ng && window.ng.applyChanges) {
          if (payload?.selector) {
            const el = document.querySelector(payload.selector);
            if (el) {
              const comp = window.ng.getComponent(el) || window.ng.getContext(el);
              if (comp) {
                window.ng.applyChanges(comp);
                appliedCount++;
              }
            }
          } else if (window.getAllAngularRootElements) {
            const roots = window.getAllAngularRootElements();
            for (const root of roots) {
              const comp = window.ng.getComponent(root);
              if (comp) {
                window.ng.applyChanges(comp);
                appliedCount++;
              }
            }
          }
        }
        return { success: true, appliedCount };
      }

      case "GET_AUTH_STATE": {
        if (window.firebase && typeof window.firebase.auth === "function") {
          try {
            const currentUser = window.firebase.auth().currentUser;
            if (currentUser) {
              const idToken = await currentUser.getIdToken(false);
              return {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                idToken,
              };
            }
          } catch (authErr: any) {
            console.warn("[HarpyMainWorldBridge] Firebase auth query error:", authErr);
          }
        }
        return { available: false };
      }

      case "TRIGGER_ACTION": {
        if (!payload || !payload.actionName) {
          throw new Error("Payload 'actionName' is required for TRIGGER_ACTION");
        }
        // Custom action handlers for Harpy interface
        switch (payload.actionName) {
          case "navigate":
            if (payload.path) {
              window.history.pushState({}, "", payload.path);
              window.dispatchEvent(new PopStateEvent("popstate"));
              return { navigated: true, path: payload.path };
            }
            break;
          default:
            throw new Error(`Unknown action name: '${payload.actionName}'`);
        }
        return { success: true };
      }

      default:
        throw new Error(`Unhandled bridge action: '${action}'`);
    }
  }

  function sendBridgeResponse(
    id: string,
    action: BridgeAction,
    success: boolean,
    result?: any,
    error?: string
  ): void {
    const res: BridgeResponseMessage = {
      channel: BRIDGE_CHANNEL,
      direction: "FROM_MAIN_WORLD",
      id,
      action,
      success,
      result,
      error,
    };
    window.postMessage(res, "*");
  }

  function extractAttributes(el: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      attrs[a.name] = a.value;
    }
    return attrs;
  }

  function sanitizeObject(obj: any, maxDepth = 2, currentDepth = 0): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;
    if (currentDepth >= maxDepth) return "[Object]";

    // Handle functions
    if (typeof obj === "function") return undefined;

    // Handle Arrays
    if (Array.isArray(obj)) {
      return obj.slice(0, 50).map((item) => sanitizeObject(item, maxDepth, currentDepth + 1));
    }

    // Handle DOM Elements
    if (obj instanceof Element || (obj.nodeType && obj.nodeName)) {
      return `[DOM Element <${obj.tagName ? obj.tagName.toLowerCase() : "node"}>]`;
    }

    // Clean plain objects
    const copy: Record<string, any> = {};
    const seen = new Set();

    for (const key of Object.keys(obj)) {
      if (key.startsWith("_") || key.startsWith("$$")) continue; // Skip private/framework internals
      try {
        const val = obj[key];
        if (typeof val === "function") continue;
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) continue; // Circular ref avoidance
          seen.add(val);
        }
        copy[key] = sanitizeObject(val, maxDepth, currentDepth + 1);
      } catch {
        // Skip inaccessible getters
      }
    }

    return copy;
  }
})();
