import { z } from "zod";
import { HarpyWsBridge } from "../ws-bridge.js";

export const createHarpyEntitySchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Name of the entity to create (e.g. 'Lord Malakor', 'Auberge du Poney Fringant')"),
  type: z
    .string()
    .optional()
    .default("character")
    .describe("Entity type: 'character', 'location', 'item', 'lore', 'npc', 'monster', or custom"),
  worldId: z
    .string()
    .optional()
    .describe("Harpy World UID. If omitted, uses the active world from the connected Chrome tab."),
  folder: z
    .string()
    .optional()
    .describe("Folder path in Harpy hierarchy (e.g. 'PNJ/Ennemis' or 'Lieux/Villes')"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Tags to assign to the new entity"),
  variables: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Initial key-value variables dictionary (e.g. { force: 16, pv_max: 45, classe: 'Guerrier' })"),
  content: z
    .string()
    .optional()
    .describe("Initial Markdown content / description for the entity")
});

export type CreateHarpyEntityInput = z.infer<typeof createHarpyEntitySchema>;

export function createCreateHarpyEntityTool(bridge: HarpyWsBridge) {
  return {
    name: "create_harpy_entity",
    description:
      "Creates a new entity in Harpy with typed metadata, variables, tags, and content via the active Chrome session.",
    schema: createHarpyEntitySchema,
    execute: async (input: CreateHarpyEntityInput) => {
      const activeState = bridge.getActiveTabState();
      const worldId = input.worldId || activeState.worldId;

      if (!worldId) {
        throw new Error(
          "worldId is required to create an entity. Either provide 'worldId' or open a world tab on Harpy.gg in Chrome."
        );
      }

      const rpcResult = await bridge.sendRpcRequest("harpy/createEntity", {
        name: input.name,
        type: input.type,
        worldId,
        folder: input.folder,
        tags: input.tags ?? [],
        variables: input.variables ?? {},
        content: input.content ?? ""
      });

      const entityId = rpcResult?.entityId || rpcResult?.uid || rpcResult?.id;

      return {
        success: true,
        entityId,
        name: input.name,
        worldId,
        url: `https://harpy.gg/worlds/${worldId}/entities/${entityId}`,
        createdEntity: rpcResult?.entity ?? null
      };
    }
  };
}
