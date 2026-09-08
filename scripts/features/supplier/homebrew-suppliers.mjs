import {
  createItemGroup,
  createScrollStock,
  createStockRule,
  createSupplierProfileV2
} from "./profile-v2.mjs";

export const HOMEBREW_ACCESS_LEVELS = ["1", "2", "3", "4"];

export const HOMEBREW_SUPPLIER_TEMPLATES = Object.freeze([
  { id: "blacksmith", label: "DND5E_SUPPLIER.Homebrew.Blacksmith", description: "DND5E_SUPPLIER.Homebrew.BlacksmithHint", icon: "fa-solid fa-hammer", secondaryIcon: "fa-solid fa-cube", theme: "blacksmith" },
  { id: "alchemist", label: "DND5E_SUPPLIER.Homebrew.Alchemist", description: "DND5E_SUPPLIER.Homebrew.AlchemistHint", icon: "fa-solid fa-flask", secondaryIcon: "", theme: "alchemist" },
  { id: "herbalist", label: "DND5E_SUPPLIER.Homebrew.Herbalist", description: "DND5E_SUPPLIER.Homebrew.HerbalistHint", icon: "fa-solid fa-leaf", secondaryIcon: "", theme: "herbalist" },
  { id: "hunter", label: "DND5E_SUPPLIER.Homebrew.Hunter", description: "DND5E_SUPPLIER.Homebrew.HunterHint", icon: "fa-solid fa-paw", secondaryIcon: "", theme: "hunter" },
  { id: "butcher", label: "DND5E_SUPPLIER.Homebrew.Butcher", description: "DND5E_SUPPLIER.Homebrew.ButcherHint", icon: "fa-solid fa-drumstick-bite", secondaryIcon: "", theme: "butcher" },
  { id: "tavern-common", label: "DND5E_SUPPLIER.Homebrew.TavernCommon", description: "DND5E_SUPPLIER.Homebrew.TavernCommonHint", icon: "fa-solid fa-utensils", secondaryIcon: "", theme: "tavern" },
  { id: "tavern-dwarven", label: "DND5E_SUPPLIER.Homebrew.TavernDwarven", description: "DND5E_SUPPLIER.Homebrew.TavernDwarvenHint", icon: "fa-solid fa-beer-mug-empty", secondaryIcon: "", theme: "tavern" },
  { id: "tavern-elven", label: "DND5E_SUPPLIER.Homebrew.TavernElven", description: "DND5E_SUPPLIER.Homebrew.TavernElvenHint", icon: "fa-solid fa-wine-glass", secondaryIcon: "", theme: "tavern" },
  { id: "magic", label: "DND5E_SUPPLIER.Homebrew.MagicAssortment", description: "DND5E_SUPPLIER.Homebrew.MagicAssortmentHint", icon: "fa-solid fa-wand-magic-sparkles", secondaryIcon: "", theme: "magic" },
  { id: "general", label: "DND5E_SUPPLIER.Homebrew.GeneralTrade", description: "DND5E_SUPPLIER.Homebrew.GeneralTradeHint", icon: "fa-solid fa-basket-shopping", secondaryIcon: "", theme: "general" },
  { id: "stable", label: "DND5E_SUPPLIER.Homebrew.StableLivestock", description: "DND5E_SUPPLIER.Homebrew.StableLivestockHint", icon: "fa-solid fa-horse-head", secondaryIcon: "", theme: "stable" },
  { id: "siege", label: "DND5E_SUPPLIER.Homebrew.SiegeEngineer", description: "DND5E_SUPPLIER.Homebrew.SiegeEngineerHint", icon: "fa-solid fa-tower-observation", secondaryIcon: "", theme: "blacksmith" }
]);

function g(name, options = {}) {
  return createItemGroup({ name, ...options });
}

function r(mode, name, options = {}) {
  return createStockRule(mode, { name, ...options });
}

function groupMap(groups) {
  return Object.fromEntries(groups.map(group => [group.name, group.id]));
}

