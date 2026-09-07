import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseObsidianNote, parseObsidianPages } from "../packages/core/dist/index.js";

function formatInlineMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/__(.*?)__/g, "<strong>$1</strong>")
    .replace(/_(.*?)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; font-family: monospace;">$1</code>')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span style="color: #60a5fa; text-decoration: underline;" data-wiki="$1">$2</span>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span style="color: #60a5fa; text-decoration: underline;" data-wiki="$1">$1</span>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color: #60a5fa; text-decoration: underline;">$1</a>');
}

function parseMarkdownTables(content) {
  const lines = content.split("\n");
  const result = [];
  let inTable = false;
  let tableLines = [];

  const isTableRow = (l) => {
    const trimmed = l.trim();
    return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2;
  };

  const isSeparatorRow = (l) => {
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

    const alignments = [];
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

    const tableHtml = [];
    tableHtml.push(
      '<table style="width: 100%; border-collapse: collapse; margin: 12px 0; border: 1px solid #475569; font-size: 0.95em;">'
    );

    const headerCells = headerLine.split("|").slice(1, -1);
    tableHtml.push("  <thead>");
    tableHtml.push('    <tr style="background-color: rgba(255, 255, 255, 0.08); border-bottom: 2px solid #64748b;">');
    for (let i = 0; i < headerCells.length; i++) {
      const align = alignments[i] || "left";
      const text = formatInlineMarkdown(headerCells[i].trim());
      tableHtml.push(
        `      <th style="padding: 8px 12px; border: 1px solid #475569; font-weight: 600; text-align: ${align};">${text}</th>`
      );
    }
    tableHtml.push("    </tr>");
    tableHtml.push("  </thead>");

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
          const text = formatInlineMarkdown(cells[i].trim());
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

function markdownToHtml(markdown) {
  if (!markdown) return "<p></p>";

  let processed = parseMarkdownTables(markdown.replace(/\r\n/g, "\n"));

  processed = processed.replace(
    /```([a-z]*)\n([\s\S]*?)```/g,
    '<pre style="background: #1e293b; color: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto;"><code class="language-$1">$2</code></pre>'
  );

  processed = processed
    .replace(/^#### (.*$)/gim, '<h4 style="margin-top: 10px; margin-bottom: 4px; font-weight: 600;">$1</h4>')
    .replace(/^### (.*$)/gim, '<h3 style="margin-top: 12px; margin-bottom: 4px; font-weight: 600; color: #38bdf8;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="margin-top: 16px; margin-bottom: 6px; font-weight: 700; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="margin-top: 18px; margin-bottom: 8px; font-weight: 700;">$1</h1>');

  processed = processed.replace(/^---$/gim, '<hr style="border: 0; height: 1px; background: rgba(255, 255, 255, 0.2); margin: 16px 0;" />');

  processed = processed.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<p style="text-align: center; margin: 12px 0;"><img src="$2" alt="$1" style="max-width: 100%; height: auto; border-radius: 6px;" /></p>'
  );

  const rawBlocks = processed.split("\n\n");
  const formattedBlocks = [];

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (/^<(table|thead|tbody|pre|h1|h2|h3|h4|h5|h6|hr)/i.test(trimmed)) {
      formattedBlocks.push(trimmed);
      continue;
    }

    if (/^>\s*\[!([a-zA-Z_-]+)\]/i.test(trimmed)) {
      const calloutMatch = trimmed.match(/^>\s*\[!([a-zA-Z_-]+)\]\s*(.*)$/m);
      const calloutType = calloutMatch ? calloutMatch[1].toLowerCase() : "info";
      const calloutTitle = calloutMatch ? calloutMatch[2].trim() : "";

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
        ? `<div style="font-weight: 600; margin-bottom: 6px;">${formatInlineMarkdown(calloutTitle)}</div>`
        : "";
      const bodyHtml = calloutLines.map((l) => `<p style="margin: 4px 0;">${formatInlineMarkdown(l)}</p>`).join("");

      formattedBlocks.push(
        `<div style="border-left: 4px solid ${borderColor}; background: ${bgColor}; padding: 10px 14px; margin: 12px 0; border-radius: 4px;">${titleHtml}${bodyHtml}</div>`
      );
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteContent = trimmed
        .split("\n")
        .map((l) => l.replace(/^>\s?/, "").trim())
        .filter(Boolean)
        .map((l) => formatInlineMarkdown(l))
        .join("<br/>");

      formattedBlocks.push(
        `<blockquote style="border-left: 3px solid #6366f1; margin: 12px 0; padding: 8px 16px; background: rgba(99, 102, 241, 0.05); font-style: italic;">${quoteContent}</blockquote>`
      );
      continue;
    }

    if (/^\s*[\-\*]\s+/m.test(trimmed)) {
      const listItems = trimmed
        .split("\n")
        .filter((l) => /^\s*[\-\*]\s+/.test(l))
        .map((l) => `<li style="margin-bottom: 4px;">${formatInlineMarkdown(l.replace(/^\s*[\-\*]\s+/, ""))}</li>`)
        .join("\n");
      formattedBlocks.push(`<ul style="margin: 8px 0; padding-left: 20px;">\n${listItems}\n</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/m.test(trimmed)) {
      const listItems = trimmed
        .split("\n")
        .filter((l) => /^\s*\d+\.\s+/.test(l))
        .map((l) => `<li style="margin-bottom: 4px;">${formatInlineMarkdown(l.replace(/^\s*\d+\.\s+/, ""))}</li>`)
        .join("\n");
      formattedBlocks.push(`<ol style="margin: 8px 0; padding-left: 20px;">\n${listItems}\n</ol>`);
      continue;
    }

    const pContent = formatInlineMarkdown(trimmed.replace(/\n/g, "<br/>"));
    formattedBlocks.push(`<p style="margin-bottom: 8px; line-height: 1.5;">${pContent}</p>`);
  }

  return formattedBlocks.join("\n") || "<p></p>";
}

async function test() {
  const notePath = "c:\\Users\\hjamet\\Documents\\VoiceNotes\\Conseil\\Molosse Dottari.md";
  const content = await fs.readFile(notePath, "utf-8");

  console.log("=== 1. Test parseObsidianNote & parseObsidianPages ===");
  const parsed = parseObsidianNote(content, "Molosse Dottari");
  console.log("Name:", parsed.name);
  console.log("UID:", parsed.uid);
  console.log("Pages count:", parsed.pages.length);

  for (let i = 0; i < parsed.pages.length; i++) {
    const p = parsed.pages[i];
    console.log(`\nPage [${i + 1}]: "${p.name}" (UID: ${p.uid || 'none'}) - Markdown length: ${p.markdown.length}`);
    const subheadings = p.markdown.match(/### [^\n]+/g) || [];
    console.log(`Subheadings in page ${i + 1}:`, subheadings);
  }

  console.log("\n=== 2. Test Markdown to HTML table conversion on Page 1 ===");
  const page1Html = markdownToHtml(parsed.pages[0].markdown);
  const tableCount = (page1Html.match(/<table/g) || []).length;
  console.log(`Converted HTML table count in Page 1: ${tableCount}`);
  if (tableCount !== 7) {
    throw new Error(`Expected 7 tables in Page 1, got ${tableCount}`);
  }

  console.log("\n=== 3. Test HTML content structure on Page 2 ===");
  const page2Html = markdownToHtml(parsed.pages[1].markdown);
  console.log(`Page 2 HTML length: ${page2Html.length}`);
  console.log(`Page 2 contains Écologie:`, page2Html.includes("Écologie"));
  console.log(`Page 2 contains Tactique de Meute:`, page2Html.includes("Tactique de Meute"));

  console.log("\n✅ ALL VALIDATIONS PASSED SUCCESSFULLY!");
}

test().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
