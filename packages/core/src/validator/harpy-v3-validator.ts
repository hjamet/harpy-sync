/**
 * Validateur et parseur canonique Harpy v3 pour @harpy/core
 * Conforme aux règles d'Henri et aligné sur harpy_entity_validator.py
 */

export const MAX_DESCRIPTION_EXTERNE_CHARS = 100;
export const MIN_RESUME_MJ_CHARS = 350;
export const MIN_DESCRIPTION_JOUEURS_CHARS = 450;
export const DEFAULT_MAX_HARPY_LINE_LENGTH = 70;

export interface HarpyV3Blocks {
  imageWikilink?: string;
  descriptionExterne?: string;
  aideImprovisation?: string;
  resumeMj?: string;
  secretsMj?: string;
  descriptionJoueurs?: string;
  blocHarpy?: string;
}

export interface HarpyV3ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  blocks: HarpyV3Blocks;
}

interface CodeBlock {
  lang: string;
  content: string;
  startIndex: number;
}

function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let currentBlock: { lang: string; lines: string[]; startIndex: number } | null = null;
  let charCursor = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (currentBlock === null) {
        // Ouverture de bloc
        const lang = trimmed.slice(3).trim().toLowerCase();
        currentBlock = { lang, lines: [], startIndex: charCursor };
      } else {
        // Fermeture de bloc
        blocks.push({
          lang: currentBlock.lang,
          content: currentBlock.lines.join("\n"),
          startIndex: currentBlock.startIndex,
        });
        currentBlock = null;
      }
    } else if (currentBlock !== null) {
      currentBlock.lines.push(line);
    }
    charCursor += line.length + 1; // +1 pour newline
  }

  return blocks;
}

