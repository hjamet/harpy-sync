import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { validateHarpyV3Markdown, parseObsidianNote } from "../index.js";

const BENCHMARK_DIR =
  "C:\\Users\\Jamet\\.gemini\\antigravity\\brain\\d687d02e-d16a-4b46-9e3f-bff760bf1ba6\\entites_harpy_v3";

describe("Benchmark Entities Harpy v3 Validation & Parsing", () => {
  const benchmarkFiles = ["Gael de Barne.md", "Le Havre.md", "Sartorius.md"];

  for (const fileName of benchmarkFiles) {
    test(`Valide strictement la fiche étalon ${fileName}`, async () => {
      const filePath = path.join(BENCHMARK_DIR, fileName);
      const markdown = await fs.readFile(filePath, "utf-8");
      const entityName = fileName.replace(/\.md$/, "");

      const result = validateHarpyV3Markdown(markdown, { entityName });

      assert.strictEqual(
        result.valid,
        true,
        `La fiche ${fileName} doit être strictement valide. Erreurs: ${result.errors.join(", ")}`
      );
      assert.ok(result.blocks.descriptionExterne, "Bloc 2 Description externe présent");
      assert.ok(
        result.blocks.descriptionExterne.length <= 100,
        "Description externe <= 100 car."
      );
      assert.ok(result.blocks.aideImprovisation, "Aide improvisation présente");
      assert.ok(result.blocks.resumeMj, "Résumé fond MJ présent");
      assert.ok(
        result.blocks.resumeMj.length >= 350,
        "Résumé fond MJ >= 350 car."
      );
      assert.ok(result.blocks.descriptionJoueurs, "Bloc 4 Description joueurs présent");
      assert.ok(
        result.blocks.descriptionJoueurs.length >= 450,
        "Description joueurs >= 450 car."
      );
      assert.ok(result.blocks.blocHarpy, "Bloc 5 Statblock Harpy présent");
      assert.ok(
        result.blocks.blocHarpy.includes("↳"),
        "Bloc 5 contient les marqueurs ↳ canoniques"
      );
    });

    test(`Parse et extrait les pages et chunks de ${fileName}`, async () => {
      const filePath = path.join(BENCHMARK_DIR, fileName);
      const markdown = await fs.readFile(filePath, "utf-8");
      const entityName = fileName.replace(/\.md$/, "");

      const parsed = parseObsidianNote(markdown, entityName);

      assert.ok(
        parsed.name === entityName || parsed.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === entityName,
        `Le nom de l'entité '${parsed.name}' doit correspondre à '${entityName}'`
      );
      assert.ok(parsed.pages.length >= 1, "Doit comporter au moins 1 page");
      assert.ok(parsed.chunks.length >= 1, "Doit comporter des chunks de texte");
    });
  }
});
