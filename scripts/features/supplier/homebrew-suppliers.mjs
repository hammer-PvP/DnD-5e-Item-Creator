import {
  HAMMER_HOMEBREW_PROGRESSION_ID,
  createDefaultCatalogRule,
  createDefaultGuaranteedRule,
  createDefaultRandomRule
} from "./constants.mjs";
import {
  canonicalKey,
  entriesForProfile,
  isAmmunitionEntry,
  isFirearmAmmunition,
  isFirearmEntry,
  isFirearmRelated,
  isFirearmSupply,
  isGeneratorItem,
  isMaterializerItem,
  isMechanicalItem,
  isSupportedMaterializerEntry,
  normalizeText
} from "./catalog.mjs";
import { restoreHomebrewRuleCurations } from "./homebrew-curation.mjs";
import { minimumVendorAccess } from "./availability.mjs";

export const HOMEBREW_ACCESS_LEVELS = ["1", "2", "3", "4"];

export const HOMEBREW_SUPPLIER_TEMPLATES = [
  {
    id: "blacksmith",
    label: "DND5E_SUPPLIER.Homebrew.Blacksmith",
    description: "DND5E_SUPPLIER.Homebrew.BlacksmithHint",
    icon: "fa-solid fa-hammer",
    secondaryIcon: "fa-solid fa-cube",
    theme: "blacksmith"
  },
  {
    id: "gunsmith",
    label: "DND5E_SUPPLIER.Homebrew.Gunsmith",
    description: "DND5E_SUPPLIER.Homebrew.GunsmithHint",
    icon: "fa-solid fa-gun",
    secondaryIcon: "fa-solid fa-gears",
    theme: "gunsmith"
  },
  {
    id: "alchemist",
    label: "DND5E_SUPPLIER.Homebrew.Alchemist",
    description: "DND5E_SUPPLIER.Homebrew.AlchemistHint",
    icon: "fa-solid fa-flask",
    secondaryIcon: "",
    theme: "alchemist"
  },
  {
    id: "magic",
    label: "DND5E_SUPPLIER.Homebrew.MagicAssortment",
    description: "DND5E_SUPPLIER.Homebrew.MagicAssortmentHint",
    icon: "fa-solid fa-wand-magic-sparkles",
    secondaryIcon: "",
    theme: "magic"
  },
  {
    id: "general",
    label: "DND5E_SUPPLIER.Homebrew.GeneralTrade",
    description: "DND5E_SUPPLIER.Homebrew.GeneralTradeHint",
    icon: "fa-solid fa-basket-shopping",
    secondaryIcon: "",
    theme: "general"
  },
  {
    id: "stable",
    label: "DND5E_SUPPLIER.Homebrew.StableLivestock",
    description: "DND5E_SUPPLIER.Homebrew.StableLivestockHint",
    icon: "fa-solid fa-horse-head",
    secondaryIcon: "",
    theme: "stable"
  }
];

function catalogRule({
  name,
  category,
  subtypes = [],
  quantityMode = "fixed",
  quantity = 1,
  curation = "",
  generatorResultCuration = "",
  chance = 100,
  minimumVendorAccess = 0,
  maximumVendorAccess = 0,
  maxPerFamily = 0,
  rarityDistribution = "",
  selectionDistribution = "",
  silentIfEmpty = false,
  requireMagicalResult = false
}) {
  return {
    ...createDefaultCatalogRule(),
    id: foundry.utils.randomID(),
    name,
    category,
    subtypes,
    subtypeCategory: category,
    quantityMode,
    quantity,
    homebrewCuration: curation,
    generatorResultCuration,
    chance,
    minimumVendorAccess,
    maximumVendorAccess,
    maxPerFamily,
    rarityDistribution,
    selectionDistribution,
    silentIfEmpty,
    requireMagicalResult
  };
}

function guaranteedRule({
  name,
  category,
  subtypes = [],
  quantityMode = "fixed",
  quantity = 1,
  qualityMode = "source",
  magicalState = "any",
  includeFamilies = [],
  allowDuplicates = true,
  curation = "",
  generatorResultCuration = "",
  chance = 100,
  minimumVendorAccess = 0,
  maximumVendorAccess = 0,
  maxPerFamily = 0,
  rarityDistribution = "",
  selectionDistribution = "",
  silentIfEmpty = false,
  requireMagicalResult = false
}) {
  return {
    ...createDefaultGuaranteedRule(),
    id: foundry.utils.randomID(),
    name,
    category,
    subtypes,
    subtypeCategory: category,
    quantityMode,
    quantity,
    qualityMode,
    magicalState,
    includeFamilies,
    allowDuplicates,
    homebrewCuration: curation,
    generatorResultCuration,
    chance,
    minimumVendorAccess,
    maximumVendorAccess,
    maxPerFamily,
    rarityDistribution,
    selectionDistribution,
    silentIfEmpty,
    requireMagicalResult
  };
}

