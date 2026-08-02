import { Chunk, Entity } from "../types";

export type SyncAction = "NO_CHANGE" | "USE_LOCAL" | "USE_REMOTE" | "MERGE_REQUIRED";

export interface SyncTimestamps {
  /** Timestamp of the last successful sync (from YAML frontmatter `harpy-last-sync` or metadata) */
  lastSync: string | number | Date | null | undefined;
  /** Local modification timestamp (from Obsidian file `stat.mtime`) */
  localMtime: string | number | Date | null | undefined;
  /** Remote modification timestamp (from Harpy entity/bundle `exportedAt` or `updatedAt`) */
  remoteMtime: string | number | Date | null | undefined;
}

export interface MergeEngineOptions {
  /** Tolerance threshold in milliseconds when comparing timestamps (default: 1000ms) */
  toleranceMs?: number;
}

export interface ChunkMergeResult {
  chunks: Chunk[];
  hasConflicts: boolean;
  conflictedChunkUids: string[];
}

export interface EntityMergeResult {
  action: SyncAction;
  mergedEntity?: Entity;
  mergedChunks?: Chunk[];
  mergedMarkdown?: string;
  hasConflicts: boolean;
  conflictedChunkUids: string[];
}

/**
 * Safely parses various timestamp types (ISO string, epoch number, Date object)
 * into unix epoch milliseconds. Returns 0 if invalid or unparseable.
 */
export function parseTimestamp(ts: string | number | Date | null | undefined): number {
  if (ts === null || ts === undefined) return 0;
  if (typeof ts === "number") return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "string") {
    const trimmed = ts.trim();
    if (!trimmed) return 0;
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) return parsed;
    const num = Number(trimmed);
    if (!isNaN(num)) return num;
  }
  return 0;
}

/**
 * Determines the required sync action by comparing `lastSync`, `localMtime`, and `remoteMtime`.
 *
 * Rules:
 * - If neither local nor remote was modified after `lastSync` -> NO_CHANGE
 * - If only local was modified after `lastSync` -> USE_LOCAL
 * - If only remote was modified after `lastSync` -> USE_REMOTE
 * - If BOTH were modified after `lastSync` -> MERGE_REQUIRED
 */
export function determineSyncAction(
  timestamps: SyncTimestamps,
  toleranceMs: number = 1000
): SyncAction {
  const lastSyncTime = parseTimestamp(timestamps.lastSync);
  const localTime = parseTimestamp(timestamps.localMtime);
  const remoteTime = parseTimestamp(timestamps.remoteMtime);

  // If lastSyncTime is valid (> 0), compare modifications relative to lastSync
  const isLocalModified =
    lastSyncTime > 0
      ? localTime > lastSyncTime + toleranceMs
      : localTime > 0;

  const isRemoteModified =
    lastSyncTime > 0
      ? remoteTime > lastSyncTime + toleranceMs
      : remoteTime > 0;

  if (isLocalModified && isRemoteModified) {
    return "MERGE_REQUIRED";
  } else if (isLocalModified) {
    return "USE_LOCAL";
  } else if (isRemoteModified) {
    return "USE_REMOTE";
  } else {
    return "NO_CHANGE";
  }
}

/**
 * Formats Git conflict markers around conflicting content.
 * Format:
 * <<<<<<< OBSIDIAN
 * <localContent>
 * =======
 * <remoteContent>
 * >>>>>>> HARPY
 */
export function formatConflictMarkers(localContent: string, remoteContent: string): string {
  return `<<<<<<< OBSIDIAN\n${localContent}\n=======\n${remoteContent}\n>>>>>>> HARPY`;
}

/**
 * Extracts string content from a Chunk object.
 */
function getChunkContent(chunk: Chunk | undefined): string {
  if (!chunk) return "";
  return chunk.content ?? "";
}

/**
 * Performs a block-level Git-like 3-way merge on chunk lists using chunk UIDs.
 *
 * Scenarios per chunk UID:
 * 1. Both modified -> if identical content keep, else insert Git conflict markers.
 * 2. Local modified, Remote unchanged -> keep Local content.
 * 3. Remote modified, Local unchanged -> keep Remote content.
 * 4. Local deleted, Remote unchanged -> delete chunk.
 * 5. Remote deleted, Local unchanged -> delete chunk.
 * 6. Local deleted, Remote modified -> CONFLICT (conflict markers with empty local).
 * 7. Remote deleted, Local modified -> CONFLICT (conflict markers with empty remote).
 * 8. Both deleted -> delete chunk.
 * 9. Additions on Local/Remote -> inserted at correct relative anchor positions.
 */
