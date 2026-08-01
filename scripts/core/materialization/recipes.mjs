import {
  canonicalizeItemName,
  cleanResolvedBlueprintDescription,
  materializeIdentityChanges
} from "./naming.mjs";

/**
 * Versioned, source-agnostic recipes for official Item families whose template
 * documents are known to vary between SRD, PHB/DMG, and legacy compendiums.
 *
 * The normal Materialization Core remains the first choice. These recipes are
 * deterministic fallbacks used only when the native template flow cannot
 * produce a complete, validated Item.
 */
export const MATERIALIZATION_RECIPE_SCHEMA_VERSION = 3;

export const MATERIALIZATION_RECIPE_REGISTRY = Object.freeze([
  Object.freeze({
    id: "armor-of-resistance",
    mode: "materialize",
    aliases: ["armor-of-resistance", "armour-of-resistance", "armadura-de-resistencia"],
    target: Object.freeze({ types: ["equipment"], categories: ["light", "medium", "heavy"], excludeCategories: ["shield"] }),
    rarity: "rare",
    pricing: "rarity"
  }),
  Object.freeze({
    id: "demon-armor",
    mode: "template-transplant",
    aliases: ["demon-armor", "demon-armour", "armadura-demoníaca", "armadura-demoniaca"],
    // Official source restrictions remain authoritative when present. Heavy is
    // the safe fallback for legacy documents that omit indexed restrictions.
    target: Object.freeze({ types: ["equipment"], categories: ["heavy"], excludeCategories: ["shield"], useSourceCategories: true }),
    rarity: "veryRare",
    nameTemplate: "Demon Armor",
    pricing: "rarity"
  }),
  Object.freeze({
    id: "adamantine-armor",
    mode: "template-transplant",
    aliases: ["adamantine-armor", "adamantine-armour"],
    target: Object.freeze({ types: ["equipment"], categories: ["medium", "heavy"], excludeCategories: ["shield"], useSourceCategories: true }),
    rarity: "uncommon",
    nameTemplate: "Adamantine {base}",
    pricing: "base-plus-rarity",
    hammerMagicSurcharge: 1500
  }),
  Object.freeze({
    id: "mithral-armor",
    mode: "template-transplant",
    aliases: ["mithral-armor", "mithral-armour"],
    target: Object.freeze({ types: ["equipment"], categories: ["medium", "heavy"], excludeCategories: ["shield"], useSourceCategories: true }),
    rarity: "uncommon",
    nameTemplate: "Mithral {base}",
    pricing: "base-plus-rarity"
  }),
  Object.freeze({
    id: "dragon-scale-mail",
    mode: "materialize-dragon-scale",
    aliases: ["dragon-scale-mail", "dragon-scalemail"],
    target: Object.freeze({ types: ["equipment"], exactBases: ["scale-mail", "scalemail"] }),
    rarity: "veryRare",
    pricing: "rarity"
  }),
  Object.freeze({
    id: "armor-of-vulnerability",
    mode: "materialize-vulnerability",
    aliases: ["armor-of-vulnerability", "armour-of-vulnerability"],
    target: Object.freeze({ types: ["equipment"], categories: ["light", "medium", "heavy"], excludeCategories: ["shield"] }),
    rarity: "rare",
    pricing: "rarity",
    cursed: true
  }),
  Object.freeze({
    id: "armor-of-etherealness",
    mode: "template-transplant",
    aliases: ["armor-of-etherealness", "armour-of-etherealness"],
    target: Object.freeze({ types: ["equipment"], exactBases: ["half-plate", "half-plate-armor", "plate", "plate-armor"] }),
    rarity: "legendary",
    nameTemplate: "{base} of Etherealness",
    pricing: "rarity"
  }),
  Object.freeze({
    id: "efreeti-chain",
    mode: "template-transplant",
    aliases: ["efreeti-chain", "efreet-chain"],
    target: Object.freeze({ types: ["equipment"], exactBases: ["chain-mail", "chainmail"] }),
    rarity: "legendary",
    nameTemplate: "Efreeti Chain",
    pricing: "rarity"
  }),
  Object.freeze({
    id: "oil-of-sharpness",
    mode: "pass-through",
    aliases: ["oil-of-sharpness"],
    target: null,
    rarity: "veryRare",
    pricing: "rarity"
  }),
  Object.freeze({
    id: "wand-of-the-war-mage",
    mode: "resolve-variant",
    aliases: ["wand-of-the-war-mage", "wand-of-war-mage"],
    target: null,
    pricing: "rarity"
  }),
  Object.freeze({
    id: "enchanted-ammunition",
    mode: "synthetic-ammunition",
    aliases: [],
    target: Object.freeze({ types: ["consumable", "loot", "equipment"], ammunition: true }),
    pricing: "quality"
  })
]);

