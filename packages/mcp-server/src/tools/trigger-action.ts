import { z } from "zod";
import { HarpyWsBridge } from "../ws-bridge.js";

export const triggerTableActionSchema = z.object({
  actionType: z
    .enum(["dice_roll", "random_table_roll", "notification", "variable_modify"])
    .describe("Type of game table action to trigger on Harpy"),
  worldId: z
    .string()
    .optional()
    .describe("Harpy World UID. Defaults to active world in Chrome."),
  diceFormula: z
    .string()
    .optional()
    .describe("Dice formula for 'dice_roll' (e.g. '1d20+5', '2d6+3', '4d6kh3', '1d100')"),
  tableUidOrName: z
    .string()
    .optional()
    .describe("Table UID or title for 'random_table_roll'"),
  message: z
    .string()
    .optional()
    .describe("Text message for 'notification' to broadcast to the VTT table"),
  entityId: z
    .string()
    .optional()
    .describe("Target entity UID for 'variable_modify'"),
  variableName: z
    .string()
    .optional()
    .describe("Target variable name or key for 'variable_modify' (e.g. 'HP', 'Points de Vie', 'Mana')"),
  variableDelta: z
    .number()
    .optional()
    .describe("Numeric delta to apply for 'variable_modify' (e.g. -5 to subtract HP, +10 to heal)"),
  isSecret: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, the roll or action is secret / visible only to the GM")
});

export type TriggerTableActionInput = z.infer<typeof triggerTableActionSchema>;

export function createTriggerTableActionTool(bridge: HarpyWsBridge) {
  return {
    name: "trigger_table_action",
    description:
      "Triggers an in-game table action on Harpy (dice roll formula, random table roll by UID/name, table-wide chat notification, or sheet variable modifier).",
    schema: triggerTableActionSchema,
    execute: async (input: TriggerTableActionInput) => {
      const activeState = bridge.getActiveTabState();
      const worldId = input.worldId || activeState.worldId;

      if (!worldId) {
        throw new Error(
          "worldId is required to trigger a table action. Please provide 'worldId' or open Harpy.gg in Chrome."
        );
      }

      // Input validation per actionType
      if (input.actionType === "dice_roll" && !input.diceFormula) {
        throw new Error("diceFormula is required when actionType is 'dice_roll' (e.g. '1d20+5').");
      }
      if (input.actionType === "random_table_roll" && !input.tableUidOrName) {
        throw new Error("tableUidOrName is required when actionType is 'random_table_roll'.");
      }
      if (input.actionType === "notification" && !input.message) {
        throw new Error("message is required when actionType is 'notification'.");
      }
      if (input.actionType === "variable_modify") {
        if (!input.entityId) {
          throw new Error("entityId is required when actionType is 'variable_modify'.");
        }
        if (!input.variableName) {
          throw new Error("variableName is required when actionType is 'variable_modify'.");
        }
        if (input.variableDelta === undefined) {
          throw new Error("variableDelta is required when actionType is 'variable_modify'.");
        }
      }

      const rpcResult = await bridge.sendRpcRequest("harpy/triggerAction", {
        actionType: input.actionType,
        worldId,
        diceFormula: input.diceFormula,
        tableUidOrName: input.tableUidOrName,
        message: input.message,
        entityId: input.entityId,
        variableName: input.variableName,
        variableDelta: input.variableDelta,
        isSecret: input.isSecret
      });

      return {
        success: true,
        actionType: input.actionType,
        worldId,
        result: rpcResult ?? {
          status: "executed",
          action: input.actionType,
          timestamp: new Date().toISOString()
        }
      };
    }
  };
}
