import { MODULE_ID } from "./constants.mjs";
import {
  ammunitionFamilyKey,
  buildCatalog,
  canonicalKey,
  entriesForProfile,
  entryMatchesSubtype,
  findEntry,
  isAmmunitionEntry,
  isBlueprintItem,
  isFirearmEntry,
  isFirearmAmmunition,
  isFirearmSupply,
  isFirearmRelated,
  isGeneratorItem,
  isMaterializerItem,
  isMechanicalItem,
  isNaturalSupplierEntry,
  isSupportedMaterializerEntry,
  isVariantFamilyItem,
  loadItemDocument,
  normalizeRarity,
  normalizeText,
  resolvePrice
} from "./catalog.mjs";
import {
  profileAccessLevel,
  vendorAccessAllowsEntry,
  vendorAccessWeight
} from "./availability.mjs";
import { getConfiguration } from "./settings.mjs";
import {
  SUPPLIER_PROFILE_SCHEMA_VERSION,
  itemGroupMatchesEntry,
  quantityRangeForRarity,
  scaleCount
} from "./profile-v2.mjs";
import {
  canMaterializeOnto,
  canonicalizeItemName,
  classifyDocumentNature,
  hasMaterializationRecipe,
  materializeEnhancement,
  materializeNativeBlueprint,
  materializeRecipe,
  materializationRecipe,
  materializeSyntheticEnhancement,
  recipeOutputIssues,
  recipeTargetCompatibility
} from "../../core/materialization/index.mjs";
import { activeRarityPrices } from "../../core/materialization/pricing.mjs";


function configurationForProfile(configuration, profile) {
  const requestedId = String(profile?.progressionProfileId ?? "world");
  const resolvedProgressionId = (!requestedId || requestedId === "world")
    ? String(configuration.activeProgressionProfileId ?? "")
    : requestedId;
  const progression = (configuration.progressionProfiles ?? []).find(entry => entry.id === resolvedProgressionId) ?? null;
  const resolved = progression ? {
    ...configuration,
    levelBands: foundry.utils.deepClone(progression.levelBands ?? configuration.levelBands ?? []),
    enchantmentBands: foundry.utils.deepClone(progression.enchantmentBands ?? configuration.enchantmentBands ?? []),
    priceFallbacks: foundry.utils.deepClone(progression.priceFallbacks ?? configuration.priceFallbacks ?? {}),
    qualityPriceAdditions: foundry.utils.deepClone(progression.qualityPriceAdditions ?? configuration.qualityPriceAdditions ?? {}),
    resolvedProgressionProfileId: progression.id ?? resolvedProgressionId,
    resolvedProgressionBuiltIn: progression.builtIn ?? "",
    resolvedProgressionHomebrew: progression.homebrew === true
  } : {
    ...configuration,
    resolvedProgressionProfileId: resolvedProgressionId,
    resolvedProgressionBuiltIn: "",
    resolvedProgressionHomebrew: false
  };
  const progressionUsesCorePricing = progression ? progression.useCorePricing !== false : resolved.useCorePricing !== false;
  if (progressionUsesCorePricing) {
    resolved.priceFallbacks = {
      none: Math.max(1, Number(resolved.priceFallbacks?.none ?? 1)),
      ...activeRarityPrices()
    };
  }
  return resolved;
}

const ENCHANTMENT_RARITY = {
  0: "none",
  1: "uncommon",
  2: "rare",
  3: "veryRare"
};

function fallbackPrice(configuration, rarity, { denomination = "gp" } = {}) {
  const normalizedRarity = normalizeRarity(rarity);
  const configured = Math.max(0, Number(configuration.priceFallbacks?.[normalizedRarity] ?? configuration.priceFallbacks?.none ?? 1) || 0);
  if (normalizedRarity === "artifact" && configured === 0) {
    return { value: 0, denomination, origin: "priceless" };
  }
  return { value: Math.max(1, configured), denomination, origin: "fallback" };
}

function clampInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Math.min(max, Math.max(min, Math.floor(Number(value ?? 0))));
}

function randomBetween(min, max) {
  const low = clampInteger(Math.min(Number(min ?? 0), Number(max ?? 0)));
  const high = clampInteger(Math.max(Number(min ?? 0), Number(max ?? 0)));
  return low + Math.floor(Math.random() * (high - low + 1));
}

export function partyScaledQuantity(value, players, baseSize = 4) {
  const base = Math.max(1, Number(baseSize ?? 4) || 4);
  return clampInteger(Math.ceil(Math.max(0, Number(value ?? 0)) * Math.max(1, Number(players ?? 1)) / base));
}

function stockBandForLevel(profile, level) {
  return (profile?.stockBands ?? []).find(entry => level >= Number(entry.min) && level <= Number(entry.max)) ?? null;
}

export function calculateQuantity(rule, players, remaining = 0, { profile = null, level = 1 } = {}) {
  const value = Math.max(0, Number(rule.quantity ?? 0));
  const baseSize = Math.max(1, Number(rule.stockScaleBase ?? profile?.stockScaleBase ?? 4) || 4);
  switch (rule.quantityMode) {
    case "players": return clampInteger(players * Math.max(1, value || 1));
    case "halfDown": return clampInteger(Math.max(1, Math.floor(players / 2)) * Math.max(1, value || 1));
    case "halfUp": return clampInteger(Math.max(1, Math.ceil(players / 2)) * Math.max(1, value || 1));
    case "partyScaled": return partyScaledQuantity(value, players, baseSize);
    case "levelPartyScaledScrolls": {
      const band = stockBandForLevel(profile, level);
      return partyScaledQuantity(Number(band?.scrolls ?? value), players, baseSize);
    }
    case "range": return randomBetween(rule.quantityMin ?? 1, rule.quantityMax ?? 1);
    case "remainder": return clampInteger(remaining);
    case "fixed":
    default: return clampInteger(value);
  }
}

export function calculateRandomTarget(profile, players, level = 1) {
  const value = Math.max(0, Number(profile.stockTotal ?? 0));
  const baseSize = Math.max(1, Number(profile.stockScaleBase ?? 4) || 4);
  switch (profile.stockTotalMode) {
    case "perPlayer":
    case "playersMultiplier": return clampInteger(players * value);
    case "players": return clampInteger(players);
    case "halfDown": return clampInteger(Math.floor(players / 2));
    case "halfUp": return clampInteger(Math.ceil(players / 2));
    case "partyScaled": return partyScaledQuantity(value, players, baseSize);
    case "levelPartyScaled": {
      const band = stockBandForLevel(profile, level);
      const total = Math.max(0, Number(band?.total ?? value));
      const scrolls = Math.max(0, Number(band?.scrolls ?? 0));
      return partyScaledQuantity(Math.max(0, total - scrolls), players, baseSize);
    }
    case "fixed":
    default: return clampInteger(value);
  }
}

function bandForLevel(configuration, level) {
  return (configuration.levelBands ?? []).find(entry => level >= Number(entry.min) && level <= Number(entry.max));
}

function raritiesForLevel(configuration, level) {
  const band = bandForLevel(configuration, level);
  return band?.rarities?.length ? band.rarities : ["none", "common"];
}

function maxSpellLevelForLevel(configuration, level) {
  const band = bandForLevel(configuration, level);
  if (Number.isFinite(Number(band?.maxSpellLevel))) return clampInteger(band.maxSpellLevel, 0, 9);
  return Math.min(9, Math.max(0, Math.ceil(level / 2)));
}

function canReceiveSyntheticEnhancement(entry) {
  return entry.type === "weapon"
    || (entry.type === "equipment" && Boolean(entry.armorCategory))
    || isAmmunitionEntry(entry);
}

function categoryEntries(profileEntries, rule, catalog) {
  switch (rule.category) {
    case "weapon": return profileEntries.filter(entry => entry.type === "weapon");
    case "armor": // Legacy v0.0.1d rules are migrated to Equipment.
    case "equipment": return profileEntries.filter(entry => entry.type === "equipment");
    case "consumable": {
      const ammunitionRule = (rule.subtypes ?? []).includes("ammunition");
      return profileEntries.filter(entry => entry.type === "consumable" || (ammunitionRule && isAmmunitionEntry(entry)));
    }
    case "tool": return profileEntries.filter(entry => entry.type === "tool");
    case "loot": return profileEntries.filter(entry => entry.type === "loot");
    case "container": return profileEntries.filter(entry => entry.type === "container");
    case "spellScroll": return profileEntries.filter(entry => entry.type === "spell");
    case "exact": return profileEntries;
    default: return [];
  }
}

function isExcluded(entry, excludedReferences) {
  const values = new Set((excludedReferences ?? []).map(normalizeText));
  return values.has(normalizeText(entry.identifier)) || values.has(normalizeText(entry.name));
}

function isFamilyExcluded(entry, excludedFamilies) {
  const excluded = new Set(excludedFamilies ?? []);
  return (entry.familyIds ?? []).some(familyId => excluded.has(familyId));
}

function isFamilyIncluded(entry, includeFamilies) {
  const included = new Set(includeFamilies ?? []);
  if (!included.size) return true;
  return (entry.familyIds ?? []).some(familyId => included.has(familyId));
}

function isPoolExcluded(entry, rule) {
  const values = isMaterializerItem(entry)
    ? (rule?.materializerExclusions ?? [])
    : (rule?.poolExclusions ?? []);
  return new Set(values.map(String)).has(canonicalKey(entry));
}

function subtypeMatch(entry, rule) {
  const subtypes = rule.subtypes ?? [];
  if (!subtypes.length) return true;
  if (subtypes.includes("ammunition") && isAmmunitionEntry(entry)) return true;
  if (subtypes.some(subtype => entryMatchesSubtype(entry, subtype))) return true;

  // Generic materializers describe the family of possible final Items rather
  // than one native subtype. Let them enter a compatible rule and constrain
  // the concrete base Item later during materialization.
  if (isGeneratorItem(entry)) {
    const kind = String(entry.generatorKind ?? "");
    if (kind === "weaponEnhancement") return subtypes.some(subtype => ["simpleM", "simpleR", "martialM", "martialR"].includes(subtype));
    if (kind === "armorEnhancement") return subtypes.some(subtype => ["lightArmor", "mediumArmor", "heavyArmor"].includes(subtype));
    if (kind === "shieldEnhancement") return subtypes.includes("shield");
    if (["ammunitionVaries", "ammunitionEnhancement"].includes(kind)) return subtypes.includes("ammunition");
  }
  if (isBlueprintItem(entry) && !(entry.subtypeKeys ?? []).filter(Boolean).length) return true;
  return false;
}

function magicMatch(entry, rule, configuration, level, { applyProgression = true } = {}) {
  if (rule.category === "spellScroll") return true;

  if (isVariantFamilyItem(entry)) {
    if (rule.magicalState === "mundane") return false;
    const maximum = applyProgression ? maxEnhancementForLevel(configuration, level) : 3;
    const concreteVariant = (entry.sourceVariants ?? []).some(variant => variant.variantConcrete === true
      && Number(variant.enhancement ?? 0) > 0
      && Number(variant.enhancement ?? 0) <= maximum);
    if (concreteVariant) return true;

    // Some official sources expose only the unresolved family template (for
    // example the PHB 2024 Wand of the War Mage). A registered recipe can
    // resolve that template even when no concrete +1/+2/+3 source document is
    // available, so keep it in the magical pool whenever progression allows a
    // positive tier.
    return maximum > 0
      && entry.materializerSupported === true
      && (entry.sourceVariants ?? []).some(variant => variant.recipeSupported === true);
  }

  if (isGeneratorItem(entry)) {
    const mundaneOutput = entry.generatorKind === "ammunitionVaries";
    if (rule.magicalState === "magical" && mundaneOutput) return false;
    if (rule.magicalState === "mundane" && entry.generatorMagical
      && !["party", "fixed"].includes(rule.qualityMode)) return false;
    if (rule.qualityMode === "mundane" && entry.generatorMagical) return false;
    if (applyProgression && entry.generatorMagical && maxEnhancementForLevel(configuration, level) <= 0) return false;
    return true;
  }

  if (isBlueprintItem(entry)) {
    if (rule.magicalState === "mundane") return false;
    // A blueprint is a recipe for a magical final Item even when its index
    // record does not expose the rarity change until the Enchantment prepares.
    return true;
  }

  if (rule.magicalState === "mundane" && entry.isMagical) return false;
  if (rule.magicalState === "magical" && !entry.isMagical) return false;
  if (applyProgression && rule.requireMagicalResult === true
    && canReceiveSyntheticEnhancement(entry)
    && !entry.isMagical
    && maxEnhancementForLevel(configuration, level) <= 0) return false;

  // A ready-made +2/+3 document may exist in an enabled source, but it must
  // never bypass the party progression table merely because the source Item
  // itself passed the broad category filter.
  if (applyProgression && canReceiveSyntheticEnhancement(entry)
    && Number(entry.enhancement ?? 0) > maxEnhancementForLevel(configuration, level)) return false;

  // Party/fixed quality is applied to a mundane base item after selection.
  if (canReceiveSyntheticEnhancement(entry)
    && ["party", "mundane", "fixed"].includes(rule.qualityMode)
    && entry.isMagical) return false;
  return true;
}

