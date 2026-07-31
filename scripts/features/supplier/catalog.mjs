import { MODULE_ID } from "./constants.mjs";
import { getConfiguration } from "./settings.mjs";
import {
  inspectBlueprintSupport,
  isBlueprintCandidateData,
  isSelfContainedSellableData
} from "../../core/materialization/index.mjs";

const INDEX_FIELDS = [
  "name",
  "type",
  "img",
  "system.identifier",
  "system.rarity",
  "system.type.value",
  "system.type.baseItem",
  "system.price.value",
  "system.price.denomination",
  "system.quantity",
  "system.properties",
  "system.magicalBonus",
  "system.damage.base.types",
  "system.ammunition.type",
  "system.level",
  "system.school",
  "system.range.value",
  "system.range.long",
  "system.range.units",
  "system.armor.type",
  "system.armor.value",
  "system.activities",
  "effects"
];

const SUBTYPE_LABEL_KEYS = {
  simpleM: "DND5E_SUPPLIER.Subtype.simpleM",
  simpleR: "DND5E_SUPPLIER.Subtype.simpleR",
  martialM: "DND5E_SUPPLIER.Subtype.martialM",
  martialR: "DND5E_SUPPLIER.Subtype.martialR",
  lightArmor: "DND5E_SUPPLIER.Subtype.lightArmor",
  mediumArmor: "DND5E_SUPPLIER.Subtype.mediumArmor",
  heavyArmor: "DND5E_SUPPLIER.Subtype.heavyArmor",
  shield: "DND5E_SUPPLIER.Subtype.shield",
  clothing: "DND5E_SUPPLIER.Subtype.clothing",
  ring: "DND5E_SUPPLIER.Subtype.ring",
  rod: "DND5E_SUPPLIER.Subtype.rod",
  trinket: "DND5E_SUPPLIER.Subtype.trinket",
  wand: "DND5E_SUPPLIER.Subtype.wand",
  wondrous: "DND5E_SUPPLIER.Subtype.wondrous",
  potion: "DND5E_SUPPLIER.Subtype.potion",
  poison: "DND5E_SUPPLIER.Subtype.poison",
  scroll: "DND5E_SUPPLIER.Subtype.scroll",
  food: "DND5E_SUPPLIER.Subtype.food",
  ammunition: "DND5E_SUPPLIER.Subtype.ammunition"
};

const SYSTEM_MECHANICAL_ITEM_RULES = [
  {
    id: "unarmedStrike",
    types: new Set(["weapon"]),
    identifiers: new Set(["unarmed-strike", "unarmedstrike"]),
    names: new Set(["unarmed-strike"])
  },
  {
    id: "tableResult",
    types: new Set(["consumable"]),
    identifiers: new Set(["rogue"]),
    names: new Set(["rogue"])
  }
];

const GENERATOR_ITEM_RULES = [
  {
    id: "ammunitionVaries",
    magical: false,
    types: new Set(["consumable", "loot", "equipment"]),
    values: new Set(["ammunition-varies", "ammunition-any", "ammunition-variable", "ammunition"])
  },
  {
    id: "ammunitionEnhancement",
    magical: true,
    types: new Set(["consumable", "loot", "equipment"]),
    values: new Set([
      "ammunition-1-2-or-3", "ammunition-plus-1-plus-2-or-plus-3",
      "ammunition-1-2-3", "ammunition-plus-1-plus-2-plus-3"
    ])
  },
  {
    id: "weaponEnhancement",
    magical: true,
    types: new Set(["weapon"]),
    values: new Set([
      "weapon-1-2-or-3", "weapon-plus-1-plus-2-or-plus-3",
      "weapon-1-2-3", "weapon-plus-1-plus-2-plus-3"
    ])
  },
  {
    id: "armorEnhancement",
    magical: true,
    types: new Set(["equipment"]),
    values: new Set([
      "armor-1-2-or-3", "armor-plus-1-plus-2-or-plus-3",
      "armor-1-2-3", "armor-plus-1-plus-2-plus-3"
    ])
  },
  {
    id: "shieldEnhancement",
    magical: true,
    types: new Set(["equipment"]),
    values: new Set([
      "shield-1-2-or-3", "shield-plus-1-plus-2-or-plus-3",
      "shield-1-2-3", "shield-plus-1-plus-2-plus-3"
    ])
  }
];

