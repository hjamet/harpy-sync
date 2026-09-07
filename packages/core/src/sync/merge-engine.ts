import type { Chunk, Entity } from "../bypp/types.js";

export type SyncAction = "NO_CHANGE" | "USE_LOCAL" | "USE_REMOTE" | "MERGE_REQUIRED";

export interface SyncTimestamps {
  /** Timestamp of last successful sync (e.g. from YAML frontmatter 'harpy-last-sync') */
  lastSync: string | number | Date | null | undefined;
  /** Local modification timestamp (e.g. file stat mtime) */
  localMtime: string | number | Date | null | undefined;
  /** Remote modification timestamp (e.g. bundle exportedAt or Firestore updateTime) */
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
  hasConflicts: boolean;
  conflictedChunkUids: string[];
}

/**
 * Safely parses various timestamp types (ISO string, epoch number, Date object) into epoch milliseconds.
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
 * Determines the required sync action by comparing lastSync, localMtime, and remoteMtime.
 */
export function determineSyncAction(
  timestamps: SyncTimestamps,
  toleranceMs: number = 1000
): SyncAction {
  const lastSync = parseTimestamp(timestamps.lastSync);
  const localMtime = parseTimestamp(timestamps.localMtime);
  const remoteMtime = parseTimestamp(timestamps.remoteMtime);

  // If no previous sync baseline exists, but one side exists
  if (lastSync === 0) {
    if (localMtime > 0 && remoteMtime === 0) return "USE_LOCAL";
    if (remoteMtime > 0 && localMtime === 0) return "USE_REMOTE";
    if (localMtime > 0 && remoteMtime > 0) return "MERGE_REQUIRED";
    return "NO_CHANGE";
  }

  const localChanged = localMtime - lastSync > toleranceMs;
  const remoteChanged = remoteMtime - lastSync > toleranceMs;

  if (!localChanged && !remoteChanged) {
    return "NO_CHANGE";
  }
  if (localChanged && !remoteChanged) {
    return "USE_LOCAL";
  }
  if (!localChanged && remoteChanged) {
    return "USE_REMOTE";
  }
  return "MERGE_REQUIRED";
}

/**
 * Formats git-style conflict markers for divergent text.
 */
export function formatConflictMarkers(localText: string, remoteText: string): string {
  return [
    "<<<<<<< LOCAL",
    localText.trim(),
    "=======",
    remoteText.trim(),
    ">>>>>>> REMOTE",
  ].join("\n");
}

function getChunkContent(chunk?: Chunk | null): string {
  if (!chunk) return "";
  return (chunk as any).content || "";
}

function createConflictedChunk(base: Chunk, content: string): Chunk {
  if (base.type === "text") {
    return {
      ...base,
      content,
    };
  }
  return {
    ...(base as any),
    type: "text",
    content,
  } as Chunk;
}

/**
 * 3-way block-level chunk merge algorithm.
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
    if (anchor !== "__START__") {
      const baseChunk = baseMap.get(anchor);
      const localChunk = localMap.get(anchor);
      const remoteChunk = remoteMap.get(anchor);

      if (localChunk && remoteChunk) {
        const localContent = getChunkContent(localChunk);
        const remoteContent = getChunkContent(remoteChunk);
        const baseContent = getChunkContent(baseChunk);

        if (localContent === remoteContent) {
          resultChunks.push({ ...localChunk });
        } else if (localContent === baseContent) {
          resultChunks.push({ ...remoteChunk });
        } else if (remoteContent === baseContent) {
          resultChunks.push({ ...localChunk });
        } else {
          hasConflicts = true;
          conflictedChunkUids.push(anchor);
          const conflictContent = formatConflictMarkers(localContent, remoteContent);
          resultChunks.push(createConflictedChunk(localChunk, conflictContent));
        }
      } else if (localChunk && !remoteChunk) {
        const localContent = getChunkContent(localChunk);
        const baseContent = getChunkContent(baseChunk);

        if (localContent !== baseContent) {
          hasConflicts = true;
          conflictedChunkUids.push(anchor);
          resultChunks.push(createConflictedChunk(localChunk, formatConflictMarkers(localContent, "")));
        }
      } else if (!localChunk && remoteChunk) {
        const remoteContent = getChunkContent(remoteChunk);
        const baseContent = getChunkContent(baseChunk);

        if (remoteContent !== baseContent) {
          hasConflicts = true;
          conflictedChunkUids.push(anchor);
          resultChunks.push(createConflictedChunk(remoteChunk, formatConflictMarkers("", remoteContent)));
        }
      }
    }

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
          hasConflicts = true;
          conflictedChunkUids.push(lChunk.uid);
          resultChunks.push(createConflictedChunk(lChunk, formatConflictMarkers(lContent, rContent)));
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
    conflictedChunkUids,
  };
}

/**
 * 3-Way Sync & Merge Engine for Harpy <-> Obsidian.
 */
export class MergeEngine {
  private toleranceMs: number;

  constructor(options?: MergeEngineOptions) {
    this.toleranceMs = options?.toleranceMs ?? 1000;
  }

  determineAction(timestamps: SyncTimestamps): SyncAction {
    return determineSyncAction(timestamps, this.toleranceMs);
  }

  mergeChunks(baseChunks: Chunk[], localChunks: Chunk[], remoteChunks: Chunk[]): ChunkMergeResult {
    return mergeChunks(baseChunks, localChunks, remoteChunks);
  }

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
          conflictedChunkUids: [],
        };

      case "USE_LOCAL":
        return {
          action: "USE_LOCAL",
          mergedEntity: localEntity,
          mergedChunks: localChunks,
          hasConflicts: false,
          conflictedChunkUids: [],
        };

      case "USE_REMOTE":
        return {
          action: "USE_REMOTE",
          mergedEntity: remoteEntity,
          mergedChunks: remoteChunks,
          hasConflicts: false,
          conflictedChunkUids: [],
        };

      case "MERGE_REQUIRED": {
        const chunkResult = mergeChunks(baseChunks, localChunks, remoteChunks);

        const mergedEntity: Entity = {
          ...remoteEntity,
          uid: localEntity.uid || remoteEntity.uid,
          displayName: localEntity.displayName || remoteEntity.displayName,
          name: localEntity.name || remoteEntity.name,
          tagsUid: Array.from(new Set([...(localEntity.tagsUid || []), ...(remoteEntity.tagsUid || [])])),
          data: { ...(remoteEntity.data || {}), ...(localEntity.data || {}) },
        };

        return {
          action: "MERGE_REQUIRED",
          mergedEntity,
          mergedChunks: chunkResult.chunks,
          hasConflicts: chunkResult.hasConflicts,
          conflictedChunkUids: chunkResult.conflictedChunkUids,
        };
      }
    }
  }
}