// These terms are preset data, not generator curation. They are stored in the
// Item Groups themselves and are therefore visible/editable in the same UI a
// GM uses for a profile built from scratch.
const ALCHEMIST_TOOL_TERMS = ["healer's kit", "healers kit", "herbalism kit", "alchemist's supplies", "alchemists supplies", "poisoner's kit", "poisoners kit"];
const ALCHEMIST_CONTAINER_TERMS = ["vial", "bottle", "flask", "jar", "pouch", "case", "waterskin", "component pouch"];
const ALCHEMIST_MUNDANE_TERMS = ["antitoxin", "acid", "alchemist's fire", "alchemists fire", "herbal remedy", "remedy", "reagent"];
const HERBALIST_TOOL_TERMS = ["healer's kit", "healers kit", "herbalism kit"];
const MAGIC_MUNDANE_TERMS = ["arcane focus", "component pouch", "spellbook", "scroll case", "ink", "parchment", "paper", "quill", "crystal", "orb", "rod", "staff", "wand"];
const MAGIC_WEARABLE_TERMS = ["robe", "clothes", "clothing", "hat", "cap", "cloak", "cape", "glove", "boot", "belt", "bracer"];
const MAGIC_IMPLEMENT_TERMS = ["wand", "staff", "rod", "focus", "orb", "crystal", "talisman", "spellbook"];
const GENERAL_ANIMAL_EXCLUSIONS = ["chicken", "goat", "pig", "sheep", "cow", "ox", "mule", "donkey", "pony", "riding horse", "draft horse", "warhorse", "camel", "mastiff", "elephant"];
const GENERAL_ARCANE_EXCLUSIONS = ["ring", "wand", "rod", "staff", "amulet", "talisman", "arcane focus", "spellbook"];
const STABLE_COMMON_ANIMALS = ["chicken", "goat", "pig", "sheep", "cow", "ox", "mule", "donkey"];
const STABLE_STANDARD_MOUNTS = ["pony", "riding horse", "draft horse", "camel"];
const STABLE_PREMIUM_MOUNTS = ["warhorse", "mastiff"];
const STABLE_EXOTIC_MOUNTS = ["elephant"];
const STABLE_SUPPLY_TERMS = ["saddle", "saddlebags", "saddlebag", "bit and bridle", "bridle", "harness", "feed", "fodder", "barding", "cart", "carriage", "chariot", "sled", "wagon", "animal feed", "stable"];

function commonProfile({ name, sourceIds, accessLevel, presetId, theme, icon, description, groups, rules, scrollStock = null }) {
  return createSupplierProfileV2({
    name,
    sourceIds,
    accessLevel,
    presetId,
    theme,
    icon,
    description,
    normalizeFirearms: true,
    itemGroups: groups,
    stockRules: rules,
    scrollStock
  });
}