export function mergeChunks(
  baseChunks: Chunk[],
  localChunks: Chunk[],
  remoteChunks: Chunk[]
): ChunkMergeResult {
  const baseMap = new Map<string, Chunk>();
  baseChunks.forEach((c) => baseMap.set(c.uid, c));

  const localMap = new Map<string, Chunk>();
  localChunks.forEach((c) => localMap.set(c.uid, c));

  const remoteMap = new Map<string, Chunk>();
  remoteChunks.forEach((c) => remoteMap.set(c.uid, c));

  const baseUids = baseChunks.map((c) => c.uid);
  const baseSet = new Set(baseUids);

  // Map to track additions placed after specific base chunk anchors
  // Anchor "__START__" is used for chunks added at the very beginning
  const localAdditionsMap = new Map<string, Chunk[]>();
  const remoteAdditionsMap = new Map<string, Chunk[]>();

  const categorizeAdditions = (chunks: Chunk[], targetMap: Map<string, Chunk[]>) => {
    let currentAnchor = "__START__";
    for (const chunk of chunks) {
      if (baseSet.has(chunk.uid)) {
        currentAnchor = chunk.uid;
      } else {
        if (!targetMap.has(currentAnchor)) {
          targetMap.set(currentAnchor, []);
        }
        targetMap.get(currentAnchor)!.push(chunk);
      }
    }
  };

  categorizeAdditions(localChunks, localAdditionsMap);
  categorizeAdditions(remoteChunks, remoteAdditionsMap);

  const resultChunks: Chunk[] = [];
  const conflictedChunkUids: string[] = [];
  let hasConflicts = false;

  const anchors = ["__START__", ...baseUids];

  for (const anchor of anchors) {
    // 1. Process base chunk at anchor (if not __START__)
    if (anchor !== "__START__") {
      const baseChunk = baseMap.get(anchor);
      const localChunk = localMap.get(anchor);
      const remoteChunk = remoteMap.get(anchor);

      if (localChunk && remoteChunk) {
        const localContent = getChunkContent(localChunk);
        const remoteContent = getChunkContent(remoteChunk);
        const baseContent = getChunkContent(baseChunk);

        if (localContent === remoteContent) {
          // Identical changes or both unchanged
          resultChunks.push({ ...localChunk });
        } else if (localContent === baseContent) {
          // Only Remote was modified
          resultChunks.push({ ...remoteChunk });
        } else if (remoteContent === baseContent) {
          // Only Local was modified
          resultChunks.push({ ...localChunk });
        } else {
          // CONFLICT: Both modified the exact same chunk differently
          hasConflicts = true;
          conflictedChunkUids.push(anchor);
          const conflictContent = formatConflictMarkers(localContent, remoteContent);
          resultChunks.push({
            ...localChunk,
            content: conflictContent
          });
        }
      } else if (localChunk && !remoteChunk) {
        // Local has chunk, Remote deleted it
        const localContent = getChunkContent(localChunk);
        const baseContent = getChunkContent(baseChunk);

        if (localContent === baseContent) {
          // Remote deleted chunk, Local did not modify it -> accept deletion
        } else {
          // CONFLICT: Local modified chunk while Remote deleted it
          hasConflicts = true;
          conflictedChunkUids.push(anchor);
          const conflictContent = formatConflictMarkers(localContent, "");
          resultChunks.push({
            ...localChunk,
            content: conflictContent
          });
        }
      } else if (!localChunk && remoteChunk) {
        // Remote has chunk, Local deleted it
        const remoteContent = getChunkContent(remoteChunk);
        const baseContent = getChunkContent(baseChunk);

        if (remoteContent === baseContent) {
          // Local deleted chunk, Remote did not modify it -> accept deletion
        } else {
          // CONFLICT: Remote modified chunk while Local deleted it
          hasConflicts = true;
          conflictedChunkUids.push(anchor);
          const conflictContent = formatConflictMarkers("", remoteContent);
          resultChunks.push({
            ...remoteChunk,
            content: conflictContent
          });
        }
      } else {
        // Both deleted chunk -> omitted
      }
    }

    // 2. Process additions attached to this anchor
    const localAdds = localAdditionsMap.get(anchor) || [];
    const remoteAdds = remoteAdditionsMap.get(anchor) || [];

    const localAddsMap = new Map<string, Chunk>(localAdds.map((c) => [c.uid, c]));
    const remoteAddsMap = new Map<string, Chunk>(remoteAdds.map((c) => [c.uid, c]));

    const processedAddUids = new Set<string>();

    for (const lChunk of localAdds) {
      processedAddUids.add(lChunk.uid);
      const rChunk = remoteAddsMap.get(lChunk.uid);

      if (rChunk) {
        const lContent = getChunkContent(lChunk);
        const rContent = getChunkContent(rChunk);

        if (lContent === rContent) {
          resultChunks.push({ ...lChunk });
        } else {
          // Conflict on newly added chunk with same UID
          hasConflicts = true;
          conflictedChunkUids.push(lChunk.uid);
          resultChunks.push({
            ...lChunk,
            content: formatConflictMarkers(lContent, rContent)
          });
        }
      } else {
        resultChunks.push({ ...lChunk });
      }
    }

    for (const rChunk of remoteAdds) {
      if (!processedAddUids.has(rChunk.uid)) {
        resultChunks.push({ ...rChunk });
      }
    }
  }

  return {
    chunks: resultChunks,
    hasConflicts,
    conflictedChunkUids
  };
}

