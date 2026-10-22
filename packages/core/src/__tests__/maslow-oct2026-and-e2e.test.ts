import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computePathfinderEncumbrance,
  getPathfinderLightMax,
  interpolateStatFormula,
  resolveEntityConnections,
  duplicateTurnTrackerEntity,
  propagateSharedTimeCompound,
  HarpyEntityConnection,
} from "../connections/index.js";
import {
  parseObsidianNote,
  computeEntityDiff,
} from "../bridge/index.js";
import { validateHarpyEntityV3 } from "../validator/index.js";
import { determineSyncAction } from "../sync/index.js";
import {
  AshardeCharacterSheet,
  AshardeStatBlock,
} from "../asharde/index.js";

function createDefaultStat(base = 5): AshardeStatBlock {
  return {
    base,
    impairments: { temporaire: 0, mineur: 0, majeur: 0, definitif: 0 },
  };
}

function createSampleAshardeSheet(
  id: string,
  name: string,
  bleedActive = false
): AshardeCharacterSheet {
  return {
    id,
    name,
    archetype: "reveur",
    armorQuality: 2,
    activeBleedings: bleedActive
      ? [
          {
            id: "b1",
            source: "Entaille d'épée",
            curabilitySD: 6,
            active: true,
          },
        ]
      : [],
    sceneAbilitiesUsed: { "focalisation": true },
    stats: {
      force: createDefaultStat(4),
      agilite: createDefaultStat(5),
      vitesse: createDefaultStat(5),
      perception: createDefaultStat(6),
      chance: createDefaultStat(4),
      attractivite: createDefaultStat(5),
      autorite: createDefaultStat(4),
      evolution: createDefaultStat(3),
      intelligence: createDefaultStat(6),
      conscience: createDefaultStat(5),
    },
    weapons: [],
    connections: [],
  };
}

