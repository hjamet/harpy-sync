import {
  determineSyncAction,
  formatConflictMarkers,
  mergeChunks,
  MergeEngine,
  parseTimestamp
} from "./merge-engine";
import { Chunk, Entity } from "../types";
import assert from "assert";

console.log("Starting MergeEngine unit tests...");

// 1. Timestamp Parsing Tests
assert.strictEqual(parseTimestamp("2026-08-02T12:00:00.000Z"), Date.parse("2026-08-02T12:00:00.000Z"));
assert.strictEqual(parseTimestamp(100000), 100000);
assert.strictEqual(parseTimestamp(null), 0);
assert.strictEqual(parseTimestamp(undefined), 0);
assert.strictEqual(parseTimestamp("invalid"), 0);

// 2. Action Determination Tests
const lastSync = "2026-08-02T12:00:00.000Z";
const lastSyncMs = Date.parse(lastSync);

// NO_CHANGE
assert.strictEqual(
  determineSyncAction({
    lastSync,
    localMtime: lastSyncMs,
    remoteMtime: lastSyncMs
  }),
  "NO_CHANGE"
);

// USE_LOCAL (local updated 5s after lastSync, remote unchanged)
assert.strictEqual(
  determineSyncAction({
    lastSync,
    localMtime: lastSyncMs + 5000,
    remoteMtime: lastSyncMs
  }),
  "USE_LOCAL"
);

// USE_REMOTE (remote updated 5s after lastSync, local unchanged)
assert.strictEqual(
  determineSyncAction({
    lastSync,
    localMtime: lastSyncMs,
    remoteMtime: lastSyncMs + 5000
  }),
  "USE_REMOTE"
);

// MERGE_REQUIRED (both updated 5s after lastSync)
assert.strictEqual(
  determineSyncAction({
    lastSync,
    localMtime: lastSyncMs + 5000,
    remoteMtime: lastSyncMs + 5000
  }),
  "MERGE_REQUIRED"
);

// 3. Conflict Marker Formatting Test
const conflictMarkerResult = formatConflictMarkers("Obsidian content", "Harpy content");
assert.strictEqual(
  conflictMarkerResult,
  `<<<<<<< OBSIDIAN\nObsidian content\n=======\nHarpy content\n>>>>>>> HARPY`
);

// 4. Chunk 3-Way Merge Tests

// Case A: Identical base, local edit on chunk A, remote edit on chunk B (no conflict)
const baseChunks1: Chunk[] = [
  { uid: "c1", type: "text", content: "Original C1" } as any,
  { uid: "c2", type: "text", content: "Original C2" } as any
];

const localChunks1: Chunk[] = [
  { uid: "c1", type: "text", content: "Local Updated C1" } as any,
  { uid: "c2", type: "text", content: "Original C2" } as any
];

const remoteChunks1: Chunk[] = [
  { uid: "c1", type: "text", content: "Original C1" } as any,
  { uid: "c2", type: "text", content: "Remote Updated C2" } as any
];

const res1 = mergeChunks(baseChunks1, localChunks1, remoteChunks1);
assert.strictEqual(res1.hasConflicts, false);
assert.strictEqual(res1.chunks.length, 2);
assert.strictEqual(res1.chunks[0].content, "Local Updated C1");
assert.strictEqual(res1.chunks[1].content, "Remote Updated C2");

// Case B: Conflict on exact same chunk
const localChunksConflict: Chunk[] = [
  { uid: "c1", type: "text", content: "Obsidian C1 Edit" } as any,
  { uid: "c2", type: "text", content: "Original C2" } as any
];

const remoteChunksConflict: Chunk[] = [
  { uid: "c1", type: "text", content: "Harpy C1 Edit" } as any,
  { uid: "c2", type: "text", content: "Original C2" } as any
];

