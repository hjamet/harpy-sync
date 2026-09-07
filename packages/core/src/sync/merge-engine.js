"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MergeEngine = void 0;
exports.parseTimestamp = parseTimestamp;
exports.determineSyncAction = determineSyncAction;
exports.formatConflictMarkers = formatConflictMarkers;
exports.mergeChunks = mergeChunks;
/**
 * Safely parses various timestamp types (ISO string, epoch number, Date object)
 * into unix epoch milliseconds. Returns 0 if invalid or unparseable.
 */
function parseTimestamp(ts) {
    if (ts === null || ts === undefined)
        return 0;
    if (typeof ts === "number")
        return ts;
    if (ts instanceof Date)
        return ts.getTime();
    if (typeof ts === "string") {
        const trimmed = ts.trim();
        if (!trimmed)
            return 0;
        const parsed = Date.parse(trimmed);
        if (!isNaN(parsed))
            return parsed;
        const num = Number(trimmed);
        if (!isNaN(num))
            return num;
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
function determineSyncAction(timestamps, toleranceMs = 1000) {
    const lastSyncTime = parseTimestamp(timestamps.lastSync);
    const localTime = parseTimestamp(timestamps.localMtime);
    const remoteTime = parseTimestamp(timestamps.remoteMtime);
    // If lastSyncTime is valid (> 0), compare modifications relative to lastSync
    const isLocalModified = lastSyncTime > 0
        ? localTime > lastSyncTime + toleranceMs
        : localTime > 0;
    const isRemoteModified = lastSyncTime > 0
        ? remoteTime > lastSyncTime + toleranceMs
        : remoteTime > 0;
    if (isLocalModified && isRemoteModified) {
        return "MERGE_REQUIRED";
    }
    else if (isLocalModified) {
        return "USE_LOCAL";
    }
    else if (isRemoteModified) {
        return "USE_REMOTE";
    }
    else {
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
function formatConflictMarkers(localContent, remoteContent) {
    return `<<<<<<< OBSIDIAN\n${localContent}\n=======\n${remoteContent}\n>>>>>>> HARPY`;
}
/**
 * Extracts string content from a Chunk object.
 */
function getChunkContent(chunk) {
    if (!chunk)
        return "";
    return chunk.content ?? "";
}
/**
 * Performs a block-level Git-like 3-way merge on chunk lists using chunk UIDs.
 */
function mergeChunks(baseChunks, localChunks, remoteChunks) {
    const baseMap = new Map();
    baseChunks.forEach((c) => baseMap.set(c.uid, c));
    const localMap = new Map();
    localChunks.forEach((c) => localMap.set(c.uid, c));
    const remoteMap = new Map();
    remoteChunks.forEach((c) => remoteMap.set(c.uid, c));
    const baseUids = baseChunks.map((c) => c.uid);
    const baseSet = new Set(baseUids);
    // Map to track additions placed after specific base chunk anchors
    const localAdditionsMap = new Map();
    const remoteAdditionsMap = new Map();
    const categorizeAdditions = (chunks, targetMap) => {
        let currentAnchor = "__START__";
        for (const chunk of chunks) {
            if (baseSet.has(chunk.uid)) {
                currentAnchor = chunk.uid;
            }
            else {
                if (!targetMap.has(currentAnchor)) {
                    targetMap.set(currentAnchor, []);
                }
                targetMap.get(currentAnchor).push(chunk);
            }
        }
    };
    categorizeAdditions(localChunks, localAdditionsMap);
    categorizeAdditions(remoteChunks, remoteAdditionsMap);
    const resultChunks = [];
    const conflictedChunkUids = [];
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
                }
                else if (localContent === baseContent) {
                    // Only Remote was modified
                    resultChunks.push({ ...remoteChunk });
                }
                else if (remoteContent === baseContent) {
                    // Only Local was modified
                    resultChunks.push({ ...localChunk });
                }
                else {
                    // CONFLICT: Both modified the exact same chunk differently
                    hasConflicts = true;
                    conflictedChunkUids.push(anchor);
                    const conflictContent = formatConflictMarkers(localContent, remoteContent);
                    resultChunks.push({
                        ...localChunk,
                        content: conflictContent
                    });
                }
            }
            else if (localChunk && !remoteChunk) {
                // Local has chunk, Remote deleted it
                const localContent = getChunkContent(localChunk);
                const baseContent = getChunkContent(baseChunk);
                if (localContent === baseContent) {
                    // Remote deleted chunk, Local did not modify it -> accept deletion
                }
                else {
                    // CONFLICT: Local modified chunk while Remote deleted it
                    hasConflicts = true;
                    conflictedChunkUids.push(anchor);
                    const conflictContent = formatConflictMarkers(localContent, "");
                    resultChunks.push({
                        ...localChunk,
                        content: conflictContent
                    });
                }
            }
            else if (!localChunk && remoteChunk) {
                // Remote has chunk, Local deleted it
                const remoteContent = getChunkContent(remoteChunk);
                const baseContent = getChunkContent(baseChunk);
                if (remoteContent === baseContent) {
                    // Local deleted chunk, Remote did not modify it -> accept deletion
                }
                else {
                    // CONFLICT: Remote modified chunk while Local deleted it
                    hasConflicts = true;
                    conflictedChunkUids.push(anchor);
                    const conflictContent = formatConflictMarkers("", remoteContent);
                    resultChunks.push({
                        ...remoteChunk,
                        content: conflictContent
                    });
                }
            }
            else {
                // Both deleted chunk -> omitted
            }
        }
        // 2. Process additions attached to this anchor
        const localAdds = localAdditionsMap.get(anchor) || [];
        const remoteAdds = remoteAdditionsMap.get(anchor) || [];
        const localAddsMap = new Map(localAdds.map((c) => [c.uid, c]));
        const remoteAddsMap = new Map(remoteAdds.map((c) => [c.uid, c]));
        const processedAddUids = new Set();
        for (const lChunk of localAdds) {
            processedAddUids.add(lChunk.uid);
            const rChunk = remoteAddsMap.get(lChunk.uid);
            if (rChunk) {
                const lContent = getChunkContent(lChunk);
                const rContent = getChunkContent(rChunk);
                if (lContent === rContent) {
                    resultChunks.push({ ...lChunk });
                }
                else {
                    // Conflict on newly added chunk with same UID
                    hasConflicts = true;
                    conflictedChunkUids.push(lChunk.uid);
                    resultChunks.push({
                        ...lChunk,
                        content: formatConflictMarkers(lContent, rContent)
                    });
                }
            }
            else {
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
 * 3-way Sync & Merge Engine class for Harpy <-> Markdown notes.
 */
class MergeEngine {
    toleranceMs;
    constructor(options) {
        this.toleranceMs = options?.toleranceMs ?? 1000;
    }
    /**
     * Determines the sync status based on timestamps.
     */
    determineAction(timestamps) {
        return determineSyncAction(timestamps, this.toleranceMs);
    }
    /**
     * Performs 3-way block-level merge on chunk lists.
     */
    mergeChunks(baseChunks, localChunks, remoteChunks) {
        return mergeChunks(baseChunks, localChunks, remoteChunks);
    }
    /**
     * Main 3-way sync engine entry point for Entities and Chunks.
     */
    syncEntity(timestamps, baseEntity, localEntity, remoteEntity, baseChunks = [], localChunks = [], remoteChunks = []) {
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
                const chunkResult = mergeChunks(baseChunks, localChunks, remoteChunks);
                const mergedEntity = {
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
exports.MergeEngine = MergeEngine;
//# sourceMappingURL=merge-engine.js.map