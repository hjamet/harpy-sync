/**
 * Codex Sync: In-Browser Automation for Harpy.gg Codex / Journal Pages and TinyMCE Blocks
 * Automatically manages pages, creates missing pages, converts Markdown (including 7 PF1e statblock tables)
 * into rich stylized HTML, injects into TinyMCE, and triggers [Ctrl+Enter] save.
 */

import { DomAutomation } from "./dom-automation";
import { MainWorldBridgeClient } from "./bridge-client";

export interface CodexPageInput {
  id?: string;
  title: string;
  contentHtml?: string;
  markdown?: string;
}

export interface CodexSyncOptions {
  pages: CodexPageInput[];
  createMissingPages?: boolean;
  timeoutMs?: number;
}

export interface CodexSyncResult {
  success: boolean;
  syncedPages: string[];
  createdPages: string[];
  errors: string[];
}

export class CodexSync {
  /**
   * Synchronizes an array of pages and text chunks into the active Harpy Codex.
   */
  public static async syncCodex(options: CodexSyncOptions): Promise<CodexSyncResult> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const createMissing = options.createMissingPages !== false;
    const syncedPages: string[] = [];
    const createdPages: string[] = [];
    const errors: string[] = [];

    if (!options.pages || options.pages.length === 0) {
      return { success: true, syncedPages: [], createdPages: [], errors: [] };
    }