function rarityMatch(entry, rule, configuration, level, { applyProgression = true } = {}) {
  if (!applyProgression || entry.type === "spell") return true;
  if (isVariantFamilyItem(entry)) {
    const rarities = new Set(raritiesForLevel(configuration, level).map(normalizeRarity));
    const maximum = maxEnhancementForLevel(configuration, level);
    const concreteVariant = (entry.sourceVariants ?? []).some(variant => variant.variantConcrete === true
      && Number(variant.enhancement ?? 0) <= maximum
      && (!rarities.size || rarities.has(normalizeRarity(variant.rarity))));
    if (concreteVariant) return true;

    // A recipe-backed family selects its concrete tier only after entering the
    // pool. Its unresolved source document intentionally has no final rarity,
    // so eligibility is governed by the current enhancement ceiling instead.
    return maximum > 0
      && entry.materializerSupported === true
      && (entry.sourceVariants ?? []).some(variant => variant.recipeSupported === true);
  }
  if (isGeneratorItem(entry)) {
    if (entry.generatorKind === "ammunitionVaries") return true;
    return maxEnhancementForLevel(configuration, level) > 0;
  }
  if (isBlueprintItem(entry) && normalizeRarity(entry.rarity) === "none") return true;
  const rarities = new Set(raritiesForLevel(configuration, level).map(normalizeRarity));
  if (!rarities.size) return true;

  const entryRarity = normalizeRarity(entry.rarity);
  const syntheticBase = canReceiveSyntheticEnhancement(entry)
    && ["party", "mundane", "fixed"].includes(rule.qualityMode)
    && entryRarity === "none";
  return syntheticBase || rarities.has(entryRarity);
}

function spellLevelMatch(entry, rule, configuration, level, { applyProgression = true } = {}) {
  if (entry.type !== "spell") return true;
  if (!applyProgression) return true;
  if (rule.spellLevelMode === "fixed") {
    const levels = new Set((rule.spellLevels ?? []).map(Number));
    return !levels.size || levels.has(entry.spellLevel);
  }
  return entry.spellLevel <= maxSpellLevelForLevel(configuration, level);
}

export function inspectRulePool({ rule, catalog, profileEntries, configuration, profile = null, level = 1, applyProgression = true }) {
  if (!rule?.category) {
    return { count: 0, reason: "category", names: [], stages: { source: profileEntries.length, category: 0 } };
  }

  if (rule.category === "exact") {
    const references = (rule.itemRefs?.length ? rule.itemRefs : [rule.itemRef])
      .map(reference => reference?.uuid ?? reference?.itemRef ?? reference)
      .filter(Boolean);
    const found = references.map(reference => findEntry(catalog, reference, profileEntries)).filter(Boolean);
    const eligible = found.filter(entry =>
      (profile?.allowCursedItems === true || entry.isCursed !== true)
      && vendorAccessAllowsEntry(entry, profile, rule)
      && magicMatch(entry, rule, configuration, level, { applyProgression })
      && rarityMatch(entry, rule, configuration, level, { applyProgression })
      && spellLevelMatch(entry, rule, configuration, level, { applyProgression })
      && !isPoolExcluded(entry, rule)
    );
    return {
      count: eligible.length,
      reason: eligible.length ? "" : "exact",
      names: eligible.slice(0, 8).map(entry => entry.name),
      entries: eligible,
      stages: { source: profileEntries.length, category: found.length, final: eligible.length }
    };
  }

  const stageCategory = categoryEntries(profileEntries, rule, catalog);
  const stageSubtype = stageCategory.filter(entry => subtypeMatch(entry, rule));
  const stageCursed = stageSubtype.filter(entry => profile?.allowCursedItems === true || entry.isCursed !== true);
  const stageAccess = stageCursed.filter(entry => vendorAccessAllowsEntry(entry, profile, rule));
  const stageMagic = stageAccess.filter(entry => magicMatch(entry, rule, configuration, level, { applyProgression }));
  const stageRarity = stageMagic.filter(entry => rarityMatch(entry, rule, configuration, level, { applyProgression }));
  const stageSpell = stageRarity.filter(entry => spellLevelMatch(entry, rule, configuration, level, { applyProgression }));
  const stageFinal = stageSpell.filter(entry =>
    isFamilyIncluded(entry, rule.includeFamilies)
    && !isExcluded(entry, rule.excludeRefs)
    && !isFamilyExcluded(entry, rule.excludeFamilies)
    && !isPoolExcluded(entry, rule)
  );

  let reason = "";
  if (!stageCategory.length) reason = "category";
  else if (!stageSubtype.length) reason = "subtype";
  else if (!stageCursed.length) reason = "curation";
  else if (!stageAccess.length) reason = "access";
  else if (!stageMagic.length) reason = "magic";
  else if (!stageRarity.length) reason = "rarity";
  else if (!stageSpell.length) reason = "spellLevel";
  else if (!stageFinal.length) reason = "exclusion";

  const buckets = buildRuleBuckets(stageFinal, rule).map(group => ({ key: group.key, count: group.entries.length }));
  return {
    count: stageFinal.length,
    reason,
    names: stageFinal.slice(0, 8).map(entry => entry.name),
    entries: stageFinal,
    buckets,
    stages: {
      source: profileEntries.length,
      category: stageCategory.length,
      subtype: stageSubtype.length,
      cursed: stageCursed.length,
      access: stageAccess.length,
      magic: stageMagic.length,
      rarity: stageRarity.length,
      spellLevel: stageSpell.length,
      final: stageFinal.length
    }
  };
}

function finalMaterializedAvailabilityAccepted(pick, rarity) {
  const finalEntry = {
    ...(pick?.entry ?? {}),
    rarity: normalizeRarity(rarity),
    materializerRarities: [normalizeRarity(rarity)]
  };
  return vendorAccessAllowsEntry(finalEntry, pick?.profile ?? null, pick?.rule ?? null);
}

function progressionRarityWeight(entry, configuration, level) {
  const band = bandForLevel(configuration, level);
  const weights = band?.rarityWeights ?? null;
  if (!weights) return 1;
  const candidates = [];
  const direct = normalizeRarity(entry?.rarity);
  if (!["none", "varies", "artifact"].includes(direct)) candidates.push(direct);
  for (const rarity of entry?.materializerRarities ?? []) {
    const normalized = normalizeRarity(rarity);
    if (!["none", "varies", "artifact"].includes(normalized)) candidates.push(normalized);
  }
  if (!candidates.length) return 1;
  return Math.max(0.01, ...candidates.map(rarity => Math.max(0, Number(weights?.[rarity] ?? 0))));
}

function entrySelectionWeight(entry, rule, level, profile = null, configuration = null) {
  let weight = 1;
  // Vendor Access is a gradient for ordinary merchandise. It does not replace
  // the party-level rarity progression and only becomes a hard gate for
  // explicit restrictions, artifacts, and major relics.
  weight *= vendorAccessWeight(entry, profile);
  if (configuration) weight *= progressionRarityWeight(entry, configuration, level);
  // Profile System v2 exposes affinity as Item Group data. This is the only
  // thematic selection bias; presets and hand-built profiles use the same field.
  weight *= Math.max(0.01, Number(entry?.supplierSelectionWeight ?? 1));
  return weight;
}

const STOCK_FAMILY_PATTERNS = Object.freeze([
  ["vicious-weapon", /(?:^|-)vicious(?:-|$)/],
  ["mithral-armor", /(?:^|-)mithral(?:-|$)/],
  ["adamantine-armor", /(?:^|-)adamantine(?:-|$)/],
  ["armor-of-resistance", /armor-of-[a-z]+-resistance|armor-of-resistance/],
  ["potion-of-resistance", /potion-of-[a-z]+-resistance|potion-of-resistance/],
  ["armor-of-etherealness", /(?:armor|shield)-of-etherealness/],
  ["armor-of-vulnerability", /armor-of-vulnerability/],
  ["weapon-of-warning", /(?:weapon|[a-z]+)-of-warning/],
  ["weapon-of-wounding", /(?:weapon|[a-z]+)-of-wounding/],
  ["weapon-of-sharpness", /(?:weapon|[a-z]+)-of-sharpness/],
  ["life-stealing-weapon", /life-stealing|life-stealer/],
  ["nine-lives-stealer", /nine-lives/],
  ["holy-avenger", /holy-avenger/],
  ["flame-tongue", /flame-tongue/],
  ["vorpal-weapon", /(?:^|-)vorpal(?:-|$)/],
  ["dragon-slayer", /dragon-slayer/],
  ["giant-slayer", /giant-slayer/],
  ["shield-of-missile-attraction", /shield-of-missile-attraction/],
  ["belt-of-giant-strength", /belt-of-(?:[a-z]+-)?giant-strength/],
  ["feather-token", /feather-token/],
  ["bag-of-tricks", /bag-of-tricks/],
  ["elemental-gem", /elemental-gem/],
  ["figurine-of-wondrous-power", /figurine-of-wondrous-power/]
]);

function stockFamilyKey(entry) {
  const ammunitionFamily = isAmmunitionEntry(entry) ? ammunitionFamilyKey(entry) : "";
  if (ammunitionFamily) return `ammunition:${ammunitionFamily}`;
  if (entry.variantFamily) return `variant:${entry.variantFamily}`;
  const identity = normalizeText([
    entry.materializerFamily,
    entry.identifier,
    entry.name,
    entry.baseItem
  ].filter(Boolean).join(" "));
  const matched = STOCK_FAMILY_PATTERNS.find(([, pattern]) => pattern.test(identity));
  if (matched) return `known:${matched[0]}`;
  if (entry.materializerFamily) return `materializer:${entry.materializerFamily}`;
  if ((entry.familyIds ?? []).length) return `family:${entry.familyIds[0]}`;
  const name = String(entry.name ?? "");
  if (name.includes("(")) return `name:${normalizeText(name.split("(")[0])}`;
  return canonicalKey(entry);
}

function weightedEntryChoice(entries, rule, level, profile = null, configuration = null) {
  if (!entries.length) return null;
  const familySizes = new Map();
  for (const entry of entries) {
    const key = stockFamilyKey(entry);
    familySizes.set(key, Number(familySizes.get(key) ?? 0) + 1);
  }
  const weighted = entries.map(entry => {
    // Every adaptable family receives one effective lottery ticket regardless
    // of how many source-specific variants are installed.
    const familySize = Math.max(1, Number(familySizes.get(stockFamilyKey(entry)) ?? 1));
    return { entry, weight: entrySelectionWeight(entry, rule, level, profile, configuration) / familySize };
  }).filter(option => option.weight > 0);
  if (!weighted.length) return null;
  const total = weighted.reduce((sum, option) => sum + option.weight, 0);
  let roll = Math.random() * total;
  for (const option of weighted) {
    roll -= option.weight;
    if (roll <= 0) return option.entry;
  }
  return weighted.at(-1)?.entry ?? entries[0];
}

function rulePassesChance(rule) {
  const chance = Math.min(100, Math.max(0, Number(rule?.chance ?? 100)));
  return chance >= 100 || Math.random() * 100 < chance;
}

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

export function buildRuleBuckets(pool, rule) {
  if (!pool.length) return [];
  const selectedSubtypes = rule.subtypes ?? [];
  const groups = new Map();

  for (const entry of pool) {
    let key = "all";
    if (selectedSubtypes.length) {
      const primary = entry.primarySubtypeKey;
      if (primary && selectedSubtypes.includes(primary)) key = primary;
      else key = selectedSubtypes.find(subtype => entryMatchesSubtype(entry, subtype)) ?? "all";
    } else if (entry.primarySubtypeKey) key = entry.primarySubtypeKey;

    const entries = groups.get(key) ?? [];
    entries.push(entry);
    groups.set(key, entries);
  }

  return [...groups.entries()].map(([key, entries]) => ({ key, entries }));
}

function enchantmentBand(configuration, level) {
  return (configuration.enchantmentBands ?? []).find(entry => level >= Number(entry.min) && level <= Number(entry.max));
}

function maxEnhancementForLevel(configuration, level) {
  const weights = enchantmentBand(configuration, level)?.weights ?? { 0: 100, 1: 0, 2: 0, 3: 0 };
  return [3, 2, 1].find(bonus => Number(weights?.[bonus] ?? weights?.[String(bonus)] ?? 0) > 0) ?? 0;
}