function randomRule({
  name,
  category,
  subtypes = [],
  weight = 1,
  qualityMode = "source",
  magicalState = "any",
  allowDuplicates = true,
  curation = "",
  generatorResultCuration = "",
  chance = 100,
  minimumVendorAccess = 0,
  maximumVendorAccess = 0,
  maxPerFamily = 0,
  rarityDistribution = "",
  selectionDistribution = "",
  silentIfEmpty = false,
  requireMagicalResult = false
}) {
  return {
    ...createDefaultRandomRule(),
    id: foundry.utils.randomID(),
    name,
    category,
    subtypes,
    subtypeCategory: category,
    randomWeight: weight,
    qualityMode,
    magicalState,
    allowDuplicates,
    homebrewCuration: curation,
    generatorResultCuration,
    chance,
    minimumVendorAccess,
    maximumVendorAccess,
    maxPerFamily,
    rarityDistribution,
    selectionDistribution,
    silentIfEmpty,
    requireMagicalResult
  };
}

function blankProfile({ name, theme, sourceIds, templateId = "", accessLevel = "2" }) {
  const themeIcons = {
    blacksmith: "fa-solid fa-hammer",
    gunsmith: "fa-solid fa-gun",
    alchemist: "fa-solid fa-flask",
    magic: "fa-solid fa-wand-magic-sparkles",
    general: "fa-solid fa-basket-shopping",
    stable: "fa-solid fa-horse-head",
    custom: "fa-solid fa-store"
  };
  return {
    id: foundry.utils.randomID(),
    name,
    theme,
    icon: themeIcons[theme] ?? "fa-solid fa-store",
    customIcon: "fa-solid fa-store",
    description: "",
    sourceIds: [...sourceIds],
    sourceSnapshot: true,
    progressionProfileId: templateId ? HAMMER_HOMEBREW_PROGRESSION_ID : "world",
    homebrewTemplateId: templateId,
    homebrewAccessLevel: accessLevel,
    allowedItemTypes: [],
    stockTotalMode: "fixed",
    stockTotal: 0,
    stockScaleBase: 4,
    homebrewPresetVersion: 5,
    mundaneCatalogRules: [],
    guaranteedRules: [],
    bannedItems: [],
    mechanicalItemOverrides: [],
    randomRules: []
  };
}

function accessNumber(accessLevel) {
  return Math.min(4, Math.max(1, Number(accessLevel ?? 2)));
}

