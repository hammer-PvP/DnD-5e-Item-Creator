import { MODULE_ID } from "./constants.mjs";
import {
  buildCatalog,
  canonicalKey,
  entriesForProfile,
  entryMatchesSubtype,
  findEntry,
  isAmmunitionEntry,
  isBlueprintItem,
  isFirearmEntry,
  isFirearmRelated,
  isGeneratorItem,
  isMaterializerItem,
  isMechanicalItem,
  isVariantFamilyItem,
  loadItemDocument,
  normalizeRarity,
  normalizeText,
  resolvePrice
} from "./catalog.mjs";
import { homebrewCurationAllowsEntry } from "./homebrew-suppliers.mjs";
import {
  profileAccessLevel,
  vendorAccessAllowsEntry,
  vendorAccessWeight
} from "./availability.mjs";
import { getConfiguration } from "./settings.mjs";
import {
  canMaterializeOnto,
  canonicalizeItemName,
  classifyDocumentNature,
  materializeEnhancement,
  materializeNativeBlueprint,
  materializeSyntheticEnhancement
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
    qualityPriceAdditions: foundry.utils.deepClone(progression.qualityPriceAdditions ?? configuration.qualityPriceAdditions ?? {})
  } : { ...configuration };
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
    return (entry.sourceVariants ?? []).some(variant => variant.variantConcrete === true
      && Number(variant.enhancement ?? 0) > 0
      && Number(variant.enhancement ?? 0) <= maximum);
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
    return (entry.sourceVariants ?? []).some(variant => variant.variantConcrete === true
      && Number(variant.enhancement ?? 0) <= maximum
      && (!rarities.size || rarities.has(normalizeRarity(variant.rarity))));
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
      homebrewCurationAllowsEntry(entry, rule.homebrewCuration)
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
  const stageCuration = stageSubtype.filter(entry => homebrewCurationAllowsEntry(entry, rule.homebrewCuration));
  const stageAccess = stageCuration.filter(entry => vendorAccessAllowsEntry(entry, profile, rule));
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
  else if (!stageCuration.length) reason = "curation";
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
      curation: stageCuration.length,
      access: stageAccess.length,
      magic: stageMagic.length,
      rarity: stageRarity.length,
      spellLevel: stageSpell.length,
      final: stageFinal.length
    }
  };
}

const HAMMER_ALCHEMIST_RARITY_DISTRIBUTIONS = Object.freeze([
  { min: 1, max: 3, weights: { common: 85, uncommon: 15 } },
  { min: 4, max: 6, weights: { common: 55, uncommon: 40, rare: 5 } },
  { min: 7, max: 10, weights: { common: 25, uncommon: 50, rare: 25 } },
  { min: 11, max: 13, weights: { uncommon: 30, rare: 60, veryRare: 10 } },
  { min: 14, max: 16, weights: { uncommon: 10, rare: 60, veryRare: 30 } },
  { min: 17, max: 20, weights: { rare: 45, veryRare: 55 } }
]);

const HAMMER_HEALING_DISTRIBUTIONS = Object.freeze([
  { min: 1, max: 3, weights: { basic: 100 } },
  { min: 4, max: 6, weights: { basic: 75, greater: 25 } },
  { min: 7, max: 8, weights: { basic: 50, greater: 50 } },
  { min: 9, max: 10, weights: { basic: 25, greater: 50, superior: 25 } },
  { min: 11, max: 13, weights: { greater: 60, superior: 35, supreme: 5 } },
  { min: 14, max: 16, weights: { greater: 35, superior: 50, supreme: 15 } },
  { min: 17, max: 20, weights: { greater: 20, superior: 50, supreme: 30 } }
]);

function distributionBand(bands, level) {
  return bands.find(entry => level >= entry.min && level <= entry.max) ?? bands.at(-1);
}

