import { BeyondPaperSchema, migrate } from "bypp-format";
import { BeyondPaper, Entity, Page, Chunk, Tag, TagCategory, Asset, RandomTable, Variable, Sheet, DataTable } from "../types";

/**
 * Sanitizes a string for use as a file or directory name in the local filesystem.
 */
export function sanitizeFileName(name: string): string {
  if (!name) return "unnamed";
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

/**
 * Parses raw JSON contents of a campaign bundle, migrating it if necessary,
 * and validating it against the BeyondPaper Zod schema.
 */
export function parseBundle(raw: any): BeyondPaper {
  // Apply format migrations to handle old schemas gracefully
  const migrated = migrate(raw);
  // Parse and validate using Zod schema
  return BeyondPaperSchema.parse(migrated);
}

/**
 * Index class that organizes campaign bundle elements for fast lookups
 * and provides utility methods for folder structure and relationships.
 */
export class BundleIndex {
  bundle: BeyondPaper;
  entities = new Map<string, Entity>();
  pages = new Map<string, Page>();
  chunks = new Map<string, Chunk>();
  tags = new Map<string, Tag>();
  tagCategories = new Map<string, TagCategory>();
  assets = new Map<string, Asset>();
  randomTables = new Map<string, RandomTable>();
  variables = new Map<string, Variable>();
  sheets = new Map<string, Sheet>();
  dataTables = new Map<string, DataTable>();

  constructor(bundle: BeyondPaper) {
    this.bundle = bundle;
    this.buildIndex();
  }

  private buildIndex() {
    this.bundle.entities.forEach((e) => this.entities.set(e.uid, e));
    this.bundle.pages.forEach((p) => this.pages.set(p.uid, p));
    this.bundle.chunks.forEach((c) => this.chunks.set(c.uid, c));
    this.bundle.tags?.forEach((t) => this.tags.set(t.uid, t));
    this.bundle.tagCategories?.forEach((tc) => this.tagCategories.set(tc.uid, tc));
    this.bundle.assets?.forEach((a) => this.assets.set(a.uid, a));
    this.bundle.randomTables?.forEach((rt) => this.randomTables.set(rt.uid, rt));
    this.bundle.variables?.forEach((v) => this.variables.set(v.uid, v));
    this.bundle.sheets?.forEach((s) => this.sheets.set(s.uid, s));
    this.bundle.dataTables?.forEach((dt) => this.dataTables.set(dt.uid, dt));
  }

  /**
   * Returns the vault-relative folder path for a given entity based on its tags.
   * If a tag has `useAsFolder === true`, its name is used as the subdirectory name.
   */
  getEntityFolderPath(entity: Entity, importRoot: string): string {
    let subFolder = "";

    // Find the first tag that has useAsFolder === true
    if (entity.tagsUid) {
      for (const tagUid of entity.tagsUid) {
        const tag = this.tags.get(tagUid);
        if (tag && tag.useAsFolder) {
          subFolder = sanitizeFileName(tag.name);
          break;
        }
      }
    }

    if (subFolder) {
      return importRoot ? `${importRoot}/${subFolder}` : subFolder;
    }
    return importRoot;
  }

  /**
   * Resolves tag names for an entity
   */
  getEntityTagNames(entity: Entity): string[] {
    if (!entity.tagsUid) return [];
    return entity.tagsUid
      .map((uid) => this.tags.get(uid)?.name || "")
      .filter((name) => name !== "");
  }
}
