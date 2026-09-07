import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseObsidianNote, computeEntityDiff } from "@harpy/core";
import { HarpyWsBridge } from "../ws-bridge.js";

export const syncObsidianNoteToHarpySchema = z.object({
  filePath: z
    .string()
    .optional()
    .describe("Absolute or relative file path to the Obsidian Markdown file on the local filesystem"),
  markdownContent: z
    .string()
    .optional()
    .describe("Raw Markdown content string (used if filePath is not specified)"),
  worldId: z
    .string()
    .optional()
    .describe("Harpy World UID. Defaults to frontmatter 'harpy-world' or the active world in Chrome."),
  entityId: z
    .string()
    .optional()
    .describe("Target entity UID in Harpy. Defaults to frontmatter 'harpy-uid' or 'uid'."),
  createIfMissing: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, automatically creates a new entity in Harpy if no matching entity UID is found"),
  syncAvatar: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, automatically uploads avatar image if detected in note frontmatter or attachments"),
  syncCodex: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, synchronizes note sections and text chunks into Harpy Codex pages & TinyMCE"),
  syncSheet: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, maps and populates Pathfinder 1e character sheet variables in the drawer"),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, computes and reports all diffs without making any changes to Harpy")
});

export type SyncObsidianNoteToHarpyInput = z.infer<typeof syncObsidianNoteToHarpySchema>;

