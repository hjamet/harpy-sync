import { parseMarkdown } from "../markdown/parser.js";
import { fromFirestoreValue, FirestoreValue } from "../firestore/mask-builder.js";
import type { ParsedObsidianNote, ObsidianNotePage, EntityDiffResult } from "./types.js";

/**
 * Parses full Obsidian note pages, supporting multi-page delimiters (<!-- harpy:page ... -->)
 * or multiple # Heading 1 sections, preserving the complete content (description, quote,
 * full 7 statblock tables, and Secrets MJ pages).
 */
export function parseObsidianPages(
  rawMarkdown: string,
  defaultName: string = "Description"
): ObsidianNotePage[] {
  let body = rawMarkdown.replace(/\r\n/g, "\n");
  if (body.trimStart().startsWith("---")) {
    const fmMatch = body.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
    if (fmMatch) {
      body = fmMatch[1];
    }
  }

  const pages: ObsidianNotePage[] = [];
  const pageTagRegex = /<!--\s*harpy:page\s+([^>]*?)-->/i;

  if (pageTagRegex.test(body)) {
    const lines = body.split("\n");
    let currentPage: { uid?: string; name: string; type?: string; lines: string[] } | null = null;
    let page1Lines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const tagMatch = line.match(/<!--\s*harpy:page\s+([^>]*?)-->/i);
      if (tagMatch) {
        const attrStr = tagMatch[1];
        const uidMatch = attrStr.match(/\buid=["']([^"']+)["']/i);
        const nameMatch = attrStr.match(/\bname=["']([^"']+)["']/i);
        const typeMatch = attrStr.match(/\btype=["']([^"']+)["']/i);

        let pageName = nameMatch ? decodeURIComponent(nameMatch[1]) : "";
        const uid = uidMatch ? uidMatch[1] : undefined;
        const type = typeMatch ? typeMatch[1] : "standard";

        // If next line is a # Heading 1, use it if pageName is empty
        if (!pageName && i + 1 < lines.length && lines[i + 1].startsWith("# ")) {
          pageName = lines[i + 1].substring(2).trim();
        }

        if (currentPage) {
          pages.push({
            uid: currentPage.uid,
            name: currentPage.name || `Page ${pages.length + 1}`,
            type: currentPage.type,
            markdown: currentPage.lines.join("\n").trim(),
            order: pages.length,
          });
        }

        currentPage = {
          uid,
          name: pageName || `Page ${pages.length + 2}`,
          type,
          lines: [],
        };
        continue;
      }

      if (currentPage) {
        currentPage.lines.push(line);
      } else {
        page1Lines.push(line);
      }
    }

    const p1Markdown = page1Lines.join("\n").trim();
    let p1Title = defaultName;
    const h1Match = p1Markdown.match(/^#\s+(.+)$/m);
    if (h1Match) {
      p1Title = h1Match[1].trim();
    }

    pages.unshift({
      name: p1Title,
      type: "standard",
      markdown: p1Markdown,
      order: 0,
    });

    if (currentPage) {
      pages.push({
        uid: currentPage.uid,
        name: currentPage.name || `Page ${pages.length + 1}`,
        type: currentPage.type,
        markdown: currentPage.lines.join("\n").trim(),
        order: pages.length,
      });
    }

    return pages;
  }

  // Fallback: Check if there are multiple # Heading 1 headers
  const h1Regex = /^#\s+(.+)$/gm;
  const h1Matches: Array<{ title: string; index: number; length: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = h1Regex.exec(body)) !== null) {
    h1Matches.push({ title: m[1].trim(), index: m.index, length: m[0].length });
  }

  if (h1Matches.length > 1) {
    for (let k = 0; k < h1Matches.length; k++) {
      const current = h1Matches[k];
      const nextIndex = k + 1 < h1Matches.length ? h1Matches[k + 1].index : body.length;
      const chunkText = body.substring(current.index, nextIndex).trim();
      pages.push({
        name: current.title,
        type: "standard",
        markdown: chunkText,
        order: k,
      });
    }
    return pages;
  }

  // Single page note
  let title = defaultName;
  const singleH1 = body.match(/^#\s+(.+)$/m);
  if (singleH1) {
    title = singleH1[1].trim();
  }

  return [
    {
      name: title,
      type: "standard",
      markdown: body.trim(),
      order: 0,
    },
  ];
}

