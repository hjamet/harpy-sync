/**
 * Moteur mécanique d'Asharde & Composé Temps / Scène Général pour @harpy/core
 * Conforme au système de règles d'Asharde et aux spécifications d'Henri Jamet.
 */

export const ASHARDE_STATS = [
  "force",
  "agilite",
  "vitesse",
  "perception",
  "chance",
  "attractivite",
  "autorite",
  "evolution",
  "intelligence",
  "conscience",
] as const;

export type AshardeStatName = (typeof ASHARDE_STATS)[number];

export type AshardeImpairmentTier = "temporaire" | "mineur" | "majeur" | "definitif";

export interface AshardeStatImpairments {
  temporaire: number;
  mineur: number;
  majeur: number;
  definitif: number;
}

export interface AshardeStatBlock {
  base: number;
  impairments: AshardeStatImpairments;
  bonus?: number;
}

export interface AshardeBleeding {
  id: string;
  source: string;
  curabilitySD: 3 | 6;
  active: boolean;
}

export interface AshardeWeaponSignatureEntry {
  roll: number;
  targetStat: AshardeStatName;
  tier: AshardeImpairmentTier;
}

export interface AshardeWeapon {
  name: string;
  signatureTable: AshardeWeaponSignatureEntry[];
}

export interface AshardeConnection {
  targetEntityId: string;
  relation: string;
  notes?: string;
}

export interface AshardeCharacterSheet {
  id: string;
  name: string;
  archetype?: "arcaniste" | "reveur" | "autre";
  stats: Record<AshardeStatName, AshardeStatBlock>;
  armorQuality: number;
  activeBleedings: AshardeBleeding[];
  sceneAbilitiesUsed?: Record<string, boolean>;
  connections?: AshardeConnection[];
  weapons?: AshardeWeapon[];
}

export type AshardeTimeTransition = "action_end" | "calm_scene" | "rest_scene" | "long_time" | "ellipse";

export interface AshardeTimeSceneCompound {
  currentTransition: AshardeTimeTransition;
  timestamp: string;
  activeSceneNotes?: string;
}

/**
 * Calcule le score effectif d'une caractéristique selon la formule canonique :
 * Math.max(0, base + bonus - max(temporaire, mineur, majeur, definitif))
 */
export function computeEffectiveStat(stat: AshardeStatBlock): number {
  const maxImpairment = Math.max(
    stat.impairments.temporaire,
    stat.impairments.mineur,
    stat.impairments.majeur,
    stat.impairments.definitif
  );
  return Math.max(0, stat.base + (stat.bonus ?? 0) - maxImpairment);
}

/**
 * Calcule le Seuil de Difficulté (SD) passif de réaction selon la table exacte d'Asharde :
 * <= 1 -> -1, 2..4 -> 0, 5 -> 1, 6 -> 2, 7 -> 3, 8 -> 5, 9 -> 7, >= 10 -> 8
 */
export function computePassiveSaveSD(effectiveStat: number): number {
  if (effectiveStat <= 1) return -1;
  if (effectiveStat <= 4) return 0;
  if (effectiveStat === 5) return 1;
  if (effectiveStat === 6) return 2;
  if (effectiveStat === 7) return 3;
  if (effectiveStat === 8) return 5;
  if (effectiveStat === 9) return 7;
  return 8;
}

/**
 * Calcule la réserve de Pouvoir magique selon l'archétype :
 * - arcaniste -> Evolution effective
 * - reveur -> Intelligence effective
 * - autre -> min(Evolution eff, Intelligence eff)
 */
export function computeMagicPower(
  evolutionEff: number,
  intelligenceEff: number,
  archetype: "arcaniste" | "reveur" | "autre" = "autre"
): number {
  if (archetype === "arcaniste") return evolutionEff;
  if (archetype === "reveur") return intelligenceEff;
  return Math.min(evolutionEff, intelligenceEff);
}

/**
 * Calcule le malus d'armure appliqué à la Vitesse :
 * Math.floor(Math.max(0, armorQuality) / 2)
 */