function finalMaterializedAvailabilityAccepted(pick, rarity) {
  const finalEntry = {
    ...(pick?.entry ?? {}),
    rarity: normalizeRarity(rarity),
    materializerRarities: [normalizeRarity(rarity)]
  };
  return vendorAccessAllowsEntry(finalEntry, pick?.profile ?? null, pick?.rule ?? null);
}

function entrySelectionWeight(entry, rule, level, profile = null) {
  let weight = 1;
  if (rule?.selectionDistribution === "hammerHealingPotions") {
    const tier = (() => {
      const value = normalizeText(`${entry.identifier ?? ""} ${entry.name ?? ""}`);
      if (value.includes("supreme")) return "supreme";
      if (value.includes("superior")) return "superior";
      if (value.includes("greater")) return "greater";
      return "basic";
    })();
    weight *= Math.max(0, Number(distributionBand(HAMMER_HEALING_DISTRIBUTIONS, level)?.weights?.[tier] ?? 0));
  }
  if (rule?.rarityDistribution === "hammerAlchemistExtras") {
    const rarity = normalizeRarity(entry.rarity);
    weight *= Math.max(0, Number(distributionBand(HAMMER_ALCHEMIST_RARITY_DISTRIBUTIONS, level)?.weights?.[rarity] ?? 0));
  }
  if (rule?.homebrewCuration === "blacksmithWearables") {
    const identity = normalizeText(`${entry.identifier ?? ""} ${entry.name ?? ""} ${entry.baseItem ?? ""}`);
    if (["cloak", "cape", "manto", "capa"].some(term => identity.includes(term))) weight *= 0.25;
  }
  // Vendor Access is a gradient for ordinary merchandise. It does not replace
  // the party-level rarity progression and only becomes a hard gate for
  // explicit restrictions, artifacts, and major relics.
  weight *= vendorAccessWeight(entry, profile);
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

function weightedEntryChoice(entries, rule, level, profile = null) {
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
    return { entry, weight: entrySelectionWeight(entry, rule, level, profile) / familySize };
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

function familyAllowed(entry, rule, familyCounts) {
  const maximum = Math.max(0, Number(rule?.maxPerFamily ?? 0));
  if (!maximum) return true;
  return Number(familyCounts.get(stockFamilyKey(entry)) ?? 0) < maximum;
}

function recordFamily(entry, familyCounts) {
  const key = stockFamilyKey(entry);
  familyCounts.set(key, Number(familyCounts.get(key) ?? 0) + 1);
}

function rulePassesChance(rule) {
  const chance = Math.min(100, Math.max(0, Number(rule?.chance ?? 100)));
  return chance >= 100 || Math.random() * 100 < chance;
}

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function weightedStateChoice(states) {
  const weighted = states.map(state => ({
    state,
    weight: Math.max(0.001, Number(state.rule.randomWeight ?? 1))
  }));
  const total = weighted.reduce((sum, option) => sum + option.weight, 0);
  let roll = Math.random() * total;
  for (const option of weighted) {
    roll -= option.weight;
    if (roll <= 0) return option.state;
  }
  return weighted.at(-1)?.state ?? null;
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

function chooseFromBuckets(pool, rule, quantity, allowDuplicates, level = 1, familyCounts = new Map(), profile = null) {
  const groups = buildRuleBuckets(pool, rule).map(group => ({ ...group, available: [...group.entries] }));
  if (!groups.length || quantity <= 0) return [];
  const chosen = [];

  while (chosen.length < quantity) {
    const active = groups.filter(group => allowDuplicates || group.available.length);
    if (!active.length) break;
    const group = randomChoice(active);
    const source = (allowDuplicates ? group.entries : group.available).filter(entry => familyAllowed(entry, rule, familyCounts));
    if (!source.length) {
      if (!allowDuplicates) group.available.length = 0;
      continue;
    }
    const entry = weightedEntryChoice(source, rule, level, profile);
    if (!entry) continue;
    chosen.push(entry);
    recordFamily(entry, familyCounts);
    if (!allowDuplicates) {
      const index = group.available.indexOf(entry);
      if (index >= 0) group.available.splice(index, 1);
    }
  }
  return chosen;
}

function selectRuleEntries({ rule, catalog, profileEntries, configuration, profile, level, quantity, warnings, familyCounts = new Map() }) {
  const inspection = inspectRulePool({ rule, catalog, profileEntries, configuration, profile, level });
  const pool = inspection.entries ?? [];
  if (!pool.length) {
    warnings.push(game.i18n.format("DND5E_SUPPLIER.Errors.EmptyPoolReason", {
      rule: rule.name || game.i18n.localize("DND5E_SUPPLIER.Config.UnnamedRule"),
      reason: game.i18n.localize(`DND5E_SUPPLIER.PoolReason.${inspection.reason || "category"}`)
    }));
    return [];
  }

  // Every quantity point is an independent slot. This is important for families:
  // 10 Healing Potion slots produce 10 independent tier rolls, then stack.
  if (rule.coverageMode === "oneEach") {
    const groups = buildRuleBuckets(pool, rule);
    if (groups.length) {
      const selected = [];
      for (let repeat = 0; repeat < Math.max(1, quantity); repeat += 1) {
        for (const group of groups) {
          const eligible = group.entries.filter(entry => familyAllowed(entry, rule, familyCounts));
          const entry = weightedEntryChoice(eligible, rule, level, profile);
          if (!entry) continue;
          selected.push(entry);
          recordFamily(entry, familyCounts);
        }
      }
      return selected;
    }
  }

  const selected = chooseFromBuckets(pool, rule, quantity, rule.allowDuplicates !== false, level, familyCounts, profile);
  if (rule.allowDuplicates === false && selected.length < quantity) {
    warnings.push(game.i18n.format("DND5E_SUPPLIER.Errors.NotEnoughUnique", {
      requested: quantity,
      available: pool.length,
      rule: rule.name || game.i18n.localize("DND5E_SUPPLIER.Config.UnnamedRule")
    }));
  }
  return selected;
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

function materializerResultCuration(rule) {
  const explicit = String(rule?.generatorResultCuration ?? "");
  if (explicit) return explicit;
  const curation = String(rule?.homebrewCuration ?? "");
  if (curation === "blacksmithNamed") return "blacksmithBase";
  if (curation === "namedFirearms") return "firearmWeapons";
  return curation;
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

  const resultCuration = materializerResultCuration(rule);
  if (resultCuration) candidates = candidates.filter(entry => homebrewCurationAllowsEntry(entry, resultCuration));
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

  if (rule.homebrewCuration === "blacksmithNamed") candidates = candidates.filter(entry => !isFirearmRelated(entry));
  if (rule.homebrewCuration === "namedFirearms") candidates = candidates.filter(entry => isFirearmEntry(entry));
  const resultCuration = materializerResultCuration(rule);
  if (resultCuration) candidates = candidates.filter(entry => homebrewCurationAllowsEntry(entry, resultCuration));
  return shuffle(candidates);
}

async function createBlueprintPreview(pick, catalog, configuration, targetEntries, blueprintDocument, level) {
  const candidates = blueprintCandidateEntries(blueprintDocument, targetEntries, pick.rule);
  let materialized = null;
  let baseEntry = null;
  for (const candidate of candidates) {
    try {
      const baseDocument = await loadItemDocument(candidate);
      if (!canMaterializeOnto(blueprintDocument, baseDocument)) continue;
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

  if (!materialized || !baseEntry) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.BlueprintNoEligibleResult", { item: pick.entry.name }));
  }

  const documentData = materialized.documentData;
  const display = materialized.display ?? {};
  const rarity = normalizeRarity(display.rarity ?? foundry.utils.getProperty(documentData, "system.rarity") ?? pick.entry.rarity);
  if (!finalMaterializedAvailabilityAccepted(pick, rarity)) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationAccessRejected", { item: display.name ?? documentData.name }));
  }
  const price = priceFromMaterializedData(
    documentData,
    display,
    resolvePrice(pick.entry, catalog, configuration),
    "materializedBlueprint"
  );
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

function chooseVariantCandidate(pick, candidates, configuration, level) {
  if (!candidates.length) return null;
  const rule = pick.rule ?? {};
  let target = 0;
  if (rule.qualityMode === "fixed") target = clampInteger(rule.fixedBonus, 1, 3);
  else if (rule.qualityMode === "party") target = weightedBonus(configuration, level, { positiveOnly: true });
  else if (Number(pick.enhancement ?? 0) > 0) target = clampInteger(pick.enhancement, 1, 3);

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

async function createVariantPreview(pick, catalog, configuration, level) {
  const candidates = variantCandidates(pick.entry, configuration, level);
  const selected = chooseVariantCandidate(pick, candidates, configuration, level);
  if (!selected) {
    throw new Error(game.i18n.format("DND5E_SUPPLIER.Errors.MaterializationFailed", { item: pick.entry.name }));
  }

  const document = await loadItemDocument(selected);
  const documentData = document.toObject();
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

async function buildPreviewLine(pick, catalog, configuration, { profileEntries = [], materializationTargets = profileEntries, level = 1 } = {}) {
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
    return createBlueprintPreview(pick, catalog, configuration, materializationTargets, document, level);
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

async function buildPreviewLineWithFallback(pick, catalog, configuration, profileEntries, materializationTargets, level, warnings, diagnostics = null) {
  try {
    const line = await buildPreviewLine(pick, catalog, configuration, { profileEntries, materializationTargets, level });
    line.ruleName = pick.rule?.name ?? "";
    line.ruleType = pick.ruleType ?? "";
    return line;
  } catch (originalError) {
    // Any failed slot may be replaced by another eligible result from the same
    // rule. This covers both native materializers and ordinary base Items whose
    // synthetic +1/+2/+3 conversion failed strict validation.
    const inspection = inspectRulePool({ rule: pick.rule, catalog, profileEntries, configuration, profile: pick.profile ?? null, level });
    const alternatives = shuffle((inspection.entries ?? []).filter(entry => canonicalKey(entry) !== canonicalKey(pick.entry)));
    for (const alternative of alternatives) {
      try {
        const replacement = await buildPreviewLine({ ...pick, entry: alternative }, catalog, configuration, { profileEntries, materializationTargets, level });
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

function addPicks(target, entries, rule, ruleType, configuration, level, players, warnings, profile = null) {
  const qualityPicks = applyQuality(rule, entries, configuration, level, players, warnings);
  for (const pick of qualityPicks) target.push({ ...pick, rule, ruleType, profile });
  return qualityPicks.length;
}

export async function generateStock({ profile, level, players, logDiagnostics = true }) {
  const worldConfiguration = getConfiguration();
  const configuration = configurationForProfile(worldConfiguration, profile);
  const catalog = await buildCatalog();
  if (!catalog.entries.length) throw new Error(game.i18n.localize("DND5E_SUPPLIER.Errors.NoCatalog"));

  const profileEntries = entriesForProfile(catalog, profile, worldConfiguration);
  if (!profileEntries.length) throw new Error(game.i18n.localize("DND5E_SUPPLIER.Errors.NoProfileCatalog"));

  const picks = [];
  const warnings = [];
  const randomTarget = calculateRandomTarget(profile, players, level);
  const familyCounts = new Map();
  const diagnostics = {
    profile: profile.name,
    template: profile.homebrewTemplateId ?? "",
    access: profileAccessLevel(profile),
    progression: profile.progressionProfileId ?? "world",
    partyLevel: level,
    partySize: players,
    randomTarget,
    rules: [],
    materializationFailures: [],
    rerolls: []
  };
  let catalogUnits = 0;
  let guaranteedUnits = 0;
  let randomUnits = 0;
  const mundaneTargetMap = new Map();

  // 1. Mundane Catalog is always additional to the random target.
  // Every eligible distinct Item is included with the configured quantity per Item.
  for (const rule of profile.mundaneCatalogRules ?? []) {
    if (!rule.enabled || !rule.category) continue;
    if (!rulePassesChance(rule)) continue;
    const perItem = calculateQuantity(rule, players, 0, { profile, level });
    if (!perItem) continue;
    const inspection = inspectRulePool({ rule, catalog, profileEntries, configuration, profile, level });
    if (!inspection.count) {
      if (!rule.silentIfEmpty) warnings.push(game.i18n.format("DND5E_SUPPLIER.Errors.EmptyPoolReason", {
        rule: rule.name || game.i18n.localize("DND5E_SUPPLIER.Config.MundaneCatalog"),
        reason: game.i18n.localize(`DND5E_SUPPLIER.PoolReason.${inspection.reason || "category"}`)
      }));
      continue;
    }
    for (const entry of inspection.entries) {
      picks.push({ entry, enhancement: 0, units: perItem, rule, ruleType: "catalog", profile });
      mundaneTargetMap.set(canonicalKey(entry), entry);
      catalogUnits += perItem;
    }
  }

  // 2. Guaranteed Items are also additional to the random target.
  // Quantity N always means N independent selections and N independent quality rolls.
  for (const rule of profile.guaranteedRules ?? []) {
    if (!rule.enabled || !rule.category) continue;
    if (!rulePassesChance(rule)) {
      diagnostics.rules.push({ id: rule.id, name: rule.name, type: "guaranteed", skippedByChance: true });
      continue;
    }
    const quantity = calculateQuantity(rule, players, 0, { profile, level });
    if (!quantity) continue;
    const selected = selectRuleEntries({ rule, catalog, profileEntries, configuration, profile, level, quantity, warnings, familyCounts });
    diagnostics.rules.push({ id: rule.id, name: rule.name, type: "guaranteed", requested: quantity, selected: selected.length });
    guaranteedUnits += addPicks(picks, selected, rule, "guaranteed", configuration, level, players, warnings, profile);
  }

  // 3. Random Stock has one explicit target. All enabled random pools compete
  // for those slots according to their relative weights.
  if (randomTarget > 0) {
    const allStates = [];
    for (const rule of profile.randomRules ?? []) {
      if (!rule.enabled || !rule.category) continue;
      if (!rulePassesChance(rule)) continue;
      const inspection = inspectRulePool({ rule, catalog, profileEntries, configuration, profile, level });
      if (!inspection.count) {
        if (!rule.silentIfEmpty) warnings.push(game.i18n.format("DND5E_SUPPLIER.Errors.EmptyPoolReason", {
          rule: rule.name || game.i18n.localize("DND5E_SUPPLIER.Config.RandomStock"),
          reason: game.i18n.localize(`DND5E_SUPPLIER.PoolReason.${inspection.reason || "category"}`)
        }));
        continue;
      }
      const pool = inspection.entries ?? [];
      const diagnosticRule = {
        id: rule.id,
        name: rule.name,
        type: "random",
        weight: Number(rule.randomWeight ?? 1),
        pool: inspection.count,
        stages: inspection.stages,
        selected: 0
      };
      diagnostics.rules.push(diagnosticRule);
      allStates.push({
        rule,
        pool,
        available: [...pool],
        selected: [],
        diagnosticRule
      });
    }

    const activeStates = [...allStates];
    while (randomUnits < randomTarget && activeStates.length) {
      const state = weightedStateChoice(activeStates);
      if (!state) break;
      const allowDuplicates = state.rule.allowDuplicates !== false;
      const source = (allowDuplicates ? state.pool : state.available)
        .filter(entry => familyAllowed(entry, state.rule, familyCounts));
      if (!source.length) {
        activeStates.splice(activeStates.indexOf(state), 1);
        continue;
      }
      const entry = weightedEntryChoice(source, state.rule, level, profile);
      if (!entry) {
        activeStates.splice(activeStates.indexOf(state), 1);
        continue;
      }
      if (!allowDuplicates) {
        const index = state.available.indexOf(entry);
        if (index >= 0) state.available.splice(index, 1);
      }
      state.selected.push(entry);
      if (state.diagnosticRule) state.diagnosticRule.selected = state.selected.length;
      recordFamily(entry, familyCounts);
      randomUnits += 1;
    }

    // Apply quality once per pool so enchanted minimums are evaluated against
    // the full set won by that pool, not independently for every slot.
    for (const state of allStates) {
      if (!state.selected.length) continue;
      addPicks(picks, state.selected, state.rule, "random", configuration, level, players, warnings, profile);
    }
  }

  if (randomTarget > randomUnits) {
    warnings.push(game.i18n.format("DND5E_SUPPLIER.Errors.RandomTargetNotFilled", {
      generated: randomUnits,
      target: randomTarget
    }));
  }

  const materializationTargets = mundaneTargetMap.size ? [...mundaneTargetMap.values()] : profileEntries;
  diagnostics.mundaneTargetCount = materializationTargets.length;
  const lines = [];
  for (const pick of picks) {
    try {
      lines.push(await buildPreviewLineWithFallback(pick, catalog, configuration, profileEntries, materializationTargets, level, warnings, diagnostics));
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
  const actualGeneratedUnits = preview.reduce((sum, line) => sum + Math.max(1, Number(line.quantity ?? 1)), 0);
  diagnostics.actualGeneratedUnits = actualGeneratedUnits;
  diagnostics.byRarity = preview.reduce((counts, line) => {
    const key = normalizeRarity(line.rarity);
    counts[key] = Number(counts[key] ?? 0) + Math.max(1, Number(line.quantity ?? 1));
    return counts;
  }, {});
  diagnostics.byGenerationKind = preview.reduce((counts, line) => {
    const key = line.generationKind || "copy";
    counts[key] = Number(counts[key] ?? 0) + Math.max(1, Number(line.quantity ?? 1));
    return counts;
  }, {});
  diagnostics.byRule = preview.reduce((counts, line) => {
    const key = line.ruleName || "Unattributed";
    counts[key] = Number(counts[key] ?? 0) + Math.max(1, Number(line.quantity ?? 1));
    return counts;
  }, {});
  diagnostics.byItem = preview.reduce((counts, line) => {
    counts[line.name] = Number(counts[line.name] ?? 0) + Math.max(1, Number(line.quantity ?? 1));
    return counts;
  }, {});
  diagnostics.materializers = preview
    .filter(line => line.materializerKind || line.materialization?.materialized === true)
    .map(line => ({
      name: line.name,
      kind: line.materializerKind || line.generationKind || "materializer",
      strategy: line.materialization?.strategy ?? "",
      bonus: line.enhancement ?? 0,
      rule: line.ruleName ?? "",
      baseUuid: line.materializedBaseUuid ?? "",
      sourceUuid: line.blueprintSourceUuid || line.generatorSourceUuid || line.sourceUuid || ""
    }));
  if (logDiagnostics) {
    console.groupCollapsed?.(`${MODULE_ID} | Supplier diagnostics — ${profile.name} (L${level}, ${players} players)`);
    console.table?.(diagnostics.byRarity);
    console.debug?.(diagnostics);
    console.groupEnd?.();
  }
  return {
    preview,
    warnings,
    target: randomTarget,
    randomTarget,
    catalogUnits,
    guaranteedUnits,
    randomUnits,
    generatedUnits: actualGeneratedUnits,
    plannedUnits: catalogUnits + guaranteedUnits + randomUnits,
    diagnostics
  };
}


/** Run repeated headless previews without opening Supplier windows or creating
 * World Items. This is a development/audit surface for checking quantity,
 * rarity distribution, rerolls, and materialization failures under the hood. */
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