describe("Nouveautés Maslow Octobre 2026 & Intégration End-to-End Harpy Sync", () => {
  // Test 1
  test("1. Connexion arme équipée et sort actif avec interpolation dynamique de @force", () => {
    const baseVars = {
      force: 14,
      dex: 12,
      ca: 15,
      attaque_base: 3,
    };

    const connections: HarpyEntityConnection[] = [
      {
        connectionId: "conn-axe-01",
        sourceEntityUid: "hero-1",
        name: "Hache de bataille de maître",
        kind: "weapon",
        equipped: true,
        weight: 6,
        quantity: 1,
        statModifiers: { attaque: 1 },
        grantedActions: [
          {
            name: "Frappe lourde",
            formula: "1d20 + @attaque + @force_mod",
            damageFormula: "1d8 + @force",
          },
        ],
      },
      {
        connectionId: "conn-spell-01",
        sourceEntityUid: "hero-1",
        name: "Agrandissement (sort)",
        kind: "spell",
        active: true,
        statModifiers: {
          force: 2,
          dex: -2,
          ca: -1,
        },
      },
    ];

    const result = resolveEntityConnections(baseVars, connections, {
      computePf1eEncumbrance: true,
    });

    // Force effective : 14 + 2 = 16
    assert.equal(result.effectiveVariables["force"], 16);
    // Dex effective : 12 - 2 = 10
    assert.equal(result.effectiveVariables["dex"], 10);
    // CA effective : 15 - 1 = 14
    assert.equal(result.effectiveVariables["ca"], 14);
    // Attaque modificateur : 1
    assert.equal(result.appliedModifiers["attaque"], 1);

    // Résolution d'action : 1d8 + @force -> 1d8 + 16
    assert.equal(result.resolvedActions.length, 1);
    const action = result.resolvedActions[0];
    assert.equal(action.resolvedDamageFormula, "1d8 + 16");
    // @force_mod pour 16 vaut floor((16 - 10) / 2) = 3
    assert.equal(action.resolvedFormula, "1d20 + 1 + 3");
    // Poids d'inventaire : 6
    assert.equal(result.totalInventoryWeight, 6);
    assert.equal(result.activeConnectionsCount, 2);
    // Encumbrance PF1e calculée
    assert.ok(result.encumbrance);
    assert.equal(result.encumbrance.loadTier, "light");
  });

  // Test 2
  test("2. Désactivation d'un sort ou déséquipement arme retire les bonus tout en conservant le poids", () => {
    const baseVars = {
      force: 14,
      dex: 12,
      ca: 15,
    };

    const connections: HarpyEntityConnection[] = [
      {
        connectionId: "conn-axe-01",
        sourceEntityUid: "hero-1",
        name: "Hache de bataille",
        kind: "weapon",
        equipped: false, // Rangée dans le sac
        weight: 6,
        quantity: 1,
        statModifiers: { attaque: 1 },
        grantedActions: [{ name: "Frappe", formula: "1d8 + @force" }],
      },
      {
        connectionId: "conn-spell-01",
        sourceEntityUid: "hero-1",
        name: "Agrandissement (sort)",
        kind: "spell",
        active: false, // Dissipé
        statModifiers: { force: 2 },
      },
    ];

    const result = resolveEntityConnections(baseVars, connections);

    // Les bonus ne sont pas appliqués
    assert.equal(result.effectiveVariables["force"], 14);
    assert.equal(result.effectiveVariables["dex"], 12);
    assert.equal(result.appliedModifiers["attaque"], undefined);
    assert.equal(result.resolvedActions.length, 0);
    assert.equal(result.activeConnectionsCount, 0);
    // Mais le poids d'inventaire reste bien de 6
    assert.equal(result.totalInventoryWeight, 6);
  });

  // Test 3
  test("3. Calcul exact de l'encombrement Pathfinder 1e à travers les 4 paliers", () => {
    // Pour Force 10 :
    // lightMax = 33, mediumMax = 66, heavyMax = 100
    const str10 = 10;
    assert.equal(getPathfinderLightMax(str10), 33);

    const lightRes = computePathfinderEncumbrance(str10, 30);
    assert.equal(lightRes.loadTier, "light");
    assert.equal(lightRes.maxDexBonus, null);
    assert.equal(lightRes.checkPenalty, 0);
    assert.equal(lightRes.speed30FtAdjusted, 30);

    const mediumRes = computePathfinderEncumbrance(str10, 50);
    assert.equal(mediumRes.loadTier, "medium");
    assert.equal(mediumRes.maxDexBonus, 3);
    assert.equal(mediumRes.checkPenalty, -3);
    assert.equal(mediumRes.speed30FtAdjusted, 20);

    const heavyRes = computePathfinderEncumbrance(str10, 80);
    assert.equal(heavyRes.loadTier, "heavy");
    assert.equal(heavyRes.maxDexBonus, 1);
    assert.equal(heavyRes.checkPenalty, -6);
    assert.equal(heavyRes.speed30FtAdjusted, 20);

    const overloadedRes = computePathfinderEncumbrance(str10, 110);
    assert.equal(overloadedRes.loadTier, "overloaded");
    assert.equal(overloadedRes.maxDexBonus, 0);
    assert.equal(overloadedRes.checkPenalty, -6);
    assert.equal(overloadedRes.speed30FtAdjusted, 5);

    // Test de scaling pour Force 30 (> 29) : 4 * lightMax(20) = 4 * 133 = 532
    assert.equal(getPathfinderLightMax(30), 532);
  });

  // Test 4
  test("4. Duplication de 20 Gobelins dans le Turn Tracker avec initiatives déterministes et PV indépendants", () => {
    const goblinSource = {
      uid: "mob_goblin_scout",
      name: "Gobelin éclaireur",
      hpMax: 8,
      hpCurrent: 8,
      states: ["furtif"],
    };

    // 20 initiatives fixes (1d20 simulé + mod 2)
    const deterministicRolls = Array.from({ length: 20 }, (_, i) => (i % 20) + 1);

    const duplicates = duplicateTurnTrackerEntity(goblinSource, 20, {
      startNumber: 1,
      initiativeModifier: 2,
      deterministicRolls,
    });

    assert.equal(duplicates.length, 20);
    assert.equal(duplicates[0].displayName, "Gobelin éclaireur #1");
    assert.equal(duplicates[0].sourceEntityUid, "mob_goblin_scout");
    assert.equal(duplicates[0].trackerEntryId, "mob_goblin_scout_tracker_1");
    assert.equal(duplicates[0].initiative, 1 + 2); // roll 1 + mod 2 = 3
    assert.equal(duplicates[0].hpCurrent, 8);
    assert.equal(duplicates[0].hpMax, 8);
    assert.deepEqual(duplicates[0].activeStates, ["furtif"]);

    assert.equal(duplicates[19].displayName, "Gobelin éclaireur #20");
    assert.equal(duplicates[19].initiative, 20 + 2); // roll 20 + mod 2 = 22

    // Vérifier l'indépendance des instances (mutation de barres ou PV sur l'un n'affecte pas l'autre)
    duplicates[0].bars[0].current = 2;
    assert.equal(duplicates[1].bars[0].current, 8);
  });

  // Test 5
  test("5. Propagation du Composé Temps Général d'Asharde sur 3 personnages lors de rest_scene et action_end", () => {
    const s1 = createSampleAshardeSheet("pc-1", "Alba", false);
    const s2 = createSampleAshardeSheet("pc-2", "Balthazar", true); // Blessé avec saignement
    const s3 = createSampleAshardeSheet("pc-3", "Cassiopée", false);

    // Infliger des affaiblissements temporaires et mineurs
    s1.stats.vitesse.impairments.temporaire = 2;
    s1.stats.force.impairments.mineur = 1;

    s2.stats.agilite.impairments.temporaire = 1;
    s2.stats.perception.impairments.mineur = 2;

    s3.stats.intelligence.impairments.temporaire = 3;

    // A. Étape action_end : seul temporaire guérit
    const endActionRes = propagateSharedTimeCompound([s1, s2, s3], "action_end");
    assert.equal(endActionRes.updatedSheets.length, 3);
    assert.equal(endActionRes.updatedSheets[0].stats.vitesse.impairments.temporaire, 0);
    assert.equal(endActionRes.updatedSheets[0].stats.force.impairments.mineur, 1);
    assert.equal(endActionRes.summary[1].bleedingTickAlert, true); // s2 a du saignement

    // B. Étape rest_scene : temporaire et mineur guérissent, réinitialise sceneAbilitiesUsed
    const restRes = propagateSharedTimeCompound(endActionRes.updatedSheets, "rest_scene");
    assert.equal(restRes.updatedSheets[0].stats.force.impairments.mineur, 0);
    assert.equal(restRes.updatedSheets[1].stats.perception.impairments.mineur, 0);
    assert.deepEqual(restRes.updatedSheets[0].sceneAbilitiesUsed, {});
    assert.equal(restRes.summary[1].bleedingTickAlert, true);
  });

  // Test 6
  test("6. Parsing End-to-End d'une note Harpy v3 avec sheet_type, connections, validation v3 et diff 3-way", () => {
    const F = "```";
    const noteMarkdown = `---
harpy-uid: "asharde-valere-001"
harpy-world: "world-maslow-oct2026"
name: "Valère l'Alchimiste"
type: "character"
sheet_type: "asharde_pc"
Image: "[[Valere.jpg]]"
tags:
  - asharde
  - pnj
variables:
  force: 4
  intelligence: 7
connections:
  - connectionId: "conn-revolver-01"
    name: "Pistolet à silex alchimique"
    kind: "weapon"
    weight: 2
    equipped: true
    statModifiers:
      attaque: 2
    grantedActions:
      - name: "Tir vif"
        formula: "1d20 + @attaque + @dex_mod"
        damageFormula: "2d6 + @intelligence"
---

# Valère l'Alchimiste

![[Valere.jpg]]

${F}text
Silhouette voûtée drapée d'une redingote de cuir patiné couverte de fioles et de sacoches teintées.
${F}

## 🎭 Comment l'improviser ?

S'exprimer d'un ton **rapide** et saccadé, en vérifiant sans cesse la fermeture de ses **flacons**. Fixer le vide avec intensité avant de répondre calmement.

## 🗝️ Qui est-il vraiment ?

Artisan alchimiste chassé des guildes de Maslow pour ses expérimentations non déclarées sur les résidus d'éther. Valère voyage sous couvert de réparer les lampes à phosphore et de distiller des remèdes de fortune pour les caravanes des Marches. En réalité, il recherche activement un catalyseur capable de stabiliser le flux d'énergie avant l'arrivée des inquisiteurs. Malgré sa nervosité apparente, il reste d'une loyauté indéfectible envers ceux qui protègent son laboratoire ambulant.

## 🔒 Quels sont les secrets MJ, l'inventaire et les coulisses de Valère ?

### 🗝️ Secrets inavouables
Il dissimule une fiole d'éther purifié capable de faire s'effondrer une tour de garde.

### 🎒 Équipement & Trésors
Pistolet alchimique, sacoche d'ingrédients rares, balance de précision en laiton.

${F}markdown
Une odeur âcre de soufre et d'alcool camphré précède l'homme aux lunettes de cuivre qui s'avance à pas feutrés. Les multiples poches de sa redingote cliquettent au moindre mouvement, laissant entrevoir des pipettes de verre soufflé remplies de réactifs luminescents aux teintes ambrées. Ses doigts tachés d'encre et d'acide manipulent nerveusement les boucles d'un grand sac en bandoulière.

Derrière ses verres épais aux reflets cuivrés, son regard perçant jauge chaque détail avec une méticulosité clinique, prêt à ranger ses fioles au moindre geste brusque. Une posture prudente qui témoigne de longues années passées à fuir les autorités.
${F}

${F}text
👤 Valère l'Alchimiste
🛡️ DÉFENSE & SURVIE
↳ Qualité armure : 1 (Malus Vitesse : 0)
↳ Conscience : 6/6 (Sauvegarde Passive : SD 2)
↳ Saignements : Aucun
⚡ TACTIQUE & COMBAT
↳ Initiative : 4 - 1d10
↳ Vitesse effective : 4 (Base : 4)
↳ Perception passive : SD 2
✨ ALCHIMIE APPLIQUÉE
↳ Pouvoir magique : 7
📊 CARACTÉRISTIQUES (Effectif / Base [SD Passif])
↳ Force : 4/4 [SD 0]
↳ Agilité : 5/5 [SD 1]
↳ Vitesse : 4/4 [SD 0]
↳ Perception : 6/6 [SD 2]
↳ Chance : 5/5 [SD 1]
↳ Attractivité : 4/4 [SD 0]
↳ Autorité : 4/4 [SD 0]
↳ Évolution : 5/5 [SD 1]
↳ Intelligence : 7/7 [SD 3]
↳ Conscience : 6/6 [SD 2]
${F}

<!-- harpy:page uid="page_secrets" name="Secrets & Révélations" -->
# Secrets & Révélations
Valère cache une fiole d'essence primordiale dans le double fond de sa malle.
`;

    // 1. Parsing de la note
    const parsed = parseObsidianNote(noteMarkdown, "Valere");
    assert.equal(parsed.name, "Valère l'Alchimiste");
    assert.equal(parsed.uid, "asharde-valere-001");
    assert.equal(parsed.sheetType, "asharde_pc");
    assert.equal(parsed.connections.length, 1);
    assert.equal(parsed.connections[0].name, "Pistolet à silex alchimique");
    assert.equal(parsed.pages.length, 2);

    // 2. Validation v3
    const validation = validateHarpyEntityV3(noteMarkdown, { entityName: parsed.name });
    assert.equal(validation.valid, true, `Validation v3 errors: ${validation.errors.join("; ")}`);

    // 3. Résolution des connexions
    const resolved = resolveEntityConnections(parsed.variables, parsed.connections, {
      computePf1eEncumbrance: false,
    });
    assert.equal(resolved.totalInventoryWeight, 2);
    assert.equal(resolved.resolvedActions.length, 1);
    assert.equal(resolved.resolvedActions[0].resolvedDamageFormula, "2d6 + 7");

    // 4. Diff 3-way contre une entité distante existante
    const remoteEntity = {
      name: "Valère l'Alchimiste",
      type: "character",
      connections: [], // Aucune connexion distante encore enregistrée
      variables: { force: 4, intelligence: 6 }, // Différence sur intelligence
    };

    const diff = computeEntityDiff(parsed, remoteEntity);
    assert.equal(diff.hasDiff, true);
    assert.equal(diff.connectionsChanged, true);
    assert.ok(diff.variablesModified["intelligence"]);

    // 5. Décision de synchronisation temporelle
    const syncAction = determineSyncAction({
      lastSync: "2026-10-22T10:00:00Z",
      localMtime: "2026-10-22T12:00:00Z", // Fichier local modifié plus récemment
      remoteMtime: "2026-10-22T10:00:00Z",
    });
    assert.equal(syncAction, "USE_LOCAL");
  });

  // Test 7
  test("7. Validation stricte du bornage de duplication dans le Turn Tracker (1 à 100)", () => {
    const dummy = { uid: "dummy", name: "Dummy", hpMax: 10 };
    assert.throws(() => {
      duplicateTurnTrackerEntity(dummy, 0);
    }, /Nombre d'instances de Turn Tracker invalide/);

    assert.throws(() => {
      duplicateTurnTrackerEntity(dummy, 101);
    }, /Nombre d'instances de Turn Tracker invalide/);

    const okEntries = duplicateTurnTrackerEntity(dummy, 100);
    assert.equal(okEntries.length, 100);
  });

  // Test 8
  test("8. Interpolation complexe de formule avec @stat, @stat_mod et sensibilité casse", () => {
    const stats = {
      Force: 18,
      dexterite: 8,
      NIVEAU: 5,
    };

    const formula = "1d20 + @force_mod + @dex_mod + @NIVEAU";
    // Force 18 -> mod +4 ; Dexterite 8 -> mod -1 ; NIVEAU 5 -> 5
    const interpolated = interpolateStatFormula(formula, stats);
    assert.equal(interpolated, "1d20 + 4 + -1 + 5");
  });
});