const FIREARM_WEAPON_TERMS = [
  "firearm", "pistol", "musket", "blunderbuss", "arquebus", "pepperbox", "revolver", "rifle", "shotgun",
  "arma-de-fogo", "pistola", "mosquete", "bacamarte", "arcabuz", "revolver", "rifle", "espingarda"
];

const FIREARM_AMMUNITION_TERMS = [
  "firearm-ammunition", "firearm-bullet", "firearm-bullets", "pistol-ammunition", "pistol-bullet", "pistol-bullets",
  "musket-ammunition", "musket-ball", "musket-balls", "cartridge", "cartridges", "shotgun-shell", "shotgun-shells",
  "municao-de-arma-de-fogo", "bala-de-pistola", "balas-de-pistola", "bala-de-mosquete", "balas-de-mosquete",
  "cartucho", "cartuchos"
];

const FIREARM_SUPPLY_TERMS = [
  "gunpowder", "gun-powder", "powder-horn", "powder-keg", "smokepowder", "smoke-powder",
  "polvora", "chifre-de-polvora", "barril-de-polvora"
];

let catalogCache = null;
let cacheSignature = "";

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeRarity(value) {
  const normalized = normalizeText(value).replaceAll("-", "");
  if (!normalized) return "none";
  if (normalized === "veryrare") return "veryRare";
  return normalized;
}

const VARIANT_FAMILY_RULES = Object.freeze([
  {
    id: "wand-of-the-war-mage",
    displayName: "Wand of the War Mage",
    terms: ["wand-of-the-war-mage", "wand-of-war-mage"]
  }
]);

function variantBonus(entry) {
  const explicit = Number(entry?.enhancement ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(3, Math.floor(explicit));
  const match = String(entry?.name ?? "").match(/(?:^|[,\s])\+\s*([123])(?:\s|$|\))/);
  return match ? Number(match[1]) : 0;
}

export function variantFamilyInfo(entry) {
  const identity = normalizeText(`${entry?.identifier ?? ""} ${entry?.name ?? ""}`);
  const rule = VARIANT_FAMILY_RULES.find(candidate => candidate.terms.some(term => identity.includes(term)));
  if (!rule) return null;
  const bonus = variantBonus(entry);
  const placeholder = !bonus && /(?:1-2-(?:or-)?3|plus-1-plus-2-(?:or-)?plus-3)/.test(identity);
  return { ...rule, bonus, concrete: bonus > 0, placeholder };
}

export function mechanicalItemRule(entry) {
  const type = String(entry?.type ?? "");
  const identifier = normalizeText(entry?.identifier);
  const name = normalizeText(entry?.name);
  return SYSTEM_MECHANICAL_ITEM_RULES.find(rule =>
    rule.types.has(type)
    && ((identifier && rule.identifiers.has(identifier)) || rule.names.has(name))
  ) ?? null;
}

export function generatorItemRule(entry) {
  const type = String(entry?.type ?? "");
  const values = [normalizeText(entry?.identifier), normalizeText(entry?.name)].filter(Boolean);
  const exact = GENERATOR_ITEM_RULES.find(rule => rule.types.has(type) && values.some(value => rule.values.has(value)));
  if (exact) {
    const matchedValue = values.find(value => exact.values.has(value)) ?? "";
    const baseHint = exact.id === "ammunitionVaries"
      ? "ammunition"
      : matchedValue.replace(/-(?:plus-)?1-(?:plus-)?2-(?:or-)?(?:plus-)?3$/, "");
    return { ...exact, baseHint };
  }

  const enhancementPattern = /-(?:plus-)?1-(?:plus-)?2-(?:or-)?(?:plus-)?3$/;
  const variableValue = values.find(value => enhancementPattern.test(value));
  if (!variableValue) return null;
  const baseHint = variableValue.replace(enhancementPattern, "");
  if (type === "weapon") return { id: "weaponEnhancement", magical: true, baseHint };
  if (type === "equipment") {
    const shield = String(entry?.armorCategory ?? "") === "shield" || baseHint.includes("shield");
    return { id: shield ? "shieldEnhancement" : "armorEnhancement", magical: true, baseHint };
  }
  if (["consumable", "loot", "equipment"].includes(type)
    && new Set(entry?.subtypeKeys ?? [entry?.primarySubtypeKey].filter(Boolean)).has("ammunition")) {
    return { id: "ammunitionEnhancement", magical: true, baseHint };
  }
  return null;
}