const RECIPE_BY_ID = new Map(MATERIALIZATION_RECIPE_REGISTRY.map(recipe => [recipe.id, recipe]));
const ENCHANTMENT_RARITY = Object.freeze({ 1: "uncommon", 2: "rare", 3: "veryRare" });
const DAMAGE_TYPES = Object.freeze([
  "acid", "cold", "fire", "force", "lightning",
  "necrotic", "poison", "psychic", "radiant", "thunder"
]);
const PHYSICAL_DAMAGE_TYPES = Object.freeze(["bludgeoning", "piercing", "slashing"]);
const DRAGON_SCALE_VARIANTS = Object.freeze([
  { dragon: "Black", resistance: "acid" },
  { dragon: "Blue", resistance: "lightning" },
  { dragon: "Brass", resistance: "fire" },
  { dragon: "Bronze", resistance: "lightning" },
  { dragon: "Copper", resistance: "acid" },
  { dragon: "Gold", resistance: "fire" },
  { dragon: "Green", resistance: "poison" },
  { dragon: "Red", resistance: "fire" },
  { dragon: "Silver", resistance: "cold" },
  { dragon: "White", resistance: "cold" }
]);

function clone(value) {
  return foundry.utils.deepClone(value);
}

function asData(documentOrData) {
  return documentOrData?.toObject ? documentOrData.toObject() : clone(documentOrData ?? {});
}

export function normalizeRecipeIdentity(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function valuesOf(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return [...value.values()];
  if (typeof value.values === "function") {
    try { return [...value.values()]; } catch (_error) { /* Continue. */ }
  }
  if (typeof value === "object") return Object.values(value);
  return [value];
}

function sourceIdentity(data) {
  return normalizeRecipeIdentity([
    data?.name,
    foundry.utils.getProperty(data, "system.identifier"),
    foundry.utils.getProperty(data, "system.type.baseItem"),
    data?.uuid,
    data?.pack
  ].filter(Boolean).join(" "));
}

export function materializationRecipe(recipeOrSource) {
  if (typeof recipeOrSource === "string" && RECIPE_BY_ID.has(recipeOrSource)) return RECIPE_BY_ID.get(recipeOrSource);
  const data = asData(recipeOrSource);
  const identity = sourceIdentity(data);
  return MATERIALIZATION_RECIPE_REGISTRY.find(recipe => recipe.aliases.some(alias => identity.includes(alias))) ?? null;
}

export function hasMaterializationRecipe(recipeOrSource) {
  return Boolean(materializationRecipe(recipeOrSource));
}

function normalizeTargetCategory(value) {
  const normalized = normalizeRecipeIdentity(value);
  const aliases = {
    lightarmor: "light",
    mediumarmor: "medium",
    heavyarmor: "heavy",
    armorlight: "light",
    armormedium: "medium",
    armorheavy: "heavy",
    ammunition: "ammo"
  };
  return aliases[normalized] ?? normalized;
}

function itemCategory(data) {
  return normalizeTargetCategory(foundry.utils.getProperty(data, "system.type.value"));
}

function baseIdentity(data) {
  return normalizeRecipeIdentity([
    foundry.utils.getProperty(data, "system.identifier"),
    foundry.utils.getProperty(data, "system.type.baseItem"),
    data?.name
  ].filter(Boolean).join(" "));
}

function stringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (value instanceof Set) return [...value].map(String);
  if (value instanceof Map) return [...value.values()].map(String);
  if (typeof value.values === "function") {
    try { return [...value.values()].map(String); } catch (_error) { /* Continue. */ }
  }
  if (typeof value === "object") return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([key]) => String(key));
  return [String(value)];
}

function enchantActivities(data) {
  return valuesOf(foundry.utils.getProperty(data, "system.activities")).filter(activity => activity?.type === "enchant");
}

function sourceRestrictionCategories(sourceData) {
  const categories = new Set();
  for (const activity of enchantActivities(sourceData)) {
    for (const category of stringList(activity?.restrictions?.categories)) {
      const normalized = normalizeTargetCategory(category);
      if (normalized) categories.add(normalized);
    }
  }
  return [...categories];
}

