# Harpy Sync (Obsidian Plugin)

`harpy-sync` is an Obsidian plugin designed to import and export campaign notes, worldbuilding entries, and Tabletop RPG (TTRPG) data to and from the **[harpy.gg](https://harpy.gg)** virtual tabletop platform.

It relies on the open **`.bypp` (Beyond Paper)** format for importing and exporting complete offline bundles of TTRPG content.

## Features

- **Import `.bypp` bundles** into Obsidian as organized markdown files and folders.
- **Export Obsidian vaults/folders** into `.bypp` bundles to import them back into Harpy.
- Bidirectional migration and validation using `bypp-format` schemas.

## Technical Specifications

The plugin is built in TypeScript and uses the schema definitions provided by the official [`harpygg/bypp-format`](https://github.com/harpygg/bypp-format) library.

### Dependency

The parser and migrations are managed through the `bypp-format` dependency imported directly from GitHub:
```json
"bypp-format": "github:harpygg/bypp-format"
```

## Setup & Development

### Installation

Clone this repository into your Obsidian vault's plugin folder (usually under `<vault>/.obsidian/plugins/harpy-sync`).

Install development dependencies:
```bash
npm install
```

### Compilation

Build the plugin for development or production:
```bash
# Compile once
npm run build

# Watch for changes during development
npm run dev
```

Enable the plugin in Obsidian settings under **Community plugins**.

## Repository Structure

- `AGENTS.md` - AI assistant project guidelines and instructions.
- `.agents/` - Custom Agent Skills containing `.bypp` specs and reference files for AI development assistance.
- `manifest.json` - Obsidian plugin definition.
- `main.ts` - Entry point of the plugin.
- `tsconfig.json` - TypeScript compiler configurations.