export function parseObsidianNote(content: string, defaultName: string = "Untitled"): ParsedObsidianNote {
  const doc = parseMarkdown(content, { parseHeadingsAsChunksFallback: true });
  const fm = doc.frontmatter;

  const uid = (fm["harpy-uid"] || fm["uid"]) as string | undefined;
  const worldUid = (fm["harpy-world"] || fm["worldId"]) as string | undefined;
  const type = ((fm["harpy-type"] || fm["type"]) as string) || "character";
  const folder = fm["folder"] as string | undefined;

  let tags: string[] = [];
  if (Array.isArray(fm["tags"])) {
    tags = fm["tags"].map(String);
  } else if (typeof fm["tags"] === "string") {
    tags = fm["tags"]
      .split(/[\s,]+/)
      .map((t: string) => t.replace(/^#/, "").trim())
      .filter(Boolean);
  }

  const variables: Record<string, string | number | boolean> = {};
  if (fm["variables"] && typeof fm["variables"] === "object") {
    for (const [k, v] of Object.entries(fm["variables"] as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        variables[k] = v;
      }
    }
  }

  const systemKeys = new Set([
    "harpy-uid", "uid", "harpy-world", "worldId", "harpy-type", "type",
    "folder", "tags", "variables", "harpy-last-sync", "aliases", "title", "name"
  ]);

  for (const [k, v] of Object.entries(fm)) {
    if (!systemKeys.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      variables[k] = v;
    }
  }

  let name = (fm["name"] || fm["title"]) as string | undefined;
  if (!name) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      name = h1Match[1].trim();
    } else {
      name = defaultName;
    }
  }

  const chunks = doc.chunks.map((c, idx) => ({
    uid: c.uid,
    name: c.name || `Section ${idx + 1}`,
    type: c.type,
    order: idx,
    text: c.content,
    content: c.content,
  }));

  const pages = parseObsidianPages(content, name);

  return {
    name,
    uid,
    worldUid,
    type,
    folder,
    tags,
    variables,
    frontmatter: fm,
    chunks,
    pages,
    rawMarkdown: content,
    cleanBody: pages.length > 0 ? pages[0].markdown : doc.leadingContent || "",
  };
}

export function computeEntityDiff(
  localNote: ParsedObsidianNote,
  remoteEntity: any
): EntityDiffResult {
  const diffSummary: string[] = [];

  const remoteName = remoteEntity?.name || remoteEntity?.fields?.name?.stringValue || "";
  const nameChanged = Boolean(remoteName && localNote.name !== remoteName);
  if (nameChanged) {
    diffSummary.push(`Name changed: "${remoteName}" -> "${localNote.name}"`);
  }

  const remoteType = remoteEntity?.type || remoteEntity?.fields?.type?.stringValue || "character";
  const typeChanged = Boolean(localNote.type && localNote.type !== remoteType);
  if (typeChanged) {
    diffSummary.push(`Type changed: "${remoteType}" -> "${localNote.type}"`);
  }

  const remoteFolder = remoteEntity?.folder || remoteEntity?.fields?.folder?.stringValue || "";
  const folderChanged = Boolean(localNote.folder && localNote.folder !== remoteFolder);
  if (folderChanged) {
    diffSummary.push(`Folder changed: "${remoteFolder}" -> "${localNote.folder}"`);
  }

  const remoteTags: string[] = Array.isArray(remoteEntity?.tags)
    ? remoteEntity.tags
    : remoteEntity?.fields?.tags?.arrayValue?.values?.map((v: any) => v.stringValue) || [];
  const tagsAdded = localNote.tags.filter((t) => !remoteTags.includes(t));
  const tagsRemoved = remoteTags.filter((t) => !localNote.tags.includes(t));
  if (tagsAdded.length > 0) diffSummary.push(`Tags added: ${tagsAdded.join(", ")}`);
  if (tagsRemoved.length > 0) diffSummary.push(`Tags removed: ${tagsRemoved.join(", ")}`);

  const remoteVars: Record<string, any> = {};
  if (remoteEntity?.variables && typeof remoteEntity.variables === "object") {
    Object.assign(remoteVars, remoteEntity.variables);
  } else if (remoteEntity?.fields?.data?.mapValue?.fields) {
    for (const [k, v] of Object.entries(remoteEntity.fields.data.mapValue.fields)) {
      remoteVars[k] = fromFirestoreValue(v as FirestoreValue);
    }
  }

  const variablesModified: Record<string, { oldValue: any; newValue: any }> = {};
  const variablesAdded: Record<string, any> = {};
  const variablesRemoved: string[] = [];

  for (const [k, v] of Object.entries(localNote.variables)) {
    if (k in remoteVars) {
      if (String(remoteVars[k]) !== String(v)) {
        variablesModified[k] = { oldValue: remoteVars[k], newValue: v };
        diffSummary.push(`Variable modified "${k}": ${remoteVars[k]} -> ${v}`);
      }
    } else {
      variablesAdded[k] = v;
      diffSummary.push(`Variable added "${k}": ${v}`);
    }
  }

  const hasDiff =
    nameChanged ||
    typeChanged ||
    folderChanged ||
    tagsAdded.length > 0 ||
    tagsRemoved.length > 0 ||
    Object.keys(variablesModified).length > 0 ||
    Object.keys(variablesAdded).length > 0;

  return {
    hasDiff,
    nameChanged,
    oldName: remoteName,
    newName: localNote.name,
    typeChanged,
    oldType: remoteType,
    newType: localNote.type,
    folderChanged,
    oldFolder: remoteFolder,
    newFolder: localNote.folder,
    tagsAdded,
    tagsRemoved,
    variablesModified,
    variablesAdded,
    variablesRemoved,
    chunksModified: false,
    diffSummary,
  };
}