function isAmmunitionData(data) {
  if (!data || String(data.type ?? "") === "spell") return false;
  const type = String(data.type ?? "");
  if (!["consumable", "loot", "equipment"].includes(type)) return false;
  const category = itemCategory(data);
  if (["ammo", "ammunition"].includes(category)) return true;
  const identity = baseIdentity(data);
  return /(?:^|-)arrows?(?:-|$)/.test(identity)
    || /(?:^|-)crossbow-bolts?(?:-|$)/.test(identity)
    || /(?:^|-)blowgun-needles?(?:-|$)/.test(identity)
    || /(?:^|-)sling-bullets?(?:-|$)/.test(identity);
}

export function recipeTargetCompatibility(recipeOrSource, baseDocumentOrData, sourceDocumentOrData = null) {
  const recipe = materializationRecipe(recipeOrSource);
  if (!recipe?.target) return recipe?.mode === "resolve-variant" ? true : null;
  const base = asData(baseDocumentOrData);
  if (!base || !base.type) return false;
  const target = recipe.target;
  if (target.ammunition) return isAmmunitionData(base);
  if (target.types?.length && !target.types.includes(String(base.type))) return false;

  const category = itemCategory(base);
  if (target.excludeCategories?.map(normalizeTargetCategory).includes(category)) return false;

  let categories = [...(target.categories ?? [])].map(normalizeTargetCategory);
  if (target.useSourceCategories && sourceDocumentOrData) {
    const sourceCategories = sourceRestrictionCategories(asData(sourceDocumentOrData));
    if (sourceCategories.length) categories = sourceCategories;
  }
  if (categories.length && !categories.includes(category)) return false;

  if (target.exactBases?.length) {
    const identity = baseIdentity(base);
    const exact = target.exactBases.map(normalizeRecipeIdentity);
    if (!exact.some(term => identity === term || identity.includes(term))) return false;
  }
  return true;
}

function freshId() {
  return foundry.utils.randomID?.(16) ?? Math.random().toString(36).slice(2, 18);
}

function propertyValues(data) {
  const properties = foundry.utils.getProperty(data, "system.properties");
  if (Array.isArray(properties)) return properties.map(String);
  if (properties instanceof Set) return [...properties].map(String);
  return Object.entries(properties ?? {}).filter(([, enabled]) => Boolean(enabled)).map(([key]) => String(key));
}

function setProperties(data, values) {
  const unique = [...new Set(values.filter(Boolean).map(String))];
  const existing = foundry.utils.getProperty(data, "system.properties");
  if (existing instanceof Set) foundry.utils.setProperty(data, "system.properties", new Set(unique));
  else if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    foundry.utils.setProperty(data, "system.properties", Object.fromEntries(unique.map(key => [key, true])));
  } else foundry.utils.setProperty(data, "system.properties", unique);
}

function ensureMagical(data) {
  setProperties(data, [...propertyValues(data), "mgc"]);
}

function effectChanges(effect) {
  if (Array.isArray(effect?.changes)) return effect.changes;
  if (Array.isArray(effect?.system?.changes)) return effect.system.changes;
  return [];
}

function setEffectChanges(effect, changes) {
  if (Array.isArray(effect?.changes) || !effect?.system || !Object.hasOwn(effect.system, "changes")) effect.changes = changes;
  else effect.system.changes = changes;
}

function effectsOf(data) {
  return valuesOf(data?.effects);
}

function activitiesObject(data) {
  const activities = foundry.utils.getProperty(data, "system.activities");
  if (!activities) return {};
  if (activities instanceof Map) return Object.fromEntries(activities);
  if (Array.isArray(activities)) return Object.fromEntries(activities.filter(Boolean).map(activity => [activity._id ?? freshId(), activity]));
  return clone(activities);
}

function removeEnchantActivities(data) {
  const activities = activitiesObject(data);
  const retained = {};
  for (const [id, activity] of Object.entries(activities)) {
    if (activity?.type === "enchant") continue;
    retained[id] = activity;
  }
  foundry.utils.setProperty(data, "system.activities", retained);
}

function cleanTemplateInstructions(html) {
  if (typeof html !== "string") return html;
  let output = html;
  const marker = /make magical items with templates/i;
  const index = output.search(marker);
  if (index >= 0) {
    const blockStart = Math.max(
      output.lastIndexOf("<section", index),
      output.lastIndexOf("<div", index),
      output.lastIndexOf("<article", index),
      output.lastIndexOf("<h", index)
    );
    output = output.slice(0, blockStart >= 0 ? blockStart : index);
  }
  output = output.replace(/<p\b[^>]*>[\s\S]*?(?:template item|template items|change to the effects tab|drag your effect)[\s\S]*?<\/p>/gi, "");
  return cleanResolvedBlueprintDescription(output, { resolved: true });
}

