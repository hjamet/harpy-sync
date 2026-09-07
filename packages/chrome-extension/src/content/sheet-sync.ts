/**
 * Sheet Sync: In-Browser Automation for Pathfinder 1e Character Sheet Variables in Harpy.gg
 * Maps and fills numerical variables (PV Max, PV Actuels, CA, For, Dex, Con, Int, Sag, Cha)
 * and text fields (Attaques, Dégâts, Notes) in Harpy's character sheet drawer/tab.
 */

import { DomAutomation } from "./dom-automation";
import { MainWorldBridgeClient } from "./bridge-client";

export interface PathfinderSheetVariables {
  // Numerical stats
  pv_max?: number | string;
  pv_actuels?: number | string;
  ca?: number | string;
  for?: number | string;
  dex?: number | string;
  con?: number | string;
  int?: number | string;
  sag?: number | string;
  cha?: number | string;

  // Text / Combat stats
  attaques?: string;
  degats?: string;

  // Additional / Custom variables
  [key: string]: any;
}

export interface SheetSyncOptions {
  variables: Record<string, any>;
  system?: "pathfinder1e" | "dnd5e" | "custom";
  timeoutMs?: number;
}

export interface SheetSyncResult {
  success: boolean;
  updatedVariables: Record<string, any>;
  unmappedVariables: Record<string, any>;
  error?: string;
}

interface StatDefinition {
  canonicalKey: string;
  aliases: string[];
  labels: string[];
  isNumeric: boolean;
}

const PATHFINDER_1E_STATS: StatDefinition[] = [
  {
    canonicalKey: "pv_max",
    aliases: ["pv_max", "pv max", "pvmax", "hp_max", "hp max", "hpmax", "max_hp", "max hp", "hit_points_max", "points_de_vie_max"],
    labels: ["PV Max", "PV MAX", "HP Max", "Max HP", "PV Total", "Points de Vie Max"],
    isNumeric: true,
  },
  {
    canonicalKey: "pv_actuels",
    aliases: ["pv_actuels", "pv actuels", "pvactuels", "pv", "hp", "current_hp", "currenthp", "points_de_vie", "points de vie"],
    labels: ["PV", "PV Actuels", "HP", "Current HP", "Points de Vie"],
    isNumeric: true,
  },
  {
    canonicalKey: "ca",
    aliases: ["ca", "ac", "classe_armure", "classe d'armure", "armor_class", "armor class"],
    labels: ["CA", "AC", "Classe d'Armure", "Armor Class"],
    isNumeric: true,
  },
  {
    canonicalKey: "for",
    aliases: ["for", "str", "force", "strength"],
    labels: ["FOR", "STR", "Force", "Strength"],
    isNumeric: true,
  },
  {
    canonicalKey: "dex",
    aliases: ["dex", "dexterite", "dexterité", "dexterity"],
    labels: ["DEX", "Dextérité", "Dexterity"],
    isNumeric: true,
  },
  {
    canonicalKey: "con",
    aliases: ["con", "constitution"],
    labels: ["CON", "Constitution"],
    isNumeric: true,
  },
  {
    canonicalKey: "int",
    aliases: ["int", "intelligence"],
    labels: ["INT", "Intelligence"],
    isNumeric: true,
  },
  {
    canonicalKey: "sag",
    aliases: ["sag", "wis", "sagesse", "wisdom"],
    labels: ["SAG", "WIS", "Sagesse", "Wisdom"],
    isNumeric: true,
  },
  {
    canonicalKey: "cha",
    aliases: ["cha", "charisme", "charisma"],
    labels: ["CHA", "Charisme", "Charisma"],
    isNumeric: true,
  },
  {
    canonicalKey: "attaques",
    aliases: ["attaques", "attacks", "attaque", "attack", "melee", "ranged", "cac", "tir", "armes", "arme"],
    labels: ["Attaques", "Attacks", "Attaque", "Armes", "Arme", "Corps-à-corps", "Distance"],
    isNumeric: false,
  },
  {
    canonicalKey: "degats",
    aliases: ["degats", "dégâts", "damage", "dmg", "degat", "dégât"],
    labels: ["Dégâts", "Degats", "Damage", "Dmg"],
    isNumeric: false,
  },
];

export class SheetSync {
  /**
   * Synchronizes Pathfinder 1e sheet variables into Harpy's character sheet drawer/view.
   */
  public static async syncSheet(options: SheetSyncOptions): Promise<SheetSyncResult> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const rawVariables = options.variables || {};
    const updatedVariables: Record<string, any> = {};
    const unmappedVariables: Record<string, any> = {};

