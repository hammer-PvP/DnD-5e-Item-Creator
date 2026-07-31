import {
  CONFIGURATION_VERSION,
  DEFAULT_ENCHANTMENT_BANDS,
  DEFAULT_LEVEL_BANDS,
  DEFAULT_PRICE_FALLBACKS,
  DEFAULT_QUALITY_PRICE_ADDITIONS,
  HAMMER_HOMEBREW_PROGRESSION_ID,
  MODULE_ID,
  RECOMMENDED_PROGRESSION_ID,
  SUPPLIER_THEMES,
  SUPPLIER_CONFIGURATION_KEY,
  SUPPLIER_ENABLED_KEY,
  createDefaultCatalogRule,
  createDefaultGuaranteedRule,
  createDefaultRandomRule,
  createDefaultSettings,
  createHammerHomebrewProgressionProfile,
  createRecommendedProgressionProfile
} from "./constants.mjs";
import { restoreHomebrewRuleCurations } from "./homebrew-curation.mjs";

export function registerSupplierSettings() {
  game.settings.register(MODULE_ID, SUPPLIER_ENABLED_KEY, {
    name: "Enable Supplier Tools",
    hint: "Enable the integrated Supplier stock generator and its configuration tools.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SUPPLIER_CONFIGURATION_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: createDefaultSettings()
  });
}

export function isSupplierEnabled() {
  return game.settings.get(MODULE_ID, SUPPLIER_ENABLED_KEY) === true;
}

function arrayValue(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [...fallback];
  return [value];
}

function normalizeBannedItem(item) {
  return {
    id: String(item?.id ?? foundry.utils.randomID()),
    key: String(item?.key ?? ""),
    uuid: String(item?.uuid ?? ""),
    name: String(item?.name ?? ""),
    img: String(item?.img ?? ""),
    type: String(item?.type ?? ""),
    subtype: String(item?.subtype ?? ""),
    subtypeKey: String(item?.subtypeKey ?? ""),
    packId: String(item?.packId ?? ""),
    packLabel: String(item?.packLabel ?? ""),
    packageName: String(item?.packageName ?? ""),
    allSources: item?.allSources === true
  };
}

function normalizeBannedItems(items) {
  return arrayValue(items).map(normalizeBannedItem).filter(item => item.key || item.uuid);
}

function normalizeMechanicalOverride(item) {
  return {
    uuid: String(item?.uuid ?? ""),
    excluded: item?.excluded === true
  };
}

function normalizeMechanicalOverrides(items) {
  const byUuid = new Map();
  for (const item of arrayValue(items).map(normalizeMechanicalOverride)) {
    if (!item.uuid) continue;
    byUuid.set(item.uuid, item);
  }
  return [...byUuid.values()];
}

function inferTheme(profile) {
  if (SUPPLIER_THEMES.some(theme => theme.id === profile?.theme)) return profile.theme;
  const value = `${profile?.name ?? ""} ${profile?.icon ?? ""}`.toLowerCase();
  if (value.includes("alchemist") || value.includes("alquim") || value.includes("flask")) return "alchemist";
  if (value.includes("gunsmith") || value.includes("armas de fogo") || value.includes("pistola") || value.includes("mosquete") || value.includes("fa-gun")) return "gunsmith";
  if (value.includes("blacksmith") || value.includes("ferreir") || value.includes("hammer")) return "blacksmith";
  if (value.includes("jewel") || value.includes("joalh") || value.includes("gem") || value.includes("ring")) return "jeweler";
  if (value.includes("magic") || value.includes("mágic") || value.includes("arcane") || value.includes("wand")) return "magic";
  if (value.includes("general") || value.includes("gerais") || value.includes("basket")) return "general";
  if (value.includes("stable") || value.includes("livestock") || value.includes("estábulo") || value.includes("curral") || value.includes("horse")) return "stable";
  return "custom";
}

function iconForTheme(themeId, fallback = "fa-solid fa-store") {
  return SUPPLIER_THEMES.find(theme => theme.id === themeId)?.icon ?? fallback;
}

