import {
  FirestoreDocument,
  FirestoreValue,
  buildUpdateMask,
  fromFirestoreFields,
  toFirestoreFields,
} from "./mask-builder.js";

export interface FirestoreClientConfig {
  /** Google Cloud Project ID */
  projectId: string;
  /** Firestore Database ID (default: '(default)') */
  databaseId?: string;
  /** Auth Bearer Token or Firebase ID Token */
  authToken?: string | (() => Promise<string> | string);
  /** Optional Google API Key */
  apiKey?: string;
  /** Base REST URL (default: 'https://firestore.googleapis.com/v1') */
  baseUrl?: string;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
}

export class FirestoreError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public statusText: string,
    public body?: unknown
  ) {
    super(`Firestore REST Error [${statusCode} ${statusText}]: ${message}`);
    this.name = "FirestoreError";
  }
}

/**
 * Typed Lightweight Client for Google Cloud Firestore REST API.
 */
export class FirestoreRestClient {
  private projectId: string;
  private databaseId: string;
  private baseUrl: string;
  private authToken?: string | (() => Promise<string> | string);
  private apiKey?: string;
  private fetchFn: typeof fetch;

  constructor(config: FirestoreClientConfig) {
    this.projectId = config.projectId;
    this.databaseId = config.databaseId || "(default)";
    this.baseUrl = config.baseUrl || "https://firestore.googleapis.com/v1";
    this.authToken = config.authToken;
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : fetch);
  }

  /**
   * Root database path: projects/{projectId}/databases/{databaseId}/documents
   */
  private get databasePath(): string {
    return `projects/${this.projectId}/databases/${this.databaseId}/documents`;
  }

  /**
   * Builds the full REST URL for a document or collection.
   */
  private buildUrl(relativePath: string, queryParams?: Record<string, string | string[] | undefined>): string {
    const cleanPath = relativePath.replace(/^\/+/, "");
    let url = `${this.baseUrl}/${this.databasePath}/${cleanPath}`;
    const params = new URLSearchParams();

    if (this.apiKey) {
      params.set("key", this.apiKey);
    }

    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          v.forEach((item) => params.append(k, item));
        } else {
          params.set(k, v);
        }
      }
    }

    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  /**
   * Generates authorization headers.
   */
  private async getHeaders(): Promise<HeadersInit> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.authToken) {
      const token = typeof this.authToken === "function" ? await this.authToken() : this.authToken;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * Retrieves a single document by its path.
   * Returns null if document not found (404).
   */
  async getDocument<T = Record<string, unknown>>(documentPath: string): Promise<T | null> {
    const url = this.buildUrl(documentPath);
    const headers = await this.getHeaders();

    const response = await this.fetchFn(url, {
      method: "GET",
      headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new FirestoreError(
        errorBody?.error?.message || response.statusText,
        response.status,
        response.statusText,
        errorBody
      );
    }

    const doc: FirestoreDocument = await response.json();
    return fromFirestoreFields<T>(doc.fields);
  }

  /**
   * Patches a document using Firestore REST updateMask.
   */
  async patchDocument<T = Record<string, unknown>>(
    documentPath: string,
    data: Record<string, unknown>,
    updateMask?: string[]
  ): Promise<T> {
    const mask = updateMask ?? buildUpdateMask(data);
    const url = this.buildUrl(documentPath, {
      "updateMask.fieldPaths": mask,
    });
    const headers = await this.getHeaders();
    const fields = toFirestoreFields(data);

    const response = await this.fetchFn(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new FirestoreError(
        errorBody?.error?.message || response.statusText,
        response.status,
        response.statusText,
        errorBody
      );
    }

    const doc: FirestoreDocument = await response.json();
    return fromFirestoreFields<T>(doc.fields);
  }

  /**
   * Creates a new document in a collection.
   */
  async createDocument<T = Record<string, unknown>>(
    collectionPath: string,
    documentId?: string,
    data: Record<string, unknown> = {}
  ): Promise<T> {
    const url = this.buildUrl(collectionPath, {
      documentId,
    });
    const headers = await this.getHeaders();
    const fields = toFirestoreFields(data);

    const response = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new FirestoreError(
        errorBody?.error?.message || response.statusText,
        response.status,
        response.statusText,
        errorBody
      );
    }

    const doc: FirestoreDocument = await response.json();
    return fromFirestoreFields<T>(doc.fields);
  }

  /**
   * Deletes a document by path.
   */
  async deleteDocument(documentPath: string): Promise<void> {
    const url = this.buildUrl(documentPath);
    const headers = await this.getHeaders();

    const response = await this.fetchFn(url, {
      method: "DELETE",
      headers,
    });

    if (response.status === 404) return;

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new FirestoreError(
        errorBody?.error?.message || response.statusText,
        response.status,
        response.statusText,
        errorBody
      );
    }
  }

  /**
   * Lists documents from a collection.
   */
  async listDocuments<T = Record<string, unknown>>(
    collectionPath: string,
    options?: { pageSize?: number; pageToken?: string }
  ): Promise<{ documents: T[]; nextPageToken?: string }> {
    const url = this.buildUrl(collectionPath, {
      pageSize: options?.pageSize ? String(options.pageSize) : undefined,
      pageToken: options?.pageToken,
    });
    const headers = await this.getHeaders();

    const response = await this.fetchFn(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new FirestoreError(
        errorBody?.error?.message || response.statusText,
        response.status,
        response.statusText,
        errorBody
      );
    }

    const data: { documents?: FirestoreDocument[]; nextPageToken?: string } = await response.json();
    const documents = (data.documents || []).map((doc) => fromFirestoreFields<T>(doc.fields));
    return {
      documents,
      nextPageToken: data.nextPageToken,
    };
  }
}