function createBlacksmith(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.BlacksmithDescription");
  profile.stockTotalMode = "partyScaled";
  profile.stockScaleBase = 4;
  // These are magical slots only. The mundane shop floor is deterministic and
  // is added separately at one unit per party member for every eligible Item.
  profile.stockTotal = [1, 3, 5, 7][access - 1];
  profile.mundaneCatalogRules = [
    catalogRule({ name: "Mundane Weapons", category: "weapon", quantityMode: "players", quantity: 1, curation: "blacksmithBase" }),
    catalogRule({ name: "Mundane Armor & Shields", category: "equipment", subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], quantityMode: "players", quantity: 1, curation: "blacksmithBase" }),
    catalogRule({ name: "Mundane Smithing Wearables", category: "equipment", subtypes: ["clothing", "trinket", "wondrous"], quantityMode: "players", quantity: 1, curation: "blacksmithMundaneWearables", silentIfEmpty: true }),
    catalogRule({ name: "Mundane Ammunition", category: "consumable", subtypes: ["ammunition"], quantityMode: "players", quantity: 1, curation: "blacksmithAmmunition", silentIfEmpty: true })
  ];
  profile.guaranteedRules = [
    guaranteedRule({
      name: "Enchanted Ammunition (50% Availability)",
      category: "consumable",
      subtypes: ["ammunition"],
      quantityMode: "fixed",
      quantity: 1,
      qualityMode: "party",
      magicalState: "mundane",
      allowDuplicates: false,
      curation: "blacksmithAmmunition",
      chance: 50,
      maxPerFamily: 1,
      selectionDistribution: "ammunitionFamily",
      silentIfEmpty: true,
      requireMagicalResult: true
    })
  ];

  const enhancedWeight = [5.5, 4.5, 3.25, 2.25][access - 1];
  const namedWeaponWeight = [0.10, 0.75, 2.75, 4.5][access - 1];
  const namedArmorWeight = [0.08, 0.70, 3.1, 4.8][access - 1];
  const wearableWeight = [0.05, 0.35, 1.15, 2.1][access - 1];

  profile.randomRules = [
    randomRule({ name: "Enhanced Weapons", category: "weapon", weight: enhancedWeight, qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase", maxPerFamily: 1, silentIfEmpty: true, requireMagicalResult: true }),
    randomRule({ name: "Enhanced Armor", category: "equipment", subtypes: ["lightArmor", "mediumArmor", "heavyArmor"], weight: Math.max(1, enhancedWeight * 0.72), qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase", maxPerFamily: 1, silentIfEmpty: true, requireMagicalResult: true }),
    randomRule({ name: "Enhanced Shields", category: "equipment", subtypes: ["shield"], weight: Math.max(0.35, enhancedWeight * 0.18), qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase", maxPerFamily: 1, silentIfEmpty: true, requireMagicalResult: true }),
    randomRule({ name: "Named Magic Weapons", category: "weapon", subtypes: ["simpleM", "simpleR", "martialM", "martialR"], weight: namedWeaponWeight, qualityMode: "source", magicalState: "magical", allowDuplicates: false, curation: "blacksmithNamed", maxPerFamily: 1, silentIfEmpty: true }),
    randomRule({ name: "Materialized Magic Armor", category: "equipment", subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], weight: Math.max(0.12, namedArmorWeight * 0.9), qualityMode: "source", magicalState: "magical", allowDuplicates: false, curation: "blacksmithMaterializedArmor", generatorResultCuration: "blacksmithBase", maxPerFamily: 1, silentIfEmpty: true }),
    randomRule({ name: "Named Magic Armor", category: "equipment", subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], weight: namedArmorWeight, qualityMode: "source", magicalState: "magical", allowDuplicates: false, curation: "blacksmithNamedArmor", maxPerFamily: 1, silentIfEmpty: true }),
    randomRule({ name: "Physical Wondrous Gear", category: "equipment", subtypes: ["clothing", "trinket", "wondrous"], weight: wearableWeight, qualityMode: "source", magicalState: "magical", allowDuplicates: false, curation: "blacksmithWearables", maxPerFamily: 1, silentIfEmpty: true })
  ];
}

function createGunsmith(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.GunsmithDescription");
  profile.stockTotalMode = "perPlayer";
  profile.stockTotal = [0.75, 1.25, 2, 2.75][access - 1];
  profile.mundaneCatalogRules = [
    catalogRule({ name: "Firearms", category: "weapon", quantityMode: "players", quantity: 1, curation: "firearmWeapons" }),
    catalogRule({ name: "Firearm Ammunition", category: "consumable", subtypes: ["ammunition"], quantityMode: "players", quantity: 1, curation: "firearmAmmunition" }),
    catalogRule({ name: "Powder & Gunsmith Supplies", category: "loot", quantityMode: "players", quantity: 1, curation: "firearmSupplies" })
  ];
  profile.guaranteedRules = [
    guaranteedRule({
      name: "Firearm",
      category: "weapon",
      quantityMode: "fixed",
      quantity: access >= 3 ? 2 : 1,
      qualityMode: "party",
      magicalState: "mundane",
      allowDuplicates: false,
      curation: "firearmWeapons"
    })
  ];
  profile.randomRules = [
    randomRule({ name: "Firearms", category: "weapon", weight: 3, qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "firearmWeapons" }),
    randomRule({ name: "Firearm Ammunition", category: "consumable", subtypes: ["ammunition"], weight: 2, qualityMode: "party", magicalState: "mundane", allowDuplicates: true, curation: "firearmAmmunition" }),
    randomRule({ name: "Powder & Gunsmith Supplies", category: "loot", weight: 1, qualityMode: "source", magicalState: "mundane", allowDuplicates: true, curation: "firearmSupplies" })
  ];
  if (access >= 2) {
    profile.randomRules.push(randomRule({
      name: "Named Magic Firearms",
      category: "weapon",
      weight: access === 2 ? 0.25 : 0.75,
      qualityMode: "source",
      magicalState: "magical",
      allowDuplicates: false,
      curation: "namedFirearms"
    }));
  }
}

function createAlchemist(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.AlchemistDescription");
  profile.stockTotalMode = "partyScaled";
  profile.stockScaleBase = 4;
  profile.stockTotal = [5, 8, 10, 12][access - 1];
  profile.mundaneCatalogRules = [
    catalogRule({ name: "Healer, Herbalism & Alchemy Kits", category: "tool", quantityMode: "players", quantity: 1, curation: "alchemistMundaneTools", silentIfEmpty: true }),
    catalogRule({ name: "Mundane Remedies & Reagents", category: "consumable", quantityMode: "players", quantity: 1, curation: "alchemistMundaneConsumables", silentIfEmpty: true }),
    catalogRule({ name: "Vials, Bottles & Containers", category: "container", quantityMode: "players", quantity: 1, curation: "alchemistMundaneContainers", silentIfEmpty: true }),
    catalogRule({ name: "Herbalist Field Supplies", category: "loot", quantityMode: "players", quantity: 1, curation: "alchemistMundaneSupplies", silentIfEmpty: true })
  ];
  profile.guaranteedRules = [
    guaranteedRule({
      name: "Healing Potions",
      category: "consumable",
      subtypes: ["potion"],
      quantityMode: "players",
      quantity: 1,
      includeFamilies: ["healingPotions"],
      allowDuplicates: true,
      curation: "alchemicalConsumables",
      selectionDistribution: "hammerHealingPotions",
      maxPerFamily: 0
    })
  ];
  profile.randomRules = [
    randomRule({
      name: "Potions, Elixirs & Poisons",
      category: "consumable",
      subtypes: ["potion", "poison", "trinket", "wondrous", "gear"],
      weight: 4,
      allowDuplicates: true,
      curation: "alchemicalConsumables",
      rarityDistribution: "hammerAlchemistExtras",
      maxPerFamily: Math.max(2, Math.ceil(access / 2))
    }),
    randomRule({
      name: "Oils, Powders & Preparations",
      category: "consumable",
      subtypes: ["trinket", "wondrous", "gear"],
      weight: access >= 3 ? 2 : 1,
      allowDuplicates: false,
      curation: "alchemicalPreparations",
      rarityDistribution: "hammerAlchemistExtras",
      minimumVendorAccess: 2,
      maxPerFamily: 1,
      silentIfEmpty: true
    })
  ];
  if (access === 1) profile.randomRules = profile.randomRules.filter(rule => Number(rule.minimumVendorAccess ?? 0) <= 1);
}

function createMagicAssortment(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.MagicAssortmentDescription");
  profile.stockTotalMode = "levelPartyScaled";
  profile.stockScaleBase = 4;
  profile.stockBands = [
    { min: 1, max: 2, total: 2, scrolls: 0 },
    { min: 3, max: 7, total: 8, scrolls: 5 },
    { min: 8, max: 11, total: 12, scrolls: 7 },
    { min: 12, max: 20, total: 16, scrolls: 8 }
  ];
  profile.stockTotal = 0;
  profile.mundaneCatalogRules = [
    catalogRule({ name: "Arcane Foci & Component Supplies", category: "equipment", quantityMode: "players", quantity: 1, curation: "magicMundaneSupplies", silentIfEmpty: true }),
    catalogRule({ name: "Mundane Arcane Clothing & Accessories", category: "equipment", subtypes: ["clothing", "trinket", "wondrous"], quantityMode: "players", quantity: 1, curation: "magicMundaneWearables", silentIfEmpty: true }),
    catalogRule({ name: "Arcane Tools & Scribing Kits", category: "tool", quantityMode: "players", quantity: 1, curation: "magicMundaneSupplies", silentIfEmpty: true }),
    catalogRule({ name: "Scroll Cases, Ink & Components", category: "loot", quantityMode: "players", quantity: 1, curation: "magicMundaneSupplies", silentIfEmpty: true }),
    catalogRule({ name: "Arcane Containers", category: "container", quantityMode: "players", quantity: 1, curation: "magicMundaneSupplies", silentIfEmpty: true })
  ];
  profile.guaranteedRules = [
    guaranteedRule({
      name: "Spell Scrolls",
      category: "spellScroll",
      quantityMode: "levelPartyScaledScrolls",
      quantity: 0,
      allowDuplicates: true,
      curation: "excludeCantrips",
      maxPerFamily: 2
    })
  ];

  const relicWeight = [0, 0.08, 0.45, 2.0][access - 1];
  const armoryCurioWeight = [0.01, 0.04, 0.15, 0.38][access - 1];
  profile.randomRules = [
    randomRule({ name: "Arcane Equipment & Wondrous Items", category: "equipment", subtypes: ["ring", "trinket", "clothing", "wand", "rod", "wondrous"], weight: 4, magicalState: "magical", allowDuplicates: false, curation: "magicAssortment", maxPerFamily: 1 }),
    randomRule({ name: "Magical Wands, Staves, Rods & Foci", category: "equipment", subtypes: ["wand", "rod", "trinket", "wondrous"], weight: 1.6, magicalState: "magical", allowDuplicates: false, curation: "magicArcaneImplements", maxPerFamily: 1, silentIfEmpty: true }),
    randomRule({ name: "Magical Arcane Tools", category: "tool", weight: 0.65, magicalState: "magical", allowDuplicates: false, curation: "magicArcaneImplements", maxPerFamily: 1, silentIfEmpty: true }),
    randomRule({ name: "Arcane Staves", category: "weapon", weight: 0.55, magicalState: "magical", allowDuplicates: false, curation: "magicArcaneImplements", maxPerFamily: 1, silentIfEmpty: true }),
    randomRule({ name: "Enchanted Armory Curiosities", category: "equipment", subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], weight: armoryCurioWeight, magicalState: "magical", allowDuplicates: false, curation: "magicArmoryCuriosity", maxPerFamily: 1, silentIfEmpty: true }),
    randomRule({ name: "Restricted Relics", category: "equipment", subtypes: ["ring", "trinket", "clothing", "wand", "rod", "wondrous"], weight: relicWeight, magicalState: "magical", allowDuplicates: false, curation: "magicRelics", minimumVendorAccess: 2, maxPerFamily: 1, silentIfEmpty: true })
  ].filter(rule => Number(rule.randomWeight ?? 0) > 0);
}

function catalogQuantityForAccess(_access) {
  return { quantityMode: "players", quantity: 1 };
}

function createGeneralTrade(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.GeneralTradeDescription");
  profile.stockTotalMode = "fixed";
  profile.stockTotal = 0;
  const quantity = catalogQuantityForAccess(access);
  profile.mundaneCatalogRules = [
    catalogRule({ name: "Adventuring Gear & Trade Goods", category: "loot", ...quantity, curation: "generalTradeLoot" }),
    catalogRule({ name: "Tools & Kits", category: "tool", ...quantity, curation: "generalTradeMundane" }),
    catalogRule({ name: "Containers", category: "container", ...quantity, curation: "generalTradeMundane" }),
    catalogRule({ name: "Food, Water, Kits & Supplies", category: "consumable", subtypes: ["food", "gear", "trinket", "ammunition"], ...quantity, curation: "generalTradeConsumables" }),
    catalogRule({ name: "Clothing & Utility Equipment", category: "equipment", subtypes: ["clothing", "trinket", "wondrous"], ...quantity, curation: "generalTradeEquipment" })
  ];
}

function createStable(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.StableLivestockDescription");
  profile.stockTotalMode = "fixed";
  profile.stockTotal = 0;
  const quantity = { quantityMode: "players", quantity: 1 };
  profile.mundaneCatalogRules = [
    catalogRule({ name: "Animals & Mounts", category: "loot", ...quantity, curation: `livestock-${access}` }),
    catalogRule({ name: "Stable Equipment", category: "equipment", ...catalogQuantityForAccess(access), curation: "stableSupplies" }),
    catalogRule({ name: "Feed & Harness", category: "loot", ...catalogQuantityForAccess(access), curation: "stableSupplies" }),
    catalogRule({ name: "Carts & Containers", category: "container", ...catalogQuantityForAccess(access), curation: "stableSupplies" })
  ];
}

export function createBlankSupplierProfile({ name, sourceIds }) {
  return blankProfile({ name, theme: "general", sourceIds });
}

export function createHomebrewSupplierProfile({ templateId, accessLevel = "2", name, sourceIds }) {
  const template = HOMEBREW_SUPPLIER_TEMPLATES.find(entry => entry.id === templateId);
  if (!template) throw new Error(`Unknown Homebrew Supplier template: ${templateId}`);
  const access = accessNumber(accessLevel);
  const profile = blankProfile({ name, theme: template.theme, sourceIds, templateId, accessLevel: String(access) });
  if (templateId === "blacksmith") createBlacksmith(profile, access);
  else if (templateId === "gunsmith") createGunsmith(profile, access);
  else if (templateId === "alchemist") createAlchemist(profile, access);
  else if (templateId === "magic") createMagicAssortment(profile, access);
  else if (templateId === "general") createGeneralTrade(profile, access);
  else if (templateId === "stable") createStable(profile, access);
  return profile;
}

const ANIMAL_GROUPS = {
  1: ["chicken", "goat", "pig", "sheep", "cow", "ox", "mule", "donkey", "galinha", "cabra", "porco", "ovelha", "vaca", "boi", "mula", "burro"],
  2: ["chicken", "goat", "pig", "sheep", "cow", "ox", "mule", "donkey", "pony", "riding-horse", "draft-horse", "camel", "galinha", "cabra", "porco", "ovelha", "vaca", "boi", "mula", "burro", "ponei", "cavalo-de-montaria", "cavalo-de-tracao", "camelo"],
  3: ["chicken", "goat", "pig", "sheep", "cow", "ox", "mule", "donkey", "pony", "riding-horse", "draft-horse", "warhorse", "camel", "mastiff", "elephant", "galinha", "cabra", "porco", "ovelha", "vaca", "boi", "mula", "burro", "ponei", "cavalo-de-montaria", "cavalo-de-tracao", "cavalo-de-guerra", "camelo", "mastim", "elefante"],
  4: ["chicken", "goat", "pig", "sheep", "cow", "ox", "mule", "donkey", "pony", "riding-horse", "draft-horse", "warhorse", "camel", "mastiff", "elephant", "galinha", "cabra", "porco", "ovelha", "vaca", "boi", "mula", "burro", "ponei", "cavalo-de-montaria", "cavalo-de-tracao", "cavalo-de-guerra", "camelo", "mastim", "elefante"]
};

const STABLE_SUPPLY_TERMS = [
  "saddle", "saddlebags", "saddlebag", "bit-and-bridle", "bridle", "harness", "feed", "fodder", "barding",
  "cart", "carriage", "chariot", "sled", "wagon", "animal-feed", "stable",
  "sela", "alforje", "freio", "arreio", "racao", "forragem", "barda", "carroca", "carruagem", "trenó", "estabulo"
];

const GENERIC_ALCHEMICAL_PLACEHOLDERS = new Set([
  "basic-potion", "generic-potion", "potion-template", "basic-poison", "generic-poison"
]);

const ALCHEMICAL_PREPARATION_TERMS = [
  "oil", "ointment", "unguent", "dust", "powder", "bead", "perfume", "philter", "elixir", "potion", "poison",
  "serum", "salve", "incense", "balm", "antitoxin", "acid", "alchemists-fire", "elemental-gem",
  "oleo", "unguento", "po", "perfume", "filtro", "elixir", "pocao", "veneno", "soro", "balsamo", "incenso",
  "antitoxina", "acido", "fogo-alquimico", "gema-elemental"
];

const BLACKSMITH_WEARABLE_TERMS = [
  "belt", "bracer", "gauntlet", "glove", "boot", "helm", "helmet", "greave", "cloak", "cape",
  "cinto", "bracelete", "manopla", "luva", "bota", "elmo", "capacete", "greva", "manto", "capa"
];

const ALCHEMIST_TOOL_TERMS = [
  "healers-kit", "healer-kit", "herbalism-kit", "alchemists-supplies", "alchemist-supplies", "poisoners-kit",
  "kit-de-curandeiro", "kit-de-herbalismo", "suprimentos-de-alquimista", "kit-de-venenos"
];
const ALCHEMIST_CONTAINER_TERMS = [
  "vial", "bottle", "flask", "jar", "pouch", "case", "waterskin", "component-pouch",
  "frasco", "garrafa", "ampola", "jarro", "bolsa", "estojo", "odre"
];
const ALCHEMIST_MUNDANE_CONSUMABLE_TERMS = [
  "antitoxin", "acid", "alchemists-fire", "healers-kit", "herbal-remedy", "remedy", "reagent",
  "antitoxina", "acido", "fogo-alquimico", "remedio", "reagente"
];
const ALCHEMIST_SUPPLY_TERMS = [
  ...ALCHEMIST_CONTAINER_TERMS, "herb", "herbal", "ingredient", "reagent", "mortar", "pestle", "bandage",
  "erva", "ingrediente", "reagente", "almofariz", "pilao", "bandagem"
];

const MAGIC_MUNDANE_TERMS = [
  "arcane-focus", "component-pouch", "spellbook", "scroll-case", "ink", "parchment", "paper", "quill",
  "crystal", "orb", "rod", "staff", "wand", "holy-symbol", "druidic-focus",
  "foco-arcano", "bolsa-de-componentes", "livro-de-magias", "estojo-de-pergaminho", "tinta", "pergaminho", "papel", "pena", "cristal", "orbe", "bastao", "cajado", "varinha"
];
const MAGIC_WEARABLE_TERMS = [
  "robe", "clothes", "clothing", "hat", "cap", "cloak", "cape", "glove", "boot", "belt", "bracer",
  "veste", "roupa", "chapeu", "gorro", "manto", "capa", "luva", "bota", "cinto", "bracelete"
];
const MAGIC_IMPLEMENT_TERMS = [
  "wand", "staff", "rod", "focus", "orb", "crystal", "talisman", "spellbook",
  "varinha", "cajado", "bastao", "foco", "orbe", "cristal", "talisma", "livro-de-magias"
];

const ARCANE_EQUIPMENT_TERMS = ["ring", "wand", "rod", "staff", "amulet", "talisman", "anel", "varinha", "bastao", "cajado", "amuleto", "talisma"];

function normalizedValues(entry) {
  return [entry?.identifier, entry?.name, entry?.baseItem].map(normalizeText).filter(Boolean);
}

function valueMatchesTerm(value, term) {
  return value === term || value.startsWith(`${term}-`) || value.endsWith(`-${term}`) || value.includes(`-${term}-`);
}

function matchesAnyTerm(entry, terms) {
  const values = normalizedValues(entry);
  return terms.some(term => values.some(value => valueMatchesTerm(value, term)));
}

function isGenericAlchemicalPlaceholder(entry) {
  return normalizedValues(entry).some(value => GENERIC_ALCHEMICAL_PLACEHOLDERS.has(value));
}

function isImprovisedWeaponMerchandise(entry) {
  if (String(entry?.type ?? "") !== "weapon") return false;
  const subtypeKeys = new Set(entry?.subtypeKeys ?? [entry?.primarySubtypeKey].filter(Boolean));
  if (subtypeKeys.has("improv") || subtypeKeys.has("improvised")) return true;
  const identity = normalizeText(`${entry?.identifier ?? ""} ${entry?.name ?? ""} ${entry?.baseItem ?? ""}`);
  return identity.includes("improvised-weapon");
}

function isArmorMaterializerMerchandise(entry) {
  if (!isMaterializerItem(entry) || String(entry?.type ?? "") !== "equipment") return false;
  const subtypeKeys = new Set(entry?.subtypeKeys ?? [entry?.primarySubtypeKey].filter(Boolean));
  if (["lightArmor", "mediumArmor", "heavyArmor", "shield"].some(value => subtypeKeys.has(value))) return true;
  const identity = normalizeText(`${entry?.materializerFamily ?? ""} ${entry?.identifier ?? ""} ${entry?.name ?? ""} ${entry?.baseItem ?? ""}`);
  return identity.includes("armor") || identity.includes("armour") || identity.includes("efreeti-chain") || identity.includes("efreet-chain");
}

function validMerchandise(entry) {
  if (isMechanicalItem(entry)) return false;
  if (isMaterializerItem(entry)) return isSupportedMaterializerEntry(entry);
  return true;
}

function finalSellableMerchandise(entry) {
  return validMerchandise(entry) && !isMaterializerItem(entry);
}

export function homebrewCurationAllowsEntry(entry, curation) {
  if (!curation) return true;
  if (curation === "blacksmithBase") return finalSellableMerchandise(entry) && !entry.isMagical && !isFirearmRelated(entry) && !isImprovisedWeaponMerchandise(entry);
  if (curation === "blacksmithTwoHanded") {
    const properties = new Set((entry.properties ?? []).map(value => normalizeText(value).replaceAll("-", "")));
    return finalSellableMerchandise(entry) && !entry.isMagical && !isFirearmRelated(entry)
      && (properties.has("two") || properties.has("twohanded"));
  }
  if (curation === "blacksmithAmmunition") return finalSellableMerchandise(entry) && !entry.isMagical && !isFirearmRelated(entry) && isAmmunitionEntry(entry);
  if (curation === "blacksmithMundaneWearables") return finalSellableMerchandise(entry) && !entry.isMagical && !isFirearmRelated(entry) && matchesAnyTerm(entry, BLACKSMITH_WEARABLE_TERMS);
  if (curation === "blacksmithMagicAmmunition") {
    if (isFirearmRelated(entry) || entry.primarySubtypeKey !== "ammunition") return false;
    if (isGeneratorItem(entry)) return entry.generatorKind === "ammunitionEnhancement";
    return finalSellableMerchandise(entry) && !entry.isMagical;
  }
  if (curation === "blacksmithNamed") {
    return validMerchandise(entry) && !isFirearmRelated(entry) && (entry.isMagical === true || isMaterializerItem(entry));
  }
  if (curation === "blacksmithNamedArmor") {
    return finalSellableMerchandise(entry)
      && entry.isMagical === true
      && !isFirearmRelated(entry)
      && ["lightArmor", "mediumArmor", "heavyArmor", "shield"].includes(entry.primarySubtypeKey);
  }
  if (curation === "blacksmithMaterializedArmor") {
    return isArmorMaterializerMerchandise(entry) && !isFirearmRelated(entry);
  }
  if (curation === "blacksmithWearables") {
    return finalSellableMerchandise(entry) && entry.isMagical === true && !isFirearmRelated(entry) && matchesAnyTerm(entry, BLACKSMITH_WEARABLE_TERMS);
  }
  if (curation === "firearmWeapons") return validMerchandise(entry) && (isFirearmEntry(entry) || (isMaterializerItem(entry) && entry.type === "weapon"));
  if (curation === "firearmAmmunition") return validMerchandise(entry) && (isFirearmAmmunition(entry) || (isGeneratorItem(entry) && entry.type === "consumable"));
  if (curation === "firearmSupplies") return finalSellableMerchandise(entry) && isFirearmSupply(entry);
  if (curation === "namedFirearms") {
    return validMerchandise(entry) && (isFirearmEntry(entry) || isMaterializerItem(entry)) && (entry.isMagical === true || isMaterializerItem(entry));
  }
  if (curation === "alchemistMundaneTools") return finalSellableMerchandise(entry) && !entry.isMagical && matchesAnyTerm(entry, ALCHEMIST_TOOL_TERMS);
  if (curation === "alchemistMundaneContainers") return finalSellableMerchandise(entry) && !entry.isMagical && matchesAnyTerm(entry, ALCHEMIST_CONTAINER_TERMS);
  if (curation === "alchemistMundaneConsumables") return finalSellableMerchandise(entry) && !entry.isMagical && matchesAnyTerm(entry, ALCHEMIST_MUNDANE_CONSUMABLE_TERMS);
  if (curation === "alchemistMundaneSupplies") return finalSellableMerchandise(entry) && !entry.isMagical && matchesAnyTerm(entry, ALCHEMIST_SUPPLY_TERMS);
  if (curation === "alchemicalConsumables") {
    return validMerchandise(entry)
      && !isGenericAlchemicalPlaceholder(entry)
      && !isFirearmRelated(entry)
      && entry.type === "consumable"
      && (["potion", "poison"].some(subtype => (entry.subtypeKeys ?? []).includes(subtype))
        || matchesAnyTerm(entry, ALCHEMICAL_PREPARATION_TERMS));
  }
  if (curation === "alchemicalPreparations") {
    return validMerchandise(entry) && !isGenericAlchemicalPlaceholder(entry) && entry.type === "consumable" && !isFirearmRelated(entry) && matchesAnyTerm(entry, ALCHEMICAL_PREPARATION_TERMS);
  }
  if (curation === "magicMundaneSupplies") return finalSellableMerchandise(entry) && !entry.isMagical && matchesAnyTerm(entry, MAGIC_MUNDANE_TERMS);
  if (curation === "magicMundaneWearables") return finalSellableMerchandise(entry) && !entry.isMagical && matchesAnyTerm(entry, MAGIC_WEARABLE_TERMS);
  if (curation === "magicArcaneImplements") return validMerchandise(entry) && !isFirearmRelated(entry) && (entry.isMagical === true || isMaterializerItem(entry)) && matchesAnyTerm(entry, MAGIC_IMPLEMENT_TERMS);
  if (curation === "magicArmoryCuriosity") return finalSellableMerchandise(entry) && !isFirearmRelated(entry) && entry.isMagical === true && ["lightArmor", "mediumArmor", "heavyArmor", "shield"].includes(entry.primarySubtypeKey);
  if (curation === "magicAssortment") {
    if (!validMerchandise(entry) || isFirearmRelated(entry)) return false;
    if (entry.type === "weapon") return false;
    if (entry.type === "consumable") return false;
    if (["lightArmor", "mediumArmor", "heavyArmor", "shield", "ammunition"].includes(entry.primarySubtypeKey)) return false;
    return true;
  }
  if (curation === "magicRelics") {
    if (!homebrewCurationAllowsEntry(entry, "magicAssortment")) return false;
    // REL was a manual book-table grouping. Inside Item Creator, restricted
    // merchandise is represented by Vendor Access instead of a hard-coded
    // name list, so ordinary/simple relics can remain in lower Access tiers
    // while major relics and artifacts rise to Access III or IV.
    return minimumVendorAccess(entry) >= 3;
  }
  if (curation === "generalTradeLoot") {
    return finalSellableMerchandise(entry) && !entry.isMagical && !isFirearmRelated(entry) && !matchesAnyTerm(entry, ANIMAL_GROUPS[3]);
  }
  if (curation === "generalTradeMundane") return finalSellableMerchandise(entry) && !entry.isMagical && !isFirearmRelated(entry);
  if (curation === "generalTradeConsumables") {
    return finalSellableMerchandise(entry) && !entry.isMagical && !isFirearmRelated(entry) && !matchesAnyTerm(entry, ANIMAL_GROUPS[3]);
  }
  if (curation === "generalTradeEquipment") {
    return finalSellableMerchandise(entry) && !entry.isMagical && !isFirearmRelated(entry) && !matchesAnyTerm(entry, ARCANE_EQUIPMENT_TERMS);
  }
  if (curation.startsWith("livestock-")) {
    const access = accessNumber(curation.split("-").at(-1));
    return finalSellableMerchandise(entry) && !entry.isMagical && matchesAnyTerm(entry, ANIMAL_GROUPS[access]);
  }
  if (curation === "stableSupplies") return finalSellableMerchandise(entry) && !entry.isMagical && matchesAnyTerm(entry, STABLE_SUPPLY_TERMS);
  if (curation === "excludeCantrips") return Number(entry.spellLevel ?? 0) > 0;
  return true;
}

export function applyHomebrewSupplierCuration(profile, catalog, configuration) {
  if (!profile?.homebrewTemplateId) return profile;
  restoreHomebrewRuleCurations(profile);
  const profileEntries = entriesForProfile(catalog, profile, configuration, { includeMechanical: true });
  const allRules = [
    ...(profile.mundaneCatalogRules ?? []),
    ...(profile.guaranteedRules ?? []),
    ...(profile.randomRules ?? [])
  ];
  for (const rule of allRules) {
    const curation = rule.homebrewCuration;
    rule.materializerExclusions = [...new Set((rule.materializerExclusions ?? []).map(String))];
    if (!curation) continue;

    // An earlier migration converted Homebrew curation into permanent
    // poolExclusions. Remove only the stale Materializer keys that are now
    // valid for the rule. Ordinary user curation remains untouched.
    const staleMaterializerKeys = new Set(profileEntries
      .filter(entry => isMaterializerItem(entry) && homebrewCurationAllowsEntry(entry, curation))
      .map(canonicalKey));
    rule.poolExclusions = [...new Set((rule.poolExclusions ?? []).map(String))]
      .filter(key => !staleMaterializerKeys.has(key));
  }
  return profile;
}