    try {
      console.log(`🦅 [CodexSync] Starting sync of ${options.pages.length} pages...`);

      // 1. Ensure Codex view is active
      await this.ensureCodexTabActive();

      for (let pageIdx = 0; pageIdx < options.pages.length; pageIdx++) {
        const page = options.pages[pageIdx];
        try {
          console.log(`🦅 [CodexSync] Processing page [${pageIdx + 1}/${options.pages.length}]: "${page.title}"...`);

          // Determine HTML content with stylized tables and callouts
          const htmlContent = page.contentHtml || this.markdownToHtml(page.markdown || "");

          // Check if page exists in navigation
          let pageElement = this.findPageElement(page.title, pageIdx);

          if (!pageElement && createMissing) {
            console.log(`🦅 [CodexSync] Page "${page.title}" not found, creating new page...`);
            await this.createNewPage(page.title, timeoutMs);
            createdPages.push(page.title);
            await this.sleep(400);
            pageElement = this.findPageElement(page.title, pageIdx);
          }

          // Select the page
          if (pageElement) {
            await DomAutomation.click(pageElement, { highlight: true });
            await this.sleep(300);
          }

          // Inject content into TinyMCE editor and save
          await this.injectAndSaveTinyMceBlock(htmlContent, timeoutMs);

          syncedPages.push(page.title);
          console.log(`🦅 [CodexSync] Successfully synced page "${page.title}"`);
        } catch (pageErr: any) {
          const errMsg = `Error syncing page "${page.title}": ${pageErr.message || String(pageErr)}`;
          console.error(`🦅 [CodexSync] ${errMsg}`);
          errors.push(errMsg);
        }
      }

      return {
        success: errors.length === 0,
        syncedPages,
        createdPages,
        errors,
      };
    } catch (err: any) {
      console.error("🦅 [CodexSync] Fatal error during codex sync:", err);
      return {
        success: false,
        syncedPages,
        createdPages,
        errors: [...errors, err.message || String(err)],
      };
    }
  }

  /**
   * Ensures the Codex tab / view is active.
   */
  private static async ensureCodexTabActive(): Promise<void> {
    const codexTab = document.querySelector<HTMLElement>(
      'button[aria-label="Codex"], button[aria-label="Journal"], button[role="tab"][aria-label*="Codex"], [data-tab="codex"]'
    );
    if (codexTab && !codexTab.classList.contains("active") && codexTab.getAttribute("aria-selected") !== "true") {
      await DomAutomation.click(codexTab, { highlight: true });
      await this.sleep(250);
    }
  }

  /**
   * Finds the navigation element for a specific page title or position.
   */
  private static findPageElement(title: string, pageIndex?: number): HTMLElement | null {
    const normalizedTarget = title.trim().toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'h-codex-page-tab, .page-item, .codex-page-button, nav.pages button, .pages-list button, [role="tab"]'
      )
    );

    // 1. Exact or substring match
    for (const el of candidates) {
      const text = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (text === normalizedTarget || (text && normalizedTarget && (text.includes(normalizedTarget) || normalizedTarget.includes(text)))) {
        return el;
      }
    }

    // 2. Default first page fallback if index === 0
    if (pageIndex === 0) {
      const defaultAliases = ["description", "général", "general", "first page", "main", "page 1"];
      for (const el of candidates) {
        const text = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (defaultAliases.includes(text)) {
          return el;
        }
      }
      if (candidates.length > 0) {
        return candidates[0];
      }
    }

    return null;
  }

  /**
   * Creates a new page via the "Ajouter une page" dialog.
   */
  private static async createNewPage(title: string, timeoutMs: number): Promise<void> {
    const addPageButtonSelector =
      'button[aria-label="Ajouter une page"], button[aria-label="Add page"], button[aria-label*="Ajouter une page"], .add-page-button';

    let addPageButton = document.querySelector<HTMLElement>(addPageButtonSelector);
    if (!addPageButton) {
      const allButtons = Array.from(document.querySelectorAll<HTMLElement>("button, sl-icon-button"));
      for (const btn of allButtons) {
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
        const text = (btn.innerText || btn.textContent || "").toLowerCase();
        if (aria.includes("ajouter une page") || text.includes("ajouter une page") || aria.includes("add page")) {
          addPageButton = btn;
          break;
        }
      }
    }

    if (!addPageButton) {
      throw new Error("Could not find button 'button[aria-label=\"Ajouter une page\"]' to create codex page");
    }

    console.log("🦅 [CodexSync] Clicking 'Ajouter une page' button...");
    await DomAutomation.click(addPageButton, { highlight: true });

    // Wait for h-page-form-dialog
    await DomAutomation.waitForElement("h-page-form-dialog", timeoutMs);
    await this.sleep(200);

    // Find input
    const inputSelector = "h-page-form-dialog sl-input, h-page-form-dialog input";
    const inputEl = await DomAutomation.waitForElement<HTMLElement>(inputSelector, timeoutMs);

    if (inputEl.tagName.toLowerCase() === "sl-input") {
      (inputEl as any).value = title;
      inputEl.dispatchEvent(new CustomEvent("sl-input", { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new CustomEvent("sl-change", { bubbles: true, composed: true }));
      const innerInput = inputEl.shadowRoot?.querySelector("input") || inputEl.querySelector("input");
      if (innerInput) {
        await DomAutomation.type(innerInput, title, { clearFirst: true });
      }
    } else {
      await DomAutomation.type(inputEl, title, { clearFirst: true });
    }

    await this.sleep(150);

    // Submit Dialog
    const confirmButtonSelector =
      "h-page-form-dialog h-dialog-actions button, h-page-form-dialog h-dialog-actions sl-button, h-page-form-dialog button[type='submit']";

    let confirmBtn = document.querySelector<HTMLElement>(confirmButtonSelector);
    if (!confirmBtn) {
      const dialog = document.querySelector("h-page-form-dialog");
      if (dialog) {
        const btns = Array.from(dialog.querySelectorAll<HTMLElement>("button, sl-button"));
        for (const b of btns) {
          const text = (b.innerText || b.textContent || "").toLowerCase();
          if (text.includes("ajouter") || text.includes("créer") || text.includes("enregistrer") || text.includes("save")) {
            confirmBtn = b;
            break;
          }
        }
      }
    }

    if (!confirmBtn) {
      throw new Error("Could not find confirm button in 'h-page-form-dialog'");
    }

    console.log("🦅 [CodexSync] Submitting page creation dialog...");
    await DomAutomation.click(confirmBtn, { highlight: true });

    try {
      await DomAutomation.waitForElementToDisappear("h-page-form-dialog", timeoutMs);
    } catch {
      console.warn("🦅 [CodexSync] Dialog disappear timeout, continuing.");
    }
  }

  /**
   * Injects formatted HTML into TinyMCE editor and triggers save.
   */
  private static async injectAndSaveTinyMceBlock(htmlContent: string, timeoutMs: number): Promise<void> {
    // 1. Ensure an editor block is active or add a new text block
    await this.ensureEditorActive(timeoutMs);

    // 2. Set content in TinyMCE via Main World Bridge or DOM
    const injected = await this.setContentInTinyMce(htmlContent);
    if (!injected) {
      throw new Error("Failed to inject HTML content into TinyMCE editor");
    }

    await this.sleep(300);

    // 3. Save with button[aria-label="[Ctrl+Enter]"]
    await this.saveActiveEditorBlock(timeoutMs);
  }

  /**
   * Ensures an editable TinyMCE block is open.
   */
  private static async ensureEditorActive(timeoutMs: number): Promise<void> {
    // Check if TinyMCE container or iframe already exists in DOM
    const existingEditor = document.querySelector(".tox-tinymce, iframe.tox-edit-area__iframe, div[contenteditable='true']");
    if (existingEditor) {
      return;
    }

    // Look for "Ajouter un bloc" / "Nouveau bloc" button
    const addBlockSelector =
      'button[aria-label="Ajouter un bloc"], button[aria-label="Nouveau bloc"], button[aria-label="Ajouter du texte"], .add-block-btn, button:has-text("Ajouter un bloc")';

    let addBlockBtn = document.querySelector<HTMLElement>(addBlockSelector);
    if (!addBlockBtn) {
      const allButtons = Array.from(document.querySelectorAll<HTMLElement>("button, sl-button"));
      for (const b of allButtons) {
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        const text = (b.innerText || b.textContent || "").toLowerCase();
        if (aria.includes("ajouter un bloc") || text.includes("ajouter un bloc") || aria.includes("nouveau bloc") || aria.includes("add block")) {
          addBlockBtn = b;
          break;
        }
      }
    }

    if (addBlockBtn) {
      console.log("🦅 [CodexSync] Clicking 'Ajouter un bloc' button...");
      await DomAutomation.click(addBlockBtn, { highlight: true });
      await this.sleep(350);
    } else {
      // Look for an existing block's edit button
      const editBlockBtn = document.querySelector<HTMLElement>(
        'button[aria-label="Éditer le bloc"], button[aria-label="Modifier"], .block-edit-btn'
      );
      if (editBlockBtn) {
        await DomAutomation.click(editBlockBtn, { highlight: true });
        await this.sleep(350);
      }
    }
  }

  /**
   * Injects HTML content into TinyMCE via Main World Bridge or DOM fallback.
   */
  private static async setContentInTinyMce(htmlContent: string): Promise<boolean> {
    // Method 1: Main World Bridge using window.tinymce API
    try {
      const evalCode = `
        (() => {
          if (window.tinymce) {
            const editor = window.tinymce.activeEditor || (window.tinymce.editors && window.tinymce.editors[0]);
            if (editor) {
              editor.setContent(${JSON.stringify(htmlContent)});
              editor.fire('change');
              editor.fire('input');
              editor.fire('NodeChange');
              editor.setDirty(true);
              return { success: true, method: 'tinymce_api', editorId: editor.id };
            }
          }
          return { success: false };
        })()
      `;

      const bridgeResult = await MainWorldBridgeClient.call<{ success: boolean }>("EVAL_EXPRESSION", { code: evalCode }, 3000);
      if (bridgeResult && bridgeResult.success) {
        console.log("🦅 [CodexSync] Successfully injected HTML via window.tinymce Main World API");
        return true;
      }
    } catch (bridgeErr) {
      console.warn("🦅 [CodexSync] Bridge TinyMCE injection failed, trying DOM fallback:", bridgeErr);
    }

    // Method 2: DOM Iframe injection (.tox-edit-area__iframe)
    const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>(".tox-edit-area__iframe, iframe[id*='tinymce']"));
    for (const iframe of iframes) {
      if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
        iframe.contentDocument.body.innerHTML = htmlContent;
        iframe.contentDocument.body.dispatchEvent(new Event("input", { bubbles: true }));
        iframe.contentDocument.body.dispatchEvent(new Event("change", { bubbles: true }));
        console.log("🦅 [CodexSync] Injected HTML via TinyMCE iframe DOM");
        return true;
      }
    }

    // Method 3: Inline ContentEditable (.tox-tinymce [contenteditable="true"])
    const editables = Array.from(document.querySelectorAll<HTMLElement>(".tox-tinymce [contenteditable='true'], div.mce-content-body"));
    for (const editable of editables) {
      if (editable) {
        editable.innerHTML = htmlContent;
        editable.dispatchEvent(new Event("input", { bubbles: true }));
        editable.dispatchEvent(new Event("change", { bubbles: true }));
        console.log("🦅 [CodexSync] Injected HTML via ContentEditable DOM");
        return true;
      }
    }

    return false;
  }

  /**
   * Saves the TinyMCE block using button[aria-label="[Ctrl+Enter]"].
   */
  private static async saveActiveEditorBlock(timeoutMs: number): Promise<void> {
    const saveButtonSelector =
      'button[aria-label="[Ctrl+Enter]"], button[aria-label*="Ctrl+Enter"], button[title*="Ctrl+Enter"], button[aria-label="Enregistrer"], .save-block-button';

    let saveBtn = document.querySelector<HTMLElement>(saveButtonSelector);

    if (!saveBtn) {
      const allButtons = Array.from(document.querySelectorAll<HTMLElement>("button, sl-button, sl-icon-button"));
      for (const b of allButtons) {
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        const title = (b.getAttribute("title") || "").toLowerCase();
        const text = (b.innerText || b.textContent || "").toLowerCase();
        if (aria.includes("ctrl+enter") || title.includes("ctrl+enter") || aria.includes("enregistrer") || text.includes("enregistrer")) {
          saveBtn = b;
          break;
        }
      }
    }

    if (saveBtn) {
      console.log("🦅 [CodexSync] Clicking Save button 'button[aria-label=\"[Ctrl+Enter]\"]'...");
      await DomAutomation.click(saveBtn, { highlight: true });
    } else {
      // Main World Bridge submit fallback
      try {
        const saveEvalCode = `
          (() => {
            if (window.tinymce) {
              const editor = window.tinymce.activeEditor || (window.tinymce.editors && window.tinymce.editors[0]);
              if (editor) {
                editor.save();
                editor.fire('submit');
              }
            }
            const btn = document.querySelector('button[aria-label*="Ctrl+Enter"], button[title*="Ctrl+Enter"]');
            if (btn) {
              btn.click();
              return { success: true };
            }
            return { success: true };
          })()
        `;
        await MainWorldBridgeClient.call("EVAL_EXPRESSION", { code: saveEvalCode }, 1500);
      } catch {
        // Fallback: Dispatch Ctrl+Enter keyboard event
        console.log("🦅 [CodexSync] Dispatching Ctrl+Enter keyboard shortcut...");
        const activeEl = document.activeElement || document.body;
        activeEl.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    }

    await this.sleep(400);
  }

  /**
   * Formats inline markdown elements (bold, italic, code, links).
   */
  public static formatInlineMarkdown(text: string): string {
    if (!text) return "";
    return text
      // Bold & Italic
      .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/__(.*?)__/g, "<strong>$1</strong>")
      .replace(/_(.*?)_/g, "<em>$1</em>")
      // Inline code
      .replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; font-family: monospace;">$1</code>')
      // Obsidian Wiki Links: [[Target|Alias]] or [[Target]]
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span style="color: #60a5fa; text-decoration: underline;" data-wiki="$1">$2</span>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span style="color: #60a5fa; text-decoration: underline;" data-wiki="$1">$1</span>')
      // Standard Links [Text](URL)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color: #60a5fa; text-decoration: underline;">$1</a>');
  }

  /**
   * Converts markdown tables into styled HTML tables for TinyMCE.
   */
  public static parseMarkdownTables(content: string): string {
    const lines = content.split("\n");
    const result: string[] = [];
    let inTable = false;
    let tableLines: string[] = [];

    const isTableRow = (l: string) => {
      const trimmed = l.trim();
      return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2;
    };

    const isSeparatorRow = (l: string) => {
      const cells = l.split("|").slice(1, -1);
      if (cells.length === 0) return false;
      return cells.every((c) => /^[\s:-]+$/.test(c) && c.includes("-"));
    };

    const flushTable = () => {
      if (tableLines.length === 0) return;
      if (tableLines.length === 1 && !isSeparatorRow(tableLines[0])) {
        result.push(...tableLines);
        tableLines = [];
        return;
      }

      const hasSeparator = tableLines.length >= 2 && isSeparatorRow(tableLines[1]);
      const headerLine = tableLines[0];
      const separatorLine = hasSeparator ? tableLines[1] : null;
      const bodyLines = hasSeparator ? tableLines.slice(2) : tableLines.slice(1);

      // Parse alignments from separator (:---:, ---:, :---)
      const alignments: string[] = [];
      if (separatorLine) {
        const sepCells = separatorLine.split("|").slice(1, -1);
        for (const cell of sepCells) {
          const trimmed = cell.trim();
          if (trimmed.startsWith(":") && trimmed.endsWith(":")) {
            alignments.push("center");
          } else if (trimmed.endsWith(":")) {
            alignments.push("right");
          } else if (trimmed.startsWith(":")) {
            alignments.push("left");
          } else {
            alignments.push("left");
          }
        }
      }

      const tableHtml: string[] = [];
      tableHtml.push(
        '<table style="width: 100%; border-collapse: collapse; margin: 12px 0; border: 1px solid #475569; font-size: 0.95em;">'
      );

      // Render Header
      const headerCells = headerLine.split("|").slice(1, -1);
      tableHtml.push("  <thead>");
      tableHtml.push('    <tr style="background-color: rgba(255, 255, 255, 0.08); border-bottom: 2px solid #64748b;">');
      for (let i = 0; i < headerCells.length; i++) {
        const align = alignments[i] || "left";
        const text = this.formatInlineMarkdown(headerCells[i].trim());
        tableHtml.push(
          `      <th style="padding: 8px 12px; border: 1px solid #475569; font-weight: 600; text-align: ${align};">${text}</th>`
        );
      }
      tableHtml.push("    </tr>");
      tableHtml.push("  </thead>");

      // Render Body
      if (bodyLines.length > 0) {
        tableHtml.push("  <tbody>");
        for (let r = 0; r < bodyLines.length; r++) {
          const rowLine = bodyLines[r];
          if (isSeparatorRow(rowLine)) continue;
          const cells = rowLine.split("|").slice(1, -1);
          const bg = r % 2 === 1 ? "background-color: rgba(255, 255, 255, 0.03);" : "";
          tableHtml.push(`    <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.1); ${bg}">`);
          for (let i = 0; i < cells.length; i++) {
            const align = alignments[i] || "left";
            const text = this.formatInlineMarkdown(cells[i].trim());
            tableHtml.push(
              `      <td style="padding: 8px 12px; border: 1px solid #475569; text-align: ${align};">${text}</td>`
            );
          }
          tableHtml.push("    </tr>");
        }
        tableHtml.push("  </tbody>");
      }

      tableHtml.push("</table>");
      result.push(tableHtml.join("\n"));
      tableLines = [];
    };

    for (const line of lines) {
      if (isTableRow(line)) {
        inTable = true;
        tableLines.push(line);
      } else {
        if (inTable) {
          flushTable();
          inTable = false;
        }
        result.push(line);
      }
    }

    if (inTable) {
      flushTable();
    }

    return result.join("\n");
  }

  /**
   * Converts full Obsidian Markdown (callouts, 7 statblock tables, quotes, headings)
   * into clean, rich TinyMCE HTML.
   */
  public static markdownToHtml(markdown: string): string {
    if (!markdown) return "<p></p>";

    // 1. First convert tables into styled HTML tables
    let processed = this.parseMarkdownTables(markdown.replace(/\r\n/g, "\n"));

    // 2. Code blocks
    processed = processed.replace(
      /```([a-z]*)\n([\s\S]*?)```/g,
      '<pre style="background: #1e293b; color: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto;"><code class="language-$1">$2</code></pre>'
    );

    // 3. Headings with styled margins
    processed = processed
      .replace(/^#### (.*$)/gim, '<h4 style="margin-top: 10px; margin-bottom: 4px; font-weight: 600;">$1</h4>')
      .replace(/^### (.*$)/gim, '<h3 style="margin-top: 12px; margin-bottom: 4px; font-weight: 600; color: #38bdf8;">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 style="margin-top: 16px; margin-bottom: 6px; font-weight: 700; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px;">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 style="margin-top: 18px; margin-bottom: 8px; font-weight: 700;">$1</h1>');

    // 4. Horizontal rules
    processed = processed.replace(/^---$/gim, '<hr style="border: 0; height: 1px; background: rgba(255, 255, 255, 0.2); margin: 16px 0;" />');

    // 5. Images
    processed = processed.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      '<p style="text-align: center; margin: 12px 0;"><img src="$2" alt="$1" style="max-width: 100%; height: auto; border-radius: 6px;" /></p>'
    );

    // 6. Split into blocks to process callouts, blockquotes, lists, and paragraphs
    const rawBlocks = processed.split("\n\n");
    const formattedBlocks: string[] = [];

    for (const block of rawBlocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      // Already HTML elements (table, pre, h1-h6, hr)
      if (/^<(table|thead|tbody|pre|h1|h2|h3|h4|h5|h6|hr)/i.test(trimmed)) {
        formattedBlocks.push(trimmed);
        continue;
      }

      // Obsidian Callout blocks: > [!info] Title
      if (/^>\s*\[!([a-zA-Z_-]+)\]/i.test(trimmed)) {
        const calloutMatch = trimmed.match(/^>\s*\[!([a-zA-Z_-]+)\]\s*(.*)$/m);
        const calloutType = calloutMatch ? calloutMatch[1].toLowerCase() : "info";
        const calloutTitle = calloutMatch ? calloutMatch[2].trim() : "";

        // Collect remaining lines of callout
        const calloutLines = trimmed
          .split("\n")
          .slice(1)
          .map((l) => l.replace(/^>\s?/, "").trim())
          .filter(Boolean);

        let borderColor = "#3b82f6";
        let bgColor = "rgba(59, 130, 246, 0.1)";
        if (["warning", "caution", "danger"].includes(calloutType)) {
          borderColor = "#ef4444";
          bgColor = "rgba(239, 68, 68, 0.1)";
        } else if (["tip", "success"].includes(calloutType)) {
          borderColor = "#10b981";
          bgColor = "rgba(16, 185, 129, 0.1)";
        } else if (["note", "example"].includes(calloutType)) {
          borderColor = "#8b5cf6";
          bgColor = "rgba(139, 92, 246, 0.1)";
        }

        const titleHtml = calloutTitle
          ? `<div style="font-weight: 600; margin-bottom: 6px;">${this.formatInlineMarkdown(calloutTitle)}</div>`
          : "";
        const bodyHtml = calloutLines.map((l) => `<p style="margin: 4px 0;">${this.formatInlineMarkdown(l)}</p>`).join("");

        formattedBlocks.push(
          `<div style="border-left: 4px solid ${borderColor}; background: ${bgColor}; padding: 10px 14px; margin: 12px 0; border-radius: 4px;">${titleHtml}${bodyHtml}</div>`
        );
        continue;
      }

      // Standard Blockquotes (> ...)
      if (trimmed.startsWith(">")) {
        const quoteContent = trimmed
          .split("\n")
          .map((l) => l.replace(/^>\s?/, "").trim())
          .filter(Boolean)
          .map((l) => this.formatInlineMarkdown(l))
          .join("<br/>");

        formattedBlocks.push(
          `<blockquote style="border-left: 3px solid #6366f1; margin: 12px 0; padding: 8px 16px; background: rgba(99, 102, 241, 0.05); font-style: italic;">${quoteContent}</blockquote>`
        );
        continue;
      }

      // Unordered Lists
      if (/^\s*[\-\*]\s+/m.test(trimmed)) {
        const listItems = trimmed
          .split("\n")
          .filter((l) => /^\s*[\-\*]\s+/.test(l))
          .map((l) => `<li style="margin-bottom: 4px;">${this.formatInlineMarkdown(l.replace(/^\s*[\-\*]\s+/, ""))}</li>`)
          .join("\n");
        formattedBlocks.push(`<ul style="margin: 8px 0; padding-left: 20px;">\n${listItems}\n</ul>`);
        continue;
      }

      // Ordered Lists
      if (/^\s*\d+\.\s+/m.test(trimmed)) {
        const listItems = trimmed
          .split("\n")
          .filter((l) => /^\s*\d+\.\s+/.test(l))
          .map((l) => `<li style="margin-bottom: 4px;">${this.formatInlineMarkdown(l.replace(/^\s*\d+\.\s+/, ""))}</li>`)
          .join("\n");
        formattedBlocks.push(`<ol style="margin: 8px 0; padding-left: 20px;">\n${listItems}\n</ol>`);
        continue;
      }

      // Regular Paragraph
      const pContent = this.formatInlineMarkdown(trimmed.replace(/\n/g, "<br/>"));
      formattedBlocks.push(`<p style="margin-bottom: 8px; line-height: 1.5;">${pContent}</p>`);
    }

    return formattedBlocks.join("\n") || "<p></p>";
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