export function createSyncObsidianNoteToHarpyTool(bridge: HarpyWsBridge) {
  return {
    name: "sync_obsidian_note_to_harpy",
    description:
      "Parses an Obsidian markdown note via @harpy/core, extracts frontmatter, sections, chunks, variables, computes diffs against Harpy, and drives Avatar Upload, Codex TinyMCE Sync, and Pathfinder 1e Sheet Sync.",
    schema: syncObsidianNoteToHarpySchema,
    execute: async (input: SyncObsidianNoteToHarpyInput) => {
      let rawMarkdown = input.markdownContent;
      let noteDefaultName = "Untitled Entity";
      let noteDir: string | null = null;

      if (input.filePath) {
        try {
          rawMarkdown = await fs.readFile(input.filePath, "utf-8");
          noteDefaultName = path.basename(input.filePath, path.extname(input.filePath));
          noteDir = path.dirname(path.resolve(input.filePath));
        } catch (err: any) {
          throw new Error(`Failed to read Obsidian note at '${input.filePath}': ${err.message}`);
        }
      }

      if (!rawMarkdown) {
        throw new Error("Either 'filePath' or 'markdownContent' must be provided.");
      }

      // 1. Parse note with @harpy/core
      const parsedNote = parseObsidianNote(rawMarkdown, noteDefaultName);

      // 2. Determine world and entity ID
      const activeState = bridge.getActiveTabState();
      const worldId = input.worldId || parsedNote.worldUid || activeState.worldId;

      if (!worldId) {
        throw new Error(
          "worldId is required. Specify 'worldId', define 'harpy-world' in YAML frontmatter, or open a Harpy world in Chrome."
        );
      }

      const entityId = input.entityId || parsedNote.uid;

      // 3. Extract Avatar candidate
      const avatarCandidate = await resolveAvatarData(parsedNote, rawMarkdown, noteDir);

      // ─── Case 1: Entity exists -> Diff & Update ───
      if (entityId) {
        let remoteEntityData: any = null;
        try {
          remoteEntityData = await bridge.sendRpcRequest("harpy/getEntity", {
            entityId,
            worldId
          });
        } catch (err: any) {
          console.error(`[Harpy-MCP] Could not fetch remote entity ${entityId}:`, err.message);
        }

        const remoteEntity = remoteEntityData?.entity || remoteEntityData;
        const diff = computeEntityDiff(parsedNote, remoteEntity);

        if (input.dryRun) {
          return {
            success: true,
            action: "DRY_RUN",
            entityId,
            entityName: parsedNote.name,
            worldId,
            hasDiff: diff.hasDiff,
            diffSummary: diff.diffSummary,
            hasAvatar: Boolean(avatarCandidate),
            variablesCount: Object.keys(parsedNote.variables).length,
            chunksCount: parsedNote.chunks.length,
            diffDetails: diff
          };
        }

        // Push Core Entity updates
        let patchResult: any = null;
        if (diff.hasDiff) {
          patchResult = await bridge.sendRpcRequest("harpy/updateEntity", {
            entityId,
            worldId,
            name: parsedNote.name,
            folder: parsedNote.folder,
            tags: parsedNote.tags,
            variables: parsedNote.variables,
            content: parsedNote.cleanBody
          });
        }

        // 4. Run Avatar Upload Module if requested & available
        let avatarResult: any = null;
        if (input.syncAvatar !== false && avatarCandidate) {
          try {
            avatarResult = await bridge.sendRpcRequest("harpy/uploadAvatar", avatarCandidate);
          } catch (avatarErr: any) {
            console.warn(`[Harpy-MCP] Avatar upload failed: ${avatarErr.message}`);
            avatarResult = { success: false, error: avatarErr.message };
          }
        }

        // 5. Run Pathfinder 1e Sheet Sync Module
        let sheetResult: any = null;
        if (input.syncSheet !== false && Object.keys(parsedNote.variables).length > 0) {
          try {
            sheetResult = await bridge.sendRpcRequest("harpy/syncSheet", {
              variables: parsedNote.variables,
              system: "pathfinder1e"
            });
          } catch (sheetErr: any) {
            console.warn(`[Harpy-MCP] Sheet sync failed: ${sheetErr.message}`);
            sheetResult = { success: false, error: sheetErr.message };
          }
        }

        // 6. Run Codex & TinyMCE Sync Module
        let codexResult: any = null;
        if (input.syncCodex !== false) {
          try {
            const pagesToSync = (parsedNote.pages && parsedNote.pages.length > 0)
              ? parsedNote.pages.map((p) => ({
                  id: p.uid,
                  title: p.name || "Description",
                  markdown: p.markdown || ""
                }))
              : [{ title: parsedNote.name || "Description", markdown: parsedNote.cleanBody || parsedNote.rawMarkdown }];

            codexResult = await bridge.sendRpcRequest("harpy/syncCodex", {
              pages: pagesToSync,
              createMissingPages: true
            });
          } catch (codexErr: any) {
            console.warn(`[Harpy-MCP] Codex sync failed: ${codexErr.message}`);
            codexResult = { success: false, error: codexErr.message };
          }
        }

        return {
          success: true,
          action: "UPDATED",
          entityId,
          entityName: parsedNote.name,
          worldId,
          url: `https://harpy.gg/worlds/${worldId}/entities/${entityId}`,
          diffSummary: diff.diffSummary,
          updatedFields: patchResult?.updatedFields ?? Object.keys(parsedNote.variables),
          avatarStatus: avatarResult,
          sheetStatus: sheetResult,
          codexStatus: codexResult
        };
      }

      // ─── Case 2: New Entity -> Create ───
      if (input.dryRun) {
        return {
          success: true,
          action: "DRY_RUN",
          wouldCreate: true,
          entityName: parsedNote.name,
          worldId,
          variablesCount: Object.keys(parsedNote.variables).length,
          chunksCount: parsedNote.chunks.length,
          hasAvatar: Boolean(avatarCandidate),
          tags: parsedNote.tags
        };
      }

      if (!input.createIfMissing) {
        throw new Error(
          `No entity UID found in note frontmatter and 'createIfMissing' is false. Cannot sync.`
        );
      }

      const createResult = await bridge.sendRpcRequest("harpy/createEntity", {
        name: parsedNote.name,
        type: parsedNote.type,
        worldId,
        folder: parsedNote.folder,
        tags: parsedNote.tags,
        variables: parsedNote.variables,
        content: parsedNote.cleanBody
      });

      const newEntityId = createResult?.entityId || createResult?.uid || createResult?.id;

      // Run Avatar Upload
      let avatarResult: any = null;
      if (input.syncAvatar !== false && avatarCandidate) {
        try {
          avatarResult = await bridge.sendRpcRequest("harpy/uploadAvatar", avatarCandidate);
        } catch (avatarErr: any) {
          avatarResult = { success: false, error: avatarErr.message };
        }
      }

      // Run Sheet Sync
      let sheetResult: any = null;
      if (input.syncSheet !== false && Object.keys(parsedNote.variables).length > 0) {
        try {
          sheetResult = await bridge.sendRpcRequest("harpy/syncSheet", {
            variables: parsedNote.variables,
            system: "pathfinder1e"
          });
        } catch (sheetErr: any) {
          sheetResult = { success: false, error: sheetErr.message };
        }
      }

      // Run Codex Sync
      let codexResult: any = null;
      if (input.syncCodex !== false) {
        try {
          const pagesToSync = (parsedNote.pages && parsedNote.pages.length > 0)
            ? parsedNote.pages.map((p) => ({
                id: p.uid,
                title: p.name || "Description",
                markdown: p.markdown || ""
              }))
            : [{ title: parsedNote.name || "Description", markdown: parsedNote.cleanBody || parsedNote.rawMarkdown }];

          codexResult = await bridge.sendRpcRequest("harpy/syncCodex", {
            pages: pagesToSync,
            createMissingPages: true
          });
        } catch (codexErr: any) {
          codexResult = { success: false, error: codexErr.message };
        }
      }

      return {
        success: true,
        action: "CREATED",
        entityId: newEntityId,
        entityName: parsedNote.name,
        worldId,
        url: `https://harpy.gg/worlds/${worldId}/entities/${newEntityId}`,
        createdEntity: createResult?.entity ?? null,
        avatarStatus: avatarResult,
        sheetStatus: sheetResult,
        codexStatus: codexResult
      };
    }
  };
}