function inferCategory(rule) {
  if (rule?.category === "healingPotions") return "consumable";
  if (rule?.category) return rule.category;
  if (rule?.selectionMode === "spellScroll") return "spellScroll";
  if (rule?.selectionMode === "family" && rule?.familyId === "healingPotions") return "consumable";
  if (["exact", "list"].includes(rule?.selectionMode)) return "exact";

  const types = arrayValue(rule?.itemTypes);
  if (types.length === 1) {
    if (types[0] === "weapon") return "weapon";
    if (types[0] === "equipment") return "equipment";
    if (["consumable", "tool", "loot", "container"].includes(types[0])) return types[0];
    if (types[0] === "spell") return "spellScroll";
  }
  return "";
}

function canonicalSubtypeValue(value) {
  const raw = String(value ?? "");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliases = {
    simplem: "simpleM",
    simpler: "simpleR",
    martialm: "martialM",
    martialr: "martialR",
    light: "lightArmor",
    lightarmor: "lightArmor",
    medium: "mediumArmor",
    mediumarmor: "mediumArmor",
    heavy: "heavyArmor",
    heavyarmor: "heavyArmor",
    shield: "shield",
    wondrousitem: "wondrous",
    wondrous: "wondrous",
    ammo: "ammunition"
  };
  return aliases[normalized] ?? raw;
}

function migrateLegacySubtypeFilters(rule, category, existingSubtypes) {
  const result = new Set(arrayValue(existingSubtypes).map(canonicalSubtypeValue).filter(Boolean));
  if (rule?.category === "healingPotions" || rule?.familyId === "healingPotions") result.add("potion");
  if (category === "weapon") {
    const categories = arrayValue(rule?.weaponCategories);
    const modes = arrayValue(rule?.weaponModes);
    const selectedCategories = categories.length ? categories : ["simple", "martial"];
    const selectedModes = modes.length ? modes : ["melee", "ranged"];
    if (categories.length || modes.length) {
      for (const weaponCategory of selectedCategories) {
        for (const mode of selectedModes) {
          if (weaponCategory === "simple" && mode === "melee") result.add("simpleM");
          if (weaponCategory === "simple" && mode === "ranged") result.add("simpleR");
          if (weaponCategory === "martial" && mode === "melee") result.add("martialM");
          if (weaponCategory === "martial" && mode === "ranged") result.add("martialR");
        }
      }
    }
  }
  if (category === "equipment" || category === "armor") {
    for (const armorCategory of arrayValue(rule?.armorCategories)) result.add(canonicalSubtypeValue(armorCategory));
  }
  return [...result];
}

function normalizeRule(rule, defaults) {
  const migrated = foundry.utils.mergeObject(defaults, rule ?? {}, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
    recursive: true
  });

  const wasHealingFamily = rule?.category === "healingPotions"
    || rule?.familyId === "healingPotions"
    || (rule?.selectionMode === "family" && rule?.familyId === "healingPotions");

  migrated.category = inferCategory(rule ?? migrated);
  if (migrated.category === "armor") migrated.category = "equipment";
  migrated.itemRefs = arrayValue(migrated.itemRefs);
  migrated.subtypes = migrateLegacySubtypeFilters(rule ?? migrated, migrated.category, migrated.subtypes ?? migrated.subtype);
  migrated.subtypeCategory = migrated.category;
  migrated.weaponCategories = [];
  migrated.weaponModes = [];
  migrated.armorCategories = [];
  migrated.spellLevelMode = "level";
  migrated.spellLevels = arrayValue(migrated.spellLevels, [0, 1]).map(Number);
  migrated.excludeRefs = arrayValue(migrated.excludeRefs);
  migrated.excludeFamilies = arrayValue(migrated.excludeFamilies);
  migrated.includeFamilies = arrayValue(migrated.includeFamilies);
  if (wasHealingFamily && !migrated.includeFamilies.includes("healingPotions")) migrated.includeFamilies.push("healingPotions");
  migrated.poolExclusions = arrayValue(migrated.poolExclusions);
  migrated.materializerExclusions = arrayValue(migrated.materializerExclusions);
  migrated.quantity = Number(migrated.quantity ?? 1);
  migrated.quantityMin = Number(migrated.quantityMin ?? 1);
  migrated.quantityMax = Number(migrated.quantityMax ?? 1);
  migrated.fixedBonus = Number(migrated.fixedBonus ?? 1);
  migrated.enchantedMinimum = Number(migrated.enchantedMinimum ?? 0);
  migrated.randomWeight = Math.max(0.1, Number(migrated.randomWeight ?? 1));
  migrated.coverageMode = migrated.coverageMode === "rolls" ? "slots" : (migrated.coverageMode ?? "slots");

  // v0.0.2 centralizes all rarity availability in progression profiles.
  delete migrated.rarityMode;
  delete migrated.rarities;
  return migrated;
}