const resConflict = mergeChunks(baseChunks1, localChunksConflict, remoteChunksConflict);
assert.strictEqual(resConflict.hasConflicts, true);
assert.strictEqual(resConflict.conflictedChunkUids.includes("c1"), true);
assert.strictEqual(
  resConflict.chunks[0].content,
  `<<<<<<< OBSIDIAN\nObsidian C1 Edit\n=======\nHarpy C1 Edit\n>>>>>>> HARPY`
);

// Case C: Additions on both sides
const localChunksAdds: Chunk[] = [
  { uid: "c1", type: "text", content: "Original C1" } as any,
  { uid: "local_new", type: "text", content: "New Local Block" } as any,
  { uid: "c2", type: "text", content: "Original C2" } as any
];

const remoteChunksAdds: Chunk[] = [
  { uid: "c1", type: "text", content: "Original C1" } as any,
  { uid: "remote_new", type: "text", content: "New Remote Block" } as any,
  { uid: "c2", type: "text", content: "Original C2" } as any
];

const resAdds = mergeChunks(baseChunks1, localChunksAdds, remoteChunksAdds);
assert.strictEqual(resAdds.hasConflicts, false);
assert.strictEqual(resAdds.chunks.length, 4);
assert.strictEqual(resAdds.chunks[0].uid, "c1");
assert.strictEqual(resAdds.chunks[1].uid, "local_new");
assert.strictEqual(resAdds.chunks[2].uid, "remote_new");
assert.strictEqual(resAdds.chunks[3].uid, "c2");

// Case D: Deletions vs Modifications
// Local deleted c2 (unchanged in remote) -> deleted
// Remote modified c1, Local deleted c1 -> conflict!
const baseChunksDel: Chunk[] = [
  { uid: "c1", type: "text", content: "Original C1" } as any,
  { uid: "c2", type: "text", content: "Original C2" } as any
];

const localChunksDel: Chunk[] = []; // Deleted both c1 and c2 locally

const remoteChunksDel: Chunk[] = [
  { uid: "c1", type: "text", content: "Harpy Updated C1" } as any,
  { uid: "c2", type: "text", content: "Original C2" } as any
];

const resDel = mergeChunks(baseChunksDel, localChunksDel, remoteChunksDel);
// c2: Local deleted c2, Remote kept c2 unchanged -> deletion accepted (c2 removed)
// c1: Local deleted c1, Remote modified c1 -> CONFLICT!
assert.strictEqual(resDel.hasConflicts, true);
assert.strictEqual(resDel.chunks.length, 1);
assert.strictEqual(resDel.chunks[0].uid, "c1");
assert.strictEqual(
  resDel.chunks[0].content,
  `<<<<<<< OBSIDIAN\n\n=======\nHarpy Updated C1\n>>>>>>> HARPY`
);

// 5. Full Engine Class Integration Test
const engine = new MergeEngine();

const localEntity: Entity = {
  uid: "e1",
  name: "Local Name",
  displayName: "Local Display",
  description: "Desc",
  tagsUid: ["t1"],
  type: "note",
  pagesOrder: [],
  data: { v1: "local" },
  assetUids: []
};

const remoteEntity: Entity = {
  uid: "e1",
  name: "Remote Name",
  displayName: "Remote Display",
  description: "Desc",
  tagsUid: ["t2"],
  type: "note",
  pagesOrder: [],
  data: { v2: "remote" },
  assetUids: []
};

const syncRes = engine.syncEntity(
  {
    lastSync,
    localMtime: lastSyncMs + 5000,
    remoteMtime: lastSyncMs + 5000
  },
  null,
  localEntity,
  remoteEntity,
  baseChunks1,
  localChunksConflict,
  remoteChunksConflict
);

assert.strictEqual(syncRes.action, "MERGE_REQUIRED");
assert.strictEqual(syncRes.hasConflicts, true);
assert.strictEqual(syncRes.mergedChunks![0].content.includes("<<<<<<< OBSIDIAN"), true);
assert.strictEqual(syncRes.mergedEntity!.tagsUid.length, 2); // merged tags t1 & t2

console.log("All MergeEngine unit tests passed successfully!");