/**
 * Resolves avatar image data or file path into an uploadable payload.
 */
async function resolveAvatarData(
  parsedNote: any,
  rawMarkdown: string,
  noteDir: string | null
): Promise<{ imageData?: string; imageUrl?: string; fileName: string; mimeType?: string } | null> {
  const fm = parsedNote.frontmatter || {};
  let avatarPath =
    fm.avatar || fm.image || fm.Image || fm.photo || fm.Photo || fm.banner || fm.cover || fm.portrait;

  if (typeof avatarPath === "string") {
    avatarPath = avatarPath.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  }

  // Search markdown image embed if not in frontmatter
  if (!avatarPath) {
    const wikiMatch = rawMarkdown.match(/!\[\[([^\]]+\.(?:png|jpg|jpeg|webp|gif|svg))\]\]/i);
    if (wikiMatch) {
      avatarPath = wikiMatch[1];
    } else {
      const mdMatch = rawMarkdown.match(/!\[[^\]]*\]\(([^)]+\.(?:png|jpg|jpeg|webp|gif|svg))\)/i);
      if (mdMatch) {
        avatarPath = mdMatch[1];
      }
    }
  }

  if (!avatarPath || typeof avatarPath !== "string") {
    return null;
  }

  const fileName = path.basename(avatarPath) || "avatar.png";

  // If remote URL
  if (avatarPath.startsWith("http://") || avatarPath.startsWith("https://")) {
    return { imageUrl: avatarPath, fileName };
  }

  // If already base64 data URL
  if (avatarPath.startsWith("data:")) {
    return { imageData: avatarPath, fileName };
  }

  // If local file path
  if (noteDir) {
    const possiblePaths = [
      path.resolve(noteDir, avatarPath),
      path.resolve(noteDir, "_attachments", avatarPath),
      path.resolve(noteDir, "attachments", avatarPath),
      path.resolve(noteDir, "..", "_attachments", avatarPath),
      path.resolve(avatarPath)
    ];

    for (const testPath of possiblePaths) {
      try {
        const stats = await fs.stat(testPath);
        if (stats.isFile()) {
          const buffer = await fs.readFile(testPath);
          const ext = path.extname(testPath).replace(".", "").toLowerCase();
          const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          const base64Data = `data:${mime};base64,${buffer.toString("base64")}`;
          return {
            imageData: base64Data,
            fileName: path.basename(testPath),
            mimeType: mime
          };
        }
      } catch {
        // continue
      }
    }
  }

  return null;
}
