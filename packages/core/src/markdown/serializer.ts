import { stringify as stringifyYaml } from "yaml";
import { HarpyChunkNode, HarpyMarkdownDocument, MarkdownSerializerOptions } from "./ast.js";

/**
 * Serializes a frontmatter object to YAML block wrapped in '---'.
 */
export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return "";
  }
  const yamlString = stringifyYaml(frontmatter).trim();
  return `---\n${yamlString}\n---\n`;
}

/**
 * Serializes a single HarpyChunkNode into markdown with HTML comment wrappers.
 */
export function serializeChunk(
  chunk: HarpyChunkNode,
  options?: MarkdownSerializerOptions
): string {
  const includeMarkers = options?.includeChunkMarkers ?? true;
  const content = chunk.content ? chunk.content.trim() : "";

  if (!includeMarkers) {
    if (chunk.name) {
      return `## ${chunk.name}\n\n${content}`;
    }
    return content;
  }

  // Build attribute string
  const attrs: string[] = [`id="${chunk.uid}"`, `type="${chunk.type || "text"}"`];
  if (chunk.name) {
    attrs.push(`name="${chunk.name.replace(/"/g, "&quot;")}"`);
  }
  if (chunk.attributes) {
    for (const [k, v] of Object.entries(chunk.attributes)) {
      attrs.push(`${k}="${String(v).replace(/"/g, "&quot;")}"`);
    }
  }

  const attrStr = attrs.join(" ");
  return `<!-- harpy:chunk ${attrStr} -->\n${content}\n<!-- /harpy:chunk -->`;
}

/**
 * Serializes a HarpyMarkdownDocument AST into a full Markdown string.
 */
export function serializeMarkdown(
  doc: HarpyMarkdownDocument,
  options?: MarkdownSerializerOptions
): string {
  const isCrlf = options?.lineEnding === "crlf";
  const parts: string[] = [];

  // 1. Frontmatter
  const frontmatterStr = serializeFrontmatter(doc.frontmatter);
  if (frontmatterStr) {
    parts.push(frontmatterStr.trim());
  }

  // 2. Leading content
  if (doc.leadingContent && doc.leadingContent.trim()) {
    parts.push(doc.leadingContent.trim());
  }

  // 3. Chunks
  for (const chunk of doc.chunks) {
    const chunkStr = serializeChunk(chunk, options);
    if (chunkStr) {
      parts.push(chunkStr);
    }
  }

  // 4. Trailing content
  if (doc.trailingContent && doc.trailingContent.trim()) {
    parts.push(doc.trailingContent.trim());
  }

  const result = parts.join("\n\n") + "\n";
  return isCrlf ? result.replace(/\n/g, "\r\n") : result;
}