function blacksmith({ name, sourceIds, accessLevel }) {
  const groups = [
    g("Mundane Weapons", { itemTypes: ["weapon"], subtypes: ["simpleM", "simpleR", "martialM", "martialR"], magicalState: "mundane", documentNatures: ["sellable"] }),
    g("Mundane Armor & Shields", { itemTypes: ["equipment"], subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], magicalState: "mundane", documentNatures: ["sellable"] }),
    g("Mundane Ammunition", { itemTypes: ["consumable", "loot", "equipment"], subtypes: ["ammunition"], magicalState: "mundane", documentNatures: ["sellable"] }),
    g("Smithing Minerals", { selectionWeight: 2, itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["mineral"], materialTags: ["metal", "fuel", "coal"] } }),
    g("Metalworking Materials", { selectionWeight: 3, itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["metalworking"] } }),
    g("Named Magical Weapons", { itemTypes: ["weapon"], subtypes: ["simpleM", "simpleR", "martialM", "martialR"], magicalState: "magical", documentNatures: ["sellable"] }),
    g("Named Magical Armor", { itemTypes: ["equipment"], subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], magicalState: "magical", documentNatures: ["sellable"] }),
    g("Weapon Materializers", { itemTypes: ["weapon"], subtypes: ["simpleM", "simpleR", "martialM", "martialR"], documentNatures: ["materializer"] }),
    g("Armor Materializers", { itemTypes: ["equipment"], subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], documentNatures: ["materializer"] })
  ];
  const m = groupMap(groups);
  const rules = [
    r("guaranteed", "Complete Mundane Weapons", { groupIds: [m["Mundane Weapons"]], coverage: "all", respectLevelRange: false, baseQuantity: 0, scaling: "players" }),
    r("guaranteed", "Complete Mundane Armor & Shields", { groupIds: [m["Mundane Armor & Shields"]], coverage: "all", respectLevelRange: false, baseQuantity: 0, scaling: "players" }),
    r("guaranteed", "Mundane Ammunition", { groupIds: [m["Mundane Ammunition"]], coverage: "all", respectLevelRange: false, baseQuantity: 0, scaling: "players" }),
    r("random", "Smithing Materials", { groupIds: [m["Smithing Minerals"], m["Metalworking Materials"]], varietyBase: 2, varietyScaling: "halfDown", quantityPreset: "normal" }),
    r("specialExisting", "Named Magical Equipment", { groupIds: [m["Named Magical Weapons"], m["Named Magical Armor"]], respectLevelRange: true, baseQuantity: 1, scaling: "halfDown", maximumPicks: 6 }),
    r("materialized", "Materialized Weapons & Armor", { baseGroupIds: [m["Mundane Weapons"], m["Mundane Armor & Shields"]], templateGroupIds: [m["Weapon Materializers"], m["Armor Materializers"]], respectLevelRange: true, baseQuantity: 1, scaling: "halfDown", requireMagicalResult: true }),
    r("materialized", "Enchanted Ammunition", { baseGroupIds: [m["Mundane Ammunition"]], materializationRecipe: "enchanted-ammunition", respectLevelRange: true, baseQuantity: 0, scaling: "thirdDown", requireMagicalResult: true, chance: 50 })
  ];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "blacksmith", theme: "blacksmith", icon: "fa-solid fa-hammer", description: "Medieval weapons, armor, smithing materials, and compatible magical stock.", groups, rules });
}

function alchemist({ name, sourceIds, accessLevel }) {
  const groups = [
    g("Healing Potions", { itemTypes: ["consumable"], subtypes: ["potion"], identityTerms: ["potion of healing", "healing potion"] }),
    g("Alchemist & Healer Tools", { itemTypes: ["tool"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: ALCHEMIST_TOOL_TERMS }),
    g("Vials, Bottles & Containers", { itemTypes: ["container"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: ALCHEMIST_CONTAINER_TERMS }),
    g("Mundane Remedies", { itemTypes: ["consumable", "loot"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: ALCHEMIST_MUNDANE_TERMS, crafting: { excludeMaterials: true, excludeProducts: true } }),
    g("Alchemical Consumables", { itemTypes: ["consumable"], subtypes: ["potion", "poison"], documentNatures: ["sellable"] }),
    g("Crafting Alchemy", { selectionWeight: 3, itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["alchemy"] } }),
    g("Alchemical Minerals", { selectionWeight: 2, itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["mineral"], materialTags: ["alchemy", "sulfur"] } }),
    g("Crafting Essences", { itemTypes: ["loot"], crafting: { materialOnly: true, materialFamilies: ["essence"] } }),
    g("Creature Reagents", { selectionWeight: 3, itemTypes: ["loot"], crafting: { materialOnly: true, materialFamilies: ["creature"], materialTags: ["acid", "venom", "gland", "organ", "alchemy", "arcane", "elemental", "psionic", "poison"] } }),
    g("Creature Fluid Reagents", { selectionWeight: 3, itemTypes: ["loot"], crafting: { materialOnly: true, materialFamilies: ["creature"], materialRequires: ["venom", "blood", "eye"] } }),
    g("Botanical Reagents", { selectionWeight: 1.5, itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["flora", "roots", "fungi"], materialTags: ["alchemy", "medicine", "medicinal", "arcane", "fire", "luminous", "spirit"] } })
  ];
  const m = groupMap(groups);
  const rules = [
    r("guaranteed", "Healing Potions by Level", { groupIds: [m["Healing Potions"]], coverage: "all", respectLevelRange: true, baseQuantity: 1, scaling: "halfDown" }),
    r("guaranteed", "Alchemical Tools & Containers", { groupIds: [m["Alchemist & Healer Tools"], m["Vials, Bottles & Containers"], m["Mundane Remedies"]], coverage: "all", respectLevelRange: false, baseQuantity: 0, scaling: "players" }),
    r("random", "Alchemical Preparations", { groupIds: [m["Alchemical Consumables"]], varietyBase: 2, varietyScaling: "halfDown", quantityPreset: "sparse", maximumPicks: 8 }),
    r("random", "Alchemy Reagents", { groupIds: [m["Crafting Alchemy"], m["Alchemical Minerals"], m["Creature Reagents"], m["Creature Fluid Reagents"], m["Botanical Reagents"]], varietyBase: 2, varietyScaling: "halfDown", quantityPreset: "sparse", maximumPicks: 8 }),
    r("random", "Essences", { groupIds: [m["Crafting Essences"]], varietyBase: 0, varietyScaling: "thirdDown", quantityPreset: "sparse", minimumVendorAccess: 2, maximumPicks: 3 })
  ];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "alchemist", theme: "alchemist", icon: "fa-solid fa-flask", description: "Potions, tools, preparations, reagents, and carefully limited essences.", groups, rules });
}