function weightedBonus(configuration, level, { positiveOnly = false } = {}) {
  const weights = enchantmentBand(configuration, level)?.weights ?? { 0: 100, 1: 0, 2: 0, 3: 0 };
  const options = [0, 1, 2, 3]
    .filter(bonus => !positiveOnly || bonus > 0)
    .map(bonus => ({ bonus, weight: Math.max(0, Number(weights[bonus] ?? weights[String(bonus)] ?? 0)) }))
    .filter(option => option.weight > 0);
  if (!options.length) return 0;
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  let roll = Math.random() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.bonus;
  }
  return options.at(-1).bonus;
}

function minimumEnchanted(rule, players, eligibleCount) {
  const value = Math.max(0, Number(rule.enchantedMinimum ?? 0));
  let result = 0;
  switch (rule.enchantedMinimumMode) {
    case "fixed": result = value; break;
    case "players": result = players * Math.max(1, value || 1); break;
    case "halfDown": result = Math.floor(players / 2) * Math.max(1, value || 1); break;
    case "halfUp": result = Math.ceil(players / 2) * Math.max(1, value || 1); break;
    case "none":
    default: result = 0;
  }
  return Math.min(eligibleCount, clampInteger(result));
}

function applyQuality(rule, entries, configuration, level, players, warnings) {
  const picks = entries.map(entry => ({ entry, enhancement: entry.enhancement || 0, units: 1 }));

  for (const pick of picks) {
    if (!canReceiveSyntheticEnhancement(pick.entry)) continue;
    if (rule.qualityMode === "mundane") pick.enhancement = 0;
    else if (rule.qualityMode === "fixed") pick.enhancement = clampInteger(rule.fixedBonus, 0, 3);
    else if (rule.qualityMode === "party" && !pick.entry.isMagical) {
      pick.enhancement = weightedBonus(configuration, level, { positiveOnly: rule.requireMagicalResult === true });
    }
  }

  // A rule that explicitly promises a magical result must never degrade into
  // a second mundane stack when the selected progression has no positive tier.
  if (rule.requireMagicalResult === true) {
    return picks.filter(pick => pick.entry.isMagical || Number(pick.enhancement ?? 0) > 0);
  }

  const eligible = picks.filter(pick => canReceiveSyntheticEnhancement(pick.entry));
  const required = minimumEnchanted(rule, players, eligible.length);
  let enchanted = eligible.filter(pick => pick.entry.isMagical || pick.enhancement > 0).length;
  if (required > enchanted) {
    const promotable = eligible.filter(pick => !pick.entry.isMagical && pick.enhancement === 0);
    while (enchanted < required && promotable.length) {
      const index = Math.floor(Math.random() * promotable.length);
      const [pick] = promotable.splice(index, 1);
      pick.enhancement = weightedBonus(configuration, level, { positiveOnly: true });
      if (pick.enhancement <= 0) {
        warnings.push(game.i18n.localize("DND5E_SUPPLIER.Errors.NoUnlockedEnchantment"));
        break;
      }
      enchanted += 1;
    }
  }
  return picks;
}

async function applySyntheticEnhancement(document, bonus, configuration) {
  return materializeSyntheticEnhancement({
    baseDocument: document,
    bonus,
    qualityPriceAdditions: configuration.qualityPriceAdditions ?? {}
  });
}

function normalizeScrollActivityLevels(data) {
  const activities = foundry.utils.getProperty(data, "system.activities");
  if (!activities || typeof activities !== "object") return;
  for (const activity of Object.values(activities)) {
    if (activity?.spell?.level !== undefined) activity.spell.level = Number(activity.spell.level);
  }
}

async function createSpellScrollPreview(entry, configuration) {
  const spell = await loadItemDocument(entry);
  const level = Number(spell.system.level ?? entry.spellLevel ?? 0);
  const ItemClass = CONFIG.Item.documentClass;
  if (typeof ItemClass.createScrollFromSpell !== "function") {
    throw new Error(game.i18n.localize("DND5E_SUPPLIER.Errors.ScrollApiUnavailable"));
  }
  const scroll = await ItemClass.createScrollFromSpell(spell, {}, {
    dialog: false,
    level,
    explanation: "reference"
  });
  if (!scroll) throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.ScrollCreationFailed", { spell: spell.name }));
  const data = scroll.toObject ? scroll.toObject() : foundry.utils.deepClone(scroll);
  normalizeScrollActivityLevels(data);
  const rarity = normalizeRarity(foundry.utils.getProperty(data, "system.rarity"));
  const priceValue = Number(foundry.utils.getProperty(data, "system.price.value") ?? 0);
  const price = priceValue > 0
    ? { value: priceValue, denomination: foundry.utils.getProperty(data, "system.price.denomination") ?? "gp", origin: "official" }
    : fallbackPrice(configuration, rarity);
  return { data, price, rarity, spellLevel: level };
}

function singularIdentity(value) {
  const normalized = normalizeText(value);
  return normalized.endsWith("s") && normalized.length > 3 ? normalized.slice(0, -1) : normalized;
}

function generatorBaseHintMatches(entry, hint) {
  const normalizedHint = singularIdentity(hint);
  if (!normalizedHint || ["weapon", "armor", "shield", "ammunition", "ammo"].includes(normalizedHint)) return true;
  const values = [entry.identifier, entry.name, entry.baseItem].map(singularIdentity).filter(Boolean);
  return values.some(value => value === normalizedHint || value.endsWith(`-${normalizedHint}`) || normalizedHint.endsWith(`-${value}`));
}


function generatorResultCandidates(generatorEntry, targetEntries, rule) {
  const kind = generatorEntry.generatorKind;
  let candidates = targetEntries.filter(entry =>
    !isMaterializerItem(entry)
    && !isMechanicalItem(entry)
    && !entry.isMagical
    && !isExcluded(entry, rule.excludeRefs)
    && !isFamilyExcluded(entry, rule.excludeFamilies)
    && !isPoolExcluded(entry, rule)
  );

  if (kind === "weaponEnhancement") {
    candidates = candidates.filter(entry => entry.type === "weapon" && subtypeMatch(entry, rule));
  } else if (kind === "armorEnhancement") {
    candidates = candidates.filter(entry => entry.type === "equipment" && Boolean(entry.armorCategory) && entry.armorCategory !== "shield" && subtypeMatch(entry, rule));
  } else if (kind === "shieldEnhancement") {
    candidates = candidates.filter(entry => entry.type === "equipment" && entry.armorCategory === "shield" && subtypeMatch(entry, rule));
  } else if (["ammunitionVaries", "ammunitionEnhancement"].includes(kind)) {
    candidates = candidates.filter(entry => isAmmunitionEntry(entry) && subtypeMatch(entry, rule));
  } else return [];

  const baseHint = String(generatorEntry.generatorBaseHint ?? "");
  const hintedCandidates = candidates.filter(entry => generatorBaseHintMatches(entry, baseHint));
  if (baseHint && !["weapon", "armor", "shield", "ammunition", "ammo"].includes(normalizeText(baseHint))) {
    candidates = hintedCandidates;
  }

  return candidates;
}

function generatorEnhancement(pick, configuration, level) {
  const kind = pick.entry.generatorKind;
  const rule = pick.rule;
  if (rule.qualityMode === "mundane") return 0;
  if (rule.qualityMode === "fixed") return clampInteger(rule.fixedBonus, 0, 3);
  if (rule.qualityMode === "party") return weightedBonus(configuration, level, { positiveOnly: kind !== "ammunitionVaries" });
  if (Number(pick.enhancement ?? 0) > 0) return clampInteger(pick.enhancement, 0, 3);
  if (kind === "ammunitionVaries") return 0;
  return weightedBonus(configuration, level, { positiveOnly: true });
}

function priceFromMaterializedData(documentData, display, fallback, origin = "materialized") {
  const value = Number(display?.priceValue ?? foundry.utils.getProperty(documentData, "system.price.value") ?? 0);
  if (Number.isFinite(value) && value > 0) {
    return {
      value: Math.max(1, value),
      denomination: display?.priceDenomination ?? foundry.utils.getProperty(documentData, "system.price.denomination") ?? fallback?.denomination ?? "gp",
      origin
    };
  }
  return fallback;
}

const PRICE_IN_COPPER = Object.freeze({ cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 });

function priceInCopper(price = {}) {
  const denomination = String(price?.denomination ?? "gp").toLowerCase();
  const multiplier = Number(PRICE_IN_COPPER[denomination] ?? PRICE_IN_COPPER.gp);
  return Math.max(0, Number(price?.value ?? 0) || 0) * multiplier;
}

function priceFromCopper(copper, { origin = "materialized" } = {}) {
  const total = Math.max(0, Math.round(Number(copper) || 0));
  if (total % PRICE_IN_COPPER.gp === 0) {
    return { value: total / PRICE_IN_COPPER.gp, denomination: "gp", origin };
  }
  if (total % PRICE_IN_COPPER.sp === 0) {
    return { value: total / PRICE_IN_COPPER.sp, denomination: "sp", origin };
  }
  return { value: total, denomination: "cp", origin };
}

function isHammerHomebrewPricing(configuration) {
  return configuration?.resolvedProgressionHomebrew === true
    || String(configuration?.resolvedProgressionBuiltIn ?? "") === "homebrew"
    || String(configuration?.resolvedProgressionProfileId ?? "") === "hammer-homebrew";
}

function finalizeMaterializedPrice(documentData, rarity, configuration, baseEntry = null, catalog = null, materialization = null) {
  const normalized = normalizeRarity(rarity);
  const recipeId = String(materialization?.recipeId ?? materialization?.family ?? "");
  const recipe = recipeId ? materializationRecipe(recipeId) : null;
  let resolved;

  if (recipe?.pricing === "base-plus-rarity" && baseEntry && catalog) {
    const base = resolvePrice(baseEntry, catalog, configuration);
    const normalMagicPrice = fallbackPrice(configuration, normalized);
    const magicPrice = recipe.id === "adamantine-armor" && isHammerHomebrewPricing(configuration)
      ? { value: Number(recipe.hammerMagicSurcharge ?? 1500), denomination: "gp" }
      : normalMagicPrice;
    resolved = priceFromCopper(priceInCopper(base) + priceInCopper(magicPrice), {
      origin: recipe.id === "adamantine-armor" && isHammerHomebrewPricing(configuration)
        ? "hammerAdamantine"
        : "materializedBasePlusRarity"
    });
  } else if (!["none", "varies"].includes(normalized)) {
    // A resolved magic rarity is authoritative. Never keep the mundane base
    // price or a 1 GP template placeholder on a materialized magic Item.
    resolved = { ...fallbackPrice(configuration, normalized), origin: "materializedRarity" };
  } else {
    const base = baseEntry && catalog ? resolvePrice(baseEntry, catalog, configuration) : { value: 1, denomination: "gp" };
    const current = {
      value: Math.max(0, Number(foundry.utils.getProperty(documentData, "system.price.value") ?? 0)),
      denomination: foundry.utils.getProperty(documentData, "system.price.denomination") ?? base.denomination ?? "gp"
    };
    const useCurrent = priceInCopper(current) >= priceInCopper(base);
    resolved = {
      ...(useCurrent ? current : base),
      value: Math.max(1, Number((useCurrent ? current : base).value ?? 1)),
      origin: "materializedBaseFloor"
    };
  }
  foundry.utils.setProperty(documentData, "system.price", {
    value: Math.max(0, Number(resolved.value) || 0),
    denomination: resolved.denomination || "gp"
  });
  return resolved;
}

function mundaneRecipeBaseCandidates(catalog) {
  return (catalog?.entries ?? []).filter(entry =>
    entry?.type === "equipment"
    && entry?.isMagical !== true
    && ["light", "medium", "heavy"].includes(String(entry?.armorCategory ?? ""))
  );
}

function recipeBaseEntryForLine(line, pick, recipe, catalog) {
  const explicitReference = line?.materializedBaseUuid
    || line?.materialization?.baseUuid
    || foundry.utils.getProperty(line?.documentData, "flags.hammer-materialization-core.baseUuid")
    || "";
  if (explicitReference) {
    const direct = findEntry(catalog, explicitReference);
    if (direct && direct.isMagical !== true) return direct;
  }

  const candidates = mundaneRecipeBaseCandidates(catalog);
  const explicitBase = normalizeText(foundry.utils.getProperty(line?.documentData, "system.type.baseItem"));
  if (explicitBase) {
    const match = candidates.find(entry => [entry.identifier, entry.baseItem, entry.name]
      .map(normalizeText)
      .some(value => value && (value === explicitBase || value.endsWith(`-${explicitBase}`) || explicitBase.endsWith(`-${value}`))));
    if (match) return match;
  }

  const prefixes = {
    "adamantine-armor": ["adamantine"],
    "mithral-armor": ["mithral"],
    "elven-chain": ["elven"]
  }[recipe?.id] ?? [];
  let stripped = normalizeText(line?.name ?? line?.documentData?.name ?? pick?.entry?.name ?? "");
  for (const prefix of prefixes) stripped = stripped.replace(new RegExp(`^${prefix}-?`), "");
  stripped = stripped.replace(/^armor-/, "").replace(/-armor$/, "");

  const ordered = [...candidates].sort((a, b) => normalizeText(b.name).length - normalizeText(a.name).length);
  return ordered.find(entry => {
    const identities = [entry.identifier, entry.baseItem, entry.name].map(normalizeText).filter(Boolean);
    return identities.some(value => stripped === value || stripped.endsWith(`-${value}`) || stripped.includes(value));
  }) ?? null;
}

