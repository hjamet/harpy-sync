import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  determineSyncAction,
  formatConflictMarkers,
  mergeChunks,
  MergeEngine,
  parseTimestamp,
} from "../sync/merge-engine.js";
import type { Chunk, Entity } from "../bypp/types.js";

describe("MergeEngine & 3-Way Sync", () => {
  test("Timestamp Parsing", () => {
    assert.strictEqual(
      parseTimestamp("2026-08-02T12:00:00.000Z"),
      Date.parse("2026-08-02T12:00:00.000Z")
    );
    assert.strictEqual(parseTimestamp(100000), 100000);
    assert.strictEqual(parseTimestamp(null), 0);
    assert.strictEqual(parseTimestamp(undefined), 0);
    assert.strictEqual(parseTimestamp("invalid"), 0);
    assert.strictEqual(parseTimestamp(""), 0);
    assert.strictEqual(parseTimestamp("   "), 0);
  });

  test("Action Determination", () => {
    const lastSync = "2026-08-02T12:00:00.000Z";
    const lastSyncMs = Date.parse(lastSync);

    // NO_CHANGE
    assert.strictEqual(
      determineSyncAction({
        lastSync,
        localMtime: lastSyncMs,
        remoteMtime: lastSyncMs,
      }),
      "NO_CHANGE"
    );

    // USE_LOCAL (local updated 5s after lastSync, remote unchanged)
    assert.strictEqual(
      determineSyncAction({
        lastSync,
        localMtime: lastSyncMs + 5000,
        remoteMtime: lastSyncMs,
      }),
      "USE_LOCAL"
    );

    // USE_REMOTE (remote updated 5s after lastSync, local unchanged)
    assert.strictEqual(
      determineSyncAction({
        lastSync,
        localMtime: lastSyncMs,
        remoteMtime: lastSyncMs + 5000,
      }),
      "USE_REMOTE"
    );

    // MERGE_REQUIRED (both updated 5s after lastSync)
    assert.strictEqual(
      determineSyncAction({
        lastSync,
        localMtime: lastSyncMs + 5000,
        remoteMtime: lastSyncMs + 5000,
      }),
      "MERGE_REQUIRED"
    );

    // Initial sync cases (lastSync === 0)
    assert.strictEqual(
      determineSyncAction({ lastSync: null, localMtime: 5000, remoteMtime: 0 }),
      "USE_LOCAL"
    );
    assert.strictEqual(
      determineSyncAction({ lastSync: null, localMtime: 0, remoteMtime: 5000 }),
      "USE_REMOTE"
    );
    assert.strictEqual(
      determineSyncAction({ lastSync: null, localMtime: 5000, remoteMtime: 5000 }),
      "MERGE_REQUIRED"
    );
    assert.strictEqual(
      determineSyncAction({ lastSync: null, localMtime: 0, remoteMtime: 0 }),
      "NO_CHANGE"
    );
  });

  test("Conflict Marker Formatting", () => {
    const conflictDefault = formatConflictMarkers("Obsidian content", "Harpy content");
    assert.strictEqual(
      conflictDefault,
      `<<<<<<< LOCAL\nObsidian content\n=======\nHarpy content\n>>>>>>> REMOTE`
    );

    const conflictCustom = formatConflictMarkers(
      "Obsidian content",
      "Harpy content",
      "OBSIDIAN",
      "HARPY"
    );
    assert.strictEqual(
      conflictCustom,
      `<<<<<<< OBSIDIAN\nObsidian content\n=======\nHarpy content\n>>>>>>> HARPY`
    );
  });

  test("Chunk 3-Way Merge: Case A - Non-conflicting edits on different chunks", () => {
    const baseChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Original C1" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const localChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Local Updated C1" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const remoteChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Original C1" } as any,
      { uid: "c2", type: "text", content: "Remote Updated C2" } as any,
    ];

    const res = mergeChunks(baseChunks, localChunks, remoteChunks);
    assert.strictEqual(res.hasConflicts, false);
    assert.strictEqual(res.chunks.length, 2);
    assert.strictEqual((res.chunks[0] as any).content, "Local Updated C1");
    assert.strictEqual((res.chunks[1] as any).content, "Remote Updated C2");
  });

  test("Chunk 3-Way Merge: Case B - Conflict on exact same chunk", () => {
    const baseChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Original C1" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const localChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Obsidian C1 Edit" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const remoteChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Harpy C1 Edit" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const res = mergeChunks(baseChunks, localChunks, remoteChunks);
    assert.strictEqual(res.hasConflicts, true);
    assert.strictEqual(res.conflictedChunkUids.includes("c1"), true);
    assert.strictEqual(
      (res.chunks[0] as any).content,
      `<<<<<<< LOCAL\nObsidian C1 Edit\n=======\nHarpy C1 Edit\n>>>>>>> REMOTE`
    );
  });

  test("Chunk 3-Way Merge: Case C - Additions on both sides", () => {
    const baseChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Original C1" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const localChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Original C1" } as any,
      { uid: "local_new", type: "text", content: "New Local Block" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const remoteChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Original C1" } as any,
      { uid: "remote_new", type: "text", content: "New Remote Block" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const res = mergeChunks(baseChunks, localChunks, remoteChunks);
    assert.strictEqual(res.hasConflicts, false);
    assert.strictEqual(res.chunks.length, 4);
    assert.strictEqual(res.chunks[0].uid, "c1");
    assert.strictEqual(res.chunks[1].uid, "local_new");
    assert.strictEqual(res.chunks[2].uid, "remote_new");
    assert.strictEqual(res.chunks[3].uid, "c2");
  });

  test("Chunk 3-Way Merge: Case D - Deletions vs Modifications", () => {
    const baseChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Original C1" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const localChunks: Chunk[] = []; // Deleted both c1 and c2 locally

    const remoteChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Harpy Updated C1" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const res = mergeChunks(baseChunks, localChunks, remoteChunks);
    assert.strictEqual(res.hasConflicts, true);
    assert.strictEqual(res.chunks.length, 1);
    assert.strictEqual(res.chunks[0].uid, "c1");
    assert.strictEqual(
      (res.chunks[0] as any).content,
      `<<<<<<< LOCAL\n\n=======\nHarpy Updated C1\n>>>>>>> REMOTE`
    );
  });

  test("Full Engine Class Integration Test", () => {
    const engine = new MergeEngine();
    const lastSync = "2026-08-02T12:00:00.000Z";
    const lastSyncMs = Date.parse(lastSync);

    const baseChunks: Chunk[] = [
      { uid: "c1", type: "text", content: "Original C1" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const localChunksConflict: Chunk[] = [
      { uid: "c1", type: "text", content: "Obsidian C1 Edit" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const remoteChunksConflict: Chunk[] = [
      { uid: "c1", type: "text", content: "Harpy C1 Edit" } as any,
      { uid: "c2", type: "text", content: "Original C2" } as any,
    ];

    const localEntity: Entity = {
      uid: "e1" as any,
      name: "Local Name",
      displayName: "Local Display",
      description: "Desc",
      tagsUid: ["t1" as any],
      type: "note",
      pagesOrder: [],
      data: { v1: "local" },
      assetUids: [],
      isArchived: false,
    };

    const remoteEntity: Entity = {
      uid: "e1" as any,
      name: "Remote Name",
      displayName: "Remote Display",
      description: "Desc",
      tagsUid: ["t2" as any],
      type: "note",
      pagesOrder: [],
      data: { v2: "remote" },
      assetUids: [],
      isArchived: false,
    };

    const syncRes = engine.syncEntity(
      {
        lastSync,
        localMtime: lastSyncMs + 5000,
        remoteMtime: lastSyncMs + 5000,
      },
      null,
      localEntity,
      remoteEntity,
      baseChunks,
      localChunksConflict,
      remoteChunksConflict
    );

    assert.strictEqual(syncRes.action, "MERGE_REQUIRED");
    assert.strictEqual(syncRes.hasConflicts, true);
    assert.strictEqual(
      (syncRes.mergedChunks![0] as any).content.includes("<<<<<<< LOCAL"),
      true
    );
    assert.strictEqual(syncRes.mergedEntity!.tagsUid.length, 2);
  });
});
