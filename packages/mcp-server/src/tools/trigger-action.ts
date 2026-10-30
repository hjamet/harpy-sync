import { z } from "zod";
import {
  duplicateTurnTrackerEntity,
  resolveEntityConnections,
  propagateSharedTimeCompound,
} from "@harpy/core";
import { HarpyWsBridge } from "../ws-bridge.js";

export const triggerTableActionSchema = z.object({
  actionType: z
    .enum([
      "dice_roll",
      "random_table_roll",
      "notification",
      "variable_modify",
      "turn_tracker_duplicate",
      "entity_connect",
      "asharde_time_advance",
    ])
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
    .describe("Target entity UID for 'variable_modify' or 'turn_tracker_duplicate'"),
  variableName: z
    .string()
    .optional()
    .describe("Target variable name or entity display name (e.g. 'HP', 'Points de Vie', 'Gobelin')"),
  variableDelta: z
    .number()
    .optional()
    .describe("Numeric delta to apply for 'variable_modify' (e.g. -5 to subtract HP, +10 to heal)"),
  isSecret: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, the roll or action is secret / visible only to the GM"),
  duplicateCount: z
    .number()
    .optional()
    .describe("Number of instances to duplicate in turn tracker (1-100)"),
  baseInitiative: z
    .number()
    .optional()
    .describe("Base initiative score for duplicated entities"),
  deterministicRolls: z
    .array(z.number())
    .optional()
    .describe("Deterministic rolls for individual initiative of duplicated entities"),
  connection: z
    .any()
    .optional()
    .describe("Single HarpyEntityConnection to connect/evaluate"),
  connectionsList: z
    .array(z.any())
    .optional()
    .describe("List of HarpyEntityConnection objects for entity_connect resolution"),
  baseVariables: z
    .record(z.any())
    .optional()
    .describe("Base variables for entity_connect resolution"),
  ashardeTransition: z
    .enum(["action_end", "calm_scene", "rest_scene", "long_time", "ellipse"])
    .optional()
    .describe("Asharde time transition type"),
  ashardeSheets: z
    .array(z.any())
    .optional()
    .describe("Array of AshardeCharacterSheet objects for shared time compound propagation"),
  offlineComputeOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, returns deterministic pure computation from @harpy/core without requiring active Harpy tab"),
});

export type TriggerTableActionInput = z.infer<typeof triggerTableActionSchema>;

export function createTriggerTableActionTool(bridge: HarpyWsBridge) {
  return {
    name: "trigger_table_action",
    description:
      "Triggers an in-game table action on Harpy (dice roll formula, random table roll, notification, variable modifier, Turn Tracker duplication, entity connection resolution, or Asharde shared time propagation).",
    schema: triggerTableActionSchema,
    execute: async (input: TriggerTableActionInput) => {
      const activeState = bridge.getActiveTabState();
      const worldId = input.worldId || activeState.worldId;

      // 1. Calculs déterministes @harpy/core si applicable
      let deterministicResult: any = null;

      if (input.actionType === "turn_tracker_duplicate") {
        const sourceEntity = {
          uid: input.entityId || "turn_entity",
          name: input.variableName || "Entity",
          hpMax: 10,
          hpCurrent: 10,
        };
        const count = input.duplicateCount ?? 1;
        deterministicResult = duplicateTurnTrackerEntity(sourceEntity, count, {
          baseInitiative: input.baseInitiative,
          deterministicRolls: input.deterministicRolls,
        });
      } else if (input.actionType === "entity_connect") {
        const conns =
          input.connectionsList || (input.connection ? [input.connection] : []);
        const vars = input.baseVariables || {};
        deterministicResult = resolveEntityConnections(vars, conns);
      } else if (input.actionType === "asharde_time_advance") {
        const sheets = input.ashardeSheets || [];
        const transition = input.ashardeTransition || "action_end";
        deterministicResult = propagateSharedTimeCompound(sheets, transition);
      }

      // Si mode calcul hors ligne ou si aucun client connecté avec un résultat déterministe
      if (
        (input.offlineComputeOnly || !activeState.connected) &&
        deterministicResult !== null
      ) {
        return {
          success: true,
          actionType: input.actionType,
          worldId: worldId || "offline",
          result: deterministicResult,
        };
      }

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

      let rpcResult: any = null;
      try {
        rpcResult = await bridge.sendRpcRequest("harpy/triggerAction", {
          actionType: input.actionType,
          worldId,
          diceFormula: input.diceFormula,
          tableUidOrName: input.tableUidOrName,
          message: input.message,
          entityId: input.entityId,
          variableName: input.variableName,
          variableDelta: input.variableDelta,
          isSecret: input.isSecret,
          duplicateCount: input.duplicateCount,
          baseInitiative: input.baseInitiative,
          ashardeTransition: input.ashardeTransition,
          deterministicResult,
        });
      } catch (rpcErr: any) {
        if (deterministicResult !== null) {
          rpcResult = deterministicResult;
        } else {
          throw rpcErr;
        }
      }

      return {
        success: true,
        actionType: input.actionType,
        worldId,
        result:
          rpcResult ??
          deterministicResult ?? {
            status: "executed",
            action: input.actionType,
            timestamp: new Date().toISOString(),
          },
      };
    },
  };
}