/**
 * Apply recipe pricing after every stock path has produced its final document.
 * This deliberately runs for copy/pass-through Items as well as blueprints so
 * the same Adamantine or Mithral armor has one price in every vendor/source.
 */
export function finalizeGlobalRecipePrice(line, pick, catalog, configuration) {
  if (!line?.documentData) return line;
  const recipeId = String(line.materialization?.recipeId ?? "");
  const recipe = (recipeId ? materializationRecipe(recipeId) : null)
    ?? materializationRecipe(line.documentData);
  if (!recipe || !recipe.pricing || recipe.pricing === "quality") return line;

  const rarity = normalizeRarity(line.rarity ?? foundry.utils.getProperty(line.documentData, "system.rarity"));
  const baseEntry = recipe.pricing === "base-plus-rarity"
    ? recipeBaseEntryForLine(line, pick, recipe, catalog)
    : null;
  if (recipe.pricing === "base-plus-rarity" && !baseEntry) {
    throw new Error(`Global recipe pricing could not resolve the mundane base for ${line.name ?? pick?.entry?.name ?? recipe.id}.`);
  }

  const price = finalizeMaterializedPrice(line.documentData, rarity, configuration, baseEntry, catalog, {
    ...(line.materialization ?? {}),
    recipeId: recipe.id,
    family: recipe.id
  });
  line.price = price;
  line.materialization = {
    ...(line.materialization ?? {}),
    recipeId: recipe.id,
    family: line.materialization?.family ?? recipe.id,
    globalPriceFinalized: true,
    priceOrigin: price.origin
  };
  return line;
}

async function createGeneratorPreview(pick, catalog, configuration, targetEntries, level) {
  const kind = pick.entry.generatorKind;
  const candidates = shuffle(generatorResultCandidates(pick.entry, targetEntries, pick.rule));
  if (!candidates.length) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.GeneratorNoEligibleResult", { item: pick.entry.name }));
  }

  const bonus = generatorEnhancement(pick, configuration, level);
  if (kind !== "ammunitionVaries" && bonus <= 0) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.GeneratorQualityUnavailable", { item: pick.entry.name, level }));
  }

  const templateDocument = await loadItemDocument({ ...pick.entry, uuid: pick.entry.materializerSourceUuid || pick.entry.uuid });
  let materialized = null;
  let baseEntry = null;
  for (const candidate of candidates) {
    try {
      const baseDocument = await loadItemDocument(candidate);
      const attempt = kind === "ammunitionVaries"
        ? { ok: true, documentData: baseDocument.toObject(), display: { name: baseDocument.name, img: baseDocument.img, type: baseDocument.type, subtype: baseDocument.system?.type?.value, rarity: baseDocument.system?.rarity }, metadata: { kind: "sellable", strategy: "base-copy", bonus: 0 } }
        : await materializeEnhancement({
          templateDocument,
          baseDocument,
          bonus,
          qualityPriceAdditions: configuration.qualityPriceAdditions ?? {},
          partyLevel: level,
          allowedRarities: raritiesForLevel(configuration, level),
          maxBonus: maxEnhancementForLevel(configuration, level)
        });
      if (!attempt.ok) continue;
      materialized = attempt;
      baseEntry = candidate;
      break;
    } catch (error) {
      console.warn(`${MODULE_ID} | Generator base rejected`, templateDocument.name, candidate.name, error);
    }
  }
  if (!materialized || !baseEntry) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationFailed", { item: pick.entry.name }));
  }

  const documentData = materialized.documentData;
  const display = materialized.display ?? {};
  let price = priceFromMaterializedData(documentData, display, resolvePrice(baseEntry, catalog, configuration), bonus > 0 ? "generatedQuality" : "official");
  let rarity = normalizeRarity(display.rarity ?? foundry.utils.getProperty(documentData, "system.rarity") ?? baseEntry.rarity);
  if (bonus > 0) rarity = ENCHANTMENT_RARITY[bonus] ?? rarity;
  const selectionKey = normalizeText(JSON.stringify(materialized.metadata ?? {}));
  return {
    key: `${canonicalKey(baseEntry)}|generator:${pick.entry.uuid}|bonus:${bonus}|selection:${selectionKey}`,
    name: display.name ?? documentData.name,
    img: display.img ?? documentData.img,
    type: display.type ?? documentData.type,
    subtype: display.subtype ?? foundry.utils.getProperty(documentData, "system.type.value") ?? baseEntry.subtype,
    rarity,
    quantity: Math.max(1, Number(pick.units ?? 1)),
    packLabel: baseEntry.packLabel,
    sourceUuid: baseEntry.uuid,
    generatorSourceUuid: pick.entry.uuid,
    blueprintSourceUuid: materialized.metadata?.blueprintUuid ?? "",
    materializedBaseUuid: baseEntry.uuid,
    materialization: materialized.metadata ?? {},
    price,
    documentData,
    generationKind: kind === "ammunitionVaries" ? "copy" : "materializedGenerator",
    documentNature: kind === "ammunitionVaries" ? "sellable" : "materializer",
    materializerKind: kind === "ammunitionVaries" ? "" : "generator",
    enhancement: bonus,
    ruleIds: [pick.rule.id]
  };
}

function shuffle(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function blueprintCandidateEntries(blueprintDocument, targetEntries, rule) {
  const blueprintData = blueprintDocument.toObject();
  const activities = Object.values(foundry.utils.getProperty(blueprintData, "system.activities") ?? {}).filter(activity => activity?.type === "enchant");
  const allowedTypes = new Set(activities.flatMap(activity => {
    const value = activity?.restrictions?.type;
    return Array.isArray(value) ? value : value ? [value] : [];
  }).map(String));
  if (!allowedTypes.size && blueprintData.type) allowedTypes.add(blueprintData.type);
  const allowMagicalBase = activities.some(activity => activity?.restrictions?.allowMagical === true);

  let candidates = targetEntries.filter(entry =>
    !isMaterializerItem(entry)
    && !isMechanicalItem(entry)
    && entry.uuid !== blueprintDocument.uuid
    && (allowMagicalBase || !entry.isMagical)
    && (!allowedTypes.size || allowedTypes.has(entry.type))
    && !isExcluded(entry, rule.excludeRefs)
    && !isFamilyExcluded(entry, rule.excludeFamilies)
    && !isPoolExcluded(entry, rule)
    && subtypeMatch(entry, rule)
  );

  return shuffle(candidates);
}

async function createPassThroughRecipePreview(pick, catalog, configuration, sourceDocument) {
  const result = await materializeRecipe({ sourceDocument });
  if (!result.ok) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationFailed", { item: pick.entry.name }));
  }
  const documentData = result.documentData;
  const rarity = normalizeRarity(result.display?.rarity ?? foundry.utils.getProperty(documentData, "system.rarity") ?? pick.entry.rarity);
  const currentPrice = {
    value: Math.max(0, Number(foundry.utils.getProperty(documentData, "system.price.value") ?? pick.entry.priceValue ?? 0)),
    denomination: foundry.utils.getProperty(documentData, "system.price.denomination") ?? pick.entry.priceDenomination ?? "gp"
  };
  const price = priceInCopper(currentPrice) > PRICE_IN_COPPER.gp
    ? { ...currentPrice, origin: "official" }
    : { ...fallbackPrice(configuration, rarity), origin: "materializationRecipe" };
  foundry.utils.setProperty(documentData, "system.price", { value: price.value, denomination: price.denomination });
  return {
    key: `${canonicalKey(pick.entry)}|recipe-pass-through`,
    name: documentData.name ?? pick.entry.name,
    img: documentData.img ?? pick.entry.img,
    type: documentData.type ?? pick.entry.type,
    subtype: foundry.utils.getProperty(documentData, "system.type.value") ?? pick.entry.subtype,
    rarity,
    quantity: Math.max(1, Number(pick.units ?? 1)),
    packLabel: pick.entry.packLabel,
    sourceUuid: pick.entry.uuid,
    generatorSourceUuid: "",
    blueprintSourceUuid: "",
    materializedBaseUuid: "",
    materialization: result.metadata ?? {},
    price,
    documentData,
    generationKind: "copy",
    documentNature: "sellable",
    materializerKind: "",
    enhancement: 0,
    ruleIds: [pick.rule.id]
  };
}

async function createBlueprintPreview(pick, catalog, configuration, targetEntries, blueprintDocument, level, fallbackTargetEntries = []) {
  const recipe = materializationRecipe(blueprintDocument);
  if (recipe?.mode === "pass-through") {
    return createPassThroughRecipePreview(pick, catalog, configuration, blueprintDocument);
  }
  const candidates = blueprintCandidateEntries(blueprintDocument, targetEntries, pick.rule);
  let materialized = null;
  let baseEntry = null;
  for (const candidate of candidates) {
    try {
      const baseDocument = await loadItemDocument(candidate);
      const nativeCompatible = canMaterializeOnto(blueprintDocument, baseDocument);
      const recipeCompatible = hasMaterializationRecipe(blueprintDocument)
        && recipeTargetCompatibility(blueprintDocument, baseDocument, blueprintDocument) !== false;
      if (!nativeCompatible && !recipeCompatible) continue;
      const attempt = await materializeNativeBlueprint({
        blueprintDocument,
        baseDocument,
        partyLevel: level,
        allowedRarities: raritiesForLevel(configuration, level),
        maxBonus: maxEnhancementForLevel(configuration, level)
      });
      if (!attempt.ok) continue;
      materialized = attempt;
      baseEntry = candidate;
      break;
    } catch (error) {
      console.warn(`${MODULE_ID} | Blueprint base rejected`, blueprintDocument.name, candidate.name, error);
    }
  }

  // Some official recipe families are valid merchandise for a vendor even
  // when that vendor's visible mundane catalog does not include their physical
  // target (for example a rare cursed armor in Magic Assortment). Native
  // materialization still gets the first attempt. Only a known recipe may use
  // the broader source snapshot as a fallback target catalog.
  if ((!materialized || !baseEntry) && hasMaterializationRecipe(blueprintDocument)) {
    const primaryKeys = new Set(candidates.map(canonicalKey));
    const recipeCandidates = shuffle((fallbackTargetEntries ?? []).filter(entry =>
      !primaryKeys.has(canonicalKey(entry))
      && !isMaterializerItem(entry)
      && !isMechanicalItem(entry)
      && !entry.isMagical
    ));
    for (const candidate of recipeCandidates) {
      try {
        const baseDocument = await loadItemDocument(candidate);
        if (recipeTargetCompatibility(blueprintDocument, baseDocument, blueprintDocument) === false) continue;
        const attempt = await materializeRecipe({
          sourceDocument: blueprintDocument,
          baseDocument,
          partyLevel: level,
          allowedRarities: raritiesForLevel(configuration, level),
          maxBonus: maxEnhancementForLevel(configuration, level)
        });
        if (!attempt.ok) continue;
        materialized = attempt;
        baseEntry = candidate;
        break;
      } catch (error) {
        console.warn(`${MODULE_ID} | Recipe fallback base rejected`, blueprintDocument.name, candidate.name, error);
      }
    }
  }

  if (!materialized || !baseEntry) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.BlueprintNoEligibleResult", { item: pick.entry.name }));
  }

  const documentData = materialized.documentData;
  const display = materialized.display ?? {};
  const rarity = normalizeRarity(display.rarity ?? foundry.utils.getProperty(documentData, "system.rarity") ?? pick.entry.rarity);
  if (!finalMaterializedAvailabilityAccepted(pick, rarity)) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationAccessRejected", { item: display.name ?? documentData.name }));
  }
  // A blueprint result is a new magic Item. Never let the mundane target's
  // copper/silver price survive as the final price of a Rare/Very Rare result.
  // The active Supplier Level, Quality & Price profile is authoritative.
  const priceMetadata = {
    ...(materialized.metadata ?? {}),
    recipeId: materialized.metadata?.recipeId ?? recipe?.id ?? ""
  };
  const price = finalizeMaterializedPrice(documentData, rarity, configuration, baseEntry, catalog, priceMetadata);
  const selectionKey = normalizeText(JSON.stringify(materialized.metadata ?? {}));
  return {
    key: `${canonicalKey(pick.entry)}|base:${canonicalKey(baseEntry)}|selection:${selectionKey}`,
    name: display.name ?? documentData.name,
    img: display.img ?? documentData.img ?? pick.entry.img,
    type: display.type ?? documentData.type,
    subtype: display.subtype ?? foundry.utils.getProperty(documentData, "system.type.value") ?? baseEntry.subtype,
    rarity,
    quantity: Math.max(1, Number(pick.units ?? 1)),
    packLabel: pick.entry.packLabel,
    sourceUuid: pick.entry.uuid,
    generatorSourceUuid: "",
    blueprintSourceUuid: pick.entry.uuid,
    materializedBaseUuid: baseEntry.uuid,
    materialization: materialized.metadata ?? {},
    price,
    documentData,
    generationKind: "materializedBlueprint",
    documentNature: "materializer",
    materializerKind: "blueprint",
    enhancement: Number(materialized.display?.magicalBonus ?? 0),
    ruleIds: [pick.rule.id]
  };
}

