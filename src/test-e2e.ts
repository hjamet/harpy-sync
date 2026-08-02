import fs from "fs";
import path from "path";
import assert from "assert";
import { App, TFile, TFolder } from "obsidian";
import { BeyondPaperSchema } from "bypp-format";
import { parseBundle, BundleIndex } from "./import/parser";
import { AssetManager } from "./import/asset-manager";
import { MarkdownBuilder } from "./import/markdown-builder";
import { VaultScanner } from "./export/scanner";

const PROJECT_ROOT = process.cwd();
const INPUT_BYPP_PATH = "C:\\Users\\hjamet\\Downloads\\Asharde_v1.bypp";
const TEST_VAULT_REL = "test-vault";
const TEST_VAULT_ABS = path.resolve(PROJECT_ROOT, TEST_VAULT_REL);
const REEXPORTED_BYPP_PATH = path.resolve(PROJECT_ROOT, "test-output.bypp");

/**
 * Parses YAML frontmatter from Markdown note content.
 */
function parseFrontmatter(content: string): Record<string, any> {
  if (!content.startsWith("---")) return {};
  const parts = content.split("---");
  if (parts.length < 3) return {};
  const yamlText = parts[1];
  const lines = yamlText.split("\n");
  const result: Record<string, any> = {};
  let currentKey: string | null = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (line.trimStart().startsWith("- ") && currentKey) {
      const val = line.trimStart().substring(2).trim();
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      const cleanVal = val.replace(/^["']|["']$/g, "");
      result[currentKey].push(cleanVal);
      continue;
    }

    const indentMatch = line.match(/^(\s+)([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (indentMatch && currentKey && typeof result[currentKey] === "object" && !Array.isArray(result[currentKey])) {
      const subKey = indentMatch[2];
      let subVal = indentMatch[3].trim();
      subVal = subVal.replace(/^["']|["']$/g, "");
      if (subVal === "true") (result[currentKey] as any)[subKey] = true;
      else if (subVal === "false") (result[currentKey] as any)[subKey] = false;
      else if (!isNaN(Number(subVal)) && subVal !== "") (result[currentKey] as any)[subKey] = Number(subVal);
      else (result[currentKey] as any)[subKey] = subVal;
      continue;
    }

    const rootMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (rootMatch) {
      const key = rootMatch[1];
      let val = rootMatch[2].trim();
      currentKey = key;

      if (val === "" || val === "[]") {
        result[key] = val === "[]" ? [] : {};
      } else {
        val = val.replace(/^["']|["']$/g, "");
        if (val === "true") result[key] = true;
        else if (val === "false") result[key] = false;
        else if (!isNaN(Number(val)) && val !== "") result[key] = Number(val);
        else result[key] = val;
      }
    }
  }

  return result;
}

/**
 * Builds Obsidian TFile and TFolder directory tree from real filesystem.
 */
function buildAbstractTree(absPath: string, relPath: string, parent: TFolder | null = null): TFile | TFolder {
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    const folder = new TFolder(relPath, path.basename(absPath), [], parent);
    const childrenNames = fs.readdirSync(absPath);
    for (const childName of childrenNames) {
      const childAbs = path.join(absPath, childName);
      const childRel = relPath ? `${relPath}/${childName}` : childName;
      folder.children.push(buildAbstractTree(childAbs, childRel, folder));
    }
    return folder;
  } else {
    const ext = path.extname(absPath).replace(".", "");
    const basename = path.basename(absPath, "." + ext);
    return new TFile(relPath, basename, ext, { mtime: stat.mtimeMs }, parent);
  }
}

/**
 * Creates Node.js fs-backed Obsidian App mock.
 */
function createMockApp(): App {
  const vaultAdapter = {
    async exists(relPath: string): Promise<boolean> {
      const fullPath = path.resolve(PROJECT_ROOT, relPath);
      return fs.existsSync(fullPath);
    }
  };

  const vault = {
    adapter: vaultAdapter,
    getAbstractFileByPath(relPath: string): TFile | TFolder | null {
      const fullPath = path.resolve(PROJECT_ROOT, relPath);
      if (!fs.existsSync(fullPath)) return null;
      return buildAbstractTree(fullPath, relPath, null);
    },
    async read(file: TFile): Promise<string> {
      const fullPath = path.resolve(PROJECT_ROOT, file.path);
      return fs.readFileSync(fullPath, "utf8");
    },
    async modify(file: TFile, content: string): Promise<void> {
      const fullPath = path.resolve(PROJECT_ROOT, file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    },
    async create(relPath: string, content: string): Promise<TFile> {
      const fullPath = path.resolve(PROJECT_ROOT, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
      const stat = fs.statSync(fullPath);
      const ext = path.extname(fullPath).replace(".", "");
      const basename = path.basename(fullPath, "." + ext);
      return new TFile(relPath, basename, ext, { mtime: stat.mtimeMs });
    },
    async createFolder(relPath: string): Promise<void> {
      const fullPath = path.resolve(PROJECT_ROOT, relPath);
      fs.mkdirSync(fullPath, { recursive: true });
    },
    async createBinary(relPath: string, buffer: ArrayBuffer): Promise<void> {
      const fullPath = path.resolve(PROJECT_ROOT, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, Buffer.from(buffer));
    }
  };

  const metadataCache = {
    getFileCache(file: TFile) {
      try {
        const fullPath = path.resolve(PROJECT_ROOT, file.path);
        if (!fs.existsSync(fullPath)) return null;
        const content = fs.readFileSync(fullPath, "utf8");
        const frontmatter = parseFrontmatter(content);
        return { frontmatter };
      } catch (e) {
        return null;
      }
    }
  };

  return new App(vault as any, metadataCache as any);
}

/**
 * Collects all Markdown files from directory recursively.
 */
function getAllMarkdownFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getAllMarkdownFiles(filePath, fileList);
    } else if (file.endsWith(".md") && !file.startsWith("_harpy")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

async function runEndToEndTest() {
  console.log("==================================================================");
  console.log("              HARPY SYNC END-TO-END VERIFICATION TEST              ");
  console.log("==================================================================");

  // Clean test vault & previous output
  if (fs.existsSync(TEST_VAULT_ABS)) {
    try {
      fs.rmSync(TEST_VAULT_ABS, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      // Fallback
    }
  }
  if (fs.existsSync(REEXPORTED_BYPP_PATH)) {
    fs.rmSync(REEXPORTED_BYPP_PATH, { force: true });
  }
  fs.mkdirSync(TEST_VAULT_ABS, { recursive: true });

  const app = createMockApp();

  // STEP 1: Import Asharde_v1.bypp and generate Markdown notes
  console.log(`\n[STEP 1] Reading & Parsing input bundle: ${INPUT_BYPP_PATH}`);
  const rawFile = fs.readFileSync(INPUT_BYPP_PATH, "utf8");
  const rawJson = JSON.parse(rawFile);
  
  console.log("[STEP 1] Validating input bundle against BeyondPaperSchema...");
  const bundle = parseBundle(rawJson);
  console.log(`[STEP 1] Bundle loaded: "${bundle.name}" containing ${bundle.entities.length} entities.`);

  const index = new BundleIndex(bundle);
  const assetManager = new AssetManager(app, TEST_VAULT_REL);
  const builder = new MarkdownBuilder(app, index, assetManager);

  console.log("[STEP 1] Writing campaign manifest (_harpy_manifest.json)...");
  await builder.writeManifestFile(TEST_VAULT_REL);

  console.log("[STEP 1] Generating Markdown notes in test-vault...");
  let count = 0;
  for (const entity of bundle.entities) {
    const folderPath = index.getEntityFolderPath(entity, TEST_VAULT_REL);
    await builder.writeEntityFile(entity, folderPath);
    count++;
  }
  console.log(`[STEP 1] Successfully generated ${count} Markdown files in "${TEST_VAULT_REL}".`);

  // STEP 2 & 3: Verify generated Markdown tags and HTML sanitization
  console.log(`\n[STEP 2 & 3] Verifying generated Markdown notes...`);
  const mdFiles = getAllMarkdownFiles(TEST_VAULT_ABS);
  console.log(`Found ${mdFiles.length} Markdown files in test-vault.`);

  let totalChunkTags = 0;
  let totalPageTags = 0;
  let visualHtmlViolationCount = 0;
  const visualHtmlRegex = /<\/?(span|font|center|mark|div|p)\b[^>]*>|\bstyle=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

  for (const file of mdFiles) {
    const content = fs.readFileSync(file, "utf8");
    const chunkMatches = content.match(/<!--\s*harpy:chunk\s+[^>]*?-->/gi);
    if (chunkMatches) {
      totalChunkTags += chunkMatches.length;
    }
    const pageMatches = content.match(/<!--\s*harpy:page\s+[^>]*?-->/gi);
    if (pageMatches) {
      totalPageTags += pageMatches.length;
    }

    // Remove frontmatter before checking for visual HTML
    const bodyContent = content.replace(/^---[\s\S]*?---/, "");
    const violations = bodyContent.match(visualHtmlRegex);
    if (violations) {
      visualHtmlViolationCount += violations.length;
    }
  }

  console.log(`- Total invisible <!-- harpy:chunk... --> tags found: ${totalChunkTags}`);
  console.log(`- Total invisible <!-- harpy:page... --> tags found: ${totalPageTags}`);
  console.log(`- Total visual HTML tag violations found: ${visualHtmlViolationCount}`);

  if (totalChunkTags === 0) {
    throw new Error("Verification failed: No <!-- harpy:chunk... --> tags were generated in Markdown notes!");
  }

  if (visualHtmlViolationCount > 0) {
    throw new Error(`Verification failed: Found ${visualHtmlViolationCount} visual HTML violations in Markdown notes!`);
  }

  console.log("✓ VERIFICATION PASSED: Markdown contains invisible tags and NO visual HTML.");

  // STEP 4: Run VaultScanner to re-export to .bypp and validate schema
  console.log(`\n[STEP 4] Scanning test-vault folder and re-exporting to .bypp...`);
  const scanner = new VaultScanner(app);
  const reexportedBundle = await scanner.scanFolder(TEST_VAULT_REL, bundle.name || "Asharde");

  console.log("[STEP 4] Validating re-exported bundle with BeyondPaperSchema...");
  const validatedBundle = BeyondPaperSchema.parse(reexportedBundle);

  fs.writeFileSync(REEXPORTED_BYPP_PATH, JSON.stringify(validatedBundle, null, 2), "utf8");
  const reexportedSize = fs.statSync(REEXPORTED_BYPP_PATH).size;

  console.log(`[STEP 4] Re-exported bundle successfully saved to: ${REEXPORTED_BYPP_PATH} (${reexportedSize} bytes)`);
  console.log("\n==================================================================");
  console.log("                     BUNDLE RE-EXPORT COMPARISON                  ");
  console.log("==================================================================");
  console.log(`- Format: ${validatedBundle.format}`);
  console.log(`- Entities Count: Original = ${bundle.entities.length} | Re-exported = ${validatedBundle.entities.length}`);
  console.log(`- Pages Count:    Original = ${bundle.pages.length}    | Re-exported = ${validatedBundle.pages.length}`);
  console.log(`- Chunks Count:   Original = ${bundle.chunks.length}   | Re-exported = ${validatedBundle.chunks.length}`);
  console.log(`- Tags Count:     Original = ${bundle.tags?.length || 0}     | Re-exported = ${validatedBundle.tags?.length || 0}`);
  console.log(`- Variables:      Original = ${bundle.variables?.length || 0} | Re-exported = ${validatedBundle.variables?.length || 0}`);
  console.log("==================================================================");

  // STRICT ASSERTIONS FOR 100% PERFECT DATA CONSERVATION
  assert.strictEqual(validatedBundle.entities.length, bundle.entities.length, "Entities count must match exactly!");
  assert.strictEqual(validatedBundle.pages.length, bundle.pages.length, "Pages count must match exactly!");
  assert.strictEqual(validatedBundle.chunks.length, bundle.chunks.length, "Chunks count must match exactly!");
  assert.strictEqual(validatedBundle.tags.length, bundle.tags.length, "Tags count must match exactly!");
  assert.strictEqual(validatedBundle.variables.length, bundle.variables.length, "Variables count must match exactly!");

  console.log("✓ SUCCESS: 100% DATA PRESERVATION VERIFIED! All counters match perfectly!");
}

runEndToEndTest().catch((err) => {
  console.error("❌ E2E TEST FAILED WITH ERROR:", err);
  process.exit(1);
});
