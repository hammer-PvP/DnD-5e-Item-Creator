import { MODULE_ID, MODULE_VERSION } from "../../constants.mjs";

export { MODULE_ID, MODULE_VERSION };
export const SUPPLIER_CONFIGURATION_KEY = "supplierConfiguration";
export const SUPPLIER_ENABLED_KEY = "supplierEnabled";
export const SUPPLIER_FEATURE_VERSION = "0.2.0b-integrated";
export const CONFIGURATION_VERSION = 16;

export const RARITIES = [
  { value: "none", label: "DND5E_SUPPLIER.Rarity.none" },
  { value: "common", label: "DND5E_SUPPLIER.Rarity.common" },
  { value: "uncommon", label: "DND5E_SUPPLIER.Rarity.uncommon" },
  { value: "rare", label: "DND5E_SUPPLIER.Rarity.rare" },
  { value: "veryRare", label: "DND5E_SUPPLIER.Rarity.veryRare" },
  { value: "legendary", label: "DND5E_SUPPLIER.Rarity.legendary" },
  { value: "artifact", label: "DND5E_SUPPLIER.Rarity.artifact" }
];

export const SUPPLIER_THEMES = [
  {
    id: "alchemist",
    label: "DND5E_SUPPLIER.Theme.Alchemist",
    icon: "fa-solid fa-flask",
    secondaryIcon: "",
    color: "green"
  },
  {
    id: "blacksmith",
    label: "DND5E_SUPPLIER.Theme.Blacksmith",
    icon: "fa-solid fa-hammer",
    secondaryIcon: "fa-solid fa-cube",
    color: "iron"
  },
  {
    id: "gunsmith",
    label: "DND5E_SUPPLIER.Theme.Gunsmith",
    icon: "fa-solid fa-gun",
    secondaryIcon: "fa-solid fa-gears",
    color: "gunmetal"
  },
  {
    id: "general",
    label: "DND5E_SUPPLIER.Theme.General",
    icon: "fa-solid fa-basket-shopping",
    secondaryIcon: "",
    color: "leather"
  },
  {
    id: "jeweler",
    label: "DND5E_SUPPLIER.Theme.Jeweler",
    icon: "fa-solid fa-ring",
    secondaryIcon: "fa-solid fa-gem",
    color: "gold"
  },
  {
    id: "magic",
    label: "DND5E_SUPPLIER.Theme.Magic",
    icon: "fa-solid fa-wand-magic-sparkles",
    secondaryIcon: "",
    color: "arcane"
  },
  {
    id: "stable",
    label: "DND5E_SUPPLIER.Theme.Stable",
    icon: "fa-solid fa-horse-head",
    secondaryIcon: "",
    color: "stable"
  },
  {
    id: "custom",
    label: "DND5E_SUPPLIER.Theme.Custom",
    icon: "fa-solid fa-store",
    secondaryIcon: "",
    color: "neutral"
  }
];

export const RULE_CATEGORIES = [
  { value: "weapon", label: "DND5E_SUPPLIER.Category.Weapons" },
  { value: "equipment", label: "DND5E_SUPPLIER.Category.Equipment" },
  { value: "consumable", label: "DND5E_SUPPLIER.Category.Consumables" },
  { value: "tool", label: "DND5E_SUPPLIER.Category.Tools" },
  { value: "loot", label: "DND5E_SUPPLIER.Category.Loot" },
  { value: "container", label: "DND5E_SUPPLIER.Category.Containers" },
  { value: "spellScroll", label: "DND5E_SUPPLIER.Category.SpellScrolls" },
  { value: "exact", label: "DND5E_SUPPLIER.Category.ExactItem" }
];

export const CATALOG_CATEGORIES = RULE_CATEGORIES.filter(category => [
  "weapon", "equipment", "consumable", "tool", "loot", "container"
].includes(category.value));

export const ARMOR_SUBTYPE_KEYS = ["lightArmor", "mediumArmor", "heavyArmor", "shield"];

export const DEFAULT_PRICE_FALLBACKS = {
  none: 1,
  common: 100,
  uncommon: 400,
  rare: 4000,
  veryRare: 40000,
  legendary: 200000,
  artifact: 0
};