export function computeArmorSpeedPenalty(armorQuality: number): number {
  return Math.floor(Math.max(0, armorQuality) / 2);
}

/**
 * Réduit les affaiblissements reçus selon la Qualité d'armure.
 * Chaque point de Qualité d'armure descend d'un cran l'affaiblissement le plus grave reçu :
 * definitif -> majeur -> mineur -> temporaire.
 */
export function applyArmorQualityReduction(
  impairments: AshardeStatImpairments,
  armorQuality: number
): AshardeStatImpairments {
  const result: AshardeStatImpairments = { ...impairments };
  let points = Math.max(0, armorQuality);

  while (points > 0) {
    if (result.definitif > 0) {
      result.definitif--;
      result.majeur++;
      points--;
    } else if (result.majeur > 0) {
      result.majeur--;
      result.mineur++;
      points--;
    } else if (result.mineur > 0) {
      result.mineur--;
      result.temporaire++;
      points--;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Applique un affaiblissement avec gestion du débordement vers Conscience,
 * calcul du SD de KO et déclenchement de Saignement sur Conscience majeure/définitive.
 */
export function applyImpairmentWithOverflow(
  sheet: AshardeCharacterSheet,
  targetStat: AshardeStatName,
  tier: AshardeImpairmentTier,
  count: number
): {
  sheet: AshardeCharacterSheet;
  koSaveSD: number | null;
  bleedingTriggered: { curabilitySD: 3 | 6 } | null;
  deathSaveRequired: boolean;
} {
  const cloned: AshardeCharacterSheet = JSON.parse(JSON.stringify(sheet));
  const conscienceTiersReceived: Record<AshardeImpairmentTier, number> = {
    temporaire: 0,
    mineur: 0,
    majeur: 0,
    definitif: 0,
  };

  for (let i = 0; i < count; i++) {
    if (targetStat !== "conscience") {
      const currentEff = computeEffectiveStat(cloned.stats[targetStat]);
      if (currentEff > 0) {
        cloned.stats[targetStat].impairments[tier]++;
      } else {
        // Redirection vers conscience
        cloned.stats.conscience.impairments[tier]++;
        conscienceTiersReceived[tier]++;
      }
    } else {
      cloned.stats.conscience.impairments[tier]++;
      conscienceTiersReceived[tier]++;
    }
  }

  // Calcul du jet de sauvegarde contre le KO si Conscience a été touchée
  let koSaveSD: number | null = null;
  if (
    conscienceTiersReceived.definitif > 0 ||
    conscienceTiersReceived.majeur > 0 ||
    conscienceTiersReceived.mineur > 0 ||
    conscienceTiersReceived.temporaire > 0
  ) {
    if (conscienceTiersReceived.definitif > 0) {
      koSaveSD = 5;
    } else if (conscienceTiersReceived.majeur > 0) {
      koSaveSD = 3;
    } else if (conscienceTiersReceived.mineur > 0) {
      koSaveSD = 2;
    } else {
      koSaveSD = 1;
    }
  }

  // Déclenchement de saignement si Conscience a subi un affaiblissement majeur (SD 3) ou définitif (SD 6)
  let bleedingTriggered: { curabilitySD: 3 | 6 } | null = null;
  if (conscienceTiersReceived.definitif > 0) {
    bleedingTriggered = { curabilitySD: 6 };
    cloned.activeBleedings.push({
      id: `bleed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: `Blessure Conscience (définitif)`,
      curabilitySD: 6,
      active: true,
    });
  } else if (conscienceTiersReceived.majeur > 0) {
    bleedingTriggered = { curabilitySD: 3 };
    cloned.activeBleedings.push({
      id: `bleed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: `Blessure Conscience (majeur)`,
      curabilitySD: 3,
      active: true,
    });
  }

  const finalConscienceEff = computeEffectiveStat(cloned.stats.conscience);
  const deathSaveRequired = finalConscienceEff === 0;

  return {
    sheet: cloned,
    koSaveSD,
    bleedingTriggered,
    deathSaveRequired,
  };
}

/**
 * Valide une table de signature d'arme selon la règle canonique :
 * Poids : temporaire = 1, mineur = 2, majeur = 4, definitif = 8.
 * Pour chaque caractéristique présente, la somme des poids doit être <= 10.
 */
export function validateWeaponSignatureTable(
  entries: AshardeWeaponSignatureEntry[]
): { valid: boolean; statWeights: Record<string, number>; errors: string[] } {
  const errors: string[] = [];
  const statWeights: Record<string, number> = {};
  const tierWeights: Record<AshardeImpairmentTier, number> = {
    temporaire: 1,
    mineur: 2,
    majeur: 4,
    definitif: 8,
  };

  for (const entry of entries) {
    const w = tierWeights[entry.tier] ?? 1;
    statWeights[entry.targetStat] = (statWeights[entry.targetStat] ?? 0) + w;
  }

  for (const [stat, totalWeight] of Object.entries(statWeights)) {
    if (totalWeight > 10) {
      errors.push(
        `Signature d'arme invalide pour '${stat}' : somme des poids = ${totalWeight} (maximum autorisé : 10).`
      );
    }
  }

  return {
    valid: errors.length === 0,
    statWeights,
    errors,
  };
}

/**
 * Transition temporelle du Composé Temps / Scène Général.
 * Applique la guérison naturelle des affaiblissements selon le type de Temps / Scène :
 * - action_end : temporaire -> 0
 * - calm_scene : temporaire -> 0, réinitialise sceneAbilitiesUsed
 * - rest_scene (8h) : temporaire et mineur -> 0, réinitialise sceneAbilitiesUsed
 * - long_time (~2 sem.) : temporaire, mineur et majeur -> 0, réinitialise sceneAbilitiesUsed
 * - ellipse (mois/années) : tout -> 0, réinitialise sceneAbilitiesUsed
 * Les saignements actifs ne guérissent pas naturellement et lèvent une alerte.
 */
export function advanceAshardeSceneOrTime(
  sheet: AshardeCharacterSheet,
  transition: AshardeTimeTransition
): {
  sheet: AshardeCharacterSheet;
  healedTiers: AshardeImpairmentTier[];
  bleedingTickAlert: boolean;
  deathRollAlert: boolean;
} {
  const cloned: AshardeCharacterSheet = JSON.parse(JSON.stringify(sheet));
  const healedTiers: AshardeImpairmentTier[] = [];

  switch (transition) {
    case "action_end":
      healedTiers.push("temporaire");
      break;
    case "calm_scene":
      healedTiers.push("temporaire");
      cloned.sceneAbilitiesUsed = {};
      break;
    case "rest_scene":
      healedTiers.push("temporaire", "mineur");
      cloned.sceneAbilitiesUsed = {};
      break;
    case "long_time":
      healedTiers.push("temporaire", "mineur", "majeur");
      cloned.sceneAbilitiesUsed = {};
      break;
    case "ellipse":
      healedTiers.push("temporaire", "mineur", "majeur", "definitif");
      cloned.sceneAbilitiesUsed = {};
      break;
  }

  // Application des guérisons sur les 10 caractéristiques
  for (const statName of ASHARDE_STATS) {
    const stat = cloned.stats[statName];
    if (stat) {
      for (const tier of healedTiers) {
        stat.impairments[tier] = 0;
      }
    }
  }

  // Alertes saignement et jet de mort
  const activeBleedingsCount = (cloned.activeBleedings ?? []).filter((b) => b.active).length;
  const bleedingTickAlert = activeBleedingsCount > 0;
  const deathRollAlert = computeEffectiveStat(cloned.stats.conscience) === 0;

  return {
    sheet: cloned,
    healedTiers,
    bleedingTickAlert,
    deathRollAlert,
  };
}

/**
 * Formate le Bloc 5 Harpy pour Asharde en texte pur strict :
 * Longueur <= 70 car./ligne, sous-lignes '↳', zéro syntaxe Markdown, émojis autorisés.
 */
export function formatAshardeHarpyStatblock(sheet: AshardeCharacterSheet): string {
  const lines: string[] = [];

  // En-tête Identité
  lines.push(`👤 ${sheet.name.slice(0, 60)}`);

  // Défense & Survie
  const effConscience = computeEffectiveStat(sheet.stats.conscience);
  const baseConscience = sheet.stats.conscience.base;
  const passiveSDConscience = computePassiveSaveSD(effConscience);
  const penaltyArmor = computeArmorSpeedPenalty(sheet.armorQuality);
  const activeBleedings = (sheet.activeBleedings ?? []).filter((b) => b.active);

  lines.push("🛡️ DÉFENSE & SURVIE");
  lines.push(`↳ Qualité armure : ${sheet.armorQuality} (Malus Vitesse : -${penaltyArmor})`);
  lines.push(
    `↳ Conscience : ${effConscience}/${baseConscience} (Sauvegarde Passive : SD ${passiveSDConscience})`
  );
  if (activeBleedings.length > 0) {
    const bSummary = activeBleedings.map((b) => `SD ${b.curabilitySD}`).join(", ");
    lines.push(`↳ Saignements actifs : ${activeBleedings.length} (${bSummary})`);
  } else {
    lines.push("↳ Saignements : Aucun");
  }

  // Tactique & Combat
  const effVitesse = computeEffectiveStat(sheet.stats.vitesse);
  const effPerception = computeEffectiveStat(sheet.stats.perception);
  const passiveSDPerception = computePassiveSaveSD(effPerception);

  lines.push("⚡ TACTIQUE & COMBAT");
  lines.push(`↳ Initiative : ${effVitesse} - 1d10`);
  lines.push(`↳ Vitesse effective : ${effVitesse} (Base : ${sheet.stats.vitesse.base})`);
  lines.push(`↳ Perception passive : SD ${passiveSDPerception}`);

  // Magie du Rêve
  const effEvo = computeEffectiveStat(sheet.stats.evolution);
  const effIntel = computeEffectiveStat(sheet.stats.intelligence);
  const power = computeMagicPower(effEvo, effIntel, sheet.archetype);
  lines.push("✨ MAGIE DU RÊVE");
  lines.push(`↳ Pouvoir magique : ${power} (${sheet.archetype ?? "commun"})`);

  // Caractéristiques canoniques (10)
  lines.push("📊 CARACTÉRISTIQUES (Effectif / Base [SD Passif])");
  const statLabels: Record<AshardeStatName, string> = {
    force: "Force",
    agilite: "Agilité",
    vitesse: "Vitesse",
    perception: "Perception",
    chance: "Chance",
    attractivite: "Attractivité",
    autorite: "Autorité",
    evolution: "Évolution",
    intelligence: "Intelligence",
    conscience: "Conscience",
  };

  for (const statName of ASHARDE_STATS) {
    const st = sheet.stats[statName];
    const eff = computeEffectiveStat(st);
    const sd = computePassiveSaveSD(eff);
    const label = statLabels[statName];
    lines.push(`↳ ${label} : ${eff}/${st.base} [SD ${sd}]`);
  }

  // Armes si présentes
  if (sheet.weapons && sheet.weapons.length > 0) {
    lines.push("⚔️ ARMES & SIGNATURES");
    for (const weapon of sheet.weapons) {
      lines.push(`↳ ${weapon.name.slice(0, 60)}`);
      if (weapon.signatureTable && weapon.signatureTable.length > 0) {
        const sigEntries = weapon.signatureTable
          .map((e) => `d${e.roll}:${e.targetStat.slice(0, 3)}=${e.tier.slice(0, 3)}`)
          .join(" ");
        lines.push(`  ↳ Table : ${sigEntries.slice(0, 58)}`);
      }
    }
  }

  // Connexions Harpy.gg si présentes
  if (sheet.connections && sheet.connections.length > 0) {
    lines.push("🔗 CONNEXIONS ENTITÉS HARPY.GG");
    for (const conn of sheet.connections) {
      const connLine = `↳ ${conn.relation} -> ${conn.targetEntityId}`;
      lines.push(connLine.slice(0, 68));
    }
  }

  return lines.join("\n");
}
