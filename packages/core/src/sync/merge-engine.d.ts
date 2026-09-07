import { Chunk, Entity, SyncAction, SyncTimestamps, MergeEngineOptions, ChunkMergeResult, EntityMergeResult } from "../types.js";
/**
 * Safely parses various timestamp types (ISO string, epoch number, Date object)
 * into unix epoch milliseconds. Returns 0 if invalid or unparseable.
 */
export declare function parseTimestamp(ts: string | number | Date | null | undefined): number;
/**
 * Determines the required sync action by comparing `lastSync`, `localMtime`, and `remoteMtime`.
 *
 * Rules:
 * - If neither local nor remote was modified after `lastSync` -> NO_CHANGE
 * - If only local was modified after `lastSync` -> USE_LOCAL
 * - If only remote was modified after `lastSync` -> USE_REMOTE
 * - If BOTH were modified after `lastSync` -> MERGE_REQUIRED
 */
export declare function determineSyncAction(timestamps: SyncTimestamps, toleranceMs?: number): SyncAction;
/**
 * Formats Git conflict markers around conflicting content.
 * Format:
 * <<<<<<< OBSIDIAN
 * <localContent>
 * =======
 * <remoteContent>
 * >>>>>>> HARPY
 */
export declare function formatConflictMarkers(localContent: string, remoteContent: string): string;
/**
 * Performs a block-level Git-like 3-way merge on chunk lists using chunk UIDs.
 */
export declare function mergeChunks(baseChunks: Chunk[], localChunks: Chunk[], remoteChunks: Chunk[]): ChunkMergeResult;
/**
 * 3-way Sync & Merge Engine class for Harpy <-> Markdown notes.
 */
export declare class MergeEngine {
    private toleranceMs;
    constructor(options?: MergeEngineOptions);
    /**
     * Determines the sync status based on timestamps.
     */
    determineAction(timestamps: SyncTimestamps): SyncAction;
    /**
     * Performs 3-way block-level merge on chunk lists.
     */
    mergeChunks(baseChunks: Chunk[], localChunks: Chunk[], remoteChunks: Chunk[]): ChunkMergeResult;
    /**
     * Main 3-way sync engine entry point for Entities and Chunks.
     */
    syncEntity(timestamps: SyncTimestamps, baseEntity: Entity | null, localEntity: Entity, remoteEntity: Entity, baseChunks?: Chunk[], localChunks?: Chunk[], remoteChunks?: Chunk[]): EntityMergeResult;
}
//# sourceMappingURL=merge-engine.d.ts.map