export const DEFAULT_QUALITY_PRICE_ADDITIONS = {
  0: 0,
  1: 500,
  2: 5000,
  3: 50000
};

/**
 * Supplier recommendation profile. It uses D&D 2024 rarity concepts but the
 * merchant availability weights are module recommendations, not an official
 * merchant-stock rule.
 */
export const DEFAULT_LEVEL_BANDS = [
  { id: "band-1", min: 1, max: 4, rarities: ["none", "common"], maxSpellLevel: 2 },
  { id: "band-2", min: 5, max: 8, rarities: ["none", "common", "uncommon"], maxSpellLevel: 4 },
  { id: "band-3", min: 9, max: 12, rarities: ["none", "common", "uncommon", "rare"], maxSpellLevel: 6 },
  { id: "band-4", min: 13, max: 16, rarities: ["none", "common", "uncommon", "rare", "veryRare"], maxSpellLevel: 8 },
  { id: "band-5", min: 17, max: 20, rarities: ["none", "common", "uncommon", "rare", "veryRare", "legendary"], maxSpellLevel: 9 }
];

export const DEFAULT_ENCHANTMENT_BANDS = [
  { id: "quality-1", min: 1, max: 4, weights: { 0: 100, 1: 0, 2: 0, 3: 0 } },
  { id: "quality-2", min: 5, max: 8, weights: { 0: 70, 1: 30, 2: 0, 3: 0 } },
  { id: "quality-3", min: 9, max: 12, weights: { 0: 45, 1: 45, 2: 10, 3: 0 } },
  { id: "quality-4", min: 13, max: 16, weights: { 0: 20, 1: 45, 2: 30, 3: 5 } },
  { id: "quality-5", min: 17, max: 20, weights: { 0: 10, 1: 25, 2: 45, 3: 20 } }
];

export const RECOMMENDED_PROGRESSION_ID = "recommended-dnd2024";
export const HAMMER_HOMEBREW_PROGRESSION_ID = "hammer-homebrew";

export const HAMMER_HOMEBREW_LEVEL_RANGES = [
  { id: "hammer-range-1", min: 1, max: 2, rarities: ["none", "common"], maxSpellLevel: 1 },
  { id: "hammer-range-2", min: 3, max: 4, rarities: ["none", "common", "uncommon"], maxSpellLevel: 3 },
  { id: "hammer-range-3", min: 5, max: 7, rarities: ["none", "common", "uncommon", "rare"], maxSpellLevel: 4 },
  { id: "hammer-range-4", min: 8, max: 10, rarities: ["none", "common", "uncommon", "rare"], maxSpellLevel: 6 },
  { id: "hammer-range-5", min: 11, max: 13, rarities: ["none", "uncommon", "rare", "veryRare"], maxSpellLevel: 8 },
  { id: "hammer-range-6", min: 14, max: 16, rarities: ["none", "uncommon", "rare", "veryRare", "legendary"], maxSpellLevel: 9 },
  { id: "hammer-range-7", min: 17, max: 20, rarities: ["none", "rare", "veryRare", "legendary"], maxSpellLevel: 9 }
];

