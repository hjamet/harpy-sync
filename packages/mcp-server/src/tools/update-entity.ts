import { z } from "zod";
import { HarpyWsBridge } from "../ws-bridge.js";

export const updateHarpyEntitySchema = z.object({
  entityId: z
    .string()
    .describe("UID of the entity to update in Harpy"),
  worldId: z
    .string()
    .optional()
    .describe("Harpy World UID. If omitted, uses the active world from the connected Chrome tab."),
  name: z
    .string()
    .optional()
    .describe("New name for the entity"),
  folder: z
    .string()
    .optional()
    .describe("New folder path for the entity"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Replacement list of tags for the entity"),
  variables: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe("Variables to surgically update. Passing null removes/clears the variable."),
  content: z
    .string()
    .optional()
    .describe("Updated body / markdown text"),
  updateMask: z
    .array(z.string())
    .optional()
    .describe("Optional explicit list of Firestore field paths to patch (e.g. ['name', 'data.`var_abc`'])")
});

export type UpdateHarpyEntityInput = z.infer<typeof updateHarpyEntitySchema>;

export function createUpdateHarpyEntityTool(bridge: HarpyWsBridge) {
  return {
    name: "update_harpy_entity",
    description:
      "Surgically updates entity variables, metadata, or fields on Harpy using Firestore updateMask / RPC without overwriting untouched properties.",
    schema: updateHarpyEntitySchema,
    execute: async (input: UpdateHarpyEntityInput) => {
      const activeState = bridge.getActiveTabState();
      const worldId = input.worldId || activeState.worldId;

      const rpcResult = await bridge.sendRpcRequest("harpy/updateEntity", {
        entityId: input.entityId,
        worldId,
        name: input.name,
        folder: input.folder,
        tags: input.tags,
        variables: input.variables,
        content: input.content,
        updateMask: input.updateMask
      });

      return {
        success: true,
        entityId: input.entityId,
        worldId,
        updatedFields: rpcResult?.updatedFields ?? input.updateMask ?? Object.keys(input.variables ?? {}),
        timestamp: new Date().toISOString()
      };
    }
  };
}
