---
name: bypp-spec
description: Specification and validation guidelines for the .bypp (Beyond Paper) RPG campaign bundle format.
---

# Skill: Beyond Paper (.bypp) Format Specification

This skill equips you with the documentation and parsing/validation patterns for the `.bypp` file format.

## Overview of .bypp Format

A `.bypp` file is a JSON bundle carrying an entire world's worth of Tabletop RPG content (entities, pages, scenes, variables, random tables, data-tables, sheets, etc.) allowing VTT and reader applications to render it offline.

## Core API Usage (TypeScript)

When generating or reading `.bypp` content, use the official `bypp-format` schemas:

### Validation
```ts
import { BeyondPaperSchema } from "bypp-format";

// Validates and parses a raw bundle against the current schema version
const bundle = BeyondPaperSchema.parse(JSON.parse(fileContent));
```

### Migration
```ts
import { BeyondPaperSchema, migrate } from "bypp-format";

// Upgrades older formats (walks migrations forward) and parses them
const upgradedBundle = BeyondPaperSchema.parse(migrate(JSON.parse(fileContent)));
```

### Version Downgrade (Compatibility)
```ts
import { BeyondPaperV1Schema, BeyondPaperV2Schema, migrate } from "bypp-format";

// Downgrades a V2 bundle to V1 (stripping features like sheets or dataTables that didn't exist in V1)
const v1Bundle = BeyondPaperV1Schema.parse(migrate(currentBundle, 1));
```

## References
Consult the local specification file under `references/README.md` for a deeper breakdown of the versioning model, schemas structure, and models (entities, sheets, dataTables).