function herbalist({ name, sourceIds, accessLevel }) {
  const groups = [
    g("Herbalism & Healer Kits", { itemTypes: ["tool"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: HERBALIST_TOOL_TERMS }),
    g("Field Containers", { itemTypes: ["container"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: ["pouch", "vial", "bottle", "jar", "waterskin"] }),
    g("Herbs & Flora", { itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["flora"] } }),
    g("Roots", { itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["roots"] } }),
    g("Fungi", { itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["fungi"] } }),
    g("Field Forage", { itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["forage"] } }),
    g("Mundane Herbal Remedies", { itemTypes: ["consumable", "loot"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: ["herbal remedy", "remedy", "antitoxin", "healer"], crafting: { excludeMaterials: true, excludeProducts: true } })
  ];
  const m = groupMap(groups);
  const rules = [
    r("guaranteed", "Herbalist Tools", { groupIds: [m["Herbalism & Healer Kits"], m["Field Containers"]], coverage: "all", respectLevelRange: false, baseQuantity: 0, scaling: "players" }),
    r("random", "Botanical Stock", { groupIds: [m["Herbs & Flora"], m.Roots, m.Fungi, m["Field Forage"]], varietyBase: 3, varietyScaling: "halfDown", quantityPreset: "normal", maximumPicks: 10 }),
    r("random", "Mundane Herbal Remedies", { groupIds: [m["Mundane Herbal Remedies"]], varietyBase: 1, varietyScaling: "thirdDown", quantityPreset: "normal", maximumPicks: 3 })
  ];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "herbalist", theme: "herbalist", icon: "fa-solid fa-leaf", description: "Herbs, roots, fungi, forage, remedies, and botanical field supplies.", groups, rules });
}

function hunter({ name, sourceIds, accessLevel }) {
  const groups = [
    g("Game", { selectionWeight: 3, itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["game-small", "game-medium", "game-large"] } }),
    g("Animal Harvest", { selectionWeight: 3, itemTypes: ["loot"], crafting: { materialOnly: true, materialFamilies: ["creature"], materialRequires: ["hide", "bone", "horn", "feather", "claw", "fang", "scale", "flesh"] } }),
    g("Field Forage", { selectionWeight: 1, itemTypes: ["loot"], crafting: { materialOnly: true, materialCategories: ["flora", "roots", "fungi", "forage"] } })
  ];
  const m = groupMap(groups);
  const rules = [
    r("random", "Hunter Stock", { groupIds: [m.Game, m["Animal Harvest"], m["Field Forage"]], varietyBase: 2, varietyScaling: "halfDown", quantityPreset: "normal", maximumPicks: 6 })
  ];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "hunter", theme: "hunter", icon: "fa-solid fa-paw", description: "A contained, organic stock of recent game, harvests, and occasional field forage.", groups, rules });
}

