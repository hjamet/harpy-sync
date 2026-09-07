import { z } from "zod";
import { HarpyWsBridge } from "../ws-bridge.js";

export const getActiveHarpyTabStateSchema = z.object({
  requireActiveWorld: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, throws an error if no world is currently open in the active Harpy tab")
});

export type GetActiveHarpyTabStateInput = z.infer<typeof getActiveHarpyTabStateSchema>;

export function createGetActiveHarpyTabStateTool(bridge: HarpyWsBridge) {
  return {
    name: "get_active_harpy_tab_state",
    description:
      "Retrieves the current state of the active Harpy.gg tab in Google Chrome via the WebSocket bridge, including the current URL, world ID, entity ID, entity type, and authentication status.",
    schema: getActiveHarpyTabStateSchema,
    execute: async (input: GetActiveHarpyTabStateInput) => {
      const state = bridge.getActiveTabState();

      if (!state.connected) {
        return {
          connected: false,
          error: "No Harpy tab currently connected to WebSocket bridge (127.0.0.1:18765).",
          message: "Please open Google Chrome and navigate to https://harpy.gg with the Harpy extension active."
        };
      }

      if (input.requireActiveWorld && !state.worldId) {
        throw new Error(
          "A Harpy tab is connected, but no world is currently selected. Please open a world on Harpy.gg."
        );
      }

      return {
        connected: true,
        tabId: state.tabId,
        url: state.url,
        worldId: state.worldId,
        entityId: state.entityId,
        entityType: state.entityType,
        hasToken: state.hasToken,
        active: state.active,
        timestamp: state.timestamp
      };
    }
  };
}
