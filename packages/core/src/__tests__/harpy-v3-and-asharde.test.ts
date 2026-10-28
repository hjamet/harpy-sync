import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseHarpyEntityV3,
  validateHarpyBloc5Text,
  validateHarpyEntityV3,
  DEFAULT_MAX_HARPY_LINE_LENGTH,
} from "../validator/index.js";
import {
  computeEffectiveStat,
  computePassiveSaveSD,
  computeMagicPower,
  computeArmorSpeedPenalty,
  applyArmorQualityReduction,
  applyImpairmentWithOverflow,
  validateWeaponSignatureTable,
  advanceAshardeSceneOrTime,
  advanceScenes,
  checkDeathThreshold,
  computeWeaponEffective,
  buildAshardeCharacterSheetTemplate,
  formatAshardeHarpyStatblock,
  AshardeCharacterSheet,
  AshardeStatBlock,
  AshardeSceneCompound,
} from "../asharde/index.js";
import { parseBeyondPaperBundle } from "../bypp/index.js";

function createDefaultStat(base = 5): AshardeStatBlock {
  return {
    base,
    impairments: { temporaire: 0, mineur: 0, majeur: 0, definitif: 0 },
  };
}

function createSampleSheet(): AshardeCharacterSheet {
  return {
    id: "asharde-shanwen-001",
    name: "Shanwen l'Émissaire",
    archetype: "reveur",
    armorQuality: 3,
    activeBleedings: [],
    sceneAbilitiesUsed: { "oracle-tier2": true },
    stats: {
      force: createDefaultStat(3),
      agilite: createDefaultStat(6),
      constitution: createDefaultStat(4),
      vitesse: createDefaultStat(5),
      perception: createDefaultStat(6),
      chance: createDefaultStat(4),
      attractivite: createDefaultStat(5),
      autorite: createDefaultStat(4),
      evolution: createDefaultStat(4),
      intelligence: createDefaultStat(7),
      conscience: createDefaultStat(6),
    },
    weapons: [
      {
        name: "Stylet d'argent",
        signatureTable: [
          { roll: 1, targetStat: "vitesse", tier: "temporaire" },
          { roll: 2, targetStat: "force", tier: "mineur" },
          { roll: 3, targetStat: "conscience", tier: "majeur" },
        ],
      },
    ],
    connections: [
      {
        targetEntityId: "conseil-des-songes",
        relation: "Affilié",
        notes: "Agent secret",
      },
    ],
  };
}

const FENCE = "```";