function butcher({ name, sourceIds, accessLevel }) {
  const groups = [
    g("Meat", { itemTypes: ["loot"], crafting: { materialOnly: true, materialTags: ["meat"] } }),
    g("Food-grade Flesh", { itemTypes: ["loot"], crafting: { materialOnly: true, materialFamilies: ["creature"], materialRequires: ["flesh"] } })
  ];
  const m = groupMap(groups);
  const rules = [r("random", "Butcher Counter", { groupIds: Object.values(m), varietyBase: 2, varietyScaling: "halfDown", quantityPreset: "abundant", maximumPicks: 8 })];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "butcher", theme: "butcher", icon: "fa-solid fa-drumstick-bite", description: "Meat and food-grade animal products with larger organic stacks.", groups, rules });
}

function tavern({ name, sourceIds, accessLevel, presetId, cultures, description, icon }) {
  const groups = [g("Culinary Products", { itemTypes: ["consumable", "loot"], crafting: { productOnly: true, productCategories: ["culinary"], productCultures: cultures } })];
  const rules = [r("random", "Meals & Drinks", { groupIds: [groups[0].id], varietyBase: 3, varietyScaling: "halfDown", quantityPreset: "abundant", maximumPicks: 10 })];
  return commonProfile({ name, sourceIds, accessLevel, presetId, theme: "tavern", icon, description, groups, rules });
}

function magic({ name, sourceIds, accessLevel }) {
  const groups = [
    g("Mundane Arcane Supplies", { itemTypes: ["equipment", "tool", "loot", "container"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: MAGIC_MUNDANE_TERMS, crafting: { excludeMaterials: true, excludeProducts: true } }),
    g("Mundane Arcane Wearables", { itemTypes: ["equipment"], subtypes: ["clothing", "trinket", "wondrous"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: MAGIC_WEARABLE_TERMS }),
    g("Arcane Equipment & Wondrous Items", { itemTypes: ["equipment"], subtypes: ["ring", "trinket", "clothing", "wand", "rod", "wondrous"], magicalState: "magical", documentNatures: ["sellable"], crafting: { excludeMaterials: true, excludeProducts: true } }),
    g("Magical Arcane Tools", { itemTypes: ["tool"], magicalState: "magical", documentNatures: ["sellable"], identityTerms: MAGIC_IMPLEMENT_TERMS }),
    g("Arcane Staves", { itemTypes: ["weapon"], magicalState: "magical", documentNatures: ["sellable"], identityTerms: ["staff", "quarterstaff"] }),
    g("Armory Curiosities", { itemTypes: ["equipment"], subtypes: ["lightArmor", "mediumArmor", "heavyArmor", "shield"], magicalState: "magical", documentNatures: ["sellable"] }),
    g("Materialization Bases", { itemTypes: ["weapon", "equipment", "consumable", "tool", "loot", "container"], magicalState: "mundane", documentNatures: ["sellable"], crafting: { excludeMaterials: true, excludeProducts: true } }),
    g("Materializers", { itemTypes: ["weapon", "equipment", "consumable", "tool", "loot", "container"], documentNatures: ["materializer"] }),
    g("Essences", { itemTypes: ["loot"], crafting: { materialOnly: true, materialFamilies: ["essence"] } }),
    g("Arcane Materials", { itemTypes: ["loot"], crafting: { materialOnly: true, materialTags: ["arcane", "elemental", "planar", "psionic", "radiant", "necrotic", "fey", "fiend", "draconic", "spirit", "soul", "crystal"] } })
  ];
  const m = groupMap(groups);
  const rules = [
    r("guaranteed", "Mundane Arcane Supplies", { groupIds: [m["Mundane Arcane Supplies"], m["Mundane Arcane Wearables"]], coverage: "all", respectLevelRange: false, baseQuantity: 0, scaling: "players" }),
    r("specialExisting", "Arcane Equipment & Wondrous Items", { groupIds: [m["Arcane Equipment & Wondrous Items"], m["Magical Arcane Tools"], m["Arcane Staves"]], baseQuantity: 2, scaling: "halfDown", respectLevelRange: true, maximumPicks: 10 }),
    r("specialExisting", "Enchanted Armory Curiosities", { groupIds: [m["Armory Curiosities"]], baseQuantity: 1, scaling: "none", respectLevelRange: true, chance: 30, maximumPicks: 1 }),
    r("materialized", "Materialized Magic", { baseGroupIds: [m["Materialization Bases"]], templateGroupIds: [m.Materializers], baseQuantity: 1, scaling: "halfDown", respectLevelRange: true, requireMagicalResult: true }),
    r("random", "Arcane Components", { groupIds: [m.Essences, m["Arcane Materials"]], varietyBase: 1, varietyScaling: "thirdDown", quantityPreset: "sparse", minimumVendorAccess: 2, maximumPicks: 6 })
  ];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "magic", theme: "magic", icon: "fa-solid fa-wand-magic-sparkles", description: "Arcane supplies, named magic, materialized items, scrolls, and scarce supernatural components.", groups, rules, scrollStock: createScrollStock({ enabled: true, baseQuantity: 1, scaling: "halfDown" }) });
}