export function isGeneratorItem(entry) {
  return Boolean(entry?.generatorKind || entry?.materializerKind === "generator" || generatorItemRule(entry));
}

export function isBlueprintItem(entry) {
  return Boolean(entry?.blueprintCandidate || entry?.materializerKind === "blueprint");
}

export function isVariantFamilyItem(entry) {
  return Boolean(entry?.variantFamily || entry?.materializerKind === "variant");
}

export function isAmmunitionEntry(entry) {
  const subtypeKeys = new Set(entry?.subtypeKeys ?? [entry?.primarySubtypeKey].filter(Boolean));
  if (subtypeKeys.has("ammunition")) return true;
  const identity = normalizeText(`${entry?.identifier ?? ""} ${entry?.name ?? ""} ${entry?.baseItem ?? ""}`);
  return ["ammunition", "arrow", "crossbow-bolt", "blowgun-needle"].some(term => identity.includes(term));
}

export function isMaterializerItem(entry) {
  return Boolean(entry?.documentNature === "materializer" || isGeneratorItem(entry) || isBlueprintItem(entry) || isVariantFamilyItem(entry));
}

export function isSupportedMaterializerEntry(entry) {
  if (!isMaterializerItem(entry)) return false;
  if (isGeneratorItem(entry)) return true;
  return entry?.materializerSupported !== false;
}

export function documentNature(entry) {
  if (isMechanicalItem(entry)) return "mechanical";
  if (isMaterializerItem(entry)) return "materializer";
  return "sellable";
}

function includesNormalizedTerm(entry, terms) {
  const values = [entry?.identifier, entry?.name, entry?.baseItem]
    .map(normalizeText)
    .filter(Boolean);
  return terms.some(term => values.some(value => value === term || value.includes(term)));
}

export function firearmClassification(entry) {
  const type = String(entry?.type ?? "");
  const properties = new Set((entry?.properties ?? []).map(value => normalizeText(value).replaceAll("-", "")));
  const subtypeKeys = new Set(entry?.subtypeKeys ?? [entry?.primarySubtypeKey].filter(Boolean));
  const hasFirearmProperty = properties.has("fir") || properties.has("firearm");
  const firearmWeapon = type === "weapon" && (hasFirearmProperty || includesNormalizedTerm(entry, FIREARM_WEAPON_TERMS));
  const slingAmmunition = includesNormalizedTerm(entry, ["sling-bullet", "sling-bullets", "bala-de-funda", "balas-de-funda"]);
  const firearmAmmunition = ["consumable", "loot", "equipment"].includes(type)
    && subtypeKeys.has("ammunition")
    && !slingAmmunition
    && (includesNormalizedTerm(entry, FIREARM_AMMUNITION_TERMS)
      || includesNormalizedTerm(entry, FIREARM_WEAPON_TERMS)
      || includesNormalizedTerm(entry, ["bullet", "bullets", "bala", "balas"]));
  const firearmSupply = includesNormalizedTerm(entry, FIREARM_SUPPLY_TERMS);
  return {
    firearmWeapon,
    firearmAmmunition,
    firearmSupply,
    firearmRelated: firearmWeapon || firearmAmmunition || firearmSupply
  };
}

export function isFirearmEntry(entry) {
  return Boolean(entry?.isFirearmWeapon || firearmClassification(entry).firearmWeapon);
}

export function isFirearmAmmunition(entry) {
  return Boolean(entry?.isFirearmAmmunition || firearmClassification(entry).firearmAmmunition);
}

export function isFirearmSupply(entry) {
  return Boolean(entry?.isFirearmSupply || firearmClassification(entry).firearmSupply);
}

export function isFirearmRelated(entry) {
  if (entry?.isFirearmRelated !== undefined) return entry.isFirearmRelated === true;
  return firearmClassification(entry).firearmRelated;
}

export function isMechanicalItem(entry) {
  return Boolean(entry?.isMechanical || mechanicalItemRule(entry));
}