describe("Harpy v3 Validator", () => {
  const validMarkdownSample = `---
displayName: "Shanwen"
Image: "[[Shanwen.jpg]]"
---

# Shanwen

![[Shanwen.jpg]]

${FENCE}text
Silhouette élancée drapée d'une tunique de soie indigo et de fines bottes de cuir souple.
${FENCE}

## 🎭 Comment l'improviser ?

Parler d'une voix **feutrée** et calme, en observant les interlocuteurs avec une attention **pénétrante** et réservée. Toujours garder un léger sourire énigmatique.

## 🗝️ Qui est-il vraiment ?

Émissaire discret du Conseil des Songes envoyé en reconnaissance dans les Marches du Couchant pour surveiller les résurgences arcaniques. Shanwen dissimule sa véritable allégeance sous les oripeaux d'un simple marchand d'onguents et de soieries rares. Sa mission secrète est de retrouver le sceau d'onyx avant que les agents de la Citadelle ne mettent la main sur les reliques du Premier Sommeil. Il n'hésitera pas à sacrifier ses complices pour préserver le secret.

## 🔒 Quels sont les secrets MJ, l'inventaire et les coulisses de Shanwen ?

### 🗝️ Secrets inavouables
Il possède la carte menant à la crypte des Veilleurs enfouie sous le lac.

### 🎒 Équipement & Trésors
Une bourse de gemmes opalescentes et un stylet gravé de runes oniriques.

${FENCE}markdown
Une silhouette vêtue de soies aux reflets changeants se tient au centre de la pièce. Son port altier et son calme imperturbable attirent immédiatement le regard, tandis que le bruissement soyeux de ses étoffes accompagne chacun de ses mouvements mesurés. Ses mains fines et manucurées manipulent de petits flacons de verre teinté dégageant un subtil parfum d'amande douce et d'épices lointaines.

Son regard perçant scrute l'assistance avec une impassibilité déroutante, ne trahissant aucune émotion sous l'éclairage feutré des lanternes d'albâtre. Une présence fascinante qui impose naturellement le silence.
${FENCE}

${FENCE}text
👤 Shanwen l'Émissaire
🛡️ DÉFENSE & SURVIE
↳ Qualité armure : 3 (Malus Vitesse : -1)
↳ Vitalité/Constitution : 4/4 (Sauvegarde Passive : SD 0)
↳ Saignements : Aucun
⚡ TACTIQUE & COMBAT
↳ Initiative : 5 - 1d10
↳ Vitesse effective : 5 (Base : 5)
↳ Perception passive : SD 2
✨ MAGIE DU RÊVE
↳ Pouvoir magique : 7 (reveur)
📊 CARACTÉRISTIQUES (Effectif / Base [SD Passif])
↳ Force : 3/3 [SD 0]
↳ Agilité : 6/6 [SD 2]
↳ Constitution : 4/4 [SD 0]
↳ Vitesse : 5/5 [SD 1]
↳ Perception : 6/6 [SD 2]
↳ Chance : 4/4 [SD 0]
↳ Attractivité : 5/5 [SD 1]
↳ Autorité : 4/4 [SD 0]
↳ Évolution : 4/4 [SD 0]
↳ Intelligence : 7/7 [SD 3]
↳ Conscience : 6/6 [SD 2]
${FENCE}
`;

  test("Valide une fiche conforme Shanwen avec succès", () => {
    const result = validateHarpyEntityV3(validMarkdownSample, { entityName: "Shanwen" });
    assert.equal(result.valid, true, `Validation errors: ${result.errors.join("; ")}`);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.blocks.imageWikilink, "Shanwen.jpg");
    assert.ok(result.blocks.descriptionExterne);
    assert.ok(result.blocks.aideImprovisation);
    assert.ok(result.blocks.resumeMj);
    assert.ok(result.blocks.descriptionJoueurs);
    assert.ok(result.blocks.blocHarpy);
  });

  test("Rejette une description externe dépassant 100 caractères", () => {
    const longDesc = validMarkdownSample.replace(
      "Silhouette élancée drapée d'une tunique de soie indigo et de fines bottes de cuir souple.",
      "Silhouette excessivement longue et beaucoup trop détaillée avec des ornements superflus qui dépassent cent caractères de description physique."
    );
    const result = validateHarpyEntityV3(longDesc);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Description externe trop longue")));
  });

  test("Rejette les mentions interdites de sources (canon, p. XX, transcript)", () => {
    const withCanon = validMarkdownSample.replace("soieries rares.", "soieries rares (canon).");
    const resultCanon = validateHarpyEntityV3(withCanon);
    assert.equal(resultCanon.valid, false);
    assert.ok(resultCanon.errors.some((e) => e.includes("Mention de source interdite")));

    const withPage = validMarkdownSample.replace("Premier Sommeil.", "Premier Sommeil (p. 42).");
    const resultPage = validateHarpyEntityV3(withPage);
    assert.equal(resultPage.valid, false);
    assert.ok(resultPage.errors.some((e) => e.includes("Mention de source interdite")));
  });

  test("Rejette une syntaxe Markdown ou des lignes trop longues dans le Bloc 5", () => {
    const invalidBlocMarkdown = `👤 Shanwen\n**Gras interdit**\n↳ Qualité armure : 3`;
    const check1 = validateHarpyBloc5Text(invalidBlocMarkdown);
    assert.equal(check1.valid, false);
    assert.ok(check1.errors.some((e) => e.includes("Gras Markdown")));

    const longLine = "A".repeat(75);
    const check2 = validateHarpyBloc5Text(longLine);
    assert.equal(check2.valid, false);
    assert.ok(check2.errors.some((e) => e.includes("Ligne trop longue")));
  });

  test("Génère un avertissement lors de la présence d'un marqueur de scène dans le Bloc 4", () => {
    const withSceneMarker = validMarkdownSample.replace(
      "Une silhouette vêtue de soies aux reflets changeants",
      "À l'aube, sous une pluie battante, une silhouette vêtue de soies aux reflets changeants"
    );
    const result = validateHarpyEntityV3(withSceneMarker);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings.some((w) => w.includes("Marqueur de scène contextuelle")));
  });
});

