/**
 * Token Extractor: Extracts Firebase STS JWT Token directly from IndexedDB firebaseLocalStorageDb
 */

import { FirebaseTokenData, TokenExtractionResult } from "../types";

export class TokenExtractor {
  private static readonly DB_NAME = "firebaseLocalStorageDb";
  private static readonly STORE_NAME = "firebaseLocalStorage";
  private cachedToken: FirebaseTokenData | null = null;
  private tokenWatchInterval: number | null = null;

  /**
   * Extract Firebase JWT STS token from IndexedDB
   */
  public async extractToken(): Promise<TokenExtractionResult> {
    try {
      const rawSession = await this.readIndexedDbSession();
      if (!rawSession) {
        return {
          success: false,
          error: "No Firebase session found in IndexedDB (firebaseLocalStorageDb/firebaseLocalStorage)",
        };
      }

      const tokenData = this.parseFirebaseUserRecord(rawSession);
      if (!tokenData || !tokenData.accessToken) {
        return {
          success: false,
          error: "Found Firebase user record in IndexedDB but stsTokenManager.accessToken is missing or invalid",
        };
      }

      this.cachedToken = tokenData;
      return {
        success: true,
        tokenData,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to access IndexedDB: ${err.message || String(err)}`,
      };
    }
  }

  /**
   * Get cached token or extract if not available
   */
  public async getValidToken(forceRefresh = false): Promise<FirebaseTokenData | null> {
    if (!forceRefresh && this.cachedToken && !this.isTokenExpired(this.cachedToken)) {
      return this.cachedToken;
    }

    const result = await this.extractToken();
    if (result.success && result.tokenData) {
      return result.tokenData;
    }

    return null;
  }

  /**
   * Check if token is expired or will expire within threshold
   */
  public isTokenExpired(tokenData: FirebaseTokenData, thresholdSeconds = 120): boolean {
    if (!tokenData.expirationTime) {
      // Fallback: decode JWT payload
      const jwtExp = this.getJwtExpiration(tokenData.accessToken);
      if (jwtExp) {
        const now = Date.now();
        return now >= jwtExp - thresholdSeconds * 1000;
      }
      return false;
    }

    const now = Date.now();
    return now >= tokenData.expirationTime - thresholdSeconds * 1000;
  }

  /**
   * Watch for token updates or impending expiry
   */
  public startTokenWatcher(
    callback: (tokenData: FirebaseTokenData | null) => void,
    intervalMs = 15000
  ): () => void {
    if (this.tokenWatchInterval) {
      clearInterval(this.tokenWatchInterval);
    }

    // Initial check
    this.getValidToken().then(callback).catch(() => callback(null));

    this.tokenWatchInterval = window.setInterval(async () => {
      try {
        const result = await this.extractToken();
        if (result.success && result.tokenData) {
          if (!this.cachedToken || this.cachedToken.accessToken !== result.tokenData.accessToken) {
            this.cachedToken = result.tokenData;
            callback(result.tokenData);
          }
        }
      } catch (err) {
        console.warn("[HarpyTokenExtractor] Watcher extraction error:", err);
      }
    }, intervalMs);

    return () => {
      if (this.tokenWatchInterval) {
        clearInterval(this.tokenWatchInterval);
        this.tokenWatchInterval = null;
      }
    };
  }

  /**
   * Read raw session records from IndexedDB
   */
  private readIndexedDbSession(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        return reject(new Error("IndexedDB is not available in current window context"));
      }

      const openRequest = indexedDB.open(TokenExtractor.DB_NAME);

      openRequest.onerror = () => {
        reject(new Error(`Failed to open IndexedDB '${TokenExtractor.DB_NAME}': ${openRequest.error?.message}`));
      };

      openRequest.onsuccess = () => {
        const db = openRequest.result;

        if (!db.objectStoreNames.contains(TokenExtractor.STORE_NAME)) {
          db.close();
          return reject(new Error(`Store '${TokenExtractor.STORE_NAME}' not found in '${TokenExtractor.DB_NAME}'`));
        }

        try {
          const transaction = db.transaction([TokenExtractor.STORE_NAME], "readonly");
          const store = transaction.objectStore(TokenExtractor.STORE_NAME);
          const getAllRequest = store.getAll();

          getAllRequest.onsuccess = () => {
            const results = getAllRequest.result;
            db.close();
            if (!results || results.length === 0) {
              resolve(null);
            } else {
              // Find the record containing user credentials
              const authRecord = results.find((r: any) => {
                const val = r?.value || r;
                return val?.stsTokenManager || val?.accessToken || (r?.fbase_key && r.fbase_key.includes("authUser"));
              });
              resolve(authRecord || results[0]);
            }
          };

          getAllRequest.onerror = () => {
            db.close();
            reject(new Error(`Failed to getAll from '${TokenExtractor.STORE_NAME}': ${getAllRequest.error?.message}`));
          };
        } catch (err) {
          db.close();
          reject(err);
        }
      };
    });
  }

  /**
   * Parse Firebase user record from IndexedDB value
   */
  private parseFirebaseUserRecord(record: any): FirebaseTokenData | null {
    if (!record) return null;

    const userObj = record.value || record;
    const sts = userObj.stsTokenManager || {};

    const accessToken = sts.accessToken || userObj.accessToken || userObj.stsTokenManager?.accessToken;
    if (!accessToken || typeof accessToken !== "string") {
      return null;
    }

    const refreshToken = sts.refreshToken || userObj.refreshToken;
    let expirationTime = sts.expirationTime || userObj.expirationTime;

    if (!expirationTime) {
      const jwtExp = this.getJwtExpiration(accessToken);
      if (jwtExp) expirationTime = jwtExp;
    }

    return {
      accessToken,
      refreshToken,
      expirationTime: typeof expirationTime === "number" ? expirationTime : undefined,
      uid: userObj.uid || sts.apiKey,
      email: userObj.email,
      displayName: userObj.displayName,
      photoUrl: userObj.photoURL,
      extractedAt: Date.now(),
    };
  }

  /**
   * Decode JWT token expiration timestamp
   */
  private getJwtExpiration(jwt: string): number | null {
    try {
      const parts = jwt.split(".");
      if (parts.length !== 3) return null;

      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );

      const payload = JSON.parse(jsonPayload);
      if (payload && typeof payload.exp === "number") {
        return payload.exp * 1000;
      }
      return null;
    } catch {
      return null;
    }
  }
}