export function isMechanicalItemExcluded(entry, profile, configuration = getConfiguration()) {
  if (!isMechanicalItem(entry)) return false;
  const override = (profile?.mechanicalItemOverrides ?? []).find(item => item?.uuid === entry.uuid);
  if (override) return override.excluded === true;
  return configuration?.excludeMechanicalItems !== false;
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value === "object") {
    if (Array.isArray(value.value)) return value.value;
    return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key);
  }
  return [value];
}

function parseEnhancement(name, explicitBonus) {
  const numeric = Number(explicitBonus ?? 0);
  if (Number.isFinite(numeric) && numeric > 0) return Math.min(3, Math.floor(numeric));
  const match = String(name ?? "").match(/(?:^|\s)\+([123])(?:\s|$|\))/);
  return match ? Number(match[1]) : 0;
}

function classifyWeapon(subtype) {
  const raw = String(subtype ?? "");
  const normalized = normalizeText(raw);
  let category = "";
  let mode = "";

  if (/^simple/i.test(raw) || normalized.includes("simple")) category = "simple";
  if (/^martial/i.test(raw) || normalized.includes("martial")) category = "martial";

  if (/[rR]$/.test(raw) || normalized.includes("ranged")) mode = "ranged";
  if (/[mM]$/.test(raw) || normalized.includes("melee")) mode = "melee";

  return { category, mode };
}

function classifyArmor(type, subtype, armorType) {
  if (type !== "equipment") return "";
  const values = [subtype, armorType].map(normalizeText);
  for (const candidate of ["light", "medium", "heavy", "shield"]) {
    if (values.includes(candidate) || values.some(value => value.includes(candidate))) return candidate;
  }
  return "";
}

export function nativeSubtypeKey({ type, subtype, armorCategory = "", weaponCategory = "", weaponMode = "" }) {
  if (type === "weapon") {
    if (weaponCategory === "simple" && weaponMode === "melee") return "simpleM";
    if (weaponCategory === "simple" && weaponMode === "ranged") return "simpleR";
    if (weaponCategory === "martial" && weaponMode === "melee") return "martialM";
    if (weaponCategory === "martial" && weaponMode === "ranged") return "martialR";
  }
  if (type === "equipment") {
    if (armorCategory === "light") return "lightArmor";
    if (armorCategory === "medium") return "mediumArmor";
    if (armorCategory === "heavy") return "heavyArmor";
    if (armorCategory === "shield") return "shield";
  }

  const normalized = normalizeText(subtype).replaceAll("-", "");
  const aliases = {
    simplem: "simpleM",
    simpler: "simpleR",
    martialm: "martialM",
    martialr: "martialR",
    lightarmor: "lightArmor",
    mediumarmor: "mediumArmor",
    heavyarmor: "heavyArmor",
    wondrousitem: "wondrous",
    wondrous: "wondrous",
    ammo: "ammunition"
  };
  return aliases[normalized] ?? normalizeText(subtype);
}

export function nativeSubtypeLabel(key) {
  const localizationKey = SUBTYPE_LABEL_KEYS[key];
  if (localizationKey && game?.i18n?.has?.(localizationKey)) return game.i18n.localize(localizationKey);
  if (localizationKey) {
    const translated = game?.i18n?.localize?.(localizationKey);
    if (translated && translated !== localizationKey) return translated;
  }
  return titleCase(key);
}

export function entryMatchesSubtype(entry, subtypeKey) {
  const wanted = nativeSubtypeKey({ type: entry.type, subtype: subtypeKey });
  return new Set(entry.subtypeKeys ?? [entry.primarySubtypeKey]).has(wanted);
}

export function healingPotionTier(entry) {
  const value = normalizeText(`${entry.identifier ?? ""} ${entry.name ?? ""}`);
  if (!value.includes("potion") || !value.includes("healing")) return "";
  if (value.includes("supreme")) return "supreme";
  if (value.includes("superior")) return "superior";
  if (value.includes("greater")) return "greater";
  return "basic";
}

export function entryFamilyIds(entry) {
  const families = [];
  if (healingPotionTier(entry)) families.push("healingPotions");
  return families;
}