function general({ name, sourceIds, accessLevel }) {
  const groups = [
    g("Adventuring Gear & Trade Goods", { itemTypes: ["loot"], magicalState: "mundane", documentNatures: ["sellable"], identityExclusions: GENERAL_ANIMAL_EXCLUSIONS, crafting: { excludeMaterials: true, excludeProducts: true } }),
    g("Tools & Kits", { itemTypes: ["tool"], magicalState: "mundane", documentNatures: ["sellable"] }),
    g("Containers", { itemTypes: ["container"], magicalState: "mundane", documentNatures: ["sellable"] }),
    g("Food, Water & Supplies", { itemTypes: ["consumable"], subtypes: ["food", "gear", "trinket", "ammunition"], magicalState: "mundane", documentNatures: ["sellable"], identityExclusions: GENERAL_ANIMAL_EXCLUSIONS, crafting: { excludeProducts: true } }),
    g("Clothing & Utility Equipment", { itemTypes: ["equipment"], subtypes: ["clothing", "trinket", "wondrous"], magicalState: "mundane", documentNatures: ["sellable"], identityExclusions: GENERAL_ARCANE_EXCLUSIONS }),
    g("Crafting Commodities", { itemTypes: ["loot"], crafting: { materialOnly: true, materialFamilies: ["profession"], materialCategories: ["cultivated", "food", "general"] } })
  ];
  const m = groupMap(groups);
  const mundane = [m["Adventuring Gear & Trade Goods"], m["Tools & Kits"], m.Containers, m["Food, Water & Supplies"], m["Clothing & Utility Equipment"]];
  const rules = [
    r("guaranteed", "Mundane General Goods", { groupIds: mundane, coverage: "all", respectLevelRange: false, baseQuantity: 0, scaling: "players" }),
    r("random", "Crafting Commodities", { groupIds: [m["Crafting Commodities"]], varietyBase: 2, varietyScaling: "halfDown", quantityPreset: "abundant", maximumPicks: 10 })
  ];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "general", theme: "general", icon: "fa-solid fa-basket-shopping", description: "Broad mundane adventuring supplies and common crafting commodities.", groups, rules });
}

