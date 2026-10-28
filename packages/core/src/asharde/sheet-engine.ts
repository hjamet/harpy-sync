/**
 * Moteur mécanique d'Asharde & Composé Scène Général pour @harpy/core
 * Conforme au système de règles officiel d'Asharde (commit bcf59fa) et aux spécifications d'Henri Jamet.
 * Échelle officielle : affaiblissements 1 / 3 / 6 points & guérison 1 / 10 / 100 Scènes.
 * Seuil de mort par caractéristique négative (< -Constitution).
 */

export const ASHARDE_CANONICAL_STATS = [
  "force",
  "agilite",
  "constitution",
  "intelligence",
  "perception",
  "volonte",
  "charisme",
  "autorite",
  "conscience",
  "evolution",
] as const;

export const ASHARDE_STATS = [
  "force",
  "agilite",
  "constitution",
  "intelligence",
  "perception",
  "volonte",
  "charisme",
  "autorite",
  "conscience",
  "evolution",
  // Rétrocompatibilité et aliases d'antériorité
  "vitesse",
  "chance",
  "attractivite",
  "erudition",
] as const;

export type AshardeStatName = (typeof ASHARDE_STATS)[number] | string;

export type AshardeImpairmentTier = "temporaire" | "mineur" | "majeur" | "definitif";

export const ASHARDE_IMPAIRMENT_WEIGHTS = {
  temporaire: 1,
  mineur: 3,
  majeur: 6,
  definitif: 8,
} as const;

export const ASHARDE_IMPAIRMENT_HEAL_SCENES = {
  temporaire: 1,
  mineur: 10,
  majeur: 100,
  definitif: Infinity,
} as const;

export interface AshardeStatImpairments {
  temporaire: number;
  mineur: number;
  majeur: number;
  definitif?: number;
}

export interface AshardeStatBlock {
  base: number;
  impairments: AshardeStatImpairments;
  bonus?: number;
}

export interface AshardeActiveImpairment {
  id: string;
  targetStat: AshardeStatName;
  tier: AshardeImpairmentTier;
  penalty: number;
  scenesRemaining: number;
  initialScenes: number;
  source?: string;
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
  id?: string;
  name: string;
  quality?: number;
  wearPenalty?: number;
  signatureTable: AshardeWeaponSignatureEntry[];
  description?: string;
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
  stats: Record<string, AshardeStatBlock>;
  armorQuality: number;
  activeBleedings: AshardeBleeding[];
  activeImpairments?: AshardeActiveImpairment[];
  sceneAbilitiesUsed?: Record<string, boolean>;
  connections?: AshardeConnection[];
  weapons?: AshardeWeapon[];
}

export interface AshardeSceneCompound {
  id?: string;
  name?: string;
  entityType?: "compound";
  sceneCounter: number;
  lastDelta: number;
  activeSceneLabel?: string;
}

export type AshardeTimeTransition = "action_end" | "calm_scene" | "rest_scene" | "long_time" | "ellipse";

export interface AshardeTimeSceneCompound {
  currentTransition: AshardeTimeTransition;
  timestamp: string;
  activeSceneNotes?: string;
}

export interface AshardeDeathCheckResult {
  isDead: boolean;
  baseConstitution: number;
  deathThreshold: number;
  criticalStats: Array<{
    stat: string;
    base: number;
    effective: number;
    totalPenalty: number;
  }>;
  details: string;
}

export interface AshardeWeaponEffective {
  weapon: AshardeWeapon;
  effectiveQuality: number;
  hitThreshold: number;
  isBroken: boolean;
  distinctStatsCount: number;
}

/**
 * Calcule la pénalité totale cumulée d'affaiblissements sur une caractéristique :
 * Formule officielle : sum(1 * temp + 3 * min + 6 * maj + 8 * def)
 */