export const HAMMER_HOMEBREW_ENCHANTMENT_RANGES = [
  { id: "hammer-quality-1", min: 1, max: 3, weights: { 0: 100, 1: 0, 2: 0, 3: 0 } },
  { id: "hammer-quality-2", min: 4, max: 5, weights: { 0: 0, 1: 100, 2: 0, 3: 0 } },
  { id: "hammer-quality-3", min: 6, max: 6, weights: { 0: 0, 1: 95, 2: 5, 3: 0 } },
  { id: "hammer-quality-4", min: 7, max: 7, weights: { 0: 0, 1: 90, 2: 10, 3: 0 } },
  { id: "hammer-quality-5", min: 8, max: 8, weights: { 0: 0, 1: 20, 2: 80, 3: 0 } },
  { id: "hammer-quality-6", min: 9, max: 9, weights: { 0: 0, 1: 10, 2: 90, 3: 0 } },
  { id: "hammer-quality-7", min: 10, max: 10, weights: { 0: 0, 1: 0, 2: 100, 3: 0 } },
  { id: "hammer-quality-8", min: 11, max: 11, weights: { 0: 0, 1: 0, 2: 90, 3: 10 } },
  { id: "hammer-quality-9", min: 12, max: 12, weights: { 0: 0, 1: 0, 2: 30, 3: 70 } },
  { id: "hammer-quality-10", min: 13, max: 13, weights: { 0: 0, 1: 0, 2: 20, 3: 80 } },
  { id: "hammer-quality-11", min: 14, max: 14, weights: { 0: 0, 1: 0, 2: 10, 3: 90 } },
  { id: "hammer-quality-12", min: 15, max: 20, weights: { 0: 0, 1: 0, 2: 5, 3: 95 } }
];

export const HAMMER_HOMEBREW_PRICE_FALLBACKS = {
  none: 1,
  common: 100,
  uncommon: 400,
  rare: 4000,
  veryRare: 40000,
  legendary: 200000,
  artifact: 200000
};

export const HAMMER_HOMEBREW_QUALITY_PRICE_ADDITIONS = {
  0: 0,
  1: 300,
  2: 2500,
  3: 5500
};

export function createRecommendedProgressionProfile({ id = RECOMMENDED_PROGRESSION_ID, name = "Supplier — Official D&D 2024" } = {}) {
  return {
    id,
    name,
    recommended: true,
    official: true,
    useCorePricing: true,
    builtIn: "recommended",
    levelBands: foundry.utils.deepClone(DEFAULT_LEVEL_BANDS),
    enchantmentBands: foundry.utils.deepClone(DEFAULT_ENCHANTMENT_BANDS),
    priceFallbacks: foundry.utils.deepClone(DEFAULT_PRICE_FALLBACKS),
    qualityPriceAdditions: foundry.utils.deepClone(DEFAULT_QUALITY_PRICE_ADDITIONS)
  };
}

export function createHammerHomebrewProgressionProfile({ id = HAMMER_HOMEBREW_PROGRESSION_ID, name = "Supplier — HAMMER Homebrew" } = {}) {
  return {
    id,
    name,
    recommended: false,
    homebrew: true,
    official: false,
    useCorePricing: false,
    builtIn: "homebrew",
    levelBands: foundry.utils.deepClone(HAMMER_HOMEBREW_LEVEL_RANGES),
    enchantmentBands: foundry.utils.deepClone(HAMMER_HOMEBREW_ENCHANTMENT_RANGES),
    priceFallbacks: foundry.utils.deepClone(HAMMER_HOMEBREW_PRICE_FALLBACKS),
    qualityPriceAdditions: foundry.utils.deepClone(HAMMER_HOMEBREW_QUALITY_PRICE_ADDITIONS)
  };
}

export function createCustomProgressionProfile(source = null, name = "Custom Progression") {
  const base = source ?? createRecommendedProgressionProfile();
  return {
    id: foundry.utils.randomID(),
    name,
    recommended: false,
    official: false,
    homebrew: false,
    useCorePricing: base.useCorePricing !== false,
    builtIn: "",
    levelBands: foundry.utils.deepClone(base.levelBands ?? DEFAULT_LEVEL_BANDS),
    enchantmentBands: foundry.utils.deepClone(base.enchantmentBands ?? DEFAULT_ENCHANTMENT_BANDS),
    priceFallbacks: foundry.utils.deepClone(base.priceFallbacks ?? DEFAULT_PRICE_FALLBACKS),
    qualityPriceAdditions: foundry.utils.deepClone(base.qualityPriceAdditions ?? DEFAULT_QUALITY_PRICE_ADDITIONS)
  };
}