export function canonicalKey(entry) {
  const variant = entry?.variantFamily || variantFamilyInfo(entry)?.id;
  if (variant) return `variant:${variant}`;
  const identifier = normalizeText(entry.identifier);
  if (identifier) return `identifier:${identifier}`;
  return `name:${normalizeText(entry.name)}|type:${normalizeText(entry.type)}`;
}

export function banKey(entry) {
  return `name:${normalizeText(entry.name)}|type:${normalizeText(entry.type)}`;
}

export function familyMemberKey(entry, familyId) {
  if (familyId === "healingPotions") return `${familyId}:${healingPotionTier(entry) || canonicalKey(entry)}`;
  return `${familyId}:${canonicalKey(entry)}`;
}

function sourceSignature(configuration) {
  return JSON.stringify((configuration.sources ?? []).map(source => [source.id, source.enabled, source.priority]));
}

export function clearCatalogCache() {
  catalogCache = null;
  cacheSignature = "";
}

function mergeEntryGroup(group) {
  if (!group?.length) return null;
  const primary = group[0];
  const subtypeKeys = [];
  const subtypeAliases = [];
  const familyIds = new Set();
  for (const variant of group) {
    for (const key of variant.subtypeKeys ?? [variant.primarySubtypeKey]) {
      if (key && !subtypeKeys.includes(key)) subtypeKeys.push(key);
    }
    if (variant.subtype && !subtypeAliases.includes(variant.subtype)) subtypeAliases.push(variant.subtype);
    for (const familyId of variant.familyIds ?? []) familyIds.add(familyId);
  }

  const variantFamily = group.find(entry => entry.variantFamily)?.variantFamily ?? "";
  const variantRule = group.find(entry => entry.variantFamily)?.variantFamilyInfo ?? null;
  const concreteVariants = group.filter(entry => entry.variantConcrete === true && Number(entry.enhancement ?? 0) > 0);
  const placeholderVariant = group.find(entry => entry.variantPlaceholder === true) ?? null;
  const isVariant = Boolean(variantFamily);
  const isMechanicalGroup = group.every(variant => variant.isMechanical === true);
  const groupNature = isMechanicalGroup
    ? "mechanical"
    : isVariant
      ? "materializer"
      : group.some(variant => variant.documentNature === "materializer") ? "materializer" : "sellable";
  const groupMaterializerKind = isVariant
    ? "variant"
    : group.find(variant => variant.materializerKind)?.materializerKind ?? "";

  return {
    ...primary,
    ...(isVariant ? {
      name: variantRule?.displayName ?? primary.name,
      identifier: variantFamily,
      enhancement: 0,
      rarity: "varies",
      isMagical: true
    } : {}),
    subtypeKeys,
    subtypeAliases,
    familyIds: [...familyIds],
    variantFamily,
    variantFamilyInfo: variantRule,
    variantConcrete: false,
    variantPlaceholder: Boolean(placeholderVariant),
    isMechanical: isMechanicalGroup,
    mechanicalReason: group.find(variant => variant.mechanicalReason)?.mechanicalReason ?? "",
    generatorKind: group.find(variant => variant.generatorKind)?.generatorKind ?? "",
    generatorBaseHint: group.find(variant => variant.generatorBaseHint)?.generatorBaseHint ?? "",
    generatorMagical: group.some(variant => variant.generatorMagical === true),
    blueprintCandidate: isVariant ? false : group.some(variant => variant.blueprintCandidate === true),
    documentNature: groupNature,
    materializerKind: groupMaterializerKind,
    materializerFamily: isVariant ? variantFamily : group.find(variant => variant.materializerFamily)?.materializerFamily ?? "",
    materializerSourceUuid: isVariant
      ? (placeholderVariant?.uuid ?? concreteVariants[0]?.uuid ?? "")
      : group.find(variant => variant.materializerKind)?.uuid ?? "",
    materializerSupported: isVariant
      ? concreteVariants.length > 0
      : group.some(variant => variant.materializerSupported === true),
    materializerSupportReason: isVariant
      ? (concreteVariants.length ? "supportedVariantFamily" : "missingConcreteVariants")
      : group.find(variant => variant.materializerSupportReason)?.materializerSupportReason ?? "",
    isFirearmWeapon: group.some(variant => variant.isFirearmWeapon === true),
    isFirearmAmmunition: group.some(variant => variant.isFirearmAmmunition === true),
    isFirearmSupply: group.some(variant => variant.isFirearmSupply === true),
    isFirearmRelated: group.some(variant => variant.isFirearmRelated === true),
    sourceVariants: group.map(variant => ({
      uuid: variant.uuid,
      packId: variant.packId,
      packLabel: variant.packLabel,
      packageName: variant.packageName,
      name: variant.name,
      img: variant.img,
      type: variant.type,
      identifier: variant.identifier,
      baseItem: variant.baseItem,
      subtype: variant.subtype,
      subtypeKey: variant.primarySubtypeKey,
      rarity: variant.rarity,
      enhancement: variant.enhancement,
      priceValue: variant.priceValue,
      priceDenomination: variant.priceDenomination,
      isMagical: variant.isMagical === true,
      isMechanical: variant.isMechanical === true,
      mechanicalReason: variant.mechanicalReason ?? "",
      generatorKind: variant.generatorKind ?? "",
      generatorBaseHint: variant.generatorBaseHint ?? "",
      blueprintCandidate: variant.blueprintCandidate === true,
      variantFamily: variant.variantFamily ?? "",
      variantConcrete: variant.variantConcrete === true,
      variantPlaceholder: variant.variantPlaceholder === true,
      documentNature: variant.documentNature ?? "sellable",
      materializerKind: variant.materializerKind ?? "",
      materializerFamily: variant.materializerFamily ?? "",
      materializerSourceUuid: variant.materializerKind ? variant.uuid : "",
      materializerSupported: variant.materializerSupported === true,
      materializerSupportReason: variant.materializerSupportReason ?? "",
      isFirearmRelated: variant.isFirearmRelated === true
    }))
  };
}

