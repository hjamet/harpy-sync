/**
 * Background Service Worker (Manifest V3)
 * Manages loopback WebSocket bridge connection to FastMCP server (ws://127.0.0.1:18765),
 * extension badges, tab detection, and RPC relaying to/from active Harpy tabs.
 */

import { HarpyWsClient } from "../content/ws-client";
import { ExtensionRuntimeMessage } from "../types";

const WS_URL = "ws://127.0.0.1:18765";

// Initialize Background WebSocket Client
const wsClient = new HarpyWsClient({
  url: WS_URL,
  debug: true,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 10000,
});

// Relay RPC to active Harpy tab
async function relayToHarpyTab(method: string, params: any): Promise<any> {
  const tabs = await chrome.tabs.query({ url: "*://*.harpy.gg/*" });
  const activeTab = tabs.find((t) => t.active) || tabs[0];
  if (!activeTab || !activeTab.id) {
    throw new Error("No active Harpy.gg tab found in Chrome");
  }

  const response = await chrome.tabs.sendMessage(activeTab.id, {
    type: "RPC_REQUEST",
    method,
    params,
  });

  if (!response) {
    throw new Error(`No response from Content Script on tab ${activeTab.id} for '${method}'`);
  }
  if (!response.success) {
    throw new Error(response.error || `RPC '${method}' failed on tab ${activeTab.id}`);
  }
  return response.result;
}

// Register WebSocket RPC Handlers
function setupRpcHandlers(): void {
  // System Ping
  wsClient.registerHandler("harpy.ping", async () => {
    const tabs = await chrome.tabs.query({ url: "*://*.harpy.gg/*" });
    const activeTab = tabs.find((t) => t.active) || tabs[0];
    return {
      pong: true,
      timestamp: Date.now(),
      context: "service-worker",
      wsStatus: wsClient.getStatus(),
      activeHarpyTabsCount: tabs.length,
      currentUrl: activeTab?.url,
      title: activeTab?.title,
      tabId: activeTab?.id,
    };
  });

  // Relay Context & Auth methods
  wsClient.registerHandler("harpy.getContext", (params) => relayToHarpyTab("harpy.getContext", params));
  wsClient.registerHandler("harpy.getToken", (params) => relayToHarpyTab("harpy.getToken", params));
  wsClient.registerHandler("harpy.refreshToken", (params) => relayToHarpyTab("harpy.refreshToken", params));

  // Relay DOM Automation methods
  wsClient.registerHandler("harpy.dom.click", (params) => relayToHarpyTab("harpy.dom.click", params));
  wsClient.registerHandler("harpy.dom.type", (params) => relayToHarpyTab("harpy.dom.type", params));
  wsClient.registerHandler("harpy.dom.waitFor", (params) => relayToHarpyTab("harpy.dom.waitFor", params));
  wsClient.registerHandler("harpy.dom.waitForDisappear", (params) => relayToHarpyTab("harpy.dom.waitForDisappear", params));
  wsClient.registerHandler("harpy.dom.extract", (params) => relayToHarpyTab("harpy.dom.extract", params));
  wsClient.registerHandler("harpy.dom.highlight", (params) => relayToHarpyTab("harpy.dom.highlight", params));

  // Relay Table Actions & Navigation
  wsClient.registerHandler("harpy.triggerAction", (params) => relayToHarpyTab("harpy.triggerAction", params));
  wsClient.registerHandler("harpy.navigate", (params) => relayToHarpyTab("harpy.navigate", params));

  // Relay Angular Main World Bridge methods
  wsClient.registerHandler("harpy.bridge.call", (params) => relayToHarpyTab("harpy.bridge.call", params));
  wsClient.registerHandler("harpy.bridge.angularStatus", (params) => relayToHarpyTab("harpy.bridge.angularStatus", params));
  wsClient.registerHandler("harpy.bridge.getComponent", (params) => relayToHarpyTab("harpy.bridge.getComponent", params));
  wsClient.registerHandler("harpy.bridge.changeDetection", (params) => relayToHarpyTab("harpy.bridge.changeDetection", params));
}

// Push active tab state to FastMCP WebSocket bridge
async function broadcastTabState(): Promise<void> {
  if (!wsClient.isConnected()) return;

  try {
    const tabs = await chrome.tabs.query({ url: "*://*.harpy.gg/*" });
    const activeTab = tabs.find((t) => t.active) || tabs[0];
    if (activeTab) {
      wsClient.notify("harpy.clientReady", {
        client: "harpy-chrome-extension",
        tabId: activeTab.id,
        url: activeTab.url,
        title: activeTab.title,
        active: activeTab.active,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    console.error("[HarpyServiceWorker] Error broadcasting tab state:", err);
  }
}

// Setup Event Listeners
wsClient.onStatusChange((status) => {
  console.log(`🦅 [HarpyServiceWorker] WebSocket status: ${status}`);
  if (status === "connected") {
    updateBadge("ON", "#22c55e");
    broadcastTabState();
  } else if (status === "connecting" || status === "reconnecting") {
    updateBadge("...", "#f59e0b");
  } else {
    updateBadge("WS", "#ef4444");
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("🦅 [HarpySync ServiceWorker] Extension Installed / Updated");
  updateBadge("OFF", "#64748b");
  if (!wsClient.isConnected()) wsClient.connect();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!wsClient.isConnected()) wsClient.connect();
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    checkTabAndSetBadge(tab);
    broadcastTabState();
  } catch (err) {
    // Tab might be closing
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!wsClient.isConnected()) wsClient.connect();
  if (changeInfo.status === "complete") {
    if (tab.url && tab.url.includes("harpy.gg")) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content/content.js"],
        });
      } catch (err) {
        // Ignored if already injected
      }
    }
    checkTabAndSetBadge(tab);
    broadcastTabState();
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionRuntimeMessage, _sender, sendResponse) => {
  if (!wsClient.isConnected()) wsClient.connect();
  if (message.type === "RECONNECT_WS" || (message as any).type === "POPUP_OPENED") {
    wsClient.connect();
    broadcastTabState();
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "STATUS_UPDATE" && message.payload) {
    broadcastTabState();
    sendResponse({ received: true });
    return true;
  }
  return false;
});

function checkTabAndSetBadge(tab: chrome.tabs.Tab): void {
  if (!tab.url) {
    updateBadge("", "#64748b");
    return;
  }

  const isHarpy = tab.url.includes("harpy.gg");
  if (isHarpy) {
    if (wsClient.isConnected()) {
      updateBadge("ON", "#22c55e");
    } else {
      updateBadge("...", "#f59e0b");
    }
  } else {
    updateBadge("", "#64748b");
  }
}

function updateBadge(text: string, color: string): void {
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  } catch (e) {
    // Ignore if action API is not available
  }
}

// Start
setupRpcHandlers();
(globalThis as any).wsClient = wsClient;
(globalThis as any).__harpyWsClient = wsClient;
wsClient.connect();