describe("Asharde Sheet Engine & Rules", () => {
  test("computeEffectiveStat applique la formule officielle 1/3/6", () => {
    const stat: AshardeStatBlock = {
      base: 6,
      bonus: 1,
      impairments: { temporaire: 1, mineur: 1, majeur: 0, definitif: 0 },
    };
    // 6 + 1 - (1*1 + 1*3) = 7 - 4 = 3
    assert.equal(computeEffectiveStat(stat), 3);

    const statZero: AshardeStatBlock = {
      base: 2,
      impairments: { temporaire: 5, mineur: 0, majeur: 0, definitif: 0 },
    };
    assert.equal(computeEffectiveStat(statZero), 0);
  });

  test("computeEffectiveStat et checkDeathThreshold gèrent le seuil de mort strict (< -Constitution)", () => {
    const sheet = createSampleSheet();
    // Constitution de base = 4. Seuil strict : < -4 (soit <= -5)
    sheet.stats.constitution.base = 4;

    // Force base 3 subit 1 affaiblissement majeur (poids 6) : 3 - 6 = -3.
    // -3 n'est pas strictement < -4 -> vivant
    sheet.stats.force.impairments.majeur = 1;
    const checkLiving = checkDeathThreshold(sheet);
    assert.equal(checkLiving.isDead, false);
    assert.equal(checkLiving.baseConstitution, 4);
    assert.equal(checkLiving.deathThreshold, -4);

    // Force subit en plus 1 mineur (poids 3) : 3 - (6 + 3) = -6.
    // -6 < -4 -> Mort critique !
    sheet.stats.force.impairments.mineur = 1;
    const checkDead = checkDeathThreshold(sheet);
    assert.equal(checkDead.isDead, true);
    assert.equal(checkDead.criticalStats.length, 1);
    assert.equal(checkDead.criticalStats[0].stat, "force");
    assert.equal(checkDead.criticalStats[0].effective, -6);
    assert.ok(checkDead.details.includes("Mort critique atteinte"));
  });

  test("computePassiveSaveSD respecte la table exacte d'Asharde", () => {
    assert.equal(computePassiveSaveSD(0), -1);
    assert.equal(computePassiveSaveSD(1), -1);
    assert.equal(computePassiveSaveSD(2), 0);
    assert.equal(computePassiveSaveSD(4), 0);
    assert.equal(computePassiveSaveSD(5), 1);
    assert.equal(computePassiveSaveSD(6), 2);
    assert.equal(computePassiveSaveSD(7), 3);
    assert.equal(computePassiveSaveSD(8), 5);
    assert.equal(computePassiveSaveSD(9), 7);
    assert.equal(computePassiveSaveSD(10), 8);
    assert.equal(computePassiveSaveSD(12), 8);
  });

  test("computeMagicPower calcule selon l'archétype", () => {
    assert.equal(computeMagicPower(5, 8, "arcaniste"), 5);
    assert.equal(computeMagicPower(5, 8, "reveur"), 8);
    assert.equal(computeMagicPower(5, 8, "autre"), 5);
  });

  test("computeArmorSpeedPenalty et applyArmorQualityReduction", () => {
    assert.equal(computeArmorSpeedPenalty(0), 0);
    assert.equal(computeArmorSpeedPenalty(1), 0);
    assert.equal(computeArmorSpeedPenalty(2), 1);
    assert.equal(computeArmorSpeedPenalty(3), 1);
    assert.equal(computeArmorSpeedPenalty(4), 2);

    const reduced = applyArmorQualityReduction(
      { temporaire: 0, mineur: 0, majeur: 0, definitif: 1 },
      2
    );
    assert.deepEqual(reduced, { temporaire: 0, mineur: 1, majeur: 0, definitif: 0 });
  });

  test("applyImpairmentWithOverflow redirige vers Vitalité et gère le KO / saignement", () => {
    const sheet = createSampleSheet();
    const res = applyImpairmentWithOverflow(sheet, "force", "majeur", 4);

    assert.equal(computeEffectiveStat(res.sheet.stats.force), 0);
    assert.ok(res.sheet.stats.force.impairments.majeur >= 1);
    assert.ok(res.koSaveSD !== null);
    assert.ok(res.bleedingTriggered);
    assert.equal(res.bleedingTriggered?.curabilitySD, 3);
  });

  test("validateWeaponSignatureTable contrôle le plafond <= 10 par stat", () => {
    const validEntries = [
      { roll: 1, targetStat: "vitesse" as const, tier: "mineur" as const },
      { roll: 2, targetStat: "vitesse" as const, tier: "majeur" as const },
      { roll: 3, targetStat: "force" as const, tier: "definitif" as const },
    ];
    const validCheck = validateWeaponSignatureTable(validEntries);
    assert.equal(validCheck.valid, true);

    const invalidEntries = [
      { roll: 1, targetStat: "vitesse" as const, tier: "definitif" as const },
      { roll: 2, targetStat: "vitesse" as const, tier: "majeur" as const },
    ];
    const invalidCheck = validateWeaponSignatureTable(invalidEntries);
    assert.equal(invalidCheck.valid, false);
    assert.ok(invalidCheck.errors[0].includes("vitesse"));
  });

  test("computeWeaponEffective calcule le seuil de touche 10 - n et la casse", () => {
    // Arme sans qualité explicite avec 3 cibles distinctes : Qualité = 10 - 3 = 7, seuil touche = 10 - 7 = 3
    const weapon3Stats = {
      name: "Dague polyvalente",
      signatureTable: [
        { roll: 1, targetStat: "force", tier: "temporaire" as const },
        { roll: 2, targetStat: "agilite", tier: "mineur" as const },
        { roll: 3, targetStat: "vitesse", tier: "mineur" as const },
      ],
    };
    const res1 = computeWeaponEffective(weapon3Stats);
    assert.equal(res1.distinctStatsCount, 3);
    assert.equal(res1.effectiveQuality, 7);
    assert.equal(res1.hitThreshold, 3);
    assert.equal(res1.isBroken, false);

    // Arme avec Qualité 4 et usure 1 -> Qualité effective 3, touche 10 - 3 = 7
    const weaponWear = {
      name: "Épée ébréchée",
      quality: 4,
      wearPenalty: 1,
      signatureTable: [{ roll: 1, targetStat: "force", tier: "mineur" as const }],
    };
    const res2 = computeWeaponEffective(weaponWear);
    assert.equal(res2.effectiveQuality, 3);
    assert.equal(res2.hitThreshold, 7);
    assert.equal(res2.isBroken, false);

    // Arme brisée (usure >= qualité)
    const weaponBroken = {
      name: "Lame brisée",
      quality: 2,
      wearPenalty: 2,
      signatureTable: [{ roll: 1, targetStat: "force", tier: "temporaire" as const }],
    };
    const res3 = computeWeaponEffective(weaponBroken);
    assert.equal(res3.effectiveQuality, 0);
    assert.equal(res3.hitThreshold, 10);
    assert.equal(res3.isBroken, true);
  });

  test("advanceScenes réinitialise les capacités d'Oracle par Scène", () => {
    const sheet = createSampleSheet();
    sheet.sceneAbilitiesUsed = {
      "vision-orientee": true,
      "anticipation-fulgurante": true,
    };

    const res = advanceScenes(sheet, 1);
    assert.equal(res.sheet.sceneAbilitiesUsed?.["vision-orientee"], false);
    assert.equal(res.sheet.sceneAbilitiesUsed?.["anticipation-fulgurante"], false);
    assert.equal(res.compound.sceneCounter, 1);
    assert.equal(res.compound.lastDelta, 1);
  });

  test("advanceScenes applique l'échelle 1 / 10 / 100 Scènes (countdown et global_modulo)", () => {
    const sheet = createSampleSheet();
    sheet.stats.force.impairments.temporaire = 1;
    sheet.stats.agilite.impairments.mineur = 1;
    sheet.stats.constitution.impairments.majeur = 1;

    const compound: AshardeSceneCompound = { sceneCounter: 0, lastDelta: 0 };

    // 1. Avancement de 1 Scène : Temporaire guérit, Mineur et Majeur restent
    const step1 = advanceScenes(sheet, 1, compound);
    assert.equal(step1.sheet.stats.force.impairments.temporaire, 0);
    assert.equal(step1.sheet.stats.agilite.impairments.mineur, 1);
    assert.equal(step1.sheet.stats.constitution.impairments.majeur, 1);
    assert.equal(step1.compound.sceneCounter, 1);

    // 2. Avancement de 10 Scènes : Mineur guérit, Majeur reste
    const step10 = advanceScenes(step1.sheet, 10, step1.compound);
    assert.equal(step10.sheet.stats.agilite.impairments.mineur, 0);
    assert.equal(step10.sheet.stats.constitution.impairments.majeur, 1);
    assert.equal(step10.compound.sceneCounter, 11);

    // 3. Avancement de 100 Scènes : Majeur guérit
    const step100 = advanceScenes(step10.sheet, 100, step10.compound);
    assert.equal(step100.sheet.stats.constitution.impairments.majeur, 0);
    assert.equal(step100.compound.sceneCounter, 111);

    // 4. Test en mode global_modulo
    const moduloSheet = createSampleSheet();
    moduloSheet.stats.agilite.impairments.mineur = 1;
    const moduloCompound: AshardeSceneCompound = { sceneCounter: 9, lastDelta: 1 };
    // Passage de 9 à 10 : déclenche le modulo 10
    const moduloStep = advanceScenes(moduloSheet, {
      deltaScenes: 1,
      compound: moduloCompound,
      mode: "global_modulo",
    });
    assert.equal(moduloStep.compound.sceneCounter, 10);
    assert.equal(moduloStep.sheet.stats.agilite.impairments.mineur, 0);
  });

  test("buildAshardeCharacterSheetTemplate génère un bundle .bypp v17 valide avec Composé Scène Général", () => {
    const template = buildAshardeCharacterSheetTemplate({
      characterName: "Shanwen l'Émissaire",
      archetype: "reveur",
      initialSceneCounter: 1,
    });

    assert.equal(template.version, 17);
    assert.equal(template.format, "bypp");
    assert.equal(template.entities.length, 2);

    const compound = template.entities.find((e: any) => e.uid === "asharde_scene_compound_global");
    assert.ok(compound);
    assert.equal(compound.data.var_global_scene_counter, 1);

    const pj = template.entities.find((e: any) => e.uid === "asharde_character_sheet_pj");
    assert.ok(pj);
    assert.equal(pj.data.var_stat_intelligence_base, 7);
    assert.equal(pj.data.var_weapon_hit_threshold, 7);

    // Validation via le parser officiel Bypp
    const parsed = parseBeyondPaperBundle(template);
    assert.ok(parsed);
    assert.equal(parsed.version, 17);
  });

  test("formatAshardeHarpyStatblock produit un Bloc 5 strictement valide", () => {
    const sheet = createSampleSheet();
    const formatted = formatAshardeHarpyStatblock(sheet);
    const validation = validateHarpyBloc5Text(formatted);
    assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join("; ")}`);

    for (const line of formatted.split("\n")) {
      assert.ok(
        Array.from(line).length <= DEFAULT_MAX_HARPY_LINE_LENGTH,
        `Line exceeds 70 chars: '${line}'`
      );
    }
  });
});
