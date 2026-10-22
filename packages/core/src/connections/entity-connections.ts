import {
  AshardeCharacterSheet,
  AshardeImpairmentTier,
  AshardeTimeTransition,
  advanceAshardeSceneOrTime,
} from "../asharde/sheet-engine.js";

export type HarpyConnectionKind =
  | "weapon"
  | "item"
  | "spell"
  | "effect"
  | "state"
  | "shared_compound";

export interface HarpyGrantedAction {
  name: string;
  formula: string;
  damageFormula?: string;
  description?: string;
}

export interface HarpyEntityConnection {
  connectionId: string;
  sourceEntityUid: string;
  name: string;
  kind: HarpyConnectionKind;
  equipped?: boolean;
  active?: boolean;
  weight?: number;
  quantity?: number;
  durationRounds?: number;
  statModifiers?: Record<string, number>;
  grantedActions?: HarpyGrantedAction[];
}

export type PathfinderLoadTier = "light" | "medium" | "heavy" | "overloaded";

export interface PathfinderEncumbranceResult {
  totalWeight: number;
  lightMax: number;
  mediumMax: number;
  heavyMax: number;
  loadTier: PathfinderLoadTier;
  maxDexBonus: number | null;
  checkPenalty: number;
  speed30FtAdjusted: number;
}

export interface ResolvedEntityConnectionsResult {
  effectiveVariables: Record<string, string | number | boolean>;
  appliedModifiers: Record<string, number>;
  resolvedActions: Array<
    HarpyGrantedAction & {
      resolvedFormula: string;
      resolvedDamageFormula?: string;
    }
  >;
  totalInventoryWeight: number;
  encumbrance?: PathfinderEncumbranceResult;
  activeConnectionsCount: number;
}

export interface TurnTrackerBar {
  label: string;
  current: number;
  max: number;
  color?: string;
}

export interface TurnTrackerDuplicateOptions {
  startNumber?: number;
  baseInitiative?: number;
  initiativeModifier?: number;
  rollIndividualInitiative?: boolean;
  deterministicRolls?: number[];
  customBars?: TurnTrackerBar[];
}

export interface TurnTrackerEntry {
  trackerEntryId: string;
  sourceEntityUid: string;
  displayName: string;
  instanceIndex: number;
  initiative: number;
  hpCurrent: number;
  hpMax: number;
  bars: TurnTrackerBar[];
  activeStates: string[];
}

const PF1E_LIGHT_LOAD_1_TO_9 = [0, 3, 6, 10, 13, 16, 20, 23, 26, 30];
const PF1E_LIGHT_LOAD_10_TO_29 = [
  33, 38, 43, 50, 58, 66, 76, 86, 100, 116, 133, 153, 173, 200, 233, 266, 306,
  346, 400, 466,
];

/**
 * Calcule la charge maximale légère Pathfinder 1e pour un score de Force.
 */
export function getPathfinderLightMax(strength: number): number {
  if (strength <= 0) return 0;
  if (strength < 10) {
    return PF1E_LIGHT_LOAD_1_TO_9[strength] ?? 0;
  }
  if (strength <= 29) {
    return PF1E_LIGHT_LOAD_10_TO_29[strength - 10];
  }
  const tensAbove20 = Math.floor((strength - 20) / 10);
  const baseIndex = ((strength - 20) % 10) + 10;
  return PF1E_LIGHT_LOAD_10_TO_29[baseIndex] * Math.pow(4, tensAbove20);
}

/**
 * Calcule l'encombrement Pathfinder 1e selon la Force et le poids total porté.
 */
export function computePathfinderEncumbrance(
  strength: number,
  totalWeight: number
): PathfinderEncumbranceResult {
  const lightMax = getPathfinderLightMax(strength);
  const mediumMax = lightMax * 2;
  const heavyMax = lightMax * 3;

  let loadTier: PathfinderLoadTier;
  let maxDexBonus: number | null;
  let checkPenalty: number;
  let speed30FtAdjusted: number;

  if (totalWeight <= lightMax) {
    loadTier = "light";
    maxDexBonus = null;
    checkPenalty = 0;
    speed30FtAdjusted = 30;
  } else if (totalWeight <= mediumMax) {
    loadTier = "medium";
    maxDexBonus = 3;
    checkPenalty = -3;
    speed30FtAdjusted = 20;
  } else if (totalWeight <= heavyMax) {
    loadTier = "heavy";
    maxDexBonus = 1;
    checkPenalty = -6;
    speed30FtAdjusted = 20;
  } else {
    loadTier = "overloaded";
    maxDexBonus = 0;
    checkPenalty = -6;
    speed30FtAdjusted = 5;
  }

  return {
    totalWeight,
    lightMax,
    mediumMax,
    heavyMax,
    loadTier,
    maxDexBonus,
    checkPenalty,
    speed30FtAdjusted,
  };
}