export function computeTotalStatPenalty(impairments: AshardeStatImpairments): number {
  return (
    (impairments.temporaire ?? 0) * ASHARDE_IMPAIRMENT_WEIGHTS.temporaire +
    (impairments.mineur ?? 0) * ASHARDE_IMPAIRMENT_WEIGHTS.mineur +
    (impairments.majeur ?? 0) * ASHARDE_IMPAIRMENT_WEIGHTS.majeur +
    ((impairments.definitif ?? 0) * ASHARDE_IMPAIRMENT_WEIGHTS.definitif)
  );
}

/**
 * Calcule le score effectif d'une caractéristique selon la formule officielle :
 * effectiveValue = baseValue + (bonus ?? 0) - totalPenalty (1/3/6)
 * Par défaut, renvoie max(0, effectiveValue). Si allowNegative est true, renvoie la valeur brute
 * (nécessaire pour évaluer le seuil de mort et l'érosion continue sous 0).
 */
export function computeEffectiveStat(
  stat: AshardeStatBlock,
  options?: { allowNegative?: boolean; legacyMaxMode?: boolean } | boolean
): number {
  const allowNegative = typeof options === "boolean" ? options : (options?.allowNegative ?? false);
  const legacyMode = typeof options === "object" && options?.legacyMaxMode;

  if (legacyMode) {
    const maxImpairment = Math.max(
      stat.impairments.temporaire ?? 0,
      stat.impairments.mineur ?? 0,
      stat.impairments.majeur ?? 0,
      stat.impairments.definitif ?? 0
    );
    const rawLegacy = stat.base + (stat.bonus ?? 0) - maxImpairment;
    return allowNegative ? rawLegacy : Math.max(0, rawLegacy);
  }

  const penalty = computeTotalStatPenalty(stat.impairments);
  const raw = stat.base + (stat.bonus ?? 0) - penalty;
  return allowNegative ? raw : Math.max(0, raw);
}

/**
 * Seuil de Mort par Caractéristique Négative (< -Constitution) :
 * Le personnage est en état de mort critique (isDead: true) dès qu'au moins une
 * caractéristique effective tombe strictement en dessous de -constitution.base
 * (effectiveValue < -baseConstitution, ex. -4 pour Constitution 3).
 */
export function checkDeathThreshold(sheet: AshardeCharacterSheet): AshardeDeathCheckResult {
  const constStat = sheet.stats["constitution"] ?? sheet.stats["conscience"];
  const baseConstitution = constStat ? constStat.base : 5;
  const deathThreshold = -baseConstitution;

  const criticalStats: AshardeDeathCheckResult["criticalStats"] = [];

  for (const [statName, statBlock] of Object.entries(sheet.stats)) {
    if (!statBlock) continue;
    const effective = computeEffectiveStat(statBlock, { allowNegative: true });
    if (effective < deathThreshold) {
      criticalStats.push({
        stat: statName,
        base: statBlock.base,
        effective,
        totalPenalty: computeTotalStatPenalty(statBlock.impairments),
      });
    }
  }

  const isDead = criticalStats.length > 0;
  const details = isDead
    ? `Mort critique atteinte (< -${baseConstitution}) : ${criticalStats
        .map((s) => `${s.stat}=${s.effective}`)
        .join(", ")}`
    : `Personnage vivant (seuil de mort strict à < -${baseConstitution})`;

  return {
    isDead,
    baseConstitution,
    deathThreshold,
    criticalStats,
    details,
  };
}

/**
 * Calcule l'efficacité d'une arme connectée :
 * hitThreshold = 10 - weaponEffectiveQuality (où weaponEffectiveQuality = max(0, quality - wearPenalty))
 * Si quality n'est pas spécifié, quality = 10 - n (n = nombre de caractéristiques distinctes).
 */
