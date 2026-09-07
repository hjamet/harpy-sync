import { z } from "zod";
import { HarpyWsBridge } from "../ws-bridge.js";

export const listHarpyEntitiesSchema = z.object({
  worldId: z
    .string()
    .optional()
    .describe("Harpy World UID. If omitted, automatically uses the active world from the connected Chrome tab."),
  type: z
    .string()
    .optional()
    .describe("Filter by entity type (e.g. 'character', 'location', 'item', 'lore', 'npc', 'monster')"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Filter entities containing any or all of these tags"),
  folder: z
    .string()
    .optional()
    .describe("Filter entities residing in a specific folder path (e.g. 'PNJ/Alliés' or 'Lieux')"),
  search: z
    .string()
    .optional()
    .describe("Text search to filter entities by name or description substring"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe("Maximum number of entities to return (default: 50, max: 200)")
});

export type ListHarpyEntitiesInput = z.infer<typeof listHarpyEntitiesSchema>;

export function createListHarpyEntitiesTool(bridge: HarpyWsBridge) {
  return {
    name: "list_harpy_entities",
    description:
      "Lists entities from a Harpy world with typed filters (worldId, type, tags, folder, search query, limit) via the Chrome session.",
    schema: listHarpyEntitiesSchema,
    execute: async (input: ListHarpyEntitiesInput) => {
      const activeState = bridge.getActiveTabState();
      const worldId = input.worldId || activeState.worldId;

      if (!worldId) {
        throw new Error(
          "worldId is required. Either provide 'worldId' explicitly or open a world tab on Harpy.gg in Chrome."
        );
      }

      const rpcResult = await bridge.sendRpcRequest("harpy/listEntities", {
        worldId,
        type: input.type,
        tags: input.tags,
        folder: input.folder,
        search: input.search,
        limit: input.limit
      });

      return {
        worldId,
        total: Array.isArray(rpcResult?.entities) ? rpcResult.entities.length : 0,
        entities: rpcResult?.entities ?? [],
        hasMore: rpcResult?.hasMore ?? false
      };
    }
  };
}