/**
 * Remplace les références @stat (ex. @force, @for_mod, @dex) dans une formule d'action ou de dégâts
 * par la valeur numérique correspondante de stats.
 */
export function interpolateStatFormula(
  formula: string,
  stats: Record<string, string | number | boolean>
): string {
  if (!formula || typeof formula !== "string") {
    return "";
  }

  // Regex capturant @nom_de_stat ou @nom_de_stat_mod
  return formula.replace(/@([a-zA-Z0-9_]+)/g, (match, rawKey: string) => {
    const keyLower = rawKey.toLowerCase();

    // 1. Recherche directe dans stats (sensible ou insensible à la casse)
    if (rawKey in stats && stats[rawKey] !== undefined) {
      return String(stats[rawKey]);
    }
    const matchingKey = Object.keys(stats).find(
      (k) => k.toLowerCase() === keyLower
    );
    if (matchingKey && stats[matchingKey] !== undefined) {
      return String(stats[matchingKey]);
    }

    // 2. Gestion des modificateurs @_mod
    if (keyLower.endsWith("_mod")) {
      const baseKeyLower = keyLower.slice(0, -4);
      // Chercher la caractéristique de base (ex. force pour force_mod ou for pour for_mod)
      const baseMatchingKey = Object.keys(stats).find((k) => {
        const kLower = k.toLowerCase();
        return (
          kLower === baseKeyLower ||
          (baseKeyLower === "for" && kLower === "force") ||
          (baseKeyLower === "force" && kLower === "for") ||
          (baseKeyLower === "dex" && kLower === "dexterite") ||
          (baseKeyLower === "dexterite" && kLower === "dex") ||
          (baseKeyLower === "con" && kLower === "constitution") ||
          (baseKeyLower === "constitution" && kLower === "con") ||
          (baseKeyLower === "int" && kLower === "intelligence") ||
          (baseKeyLower === "intelligence" && kLower === "int") ||
          (baseKeyLower === "sag" && kLower === "sagesse") ||
          (baseKeyLower === "sagesse" && kLower === "sag") ||
          (baseKeyLower === "cha" && kLower === "charisme") ||
          (baseKeyLower === "charisme" && kLower === "cha")
        );
      });

      if (baseMatchingKey) {
        const rawScore = Number(stats[baseMatchingKey]);
        if (!isNaN(rawScore)) {
          const mod = Math.floor((rawScore - 10) / 2);
          return String(mod);
        }
      }
    }

    // 3. Si non trouvé, conserver le match original
    return match;
  });
}

/**
 * Résout les connexions actives d'une entité, calcule les variables effectives,
 * les actions accordées résolues, le poids total d'inventaire et l'encombrement PF1e.
 */
export function resolveEntityConnections(
  baseVariables: Record<string, string | number | boolean>,
  connections: HarpyEntityConnection[],
  options?: { computePf1eEncumbrance?: boolean }
): ResolvedEntityConnectionsResult {
  const effectiveVariables: Record<string, string | number | boolean> = {
    ...baseVariables,
  };
  const appliedModifiers: Record<string, number> = {};
  const resolvedActions: Array<
    HarpyGrantedAction & {
      resolvedFormula: string;
      resolvedDamageFormula?: string;
    }
  > = [];

  let totalInventoryWeight = 0;
  let activeConnectionsCount = 0;

  // Passe 1 : Calcul du poids, identification des connexions actives et modificateurs
  for (const conn of connections) {
    // Calcul du poids d'inventaire pour armes et objets indépendamment de l'équipement
    if (conn.kind === "weapon" || conn.kind === "item") {
      const w = Number(conn.weight) || 0;
      const q = Number(conn.quantity ?? 1) || 1;
      totalInventoryWeight += w * q;
    }

    // Détermination de l'activité de la connexion
    let isActive = false;
    if (conn.kind === "weapon" || conn.kind === "item") {
      isActive = conn.equipped !== false && conn.active !== false;
    } else {
      isActive = conn.active !== false;
    }

    if (isActive) {
      activeConnectionsCount++;

      // Application des modificateurs de caractéristiques
      if (conn.statModifiers) {
        for (const [statKey, rawMod] of Object.entries(conn.statModifiers)) {
          const modVal = Number(rawMod);
          if (!isNaN(modVal)) {
            appliedModifiers[statKey] =
              (appliedModifiers[statKey] ?? 0) + modVal;
            const currentVal = Number(effectiveVariables[statKey] ?? 0);
            if (!isNaN(currentVal)) {
              effectiveVariables[statKey] = currentVal + modVal;
            } else {
              effectiveVariables[statKey] = modVal;
            }
          }
        }
      }
    }
  }

  // Passe 2 : Résolution des actions accordées avec les variables effectives globales
  for (const conn of connections) {
    let isActive = false;
    if (conn.kind === "weapon" || conn.kind === "item") {
      isActive = conn.equipped !== false && conn.active !== false;
    } else {
      isActive = conn.active !== false;
    }

    if (isActive && Array.isArray(conn.grantedActions)) {
      for (const action of conn.grantedActions) {
        const resolvedFormula = interpolateStatFormula(
          action.formula,
          effectiveVariables
        );
        const resolvedDamageFormula = action.damageFormula
          ? interpolateStatFormula(action.damageFormula, effectiveVariables)
          : undefined;

        resolvedActions.push({
          ...action,
          resolvedFormula,
          resolvedDamageFormula,
        });
      }
    }
  }

  // Calcul de l'encombrement Pathfinder 1e
  let encumbrance: PathfinderEncumbranceResult | undefined;
  const hasStrength =
    "force" in effectiveVariables ||
    "FOR" in effectiveVariables ||
    "for" in effectiveVariables ||
    "strength" in effectiveVariables ||
    "STR" in effectiveVariables;

  if (options?.computePf1eEncumbrance || hasStrength) {
    const rawStr =
      effectiveVariables["force"] ??
      effectiveVariables["strength"] ??
      effectiveVariables["FOR"] ??
      effectiveVariables["STR"] ??
      effectiveVariables["for"] ??
      10;
    const strength = Number(rawStr) || 10;
    encumbrance = computePathfinderEncumbrance(strength, totalInventoryWeight);
  }

  return {
    effectiveVariables,
    appliedModifiers,
    resolvedActions,
    totalInventoryWeight,
    encumbrance,
    activeConnectionsCount,
  };
}