export function parseHarpyEntityV3(markdown: string): HarpyV3Blocks {
  const blocks: HarpyV3Blocks = {};

  // 1. Image wikilink
  const imgMatch = /!\[\[(.*?)\]\]/.exec(markdown);
  if (imgMatch) {
    blocks.imageWikilink = imgMatch[1].trim();
  }

  // Nettoyage frontmatter YAML pour le découpage des sections
  const content = markdown.replace(/^---[\r\n]+[\s\S]*?[\r\n]+---[\r\n]*/, "");

  // Extraction propre de tous les blocs de code
  const codeBlocks = extractCodeBlocks(content);

  // Localisation de la section ## 🎭
  const improPos = content.search(/##\s*🎭/);

  // Bloc 2 : Description externe (premier bloc text situé avant ## 🎭 ou avant tout H2)
  const textBlocks = codeBlocks.filter((b) => b.lang === "text" || b.lang === "");
  if (textBlocks.length > 0) {
    const firstTextBlock = textBlocks[0];
    if (improPos === -1 || firstTextBlock.startIndex < improPos) {
      blocks.descriptionExterne = firstTextBlock.content.trim();
    }
  }

  // Aide à l'improvisation (sous ## 🎭)
  const improMatch = /##\s*🎭[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n##\s*🗝️|\r?\n##\s*🔒|\r?\n```|$)/.exec(content);
  if (improMatch) {
    blocks.aideImprovisation = improMatch[1].trim();
  }

  // Résumé MJ (sous ## 🗝️)
  const resumeMatch = /##\s*🗝️[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n##\s*🔒|\r?\n```|$)/.exec(content);
  if (resumeMatch) {
    blocks.resumeMj = resumeMatch[1].trim();
  }

  // Secrets MJ (sous ## 🔒)
  const secretsMatch = /##\s*🔒[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n```markdown|\r?\n```|$)/.exec(content);
  if (secretsMatch) {
    blocks.secretsMj = secretsMatch[1].trim();
  }

  // Bloc 4 : Description Joueurs (bloc avec lang === 'markdown', ou bloc entre secrets et bloc Harpy)
  const markdownBlocks = codeBlocks.filter((b) => b.lang === "markdown");
  if (markdownBlocks.length > 0) {
    blocks.descriptionJoueurs = markdownBlocks[0].content.trim();
  }

  // Bloc 5 : Fiche Harpy (dernier bloc text distinct de la description externe)
  if (textBlocks.length > 1) {
    blocks.blocHarpy = textBlocks[textBlocks.length - 1].content.trim();
  } else if (textBlocks.length === 1 && textBlocks[0].content.trim() !== blocks.descriptionExterne) {
    blocks.blocHarpy = textBlocks[0].content.trim();
  }

  return blocks;
}

export function validateHarpyBloc5Text(
  bloc: string,
  maxLineLen = DEFAULT_MAX_HARPY_LINE_LENGTH
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!bloc || !bloc.trim()) {
    errors.push("Le bloc de statistiques Harpy (Bloc 5) est vide ou manquant.");
    return { valid: false, errors };
  }

  const lines = bloc.split(/\r?\n/);
  const forbiddenPatterns: [RegExp, string][] = [
    [/\|/, "Tableau Markdown ('|')"],
    [/\*\*/, "Gras Markdown ('**')"],
    [/__/, "Gras Markdown ('__')"],
    [/^\s*#+\s+/, "Titre Markdown ('#')"],
    [/`/, "Backtick de code ('`')"],
    [/\[\[.*?\]\]/, "Wikilink Obsidian ('[[...]]')"],
    [/\[.*?\]\(.*?\)/, "Lien Markdown ('[texte](url)')"],
    [/^\s*>\s*/, "Citation Markdown ('>')"],
    [/^\s*-\s*\[[ xX]\]/, "Case à cocher Markdown ('- [ ]')"],
  ];

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const charCount = Array.from(line).length;
    if (charCount > maxLineLen) {
      errors.push(`Ligne ${lineNum} : Ligne trop longue (${charCount} car. > ${maxLineLen} max) -> '${line.slice(0, 50)}...'`);
    }

    for (const [pattern, label] of forbiddenPatterns) {
      if (pattern.test(line)) {
        errors.push(`Ligne ${lineNum} : Syntaxe Markdown interdite détectée [${label}] -> '${line.slice(0, 50)}...'`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

export function validateHarpyEntityV3(
  markdown: string,
  options?: { entityName?: string; maxLineLen?: number }
): HarpyV3ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const maxLineLen = options?.maxLineLen ?? DEFAULT_MAX_HARPY_LINE_LENGTH;
  const blocks = parseHarpyEntityV3(markdown);

  // Contrôle 1 : Zéro mention de source
  // On ignore le titre officiel standardisé H3 généré par harpy_entity_validator.py
  const textToCheckSources = markdown.replace(
    /###\s+🗝️\s+Quels sont les secrets inavouables,\s+le statut canonique et les liaisons d'intrigue\s*\?/gi,
    ""
  );

  const forbiddenSources: [RegExp, string][] = [
    [/\(canon\)/i, "Mention '(canon)'"],
    [/\(proposition\s+mj\)/i, "Mention '(proposition MJ)'"],
    [/\bproposition\s+mj\b/i, "Mention 'proposition MJ'"],
    [/\bcanonique\b/i, "Mention 'canonique'"],
    [/\bp\.\s*\d+\b/i, "Mention de page 'p. XX'"],
    [/\bpages?\s*\d+\b/i, "Mention de page 'page XX'"],
    [/\bvoicenote\b/i, "Mention de source 'voicenote'"],
    [/\btranscript\b/i, "Mention de source 'transcript'"],
    [/\bmodule\b/i, "Mention de source 'module'"],
  ];

  for (const [pattern, label] of forbiddenSources) {
    if (pattern.test(textToCheckSources)) {
      errors.push(`Mention de source interdite détectée [${label}] -> Aucune mention de source ne doit figurer dans la note (traçabilité réservée au rapport).`);
    }
  }

  // Contrôle 2 : Bloc 2 Description Externe
  if (!blocks.descriptionExterne || !blocks.descriptionExterne.trim()) {
    errors.push("Le Bloc 2 (Description externe) est vide ou manquant.");
  } else {
    const desc = blocks.descriptionExterne.trim();
    const count = Array.from(desc).length;
    if (count > MAX_DESCRIPTION_EXTERNE_CHARS) {
      errors.push(`Description externe trop longue : ${count} caractères (maximum strict : ${MAX_DESCRIPTION_EXTERNE_CHARS}).`);
    }
    if (options?.entityName && options.entityName.trim()) {
      const entityParts = options.entityName
        .trim()
        .split(/[\s'-]+/)
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p.length >= 3);
      const descLower = desc.toLowerCase();
      for (const part of entityParts) {
        const regex = new RegExp(`\\b${part}\\b`, "i");
        if (regex.test(descLower)) {
          errors.push(`Nom de l'entité interdit dans la description externe : '${part}'. La description externe ne doit mentionner strictement que l'apparence physique visible.`);
        }
      }
    }
  }

  // Contrôle 3 : Ouverture double H2
  if (!blocks.aideImprovisation || !blocks.aideImprovisation.trim()) {
    errors.push("Le paragraphe d'aide à l'improvisation ('## 🎭 Comment l'improviser ?') est manquant.");
  } else {
    if (!/\*\*.*?\*\*/.test(blocks.aideImprovisation)) {
      errors.push("Le paragraphe d'aide à l'improvisation doit mettre en valeur les mots clés importants en **gras**.");
    }
  }

  if (!blocks.resumeMj || !blocks.resumeMj.trim()) {
    errors.push("Le paragraphe de résumé de fond MJ ('## 🗝️ Qui est-il vraiment ?') est manquant.");
  } else {
    const countResume = Array.from(blocks.resumeMj.trim()).length;
    if (countResume < MIN_RESUME_MJ_CHARS) {
      errors.push(`Le résumé MJ est trop court : ${countResume} caractères (minimum strict : ${MIN_RESUME_MJ_CHARS} caractères).`);
    }
  }

  // Contrôle 4 : Bloc 4 Description Joueurs
  if (!blocks.descriptionJoueurs || !blocks.descriptionJoueurs.trim()) {
    errors.push("Le Bloc 4 (Description Joueurs) est manquant ou vide.");
  } else {
    const descJ = blocks.descriptionJoueurs.trim();
    const countJ = Array.from(descJ).length;
    if (countJ < MIN_DESCRIPTION_JOUEURS_CHARS) {
      errors.push(`La description joueurs est trop courte : ${countJ} caractères (minimum strict requis : ${MIN_DESCRIPTION_JOUEURS_CHARS} caractères).`);
    }
    const paragraphs = descJ.split(/\r?\n\s*\r?\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length > 2) {
      errors.push(`La description joueurs contient ${paragraphs.length} paragraphes (maximum autorisé : 2 paragraphes).`);
    }

    const sceneMarkers: [RegExp, string][] = [
      [/\b(?:à\s+l'|dès\s+l')?aube\b/i, "moment de la journée ('aube')"],
      [/\b(?:ce\s+|en\s+|début\s+d')?après-midi\b/i, "moment de la journée ('après-midi')"],
      [/\b(?:au\s+)?crépuscule\b/i, "moment de la journée ('crépuscule')"],
      [/\b(?:à\s+la\s+)?nuit\s+tombante\b/i, "moment de la journée ('nuit tombante')"],
      [/\bplein\s+midi\b/i, "moment de la journée ('plein midi')"],
      [/\bpluie\s+battante\b/i, "météo ponctuelle ('pluie battante')"],
      [/\b(?:sous\s+la\s+|fine\s+)?pluie\b/i, "météo ponctuelle ('pluie')"],
      [/\b(?:dans\s+la\s+|épaisse\s+)?brume\b/i, "météo ponctuelle ('brume')"],
      [/\baverse\b/i, "météo ponctuelle ('averse')"],
      [/\btempête\b/i, "météo ponctuelle ('tempête')"],
    ];

    for (const [pattern, label] of sceneMarkers) {
      const match = pattern.exec(descJ);
      if (match) {
        warnings.push(`Marqueur de scène contextuelle détecté [${label}] : '${match[0]}'. Règle d'Henri : Les descriptions pour les joueurs doivent être générales et indépendantes d'une météo ou heure spécifique.`);
      }
    }
  }

  // Contrôle 5 : Bloc 5 Fiche Harpy
  if (!blocks.blocHarpy || !blocks.blocHarpy.trim()) {
    errors.push("Le Bloc 5 (Fiche Harpy) est vide ou manquant.");
  } else {
    const bloc5Result = validateHarpyBloc5Text(blocks.blocHarpy, maxLineLen);
    if (!bloc5Result.valid) {
      errors.push(...bloc5Result.errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    blocks,
  };
}

export const validateHarpyV3Markdown = validateHarpyEntityV3;