function migrateCatalogRule(rule) {
  const migrated = normalizeRule(rule, createDefaultCatalogRule());
  migrated.magicalState = "mundane";
  migrated.qualityMode = "mundane";
  migrated.coverageMode = "all";
  migrated.countsTowardTotal = false;
  return migrated;
}

function migrateGuaranteedRule(rule) {
  const migrated = normalizeRule(rule, createDefaultGuaranteedRule());
  migrated.countsTowardTotal = false;
  migrated.coverageMode = "slots";
  const ref = String(rule?.itemRef ?? "").toLowerCase();
  if (!migrated.category && ["potion-of-healing", "potion of healing"].includes(ref)) {
    migrated.category = "consumable";
    migrated.subtypes = ["potion"];
    migrated.subtypeCategory = "consumable";
    migrated.includeFamilies = ["healingPotions"];
    migrated.name = rule?.itemLabel || "Healing Potions";
  }
  return migrated;
}

function migrateRandomRule(rule, profileTheme) {
  const migrated = normalizeRule(rule, createDefaultRandomRule());
  migrated.quantityMode = "remainder";
  migrated.countsTowardTotal = false;
  migrated.randomWeight = Math.max(0.1, Number(rule?.randomWeight ?? 1));

  const looksLikeLegacyPotionDefault =
    String(rule?.name ?? "") === "Random Stock"
    && rule?.selectionMode === "category"
    && arrayValue(rule?.itemTypes).length === 1
    && arrayValue(rule?.itemTypes)[0] === "consumable"
    && arrayValue(rule?.subtypes ?? rule?.subtype).map(String).includes("potion");
  if (profileTheme !== "alchemist" && looksLikeLegacyPotionDefault) {
    migrated.category = "";
    migrated.subtypeCategory = "";
    migrated.subtypes = [];
    migrated.excludeFamilies = [];
    migrated.includeFamilies = [];
  }
  return migrated;
}

function normalizeProgressionProfile(profile, fallback = null) {
  const base = fallback ?? createRecommendedProgressionProfile();
  return {
    id: String(profile?.id ?? foundry.utils.randomID()),
    name: String(profile?.name ?? "Custom Progression"),
    recommended: profile?.recommended === true,
    homebrew: profile?.homebrew === true,
    builtIn: String(profile?.builtIn ?? (profile?.recommended ? "recommended" : profile?.homebrew ? "homebrew" : "")),
    levelBands: foundry.utils.deepClone(arrayValue(profile?.levelBands, base.levelBands ?? DEFAULT_LEVEL_BANDS)),
    enchantmentBands: foundry.utils.deepClone(arrayValue(profile?.enchantmentBands, base.enchantmentBands ?? DEFAULT_ENCHANTMENT_BANDS)),
    priceFallbacks: foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULT_PRICE_FALLBACKS),
      profile?.priceFallbacks ?? base.priceFallbacks ?? {},
      { inplace: false, recursive: true, overwrite: true }
    ),
    qualityPriceAdditions: foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULT_QUALITY_PRICE_ADDITIONS),
      profile?.qualityPriceAdditions ?? base.qualityPriceAdditions ?? {},
      { inplace: false, recursive: true, overwrite: true }
    )
  };
}