function attunementRequired(data) {
  const current = foundry.utils.getProperty(data, "system.attunement");
  if (typeof current === "string") foundry.utils.setProperty(data, "system.attunement", "required");
}

function addRecipeFlags(data, metadata) {
  data.flags ??= {};
  data.flags["hammer-materialization-core"] = {
    materialized: true,
    recipeSchema: MATERIALIZATION_RECIPE_SCHEMA_VERSION,
    ...metadata
  };
}

function chooseBonus({ requestedBonus = null, maxBonus = null } = {}) {
  const requested = Math.floor(Number(requestedBonus ?? 0));
  if (requested >= 1 && requested <= 3) return requested;
  const maximum = Math.max(1, Math.min(3, Math.floor(Number(maxBonus ?? 3) || 3)));
  return 1 + Math.floor(Math.random() * maximum);
}

function rarityForBonus(bonus) {
  return ENCHANTMENT_RARITY[Math.max(1, Math.min(3, Number(bonus) || 1))] ?? "uncommon";
}

function effectModeAdd() {
  return globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
}

function effectModeOverride() {
  return globalThis.CONST?.ACTIVE_EFFECT_MODES?.OVERRIDE ?? 5;
}

function damageTypeLabel(type) {
  const configured = globalThis.CONFIG?.DND5E?.damageTypes?.[type];
  const raw = typeof configured === "string" ? configured : (configured?.label ?? type);
  const localized = globalThis.game?.i18n?.localize?.(raw) ?? raw;
  return String(localized || type).replace(/(^|\s)\S/g, character => character.toUpperCase());
}

function materializeArmorOfResistance({ sourceDocument, baseDocument, selection = null }) {
  const sourceData = asData(sourceDocument);
  const baseData = asData(baseDocument);
  if (!recipeTargetCompatibility("armor-of-resistance", baseData, sourceData)) return { ok: false, reason: "recipeIncompatibleTarget" };

  const result = clone(baseData);
  delete result._id;
  const selected = normalizeRecipeIdentity(selection?.value ?? selection?.label ?? selection ?? "");
  const type = DAMAGE_TYPES.includes(selected)
    ? selected
    : DAMAGE_TYPES[Math.floor(Math.random() * DAMAGE_TYPES.length)];
  const label = damageTypeLabel(type);
  const baseName = String(baseData.name ?? "Armor").replace(/\s+of\s+.+\s+Resistance$/i, "").trim();
  const name = canonicalizeItemName(`${baseName} of ${label} Resistance`, { baseName });
  if (!name.ok) return { ok: false, reason: name.reason };

  result.name = name.name;
  foundry.utils.setProperty(result, "system.rarity", "rare");
  foundry.utils.setProperty(result, "system.description.value", `<p><em>(Requires attunement)</em></p><p>While you wear this armor, you have Resistance to ${label} damage.</p>`);
  ensureMagical(result);
  attunementRequired(result);
  result.effects = effectsOf(result).filter(effect => effect?.flags?.["hammer-materialization-core"]?.recipeId !== "armor-of-resistance");
  result.effects.push({
    _id: freshId(),
    name: `${label} Resistance`,
    img: sourceData.img || result.img,
    type: "enchantment",
    disabled: false,
    transfer: true,
    origin: sourceDocument?.uuid ?? "",
    system: {
      changes: [{ key: "system.traits.dr.value", mode: effectModeAdd(), value: type, priority: 20 }]
    },
    flags: {
      "hammer-materialization-core": {
        recipeId: "armor-of-resistance",
        resistanceType: type
      }
    }
  });
  removeEnchantActivities(result);
  const metadata = {
    kind: "blueprint",
    family: "armor-of-resistance",
    strategy: "recipe-fallback",
    recipeId: "armor-of-resistance",
    baseUuid: baseDocument?.uuid ?? "",
    blueprintUuid: sourceDocument?.uuid ?? "",
    selection: type,
    targetContract: "recipe-validated"
  };
  addRecipeFlags(result, metadata);
  return { ok: true, documentData: result, metadata };
}

function mergeBasePhysicalData(result, baseData) {
  result.type = baseData.type;
  const fields = [
    "system.type",
    "system.armor",
    "system.weight",
    "system.strength",
    "system.proficient",
    "system.baseItem"
  ];
  for (const path of fields) {
    if (!foundry.utils.hasProperty(baseData, path)) continue;
    foundry.utils.setProperty(result, path, clone(foundry.utils.getProperty(baseData, path)));
  }
  const mergedProperties = [...propertyValues(baseData), ...propertyValues(result), "mgc"];
  setProperties(result, mergedProperties);
}

