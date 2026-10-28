import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WebSocket } from "ws";
import {
  validateHarpyV3Markdown,
  parseObsidianNote,
  MergeEngine,
  formatConflictMarkers,
} from "@harpy/core";
import { HarpyWsBridge } from "../ws-bridge.js";
import { createValidateAndExportHarpyV3Tool } from "../tools/validate-and-export-v3.js";

const BENCHMARK_DIR =
  "C:\\Users\\Jamet\\.gemini\\antigravity\\brain\\d687d02e-d16a-4b46-9e3f-bff760bf1ba6\\entites_harpy_v3";

describe("E2E Full Pipeline: Harpy v3 Note -> Validation -> MCP Server -> WebSocket Bridge -> Chrome -> 3-Way Sync", () => {
  let bridge: HarpyWsBridge;
  const TEST_PORT = 19877;
  const TEST_HOST = "127.0.0.1";

  before(async () => {
    bridge = new HarpyWsBridge({
      port: TEST_PORT,
      host: TEST_HOST,
      heartbeatIntervalMs: 60000,
    });
    await bridge.start();
  });

  after(async () => {
    if (bridge) {
      await bridge.stop();
    }
  });

  test("Pipeline complet: validation offline, conversion BYPP v17, et communication RPC via bridge", async () => {
    // 1. Validation et export hors-ligne via outil MCP
    const tool = createValidateAndExportHarpyV3Tool();
    const gaelFilePath = path.join(BENCHMARK_DIR, "Gael de Barne.md");

    const conversionResult = await tool.execute({
      filePath: gaelFilePath,
      entityName: "Gaël de Barne",
      generateBundle: true,
      generateAshardeStatblock: true,
    });

    assert.strictEqual(conversionResult.valid, true, "La fiche Gaël de Barne doit être valide v3");
    assert.ok(conversionResult.bundle, "Le bundle BYPP v17 doit être généré");
    assert.strictEqual(conversionResult.bundle.version, 17);
    assert.strictEqual(conversionResult.bundle.format, "bypp");
    assert.ok(conversionResult.ashardeStatblock, "Le statblock Asharde doit être généré");
    assert.ok(conversionResult.ashardeStatblock.includes("👤 Gaël de Barne"));

    // 2. Connexion du client WebSocket Chrome simulé
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}`);
    let receivedRpcRequest: any = null;

    const sendTabState = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "tab_state",
            payload: {
              url: "https://harpy.gg/w/asharde-world/c/gael-de-barne",
              worldId: "asharde-world",
              entityId: "entity_gael_001",
              hasToken: true,
              active: true,
            },
          })
        );
      }
    };

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf-8"));

      if (msg.type === "get_tab_state") {
        sendTabState();
      } else if (msg.jsonrpc === "2.0") {
        receivedRpcRequest = msg;
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              success: true,
              entityUid: "entity_gael_001",
              updatedAt: Date.now(),
            },
          })
        );
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        sendTabState();
        resolve();
      });
      ws.on("error", (err) => reject(err));
    });

    await new Promise((r) => setTimeout(r, 200));

    // 3. Vérification de l'état d'onglet dans le pont
    const tabState = bridge.getActiveTabState();
    assert.ok(tabState, "L'onglet Chrome Harpy doit être actif et reconnu");
    assert.strictEqual(tabState?.worldId, "asharde-world");
    assert.strictEqual(tabState?.entityId, "entity_gael_001");

    // 4. Transmission d'un appel RPC via le pont
    const rpcResponse = await bridge.sendRpcRequest("sync_entity", {
      entityUid: "entity_gael_001",
      name: "Gaël de Barne",
    });

    assert.ok(rpcResponse.success);
    assert.ok(receivedRpcRequest);

    // 5. Moteur 3-Way Merge lors d'une mise à jour distante
    const mergeEngine = new MergeEngine();
    const lastSync = new Date(Date.now() - 3600000).toISOString();
    const now = Date.now();

    const action = mergeEngine.determineAction({
      lastSync,
      localMtime: now,
      remoteMtime: now,
    });

    assert.strictEqual(action, "MERGE_REQUIRED");

    const conflictOutput = formatConflictMarkers("Texte local Obsidian", "Texte distant Harpy", "OBSIDIAN", "HARPY");
    assert.ok(conflictOutput.includes("<<<<<<< OBSIDIAN"));
    assert.ok(conflictOutput.includes(">>>>>>> HARPY"));

    // Nettoyage client WS
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});
