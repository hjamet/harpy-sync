import { parse as parseYaml } from "yaml";
import { HarpyChunkNode, HarpyMarkdownDocument, MarkdownParserOptions } from "./ast.js";

/**
 * Parses YAML frontmatter from the beginning of a markdown string.
 */
export function parseFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  rawFrontmatter?: string;
} {
  if (!markdown) {
    return { frontmatter: {}, body: "" };
  }

  const normalized = markdown.replace(/\r\n/g, "\n");
  const trimmed = normalized.trimStart();

  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: normalized };
  }

  // Look for closing ---
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }

  const rawYaml = match[1];
  const body = match[2];

  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(rawYaml);
    if (parsed && typeof parsed === "object") {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // If parsing fails, return empty frontmatter but keep raw text
  }

  return {
    frontmatter,
    body,
    rawFrontmatter: rawYaml,
  };
}

/**
 * Parses HTML comment attributes string (e.g. id="abc" type="text" name="Hello")
 */
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(attrString)) !== null) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = val;
  }
  return attrs;
}

/**
 * Parses chunk blocks from the markdown body.
 */
export function parseChunks(
  body: string,
  options?: MarkdownParserOptions
): {
  chunks: HarpyChunkNode[];
  leadingContent: string;
  trailingContent: string;
  hasExplicitChunks: boolean;
} {
  const defaultType = options?.defaultChunkType ?? "text";
  const normalized = body.replace(/\r\n/g, "\n");

  // Regex matching <!-- harpy:chunk ... --> ... <!-- /harpy:chunk -->
  // Also supports <!-- harpy:chunk:start ... --> ... <!-- harpy:chunk:end -->
  const blockRegex =
    /<!--\s*harpy:chunk(?::start)?\s+([\s\S]*?)-->([\s\S]*?)<!--\s*(?:\/harpy:chunk|harpy:chunk:end)\s*-->/g;

  const chunks: HarpyChunkNode[] = [];
  let lastIndex = 0;
  let leadingContent = "";
  let match: RegExpExecArray | null;
  let isFirstMatch = true;

  while ((match = blockRegex.exec(normalized)) !== null) {
    if (isFirstMatch) {
      leadingContent = normalized.substring(0, match.index).trim();
      isFirstMatch = false;
    }

    const rawAttrString = match[1].trim();
    const rawContent = match[2];
    const attrs = parseAttributes(rawAttrString);

    const uid = attrs.id || attrs.uid || `chunk_${chunks.length + 1}`;
    const type = attrs.type || defaultType;
    const name = attrs.name || attrs.title;

    // Filter out standard keys to keep extra custom attributes
    const extraAttrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (!["id", "uid", "type", "name", "title"].includes(k)) {
        extraAttrs[k] = v;
      }
    }

    chunks.push({
      uid,
      type,
      name,
      content: rawContent.trim(),
      attributes: Object.keys(extraAttrs).length > 0 ? extraAttrs : undefined,
      rawHeader: rawAttrString,
    });

    lastIndex = match.index + match[0].length;
  }

  let trailingContent = "";
  if (chunks.length > 0) {
    trailingContent = normalized.substring(lastIndex).trim();
    return {
      chunks,
      leadingContent,
      trailingContent,
      hasExplicitChunks: true,
    };
  }

  // Fallback: No explicit chunks found
  if (options?.parseHeadingsAsChunksFallback) {
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headingChunks: HarpyChunkNode[] = [];
    let headingMatch: RegExpExecArray | null;
    let prevIndex = 0;
    let prevName: string | undefined;
    let indexCount = 1;

    while ((headingMatch = headingRegex.exec(normalized)) !== null) {
      if (prevIndex === 0 && headingMatch.index > 0) {
        leadingContent = normalized.substring(0, headingMatch.index).trim();
      } else if (prevIndex > 0) {
        const chunkText = normalized.substring(prevIndex, headingMatch.index).trim();
        headingChunks.push({
          uid: `auto_chunk_${indexCount++}`,
          type: defaultType,
          name: prevName,
          content: chunkText,
        });
      }
      prevIndex = headingMatch.index + headingMatch[0].length;
      prevName = headingMatch[2].trim();
    }

    if (prevIndex > 0) {
      const rest = normalized.substring(prevIndex).trim();
      headingChunks.push({
        uid: `auto_chunk_${indexCount++}`,
        type: defaultType,
        name: prevName,
        content: rest,
      });
      return {
        chunks: headingChunks,
        leadingContent,
        trailingContent: "",
        hasExplicitChunks: false,
      };
    }
  }

  // Single implicit body chunk
  const trimmedBody = normalized.trim();
  if (trimmedBody) {
    chunks.push({
      uid: "root_chunk",
      type: defaultType,
      content: trimmedBody,
    });
  }

  return {
    chunks,
    leadingContent: "",
    trailingContent: "",
    hasExplicitChunks: false,
  };
}

/**
 * Parses full Markdown document string into Harpy Markdown AST.
 */
export function parseMarkdown(
  markdown: string,
  options?: MarkdownParserOptions
): HarpyMarkdownDocument {
  const { frontmatter, body, rawFrontmatter } = parseFrontmatter(markdown);
  const { chunks, leadingContent, trailingContent, hasExplicitChunks } = parseChunks(
    body,
    options
  );

  return {
    frontmatter,
    rawFrontmatter,
    leadingContent,
    chunks,
    trailingContent,
    hasExplicitChunks,
  };
}