function normalizeProgressionProfiles(stored, configuration) {
  const recommendedBase = createRecommendedProgressionProfile();
  let profiles = Array.isArray(stored?.progressionProfiles)
    ? stored.progressionProfiles.map(profile => normalizeProgressionProfile(profile, recommendedBase))
    : [];

  if (!profiles.length) {
    profiles = [normalizeProgressionProfile({
      ...recommendedBase,
      levelBands: Array.isArray(stored?.levelBands) ? stored.levelBands : configuration.levelBands,
      enchantmentBands: Array.isArray(stored?.enchantmentBands) ? stored.enchantmentBands : configuration.enchantmentBands,
      priceFallbacks: stored?.priceFallbacks ?? configuration.priceFallbacks,
      qualityPriceAdditions: stored?.qualityPriceAdditions ?? configuration.qualityPriceAdditions
    }, recommendedBase)];
  }

  if (!profiles.some(profile => profile.recommended || profile.id === RECOMMENDED_PROGRESSION_ID)) {
    profiles.unshift(recommendedBase);
  }
  if (!profiles.some(profile => profile.homebrew || profile.id === HAMMER_HOMEBREW_PROGRESSION_ID)) {
    profiles.push(createHammerHomebrewProgressionProfile());
  }

  const recommended = profiles.find(profile => profile.id === RECOMMENDED_PROGRESSION_ID) ?? profiles.find(profile => profile.recommended);
  if (recommended) {
    recommended.id = RECOMMENDED_PROGRESSION_ID;
    recommended.recommended = true;
    recommended.homebrew = false;
    recommended.builtIn = "recommended";
  }
  const homebrew = profiles.find(profile => profile.id === HAMMER_HOMEBREW_PROGRESSION_ID) ?? profiles.find(profile => profile.homebrew);
  if (homebrew) {
    homebrew.id = HAMMER_HOMEBREW_PROGRESSION_ID;
    homebrew.recommended = false;
    homebrew.homebrew = true;
    homebrew.builtIn = "homebrew";
  }
  return profiles;
}

export function syncActiveProgression(configuration) {
  configuration.progressionProfiles = arrayValue(configuration.progressionProfiles);
  let active = configuration.progressionProfiles.find(profile => profile.id === configuration.activeProgressionProfileId);
  if (!active) active = configuration.progressionProfiles[0];
  if (!active) {
    active = createRecommendedProgressionProfile();
    configuration.progressionProfiles = [active];
  }
  configuration.activeProgressionProfileId = active.id;
  configuration.levelBands = foundry.utils.deepClone(active.levelBands ?? DEFAULT_LEVEL_BANDS);
  configuration.enchantmentBands = foundry.utils.deepClone(active.enchantmentBands ?? DEFAULT_ENCHANTMENT_BANDS);
  configuration.priceFallbacks = foundry.utils.deepClone(active.priceFallbacks ?? DEFAULT_PRICE_FALLBACKS);
  configuration.qualityPriceAdditions = foundry.utils.deepClone(active.qualityPriceAdditions ?? DEFAULT_QUALITY_PRICE_ADDITIONS);
  return active;
}