    try {
      console.log(`🦅 [SheetSync] Starting character sheet sync for ${Object.keys(rawVariables).length} variables...`);

      // 1. Ensure Character Sheet Drawer or Tab is open
      await this.ensureSheetDrawerOpen(timeoutMs);

      // 2. Normalize and map variables to canonical Pathfinder definitions
      const normalizedMap = this.normalizeVariableInputs(rawVariables);

      // 3. Populate each mapped variable into the sheet DOM
      for (const [canonicalKey, value] of Object.entries(normalizedMap)) {
        const statDef = PATHFINDER_1E_STATS.find((s) => s.canonicalKey === canonicalKey);
        const success = await this.fillSheetField(statDef || { canonicalKey, aliases: [canonicalKey], labels: [canonicalKey], isNumeric: typeof value === "number" }, value);

        if (success) {
          updatedVariables[canonicalKey] = value;
          console.log(`🦅 [SheetSync] Set '${canonicalKey}' = ${JSON.stringify(value)}`);
        } else {
          unmappedVariables[canonicalKey] = value;
          console.warn(`🦅 [SheetSync] Could not locate input field for '${canonicalKey}'`);
        }
      }

      // Also process any custom unmapped variables
      for (const [k, v] of Object.entries(rawVariables)) {
        const isStandard = PATHFINDER_1E_STATS.some((s) => s.aliases.includes(k.toLowerCase().trim()));
        if (!isStandard && !updatedVariables[k]) {
          const success = await this.fillGenericField(k, v);
          if (success) {
            updatedVariables[k] = v;
          } else {
            unmappedVariables[k] = v;
          }
        }
      }

      // 4. Trigger Angular Change Detection across sheet components
      await MainWorldBridgeClient.triggerChangeDetection("h-sheet-drawer, h-character-sheet, .character-sheet");

      // 5. Attempt Save if an explicit save button is present
      await this.saveSheetIfPresent();

      console.log(`🦅 [SheetSync] Sheet sync completed. Updated: ${Object.keys(updatedVariables).length}, Unmapped: ${Object.keys(unmappedVariables).length}`);

      return {
        success: true,
        updatedVariables,
        unmappedVariables,
      };
    } catch (err: any) {
      console.error("🦅 [SheetSync] Sheet sync error:", err);
      return {
        success: false,
        updatedVariables,
        unmappedVariables,
        error: err.message || String(err),
      };
    }
  }

  /**
   * Ensures the Sheet drawer or tab is open and visible.
   */
  private static async ensureSheetDrawerOpen(timeoutMs: number): Promise<void> {
    const existingSheet = document.querySelector(
      'h-sheet-drawer, h-character-sheet, sl-drawer[label*="Fiche"], .character-sheet, .sheet-container'
    );
    if (existingSheet && window.getComputedStyle(existingSheet).display !== "none") {
      return;
    }

    // Look for button to open Sheet drawer/tab
    const sheetButtonSelector =
      'button[aria-label="Fiche"], button[aria-label="Sheet"], button[aria-label*="Fiche"], button[role="tab"][aria-label*="Fiche"], [data-tab="sheet"]';

    let sheetBtn = document.querySelector<HTMLElement>(sheetButtonSelector);
    if (!sheetBtn) {
      const allButtons = Array.from(document.querySelectorAll<HTMLElement>("button, sl-button, [role='tab']"));
      for (const b of allButtons) {
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        const text = (b.innerText || b.textContent || "").toLowerCase();
        if (aria.includes("fiche") || text.includes("fiche") || aria.includes("sheet") || text.includes("feuille")) {
          sheetBtn = b;
          break;
        }
      }
    }

    if (sheetBtn) {
      console.log("🦅 [SheetSync] Opening character sheet drawer/tab...");
      await DomAutomation.click(sheetBtn, { highlight: true });
      await this.sleep(350);
    }
  }

  /**
   * Maps input raw variables to canonical keys based on aliases.
   */
  private static normalizeVariableInputs(raw: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(raw)) {
      const cleanKey = key.toLowerCase().trim();
      let matchedCanonical: string | null = null;

      for (const stat of PATHFINDER_1E_STATS) {
        if (stat.aliases.includes(cleanKey) || stat.canonicalKey === cleanKey) {
          matchedCanonical = stat.canonicalKey;
          break;
        }
      }

      if (matchedCanonical) {
        result[matchedCanonical] = value;
      }
    }

    return result;
  }

  /**
   * Fills a specific Pathfinder stat field in the DOM.
   */
  private static async fillSheetField(stat: StatDefinition, value: any): Promise<boolean> {
    const strValue = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);

    // Strategy 1: Data Attributes & ID Matches
    for (const alias of stat.aliases) {
      const selectors = [
        `[data-var-name="${alias}"] input`,
        `[data-var-name="${alias}"]`,
        `[data-variable="${alias}"]`,
        `[data-stat="${alias}"]`,
        `input[name="${alias}"]`,
        `sl-input[name="${alias}"]`,
        `#var_${alias}`,
        `#stat_${alias}`,
      ];

      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          await this.setElementValue(el, strValue);
          return true;
        }
      }
    }

    // Strategy 2: Label & Text Proximity Search
    for (const labelText of stat.labels) {
      const el = this.findInputNearLabel(labelText);
      if (el) {
        await this.setElementValue(el, strValue);
        return true;
      }
    }

    // Strategy 3: Main World Bridge Control Setter
    for (const alias of stat.aliases) {
      try {
        const bridgeRes = await MainWorldBridgeClient.call<{ success: boolean }>(
          "SET_CONTROL_VALUE",
          { selector: `[formcontrolname="${alias}"], [name="${alias}"]`, value },
          1000
        );
        if (bridgeRes && bridgeRes.success) {
          return true;
        }
      } catch {
        // continue
      }
    }

    return false;
  }

  /**
   * Fills a generic custom variable in the sheet.
   */
  private static async fillGenericField(name: string, value: any): Promise<boolean> {
    const strValue = String(value);
    const cleanName = name.toLowerCase().trim();

    // Try direct attribute selector
    const directSel = `[data-var-name="${cleanName}"], input[name="${cleanName}"], sl-input[name="${cleanName}"]`;
    const el = document.querySelector<HTMLElement>(directSel);
    if (el) {
      await this.setElementValue(el, strValue);
      return true;
    }

    // Try label match
    const nearLabel = this.findInputNearLabel(name);
    if (nearLabel) {
      await this.setElementValue(nearLabel, strValue);
      return true;
    }

    return false;
  }

  /**
   * Locates an input or textarea element near a label text.
   */
  private static findInputNearLabel(labelText: string): HTMLElement | null {
    const target = labelText.trim().toLowerCase();
    const sheetRoot = document.querySelector("h-sheet-drawer, h-character-sheet, sl-drawer, .character-sheet") || document.body;

    const labelElements = Array.from(
      sheetRoot.querySelectorAll<HTMLElement>("label, span, th, td, .stat-name, .field-label, div.label")
    );

    for (const lbl of labelElements) {
      const text = (lbl.innerText || lbl.textContent || "").trim().toLowerCase();
      if (text === target || (text.startsWith(target) && text.length <= target.length + 3)) {
        // Look for input in parent container or next sibling
        const parent = lbl.parentElement;
        if (parent) {
          const directInput = parent.querySelector<HTMLElement>("input, sl-input, textarea, sl-textarea, [contenteditable='true']");
          if (directInput && directInput !== lbl) {
            return directInput;
          }
        }

        let sibling = lbl.nextElementSibling as HTMLElement | null;
        while (sibling) {
          if (sibling.matches("input, sl-input, textarea, sl-textarea, [contenteditable='true']")) {
            return sibling;
          }
          const nestedInput = sibling.querySelector<HTMLElement>("input, sl-input, textarea, sl-textarea");
          if (nestedInput) {
            return nestedInput;
          }
          sibling = sibling.nextElementSibling as HTMLElement | null;
        }
      }
    }

    return null;
  }

  /**
   * Sets value on a DOM element (native input, Shoelace sl-input, textarea, or contenteditable).
   */
  private static async setElementValue(element: HTMLElement, value: string): Promise<void> {
    DomAutomation.highlight(element, 400);

    const tagName = element.tagName.toLowerCase();

    // 1. Shoelace sl-input / sl-textarea
    if (tagName === "sl-input" || tagName === "sl-textarea") {
      (element as any).value = value;
      element.dispatchEvent(new CustomEvent("sl-input", { bubbles: true, composed: true }));
      element.dispatchEvent(new CustomEvent("sl-change", { bubbles: true, composed: true }));

      const innerInput = element.shadowRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea") ||
        element.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");

      if (innerInput) {
        DomAutomation.setNativeValue(innerInput, value);
        innerInput.dispatchEvent(new Event("input", { bubbles: true }));
        innerInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    // 2. Native HTMLInputElement / HTMLTextAreaElement
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      DomAutomation.setNativeValue(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // 3. ContentEditable
    if (element.isContentEditable || element.getAttribute("contenteditable") === "true") {
      element.innerText = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
  }

  /**
   * Saves sheet if an explicit Save button is found.
   */
  private static async saveSheetIfPresent(): Promise<void> {
    const saveButtonSelector =
      'h-sheet-drawer button[type="submit"], h-sheet-drawer button[aria-label="Enregistrer"], .sheet-save-btn';
    const saveBtn = document.querySelector<HTMLElement>(saveButtonSelector);
    if (saveBtn) {
      console.log("🦅 [SheetSync] Clicking sheet Save button...");
      await DomAutomation.click(saveBtn, { highlight: true });
      await this.sleep(300);
    }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
