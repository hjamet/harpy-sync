import { z } from "zod";
import {
  BeyondPaperSchema,
  EntitySchema,
  PageSchema,
  ChunkSchema,
  RandomTableSchema,
  TagSchema,
  TagCategorySchema,
  AssetSchema,
  VariableSchema,
  SheetSchema,
  DataTableSchema,
  SceneSchema,
  SceneMapSchema,
  SceneBackgroundSchema
} from "bypp-format";

// Infer type definitions from bypp-format schemas
export type BeyondPaper = z.infer<typeof BeyondPaperSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Page = z.infer<typeof PageSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type RandomTable = z.infer<typeof RandomTableSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type TagCategory = z.infer<typeof TagCategorySchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Variable = z.infer<typeof VariableSchema>;
export type Sheet = z.infer<typeof SheetSchema>;
export type DataTable = z.infer<typeof DataTableSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneMap = z.infer<typeof SceneMapSchema>;
export type SceneBackground = z.infer<typeof SceneBackgroundSchema>;

export interface ImportOptions {
  vaultRoot: string; // The root directory in the vault where files will be imported
  overwriteBehavior: "overwrite" | "merge-keep-both";
}

export interface ImportProgress {
  totalEntities: number;
  processedEntities: number;
  totalAssets: number;
  downloadedAssets: number;
  currentTask: string;
}
