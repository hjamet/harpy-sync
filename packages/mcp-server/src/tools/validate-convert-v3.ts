import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  validateHarpyV3Markdown,
  parseObsidianNote,
  buildAshardeCharacterSheetTemplate,
  formatAshardeHarpyStatblock,
  BeyondPaperBundle,
  AshardeCharacterSheet,
} from "@harpy/core";

export const validateAndConvertHarpyV3Schema = z.object({
  filePath: z
    .string()
    .optional()
    .describe("Absolute or relative file path to the Obsidian Markdown note"),
  markdownContent: z
    .string()
    .optional()
    .describe("Raw Markdown content string (if filePath is not provided)"),
  entityName: z
    .string()
    .optional()
    .describe("Optional entity name for validation checks. Defaults to filename or frontmatter."),
  generateBundle: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, generates a compliant BeyondPaperBundle (.bypp v17) JSON bundle"),
  generateAshardeStatblock: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, generates an Asharde 1/10/100 Scènes Harpy Bloc 5 statblock"),
  archetype: z
    .enum(["arcaniste", "reveur", "autre"])
    .optional()
    .default("reveur")
    .describe("Asharde archetype for character sheet generation"),
});

export type ValidateAndConvertHarpyV3Input = z.input<typeof validateAndConvertHarpyV3Schema>;

export function createValidateAndConvertHarpyV3Tool() {
  return {
    name: "validate_and_convert_harpy_v3",
    description:
      "Validates an Obsidian Harpy v3 note offline (5 blocs, char length invariants, anti-leak checks) and optionally compiles it into a Beyond Paper (.bypp v17) bundle or Asharde 1/10/100 Scènes statblock without requiring an active Chrome tab.",
    schema: validateAndConvertHarpyV3Schema,
    execute: async (rawInput: ValidateAndConvertHarpyV3Input) => {
      const input = validateAndConvertHarpyV3Schema.parse(rawInput);
      let rawMarkdown = input.markdownContent;
      let defaultName = input.entityName || "Untitled Entity";

      if (input.filePath) {
        try {
          rawMarkdown = await fs.readFile(input.filePath, "utf-8");
          if (!input.entityName) {
            defaultName = path.basename(input.filePath, path.extname(input.filePath));
          }
        } catch (err: any) {
          throw new Error(`Failed to read note at '${input.filePath}': ${err.message}`);
        }
      }

      if (!rawMarkdown) {
        throw new Error("Either 'filePath' or 'markdownContent' must be provided.");
      }

      // 1. Validation Harpy v3
      const parsedNote = parseObsidianNote(rawMarkdown, defaultName);
      const effectiveName = input.entityName || parsedNote.name || defaultName;
      const validation = validateHarpyV3Markdown(rawMarkdown, { entityName: effectiveName });

      let bundle: BeyondPaperBundle | undefined;
      let ashardeStatblock: string | undefined;

      // 2. Génération de bundle .bypp v17
      if (input.generateBundle) {
        const entityUid = (parsedNote.uid || `entity_${Date.now()}`) as any;
        const now = new Date().toISOString();

        const entityChunks = parsedNote.chunks.map((c) => ({
          uid: (c.uid || `chunk_${Math.random().toString(36).slice(2, 9)}`) as any,
          type: "text" as const,
          headingMode: "outside" as const,
          content: c.content || c.text || "",
        }));

        const entityPages: BeyondPaperBundle["pages"] = parsedNote.pages.map((p, idx) => ({
          uid: (p.uid || `page_${idx}_${Date.now()}`) as any,
          type: "standard" as const,
          name: p.name,
          chunksOrder: entityChunks.map((c) => c.uid),
        }));

        bundle = {
          version: 17,
          format: "bypp",
          name: `Export - ${effectiveName}`,
          bundleVersion: "1.0.0",
          exportedAt: now,
          attribution: {
            authorName: "Harpy Sync",
          },
          license: "ARR",
          licenseVersion: "4.0",
          entities: [
            {
              uid: entityUid,
              name: effectiveName,
              displayName: (parsedNote.frontmatter.displayName as string) || effectiveName,
              description: validation.blocks.descriptionExterne || "",
              type: "character",
              isArchived: false,
              pagesOrder: entityPages.map((p) => p.uid),
              tagsUid: [],
              assetUids: [],
              data: {
                var_harpy_v3_valid: validation.valid,
                var_harpy_v3_errors_count: validation.errors.length,
              } as any,
            },
          ],
          pages: entityPages,
          chunks: entityChunks,
          variables: [],
          sheets: [],
          tags: [],
          tagCategories: [],
          datasets: [],
          dataTables: [],
          randomTables: [],
          dialects: [],
          scenes: [],
          assets: [],
          widgets: [],
        } as unknown as BeyondPaperBundle;
      }

      // 3. Statblock Asharde optionnel
      if (input.generateAshardeStatblock) {
        const defaultStat = (base = 5) => ({
          base,
          impairments: { temporaire: 0, mineur: 0, majeur: 0, definitif: 0 },
        });

        const sheet: AshardeCharacterSheet = {
          id: `asharde-${effectiveName.toLowerCase().replace(/\s+/g, "-")}`,
          name: effectiveName,
          archetype: input.archetype,
          armorQuality: 2,
          activeBleedings: [],
          stats: {
            force: defaultStat(4),
            agilite: defaultStat(5),
            constitution: defaultStat(4),
            vitesse: defaultStat(5),
            perception: defaultStat(6),
            chance: defaultStat(4),
            attractivite: defaultStat(5),
            autorite: defaultStat(4),
            evolution: defaultStat(4),
            intelligence: defaultStat(6),
            conscience: defaultStat(5),
          },
          weapons: [
            {
              name: "Arme de poing",
              quality: 4,
              signatureTable: [{ roll: 1, targetStat: "vitesse", tier: "temporaire" }],
            },
          ],
        };

        ashardeStatblock = formatAshardeHarpyStatblock(sheet);
      }

      return {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        blocks: validation.blocks,
        parsedNote: {
          name: effectiveName,
          tags: parsedNote.tags,
          frontmatter: parsedNote.frontmatter,
          pagesCount: parsedNote.pages.length,
          chunksCount: parsedNote.chunks.length,
        },
        bundle,
        ashardeStatblock,
      };
    },
  };
}