/**
 * Duplique une entité source dans le Turn Tracker de Harpy (jusqu'à 100 instances).
 */
export function duplicateTurnTrackerEntity(
  sourceEntity: {
    uid: string;
    name: string;
    hpMax: number;
    hpCurrent?: number;
    states?: string[];
  },
  count: number,
  options?: TurnTrackerDuplicateOptions
): TurnTrackerEntry[] {
  if (count < 1 || count > 100) {
    throw new Error(
      `Nombre d'instances de Turn Tracker invalide (${count}). Doit être compris entre 1 et 100.`
    );
  }

  const startNumber = options?.startNumber ?? 1;
  const entries: TurnTrackerEntry[] = [];

  for (let i = 0; i < count; i++) {
    const idx = startNumber + i;
    const hpCurrent = sourceEntity.hpCurrent ?? sourceEntity.hpMax;
    const hpMax = sourceEntity.hpMax;

    let bars: TurnTrackerBar[];
    if (options?.customBars && options.customBars.length > 0) {
      bars = options.customBars.map((b) => ({ ...b }));
    } else {
      bars = [{ label: "PV", current: hpCurrent, max: hpMax, color: "#10b981" }];
    }

    let roll = 0;
    if (
      options?.deterministicRolls &&
      options.deterministicRolls.length > i
    ) {
      roll = options.deterministicRolls[i];
    } else if (options?.rollIndividualInitiative) {
      roll = Math.floor(Math.random() * 20) + 1;
    }

    const initiative =
      (options?.baseInitiative ?? 0) +
      (options?.initiativeModifier ?? 0) +
      roll;

    entries.push({
      trackerEntryId: `${sourceEntity.uid}_tracker_${idx}`,
      sourceEntityUid: sourceEntity.uid,
      displayName: `${sourceEntity.name} #${idx}`,
      instanceIndex: idx,
      initiative,
      hpCurrent,
      hpMax,
      bars,
      activeStates: [...(sourceEntity.states ?? [])],
    });
  }

  return entries;
}

/**
 * Propage un changement de scène ou de temps à toutes les fiches d'un groupe relié
 * par le Composé Temps Général d'Asharde.
 */
export function propagateSharedTimeCompound(
  sheets: AshardeCharacterSheet[],
  transition: AshardeTimeTransition
): {
  updatedSheets: AshardeCharacterSheet[];
  summary: Array<{
    characterName: string;
    healedTiers: AshardeImpairmentTier[];
    bleedingTickAlert: boolean;
  }>;
} {
  const updatedSheets: AshardeCharacterSheet[] = [];
  const summary: Array<{
    characterName: string;
    healedTiers: AshardeImpairmentTier[];
    bleedingTickAlert: boolean;
  }> = [];

  for (const sheet of sheets) {
    const result = advanceAshardeSceneOrTime(sheet, transition);
    updatedSheets.push(result.sheet);
    summary.push({
      characterName: sheet.name || sheet.id,
      healedTiers: result.healedTiers,
      bleedingTickAlert: result.bleedingTickAlert,
    });
  }

  return {
    updatedSheets,
    summary,
  };
}