function firstEnchantmentEffect(sourceData) {
  return effectsOf(sourceData).find(effect => effect?.type === "enchantment") ?? null;
}

function materializeTemplateTransplant({ recipe, sourceDocument, baseDocument }) {
  const sourceData = asData(sourceDocument);
  const baseData = asData(baseDocument);
  if (!recipeTargetCompatibility(recipe.id, baseData, sourceData)) return { ok: false, reason: "recipeIncompatibleTarget" };

  const result = clone(sourceData);
  delete result._id;
  mergeBasePhysicalData(result, baseData);
  removeEnchantActivities(result);
  const sourceDescription = foundry.utils.getProperty(sourceData, "system.description.value");
  if (typeof sourceDescription === "string") {
    foundry.utils.setProperty(result, "system.description.value", cleanTemplateInstructions(sourceDescription));
  }
  if (recipe.rarity) foundry.utils.setProperty(result, "system.rarity", recipe.rarity);
  ensureMagical(result);

  const existingEffects = effectsOf(sourceData).filter(effect => effect?.type !== "enchantment").map(clone);
  const sourceEnchantment = firstEnchantmentEffect(sourceData);
  if (sourceEnchantment) {
    const identity = materializeIdentityChanges(result, sourceEnchantment);
    if (identity.ok) {
      const enchantment = identity.effect;
      enchantment._id = freshId();
      enchantment.type = "enchantment";
      enchantment.disabled = false;
      enchantment.transfer = true;
      enchantment.origin = sourceDocument?.uuid ?? "";
      enchantment.flags ??= {};
      enchantment.flags["hammer-materialization-core"] = { recipeId: recipe.id };
      existingEffects.push(enchantment);
    }
  }
  result.effects = existingEffects;

  const requestedName = String(recipe.nameTemplate ?? sourceData.name ?? baseData.name ?? "Magic Item")
    .replaceAll("{base}", String(baseData.name ?? "Armor"));
  const name = canonicalizeItemName(requestedName, { baseName: baseData.name, fallbackName: sourceData.name });
  if (!name.ok) return { ok: false, reason: name.reason };
  result.name = name.name;
  if (recipe.cursed === true || recipe.id === "demon-armor") {
    foundry.utils.setProperty(result, "system.unidentified.name", String(baseData.name ?? "Armor"));
  }

  const metadata = {
    kind: "blueprint",
    family: recipe.id,
    strategy: "recipe-fallback",
    recipeId: recipe.id,
    baseUuid: baseDocument?.uuid ?? "",
    blueprintUuid: sourceDocument?.uuid ?? "",
    targetContract: "recipe-validated"
  };
  addRecipeFlags(result, metadata);
  return { ok: true, documentData: result, metadata };
}

function materializeDragonScaleMail({ sourceDocument, baseDocument, selection = null }) {
  const sourceData = asData(sourceDocument);
  const baseData = asData(baseDocument);
  if (!recipeTargetCompatibility("dragon-scale-mail", baseData, sourceData)) return { ok: false, reason: "recipeIncompatibleTarget" };
  const selected = normalizeRecipeIdentity(selection?.dragon ?? selection?.value ?? selection ?? "");
  const variant = DRAGON_SCALE_VARIANTS.find(entry => normalizeRecipeIdentity(entry.dragon) === selected)
    ?? DRAGON_SCALE_VARIANTS[Math.floor(Math.random() * DRAGON_SCALE_VARIANTS.length)];
  const result = clone(sourceData);
  delete result._id;
  mergeBasePhysicalData(result, baseData);
  removeEnchantActivities(result);
  result.name = `${variant.dragon} Dragon Scale Mail`;
  foundry.utils.setProperty(result, "system.rarity", "veryRare");
  foundry.utils.setProperty(result, "system.description.value",
    `<p><em>(Requires attunement)</em></p><p>This armor is made from ${variant.dragon.toLowerCase()} dragon scales. While wearing it, you have Resistance to ${damageTypeLabel(variant.resistance)} damage. You also have advantage on saving throws against the Frightful Presence and breath weapons of dragons.</p>`);
  ensureMagical(result);
  attunementRequired(result);
  result.effects = effectsOf(sourceData).filter(effect => effect?.type !== "enchantment").map(clone);
  result.effects.push({
    _id: freshId(), name: `${damageTypeLabel(variant.resistance)} Resistance`, img: sourceData.img || result.img,
    type: "enchantment", disabled: false, transfer: true, origin: sourceDocument?.uuid ?? "",
    system: { changes: [{ key: "system.traits.dr.value", mode: effectModeAdd(), value: variant.resistance, priority: 20 }] },
    flags: { "hammer-materialization-core": { recipeId: "dragon-scale-mail", dragon: variant.dragon, resistanceType: variant.resistance } }
  });
  const metadata = { kind: "blueprint", family: "dragon-scale-mail", strategy: "recipe-fallback", recipeId: "dragon-scale-mail", baseUuid: baseDocument?.uuid ?? "", blueprintUuid: sourceDocument?.uuid ?? "", selection: variant.dragon, targetContract: "recipe-validated" };
  addRecipeFlags(result, metadata);
  return { ok: true, documentData: result, metadata };
}

