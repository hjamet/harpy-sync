export const WS_BRIDGE_PORT = 18765;
export const WS_BRIDGE_HOST = "127.0.0.1";

export interface HarpyTabState {
  tabId?: number;
  url?: string;
  worldId?: string;
  entityId?: string;
  entityType?: string;
  hasToken?: boolean;
  active?: boolean;
  connected?: boolean;
  timestamp?: string | number;
  lastUpdated?: string | number;
}

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface ObsidianNotePage {
  uid?: string;
  name: string;
  type?: string;
  markdown: string;
  order: number;
}

export interface ParsedObsidianNote {
  name: string;
  uid?: string;
  worldUid?: string;
  type: string;
  folder?: string;
  tags: string[];
  variables: Record<string, string | number | boolean>;
  frontmatter: Record<string, unknown>;
  chunks: Array<{ uid: string; name?: string; type: string; order?: number; text?: string; content?: string }>;
  pages: ObsidianNotePage[];
  rawMarkdown: string;
  cleanBody: string;
}

export interface EntityDiffResult {
  hasDiff: boolean;
  nameChanged: boolean;
  oldName?: string;
  newName?: string;
  typeChanged: boolean;
  oldType?: string;
  newType?: string;
  folderChanged: boolean;
  oldFolder?: string;
  newFolder?: string;
  tagsAdded: string[];
  tagsRemoved: string[];
  variablesModified: Record<string, { oldValue: unknown; newValue: unknown }>;
  variablesAdded: Record<string, unknown>;
  variablesRemoved: string[];
  chunksModified: boolean;
  diffSummary: string[];
}