export async function buildCatalog({ force = false, configurationOverride = null } = {}) {
  const configuration = configurationOverride ?? getConfiguration();
  const signature = sourceSignature(configuration);
  if (!force && catalogCache && cacheSignature === signature) return catalogCache;

  const enabledSources = (configuration.sources ?? [])
    .filter(source => source.enabled)
    .sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0));

  const rawEntries = [];
  for (const source of enabledSources) {
    const pack = game.packs.get(source.id);
    if (!pack || pack.documentName !== "Item") continue;

    let index;
    try {
      index = await pack.getIndex({ fields: INDEX_FIELDS });
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to index ${source.id}`, error);
      continue;
    }

    for (const record of index) {
      const subtype = foundry.utils.getProperty(record, "system.type.value") ?? "";
      const armorType = foundry.utils.getProperty(record, "system.armor.type") ?? "";
      const properties = toArray(foundry.utils.getProperty(record, "system.properties")).map(String);
      const enhancement = parseEnhancement(record.name, foundry.utils.getProperty(record, "system.magicalBonus"));
      const weapon = record.type === "weapon" ? classifyWeapon(subtype) : { category: "", mode: "" };
      const armorCategory = classifyArmor(record.type, subtype, armorType);
      const rarity = normalizeRarity(foundry.utils.getProperty(record, "system.rarity"));
      const isMagical = enhancement > 0 || rarity !== "none" || properties.includes("mgc");
      let primarySubtypeKey = nativeSubtypeKey({
        type: record.type,
        subtype,
        armorCategory,
        weaponCategory: weapon.category,
        weaponMode: weapon.mode
      });

      const identity = {
        type: record.type,
        name: record.name,
        identifier: foundry.utils.getProperty(record, "system.identifier") ?? "",
        baseItem: foundry.utils.getProperty(record, "system.type.baseItem") ?? "",
        properties,
        primarySubtypeKey,
        subtypeKeys: primarySubtypeKey ? [primarySubtypeKey] : [],
        armorCategory,
        enhancement
      };
      if (["consumable", "loot", "equipment"].includes(record.type) && isAmmunitionEntry(identity)) {
        primarySubtypeKey = "ammunition";
        identity.primarySubtypeKey = primarySubtypeKey;
        identity.subtypeKeys = [primarySubtypeKey];
      }
      const mechanicalRule = mechanicalItemRule(identity);
      const variantInfo = variantFamilyInfo(identity);
      const generatorRule = variantInfo ? null : generatorItemRule(identity);
      const selfContained = isSelfContainedSellableData(record);
      const blueprintCandidate = !variantInfo && !generatorRule && !selfContained && isBlueprintCandidateData(record);
      const blueprintSupport = blueprintCandidate ? inspectBlueprintSupport(record) : null;
      const firearm = firearmClassification(identity);
      const nature = mechanicalRule
        ? "mechanical"
        : (variantInfo || generatorRule || blueprintCandidate ? "materializer" : "sellable");
      const materializerKind = variantInfo ? "variant" : generatorRule ? "generator" : (blueprintCandidate ? "blueprint" : "");

      const entry = {
        id: record._id,
        uuid: record.uuid ?? `Compendium.${pack.collection}.Item.${record._id}`,
        packId: pack.collection,
        packLabel: pack.metadata.label,
        packageName: pack.metadata.packageName,
        priority: Number(source.priority ?? 0),
        name: record.name,
        type: record.type,
        img: record.img,
        identifier: foundry.utils.getProperty(record, "system.identifier") ?? "",
        rarity,
        subtype,
        primarySubtypeKey,
        subtypeKeys: primarySubtypeKey ? [primarySubtypeKey] : [],
        subtypeAliases: subtype ? [subtype] : [],
        baseItem: foundry.utils.getProperty(record, "system.type.baseItem") ?? "",
        priceValue: Number(foundry.utils.getProperty(record, "system.price.value") ?? 0),
        priceDenomination: foundry.utils.getProperty(record, "system.price.denomination") ?? "gp",
        properties,
        enhancement,
        isMagical: variantInfo ? true : generatorRule ? generatorRule.magical === true : isMagical,
        variantFamily: variantInfo?.id ?? "",
        variantFamilyInfo: variantInfo,
        variantConcrete: variantInfo?.concrete === true,
        variantPlaceholder: variantInfo?.placeholder === true,
        generatorKind: generatorRule?.id ?? "",
        generatorBaseHint: generatorRule?.baseHint ?? "",
        generatorMagical: generatorRule?.magical === true,
        blueprintCandidate,
        documentNature: nature,
        materializerKind,
        materializerFamily: variantInfo?.id ?? generatorRule?.id ?? (blueprintCandidate ? normalizeText(identity.identifier || identity.name) : ""),
        materializerSourceUuid: variantInfo || generatorRule || blueprintCandidate ? (record.uuid ?? `Compendium.${pack.collection}.Item.${record._id}`) : "",
        // An index can omit parts of embedded Active Effects, so most native
        // blueprint candidates remain eligible for full-document validation at
        // generation time. Explicit Item riders are the exception because the
        // current Core intentionally refuses to create a partial result.
        materializerSupported: Boolean(variantInfo?.concrete)
          || Boolean(generatorRule)
          || Boolean(blueprintCandidate && blueprintSupport?.reason !== "hasItemRiders"),
        materializerSupportReason: variantInfo
          ? (variantInfo.concrete ? "concreteVariant" : "variantFamilyPlaceholder")
          : generatorRule
            ? "supportedGenerator"
            : (blueprintSupport?.supported
              ? "supportedBlueprint"
              : blueprintSupport?.reason === "hasItemRiders"
                ? "unsupportedItemRiders"
                : `runtimeValidationRequired:${blueprintSupport?.reason ?? "unknown"}`),
        isFirearmWeapon: firearm.firearmWeapon,
        isFirearmAmmunition: firearm.firearmAmmunition,
        isFirearmSupply: firearm.firearmSupply,
        isFirearmRelated: firearm.firearmRelated,
        weaponCategory: weapon.category,
        weaponMode: weapon.mode,
        armorCategory,
        spellLevel: Number(foundry.utils.getProperty(record, "system.level") ?? 0),
        school: foundry.utils.getProperty(record, "system.school") ?? "",
        isMechanical: Boolean(mechanicalRule),
        mechanicalReason: mechanicalRule?.id ?? ""
      };
      entry.key = canonicalKey(entry);
      entry.familyIds = entryFamilyIds(entry);
      rawEntries.push(entry);
    }
  }

  rawEntries.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  const grouped = new Map();
  for (const entry of rawEntries) {
    const group = grouped.get(entry.key) ?? [];
    group.push(entry);
    grouped.set(entry.key, group);
  }

  const entries = [...grouped.values()].map(mergeEntryGroup).filter(Boolean);
  const familyGroups = new Map();
  for (const entry of entries) {
    for (const familyId of entry.familyIds) {
      const key = familyMemberKey(entry, familyId);
      const group = familyGroups.get(key) ?? [];
      group.push(entry);
      familyGroups.set(key, group);
    }
  }

  catalogCache = { entries, rawEntries, grouped, familyGroups };
  cacheSignature = signature;
  return catalogCache;
}

export function isBannedEntry(entry, profile, configuration = getConfiguration()) {
  const bans = [
    ...(profile?.bannedItems ?? []),
    ...(configuration?.bannedItems ?? [])
  ];
  for (const banned of bans) {
    if (banned?.allSources === true && banned.key && banned.key === banKey(entry)) return true;
    if (banned?.uuid && banned.uuid === entry.uuid) return true;
  }
  return false;
}

export function entriesForProfile(catalog, profile, configuration = getConfiguration(), { includeBanned = false, includeMechanical = false } = {}) {
  const sourceIds = new Set(profile?.sourceIds ?? []);
  const entries = [];
  for (const group of catalog.grouped.values()) {
    const variants = group.filter(entry => {
      if (sourceIds.size && !sourceIds.has(entry.packId)) return false;
      if (!includeBanned && isBannedEntry(entry, profile, configuration)) return false;
      if (!includeMechanical && isMechanicalItemExcluded(entry, profile, configuration)) return false;
      return true;
    });
    const merged = mergeEntryGroup(variants);
    if (merged) entries.push(merged);
  }
  return entries;
}

export function subtypeOptionsForCategory(entries, category) {
  const counts = new Map();
  for (const entry of entries) {
    if (entry.type !== category) continue;
    for (const subtypeKey of entry.subtypeKeys ?? []) {
      if (!subtypeKey) continue;
      counts.set(subtypeKey, (counts.get(subtypeKey) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, label: nativeSubtypeLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function findEntry(catalog, reference, entries = catalog.entries) {
  const rawReference = String(reference ?? "").trim();
  if (!rawReference) return null;
  if (rawReference.startsWith("Compendium.")) {
    const raw = catalog.rawEntries.find(entry => entry.uuid === rawReference) ?? null;
    if (!raw) return null;
    return entries.find(entry => entry.key === raw.key) ?? raw;
  }

  const normalized = normalizeText(rawReference);
  return entries.find(entry => normalizeText(entry.identifier) === normalized)
    ?? entries.find(entry => normalizeText(entry.name) === normalized)
    ?? null;
}

export function familyEntries(catalog, familyId, entries = catalog.entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!(entry.familyIds ?? []).includes(familyId)) continue;
    const key = familyMemberKey(entry, familyId);
    if (!groups.has(key)) groups.set(key, entry);
  }
  return [...groups.values()];
}

export function resolvePrice(entry, catalog, configuration) {
  if (Number(entry.priceValue) > 0) {
    return {
      value: Number(entry.priceValue),
      denomination: entry.priceDenomination || "gp",
      origin: "official"
    };
  }

  const sibling = (catalog.grouped.get(entry.key) ?? []).find(candidate => Number(candidate.priceValue) > 0);
  if (sibling) {
    return {
      value: Number(sibling.priceValue),
      denomination: sibling.priceDenomination || "gp",
      origin: "alternateSource",
      source: sibling.packLabel
    };
  }

  const rarity = normalizeRarity(entry.rarity);
  const configured = Math.max(0, Number(configuration.priceFallbacks?.[rarity] ?? configuration.priceFallbacks?.none ?? 1) || 0);
  if (rarity === "artifact" && configured === 0) {
    return { value: 0, denomination: "gp", origin: "priceless" };
  }
  return {
    value: Math.max(1, configured),
    denomination: "gp",
    origin: "fallback"
  };
}

export async function loadItemDocument(entry) {
  const document = await fromUuid(entry.uuid);
  if (!document || document.documentName !== "Item") {
    throw new Error(`Unable to load Item: ${entry.uuid}`);
  }
  return document;
}
