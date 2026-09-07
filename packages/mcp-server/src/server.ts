import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { HarpyWsBridge } from "./ws-bridge.js";
import {
  createGetActiveHarpyTabStateTool,
  getActiveHarpyTabStateSchema,
  createListHarpyEntitiesTool,
  listHarpyEntitiesSchema,
  createGetHarpyEntityTool,
  getHarpyEntitySchema,
  createCreateHarpyEntityTool,
  createHarpyEntitySchema,
  createUpdateHarpyEntityTool,
  updateHarpyEntitySchema,
  createSyncObsidianNoteToHarpyTool,
  syncObsidianNoteToHarpySchema,
  createTriggerTableActionTool,
  triggerTableActionSchema
} from "./tools/index.js";

export interface HarpyMcpServerOptions {
  wsPort?: number;
  wsHost?: string;
  name?: string;
  version?: string;
}

export class HarpyMcpServer {
  private server: Server;
  private bridge: HarpyWsBridge;
  private tools: Map<string, { description: string; schema: any; execute: (input: any) => Promise<any> }>;

  constructor(options: HarpyMcpServerOptions = {}) {
    this.bridge = new HarpyWsBridge({
      port: options.wsPort,
      host: options.wsHost
    });

    this.server = new Server(
      {
        name: options.name || "harpy-mcp-server",
        version: options.version || "0.1.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.tools = new Map();
    this.registerTools();
    this.setupHandlers();
  }

  /**
   * Registers the 7 standardized Harpy FastMCP tools.
   */
  private registerTools(): void {
    const t1 = createGetActiveHarpyTabStateTool(this.bridge);
    const t2 = createListHarpyEntitiesTool(this.bridge);
    const t3 = createGetHarpyEntityTool(this.bridge);
    const t4 = createCreateHarpyEntityTool(this.bridge);
    const t5 = createUpdateHarpyEntityTool(this.bridge);
    const t6 = createSyncObsidianNoteToHarpyTool(this.bridge);
    const t7 = createTriggerTableActionTool(this.bridge);

    this.tools.set(t1.name, t1);
    this.tools.set(t2.name, t2);
    this.tools.set(t3.name, t3);
    this.tools.set(t4.name, t4);
    this.tools.set(t5.name, t5);
    this.tools.set(t6.name, t6);
    this.tools.set(t7.name, t7);
  }

  /**
   * Sets up MCP protocol request handlers.
   */
  private setupHandlers(): void {
    // 1. List Available Tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_active_harpy_tab_state",
            description:
              "Retrieves the active Harpy.gg tab state in Chrome (URL, active world ID, active entity ID, token status) via the loopback WebSocket bridge.",
            inputSchema: {
              type: "object",
              properties: {
                requireActiveWorld: {
                  type: "boolean",
                  description: "If true, throws an error if no world is currently open in Harpy"
                }
              }
            }
          },
          {
            name: "list_harpy_entities",
            description:
              "Lists entities from a Harpy world with typed filters (worldId, type, tags, folder, search query, limit) via the active Chrome session.",
            inputSchema: {
              type: "object",
              properties: {
                worldId: {
                  type: "string",
                  description: "Harpy World UID. If omitted, uses the active world from Chrome."
                },
                type: {
                  type: "string",
                  description: "Filter by entity type (e.g. 'character', 'location', 'item', 'lore', 'npc', 'monster')"
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Filter entities containing these tags"
                },
                folder: {
                  type: "string",
                  description: "Filter by folder path (e.g. 'PNJ/Alliés')"
                },
                search: {
                  type: "string",
                  description: "Search query in entity name/summary"
                },
                limit: {
                  type: "integer",
                  description: "Max entities to return (default: 50, max: 200)"
                }
              }
            }
          },
          {
            name: "get_harpy_entity",
            description:
              "Retrieves the complete entity data sheet, avatar, variables, pages, and chunks for a given entity ID from Harpy.",
            inputSchema: {
              type: "object",
              properties: {
                entityId: {
                  type: "string",
                  description: "UID of the entity to fetch from Harpy"
                },
                worldId: {
                  type: "string",
                  description: "Harpy World UID (defaults to active world)"
                },
                includeChunks: {
                  type: "boolean",
                  description: "Include body chunks and text sections (default: true)"
                },
                includeVariables: {
                  type: "boolean",
                  description: "Include resolved variables dictionary (default: true)"
                }
              },
              required: ["entityId"]
            }
          },
          {
            name: "create_harpy_entity",
            description:
              "Creates a new entity in Harpy with typed metadata, variables, tags, and content via the active Chrome session.",
            inputSchema: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Entity name (e.g. 'Lord Malakor')"
                },
                type: {
                  type: "string",
                  description: "Entity type (e.g. 'character', 'location', 'item', 'npc')"
                },
                worldId: {
                  type: "string",
                  description: "Harpy World UID (defaults to active world)"
                },
                folder: {
                  type: "string",
                  description: "Folder path (e.g. 'PNJ/Ennemis')"
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tags to assign"
                },
                variables: {
                  type: "object",
                  description: "Initial key-value variables dictionary"
                },
                content: {
                  type: "string",
                  description: "Initial Markdown description or body"
                }
              },
              required: ["name"]
            }
          },
          {
            name: "update_harpy_entity",
            description:
              "Surgically updates entity variables, metadata, or fields on Harpy using Firestore REST updateMask / RPC without overwriting untouched properties.",
            inputSchema: {
              type: "object",
              properties: {
                entityId: {
                  type: "string",
                  description: "UID of the entity to update"
                },
                worldId: {
                  type: "string",
                  description: "Harpy World UID (defaults to active world)"
                },
                name: {
                  type: "string",
                  description: "Updated entity name"
                },
                folder: {
                  type: "string",
                  description: "Updated folder path"
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Updated tags list"
                },
                variables: {
                  type: "object",
                  description: "Variables dictionary to patch; set a variable to null to delete it"
                },
                content: {
                  type: "string",
                  description: "Updated Markdown text"
                },
                updateMask: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional explicit list of Firestore field paths to patch"
                }
              },
              required: ["entityId"]
            }
          },
          {
            name: "sync_obsidian_note_to_harpy",
            description:
              "Parses an Obsidian markdown note via @harpy/core, extracts frontmatter, sections, chunks, variables, computes diffs against Harpy, and drives Avatar Upload, Codex TinyMCE Sync, and Pathfinder 1e Sheet Sync.",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Absolute or relative file path to the Obsidian Markdown file"
                },
                markdownContent: {
                  type: "string",
                  description: "Raw Markdown content (if filePath is omitted)"
                },
                worldId: {
                  type: "string",
                  description: "Harpy World UID (defaults to frontmatter or active world)"
                },
                entityId: {
                  type: "string",
                  description: "Target entity UID (defaults to frontmatter 'harpy-uid')"
                },
                createIfMissing: {
                  type: "boolean",
                  description: "If true, creates a new entity if no matching UID exists (default: true)"
                },
                syncAvatar: {
                  type: "boolean",
                  description: "If true, automatically uploads avatar image if detected in note (default: true)"
                },
                syncCodex: {
                  type: "boolean",
                  description: "If true, synchronizes note sections and text chunks into Harpy Codex pages & TinyMCE (default: true)"
                },
                syncSheet: {
                  type: "boolean",
                  description: "If true, maps and populates Pathfinder 1e character sheet variables in the drawer (default: true)"
                },
                dryRun: {
                  type: "boolean",
                  description: "If true, computes and reports diffs without modifying Harpy (default: false)"
                }
              }
            }
          },
          {
            name: "trigger_table_action",
            description:
              "Triggers an in-game table action on Harpy (dice roll formula, random table roll by UID/name, table-wide chat notification, or sheet variable modifier).",
            inputSchema: {
              type: "object",
              properties: {
                actionType: {
                  type: "string",
                  enum: ["dice_roll", "random_table_roll", "notification", "variable_modify"],
                  description: "Type of table action to trigger"
                },
                worldId: {
                  type: "string",
                  description: "Harpy World UID (defaults to active world)"
                },
                diceFormula: {
                  type: "string",
                  description: "Dice formula for 'dice_roll' (e.g. '1d20+5')"
                },
                tableUidOrName: {
                  type: "string",
                  description: "Table UID or title for 'random_table_roll'"
                },
                message: {
                  type: "string",
                  description: "Text message for 'notification' to broadcast"
                },
                entityId: {
                  type: "string",
                  description: "Target entity UID for 'variable_modify'"
                },
                variableName: {
                  type: "string",
                  description: "Variable name for 'variable_modify' (e.g. 'HP')"
                },
                variableDelta: {
                  type: "number",
                  description: "Numeric delta to apply (e.g. -5, +10)"
                },
                isSecret: {
                  type: "boolean",
                  description: "Whether the action is GM-only / secret (default: false)"
                }
              },
              required: ["actionType"]
            }
          }
        ]
      };
    });

    // 2. Call Tool Request
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const tool = this.tools.get(toolName);

      if (!tool) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
      }

      try {
        const rawArgs = request.params.arguments ?? {};
        const parsedArgs = tool.schema.parse(rawArgs);
        const result = await tool.execute(parsedArgs);

        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err: any) {
        console.error(`[Harpy-MCP] Error executing tool '${toolName}':`, err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error executing ${toolName}: ${err.message || String(err)}`
            }
          ]
        };
      }
    });
  }

  /**
   * Starts both the WebSocket bridge and the MCP Server on stdio.
   */
  public async start(): Promise<void> {
    // 1. Start WebSocket loopback bridge in background
    await this.bridge.start();

    // 2. Connect MCP server to stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error("[Harpy-MCP] Harpy FastMCP Server running on stdio transport.");
  }

  /**
   * Stops the MCP server and bridge.
   */
  public async stop(): Promise<void> {
    await this.bridge.stop();
    await this.server.close();
    console.error("[Harpy-MCP] Harpy FastMCP Server stopped.");
  }

  public getBridge(): HarpyWsBridge {
    return this.bridge;
  }
}