function variantCandidates(entry, configuration, level) {
  const rarities = new Set(raritiesForLevel(configuration, level).map(normalizeRarity));
  const maximum = maxEnhancementForLevel(configuration, level);
  return (entry.sourceVariants ?? []).filter(variant =>
    variant.variantConcrete === true
    && Number(variant.enhancement ?? 0) > 0
    && Number(variant.enhancement ?? 0) <= maximum
    && (!rarities.size || rarities.has(normalizeRarity(variant.rarity)))
  );
}

function variantTargetBonus(pick, configuration, level) {
  const rule = pick.rule ?? {};
  if (rule.qualityMode === "fixed") return clampInteger(rule.fixedBonus, 1, 3);
  if (rule.qualityMode === "party") return weightedBonus(configuration, level, { positiveOnly: true });
  if (Number(pick.enhancement ?? 0) > 0) return clampInteger(pick.enhancement, 1, 3);
  return weightedBonus(configuration, level, { positiveOnly: true }) || Math.max(1, maxEnhancementForLevel(configuration, level));
}

function chooseVariantCandidate(pick, candidates, configuration, level) {
  if (!candidates.length) return null;
  const target = variantTargetBonus(pick, configuration, level);
  if (target > 0) {
    const exact = candidates.filter(candidate => Number(candidate.enhancement) === target);
    if (exact.length) return exact[Math.floor(Math.random() * exact.length)];
    const lower = candidates
      .filter(candidate => Number(candidate.enhancement) <= target)
      .sort((a, b) => Number(b.enhancement) - Number(a.enhancement));
    if (lower.length) return lower[0];
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function variantRecipeSource(entry) {
  return (entry.sourceVariants ?? []).find(variant => variant.variantPlaceholder === true || variant.recipeSupported === true)
    ?? (entry.materializerSourceUuid ? { uuid: entry.materializerSourceUuid, packLabel: entry.packLabel } : null);
}

async function createRecipeVariantPreview(pick, configuration, level, sourceEntry) {
  if (!sourceEntry?.uuid) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationFailed", { item: pick.entry.name }));
  }
  const sourceDocument = await loadItemDocument(sourceEntry);
  const bonus = variantTargetBonus(pick, configuration, level);
  const result = await materializeRecipe({
    sourceDocument,
    requestedBonus: bonus,
    partyLevel: level,
    maxBonus: maxEnhancementForLevel(configuration, level)
  });
  if (!result.ok) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationFailed", { item: pick.entry.name }));
  }
  const documentData = result.documentData;
  const rarity = normalizeRarity(result.display?.rarity ?? foundry.utils.getProperty(documentData, "system.rarity"));
  const price = fallbackPrice(configuration, rarity);
  foundry.utils.setProperty(documentData, "system.price", { value: price.value, denomination: price.denomination });
  const metadata = result.metadata ?? {};
  return {
    key: `${canonicalKey(pick.entry)}|recipe:${metadata.recipeId ?? pick.entry.variantFamily}|bonus:${bonus}`,
    name: result.display?.name ?? documentData.name,
    img: result.display?.img ?? documentData.img ?? pick.entry.img,
    type: result.display?.type ?? documentData.type ?? pick.entry.type,
    subtype: result.display?.subtype ?? foundry.utils.getProperty(documentData, "system.type.value") ?? pick.entry.subtype,
    rarity,
    quantity: Math.max(1, Number(pick.units ?? 1)),
    packLabel: sourceEntry.packLabel ?? pick.entry.packLabel,
    sourceUuid: sourceEntry.uuid,
    generatorSourceUuid: "",
    blueprintSourceUuid: sourceEntry.uuid,
    materializedBaseUuid: "",
    materialization: metadata,
    price: { ...price, origin: "materializationRecipe" },
    documentData,
    generationKind: "materializedVariant",
    documentNature: "materializer",
    materializerKind: "variant",
    enhancement: Number(metadata.bonus ?? bonus),
    ruleIds: [pick.rule.id]
  };
}

async function createVariantPreview(pick, catalog, configuration, level) {
  const candidates = variantCandidates(pick.entry, configuration, level);
  const selected = chooseVariantCandidate(pick, candidates, configuration, level);
  if (!selected) return createRecipeVariantPreview(pick, configuration, level, variantRecipeSource(pick.entry));

  const document = await loadItemDocument(selected);
  const rawData = document.toObject();
  const issues = hasMaterializationRecipe(document) ? recipeOutputIssues(document, rawData) : [];
  if (issues.length) return createRecipeVariantPreview(pick, configuration, level, selected);

  const documentData = rawData;
  delete documentData._id;
  const canonical = canonicalizeItemName(documentData.name, { fallbackName: selected.name ?? pick.entry.name });
  if (!canonical.ok) {
    throw new Error(`Variant produced an invalid name (${canonical.reason}).`);
  }
  documentData.name = canonical.name;
  const rarity = normalizeRarity(foundry.utils.getProperty(documentData, "system.rarity") ?? selected.rarity);
  const price = Number(foundry.utils.getProperty(documentData, "system.price.value") ?? selected.priceValue ?? 0) > 0
    ? {
      value: Number(foundry.utils.getProperty(documentData, "system.price.value") ?? selected.priceValue),
      denomination: foundry.utils.getProperty(documentData, "system.price.denomination") ?? selected.priceDenomination ?? "gp",
      origin: "officialVariant"
    }
    : fallbackPrice(configuration, rarity);
  const metadata = {
    kind: "variant",
    family: pick.entry.variantFamily,
    familySourceUuid: pick.entry.materializerSourceUuid ?? "",
    variantUuid: selected.uuid,
    bonus: Number(selected.enhancement ?? 0),
    strategy: "concrete-variant"
  };
  foundry.utils.setProperty(documentData, "flags.hammer-materialization-core", {
    materialized: true,
    ...metadata
  });

  return {
    key: `${canonicalKey(pick.entry)}|variant:${selected.uuid}`,
    name: canonical.name,
    img: documentData.img ?? selected.img ?? pick.entry.img,
    type: documentData.type ?? selected.type ?? pick.entry.type,
    subtype: foundry.utils.getProperty(documentData, "system.type.value") ?? selected.subtype ?? pick.entry.subtype,
    rarity,
    quantity: Math.max(1, Number(pick.units ?? 1)),
    packLabel: selected.packLabel ?? pick.entry.packLabel,
    sourceUuid: selected.uuid,
    generatorSourceUuid: "",
    blueprintSourceUuid: "",
    materializedBaseUuid: "",
    materialization: metadata,
    price,
    documentData,
    generationKind: "materializedVariant",
    documentNature: "materializer",
    materializerKind: "variant",
    enhancement: Number(selected.enhancement ?? 0),
    ruleIds: [pick.rule.id]
  };
}

async function createAmmunitionRecipePreview(pick, catalog, configuration, level) {
  const baseDocument = await loadItemDocument(pick.entry);
  const bonus = Math.max(1, Math.min(3, Number(pick.enhancement ?? 0) || weightedBonus(configuration, level, { positiveOnly: true })));
  const result = await materializeRecipe({
    recipeId: "enchanted-ammunition",
    sourceDocument: baseDocument,
    baseDocument,
    requestedBonus: bonus,
    maxBonus: maxEnhancementForLevel(configuration, level),
    qualityPriceAdditions: configuration.qualityPriceAdditions ?? {}
  });
  if (!result.ok) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationFailed", { item: pick.entry.name }));
  }
  const documentData = result.documentData;
  const rarity = normalizeRarity(result.display?.rarity ?? foundry.utils.getProperty(documentData, "system.rarity"));
  const price = {
    value: Math.max(1, Number(foundry.utils.getProperty(documentData, "system.price.value") ?? 1)),
    denomination: foundry.utils.getProperty(documentData, "system.price.denomination") ?? "gp",
    origin: "materializationRecipe"
  };
  const metadata = result.metadata ?? {};
  return {
    key: `${canonicalKey(pick.entry)}|recipe:enchanted-ammunition|bonus:${bonus}`,
    name: result.display?.name ?? documentData.name,
    img: result.display?.img ?? documentData.img ?? pick.entry.img,
    type: result.display?.type ?? documentData.type,
    subtype: result.display?.subtype ?? foundry.utils.getProperty(documentData, "system.type.value") ?? "ammo",
    rarity,
    quantity: Math.max(1, Number(pick.units ?? 1)),
    packLabel: pick.entry.packLabel,
    sourceUuid: pick.entry.uuid,
    generatorSourceUuid: "",
    blueprintSourceUuid: "",
    materializedBaseUuid: pick.entry.uuid,
    materialization: metadata,
    price,
    documentData,
    generationKind: "materializedGenerator",
    documentNature: "materializer",
    materializerKind: "generator",
    enhancement: bonus,
    ruleIds: [pick.rule.id]
  };
}

async function buildPreviewLine(pick, catalog, configuration, { profileEntries = [], materializationTargets = profileEntries, level = 1 } = {}) {
  if (pick.rule?.materializationRecipe === "enchanted-ammunition") {
    return createAmmunitionRecipePreview(pick, catalog, configuration, level);
  }
  if (isVariantFamilyItem(pick.entry)) {
    return createVariantPreview(pick, catalog, configuration, level);
  }
  if (isGeneratorItem(pick.entry)) {
    return createGeneratorPreview(pick, catalog, configuration, materializationTargets, level);
  }
  if (pick.rule.category === "spellScroll") {
    const scroll = await createSpellScrollPreview(pick.entry, configuration);
    return {
      key: `scroll:${canonicalKey(pick.entry)}`,
      name: scroll.data.name,
      img: scroll.data.img || pick.entry.img,
      type: scroll.data.type || "consumable",
      subtype: foundry.utils.getProperty(scroll.data, "system.type.value") ?? "scroll",
      rarity: scroll.rarity,
      quantity: Math.max(1, Number(pick.units ?? 1)),
      packLabel: pick.entry.packLabel,
      sourceUuid: pick.entry.uuid,
      price: scroll.price,
      documentData: scroll.data,
      generationKind: "spellScroll",
      documentNature: "sellable",
      materializerKind: "",
      enhancement: 0,
      spellLevel: scroll.spellLevel,
      ruleIds: [pick.rule.id]
    };
  }

  const selectedSource = isBlueprintItem(pick.entry) && pick.entry.materializerSourceUuid
    ? { ...pick.entry, uuid: pick.entry.materializerSourceUuid }
    : pick.entry;
  const document = await loadItemDocument(selectedSource);
  const actualNature = classifyDocumentNature(document, {
    mechanical: isMechanicalItem(pick.entry),
    generator: null
  });
  if (actualNature.nature === "mechanical") {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MechanicalDocumentSelected", { item: pick.entry.name }));
  }
  if (actualNature.materializerKind === "blueprint" || isBlueprintItem(pick.entry)) {
    // Profile System v2 must never escape the Base Item Groups that the GM can
    // see in the rule. Legacy materialization historically allowed a broader
    // profile-wide fallback, but keeping that behavior here would reintroduce
    // hidden preset power through the back door.
    const fallbackTargets = pick.ruleType === "materializedV2" ? materializationTargets : profileEntries;
    return createBlueprintPreview(pick, catalog, configuration, materializationTargets, document, level, fallbackTargets);
  }

  const basePrice = resolvePrice(pick.entry, catalog, configuration);
  let documentData = document.toObject();
  let display = { name: documentData.name, img: documentData.img, type: documentData.type, subtype: foundry.utils.getProperty(documentData, "system.type.value") };
  let price = basePrice;
  let rarity = normalizeRarity(foundry.utils.getProperty(document, "system.rarity") ?? pick.entry.rarity);
  let materialization = {};
  if (pick.enhancement > 0 && !pick.entry.isMagical) {
    const enhanced = await applySyntheticEnhancement(document, pick.enhancement, configuration);
    if (!enhanced?.ok) {
      throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationFailed", { item: pick.entry.name }));
    }
    documentData = enhanced.documentData;
    display = enhanced.display ?? display;
    materialization = enhanced.metadata ?? {};
    rarity = ENCHANTMENT_RARITY[pick.enhancement] ?? rarity;
    price = {
      value: Math.max(1, Number(foundry.utils.getProperty(documentData, "system.price.value") ?? 1)),
      denomination: foundry.utils.getProperty(documentData, "system.price.denomination") ?? "gp",
      origin: "generatedQuality"
    };
  }

  return {
    key: `${canonicalKey(pick.entry)}|bonus:${pick.enhancement || 0}`,
    name: display.name ?? documentData.name,
    img: display.img ?? documentData.img,
    type: display.type ?? documentData.type,
    subtype: display.subtype ?? foundry.utils.getProperty(documentData, "system.type.value") ?? pick.entry.subtype,
    rarity,
    quantity: Math.max(1, Number(pick.units ?? 1)),
    packLabel: pick.entry.packLabel,
    sourceUuid: pick.entry.uuid,
    materialization,
    price,
    documentData,
    generationKind: pick.enhancement > 0 && !pick.entry.isMagical ? "enhanced" : "copy",
    documentNature: pick.enhancement > 0 && !pick.entry.isMagical ? "materializer" : "sellable",
    materializerKind: pick.enhancement > 0 && !pick.entry.isMagical ? "enhancement" : "",
    enhancement: pick.enhancement || 0,
    ruleIds: [pick.rule.id]
  };
}