function migrateConfiguration(stored) {
  const configuration = foundry.utils.mergeObject(createDefaultSettings(), stored ?? {}, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
    recursive: true
  });

  if (!stored?.folderNameTemplate && stored?.containerNameTemplate) configuration.folderNameTemplate = stored.containerNameTemplate;

  configuration.sources = arrayValue(Array.isArray(stored?.sources) ? stored.sources : configuration.sources);
  configuration.excludeMechanicalItems = stored?.excludeMechanicalItems !== false;
  configuration.useCorePricing = stored?.useCorePricing !== false;
  configuration.progressionProfiles = normalizeProgressionProfiles(stored, configuration);
  configuration.activeProgressionProfileId = String(
    stored?.activeProgressionProfileId
    ?? configuration.activeProgressionProfileId
    ?? configuration.progressionProfiles[0]?.id
    ?? RECOMMENDED_PROGRESSION_ID
  );

  const legacyGlobalBans = normalizeBannedItems(Array.isArray(stored?.bannedItems) ? stored.bannedItems : []);
  const storedProfiles = Array.isArray(stored?.profiles) ? stored.profiles : configuration.profiles;
  configuration.profiles = arrayValue(storedProfiles).map(profile => {
    const theme = inferTheme(profile);
    const customIcon = profile.customIcon || profile.icon || "fa-solid fa-store";
    const migratedProfile = {
      ...profile,
      theme,
      customIcon,
      icon: theme === "custom" ? customIcon : iconForTheme(theme, customIcon),
      sourceIds: arrayValue(profile.sourceIds),
      progressionProfileId: String(profile.progressionProfileId ?? "world"),
      homebrewTemplateId: String(profile.homebrewTemplateId ?? ""),
      homebrewAccessLevel: String(profile.homebrewAccessLevel ?? ""),
      allowedItemTypes: [],
      stockTotalMode: (() => {
        const mode = profile.stockTotalMode ?? "perPlayer";
        if (["players", "playersMultiplier", "halfDown", "halfUp"].includes(mode)) return "perPlayer";
        return mode === "fixed" ? "fixed" : "perPlayer";
      })(),
      stockTotal: (() => {
        const mode = profile.stockTotalMode ?? "perPlayer";
        const value = Number(profile.stockTotal ?? 1);
        if (mode === "players") return 1;
        if (["halfDown", "halfUp"].includes(mode)) return 0.5;
        if (Number(stored?.version ?? 0) < 4 && profile.id === "alpha-alchemist" && mode === "playersMultiplier" && value === 2) return 1;
        return value;
      })(),
      mundaneCatalogRules: arrayValue(profile.mundaneCatalogRules).map(migrateCatalogRule),
      guaranteedRules: arrayValue(profile.guaranteedRules).map(migrateGuaranteedRule),
      mechanicalItemOverrides: normalizeMechanicalOverrides(profile.mechanicalItemOverrides),
      bannedItems: (() => {
        const own = normalizeBannedItems(profile.bannedItems);
        if (!legacyGlobalBans.length) return own;
        const merged = [...own];
        const signatures = new Set(merged.map(item => item.allSources ? `key:${item.key}` : `uuid:${item.uuid}`));
        for (const item of legacyGlobalBans) {
          const migrated = { ...item, id: foundry.utils.randomID(), allSources: item.allSources !== false };
          const signature = migrated.allSources ? `key:${migrated.key}` : `uuid:${migrated.uuid}`;
          if (signatures.has(signature)) continue;
          merged.push(migrated);
          signatures.add(signature);
        }
        return merged;
      })(),
      randomRules: arrayValue(profile.randomRules).map(rule => migrateRandomRule(rule, theme))
    };
    return restoreHomebrewRuleCurations(migratedProfile);
  });

  const progressionIds = new Set((configuration.progressionProfiles ?? []).map(profile => profile.id));
  for (const profile of configuration.profiles ?? []) {
    if (profile.progressionProfileId !== "world" && !progressionIds.has(profile.progressionProfileId)) {
      profile.progressionProfileId = "world";
    }
  }

  delete configuration.bannedItems;
  configuration.version = CONFIGURATION_VERSION;
  syncActiveProgression(configuration);
  return configuration;
}

export function getConfiguration() {
  return migrateConfiguration(game.settings.get(MODULE_ID, SUPPLIER_CONFIGURATION_KEY) ?? {});
}

export async function saveConfiguration(configuration) {
  delete configuration.bannedItems;
  configuration.version = CONFIGURATION_VERSION;
  syncActiveProgression(configuration);
  return game.settings.set(MODULE_ID, SUPPLIER_CONFIGURATION_KEY, configuration);
}

export async function initializeDefaultSources() {
  if (!game.user?.isGM) return;
  const configuration = getConfiguration();
  const knownIds = new Set((configuration.sources ?? []).map(source => source.id));
  const officialPackages = new Set([
    "dnd5e",
    "dnd-players-handbook",
    "dnd-dungeon-masters-guide"
  ]);

  let changed = false;
  for (const pack of game.packs.filter(candidate => candidate.documentName === "Item")) {
    if (knownIds.has(pack.collection)) continue;
    configuration.sources.push({
      id: pack.collection,
      enabled: officialPackages.has(pack.metadata.packageName),
      priority: configuration.sources.length
    });
    changed = true;
  }

  if (!configuration.sources.length) return;
  configuration.sources.sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0));
  configuration.sources.forEach((source, index) => { source.priority = index; });

  const enabledIds = configuration.sources.filter(source => source.enabled).map(source => source.id);
  for (const profile of configuration.profiles) {
    if (profile.sourceIds?.length) continue;
    profile.sourceIds = [...enabledIds];
    changed = true;
  }

  if (changed || Number(game.settings.get(MODULE_ID, SUPPLIER_CONFIGURATION_KEY)?.version ?? 0) < CONFIGURATION_VERSION) {
    await saveConfiguration(configuration);
  }
}
