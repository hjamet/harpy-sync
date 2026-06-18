# AI Assistant Rules & Project Context (AGENTS.md)

You are Antigravity, an AI assistant helping to build the **Harpy Sync** Obsidian plugin.
This file defines the project context, technical rules, and constraints that you MUST follow at all times.

---

## 1. Project Goal

Build an Obsidian plugin (`harpy-sync`) that allows users to import and export world-building notes and VTT data from/to the **harpy.gg** platform using the open **`.bypp` (Beyond Paper)** format.

---

## 2. Technical Stack & Constraints

- **Language & Documentation:** All source code, comments, documentation, UI text, and Git commit messages **MUST** be written in **English**.
- **Package Management:** Use `npm` (or `pnpm` if detected).
- **Core Dependency:** The `.bypp` format parser is imported directly from GitHub: `"bypp-format": "github:harpygg/bypp-format"`.
- **Target Platform:** Obsidian desktop (and potentially mobile if compatible).
- **Obsidian APIs:** Follow official Obsidian developer documentation and best practices (proper event registration, workspace management, and settings).

---

## 3. Git & Commits Strategy (Atomic Commits)

- **Atomic Commits:** Commit your work immediately after completing a single task or verifying a specific change.
- **Commit Messages:** Clear, concise, and action-oriented (e.g., `feat: add settings tab`, `chore: init package.json`).
- **Pushing:** Do not push on every commit. Only push when a major feature or bugfix has been fully implemented, tested, and validated.

---

## 4. Agent Execution Flow

- Focus exclusively on a single task at a time.
- If you need to research or run background operations while working, you can delegate tasks to subagents.
- Always refer to the custom Agent Skill (`bypp-spec`) located in `.agents/skills/bypp-spec/` for detailed format specifications and validation rules of the `.bypp` format.
