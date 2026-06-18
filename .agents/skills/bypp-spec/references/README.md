# bypp-format Specification

Open schema for tabletop RPG content bundles — the `.bypp` file format.

A `.bypp` file is a JSON document validated by zod. It carries an entire world's worth of content (entities, pages, chunks, scenes, tags, sheets, data-tables, random tables…) so any reader app can render it offline without round-trips to a backend.

This package ships the schemas, the format version, and the migration runtime.

## Install

Not published on npm. Add directly from GitHub:

```json
{
  "dependencies": {
    "bypp-format": "github:harpygg/bypp-format",
    "zod": "^3.22.0"
  }
}
```

The built artifacts (`dist/`) are committed to the repo, so `pnpm install` / `npm install` picks them up without a build step. After pushing changes to `main`, consumers can pull the new version with:

```bash
npm update bypp-format
```

## Validate a bundle

```ts
import { BeyondPaperSchema } from "bypp-format";

const bundle = BeyondPaperSchema.parse(JSON.parse(fileContent));
// `bundle` is fully typed against the current format version.
```

`BeyondPaperSchema` always points to the **current** shipped version. If you need a specific historical version, import its versioned schema directly.

## Migrate a bundle

```ts
import { BeyondPaperSchema, migrate } from "bypp-format";

// Reads `raw.version`, walks the migration chain forward, validates each
// intermediate step against its target version's schema, and returns the
// migrated payload typed as `unknown` (zod-parse at the end to recover types).
const bundle = BeyondPaperSchema.parse(migrate(JSON.parse(fileContent)));
```

`migrate(raw, targetVersion?)` is **bidirectional**:

- **Upgrade** (default): `targetVersion` defaults to `BYPP_FORMAT_VERSION`. The chain walks forward via `MIGRATIONS[N]` (non-lossy by construction).
- **Downgrade** (explicit `targetVersion < source`): the chain walks backward via `DOWN_MIGRATIONS[N]`. **Lossy** — features that didn't exist in the older version are stripped. Producers use this to emit older formats for compatibility with readers stuck on earlier `bypp-format` versions.

```ts
import {
  BeyondPaperV1Schema,
  BeyondPaperV2Schema,
  migrate,
} from "bypp-format";

// Producer wants to share a bundle with a v1-only reader → downgrade.
const v2Bundle = BeyondPaperV2Schema.parse(currentBundle);
const v1Bundle = BeyondPaperV1Schema.parse(migrate(v2Bundle, 1));
// v1Bundle has no `sheets[]`, no `dataTables[]`, no `dataTableRef` variables.
```

It throws if:
- the input isn't an object or lacks a numeric `version` field,
- the input claims a version but doesn't conform to that version's schema,
- a step is missing (no `MIGRATIONS[N]` going up, or no `DOWN_MIGRATIONS[N]` going down),
- a migrator produces an invalid intermediate shape,
- a migrator forgets to set `version` correctly on its output.

## Versioning model

The format evolves over time. Old bundles stay valid forever — the runtime knows how to read them, migrate them forward, and validate them at every step.

### Per-version manifests

Each shipped bypp version has a **frozen** top-level manifest:

```
src/schemas/
  bypp.v1.schema.ts   # BeyondPaperV1Schema, BeyondPaperV1
  bypp.v2.schema.ts   # BeyondPaperV2Schema, BeyondPaperV2
  bypp.v3.schema.ts   # (future)
```

Each manifest is a `z.object({ … })` that lists which sub-schemas a bundle of that version is composed of:

```ts
// schemas/bypp.v1.schema.ts
export const BeyondPaperV1Schema = z.object({
  version: z.literal(1),
  format: z.literal("bypp"),
  variables: z.array(VariableV1Schema),   // v1 variable (no dataTableRef)
  entities: z.array(EntityV1Schema),       // shape unchanged since v1
});
```

```ts
// schemas/bypp.v2.schema.ts
export const BeyondPaperV2Schema = z.object({
  version: z.literal(2),
  format: z.literal("bypp"),
  variables: z.array(VariableV2Schema),    // v2 variable (adds dataTableRef/Lookup)
  entities: z.array(EntityV1Schema),       // still v1 shape
  sheets: z.array(SheetV2Schema),          // introduced in v2
  dataTables: z.array(DataTableV2Schema),  // introduced in v2
});
```

**Once shipped, a manifest is immutable.** It documents what a bundle of that version looks like, byte for byte.

### Naming convention

**Every file under `models/` and `mixins/` carries an explicit version suffix.** There is no un-versioned current file — the current shape is whichever versioned file the current manifest references.

```
models/entity.v1.schema.ts    # frozen entity shape introduced in v1, still current
models/widget.v1.schema.ts    # frozen widget shape introduced in v1, still current
models/variable.v1.schema.ts  # frozen variable shape from v1 (used by bypp.v1)
models/variable.v2.schema.ts  # variable shape introduced in v2 (used by bypp.v2)
models/sheet.v2.schema.ts     # sheet (introduced in v2, still current)
models/data-table.v2.schema.ts
```

The version suffix is **the bypp version in which this shape was first introduced or last forked**. There is exactly one coordinate system across the whole repo: every version number is a bypp version, never a per-model counter.

- **A brand-new model added in bypp vN** gets the suffix `vN`, even though it's "version 1" of that model in some abstract sense. Example: `sheet` was introduced in bypp v2 → `sheet.v2.schema.ts`.
- **A model modified in bypp vN** forks the file, increments the suffix to `vN` in the new file, and leaves the old file untouched (used by historical manifests).
