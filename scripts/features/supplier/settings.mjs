import {
  CONFIGURATION_VERSION,
  DEFAULT_ENCHANTMENT_BANDS,
  DEFAULT_LEVEL_BANDS,
  DEFAULT_PRICE_FALLBACKS,
  DEFAULT_QUALITY_PRICE_ADDITIONS,
  HAMMER_HOMEBREW_PROGRESSION_ID,
  MODULE_ID,
  RECOMMENDED_PROGRESSION_ID,
  SUPPLIER_CONFIGURATION_KEY,
  SUPPLIER_ENABLED_KEY,
  createDefaultSettings,
  createHammerHomebrewProgressionProfile,
  createRecommendedProgressionProfile
} from "./constants.mjs";
import { createSupplierProfileV2, normalizeSupplierProfileV2 } from "./profile-v2.mjs";

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

function normalizeProgressionProfile(profile, fallback = null) {
  const base = fallback ?? createRecommendedProgressionProfile();
  return {
    id: String(profile?.id ?? foundry.utils.randomID()),
    name: String(profile?.name ?? "Custom Progression"),
    recommended: profile?.recommended === true,
    official: profile?.official === true,
    homebrew: profile?.homebrew === true,
    useCorePricing: profile?.useCorePricing !== false,
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
    const baseline = createRecommendedProgressionProfile();
    recommended.id = RECOMMENDED_PROGRESSION_ID;
    recommended.name = baseline.name;
    recommended.recommended = true;
    recommended.homebrew = false;
    recommended.official = true;
    recommended.useCorePricing = true;
    recommended.builtIn = "recommended";
    recommended.levelBands = foundry.utils.deepClone(baseline.levelBands);
    recommended.enchantmentBands = foundry.utils.deepClone(baseline.enchantmentBands);
    recommended.priceFallbacks = foundry.utils.deepClone(baseline.priceFallbacks);
    recommended.qualityPriceAdditions = foundry.utils.deepClone(baseline.qualityPriceAdditions);
  }
  const homebrew = profiles.find(profile => profile.id === HAMMER_HOMEBREW_PROGRESSION_ID) ?? profiles.find(profile => profile.homebrew);
  if (homebrew) {
    const baseline = createHammerHomebrewProgressionProfile();
    homebrew.id = HAMMER_HOMEBREW_PROGRESSION_ID;
    homebrew.name = baseline.name;
    homebrew.recommended = false;
    homebrew.homebrew = true;
    homebrew.official = false;
    homebrew.useCorePricing = false;
    homebrew.builtIn = "homebrew";
    homebrew.levelBands = foundry.utils.deepClone(baseline.levelBands);
    homebrew.enchantmentBands = foundry.utils.deepClone(baseline.enchantmentBands);
    homebrew.priceFallbacks = foundry.utils.deepClone(baseline.priceFallbacks);
    homebrew.qualityPriceAdditions = foundry.utils.deepClone(baseline.qualityPriceAdditions);
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
  const defaults = createDefaultSettings();
  const configuration = foundry.utils.mergeObject(defaults, stored ?? {}, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
    recursive: true
  });

  if (!stored?.folderNameTemplate && stored?.containerNameTemplate) configuration.folderNameTemplate = stored.containerNameTemplate;
  configuration.sources = arrayValue(Array.isArray(stored?.sources) ? stored.sources : configuration.sources)
    .map((source, index) => ({
      id: String(source?.id ?? ""),
      enabled: source?.enabled === true,
      priority: Number.isFinite(Number(source?.priority)) ? Number(source.priority) : index
    }))
    .filter(source => source.id)
    .sort((a, b) => a.priority - b.priority);
  configuration.sources.forEach((source, index) => { source.priority = index; });

  configuration.excludeMechanicalItems = stored?.excludeMechanicalItems !== false;
  configuration.useCorePricing = stored?.useCorePricing !== false;
  configuration.progressionProfiles = normalizeProgressionProfiles(stored, configuration);
  configuration.activeProgressionProfileId = String(
    stored?.activeProgressionProfileId
    ?? configuration.activeProgressionProfileId
    ?? configuration.progressionProfiles[0]?.id
    ?? RECOMMENDED_PROGRESSION_ID
  );

  const isProfileV2Configuration = Number(stored?.version ?? 0) >= 23;
  if (isProfileV2Configuration) {
    configuration.profiles = arrayValue(stored?.profiles).map(normalizeSupplierProfileV2);
  } else {
    // v0.7.3 intentionally starts Supplier Profiles clean. The profile model was
    // redesigned from the ground up and legacy Homebrew/Profile curations are
    // deliberately not migrated. Sources and Level/Quality/Price settings are
    // preserved because they are independent subsystems.
    const enabledSourceIds = configuration.sources.filter(source => source.enabled).map(source => source.id);
    configuration.profiles = [createSupplierProfileV2({
      name: game?.i18n?.localize?.("DND5E_SUPPLIER.Config.NewProfile") ?? "New Supplier",
      sourceIds: enabledSourceIds,
      normalizeFirearms: true
    })];
  }

  if (!configuration.profiles.length) {
    configuration.profiles.push(createSupplierProfileV2({
      name: game?.i18n?.localize?.("DND5E_SUPPLIER.Config.NewProfile") ?? "New Supplier",
      sourceIds: configuration.sources.filter(source => source.enabled).map(source => source.id),
      normalizeFirearms: true
    }));
  }

  const progressionIds = new Set((configuration.progressionProfiles ?? []).map(profile => profile.id));
  for (const profile of configuration.profiles) {
    if (profile.progressionProfileId !== "world" && !progressionIds.has(profile.progressionProfileId)) profile.progressionProfileId = "world";
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
  configuration.profiles = arrayValue(configuration.profiles).map(normalizeSupplierProfileV2);
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
    if (profile.sourceSnapshot === true || profile.sourceIds?.length) continue;
    profile.sourceIds = [...enabledIds];
    changed = true;
  }

  if (changed || Number(game.settings.get(MODULE_ID, SUPPLIER_CONFIGURATION_KEY)?.version ?? 0) < CONFIGURATION_VERSION) {
    await saveConfiguration(configuration);
  }
}