function fallbackIntent(entry, rule) {
  const armor = ["lightArmor", "mediumArmor", "heavyArmor", "shield"].includes(entry?.primarySubtypeKey)
    || rule?.reservationGroup === "armor";
  if (armor) return isMaterializerItem(entry) ? "materialized-armor" : entry?.isMagical ? "named-armor" : "enhanced-armor";
  if (isAmmunitionEntry(entry)) return "ammunition";
  if (entry?.type === "weapon") return isMaterializerItem(entry) ? "materialized-weapon" : entry?.isMagical ? "named-weapon" : "enhanced-weapon";
  return isMaterializerItem(entry) ? "materializer" : String(entry?.type ?? "other");
}

async function buildPreviewLineWithFallback(pick, catalog, configuration, profileEntries, materializationTargets, level, warnings, diagnostics = null) {
  try {
    const line = await buildPreviewLine(pick, catalog, configuration, { profileEntries, materializationTargets, level });
    finalizeGlobalRecipePrice(line, pick, catalog, configuration);
    line.ruleName = pick.rule?.name ?? "";
    line.ruleType = pick.ruleType ?? "";
    return line;
  } catch (originalError) {
    // Any failed slot may be replaced by another eligible result from the same
    // rule. This covers both native materializers and ordinary base Items whose
    // synthetic +1/+2/+3 conversion failed strict validation.
    const exactFallbackPool = Array.isArray(pick.fallbackEntries) ? pick.fallbackEntries : null;
    const inspection = exactFallbackPool
      ? { entries: exactFallbackPool }
      : inspectRulePool({ rule: pick.rule, catalog, profileEntries, configuration, profile: pick.profile ?? null, level });
    const intent = fallbackIntent(pick.entry, pick.rule);
    const alternatives = shuffle((inspection.entries ?? []).filter(entry =>
      canonicalKey(entry) !== canonicalKey(pick.entry)
      // v2 fallback pools already represent the exact visible Item Group(s).
      // Legacy rules still need the historical intent guard.
      && (exactFallbackPool || fallbackIntent(entry, pick.rule) === intent)
    ));
    for (const alternative of alternatives) {
      try {
        const replacementPick = { ...pick, entry: alternative };
        const replacement = await buildPreviewLine(replacementPick, catalog, configuration, { profileEntries, materializationTargets, level });
        finalizeGlobalRecipePrice(replacement, replacementPick, catalog, configuration);
        replacement.ruleName = pick.rule?.name ?? "";
        replacement.ruleType = pick.ruleType ?? "";
        warnings.push(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializerRerolled", {
          item: pick.entry.name,
          replacement: replacement.name
        }));
        diagnostics?.rerolls?.push({
          failed: pick.entry.name,
          replacement: replacement.name,
          rule: pick.rule?.name ?? "",
          reason: originalError.message
        });
        return replacement;
      } catch (_error) { /* Try another eligible result from the same rule. */ }
    }
    throw originalError;
  }
}

