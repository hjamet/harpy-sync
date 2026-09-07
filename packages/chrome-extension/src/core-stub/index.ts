/**
 * @harpy/core Stub / Interfaces for workspace compatibility
 */

export interface HarpyEntity {
  id: string;
  name: string;
  type?: string;
  description?: string;
  data?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface HarpySyncMessage {
  type: string;
  payload: any;
  timestamp: number;
}

export const HARPY_DEFAULT_WS_PORT = 18765;
export const HARPY_DEFAULT_WS_URL = `ws://127.0.0.1:${HARPY_DEFAULT_WS_PORT}`;
export const HARPY_DOMAIN_REGEX = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*harpy\.gg/i;
