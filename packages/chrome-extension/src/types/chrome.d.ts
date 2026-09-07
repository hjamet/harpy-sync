/**
 * Ambient Type Declarations for Chrome Extension APIs (Manifest V3)
 */

declare namespace chrome {
  export namespace runtime {
    export interface MessageSender {
      tab?: tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
      tlsChannelId?: string;
    }

    export const onInstalled: {
      addListener: (callback: (details: { reason: string; previousVersion?: string }) => void) => void;
    };

    export const onMessage: {
      addListener: (
        callback: (
          message: any,
          sender: MessageSender,
          sendResponse: (response?: any) => void
        ) => boolean | void
      ) => void;
    };

    export function sendMessage(message: any): Promise<any>;
    export function sendMessage(message: any, responseCallback: (response: any) => void): void;
    export function getURL(path: string): string;
    export const lastError: { message?: string } | undefined;
  }

  export namespace tabs {
    export interface Tab {
      id?: number;
      index?: number;
      windowId?: number;
      highlighted?: boolean;
      active?: boolean;
      pinned?: boolean;
      url?: string;
      title?: string;
      favIconUrl?: string;
      status?: string;
      incognito?: boolean;
      width?: number;
      height?: number;
      sessionId?: string;
    }

    export interface QueryInfo {
      active?: boolean;
      pinned?: boolean;
      audible?: boolean;
      muted?: boolean;
      highlighted?: boolean;
      currentWindow?: boolean;
      lastFocusedWindow?: boolean;
      status?: string;
      title?: string;
      url?: string | string[];
      windowId?: number;
      windowType?: string;
      index?: number;
    }

    export function query(queryInfo: QueryInfo): Promise<Tab[]>;
    export function get(tabId: number): Promise<Tab>;
    export function sendMessage(tabId: number, message: any): Promise<any>;
    export function sendMessage(tabId: number, message: any, responseCallback: (response: any) => void): void;

    export const onActivated: {
      addListener: (callback: (activeInfo: { tabId: number; windowId: number }) => void) => void;
    };

    export const onUpdated: {
      addListener: (
        callback: (
          tabId: number,
          changeInfo: { status?: string; url?: string; pinned?: boolean; title?: string },
          tab: Tab
        ) => void
      ) => void;
    };
  }

  export namespace action {
    export function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    export function setBadgeBackgroundColor(details: { color: string | [number, number, number, number]; tabId?: number }): Promise<void>;
    export function setTitle(details: { title: string; tabId?: number }): Promise<void>;
  }

  export namespace storage {
    export interface StorageArea {
      get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }

    export const local: StorageArea;
    export const session: StorageArea;
    export const sync: StorageArea;
  }

  export namespace scripting {
    export interface ScriptInjection<Args extends any[] = any[], Result = any> {
      target: {
        tabId: number;
        allFrames?: boolean;
        frameIds?: number[];
      };
      files?: string[];
      func?: (...args: Args) => Result;
      args?: Args;
      world?: "ISOLATED" | "MAIN";
    }

    export interface InjectionResult<Result = any> {
      documentId?: string;
      frameId: number;
      result?: Result;
    }

    export function executeScript<Args extends any[], Result>(
      injection: ScriptInjection<Args, Result>
    ): Promise<InjectionResult<Result>[]>;
  }
}