function v2RuleCategoryForEntry(entry) {
  if (entry?.type === "spell") return "spellScroll";
  return ["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(entry?.type) ? entry.type : "exact";
}

function v2Access(profile) {
  return Math.max(1, Math.min(4, Number(profileAccessLevel(profile) ?? 2)));
}

function v2NormalizeFirearmEntries(entries, profile) {
  const sellable = entries.filter(entry => !isNaturalSupplierEntry(entry));
  if (profile?.normalizeFirearms !== true) return sellable;
  // Normalization is a candidate-pool operation only. The source documents are
  // never rewritten. Firearm originals leave the ordinary pool; an explicit
  // firearm-focused Item Group is later resolved to a de-duplicated medieval
  // replacement family by v2NormalizedGroupAliases().
  return sellable.filter(entry => !isFirearmRelated(entry));
}

function v2GroupEntries(group, entries) {
  const selected = entries.filter(entry => itemGroupMatchesEntry(group, entry));
  const byKey = new Map();
  for (const entry of selected) if (!byKey.has(canonicalKey(entry))) byKey.set(canonicalKey(entry), entry);
  return [...byKey.values()];
}

function v2IsCrossbowReplacement(entry) {
  if (entry?.type !== "weapon" || isFirearmRelated(entry) || entry?.isMagical) return false;
  const identity = normalizeText(`${entry?.identifier ?? ""} ${entry?.name ?? ""} ${entry?.baseItem ?? ""}`);
  return identity.includes("crossbow");
}

function v2IsMedievalAmmunitionReplacement(entry) {
  if (!isAmmunitionEntry(entry) || isFirearmRelated(entry) || entry?.isMagical) return false;
  const identity = normalizeText(`${entry?.identifier ?? ""} ${entry?.name ?? ""} ${entry?.baseItem ?? ""}`);
  return ["arrow", "bolt", "needle"].some(term => identity.includes(term));
}

function v2NormalizedGroupAliases(group, rawEntries, normalizedEntries, profile) {
  if (profile?.normalizeFirearms !== true) return [];
  const matchedFirearms = rawEntries.filter(entry => isFirearmRelated(entry) && itemGroupMatchesEntry(group, entry));
  if (!matchedFirearms.length) return [];

  const wantsWeapons = matchedFirearms.some(isFirearmEntry);
  const wantsAmmunition = matchedFirearms.some(isFirearmAmmunition);
  const wantsSupplies = matchedFirearms.some(isFirearmSupply);
  const aliases = normalizedEntries.filter(entry =>
    (wantsWeapons && v2IsCrossbowReplacement(entry))
    || ((wantsAmmunition || wantsSupplies) && v2IsMedievalAmmunitionReplacement(entry))
  );
  const byKey = new Map();
  for (const entry of aliases) if (!byKey.has(canonicalKey(entry))) byKey.set(canonicalKey(entry), entry);
  return [...byKey.values()];
}

function v2RuleAllowsEntry(entry, group, stockRule, configuration, profile, level, { skipGroupMatch = false } = {}) {
  if (!skipGroupMatch && !itemGroupMatchesEntry(group, entry)) return false;
  if (profile?.allowCursedItems !== true && entry?.isCursed === true) return false;
  if (!vendorAccessAllowsEntry(entry, profile, stockRule)) return false;
  const virtualRule = {
    category: v2RuleCategoryForEntry(entry),
    magicalState: group.magicalState ?? "any",
    qualityMode: "source",
    requireMagicalResult: stockRule?.requireMagicalResult === true,
    spellLevelMode: "level",
    spellLevels: [],
    subtypes: group.subtypes ?? []
  };
  const applyProgression = stockRule?.respectLevelRange !== false;
  return magicMatch(entry, virtualRule, configuration, level, { applyProgression })
    && rarityMatch(entry, virtualRule, configuration, level, { applyProgression })
    && spellLevelMatch(entry, virtualRule, configuration, level, { applyProgression });
}

function v2CombinedPool({ rule, groupsById, profileEntries, rawProfileEntries = profileEntries, configuration, profile, level, ids = null }) {
  const groupIds = ids ?? rule.groupIds ?? [];
  const byKey = new Map();
  const addWeighted = (entry, group) => {
    const key = canonicalKey(entry);
    const weight = Math.max(0.01, Number(group?.selectionWeight ?? 1));
    const current = byKey.get(key);
    if (!current) byKey.set(key, { ...entry, supplierSelectionWeight: weight });
    else if (weight > Number(current.supplierSelectionWeight ?? 1)) current.supplierSelectionWeight = weight;
  };
  for (const groupId of groupIds) {
    const group = groupsById.get(groupId);
    if (!group?.enabled) continue;
    for (const entry of v2GroupEntries(group, profileEntries)) {
      if (!v2RuleAllowsEntry(entry, group, rule, configuration, profile, level)) continue;
      addWeighted(entry, group);
    }
    // When firearm normalization is enabled, a group that explicitly matched
    // firearm content is allowed to draw from one de-duplicated medieval
    // replacement family. This preserves Homebrew intent without creating one
    // crossbow lottery ticket per firearm document in the source pack.
    for (const entry of v2NormalizedGroupAliases(group, rawProfileEntries, profileEntries, profile)) {
      if (!v2RuleAllowsEntry(entry, group, rule, configuration, profile, level, { skipGroupMatch: true })) continue;
      addWeighted(entry, group);
    }
  }
  return [...byKey.values()];
}

function v2EntryMaterializationRecipeId(entry) {
  const direct = materializationRecipe(entry)?.id;
  if (direct) return direct;
  for (const variant of entry?.sourceVariants ?? []) {
    const recipeId = materializationRecipe(variant)?.id;
    if (recipeId) return recipeId;
  }
  return "";
}

function v2RecipeTemplatePool({ rule, groupsById, profileEntries, rawProfileEntries, configuration, profile, level }) {
  const requestedRecipeId = String(rule?.materializationRecipe ?? "").trim();
  let pool = [];
  if ((rule?.templateGroupIds ?? []).length) {
    pool = v2CombinedPool({
      rule, groupsById, profileEntries, rawProfileEntries, configuration, profile, level, ids: rule.templateGroupIds
    });
  } else if (requestedRecipeId && requestedRecipeId !== "enchanted-ammunition") {
    // Explicit recipe selection is a complete configuration on its own: when
    // no Template Group is attached, derive the matching materializer sources
    // from the profile catalog. This keeps the UI truthful without duplicating
    // Materialization Core recipe logic in Supplier.
    const virtualGroup = {
      enabled: true,
      selectionMode: "dynamic",
      sourceIds: [],
      itemTypes: [],
      subtypes: [],
      rarities: [],
      documentNatures: ["materializer"],
      magicalState: "any",
      search: "",
      identityTerms: [],
      selectedUuids: [],
      excludedUuids: [],
      crafting: { excludeKnowledge: true }
    };
    pool = profileEntries.filter(entry =>
      isMaterializerItem(entry)
      && isSupportedMaterializerEntry(entry)
      && v2RuleAllowsEntry(entry, virtualGroup, rule, configuration, profile, level)
    );
  }

  pool = pool.filter(entry => isMaterializerItem(entry) && isSupportedMaterializerEntry(entry));
  if (requestedRecipeId && requestedRecipeId !== "enchanted-ammunition") {
    pool = pool.filter(entry => v2EntryMaterializationRecipeId(entry) === requestedRecipeId);
  }
  const byKey = new Map();
  for (const entry of pool) if (!byKey.has(canonicalKey(entry))) byKey.set(canonicalKey(entry), entry);
  return [...byKey.values()];
}

function v2ChooseDistinct(pool, count, rule, level, profile, configuration) {
  const available = [...pool];
  const chosen = [];
  while (chosen.length < count && available.length) {
    const virtualRule = { maxPerFamily: 0 };
    const entry = weightedEntryChoice(available, virtualRule, level, profile, configuration) ?? randomChoice(available);
    if (!entry) break;
    chosen.push(entry);
    available.splice(available.indexOf(entry), 1);
  }
  return chosen;
}

function v2Count(rule, players, { variety = false, access = 2 } = {}) {
  let count = scaleCount(
    variety ? rule.varietyBase : rule.baseQuantity,
    variety ? rule.varietyScaling : rule.scaling,
    players
  );
  if (variety) count += Math.max(0, Number(access ?? 2) - 2);
  const minimum = Math.max(0, Number(rule.minimumPicks ?? 0));
  const maximum = Math.max(0, Number(rule.maximumPicks ?? 0));
  count = Math.max(count, minimum);
  if (maximum) count = Math.min(count, maximum);
  return Math.max(0, Math.floor(count));
}

function v2LegacyRule(stockRule, entry, group = null, overrides = {}) {
  return {
    id: stockRule.id,
    name: stockRule.name,
    enabled: stockRule.enabled !== false,
    category: overrides.category ?? v2RuleCategoryForEntry(entry),
    subtypes: group?.subtypes ?? [],
    magicalState: group?.magicalState ?? "any",
    qualityMode: overrides.qualityMode ?? "source",
    fixedBonus: overrides.fixedBonus ?? 1,
    allowDuplicates: false,
    poolExclusions: [],
    materializerExclusions: [],
    excludeFamilies: [],
    includeFamilies: [],
    chance: 100,
    minimumVendorAccess: Number(stockRule.minimumVendorAccess ?? 0),
    maximumVendorAccess: Number(stockRule.maximumVendorAccess ?? 0),
    maxPerFamily: 0,
    requireMagicalResult: stockRule.requireMagicalResult === true,
    materializationRecipe: stockRule.materializationRecipe ?? "",
    ...overrides
  };
}

function v2PushDirectPicks(target, entries, rule, groupsById, units, ruleType, overrides = {}, fallbackEntries = []) {
  let totalUnits = 0;
  for (const entry of entries) {
    const group = [...groupsById.values()].find(candidate => (rule.groupIds ?? []).includes(candidate.id) && itemGroupMatchesEntry(candidate, entry)) ?? null;
    const resolvedUnits = Math.max(1, Number(typeof units === "function" ? units(entry) : units) || 1);
    totalUnits += resolvedUnits;
    target.push({
      entry,
      enhancement: Number(overrides.enhancement ?? 0),
      units: resolvedUnits,
      rule: v2LegacyRule(rule, entry, group, overrides),
      ruleType,
      profile: overrides.profile,
      // v2 rules carry their exact visible candidate pool into fallback logic.
      // A failed document/materialization can therefore reroll only inside the
      // same Item Groups instead of escaping into a broad legacy category.
      fallbackEntries
    });
  }
  return totalUnits;
}

async function generateStockV2({ profile, level, players, logDiagnostics = true, configurationOverride = null }) {
  const worldConfiguration = configurationOverride ?? getConfiguration();
  const configuration = configurationForProfile(worldConfiguration, profile);
  const catalog = await buildCatalog({ configurationOverride: worldConfiguration });
  if (!catalog.entries.length) throw new Error(game.i18n.localize("DND5E_SUPPLIER.Errors.NoCatalog"));

  const rawProfileEntries = entriesForProfile(catalog, profile, worldConfiguration);
  let profileEntries = v2NormalizeFirearmEntries(rawProfileEntries, profile);
  if (!profileEntries.length) throw new Error(game.i18n.localize("DND5E_SUPPLIER.Errors.NoProfileCatalog"));

  const groupsById = new Map((profile.itemGroups ?? []).map(group => [group.id, group]));
  const picks = [];
  const warnings = [];
  const diagnostics = {
    profile: profile.name,
    profileSchemaVersion: profile.profileSchemaVersion,
    preset: profile.presetId ?? "",
    access: v2Access(profile),
    progression: profile.progressionProfileId ?? "world",
    partyLevel: level,
    partySize: players,
    rules: [],
    materializationFailures: [],
    rerolls: [],
    firearmNormalization: profile.normalizeFirearms === true
  };
  let catalogUnits = 0;
  let guaranteedUnits = 0;
  let randomUnits = 0;
  let specialUnits = 0;
  const access = v2Access(profile);

  for (const rule of profile.stockRules ?? []) {
    if (!rule?.enabled || !rulePassesChance(rule)) continue;
    if (Number(rule.minimumVendorAccess ?? 0) > access) continue;
    if (Number(rule.maximumVendorAccess ?? 0) > 0 && access > Number(rule.maximumVendorAccess)) continue;

    if (rule.mode === "guaranteed") {
      const pool = v2CombinedPool({ rule, groupsById, profileEntries, rawProfileEntries, configuration, profile, level });
      let selected = [];
      if (rule.coverage === "all") selected = pool;
      else selected = v2ChooseDistinct(pool, v2Count(rule, players, { access }), rule, level, profile, configuration);
      const units = rule.coverage === "all"
        ? Math.max(1, scaleCount(rule.baseQuantity, rule.scaling, players))
        : Math.max(1, Number(rule.unitsPerPick ?? 1));
      guaranteedUnits += v2PushDirectPicks(picks, selected, rule, groupsById, units, "guaranteedV2", { profile }, pool);
      diagnostics.rules.push({ id: rule.id, name: rule.name, type: "guaranteed", pool: pool.length, selected: selected.length, units });
      continue;
    }

    if (rule.mode === "random") {
      const pool = v2CombinedPool({ rule, groupsById, profileEntries, rawProfileEntries, configuration, profile, level });
      const variety = v2Count(rule, players, { variety: true, access });
      const selected = v2ChooseDistinct(pool, variety, rule, level, profile, configuration);
      const quantity = entry => {
        const [min, max] = quantityRangeForRarity(rule, entry.rarity, players, access);
        return randomBetween(min, max);
      };
      randomUnits += v2PushDirectPicks(picks, selected, rule, groupsById, quantity, "randomV2", { profile }, pool);
      diagnostics.rules.push({ id: rule.id, name: rule.name, type: "random", pool: pool.length, selected: selected.length, variety });
      continue;
    }

    if (rule.mode === "specialExisting") {
      const pool = v2CombinedPool({ rule, groupsById, profileEntries, rawProfileEntries, configuration, profile, level })
        .filter(entry => entry.documentNature !== "materializer" && !isMechanicalItem(entry));
      const count = v2Count(rule, players, { access });
      const selected = v2ChooseDistinct(pool, count, rule, level, profile, configuration);
      specialUnits += v2PushDirectPicks(picks, selected, rule, groupsById, 1, "specialExistingV2", { profile }, pool);
      diagnostics.rules.push({ id: rule.id, name: rule.name, type: "specialExisting", pool: pool.length, selected: selected.length });
      continue;
    }

    if (rule.mode === "materialized") {
      const count = v2Count(rule, players, { access });
      if (!count) continue;
      const basePool = v2CombinedPool({ rule, groupsById, profileEntries, rawProfileEntries, configuration, profile, level, ids: rule.baseGroupIds ?? [] })
        .filter(entry => !isMaterializerItem(entry) && !isMechanicalItem(entry));
      const templatePool = v2RecipeTemplatePool({
        rule, groupsById, profileEntries, rawProfileEntries, configuration, profile, level
      });

      if (rule.materializationRecipe === "enchanted-ammunition") {
        const ammoPool = basePool.filter(entry => isAmmunitionEntry(entry) && !isFirearmRelated(entry));
        const selected = v2ChooseDistinct(ammoPool, count, rule, level, profile, configuration);
        for (const entry of selected) {
          picks.push({ entry, enhancement: weightedBonus(configuration, level, { positiveOnly: true }), units: 1, rule: v2LegacyRule(rule, entry, null, { category: "consumable", materializationRecipe: "enchanted-ammunition", requireMagicalResult: true }), ruleType: "materializedV2", profile, fallbackEntries: ammoPool });
        }
        specialUnits += selected.length;
        diagnostics.rules.push({ id: rule.id, name: rule.name, type: "materialized", recipe: "enchanted-ammunition", pool: ammoPool.length, selected: selected.length });
        continue;
      }

      if (templatePool.length) {
        const selectedTemplates = v2ChooseDistinct(templatePool, count, rule, level, profile, configuration);
        for (const entry of selectedTemplates) {
          const group = [...groupsById.values()].find(candidate => (rule.templateGroupIds ?? []).includes(candidate.id) && itemGroupMatchesEntry(candidate, entry)) ?? null;
          picks.push({ entry, enhancement: 0, units: 1, rule: v2LegacyRule(rule, entry, group, { requireMagicalResult: true }), ruleType: "materializedV2", profile, fallbackEntries: templatePool });
        }
        specialUnits += selectedTemplates.length;
        diagnostics.rules.push({ id: rule.id, name: rule.name, type: "materialized", templatePool: templatePool.length, basePool: basePool.length, selected: selectedTemplates.length });
        continue;
      }

      if (String(rule.materializationRecipe ?? "").trim()) {
        const message = `No eligible Materialization Core template was found for recipe '${rule.materializationRecipe}'.`;
        warnings.push(message);
        diagnostics.rules.push({
          id: rule.id,
          name: rule.name,
          type: "materialized",
          recipe: rule.materializationRecipe,
          basePool: basePool.length,
          templatePool: 0,
          selected: 0,
          status: "noEligibleRecipeTemplate"
        });
        continue;
      }

      // With Automatic recipe selection and no explicit template group, a
      // materialized rule may be driven entirely by mundane bases. Existing
      // Level / Quality bands then produce safe +1/+2/+3 outputs.
      const selectedBases = v2ChooseDistinct(basePool, count, rule, level, profile, configuration);
      const virtual = { ...rule, qualityMode: "party", enchantedMinimumMode: "none", enchantedMinimum: 0 };
      const qualityEntries = applyQuality(virtual, selectedBases, configuration, level, players, warnings);
      for (const quality of qualityEntries) {
        picks.push({ ...quality, units: 1, rule: v2LegacyRule(rule, quality.entry, null, { qualityMode: "party", requireMagicalResult: true }), ruleType: "materializedV2", profile, fallbackEntries: basePool });
      }
      specialUnits += qualityEntries.length;
      diagnostics.rules.push({ id: rule.id, name: rule.name, type: "materialized", basePool: basePool.length, selected: qualityEntries.length });
    }
  }

  if (profile.scrollStock?.enabled === true) {
    const scrollRule = {
      id: `scroll-stock-${profile.id}`,
      name: "Scroll Stock",
      category: "spellScroll",
      subtypes: [],
      magicalState: "any",
      qualityMode: "source",
      spellLevelMode: "level",
      spellLevels: [],
      allowDuplicates: false,
      poolExclusions: [],
      materializerExclusions: [],
      excludeFamilies: [],
      includeFamilies: [],
      chance: 100,
      minimumVendorAccess: 0,
      maximumVendorAccess: 0
    };
    // Scroll configuration stays deliberately small: the profile only enables
    // Scroll Stock and determines how many slots it requests. The existing
    // progression pipeline remains the sole authority for spell level, rarity,
    // quality, and price.
    const inspection = inspectRulePool({ rule: scrollRule, catalog, profileEntries, configuration, profile, level });
    const count = scaleCount(profile.scrollStock.baseQuantity, profile.scrollStock.scaling, players);
    const selected = v2ChooseDistinct(inspection.entries ?? [], count, { weight: 1 }, level, profile, configuration);
    for (const entry of selected) {
      picks.push({
        entry, enhancement: 0, units: 1, rule: scrollRule, ruleType: "scrollV2", profile,
        fallbackEntries: inspection.entries ?? []
      });
    }
    specialUnits += selected.length;
    diagnostics.rules.push({ id: scrollRule.id, name: scrollRule.name, type: "scroll", pool: inspection.count, selected: selected.length });
  }

  const materializationTargets = profileEntries.filter(entry => !isMaterializerItem(entry) && !isMechanicalItem(entry));
  const lines = [];
  for (const pick of picks) {
    try {
      const stockRule = pick.ruleType === "materializedV2"
        ? (profile.stockRules ?? []).find(rule => rule.id === pick.rule.id)
        : null;
      // v2 materialization is intentionally strict: Base Item Groups are the
      // complete visible target universe. An empty/mismatching Base Group does
      // not silently widen into the whole profile. Self-contained variant
      // materializers can still succeed without a target because they do not
      // consume this pool.
      const targets = stockRule?.baseGroupIds?.length
        ? v2CombinedPool({ rule: stockRule, groupsById, profileEntries, rawProfileEntries, configuration, profile, level, ids: stockRule.baseGroupIds })
        : pick.ruleType === "materializedV2" ? [] : materializationTargets;
      lines.push(await buildPreviewLineWithFallback(pick, catalog, configuration, profileEntries, targets, level, warnings, diagnostics));
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to prepare ${pick.entry?.name}`, error);
      diagnostics.materializationFailures.push({ item: pick.entry?.name ?? "", rule: pick.rule?.name ?? "", error: error.message });
      warnings.push(error.message);
    }
  }

  const stacked = new Map();
  for (const line of lines) {
    const current = stacked.get(line.key);
    if (current) {
      current.quantity += Number(line.quantity ?? 1);
      current.ruleIds = [...new Set([...current.ruleIds, ...line.ruleIds])];
    } else stacked.set(line.key, line);
  }
  const preview = [...stacked.values()].sort((a, b) => a.name.localeCompare(b.name));
  const generatedUnits = preview.reduce((sum, line) => sum + Math.max(1, Number(line.quantity ?? 1)), 0);
  diagnostics.actualGeneratedUnits = generatedUnits;
  diagnostics.byRarity = preview.reduce((counts, line) => {
    const key = normalizeRarity(line.rarity);
    counts[key] = Number(counts[key] ?? 0) + Math.max(1, Number(line.quantity ?? 1));
    return counts;
  }, {});
  diagnostics.byItem = preview.reduce((counts, line) => {
    counts[line.name] = Number(counts[line.name] ?? 0) + Math.max(1, Number(line.quantity ?? 1));
    return counts;
  }, {});
  if (logDiagnostics) {
    console.groupCollapsed?.(`${MODULE_ID} | Supplier v2 diagnostics — ${profile.name} (L${level}, ${players} players)`);
    console.table?.(diagnostics.byRarity);
    console.debug?.(diagnostics);
    console.groupEnd?.();
  }
  return {
    preview,
    warnings,
    target: randomUnits,
    randomTarget: randomUnits,
    catalogUnits,
    guaranteedUnits,
    randomUnits,
    specialUnits,
    generatedUnits,
    plannedUnits: generatedUnits,
    diagnostics
  };
}

export async function generateStock({ profile, level, players, logDiagnostics = true, configurationOverride = null }) {
  if (Number(profile?.profileSchemaVersion ?? 0) !== SUPPLIER_PROFILE_SCHEMA_VERSION) {
    throw new Error(game.i18n.localize("DND5E_SUPPLIER.Errors.LegacyProfileUnsupported"));
  }
  return generateStockV2({ profile, level, players, logDiagnostics, configurationOverride });
}

export async function auditSupplierStock({ profile, level = 1, players = 4, runs = 25 } = {}) {
  if (!profile) throw new Error("A Supplier profile is required for audit.");
  const iterations = Math.min(250, Math.max(1, Math.floor(Number(runs ?? 25))));
  const summary = {
    profileId: profile.id,
    profileName: profile.name,
    partyLevel: Math.min(20, Math.max(1, Number(level ?? 1))),
    partySize: Math.max(1, Number(players ?? 4)),
    runs: iterations,
    plannedUnits: 0,
    generatedUnits: 0,
    randomTarget: 0,
    randomUnits: 0,
    materializationFailures: 0,
    rerolls: 0,
    byRarity: {},
    byGenerationKind: {},
    byRule: {},
    byItem: {},
    materializers: {}
  };
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = await generateStock({
      profile,
      level: summary.partyLevel,
      players: summary.partySize,
      logDiagnostics: false
    });
    summary.plannedUnits += Number(result.plannedUnits ?? 0);
    summary.generatedUnits += Number(result.generatedUnits ?? 0);
    summary.randomTarget += Number(result.randomTarget ?? 0);
    summary.randomUnits += Number(result.randomUnits ?? 0);
    summary.materializationFailures += Number(result.diagnostics?.materializationFailures?.length ?? 0);
    summary.rerolls += Number(result.diagnostics?.rerolls?.length ?? 0);
    for (const [rarity, count] of Object.entries(result.diagnostics?.byRarity ?? {})) {
      summary.byRarity[rarity] = Number(summary.byRarity[rarity] ?? 0) + Number(count ?? 0);
    }
    for (const [kind, count] of Object.entries(result.diagnostics?.byGenerationKind ?? {})) {
      summary.byGenerationKind[kind] = Number(summary.byGenerationKind[kind] ?? 0) + Number(count ?? 0);
    }
    for (const [ruleName, count] of Object.entries(result.diagnostics?.byRule ?? {})) {
      summary.byRule[ruleName] = Number(summary.byRule[ruleName] ?? 0) + Number(count ?? 0);
    }
    for (const [itemName, count] of Object.entries(result.diagnostics?.byItem ?? {})) {
      summary.byItem[itemName] = Number(summary.byItem[itemName] ?? 0) + Number(count ?? 0);
    }
    for (const item of result.diagnostics?.materializers ?? []) {
      const key = `${item.kind || "materializer"}:${item.strategy || "unknown"}`;
      summary.materializers[key] = Number(summary.materializers[key] ?? 0) + 1;
    }
    samples.push(result.diagnostics);
  }
  summary.averagePlannedUnits = summary.plannedUnits / iterations;
  summary.averageGeneratedUnits = summary.generatedUnits / iterations;
  summary.averageRandomTarget = summary.randomTarget / iterations;
  summary.averageRandomUnits = summary.randomUnits / iterations;
  summary.topItems = Object.entries(summary.byItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, count]) => ({ name, count, averagePerRun: count / iterations }));
  console.groupCollapsed?.(`${MODULE_ID} | Supplier audit — ${profile.name} (${iterations} runs)`);
  console.table?.(summary.byRarity);
  console.debug?.(summary, samples);
  console.groupEnd?.();
  return { summary, samples };
}

/** Deterministically validate every installed source variant for known recipe
 * families against the profile's technical target catalog. Nothing is created. */
export async function auditMaterializationRecipes({ profile, level = 20, families = [] } = {}) {
  if (!profile) throw new Error("A Supplier profile is required for recipe audit.");
  const worldConfiguration = getConfiguration();
  const configuration = configurationForProfile(worldConfiguration, profile);
  const catalog = await buildCatalog({ force: true });
  const entries = entriesForProfile(catalog, profile, worldConfiguration, { includeMechanical: false });
  const requested = new Set((families ?? []).map(normalizeText).filter(Boolean));
  const targets = entries.filter(entry => !isMaterializerItem(entry) && !isMechanicalItem(entry) && !entry.isMagical);
  const report = [];

  for (const entry of entries.filter(candidate => isMaterializerItem(candidate) && hasMaterializationRecipe(candidate))) {
    const variants = (entry.sourceVariants?.length ? entry.sourceVariants : [entry])
      .filter(variant => variant.uuid && (variant.recipeSupported === true || hasMaterializationRecipe(variant)));
    for (const variant of variants) {
      const sourceDocument = await loadItemDocument(variant);
      const recipe = materializationRecipe(sourceDocument);
      if (!recipe || (requested.size && !requested.has(normalizeText(recipe.id)))) continue;
      if (recipe.mode === "resolve-variant") {
        for (const bonus of [1, 2, 3]) {
          const result = await materializeRecipe({ sourceDocument, requestedBonus: bonus, maxBonus: 3 });
          report.push({ family: recipe.id, source: variant.uuid, sourceName: sourceDocument.name, target: "", selection: `+${bonus}`, ok: result.ok === true, reason: result.reason ?? "", issues: result.ok ? recipeOutputIssues(recipe, result.documentData) : (result.issues ?? []) });
        }
        continue;
      }
      const compatible = targets.filter(target => recipeTargetCompatibility(recipe, target, sourceDocument) !== false);
      if (!compatible.length) {
        report.push({ family: recipe.id, source: variant.uuid, sourceName: sourceDocument.name, target: "", selection: "", ok: false, reason: "noCompatibleTarget", issues: [] });
        continue;
      }
      const target = compatible[0];
      const baseDocument = await loadItemDocument(target);
      const selections = recipe.id === "armor-of-resistance" ? ["force"]
        : recipe.id === "armor-of-vulnerability" ? ["slashing"]
          : recipe.id === "dragon-scale-mail" ? ["red"] : [null];
      for (const selection of selections) {
        const result = await materializeRecipe({ sourceDocument, baseDocument, selection, requestedBonus: 2, maxBonus: 3, qualityPriceAdditions: configuration.qualityPriceAdditions ?? {} });
        report.push({ family: recipe.id, source: variant.uuid, sourceName: sourceDocument.name, target: target.uuid, targetName: target.name, selection: selection ?? "", ok: result.ok === true, reason: result.reason ?? "", issues: result.ok ? recipeOutputIssues(recipe, result.documentData) : (result.issues ?? []) });
      }
    }
  }

  const ammunitionTargets = new Map();
  for (const target of targets.filter(isAmmunitionEntry)) {
    const family = ammunitionFamilyKey(target);
    if (family && !ammunitionTargets.has(family)) ammunitionTargets.set(family, target);
  }
  if (!requested.size || requested.has("enchanted-ammunition")) {
    for (const [family, target] of ammunitionTargets) {
      const baseDocument = await loadItemDocument(target);
      for (const bonus of [1, 2, 3]) {
        const result = await materializeRecipe({ recipeId: "enchanted-ammunition", sourceDocument: baseDocument, baseDocument, requestedBonus: bonus, maxBonus: 3, qualityPriceAdditions: configuration.qualityPriceAdditions ?? {} });
        report.push({ family: "enchanted-ammunition", source: target.uuid, sourceName: target.name, target: target.uuid, targetName: target.name, selection: `${family} +${bonus}`, ok: result.ok === true, reason: result.reason ?? "", issues: result.ok ? recipeOutputIssues("enchanted-ammunition", result.documentData) : (result.issues ?? []) });
      }
    }
  }
  const summary = {
    profile: profile.name,
    level,
    tested: report.length,
    passed: report.filter(row => row.ok && !row.issues.length).length,
    failed: report.filter(row => !row.ok || row.issues.length).length,
    byFamily: report.reduce((groups, row) => ((groups[row.family] ??= []).push(row), groups), {})
  };
  console.groupCollapsed?.(`${MODULE_ID} | Materialization recipe audit — ${profile.name}`);
  console.table?.(report.map(({ family, sourceName, targetName, selection, ok, reason, issues }) => ({ family, sourceName, targetName, selection, ok, reason, issues: issues.join(", ") })));
  console.debug?.(summary, report);
  console.groupEnd?.();
  return { summary, report };
}

function resolveProgressionProfileName(configuration, profile) {
  const requestedId = String(profile?.progressionProfileId ?? "world");
  const activeId = requestedId === "world" ? configuration.activeProgressionProfileId : requestedId;
  return (configuration.progressionProfiles ?? []).find(entry => entry.id === activeId)?.name ?? activeId ?? "world";
}

function formatFolderName(template, profile, level, players) {
  const now = new Date();
  const language = game.i18n.lang || "pt-BR";
  const date = new Intl.DateTimeFormat(language, { day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);

  return String(template || "{supplier} — {date} — {time}")
    .replaceAll("{supplier}", profile.name)
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .replaceAll("{datetime}", `${date} ${time}`)
    .replaceAll("{level}", String(level))
    .replaceAll("{players}", String(players));
}

export async function createWorldFolder({ profile, level, players, preview }) {
  if (!preview?.length) throw new Error(game.i18n.localize("DND5E_SUPPLIER.Errors.NoPreview"));

  const configuration = getConfiguration();
  const generationId = foundry.utils.randomID(24);
  const generatedAt = Date.now();
  const ItemClass = CONFIG.Item.documentClass;
  const FolderClass = CONFIG.Folder?.documentClass ?? Folder;
  const folderName = formatFolderName(configuration.folderNameTemplate, profile, level, players);

  const folder = await FolderClass.create({
    name: folderName,
    type: "Item",
    flags: {
      [MODULE_ID]: {
        supplier: {
          generated: true,
          generationId,
          profileId: profile.id,
          profileName: profile.name,
          progressionProfileId: profile.progressionProfileId ?? "world",
          progressionProfileName: resolveProgressionProfileName(configuration, profile),
          accessLevel: profile.homebrewAccessLevel ?? "custom",
          partyLevel: level,
          partySize: players,
          generatedAt,
          moduleVersion: game.modules.get(MODULE_ID)?.version
        }
      }
    }
  });

  try {
    const documents = preview.map(line => {
      const data = foundry.utils.deepClone(line.documentData);
      delete data._id;
      data.folder = folder.id;
      if (data.system && Object.hasOwn(data.system, "container")) delete data.system.container;
      normalizeScrollActivityLevels(data);
      foundry.utils.setProperty(data, "system.quantity", Math.max(1, Number(line.quantity)));
      foundry.utils.setProperty(data, "system.price", {
        value: Math.max(0, Number(line.price.value) || 0),
        denomination: line.price.denomination || "gp"
      });
      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      data.flags[MODULE_ID].supplier = {
        generated: true,
        generationId,
        profileId: profile.id,
        profileName: profile.name,
        progressionProfileId: profile.progressionProfileId ?? "world",
        progressionProfileName: resolveProgressionProfileName(configuration, profile),
        accessLevel: profile.homebrewAccessLevel ?? "custom",
        partyLevel: level,
        partySize: players,
        sourceUuid: line.sourceUuid,
        generatorSourceUuid: line.generatorSourceUuid ?? "",
        blueprintSourceUuid: line.blueprintSourceUuid ?? "",
        materializedBaseUuid: line.materializedBaseUuid ?? "",
        documentNature: line.documentNature ?? "sellable",
        materializerKind: line.materializerKind ?? "",
        materialization: foundry.utils.deepClone(line.materialization ?? {}),
        priceOrigin: line.price.origin,
        generationKind: line.generationKind,
        enhancement: line.enhancement ?? 0,
        generatedAt
      };
      return data;
    });

    const items = await ItemClass.createDocuments(documents);
    return { folder, items };
  } catch (error) {
    const partialItems = game.items.filter(item => item.folder?.id === folder.id && item.getFlag(MODULE_ID, "supplier.generationId") === generationId);
    if (partialItems.length) await ItemClass.deleteDocuments(partialItems.map(item => item.id));
    await folder.delete();
    throw error;
  }
}