function materializeArmorOfVulnerability({ sourceDocument, baseDocument, selection = null }) {
  const sourceData = asData(sourceDocument);
  const baseData = asData(baseDocument);
  if (!recipeTargetCompatibility("armor-of-vulnerability", baseData, sourceData)) return { ok: false, reason: "recipeIncompatibleTarget" };
  const selected = normalizeRecipeIdentity(selection?.value ?? selection?.label ?? selection ?? "");
  const resistance = PHYSICAL_DAMAGE_TYPES.includes(selected)
    ? selected
    : PHYSICAL_DAMAGE_TYPES[Math.floor(Math.random() * PHYSICAL_DAMAGE_TYPES.length)];
  const vulnerabilities = PHYSICAL_DAMAGE_TYPES.filter(type => type !== resistance);
  const result = clone(baseData);
  delete result._id;
  const baseName = String(baseData.name ?? "Armor");
  result.name = `${baseName} of Vulnerability`;
  foundry.utils.setProperty(result, "system.rarity", "rare");
  foundry.utils.setProperty(result, "system.unidentified.name", baseName);
  foundry.utils.setProperty(result, "system.description.value",
    `<p><em>(Requires attunement)</em></p><p>While wearing this armor, you have Resistance to ${damageTypeLabel(resistance)} damage.</p><p><strong>Curse.</strong> This armor is cursed. While wearing it, you have Vulnerability to ${vulnerabilities.map(damageTypeLabel).join(" and ")} damage.</p>`);
  ensureMagical(result);
  attunementRequired(result);
  result.effects = effectsOf(result).filter(effect => effect?.flags?.["hammer-materialization-core"]?.recipeId !== "armor-of-vulnerability");
  result.effects.push({
    _id: freshId(), name: "Armor of Vulnerability", img: sourceData.img || result.img,
    type: "enchantment", disabled: false, transfer: true, origin: sourceDocument?.uuid ?? "",
    system: { changes: [
      { key: "system.traits.dr.value", mode: effectModeAdd(), value: resistance, priority: 20 },
      ...vulnerabilities.map(type => ({ key: "system.traits.dv.value", mode: effectModeAdd(), value: type, priority: 20 }))
    ] },
    flags: { "hammer-materialization-core": { recipeId: "armor-of-vulnerability", resistanceType: resistance, vulnerabilityTypes: vulnerabilities } }
  });
  removeEnchantActivities(result);
  const metadata = { kind: "blueprint", family: "armor-of-vulnerability", strategy: "recipe-fallback", recipeId: "armor-of-vulnerability", baseUuid: baseDocument?.uuid ?? "", blueprintUuid: sourceDocument?.uuid ?? "", selection: resistance, cursed: true, targetContract: "recipe-validated" };
  addRecipeFlags(result, metadata);
  return { ok: true, documentData: result, metadata };
}

function materializePassThrough({ recipe, sourceDocument }) {
  const sourceData = asData(sourceDocument);
  const result = clone(sourceData);
  delete result._id;
  const metadata = {
    kind: "sellable",
    family: recipe.id,
    strategy: "recipe-pass-through",
    recipeId: recipe.id,
    sourceUuid: sourceDocument?.uuid ?? "",
    targetContract: "self-contained-source"
  };
  return { ok: true, documentData: result, metadata };
}