function stable({ name, sourceIds, accessLevel }) {
  const groups = [
    g("Common Livestock", { itemTypes: ["loot"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: STABLE_COMMON_ANIMALS }),
    g("Standard Mounts", { itemTypes: ["loot"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: STABLE_STANDARD_MOUNTS }),
    g("Premium Mounts", { itemTypes: ["loot"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: STABLE_PREMIUM_MOUNTS }),
    g("Exotic Mounts", { itemTypes: ["loot"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: STABLE_EXOTIC_MOUNTS }),
    g("Stable Equipment", { itemTypes: ["loot", "equipment", "container"], magicalState: "mundane", documentNatures: ["sellable"], identityTerms: STABLE_SUPPLY_TERMS })
  ];
  const m = groupMap(groups);
  const rules = [
    r("random", "Common Livestock", { groupIds: [m["Common Livestock"]], varietyBase: 2, varietyScaling: "halfDown", quantityPreset: "normal", maximumPicks: 6 }),
    r("random", "Standard Mounts", { groupIds: [m["Standard Mounts"]], varietyBase: 1, varietyScaling: "thirdDown", quantityPreset: "normal", minimumVendorAccess: 2, maximumPicks: 4 }),
    r("random", "Premium Mounts", { groupIds: [m["Premium Mounts"]], varietyBase: 1, varietyScaling: "none", quantityPreset: "sparse", minimumVendorAccess: 3, maximumPicks: 2 }),
    r("random", "Exotic Mounts", { groupIds: [m["Exotic Mounts"]], varietyBase: 1, varietyScaling: "none", quantityPreset: "sparse", minimumVendorAccess: 4, maximumPicks: 1 }),
    r("guaranteed", "Stable Equipment", { groupIds: [m["Stable Equipment"]], coverage: "all", respectLevelRange: false, baseQuantity: 0, scaling: "players" })
  ];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "stable", theme: "stable", icon: "fa-solid fa-horse-head", description: "Livestock, mounts, tack, feed, carts, and stable equipment with visible Access tiers.", groups, rules });
}

function siege({ name, sourceIds, accessLevel }) {
  const groups = [g("Siege Weapons", { itemTypes: ["weapon"], subtypes: ["siege"], documentNatures: ["sellable"] }), g("Siege Supplies", { itemTypes: ["loot", "equipment", "consumable"], identityTerms: ["siege", "ballista", "catapult", "trebuchet", "battering ram", "mangonel"] })];
  const m = groupMap(groups);
  const rules = [r("random", "Siege Equipment", { groupIds: Object.values(m), varietyBase: 1, varietyScaling: "thirdDown", quantityPreset: "sparse", minimumVendorAccess: 2, maximumPicks: 5 })];
  return commonProfile({ name, sourceIds, accessLevel, presetId: "siege", theme: "blacksmith", icon: "fa-solid fa-tower-observation", description: "Siege weapons and dedicated siege supplies, isolated from ordinary blacksmith stock.", groups, rules });
}

export function createBlankSupplierProfile({ name, sourceIds = [] } = {}) {
  return createSupplierProfileV2({ name: name || "New Supplier", sourceIds, normalizeFirearms: true });
}

export function createHomebrewSupplierProfile({ templateId, accessLevel = "2", name, sourceIds = [] } = {}) {
  const args = { name: name || templateId || "New Supplier", sourceIds, accessLevel };
  if (templateId === "blacksmith") return blacksmith(args);
  if (templateId === "alchemist") return alchemist(args);
  if (templateId === "herbalist") return herbalist(args);
  if (templateId === "hunter") return hunter(args);
  if (templateId === "butcher") return butcher(args);
  if (templateId === "tavern-common") return tavern({ ...args, presetId: templateId, cultures: ["common", "mundane"], icon: "fa-solid fa-utensils", description: "Mundane/Common culinary products. Recipe Knowledge Sources are not included." });
  if (templateId === "tavern-dwarven") return tavern({ ...args, presetId: templateId, cultures: ["dwarven"], icon: "fa-solid fa-beer-mug-empty", description: "Dwarven culinary products. Recipe Knowledge Sources are not included." });
  if (templateId === "tavern-elven") return tavern({ ...args, presetId: templateId, cultures: ["elven"], icon: "fa-solid fa-wine-glass", description: "Elven culinary products. Recipe Knowledge Sources are not included." });
  if (templateId === "magic") return magic(args);
  if (templateId === "general") return general(args);
  if (templateId === "stable") return stable(args);
  if (templateId === "siege") return siege(args);
  return createBlankSupplierProfile(args);
}
