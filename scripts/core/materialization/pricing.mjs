import { MODULE_ID } from "../../constants.mjs";

export const MATERIALIZATION_SETTINGS_KEY = "materializationSettings";
export const MATERIALIZATION_CORE_VERSION = "0.3.1";
export const MATERIALIZATION_PRICING_SCHEMA_VERSION = 1;

export const OFFICIAL_RARITY_PRICES = Object.freeze({
  none: 0,
  common: 100,
  uncommon: 400,
  rare: 4000,
  veryRare: 40000,
  legendary: 200000,
  artifact: 0
});

function clone(value) {
  return foundry.utils.deepClone(value);
}

export function normalizeRarityKey(value) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!normalized) return "none";
  if (normalized === "veryrare") return "veryRare";
  return ["none", "common", "uncommon", "rare", "legendary", "artifact"].includes(normalized)
    ? normalized
    : "none";
}

export function defaultMaterializationSettings() {
  return {
    version: MATERIALIZATION_PRICING_SCHEMA_VERSION,
    coreVersion: MATERIALIZATION_CORE_VERSION,
    pricingProfile: "official",
    denomination: "gp",
    officialPrices: clone(OFFICIAL_RARITY_PRICES),
    customPrices: clone(OFFICIAL_RARITY_PRICES)
  };
}

export function registerMaterializationSettings() {
  game.settings.register(MODULE_ID, MATERIALIZATION_SETTINGS_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultMaterializationSettings()
  });
}

export function normalizeMaterializationSettings(stored = null) {
  const defaults = defaultMaterializationSettings();
  const output = foundry.utils.mergeObject(defaults, stored ?? {}, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
    recursive: true
  });
  output.version = MATERIALIZATION_PRICING_SCHEMA_VERSION;
  output.coreVersion = MATERIALIZATION_CORE_VERSION;
  output.pricingProfile = output.pricingProfile === "custom" ? "custom" : "official";
  output.denomination = String(output.denomination || "gp");
  for (const key of Object.keys(OFFICIAL_RARITY_PRICES)) {
    output.officialPrices[key] = Number(OFFICIAL_RARITY_PRICES[key]);
    output.customPrices[key] = Math.max(0, Number(output.customPrices?.[key] ?? OFFICIAL_RARITY_PRICES[key]) || 0);
  }
  return output;
}

export function getMaterializationSettings() {
  return normalizeMaterializationSettings(game.settings.get(MODULE_ID, MATERIALIZATION_SETTINGS_KEY));
}

export async function saveMaterializationSettings(settings) {
  return game.settings.set(MODULE_ID, MATERIALIZATION_SETTINGS_KEY, normalizeMaterializationSettings(settings));
}

export function activeRarityPrices(settings = getMaterializationSettings()) {
  return clone(settings.pricingProfile === "custom" ? settings.customPrices : settings.officialPrices);
}

export function priceForRarity(rarity, settings = getMaterializationSettings()) {
  const key = normalizeRarityKey(rarity);
  const prices = settings.pricingProfile === "custom" ? settings.customPrices : settings.officialPrices;
  return {
    rarity: key,
    value: Math.max(0, Number(prices?.[key] ?? 0) || 0),
    denomination: settings.pricingProfile === "official" ? "gp" : String(settings.denomination || "gp"),
    priceless: key === "artifact",
    profile: settings.pricingProfile
  };
}

export function applyRarityPrice(itemData, {
  force = false,
  preserveExisting = true,
  settings = getMaterializationSettings(),
  origin = "rarity-profile"
} = {}) {
  if (!itemData?.system) return { applied: false, reason: "missingSystem" };
  const rarity = normalizeRarityKey(itemData.system.rarity);
  if (["none", "artifact"].includes(rarity)) {
    if (rarity === "artifact" && force) {
      const denomination = settings.pricingProfile === "official" ? "gp" : (settings.denomination || "gp");
      itemData.system.price = { value: 0, denomination };
      return { applied: true, priceless: true, rarity, value: 0, denomination, origin };
    }
    return { applied: false, reason: rarity === "artifact" ? "priceless" : "mundane", rarity };
  }

  const existing = Math.max(0, Number(itemData.system.price?.value ?? 0) || 0);
  if (!force && preserveExisting && existing > 0) return { applied: false, reason: "existingPrice", rarity, value: existing };

  const resolved = priceForRarity(rarity, settings);
  itemData.system.price = {
    value: resolved.value,
    denomination: resolved.denomination
  };
  return { applied: true, ...resolved, origin };
}
