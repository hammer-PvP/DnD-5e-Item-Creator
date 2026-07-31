import {
  HAMMER_HOMEBREW_PROGRESSION_ID,
  createDefaultCatalogRule,
  createDefaultGuaranteedRule,
  createDefaultRandomRule
} from "./constants.mjs";
import {
  canonicalKey,
  entriesForProfile,
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

export const HOMEBREW_ACCESS_LEVELS = ["1", "2", "3"];

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
  generatorResultCuration = ""
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
    generatorResultCuration
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
  generatorResultCuration = ""
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
    generatorResultCuration
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
  generatorResultCuration = ""
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
    generatorResultCuration
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
    progressionProfileId: templateId ? HAMMER_HOMEBREW_PROGRESSION_ID : "world",
    homebrewTemplateId: templateId,
    homebrewAccessLevel: accessLevel,
    allowedItemTypes: [],
    stockTotalMode: "fixed",
    stockTotal: 0,
    mundaneCatalogRules: [],
    guaranteedRules: [],
    bannedItems: [],
    mechanicalItemOverrides: [],
    randomRules: []
  };
}

function accessNumber(accessLevel) {
  return Math.min(3, Math.max(1, Number(accessLevel ?? 2)));
}

function createBlacksmith(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.BlacksmithDescription");
  profile.stockTotalMode = "perPlayer";
  profile.stockTotal = [1.5, 2, 3][access - 1];
  profile.mundaneCatalogRules = [
    catalogRule({
      name: "Simple Weapons",
      category: "weapon",
      subtypes: ["simpleM", "simpleR"],
      quantityMode: "fixed",
      quantity: 1,
      curation: "blacksmithBase"
    }),
    catalogRule({
      name: "Armor & Shields",
      category: "equipment",
      subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"],
      quantityMode: "fixed",
      quantity: 1,
      curation: "blacksmithBase"
    }),
    catalogRule({
      name: "Ammunition",
      category: "consumable",
      subtypes: ["ammunition"],
      quantityMode: access >= 2 ? "halfUp" : "fixed",
      quantity: 1,
      curation: "blacksmithAmmunition"
    })
  ];
  profile.guaranteedRules = [
    guaranteedRule({ name: "Simple Ranged Weapon", category: "weapon", subtypes: ["simpleR"], qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase" }),
    guaranteedRule({ name: "Martial Ranged Weapon", category: "weapon", subtypes: ["martialR"], qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase" }),
    guaranteedRule({ name: "Light Armor", category: "equipment", subtypes: ["lightArmor"], qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase" }),
    guaranteedRule({ name: "Medium Armor", category: "equipment", subtypes: ["mediumArmor"], qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase" }),
    guaranteedRule({ name: "Heavy Armor", category: "equipment", subtypes: ["heavyArmor"], qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase" })
  ];
  profile.randomRules = [
    randomRule({ name: "Simple Weapons", category: "weapon", subtypes: ["simpleM", "simpleR"], weight: 2, qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase" }),
    randomRule({ name: "Martial Weapons", category: "weapon", subtypes: ["martialM", "martialR"], weight: 3, qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase" }),
    randomRule({ name: "Armor & Shields", category: "equipment", subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], weight: 2, qualityMode: "party", magicalState: "mundane", allowDuplicates: false, curation: "blacksmithBase" }),
    randomRule({ name: "Ammunition", category: "consumable", subtypes: ["ammunition"], weight: 1, qualityMode: "party", magicalState: "mundane", allowDuplicates: true, curation: "blacksmithAmmunition" })
  ];
  if (access >= 2) {
    profile.randomRules.push(
      randomRule({
        name: "Named Magic Weapons",
        category: "weapon",
        subtypes: ["simpleM", "simpleR", "martialM", "martialR"],
        weight: access === 2 ? 0.25 : 0.75,
        qualityMode: "source",
        magicalState: "magical",
        allowDuplicates: false,
        curation: "blacksmithNamed"
      }),
      randomRule({
        name: "Named Magic Armor",
        category: "equipment",
        subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"],
        weight: access === 2 ? 0.25 : 0.75,
        qualityMode: "source",
        magicalState: "magical",
        allowDuplicates: false,
        curation: "blacksmithNamed"
      })
    );
  }
}

function createGunsmith(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.GunsmithDescription");
  profile.stockTotalMode = "perPlayer";
  profile.stockTotal = [0.75, 1.25, 2][access - 1];
  profile.mundaneCatalogRules = [
    catalogRule({ name: "Firearms", category: "weapon", quantityMode: "fixed", quantity: 1, curation: "firearmWeapons" }),
    catalogRule({ name: "Firearm Ammunition", category: "consumable", subtypes: ["ammunition"], quantityMode: access >= 2 ? "halfUp" : "fixed", quantity: 1, curation: "firearmAmmunition" }),
    catalogRule({ name: "Powder & Gunsmith Supplies", category: "loot", quantityMode: "fixed", quantity: 1, curation: "firearmSupplies" })
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
  profile.stockTotalMode = "perPlayer";
  profile.stockTotal = [1, 1.5, 2][access - 1];
  profile.guaranteedRules = [
    guaranteedRule({
      name: "Healing Potions",
      category: "consumable",
      subtypes: ["potion"],
      quantityMode: "players",
      quantity: 1,
      includeFamilies: ["healingPotions"],
      allowDuplicates: true,
      curation: "alchemicalConsumables"
    })
  ];
  profile.randomRules = [
    randomRule({
      name: "Potions & Poisons",
      category: "consumable",
      subtypes: ["potion", "poison"],
      weight: 3,
      allowDuplicates: true,
      curation: "alchemicalConsumables"
    })
  ];
  if (access >= 2) {
    profile.randomRules.push(randomRule({
      name: "Oils, Powders & Preparations",
      category: "consumable",
      subtypes: ["trinket", "wondrous", "gear"],
      weight: access === 2 ? 1 : 2,
      allowDuplicates: true,
      curation: "alchemicalPreparations"
    }));
  }
}

function createMagicAssortment(profile, access) {
  profile.description = game.i18n.localize("DND5E_SUPPLIER.Homebrew.MagicAssortmentDescription");
  profile.stockTotalMode = "perPlayer";
  profile.stockTotal = [1, 2, 3][access - 1];
  const equipmentSubtypes = access === 1
    ? ["ring", "trinket", "wand", "wondrous"]
    : ["ring", "trinket", "clothing", "wand", "rod", "wondrous"];
  profile.randomRules = [
    randomRule({ name: "Spell Scrolls", category: "spellScroll", weight: 2, allowDuplicates: true, curation: "excludeCantrips" }),
    randomRule({ name: "Arcane Equipment", category: "equipment", subtypes: equipmentSubtypes, weight: access === 1 ? 1 : 1.5, magicalState: "magical", allowDuplicates: false, curation: "magicAssortment" }),
    randomRule({ name: "Arcane Consumables", category: "consumable", subtypes: ["trinket", "wondrous", "scroll"], weight: access === 3 ? 1 : 0.5, magicalState: "magical", allowDuplicates: true, curation: "magicAssortment" })
  ];
}

function catalogQuantityForAccess(access) {
  if (access === 1) return { quantityMode: "fixed", quantity: 1 };
  if (access === 2) return { quantityMode: "halfUp", quantity: 1 };
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
  const quantity = access === 1
    ? { quantityMode: "fixed", quantity: 1 }
    : access === 2
      ? { quantityMode: "halfDown", quantity: 1 }
      : { quantityMode: "halfUp", quantity: 1 };
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
  3: ["chicken", "goat", "pig", "sheep", "cow", "ox", "mule", "donkey", "pony", "riding-horse", "draft-horse", "warhorse", "camel", "mastiff", "elephant", "galinha", "cabra", "porco", "ovelha", "vaca", "boi", "mula", "burro", "ponei", "cavalo-de-montaria", "cavalo-de-tracao", "cavalo-de-guerra", "camelo", "mastim", "elefante"]
};

const STABLE_SUPPLY_TERMS = [
  "saddle", "saddlebags", "saddlebag", "bit-and-bridle", "bridle", "harness", "feed", "fodder", "barding",
  "cart", "carriage", "chariot", "sled", "wagon", "animal-feed", "stable",
  "sela", "alforje", "freio", "arreio", "racao", "forragem", "barda", "carroca", "carruagem", "trenó", "estabulo"
];

const ALCHEMICAL_PREPARATION_TERMS = [
  "oil", "ointment", "unguent", "dust", "powder", "bead", "perfume", "philter", "elixir", "potion", "poison",
  "serum", "salve", "incense", "balm", "antitoxin", "acid", "alchemists-fire", "elemental-gem", "feather-token",
  "oleo", "unguento", "po", "perfume", "filtro", "elixir", "pocao", "veneno", "soro", "balsamo", "incenso",
  "antitoxina", "acido", "fogo-alquimico", "gema-elemental", "pena-magica"
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
  if (curation === "blacksmithBase") return validMerchandise(entry) && !isFirearmRelated(entry);
  if (curation === "blacksmithAmmunition") return validMerchandise(entry) && !isFirearmRelated(entry) && entry.primarySubtypeKey === "ammunition";
  if (curation === "blacksmithNamed") {
    return validMerchandise(entry) && !isFirearmRelated(entry) && (entry.isMagical === true || isMaterializerItem(entry));
  }
  if (curation === "firearmWeapons") return validMerchandise(entry) && (isFirearmEntry(entry) || (isMaterializerItem(entry) && entry.type === "weapon"));
  if (curation === "firearmAmmunition") return validMerchandise(entry) && (isFirearmAmmunition(entry) || (isGeneratorItem(entry) && entry.type === "consumable"));
  if (curation === "firearmSupplies") return finalSellableMerchandise(entry) && isFirearmSupply(entry);
  if (curation === "namedFirearms") {
    return validMerchandise(entry) && (isFirearmEntry(entry) || isMaterializerItem(entry)) && (entry.isMagical === true || isMaterializerItem(entry));
  }
  if (curation === "alchemicalConsumables") {
    return validMerchandise(entry)
      && !isFirearmRelated(entry)
      && (["potion", "poison"].some(subtype => (entry.subtypeKeys ?? []).includes(subtype))
        || (isMaterializerItem(entry) && matchesAnyTerm(entry, ALCHEMICAL_PREPARATION_TERMS)));
  }
  if (curation === "alchemicalPreparations") {
    return validMerchandise(entry) && !isFirearmRelated(entry) && matchesAnyTerm(entry, ALCHEMICAL_PREPARATION_TERMS);
  }
  if (curation === "magicAssortment") return validMerchandise(entry) && !isFirearmRelated(entry);
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

    // v0.0.2b-v0.0.2d converted Homebrew curation into permanent
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
