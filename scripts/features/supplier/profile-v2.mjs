function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRarity(value) {
  const normalized = normalizeText(value).replaceAll("-", "");
  const aliases = {
    "": "none", none: "none", common: "common", uncommon: "uncommon", rare: "rare",
    veryrare: "veryRare", legendary: "legendary", artifact: "artifact"
  };
  return aliases[normalized] ?? String(value ?? "none");
}

export const SUPPLIER_PROFILE_SCHEMA_VERSION = 2;
export const STOCK_RULE_MODES = ["guaranteed", "random", "specialExisting", "materialized"];
export const GROUP_SELECTION_MODES = ["dynamic", "explicit"];
export const STOCK_SCALING_MODES = ["none", "players", "halfDown", "thirdDown"];
export const ORGANIC_QUANTITY_PRESETS = ["sparse", "normal", "abundant", "custom"];

export function randomId() {
  return globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 18);
}

function clone(value) {
  return globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function strings(value) {
  return array(value).map(String).filter(Boolean);
}

function number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function createItemGroup(overrides = {}) {
  return {
    id: randomId(),
    name: "Item Group",
    enabled: true,
    selectionMode: "dynamic",
    selectionWeight: 1,
    sourceIds: [],
    itemTypes: [],
    subtypes: [],
    rarities: [],
    documentNatures: [],
    magicalState: "any",
    search: "",
    identityTerms: [],
    identityExclusions: [],
    selectedUuids: [],
    excludedUuids: [],
    crafting: {
      materialOnly: false,
      materialFamilies: [],
      materialNatures: [],
      materialCategories: [],
      materialTags: [],
      materialRequires: [],
      materialBiomes: [],
      productOnly: false,
      productCategories: [],
      productSubcategories: [],
      productCultures: [],
      productMealTypes: [],
      knowledgeOnly: false,
      excludeMaterials: false,
      excludeProducts: false,
      excludeKnowledge: true
    },
    ...clone(overrides),
    crafting: {
      materialOnly: false,
      materialFamilies: [],
      materialNatures: [],
      materialCategories: [],
      materialTags: [],
      materialRequires: [],
      materialBiomes: [],
      productOnly: false,
      productCategories: [],
      productSubcategories: [],
      productCultures: [],
      productMealTypes: [],
      knowledgeOnly: false,
      excludeMaterials: false,
      excludeProducts: false,
      excludeKnowledge: true,
      ...(clone(overrides.crafting ?? {}))
    }
  };
}

export function createStockRule(mode = "random", overrides = {}) {
  const base = {
    id: randomId(),
    enabled: true,
    name: mode === "guaranteed" ? "Guaranteed Stock"
      : mode === "random" ? "Random / Organic Stock"
        : mode === "specialExisting" ? "Existing Special Items"
          : "Materialized Special Items",
    mode,
    groupIds: [],
    baseGroupIds: [],
    templateGroupIds: [],
    respectLevelRange: true,
    chance: 100,
    minimumVendorAccess: 0,
    maximumVendorAccess: 0,
    minimumPicks: 0,
    maximumPicks: 0,
    coverage: "all",
    baseQuantity: 1,
    scaling: "none",
    unitsPerPick: 1,
    varietyBase: 3,
    varietyScaling: "halfDown",
    quantityPreset: "normal",
    customQuantityByRarity: {
      none: [2, 5],
      common: [2, 5],
      uncommon: [1, 3],
      rare: [1, 2],
      veryRare: [1, 1],
      legendary: [1, 1],
      artifact: [1, 1]
    },
    materializationRecipe: "",
    requireMagicalResult: mode === "materialized"
  };
  return { ...base, ...clone(overrides), mode };
}

export function createScrollStock(overrides = {}) {
  const source = clone(overrides);
  return {
    enabled: source.enabled === true,
    baseQuantity: Math.max(0, number(source.baseQuantity, 1)),
    scaling: STOCK_SCALING_MODES.includes(source.scaling) ? source.scaling : "halfDown"
  };
}

export function createSupplierProfileV2({
  name = "New Supplier",
  theme = "general",
  icon = "fa-solid fa-basket-shopping",
  sourceIds = [],
  accessLevel = "2",
  progressionProfileId = "world",
  presetId = "",
  normalizeFirearms = true,
  description = "",
  itemGroups = [],
  stockRules = [],
  scrollStock = null
} = {}) {
  return {
    profileSchemaVersion: SUPPLIER_PROFILE_SCHEMA_VERSION,
    id: randomId(),
    name,
    theme,
    icon,
    customIcon: "fa-solid fa-store",
    description,
    sourceIds: [...sourceIds],
    sourceSnapshot: true,
    progressionProfileId,
    homebrewAccessLevel: String(accessLevel),
    presetId: String(presetId ?? ""),
    normalizeFirearms: normalizeFirearms !== false,
    allowCursedItems: false,
    itemGroups: itemGroups.map(group => createItemGroup(group)),
    stockRules: stockRules.map(rule => createStockRule(rule.mode, rule)),
    scrollStock: createScrollStock(scrollStock ?? {}),
    bannedItems: [],
    mechanicalItemOverrides: []
  };
}

export function normalizeItemGroup(group = {}) {
  const normalized = createItemGroup(group);
  normalized.id = String(group.id ?? normalized.id);
  normalized.name = String(group.name ?? normalized.name);
  normalized.enabled = group.enabled !== false;
  normalized.selectionMode = GROUP_SELECTION_MODES.includes(group.selectionMode) ? group.selectionMode : "dynamic";
  normalized.selectionWeight = Math.max(0.01, number(group.selectionWeight, 1));
  normalized.sourceIds = strings(group.sourceIds);
  normalized.itemTypes = strings(group.itemTypes);
  normalized.subtypes = strings(group.subtypes);
  normalized.rarities = strings(group.rarities).map(normalizeRarity);
  normalized.documentNatures = strings(group.documentNatures);
  normalized.magicalState = ["any", "mundane", "magical"].includes(group.magicalState) ? group.magicalState : "any";
  normalized.search = String(group.search ?? "");
  normalized.identityTerms = strings(group.identityTerms);
  normalized.identityExclusions = strings(group.identityExclusions);
  normalized.selectedUuids = strings(group.selectedUuids);
  normalized.excludedUuids = strings(group.excludedUuids);
  const c = normalized.crafting;
  const source = group.crafting ?? {};
  c.materialOnly = source.materialOnly === true;
  c.materialFamilies = strings(source.materialFamilies);
  c.materialNatures = strings(source.materialNatures);
  c.materialCategories = strings(source.materialCategories);
  c.materialTags = strings(source.materialTags);
  c.materialRequires = strings(source.materialRequires);
  c.materialBiomes = strings(source.materialBiomes);
  c.productOnly = source.productOnly === true;
  c.productCategories = strings(source.productCategories);
  c.productSubcategories = strings(source.productSubcategories);
  c.productCultures = strings(source.productCultures);
  c.productMealTypes = strings(source.productMealTypes);
  c.knowledgeOnly = source.knowledgeOnly === true;
  c.excludeMaterials = source.excludeMaterials === true;
  c.excludeProducts = source.excludeProducts === true;
  c.excludeKnowledge = source.excludeKnowledge !== false;
  if (c.knowledgeOnly) c.excludeKnowledge = false;
  return normalized;
}

export function normalizeStockRule(rule = {}) {
  const mode = STOCK_RULE_MODES.includes(rule.mode) ? rule.mode : "random";
  const normalized = createStockRule(mode, rule);
  normalized.id = String(rule.id ?? normalized.id);
  normalized.name = String(rule.name ?? normalized.name);
  normalized.enabled = rule.enabled !== false;
  normalized.groupIds = strings(rule.groupIds);
  normalized.baseGroupIds = strings(rule.baseGroupIds);
  normalized.templateGroupIds = strings(rule.templateGroupIds);
  normalized.respectLevelRange = rule.respectLevelRange !== false;
  normalized.chance = Math.max(0, Math.min(100, number(rule.chance, 100)));
  normalized.minimumVendorAccess = Math.max(0, Math.min(4, Math.floor(number(rule.minimumVendorAccess, 0))));
  normalized.maximumVendorAccess = Math.max(0, Math.min(4, Math.floor(number(rule.maximumVendorAccess, 0))));
  normalized.minimumPicks = Math.max(0, Math.floor(number(rule.minimumPicks, 0)));
  normalized.maximumPicks = Math.max(0, Math.floor(number(rule.maximumPicks, 0)));
  normalized.coverage = rule.coverage === "pick" ? "pick" : "all";
  normalized.baseQuantity = Math.max(0, number(rule.baseQuantity, 1));
  normalized.scaling = STOCK_SCALING_MODES.includes(rule.scaling) ? rule.scaling : "none";
  normalized.unitsPerPick = Math.max(1, Math.floor(number(rule.unitsPerPick, 1)));
  normalized.varietyBase = Math.max(0, number(rule.varietyBase, 3));
  normalized.varietyScaling = STOCK_SCALING_MODES.includes(rule.varietyScaling) ? rule.varietyScaling : "halfDown";
  normalized.quantityPreset = ORGANIC_QUANTITY_PRESETS.includes(rule.quantityPreset) ? rule.quantityPreset : "normal";
  normalized.materializationRecipe = String(rule.materializationRecipe ?? "");
  normalized.requireMagicalResult = rule.requireMagicalResult === true || mode === "materialized";
  for (const rarity of ["none", "common", "uncommon", "rare", "veryRare", "legendary", "artifact"]) {
    const pair = array(rule.customQuantityByRarity?.[rarity]);
    const fallback = normalized.customQuantityByRarity[rarity];
    normalized.customQuantityByRarity[rarity] = [
      Math.max(1, Math.floor(number(pair[0], fallback[0]))),
      Math.max(1, Math.floor(number(pair[1], fallback[1])))
    ];
    if (normalized.customQuantityByRarity[rarity][1] < normalized.customQuantityByRarity[rarity][0]) {
      normalized.customQuantityByRarity[rarity].reverse();
    }
  }
  return normalized;
}

export function normalizeSupplierProfileV2(profile = {}) {
  const normalized = createSupplierProfileV2({
    name: String(profile.name ?? "New Supplier"),
    theme: String(profile.theme ?? "general"),
    icon: String(profile.icon ?? "fa-solid fa-store"),
    sourceIds: strings(profile.sourceIds),
    accessLevel: ["1", "2", "3", "4"].includes(String(profile.homebrewAccessLevel)) ? String(profile.homebrewAccessLevel) : "2",
    progressionProfileId: String(profile.progressionProfileId ?? "world"),
    presetId: String(profile.presetId ?? ""),
    normalizeFirearms: profile.normalizeFirearms !== false,
    description: String(profile.description ?? "")
  });
  normalized.id = String(profile.id ?? normalized.id);
  normalized.customIcon = String(profile.customIcon ?? normalized.customIcon);
  normalized.sourceSnapshot = profile.sourceSnapshot !== false;
  normalized.allowCursedItems = profile.allowCursedItems === true;
  normalized.itemGroups = array(profile.itemGroups).map(normalizeItemGroup);
  normalized.stockRules = array(profile.stockRules).map(normalizeStockRule);
  normalized.scrollStock = createScrollStock(profile.scrollStock ?? {});
  normalized.bannedItems = clone(array(profile.bannedItems));
  normalized.mechanicalItemOverrides = clone(array(profile.mechanicalItemOverrides));
  return normalized;
}

export function scaleCount(base, mode, players) {
  const value = Math.max(0, number(base, 0));
  const party = Math.max(1, Math.floor(number(players, 1)));
  if (mode === "players") return Math.max(0, Math.floor(value + party));
  if (mode === "halfDown") return Math.max(0, Math.floor(value + Math.floor(party / 2)));
  if (mode === "thirdDown") return Math.max(0, Math.floor(value + Math.floor(party / 3)));
  return Math.max(0, Math.floor(value));
}

export function quantityRangeForRarity(rule, rarity, players = 4, access = 2) {
  const normalized = normalizeRarity(rarity);
  const preset = rule.quantityPreset ?? "normal";
  const tables = {
    sparse: {
      none: [1, 3], common: [1, 3], uncommon: [1, 2], rare: [1, 1], veryRare: [1, 1], legendary: [1, 1], artifact: [1, 1]
    },
    normal: {
      none: [2, 5], common: [2, 5], uncommon: [1, 3], rare: [1, 2], veryRare: [1, 1], legendary: [1, 1], artifact: [1, 1]
    },
    abundant: {
      none: [4, 8], common: [4, 8], uncommon: [2, 5], rare: [1, 3], veryRare: [1, 2], legendary: [1, 1], artifact: [1, 1]
    }
  };
  const source = preset === "custom" ? rule.customQuantityByRarity : tables[preset] ?? tables.normal;
  // The Builder intentionally presents one "Common / Mundane" row and one
  // Legendary row. Keep the runtime faithful to that visible UI instead of
  // letting hidden `none`/`artifact` values behave differently.
  const lookupRarity = preset === "custom" && normalized === "none" ? "common"
    : preset === "custom" && normalized === "artifact" ? "legendary"
      : normalized;
  const pair = source?.[lookupRarity] ?? source?.none ?? [1, 1];
  const partyFactor = Math.max(0, Math.floor((Math.max(1, Number(players ?? 4)) - 4) / 3));
  const accessFactor = Math.max(0, Math.floor((Math.max(1, Number(access ?? 2)) - 2) / 2));
  const rarityAllowsScaling = ["none", "common", "uncommon"].includes(normalized);
  const add = rarityAllowsScaling ? partyFactor + accessFactor : 0;
  return [Math.max(1, Number(pair[0] ?? 1)), Math.max(1, Number(pair[1] ?? 1) + add)];
}

function textMatches(entry, query) {
  const needle = normalizeText(query);
  if (!needle) return true;
  return normalizeText([
    entry.name, entry.identifier, entry.type, entry.subtype,
    ...(entry.subtypeAliases ?? []), entry.packLabel, entry.packageName,
    entry.craftingMaterialFamily, entry.craftingMaterialNature, entry.craftingMaterialCategory,
    ...(entry.craftingMaterialTags ?? []), ...(entry.craftingMaterialRequires ?? []), ...(entry.craftingMaterialBiomes ?? []),
    entry.craftingProductCategory, entry.craftingProductSubcategory, entry.craftingProductCulture, entry.craftingProductMealType
  ].filter(Boolean).join(" ")).includes(needle);
}

function intersects(actual, expected) {
  if (!expected?.length) return true;
  const values = new Set((actual ?? []).map(value => normalizeText(value)));
  return expected.some(value => values.has(normalizeText(value)));
}

function oneOf(actual, expected) {
  if (!expected?.length) return true;
  const value = normalizeText(actual);
  return expected.some(item => normalizeText(item) === value);
}

export function itemGroupMatchesEntry(group, entry) {
  if (!group?.enabled || !entry) return false;
  if (group.selectionMode === "explicit") return new Set(group.selectedUuids ?? []).has(entry.uuid);
  if (group.sourceIds?.length) {
    const sourceMatch = group.sourceIds.includes(entry.packId)
      || (entry.sourceVariants ?? []).some(variant => group.sourceIds.includes(variant.packId));
    if (!sourceMatch) return false;
  }
  // Siege is valid merchandise, but broad weapon filters must not silently
  // absorb catapults/ballistae. A dynamic group must explicitly select the
  // native `siege` subtype; exact/explicit selections remain authoritative.
  const subtypeKeys = new Set(entry.subtypeKeys ?? [entry.primarySubtypeKey].filter(Boolean));
  if (subtypeKeys.has("siege") && !(group.subtypes ?? []).includes("siege")) return false;
  if (group.itemTypes?.length && !group.itemTypes.includes(entry.type)) return false;
  if (group.subtypes?.length && !group.subtypes.some(subtype => (entry.subtypeKeys ?? [entry.primarySubtypeKey]).includes(subtype))) return false;
  if (group.rarities?.length && !group.rarities.includes(normalizeRarity(entry.rarity))) return false;
  if (group.documentNatures?.length && !group.documentNatures.includes(String(entry.documentNature ?? "sellable"))) return false;
  if (group.magicalState === "magical" && !entry.isMagical) return false;
  if (group.magicalState === "mundane" && entry.isMagical) return false;
  if (!textMatches(entry, group.search)) return false;
  const identity = normalizeText([entry.name, entry.identifier, entry.baseItem, ...(entry.subtypeAliases ?? [])].filter(Boolean).join(" "));
  if (group.identityTerms?.length && !group.identityTerms.some(term => identity.includes(normalizeText(term)))) return false;
  if (group.identityExclusions?.length && group.identityExclusions.some(term => identity.includes(normalizeText(term)))) return false;
  if (new Set(group.excludedUuids ?? []).has(entry.uuid)) return false;

  const c = group.crafting ?? {};
  if (c.excludeMaterials && entry.craftingMaterial === true) return false;
  if (c.excludeProducts && entry.craftingProduct === true) return false;
  if (!c.knowledgeOnly && c.excludeKnowledge !== false && entry.craftingKnowledgeRecipeId) return false;
  if (c.materialOnly && entry.craftingMaterial !== true) return false;
  if (!oneOf(entry.craftingMaterialFamily, c.materialFamilies)) return false;
  if (!oneOf(entry.craftingMaterialNature, c.materialNatures)) return false;
  if (!oneOf(entry.craftingMaterialCategory, c.materialCategories)) return false;
  if (!intersects(entry.craftingMaterialTags, c.materialTags)) return false;
  if (!intersects(entry.craftingMaterialRequires, c.materialRequires)) return false;
  if (!intersects(entry.craftingMaterialBiomes, c.materialBiomes)) return false;
  if (c.productOnly && entry.craftingProduct !== true) return false;
  if (!oneOf(entry.craftingProductCategory, c.productCategories)) return false;
  if (!oneOf(entry.craftingProductSubcategory, c.productSubcategories)) return false;
  if (!oneOf(entry.craftingProductCulture, c.productCultures)) return false;
  if (!oneOf(entry.craftingProductMealType, c.productMealTypes)) return false;
  if (c.knowledgeOnly && !entry.craftingKnowledgeRecipeId) return false;
  return true;
}

export function summarizeItemGroup(group) {
  const parts = [];
  if (Math.abs(Number(group.selectionWeight ?? 1) - 1) > 0.001) parts.push(`weight ×${Number(group.selectionWeight).toFixed(2).replace(/\.00$/, "")}`);
  if (group.selectionMode === "explicit") parts.push(`${group.selectedUuids?.length ?? 0} selected`);
  else {
    if (group.sourceIds?.length) parts.push(`${group.sourceIds.length} source${group.sourceIds.length === 1 ? "" : "s"}`);
    if (group.itemTypes?.length) parts.push(group.itemTypes.join(", "));
    if (group.subtypes?.length) parts.push(group.subtypes.join(", "));
    if (group.crafting?.materialCategories?.length) parts.push(`materials: ${group.crafting.materialCategories.join(", ")}`);
    if (group.crafting?.productCultures?.length) parts.push(`culture: ${group.crafting.productCultures.join(", ")}`);
  }
  return parts.join(" • ") || "All matching merchandise";
}