function materializeWandOfTheWarMage({ sourceDocument, requestedBonus = null, maxBonus = null }) {
  const sourceData = asData(sourceDocument);
  const result = clone(sourceData);
  delete result._id;
  const bonus = chooseBonus({ requestedBonus, maxBonus });
  const rarity = rarityForBonus(bonus);
  result.name = `Wand of the War Mage +${bonus}`;
  foundry.utils.setProperty(result, "system.rarity", rarity);
  foundry.utils.setProperty(result, "system.price", { value: 0, denomination: "gp" });
  foundry.utils.setProperty(result, "system.description.value",
    `<p><em>(Requires attunement by a Spellcaster)</em></p><p>While holding this wand, you gain a +${bonus} bonus to spell attack rolls. In addition, you ignore Half Cover when making a spell attack roll.</p>`);
  ensureMagical(result);
  setProperties(result, [...propertyValues(result), "foc", "mgc"]);
  attunementRequired(result);
  removeEnchantActivities(result);
  result.effects = effectsOf(sourceData).filter(effect => effect?.type !== "enchantment").map(clone);
  result.effects.push({
    _id: freshId(),
    name: `Wand of the War Mage +${bonus}`,
    img: sourceData.img || result.img,
    type: "base",
    disabled: false,
    transfer: true,
    origin: sourceDocument?.uuid ?? "",
    system: {
      changes: [{ key: "system.bonuses.msak.attack", mode: effectModeAdd(), value: bonus, priority: null }]
    },
    flags: {
      "hammer-materialization-core": { recipeId: "wand-of-the-war-mage", bonus }
    }
  });
  const metadata = {
    kind: "variant",
    family: "wand-of-the-war-mage",
    strategy: "recipe-fallback",
    recipeId: "wand-of-the-war-mage",
    variantUuid: sourceDocument?.uuid ?? "",
    bonus,
    resolvedBonus: bonus,
    targetContract: "recipe-validated"
  };
  addRecipeFlags(result, metadata);
  return { ok: true, documentData: result, metadata };
}

function materializeEnchantedAmmunition({ baseDocument, requestedBonus = null, maxBonus = null, qualityPriceAdditions = {} }) {
  const baseData = asData(baseDocument);
  if (!recipeTargetCompatibility("enchanted-ammunition", baseData, baseData)) return { ok: false, reason: "recipeIncompatibleTarget" };
  const result = clone(baseData);
  delete result._id;
  result.type = "consumable";
  foundry.utils.setProperty(result, "system.type.value", "ammo");
  const bonus = chooseBonus({ requestedBonus, maxBonus });
  const cleanName = String(baseData.name ?? "Ammunition")
    .replace(/\s+\+[123]\s*$/i, "")
    .replace(/\s+\(\+?[123]\)\s*$/i, "")
    .trim();
  result.name = `${cleanName} +${bonus}`;
  foundry.utils.setProperty(result, "system.magicalBonus", String(bonus));
  foundry.utils.setProperty(result, "system.rarity", rarityForBonus(bonus));
  ensureMagical(result);
  const addition = Math.max(0, Number(qualityPriceAdditions?.[bonus] ?? 0) || 0);
  foundry.utils.setProperty(result, "system.price", {
    value: Math.max(1, addition || 1),
    denomination: "gp"
  });
  const description = cleanTemplateInstructions(foundry.utils.getProperty(baseData, "system.description.value") ?? "");
  foundry.utils.setProperty(result, "system.description.value",
    `${description}${description ? "\n" : ""}<p>You gain a +${bonus} bonus to attack and damage rolls made with this piece of magic ammunition. Once it hits a target, the ammunition is no longer magical.</p>`);
  removeEnchantActivities(result);
  const metadata = {
    kind: "generator",
    family: "enchanted-ammunition",
    strategy: "recipe-fallback",
    recipeId: "enchanted-ammunition",
    baseUuid: baseDocument?.uuid ?? "",
    bonus,
    resolvedBonus: bonus,
    targetContract: "recipe-validated"
  };
  addRecipeFlags(result, metadata);
  return { ok: true, documentData: result, metadata };
}

