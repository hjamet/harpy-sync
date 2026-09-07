import { z } from "zod";
import { HarpyWsBridge } from "../ws-bridge.js";

export const getHarpyEntitySchema = z.object({
  entityId: z
    .string()
    .describe("UID of the entity to fetch from Harpy (e.g. from the URL /entities/<UID>)"),
  worldId: z
    .string()
    .optional()
    .describe("Harpy World UID. If omitted, automatically uses the active world from the connected Chrome tab."),
  includeChunks: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include body chunks and text sections"),
  includeVariables: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include resolved variables and stats dictionary")
});

export type GetHarpyEntityInput = z.infer<typeof getHarpyEntitySchema>;

export function createGetHarpyEntityTool(bridge: HarpyWsBridge) {
  return {
    name: "get_harpy_entity",
    description:
      "Retrieves the complete entity data sheet, avatar, variables, pages, and chunks for a given entity ID from Harpy via the Chrome session.",
    schema: getHarpyEntitySchema,
    execute: async (input: GetHarpyEntityInput) => {
      const activeState = bridge.getActiveTabState();
      const worldId = input.worldId || activeState.worldId;

      const rpcResult = await bridge.sendRpcRequest("harpy/getEntity", {
        entityId: input.entityId,
        worldId,
        includeChunks: input.includeChunks,
        includeVariables: input.includeVariables
      });

      if (!rpcResult || !rpcResult.entity) {
        throw new Error(`Entity '${input.entityId}' not found on Harpy.`);
      }

      const entity = rpcResult.entity;
      const avatar = rpcResult.avatar || entity.avatar || entity.avatarUrl || entity.photoUrl || null;
      const variables = rpcResult.variables ?? entity.variables ?? entity.data ?? {};
      const chunks = rpcResult.chunks ?? entity.chunks ?? [];
      const pages = rpcResult.pages ?? [];
      const markdown = rpcResult.markdown ?? "";

      return {
        name: entity.name || "Untitled Entity",
        entityId: entity.id || entity.uid || input.entityId,
        worldId: entity.worldId || worldId,
        type: entity.type || "character",
        avatar,
        folder: entity.folder || null,
        tags: entity.tags || [],
        entity,
        variables,
        chunks,
        pages,
        markdown
      };
    }
  };
}
