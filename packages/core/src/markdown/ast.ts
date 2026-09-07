/**
 * AST Node representing a Harpy Markdown Chunk.
 */
export interface HarpyChunkNode {
  /** Unique identifier of the chunk (matches Harpy chunk UID) */
  uid: string;
  /** Chunk type: 'text', 'gallery', 'random', 'widget', etc. */
  type: string;
  /** Optional chunk title or display name */
  name?: string;
  /** Inner markdown or text content of the chunk */
  content: string;
  /** Optional extra HTML comment attributes */
  attributes?: Record<string, string | number | boolean>;
  /** Raw comment header string if preserved */
  rawHeader?: string;
}

/**
 * Parsed representation of a Harpy Markdown document (Obsidian note).
 */
export interface HarpyMarkdownDocument {
  /** Parsed YAML frontmatter object */
  frontmatter: Record<string, unknown>;
  /** Raw unparsed YAML frontmatter content (without '---' markers) */
  rawFrontmatter?: string;
  /** Any markdown content located before the first chunk marker */
  leadingContent: string;
  /** Array of structured Harpy chunks */
  chunks: HarpyChunkNode[];
  /** Any markdown content located after the last chunk marker */
  trailingContent: string;
  /** Indicates whether the document contained explicit <!-- harpy:chunk --> markers */
  hasExplicitChunks: boolean;
}

/**
 * Options for parsing Markdown content into a Harpy document AST.
 */
export interface MarkdownParserOptions {
  /** Default chunk type when none is specified (default: 'text') */
  defaultChunkType?: string;
  /** If true, fallback to parsing markdown headings as chunks when no comment markers are found */
  parseHeadingsAsChunksFallback?: boolean;
}

/**
 * Options for serializing a Harpy document AST back to Markdown.
 */
export interface MarkdownSerializerOptions {
  /** If true, include explicit <!-- harpy:chunk --> comments in output (default: true) */
  includeChunkMarkers?: boolean;
  /** Line break style: 'lf' | 'crlf' (default: 'lf') */
  lineEnding?: 'lf' | 'crlf';
}