/**
 * 3-way Sync & Merge Engine class for Harpy <-> Obsidian.
 */
export class MergeEngine {
  private toleranceMs: number;

  constructor(options?: MergeEngineOptions) {
    this.toleranceMs = options?.toleranceMs ?? 1000;
  }

  /**
   * Determines the sync status based on timestamps.
   */
  determineAction(timestamps: SyncTimestamps): SyncAction {
    return determineSyncAction(timestamps, this.toleranceMs);
  }

  /**
   * Performs 3-way block-level merge on chunk lists.
   */
  mergeChunks(baseChunks: Chunk[], localChunks: Chunk[], remoteChunks: Chunk[]): ChunkMergeResult {
    return mergeChunks(baseChunks, localChunks, remoteChunks);
  }

  /**
   * Main 3-way sync engine entry point for Entities and Chunks.
   */
  syncEntity(
    timestamps: SyncTimestamps,
    baseEntity: Entity | null,
    localEntity: Entity,
    remoteEntity: Entity,
    baseChunks: Chunk[] = [],
    localChunks: Chunk[] = [],
    remoteChunks: Chunk[] = []
  ): EntityMergeResult {
    const action = this.determineAction(timestamps);

    switch (action) {
      case "NO_CHANGE":
        return {
          action: "NO_CHANGE",
          mergedEntity: localEntity,
          mergedChunks: localChunks,
          hasConflicts: false,
          conflictedChunkUids: []
        };

      case "USE_LOCAL":
        return {
          action: "USE_LOCAL",
          mergedEntity: localEntity,
          mergedChunks: localChunks,
          hasConflicts: false,
          conflictedChunkUids: []
        };

      case "USE_REMOTE":
        return {
          action: "USE_REMOTE",
          mergedEntity: remoteEntity,
          mergedChunks: remoteChunks,
          hasConflicts: false,
          conflictedChunkUids: []
        };

      case "MERGE_REQUIRED": {
        // Merge chunks
        const chunkResult = mergeChunks(baseChunks, localChunks, remoteChunks);

        // Merge entity metadata (favor remote unless local modified specific fields)
        const mergedEntity: Entity = {
          ...remoteEntity,
          uid: localEntity.uid || remoteEntity.uid,
          displayName: localEntity.displayName || remoteEntity.displayName,
          name: localEntity.name || remoteEntity.name,
          tagsUid: Array.from(new Set([...(localEntity.tagsUid || []), ...(remoteEntity.tagsUid || [])])),
          data: { ...(remoteEntity.data || {}), ...(localEntity.data || {}) }
        };

        return {
          action: "MERGE_REQUIRED",
          mergedEntity,
          mergedChunks: chunkResult.chunks,
          hasConflicts: chunkResult.hasConflicts,
          conflictedChunkUids: chunkResult.conflictedChunkUids
        };
      }
    }
  }
}