function baseRule() {
  return {
    id: foundry.utils.randomID(),
    enabled: true,
    name: "",
    category: "",
    itemRef: "",
    itemLabel: "",
    itemRefs: [],
    subtypes: [],
    subtypeCategory: "",
    weaponCategories: [],
    weaponModes: [],
    armorCategories: [],
    magicalState: "any",
    spellLevelMode: "level",
    spellLevels: [0, 1],
    qualityMode: "source",
    fixedBonus: 1,
    enchantedMinimumMode: "none",
    enchantedMinimum: 0,
    quantityMode: "fixed",
    quantity: 1,
    quantityMin: 1,
    quantityMax: 1,
    randomWeight: 1,
    coverageMode: "slots",
    allowDuplicates: true,
    countsTowardTotal: false,
    excludeRefs: [],
    excludeFamilies: [],
    includeFamilies: [],
    poolExclusions: [],
    materializerExclusions: [],
    chance: 100,
    minimumVendorAccess: 0,
    maximumVendorAccess: 0,
    maxPerFamily: 0,
    rarityDistribution: "",
    selectionDistribution: "",
    silentIfEmpty: false,
    requireMagicalResult: false
  };
}

export function createDefaultCatalogRule() {
  return {
    ...baseRule(),
    name: "Mundane Catalog",
    category: "",
    quantityMode: "players",
    quantity: 1,
    magicalState: "mundane",
    qualityMode: "mundane",
    coverageMode: "all",
    allowDuplicates: false,
    countsTowardTotal: false
  };
}

export function createDefaultGuaranteedRule() {
  return {
    ...baseRule(),
    name: "Guaranteed Item",
    quantityMode: "fixed",
    quantity: 1,
    coverageMode: "slots",
    countsTowardTotal: false
  };
}

export function createDefaultRandomRule() {
  return {
    ...baseRule(),
    name: "Random Stock",
    quantityMode: "remainder",
    quantity: 1,
    randomWeight: 1,
    coverageMode: "slots",
    countsTowardTotal: false
  };
}

export const DEFAULT_PROFILE = {
  id: "alpha-alchemist",
  name: "Alchemist",
  theme: "alchemist",
  icon: "fa-solid fa-flask",
  customIcon: "fa-solid fa-store",
  description: "Potions, elixirs, oils, poisons, and other alchemical consumables.",
  sourceIds: [],
  progressionProfileId: "world",
  homebrewTemplateId: "",
  homebrewAccessLevel: "2",
  allowedItemTypes: [],
  stockTotalMode: "perPlayer",
  stockTotal: 1,
  mundaneCatalogRules: [],
  guaranteedRules: [
    {
      ...createDefaultGuaranteedRule(),
      id: "alpha-healing-potion",
      name: "Healing Potions",
      category: "consumable",
      subtypes: ["potion"],
      subtypeCategory: "consumable",
      includeFamilies: ["healingPotions"],
      quantityMode: "players",
      quantity: 1,
      qualityMode: "source",
      allowDuplicates: true
    }
  ],
  bannedItems: [],
  mechanicalItemOverrides: [],
  randomRules: [
    {
      ...createDefaultRandomRule(),
      id: "alpha-random-potions",
      name: "Random Alchemical Stock",
      category: "consumable",
      subtypes: ["potion"],
      subtypeCategory: "consumable",
      quantityMode: "remainder",
      excludeFamilies: ["healingPotions"]
    }
  ]
};

export function createDefaultSettings() {
  const recommended = createRecommendedProgressionProfile();
  const homebrew = createHammerHomebrewProgressionProfile();
  return {
    version: CONFIGURATION_VERSION,
    sources: [],
    progressionProfiles: [recommended, homebrew],
    excludeMechanicalItems: true,
    useCorePricing: true,
    activeProgressionProfileId: recommended.id,
    // Compatibility aliases are synchronized from the active profile.
    priceFallbacks: foundry.utils.deepClone(recommended.priceFallbacks),
    qualityPriceAdditions: foundry.utils.deepClone(recommended.qualityPriceAdditions),
    levelBands: foundry.utils.deepClone(recommended.levelBands),
    enchantmentBands: foundry.utils.deepClone(recommended.enchantmentBands),
    profiles: [foundry.utils.deepClone(DEFAULT_PROFILE)],
    folderNameTemplate: "{supplier} — {date} — {time}"
  };
}
