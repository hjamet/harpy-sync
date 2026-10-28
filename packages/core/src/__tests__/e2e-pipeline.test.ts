import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  validateHarpyV3Markdown,
  parseObsidianNote,
  parseMarkdown,
  serializeMarkdown,
  parseBeyondPaperBundle,
  MergeEngine,
  formatConflictMarkers,
  computeEntityDiff,
  BeyondPaperBundle,
} from "../index.js";

const BENCHMARK_DIR =
  "C:\\Users\\Jamet\\.gemini\\antigravity\\brain\\d687d02e-d16a-4b46-9e3f-bff760bf1ba6\\entites_harpy_v3";

describe("E2E Pipeline: Harpy v3 Etalons -> Markdown/Bypp Conversion -> 3-Way Merge -> Harpy Payload", () => {
  const benchmarkEntities = ["Le Havre.md", "Gael de Barne.md", "Sartorius.md"];

  // 1. Validation Harpy v3 sur les 3 fiches étalons
  for (const fileName of benchmarkEntities) {
    test(`1. Validation Harpy v3 sur fiche étalon '${fileName}'`, async () => {
      const filePath = path.join(BENCHMARK_DIR, fileName);
      const markdown = await fs.readFile(filePath, "utf-8");
      const entityName = fileName.replace(/\.md$/, "");

      const result = validateHarpyV3Markdown(markdown, { entityName });

      assert.strictEqual(
        result.valid,
        true,
        `La fiche ${fileName} doit être strictement valide v3: ${result.errors.join(", ")}`
      );
      assert.strictEqual(result.errors.length, 0);

      // Vérification des 5 blocs
      assert.ok(result.blocks.descriptionExterne, "Bloc 2 Description externe présent");
      assert.ok(result.blocks.descriptionExterne.length <= 100, "Description externe <= 100 car.");
      assert.ok(result.blocks.aideImprovisation, "Bloc 3 Aide improvisation présent");
      assert.ok(result.blocks.resumeMj, "Bloc 3 Résumé MJ présent");
      assert.ok(result.blocks.resumeMj.length >= 350, "Résumé MJ >= 350 car.");
      assert.ok(result.blocks.descriptionJoueurs, "Bloc 4 Description Joueurs présent");
      assert.ok(result.blocks.descriptionJoueurs.length >= 450, "Description Joueurs >= 450 car.");
      assert.ok(result.blocks.blocHarpy, "Bloc 5 Statblock Harpy présent");
      assert.ok(result.blocks.blocHarpy.includes("↳"), "Bloc 5 avec marqueurs ↳");
    });
  }

  // 2. Parsing Markdown -> Bundle .bypp et reconstruction .bypp -> Markdown
  test("2. Parsing Markdown -> Bundle .bypp et reconstruction .bypp -> Markdown", async () => {
    const filePath = path.join(BENCHMARK_DIR, "Sartorius.md");
    const rawMarkdown = await fs.readFile(filePath, "utf-8");

    // A. Parsing Markdown vers document AST et entité Obsidian
    const parsedNote = parseObsidianNote(rawMarkdown, "Sartorius");
    const docAst = parseMarkdown(rawMarkdown, { parseHeadingsAsChunksFallback: true });

    assert.strictEqual(parsedNote.name, "Sartorius");
    assert.ok(docAst.chunks.length >= 1, "Le document contient des chunks");

    // B. Transformation en Bundle .bypp v17
    const entityUid = "entity_sartorius_test";
    const chunks = parsedNote.chunks.map((c, idx) => ({
      uid: `chunk_${idx}`,
      type: "text" as const,
      headingMode: "outside" as const,
      content: c.content || c.text || "",
    }));

    const pages = [
      {
        uid: "page_main_sartorius",
        type: "standard" as const,
        name: "Description",
        chunksOrder: chunks.map((c) => c.uid),
      },
    ];

    const bundle: BeyondPaperBundle = {
      version: 17,
      format: "bypp",
      name: "Export Sartorius Test",
      bundleVersion: "1.0.0",
      exportedAt: new Date().toISOString(),
      attribution: { authorName: "Harpy Sync" },
      license: "ARR",
      licenseVersion: "4.0",
      entities: [
        {
          uid: entityUid,
          name: "Sartorius",
          displayName: "Sartorius",
          description: "Prêtre-forgeron d'Airain",
          type: "character",
          isArchived: false,
          pagesOrder: ["page_main_sartorius"],
          tagsUid: [],
          assetUids: [],
          data: {},
        },
      ],
      pages,
      chunks,
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

    // Validation via le parser BYPP
    const validatedBundle = parseBeyondPaperBundle(bundle);
    assert.strictEqual(validatedBundle.version, 17);
    assert.strictEqual(validatedBundle.format, "bypp");
    assert.strictEqual(validatedBundle.entities.length, 1);

    // C. Reconstruction .bypp -> Markdown AST -> Markdown string
    const reconstructedAst = {
      frontmatter: {
        displayName: bundle.entities[0].displayName,
        description: bundle.entities[0].description,
      },
      leadingContent: `# ${bundle.entities[0].name}\n`,
      chunks: bundle.chunks.map((c: any) => ({
        uid: c.uid,
        type: c.type,
        content: c.content,
      })),
      trailingContent: "",
      hasExplicitChunks: true,
    };

    const serializedMarkdown = serializeMarkdown(reconstructedAst as any);
    assert.ok(serializedMarkdown.includes("displayName: Sartorius"));
    assert.ok(serializedMarkdown.includes("# Sartorius"));
    assert.ok(serializedMarkdown.includes("<!-- harpy:chunk"));
  });

  // 3. Fusion 3-Way (MergeEngine) sans perte de données
  test("3. Fusion 3-Way (MergeEngine) sans perte de données", () => {
    const mergeEngine = new MergeEngine({ toleranceMs: 1000 });

    const baseChunks = [
      { uid: "chunk_bio", type: "text" as const, content: "Biographie originale", headingMode: "outside" as const },
      { uid: "chunk_lore", type: "text" as const, content: "Lore original", headingMode: "outside" as const },
    ];

    // Local modifie chunk_bio
    const localChunks = [
      { uid: "chunk_bio", type: "text" as const, content: "Biographie mise à jour localement", headingMode: "outside" as const },
      { uid: "chunk_lore", type: "text" as const, content: "Lore original", headingMode: "outside" as const },
    ];

    // Remote modifie chunk_lore
    const remoteChunks = [
      { uid: "chunk_bio", type: "text" as const, content: "Biographie originale", headingMode: "outside" as const },
      { uid: "chunk_lore", type: "text" as const, content: "Lore enrichi sur Harpy distant", headingMode: "outside" as const },
    ];

    const mergeResult = mergeEngine.mergeChunks(baseChunks, localChunks, remoteChunks);
    assert.strictEqual(mergeResult.hasConflicts, false, "La fusion de chunks disjoints ne doit générer aucun conflit");
    assert.strictEqual(mergeResult.chunks.length, 2);

    const mergedBio = mergeResult.chunks.find((c) => c.uid === "chunk_bio");
    const mergedLore = mergeResult.chunks.find((c) => c.uid === "chunk_lore");
    assert.ok(mergedBio && "content" in mergedBio);
    assert.strictEqual(mergedBio.content, "Biographie mise à jour localement");
    assert.ok(mergedLore && "content" in mergedLore);
    assert.strictEqual(mergedLore.content, "Lore enrichi sur Harpy distant");

    // Conflit direct sur le même chunk
    const conflictingRemoteChunks = [
      { uid: "chunk_bio", type: "text" as const, content: "Biographie modifiée sur Harpy en conflit", headingMode: "outside" as const },
      { uid: "chunk_lore", type: "text" as const, content: "Lore original", headingMode: "outside" as const },
    ];

    const conflictResult = mergeEngine.mergeChunks(baseChunks, localChunks, conflictingRemoteChunks);
    assert.strictEqual(conflictResult.hasConflicts, true, "Un conflit doit être détecté sur chunk_bio");
    assert.ok(conflictResult.conflictedChunkUids.includes("chunk_bio"));

    const conflictFormatted = formatConflictMarkers(
      localChunks[0].content,
      conflictingRemoteChunks[0].content,
      "OBSIDIAN",
      "HARPY"
    );
    assert.ok(conflictFormatted.includes("<<<<<<< OBSIDIAN"));
    assert.ok(conflictFormatted.includes("======="));
    assert.ok(conflictFormatted.includes(">>>>>>> HARPY"));
  });

  // 4. Flux End-to-End Note Obsidian Harpy v3 ➔ @harpy/core ➔ Payload Harpy.gg
  test("4. Flux End-to-End Note Obsidian Harpy v3 ➔ @harpy/core ➔ Payload Harpy.gg", async () => {
    const filePath = path.join(BENCHMARK_DIR, "Le Havre.md");
    const content = await fs.readFile(filePath, "utf-8");

    const parsed = parseObsidianNote(content, "Le Havre");
    assert.strictEqual(parsed.name, "Le Havre");

    // Simulation d'une entité distante sur Harpy.gg
    const remoteEntity = {
      uid: "harpy_le_havre_001",
      name: "Le Havre",
      folder: "Lieux",
      tags: ["ville", "port"],
      variables: { POPULATION: "50000" },
      content: "Ancien descriptif",
    };

    const diff = computeEntityDiff(parsed, remoteEntity);
    assert.ok(diff);

    // Construction du payload RPC Harpy.gg
    const updatePayload = {
      entityId: "harpy_le_havre_001",
      worldId: "asharde-world",
      name: parsed.name,
      folder: parsed.folder || "Lieux",
      tags: parsed.tags,
      variables: parsed.variables,
      content: parsed.cleanBody,
      pages: parsed.pages.map((p) => ({
        name: p.name,
        markdown: p.markdown || parsed.cleanBody,
      })),
    };

    assert.strictEqual(updatePayload.entityId, "harpy_le_havre_001");
    assert.strictEqual(updatePayload.name, "Le Havre");
    assert.ok(updatePayload.pages.length >= 1, "Pages transmises dans le payload Harpy");
    assert.ok(updatePayload.content.length > 0, "Contenu propre transmis dans le payload Harpy");
  });
});