export function computeWeaponEffective(weapon: AshardeWeapon): AshardeWeaponEffective {
  const distinctStats = new Set(weapon.signatureTable.map((e) => e.targetStat));
  const distinctStatsCount = distinctStats.size;
  const baseQuality = weapon.quality ?? Math.max(0, 10 - distinctStatsCount);
  const wear = weapon.wearPenalty ?? 0;
  const effectiveQuality = Math.max(0, baseQuality - wear);
  const isBroken = effectiveQuality === 0;
  const hitThreshold = 10 - effectiveQuality;

  return {
    weapon,
    effectiveQuality,
    hitThreshold,
    isBroken,
    distinctStatsCount,
  };
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
  const result: AshardeStatImpairments = {
    temporaire: impairments.temporaire ?? 0,
    mineur: impairments.mineur ?? 0,
    majeur: impairments.majeur ?? 0,
    definitif: impairments.definitif ?? 0,
  };
  let points = Math.max(0, armorQuality);

  while (points > 0) {
    if ((result.definitif ?? 0) > 0) {
      result.definitif = (result.definitif ?? 0) - 1;
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
 * Applique un affaiblissement avec gestion du débordement vers Constitution / Conscience,
 * calcul du SD de KO et déclenchement de Saignement sur affaiblissement majeur/définitif.
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
  const fallbackVitalityStat: AshardeStatName = cloned.stats["constitution"] ? "constitution" : "conscience";

  const vitalityTiersReceived: Record<AshardeImpairmentTier, number> = {
    temporaire: 0,
    mineur: 0,
    majeur: 0,
    definitif: 0,
  };

  for (let i = 0; i < count; i++) {
    if (targetStat !== fallbackVitalityStat) {
      const targetBlock = cloned.stats[targetStat];
      const currentEff = targetBlock ? computeEffectiveStat(targetBlock) : 0;
      if (currentEff > 0 && targetBlock) {
        targetBlock.impairments[tier] = (targetBlock.impairments[tier] ?? 0) + 1;
      } else {
        // Redirection vers Constitution / Vitalité (Spirale de la vulnérabilité)
        const vitalBlock = cloned.stats[fallbackVitalityStat];
        if (vitalBlock) {
          vitalBlock.impairments[tier] = (vitalBlock.impairments[tier] ?? 0) + 1;
        }
        vitalityTiersReceived[tier]++;
      }
    } else {
      const vitalBlock = cloned.stats[fallbackVitalityStat];
      if (vitalBlock) {
        vitalBlock.impairments[tier] = (vitalBlock.impairments[tier] ?? 0) + 1;
      }
      vitalityTiersReceived[tier]++;
    }
  }

  // Calcul du jet de sauvegarde contre l'évanouissement / KO si Constitution a été touchée
  let koSaveSD: number | null = null;
  if (
    vitalityTiersReceived.definitif > 0 ||
    vitalityTiersReceived.majeur > 0 ||
    vitalityTiersReceived.mineur > 0 ||
    vitalityTiersReceived.temporaire > 0
  ) {
    if (vitalityTiersReceived.definitif > 0) {
      koSaveSD = 5;
    } else if (vitalityTiersReceived.majeur > 0) {
      koSaveSD = 3;
    } else if (vitalityTiersReceived.mineur > 0) {
      koSaveSD = 2;
    } else {
      koSaveSD = 1;
    }
  }

  // Déclenchement de saignement si la vitalité a subi un affaiblissement majeur (SD 3) ou définitif (SD 6)
  let bleedingTriggered: { curabilitySD: 3 | 6 } | null = null;
  if (vitalityTiersReceived.definitif > 0) {
    bleedingTriggered = { curabilitySD: 6 };
    cloned.activeBleedings.push({
      id: `bleed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: `Blessure Vitalité (définitif)`,
      curabilitySD: 6,
      active: true,
    });
  } else if (vitalityTiersReceived.majeur > 0) {
    bleedingTriggered = { curabilitySD: 3 };
    cloned.activeBleedings.push({
      id: `bleed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: `Blessure Vitalité (majeur)`,
      curabilitySD: 3,
      active: true,
    });
  }

  const finalVitalityEff = computeEffectiveStat(cloned.stats[fallbackVitalityStat] ?? { base: 0, impairments: { temporaire: 0, mineur: 0, majeur: 0 } });
  const deathSaveRequired = finalVitalityEff === 0;

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

export interface AshardeAdvanceScenesOptions {
  deltaScenes?: number;
  compound?: AshardeSceneCompound;
  mode?: "countdown" | "global_modulo";
}

/**
 * Avancement temporel par Scènes (Échelle officielle 1 / 10 / 100 Scènes) :
 * Connecté au Composé Scène Général partagé.
 *
 * Règles :
 * 1. Toutes les capacités « 1 fois par Scène » (sceneAbilitiesUsed, ex. Oracle) sont réinitialisées à false.
 * 2. Pour chaque affaiblissement actif, décrémente son décompte de scènes restantes (ou palier global).
 *    - temporaire : guérit après 1 Scène (deltaScenes >= 1)
 *    - mineur : guérit d'1 point toutes les 10 Scènes
 *    - majeur : guérit d'1 point toutes les 100 Scènes
 * 3. Supporte les modes "countdown" (décompte par blessure) et "global_modulo" (liaison à la variable globale Harpy).
 */
export function advanceScenes(
  sheet: AshardeCharacterSheet,
  deltaOrOptions: number | AshardeAdvanceScenesOptions = 1,
  compoundParam?: AshardeSceneCompound
): {
  sheet: AshardeCharacterSheet;
  compound: AshardeSceneCompound;
  healedImpairments: Array<{ stat: string; tier: AshardeImpairmentTier; count: number }>;
  deathCheck: AshardeDeathCheckResult;
} {
  const options: AshardeAdvanceScenesOptions =
    typeof deltaOrOptions === "number" ? { deltaScenes: deltaOrOptions } : deltaOrOptions;
  const deltaScenes = Math.max(1, options.deltaScenes ?? 1);
  const mode = options.mode ?? "countdown";

  const clonedSheet: AshardeCharacterSheet = JSON.parse(JSON.stringify(sheet));
  const compound: AshardeSceneCompound = options.compound
    ? JSON.parse(JSON.stringify(options.compound))
    : compoundParam
    ? JSON.parse(JSON.stringify(compoundParam))
    : { sceneCounter: 0, lastDelta: 0 };

  const oldCounter = compound.sceneCounter;
  const newCounter = oldCounter + deltaScenes;
  compound.sceneCounter = newCounter;
  compound.lastDelta = deltaScenes;

  // 1. Réinitialisation des capacités par Scène (Oracle, etc.)
  if (clonedSheet.sceneAbilitiesUsed) {
    for (const key of Object.keys(clonedSheet.sceneAbilitiesUsed)) {
      clonedSheet.sceneAbilitiesUsed[key] = false;
    }
  }

  const healedImpairments: Array<{ stat: string; tier: AshardeImpairmentTier; count: number }> = [];

  // 2. Guérison des affaiblissements
  if (mode === "countdown") {
    // Mode Décompte :
    // Si activeImpairments est présent, décrémente directement scenesRemaining
    if (clonedSheet.activeImpairments && clonedSheet.activeImpairments.length > 0) {
      const remainingImpairments: AshardeActiveImpairment[] = [];
      for (const imp of clonedSheet.activeImpairments) {
        imp.scenesRemaining -= deltaScenes;
        if (imp.scenesRemaining <= 0) {
          healedImpairments.push({ stat: imp.targetStat, tier: imp.tier, count: 1 });
          // Décrémente le compteur de bloc stat
          const statBlock = clonedSheet.stats[imp.targetStat];
          if (statBlock && (statBlock.impairments[imp.tier] ?? 0) > 0) {
            statBlock.impairments[imp.tier]--;
          }
        } else {
          remainingImpairments.push(imp);
        }
      }
      clonedSheet.activeImpairments = remainingImpairments;
    } else {
      // Guérison basée sur stats.impairments
      for (const [statName, statBlock] of Object.entries(clonedSheet.stats)) {
        if (!statBlock) continue;
        // Temporaire : guérit complètement dès que deltaScenes >= 1
        if (statBlock.impairments.temporaire > 0) {
          healedImpairments.push({
            stat: statName,
            tier: "temporaire",
            count: statBlock.impairments.temporaire,
          });
          statBlock.impairments.temporaire = 0;
        }

        // Mineur : guérit de floor(deltaScenes / 10) points
        if (statBlock.impairments.mineur > 0) {
          const healCount = Math.min(statBlock.impairments.mineur, Math.floor(deltaScenes / 10));
          if (healCount > 0) {
            statBlock.impairments.mineur -= healCount;
            healedImpairments.push({ stat: statName, tier: "mineur", count: healCount });
          }
        }

        // Majeur : guérit de floor(deltaScenes / 100) points
        if (statBlock.impairments.majeur > 0) {
          const healCount = Math.min(statBlock.impairments.majeur, Math.floor(deltaScenes / 100));
          if (healCount > 0) {
            statBlock.impairments.majeur -= healCount;
            healedImpairments.push({ stat: statName, tier: "majeur", count: healCount });
          }
        }
      }
    }
  } else {
    // Mode Global Modulo (liaison variable Harpy.gg)
    const healMinor =
      Math.floor(newCounter / 10) > Math.floor(oldCounter / 10) || newCounter % 10 === 0;
    const healMajor =
      Math.floor(newCounter / 100) > Math.floor(oldCounter / 100) || newCounter % 100 === 0;

    for (const [statName, statBlock] of Object.entries(clonedSheet.stats)) {
      if (!statBlock) continue;
      // Temporaire : guérit à chaque scène
      if (statBlock.impairments.temporaire > 0) {
        healedImpairments.push({
          stat: statName,
          tier: "temporaire",
          count: statBlock.impairments.temporaire,
        });
        statBlock.impairments.temporaire = 0;
      }

      if (healMinor && statBlock.impairments.mineur > 0) {
        statBlock.impairments.mineur--;
        healedImpairments.push({ stat: statName, tier: "mineur", count: 1 });
      }

      if (healMajor && statBlock.impairments.majeur > 0) {
        statBlock.impairments.majeur--;
        healedImpairments.push({ stat: statName, tier: "majeur", count: 1 });
      }
    }
  }

  const deathCheck = checkDeathThreshold(clonedSheet);

  return {
    sheet: clonedSheet,
    compound,
    healedImpairments,
    deathCheck,
  };
}

/**
 * Transition temporelle du Composé Temps (Rétrocompatibilité 5 paliers).
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

  for (const statBlock of Object.values(cloned.stats)) {
    if (statBlock) {
      for (const tier of healedTiers) {
        statBlock.impairments[tier] = 0;
      }
    }
  }

  const activeBleedingsCount = (cloned.activeBleedings ?? []).filter((b) => b.active).length;
  const bleedingTickAlert = activeBleedingsCount > 0;
  const vitalStat = cloned.stats["constitution"] ?? cloned.stats["conscience"];
  const deathRollAlert = vitalStat ? computeEffectiveStat(vitalStat) === 0 : false;

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
  const vitalStat = sheet.stats["constitution"] ?? sheet.stats["conscience"] ?? { base: 5, impairments: { temporaire: 0, mineur: 0, majeur: 0 } };
  const effVital = computeEffectiveStat(vitalStat);
  const baseVital = vitalStat.base;
  const passiveSDVital = computePassiveSaveSD(effVital);
  const penaltyArmor = computeArmorSpeedPenalty(sheet.armorQuality);
  const activeBleedings = (sheet.activeBleedings ?? []).filter((b) => b.active);

  lines.push("🛡️ DÉFENSE & SURVIE");
  lines.push(`↳ Qualité armure : ${sheet.armorQuality} (Malus Vitesse : -${penaltyArmor})`);
  lines.push(
    `↳ Vitalité/Constitution : ${effVital}/${baseVital} (Sauvegarde Passive : SD ${passiveSDVital})`
  );
  if (activeBleedings.length > 0) {
    const bSummary = activeBleedings.map((b) => `SD ${b.curabilitySD}`).join(", ");
    lines.push(`↳ Saignements actifs : ${activeBleedings.length} (${bSummary})`);
  } else {
    lines.push("↳ Saignements : Aucun");
  }

  // Tactique & Combat
  const vitStat = sheet.stats["vitesse"] ?? sheet.stats["agilite"] ?? { base: 5, impairments: { temporaire: 0, mineur: 0, majeur: 0 } };
  const effVitesse = computeEffectiveStat(vitStat);
  const perStat = sheet.stats["perception"] ?? { base: 5, impairments: { temporaire: 0, mineur: 0, majeur: 0 } };
  const effPerception = computeEffectiveStat(perStat);
  const passiveSDPerception = computePassiveSaveSD(effPerception);

  lines.push("⚡ TACTIQUE & COMBAT");
  lines.push(`↳ Initiative : ${effVitesse} - 1d10`);
  lines.push(`↳ Vitesse effective : ${effVitesse} (Base : ${vitStat.base})`);
  lines.push(`↳ Perception passive : SD ${passiveSDPerception}`);

  // Magie du Rêve
  const effEvo = sheet.stats["evolution"] ? computeEffectiveStat(sheet.stats["evolution"]) : 5;
  const effIntel = sheet.stats["intelligence"] ? computeEffectiveStat(sheet.stats["intelligence"]) : 5;
  const power = computeMagicPower(effEvo, effIntel, sheet.archetype);
  lines.push("✨ MAGIE DU RÊVE");
  lines.push(`↳ Pouvoir magique : ${power} (${sheet.archetype ?? "commun"})`);

  // Caractéristiques canoniques
  lines.push("📊 CARACTÉRISTIQUES (Effectif / Base [SD Passif])");
  const statLabels: Record<string, string> = {
    force: "Force",
    agilite: "Agilité",
    constitution: "Constitution",
    intelligence: "Intelligence",
    perception: "Perception",
    volonte: "Volonté",
    charisme: "Charisme",
    autorite: "Autorité",
    conscience: "Conscience",
    evolution: "Évolution",
    vitesse: "Vitesse",
    chance: "Chance",
    attractivite: "Attractivité",
    erudition: "Érudition",
  };

  for (const [statName, st] of Object.entries(sheet.stats)) {
    if (!st) continue;
    const eff = computeEffectiveStat(st);
    const sd = computePassiveSaveSD(eff);
    const label = statLabels[statName] ?? statName;
    lines.push(`↳ ${label} : ${eff}/${st.base} [SD ${sd}]`);
  }

  // Armes connectées
  if (sheet.weapons && sheet.weapons.length > 0) {
    lines.push("⚔️ ARMES & SIGNATURES");
    for (const weapon of sheet.weapons) {
      const eff = computeWeaponEffective(weapon);
      const brokenStr = eff.isBroken ? " [BRISÉE]" : "";
      lines.push(
        `↳ ${weapon.name.slice(0, 45)} (Qualité ${eff.effectiveQuality}, Touche: ${eff.hitThreshold}+)${brokenStr}`
      );
      if (weapon.signatureTable && weapon.signatureTable.length > 0) {
        const sigEntries = weapon.signatureTable
          .map((e) => `d${e.roll}:${e.targetStat.slice(0, 3)}=${e.tier.slice(0, 3)}`)
          .join(" ");
        lines.push(`  ↳ Table : ${sigEntries.slice(0, 58)}`);
      }
    }
  }

  // Connexions Harpy.gg
  if (sheet.connections && sheet.connections.length > 0) {
    lines.push("🔗 CONNEXIONS ENTITÉS HARPY.GG");
    for (const conn of sheet.connections) {
      const connLine = `↳ ${conn.relation} -> ${conn.targetEntityId}`;
      lines.push(connLine.slice(0, 68));
    }
  }

  return lines.join("\n");
}

/**
 * Générateur de modèle de fiche de personnage Harpy automatisée (.bypp format v17)
 * avec Composé Scène Général connecté (1 / 10 / 100 Scènes, mort < -Constitution, armes 10 - n).
 */
export function buildAshardeCharacterSheetTemplate(options?: {
  characterName?: string;
  archetype?: "arcaniste" | "reveur" | "autre";
  initialSceneCounter?: number;
}): any {
  const charName = options?.characterName ?? "Shanwen l'Émissaire";
  const archetype = options?.archetype ?? "reveur";
  const sceneCounter = options?.initialSceneCounter ?? 1;

  const bundle = {
    version: 17,
    format: "bypp",
    name: "Modèle Asharde - Fiche PJ & Composé Scène Général",
    exportedAt: new Date().toISOString(),
    bundleVersion: "1.0.0",
    attribution: {
      authorName: "Henri Jamet & Julien (Projet Asharde)",
    },
    license: "ARR",
    licenseVersion: "4.0",
    entities: [
      // 1. Composé Scène Général (entité globale connectée à tous les PJ)
      {
        uid: "asharde_scene_compound_global",
        type: "group",
        name: "Composé Scène Général",
        displayName: "Composé Scène Général d'Asharde",
        description:
          "Composé temporel universel régissant l'échelle 1 / 10 / 100 Scènes, la réinitialisation des capacités d'Oracle par Scène et la guérison automatique des affaiblissements.",
        tagsUid: ["tag_asharde_compound"],
        pagesOrder: ["page_compound_scene_rules"],
        data: {
          var_global_scene_counter: sceneCounter,
          var_last_delta_scenes: 1,
          var_active_scene_label: "Scène 1 : Éveil et Présages",
          var_heal_temp_trigger: "Toutes les 1 scène (fin de scène)",
          var_heal_minor_trigger: "Toutes les 10 scènes",
          var_heal_major_trigger: "Toutes les 100 scènes",
        },
      },
      // 2. Fiche de Personnage PJ
      {
        uid: "asharde_character_sheet_pj",
        type: "character",
        name: charName,
        displayName: charName,
        description: `Personnage joueur d'Asharde (${archetype}) géré par le moteur d'affaiblissements 1/3/6 et guérison par Scènes.`,
        tagsUid: ["tag_asharde_pj", "tag_asharde_compound"],
        pagesOrder: ["page_pj_main_sheet"],
        data: {
          // Liaison au Composé Scène
          var_connected_compound: "asharde_scene_compound_global",
          var_archetype: archetype,

          // Caractéristiques canoniques (Base, Affaiblissements, Effectif)
          var_stat_force_base: 3,
          var_stat_force_temp: 0,
          var_stat_force_min: 0,
          var_stat_force_maj: 0,

          var_stat_agilite_base: 6,
          var_stat_agilite_temp: 0,
          var_stat_agilite_min: 0,
          var_stat_agilite_maj: 0,

          var_stat_constitution_base: 4,
          var_stat_constitution_temp: 0,
          var_stat_constitution_min: 0,
          var_stat_constitution_maj: 0,

          var_stat_intelligence_base: 7,
          var_stat_intelligence_temp: 0,
          var_stat_intelligence_min: 0,
          var_stat_intelligence_maj: 0,

          var_stat_perception_base: 6,
          var_stat_perception_temp: 0,
          var_stat_perception_min: 0,
          var_stat_perception_maj: 0,

          var_stat_volonte_base: 5,
          var_stat_volonte_temp: 0,
          var_stat_volonte_min: 0,
          var_stat_volonte_maj: 0,

          var_stat_charisme_base: 5,
          var_stat_charisme_temp: 0,
          var_stat_charisme_min: 0,
          var_stat_charisme_maj: 0,

          var_stat_autorite_base: 4,
          var_stat_autorite_temp: 0,
          var_stat_autorite_min: 0,
          var_stat_autorite_maj: 0,

          var_stat_conscience_base: 6,
          var_stat_conscience_temp: 0,
          var_stat_conscience_min: 0,
          var_stat_conscience_maj: 0,

          var_stat_evolution_base: 4,
          var_stat_evolution_temp: 0,
          var_stat_evolution_min: 0,
          var_stat_evolution_maj: 0,

          // Armure
          var_armor_quality: 3,

          // Arme connectée
          var_weapon_name: "Stylet d'Argent Onirique",
          var_weapon_quality: 3, // Valeur = 10 - n
          var_weapon_wear: 0,
          var_weapon_hit_threshold: 7, // 10 - 3 = 7

          // Oracle / Capacités par Scène
          var_ability_oracle_vision_used: false,
          var_ability_anticipation_fulgurante_used: false,

          // Diagnostic Survie
          var_is_dead_critical: false,
          var_death_threshold: -4, // < -Constitution (-4 pour Constitution 4)
        },
      },
    ],
    pages: [
      {
        uid: "page_compound_scene_rules",
        type: "standard",
        name: "Règles du Composé Scène",
        chunksOrder: ["chunk_compound_expl"],
      },
      {
        uid: "page_pj_main_sheet",
        type: "standard",
        name: "Fiche d'Aventure",
        chunksOrder: ["chunk_pj_stats_display", "chunk_pj_combat_actions"],
      },
    ],
    chunks: [
      {
        uid: "chunk_compound_expl",
        type: "text",
        headingMode: "outside",
        content:
          "<p><strong>Composé Scène Général d'Asharde :</strong> Ce composé relie toutes les fiches de personnages à un métronome temporel universel. À chaque incrément de Scène, les capacités <em>1 fois par scène</em> sont réarmées, et les affaiblissements guérissent selon la cadence officielle : Temporaires (1 scène), Mineurs (10 scènes), Majeurs (100 scènes).</p>",
      },
      {
        uid: "chunk_pj_stats_display",
        type: "text",
        headingMode: "outside",
        content:
          "<p><strong>Caractéristiques & Survie :</strong> Tout affaiblissement inflige 1 (temporaire), 3 (mineur) ou 6 (majeur) points de pénalité. Si une caractéristique tombe strictement sous -Constitution, le personnage sombre dans la mort critique.</p>",
      },
      {
        uid: "chunk_pj_combat_actions",
        type: "text",
        headingMode: "outside",
        content:
          "<p><strong>Armes & Armures :</strong> Le seuil de touche d'une arme connectée est calculé par <em>10 - Qualité effective</em>. L'armure absorbe les affaiblissements selon sa Qualité.</p>",
      },
    ],
    variables: [
      {
        uid: "var_scene_advance_action",
        type: "formula",
        name: "Avancement de Scène (+1)",
        label: "Avancer le temps d'une Scène",
        datasetsUids: ["dataset_asharde"],
        formula: "<p>SET($var_global_scene_counter, $var_global_scene_counter + 1)</p>",
      },
      {
        uid: "var_formula_death_check",
        type: "formula",
        name: "Diagnostic Seuil de Mort",
        label: "Vérifier Seuil de Mort (< -Constitution)",
        datasetsUids: ["dataset_asharde"],
        formula:
          "<p>IF(MIN($var_stat_force_eff, $var_stat_agilite_eff, $var_stat_constitution_eff, $var_stat_intelligence_eff) &lt; -$var_stat_constitution_base, \"MORT CRITIQUE\", \"VIVANT\")</p>",
      },
      {
        uid: "var_formula_weapon_hit",
        type: "formula",
        name: "Seuil de Touche Arme (10 - n)",
        label: "Seuil de Touche",
        datasetsUids: ["dataset_asharde"],
        formula: "<p>10 - MAX(0, $var_weapon_quality - $var_weapon_wear)</p>",
      },
    ],
    sheets: [
      {
        uid: "sheet_asharde_default",
        name: "Feuille Principale Asharde",
        variablesOrder: ["var_scene_advance_action", "var_formula_death_check", "var_formula_weapon_hit"],
      },
    ],
    tags: [
      {
        uid: "tag_asharde_compound",
        name: "Asharde:Composé",
        color: "#4f46e5",
      },
      {
        uid: "tag_asharde_pj",
        name: "Asharde:PJ",
        color: "#059669",
      },
    ],
    tagCategories: [
      {
        uid: "cat_asharde_system",
        name: "Système Asharde",
        tagsUid: ["tag_asharde_compound", "tag_asharde_pj"],
      },
    ],
  };

  return bundle;
}
