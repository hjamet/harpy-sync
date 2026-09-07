/**
 * @harpy/chrome-extension Types and Protocol Definitions
 */

// ==========================================
// 1. Firebase Token & Session Types
// ==========================================

export interface FirebaseTokenData {
  accessToken: string;
  refreshToken?: string;
  expirationTime?: number;
  uid?: string;
  email?: string;
  displayName?: string;
  photoUrl?: string;
  extractedAt: number;
}

export interface HarpyContext {
  entityId?: string;
  worldId?: string;
  campaignId?: string;
  token?: string;
  user?: FirebaseTokenData;
  currentUrl: string;
  title: string;
  timestamp: number;
}

export interface TokenExtractionResult {
  success: boolean;
  tokenData?: FirebaseTokenData;
  error?: string;
}

// ==========================================
// 2. JSON-RPC 2.0 Protocol Types
// ==========================================

export type JsonRpcId = string | number;

export interface JsonRpcRequest<T = any> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: T;
}

export interface JsonRpcNotification<T = any> {
  jsonrpc: "2.0";
  method: string;
  params?: T;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: any;
}

export interface JsonRpcSuccessResponse<T = any> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: T;
  error?: never;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
  result?: never;
}

export type JsonRpcResponse<T = any> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export enum JsonRpcErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000,
  Timeout = -32001,
  DomError = -32002,
  AuthError = -32003,
}

// ==========================================
// 3. DOM Automation Types
// ==========================================

export interface DomClickOptions {
  timeoutMs?: number;
  scrollIntoView?: boolean;
  delayBeforeClickMs?: number;
  delayAfterClickMs?: number;
  simulatePhysics?: boolean;
  highlight?: boolean;
}

export interface DomInputOptions {
  timeoutMs?: number;
  scrollIntoView?: boolean;
  clearFirst?: boolean;
  delayBetweenKeysMs?: number;
  simulatePhysics?: boolean;
  highlight?: boolean;
  triggerAngularChange?: boolean;
}

export interface DomWaitForOptions {
  timeoutMs?: number;
  visibleOnly?: boolean;
  parentSelector?: string;
}

export interface DomExtractOptions {
  attribute?: string;
  asHtml?: boolean;
  multiple?: boolean;
}

export interface DomElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  value?: string;
  text?: string;
  isVisible: boolean;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  attributes: Record<string, string>;
}

// ==========================================
// 4. Main World Bridge Types
// ==========================================

export const BRIDGE_CHANNEL = "__HARPY_MAIN_WORLD_BRIDGE__";

export type BridgeAction =
  | "PING"
  | "GET_ANGULAR_STATUS"
  | "EVAL_EXPRESSION"
  | "GET_COMPONENT_DATA"
  | "SET_CONTROL_VALUE"
  | "TRIGGER_CHANGE_DETECTION"
  | "GET_AUTH_STATE"
  | "TRIGGER_ACTION";

export interface BridgeRequestMessage<T = any> {
  channel: typeof BRIDGE_CHANNEL;
  direction: "FROM_CONTENT_SCRIPT";
  id: string;
  action: BridgeAction;
  payload?: T;
}

export interface BridgeResponseMessage<T = any> {
  channel: typeof BRIDGE_CHANNEL;
  direction: "FROM_MAIN_WORLD";
  id: string;
  action: BridgeAction;
  success: boolean;
  result?: T;
  error?: string;
}

export interface AngularComponentInfo {
  found: boolean;
  componentName?: string;
  state?: Record<string, any>;
  hasChangeDetector?: boolean;
}

// ==========================================
// 5. WebSocket Client Types
// ==========================================

export type WsConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface WsClientOptions {
  url?: string;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectFactor?: number;
  pingIntervalMs?: number;
  requestTimeoutMs?: number;
  debug?: boolean;
}

// ==========================================
// 6. Extension Runtime & Popup Types
// ==========================================

export interface ExtensionRuntimeMessage {
  type:
    | "GET_STATUS"
    | "STATUS_UPDATE"
    | "EXTRACT_TOKEN"
    | "RECONNECT_WS"
    | "PING_WS"
    | "TEST_DOM_AUTOMATION"
    | "LOG_MESSAGE";
  payload?: any;
}

export interface PopupState {
  wsStatus: WsConnectionStatus;
  wsUrl: string;
  isHarpyTab: boolean;
  tokenData: FirebaseTokenData | null;
  harpyContext: HarpyContext | null;
  logs: Array<{
    timestamp: number;
    level: "info" | "success" | "warn" | "error";
    message: string;
  }>;
}