export function recipeOutputIssues(recipeOrSource, documentOrData) {
  const recipe = materializationRecipe(recipeOrSource);
  if (!recipe) return [];
  const data = asData(documentOrData);
  const issues = [];
  const name = String(data.name ?? "");
  const rarity = normalizeRecipeIdentity(foundry.utils.getProperty(data, "system.rarity"));
  const price = Number(foundry.utils.getProperty(data, "system.price.value") ?? 0);
  const description = String(foundry.utils.getProperty(data, "system.description.value") ?? "");

  if (/\+\s*1\s*,\s*\+\s*2|\+1-2-or-3|\+1,\s*\+2,\s*or\s*\+3/i.test(name)) issues.push("unresolvedVariantName");
  if (recipe.mode !== "pass-through" && /make magical items with templates|template items/i.test(description)) issues.push("templateInstructionsRemain");
  if (recipe.id === "wand-of-the-war-mage") {
    if (!/\+[123]\s*$/.test(name)) issues.push("missingResolvedBonus");
    if (!rarity || rarity === "none") issues.push("missingRarity");
    if (price === 1) issues.push("fallbackPriceRemain");
  }
  if (recipe.id === "armor-of-resistance") {
    const serialized = JSON.stringify(data).toLowerCase();
    if (!DAMAGE_TYPES.some(type => normalizeRecipeIdentity(name).includes(type))) issues.push("missingResistanceVariant");
    if (!serialized.includes("system.traits.dr.value")) issues.push("missingResistanceEffect");
  }
  if (recipe.id === "dragon-scale-mail") {
    const serialized = JSON.stringify(data).toLowerCase();
    if (!/dragon scale mail/i.test(name)) issues.push("missingDragonVariant");
    if (!serialized.includes("system.traits.dr.value")) issues.push("missingResistanceEffect");
  }
  if (recipe.id === "armor-of-vulnerability") {
    const serialized = JSON.stringify(data).toLowerCase();
    if (!serialized.includes("system.traits.dr.value")) issues.push("missingResistanceEffect");
    if (!serialized.includes("system.traits.dv.value")) issues.push("missingVulnerabilityEffect");
    if (!foundry.utils.getProperty(data, "system.unidentified.name")) issues.push("missingUnidentifiedName");
  }
  if (["adamantine-armor", "mithral-armor"].includes(recipe.id)) {
    if (!normalizeRecipeIdentity(name).includes(recipe.id.split("-")[0])) issues.push("missingMaterialIdentity");
    if (!rarity || rarity === "none") issues.push("missingRarity");
  }
  if (recipe.id === "enchanted-ammunition") {
    const bonus = Number(foundry.utils.getProperty(data, "system.magicalBonus") ?? 0);
    if (![1, 2, 3].includes(bonus)) issues.push("missingAmmunitionBonus");
    if (!isAmmunitionData(data)) issues.push("notAmmunition");
  }
  return issues;
}

export async function materializeWithRecipe({
  recipeId = "",
  sourceDocument = null,
  baseDocument = null,
  requestedBonus = null,
  maxBonus = null,
  selection = null,
  qualityPriceAdditions = {}
} = {}) {
  const recipe = materializationRecipe(recipeId || sourceDocument);
  if (!recipe) return { ok: false, reason: "recipeNotFound" };
  let result;
  if (recipe.mode === "pass-through") {
    if (!sourceDocument) return { ok: false, reason: "recipeMissingSource" };
    result = materializePassThrough({ recipe, sourceDocument });
  } else if (recipe.id === "armor-of-resistance") {
    if (!sourceDocument || !baseDocument) return { ok: false, reason: "recipeMissingTarget" };
    result = materializeArmorOfResistance({ sourceDocument, baseDocument, selection });
  } else if (recipe.id === "dragon-scale-mail") {
    if (!sourceDocument || !baseDocument) return { ok: false, reason: "recipeMissingTarget" };
    result = materializeDragonScaleMail({ sourceDocument, baseDocument, selection });
  } else if (recipe.id === "armor-of-vulnerability") {
    if (!sourceDocument || !baseDocument) return { ok: false, reason: "recipeMissingTarget" };
    result = materializeArmorOfVulnerability({ sourceDocument, baseDocument, selection });
  } else if (recipe.id === "wand-of-the-war-mage") {
    if (!sourceDocument) return { ok: false, reason: "recipeMissingSource" };
    result = materializeWandOfTheWarMage({ sourceDocument, requestedBonus, maxBonus });
  } else if (recipe.id === "enchanted-ammunition") {
    if (!baseDocument) return { ok: false, reason: "recipeMissingTarget" };
    result = materializeEnchantedAmmunition({ baseDocument, requestedBonus, maxBonus, qualityPriceAdditions });
  } else if (recipe.mode === "template-transplant") {
    if (!sourceDocument || !baseDocument) return { ok: false, reason: "recipeMissingTarget" };
    result = materializeTemplateTransplant({ recipe, sourceDocument, baseDocument });
  } else return { ok: false, reason: "recipeUnsupportedMode" };

  if (!result.ok) return result;
  const issues = recipeOutputIssues(recipe, result.documentData);
  if (issues.length) return { ok: false, reason: issues[0], issues };
  return result;
}
