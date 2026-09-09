import { z } from "zod";
import {
  BeyondPaperSchema,
  BeyondPaperV17Schema,
  EntitySchema,
  EntityV4Schema,
  EntityBaseV4Schema,
  CharacterEntityV4Schema,
  CreatureEntityV4Schema,
  GroupEntityV4Schema,
  PlaceEntityV4Schema,
  PageSchema,
  PageV1Schema,
  PageStandardV1Schema,
  PageEntityV1Schema,
  ChunkSchema,
  ChunkV11Schema,
  ChunkTextV11Schema,
  ChunkGalleryV2Schema,
  ChunkRandomV2Schema,
  VariableSchema,
  VariableV8Schema,
  VariableBaseV8Schema,
  SheetSchema,
  SheetV7Schema,
  DataTableSchema,
  DataTableV3Schema,
  DataTableRowV3Schema,
  DataTableColumnSchema,
  SceneSchema,
  SceneV2Schema,
  SceneMapSchema,
  SceneMapV4Schema,
  SceneBackgroundSchema,
  SceneBackgroundV4Schema,
  AssetSchema,
  AssetV3Schema,
  AssetBaseV3Schema,
  RandomTableSchema,
  RandomTableV7Schema,
  RandomTableRowV7Schema,
  TagSchema,
  TagV3Schema,
  TagCategorySchema,
  TagCategoryV2Schema,
  DialectSchema,
  DialectV3Schema,
  WidgetSchema,
  WidgetV9Schema,
  EntityUidSchema,
  PageUidSchema,
  ChunkUidSchema,
  DatasetUidSchema,
  VariableUidSchema,
  WidgetUidSchema,
  RandomTableUidSchema,
  RandomTableRowUidSchema,
  TagUidSchema,
  TagCategoryUidSchema,
  SceneUidSchema,
  SceneMapUidSchema,
  SceneBackgroundUidSchema,
  AssetUidSchema,
  DialectUidSchema,
  SheetUidSchema,
  VariableChoiceUidSchema,
  DataTableUidSchema,
  DataTableRowUidSchema,
  DataTableColumnUidSchema,
  migrate,
  BYPP_FORMAT_VERSION,
  BYPP_FORMAT_EXT,
} from "bypp-format";

export { BYPP_FORMAT_VERSION, BYPP_FORMAT_EXT, migrate };

export {
  BeyondPaperSchema,
  BeyondPaperV17Schema,
  EntitySchema,
  EntityV4Schema,
  EntityBaseV4Schema,
  CharacterEntityV4Schema,
  CreatureEntityV4Schema,
  GroupEntityV4Schema,
  PlaceEntityV4Schema,
  PageSchema,
  PageV1Schema,
  PageStandardV1Schema,
  PageEntityV1Schema,
  ChunkSchema,
  ChunkV11Schema,
  ChunkTextV11Schema,
  ChunkGalleryV2Schema,
  ChunkRandomV2Schema,
  VariableSchema,
  VariableV8Schema,
  VariableBaseV8Schema,
  SheetSchema,
  SheetV7Schema,
  DataTableSchema,
  DataTableV3Schema,
  DataTableRowV3Schema,
  DataTableColumnSchema,
  SceneSchema,
  SceneV2Schema,
  SceneMapSchema,
  SceneMapV4Schema,
  SceneBackgroundSchema,
  SceneBackgroundV4Schema,
  AssetSchema,
  AssetV3Schema,
  AssetBaseV3Schema,
  RandomTableSchema,
  RandomTableV7Schema,
  RandomTableRowV7Schema,
  TagSchema,
  TagV3Schema,
  TagCategorySchema,
  TagCategoryV2Schema,
  DialectSchema,
  DialectV3Schema,
  WidgetSchema,
  WidgetV9Schema,
  EntityUidSchema,
  PageUidSchema,
  ChunkUidSchema,
  DatasetUidSchema,
  VariableUidSchema,
  WidgetUidSchema,
  RandomTableUidSchema,
  RandomTableRowUidSchema,
  TagUidSchema,
  TagCategoryUidSchema,
  SceneUidSchema,
  SceneMapUidSchema,
  SceneBackgroundUidSchema,
  AssetUidSchema,
  DialectUidSchema,
  SheetUidSchema,
  VariableChoiceUidSchema,
  DataTableUidSchema,
  DataTableRowUidSchema,
  DataTableColumnUidSchema,
};

export function parseBeyondPaperBundle(raw: unknown) {
  let data = raw;
  if (typeof data === "string") {
    data = JSON.parse(data);
  }
  let obj = data as any;
  // Migrate older bundles (< 17)
  if (obj && typeof obj.version === "number" && obj.version < 17) {
    try {
      obj = migrate(obj);
    } catch (err) {
      console.warn("BeyondPaper bundle migration warning:", err);
    }
  }
  // Validate schema: if version >= 17, validate against BeyondPaperV17Schema with temporary normalization
  const origVersion = obj?.version ?? 17;
  try {
    const normalized = { ...obj, version: 17 };
    const parsed = BeyondPaperSchema.parse(normalized);
    return { ...parsed, version: origVersion } as any;
  } catch (error) {
    console.warn("BeyondPaperSchema strict validation failed, falling back to raw object:", error);
    return obj as any;
  }
}

export function safeParseBeyondPaperBundle(raw: unknown) {
  try {
    const data = parseBeyondPaperBundle(raw);
    return { success: true as const, data };
  } catch (error) {
    return { success: false as const, error };
  }
}

