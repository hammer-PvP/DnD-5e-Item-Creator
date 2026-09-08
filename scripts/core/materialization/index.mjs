import {
  isAmmunitionData,
  isSelfContainedSellableData,
  knownBaseCompatibility
} from "./compatibility.mjs";
import {
  canonicalizeItemName,
  cleanResolvedBlueprintDescription,
  materializeIdentityChanges
} from "./naming.mjs";
import {
  MATERIALIZATION_RECIPE_REGISTRY,
  MATERIALIZATION_RECIPE_SCHEMA_VERSION,
  hasMaterializationRecipe,
  materializationRecipe,
  materializeWithRecipe,
  recipeOutputIssues,
  recipeTargetCompatibility
} from "./recipes.mjs";

export const MATERIALIZATION_ENGINE_VERSION = "0.3.2";

/**
 * HAMMER Materialization Core
 *
 * Shared, headless materialization primitives. This folder is intentionally
 * self-contained so the same source can later be bundled into Item Creator.
 *
 * The Core never executes an Item's UI or activation. It reads the structured
 * D&D5e Enchant activity, resolves its profile/table choices, applies the
 * selected Enchantment Active Effect to a cloned base Item, and validates a
 * temporary result before returning plain Item data to the calling module.
 */

const CORE_FLAG = "hammer-materialization-core";
const ENCHANTMENT_RARITY = { 0: "none", 1: "uncommon", 2: "rare", 3: "veryRare" };
const VARIABLE_VALUES = new Set(["", "varies", "vary", "variable", "choose", "choice", "any", "type"]);

function clone(value) {
  return foundry.utils.deepClone(value);
}

function asData(documentOrData) {
  return documentOrData?.toObject ? documentOrData.toObject() : clone(documentOrData ?? {});
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRarity(value) {
  const normalized = normalize(value).replaceAll("-", "");
  if (!normalized) return "none";
  if (normalized === "veryrare") return "veryRare";
  return normalized;
}

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Map) return [...collection.values()];
  if (collection instanceof Set) return [...collection.values()];
  if (typeof collection.values === "function") {
    try { return [...collection.values()]; } catch (_error) { /* Continue. */ }
  }
  return Object.values(collection);
}

function activityDataList(data) {
  return valuesOf(foundry.utils.getProperty(data, "system.activities"));
}

function effectDataList(data) {
  return valuesOf(data?.effects);
}

function enchantActivities(data) {
  return activityDataList(data).filter(activity => activity?.type === "enchant");
}

function enchantmentEffects(data) {
  return effectDataList(data).filter(effect => effect?.type === "enchantment");
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

function hasNativeBlueprintData(data) {
  return enchantActivities(data).length > 0 && enchantmentEffects(data).length > 0;
}

export function isBlueprintCandidateData(data) {
  const recipe = materializationRecipe(data);
  return enchantActivities(data).length > 0 || Boolean(recipe && ["materialize", "template-transplant", "materialize-dragon-scale", "materialize-vulnerability"].includes(recipe.mode));
}

export function classifyDocumentNature(documentOrData, { mechanical = false, generator = null } = {}) {
  const data = asData(documentOrData);
  if (mechanical) return { nature: "mechanical", materializerKind: "", family: "" };
  if (generator) return { nature: "materializer", materializerKind: "generator", family: generator.id ?? "generator" };
  const recipe = materializationRecipe(data);
  if (recipe?.mode === "resolve-variant") return { nature: "materializer", materializerKind: "variant", family: recipe.id };
  if (recipe && ["materialize", "template-transplant", "materialize-dragon-scale", "materialize-vulnerability"].includes(recipe.mode)) {
    return { nature: "materializer", materializerKind: "blueprint", family: recipe.id };
  }
  if (isSelfContainedSellableData(data)) return { nature: "sellable", materializerKind: "", family: "" };
  if (isBlueprintCandidateData(data)) {
    return {
      nature: "materializer",
      materializerKind: "blueprint",
      family: normalize(foundry.utils.getProperty(data, "system.identifier") || data.name || "blueprint")
    };
  }
  return { nature: "sellable", materializerKind: "", family: "" };
}

function propertyValues(data) {
  const properties = foundry.utils.getProperty(data, "system.properties");
  if (Array.isArray(properties)) return properties.map(String);
  if (properties instanceof Set) return [...properties].map(String);
  return Object.entries(properties ?? {}).filter(([, enabled]) => Boolean(enabled)).map(([key]) => String(key));
}

function isMagical(data) {
  const rarity = normalizeRarity(foundry.utils.getProperty(data, "system.rarity"));
  const bonus = Number(foundry.utils.getProperty(data, "system.magicalBonus") ?? 0);
  const values = propertyValues(data).map(normalize);
  return rarity !== "none" || bonus > 0 || values.includes("mgc") || values.includes("magical");
}

function baseCategoryValues(data) {
  // Match the native D&D5e EnchantActivity.canEnchant contract exactly:
  // restrictions.categories compares against system.type.value.
  return new Set([foundry.utils.getProperty(data, "system.type.value")].map(normalize).filter(Boolean));
}

function basePropertyValues(data) {
  return new Set(propertyValues(data).map(normalize));
}

function stringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (value instanceof Set) return [...value].map(String);
  if (value instanceof Map) return [...value.values()].map(entry => String(entry?._id ?? entry));
  if (typeof value.values === "function") {
    try { return [...value.values()].map(entry => String(entry?._id ?? entry)); } catch (_error) { /* Continue. */ }
  }
  if (typeof value === "object") return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([key]) => String(key));
  return [String(value)];
}

export function canMaterializeOnto(blueprintDocumentOrData, baseDocumentOrData, activityOverride = null) {
  const blueprint = asData(blueprintDocumentOrData);
  const base = asData(baseDocumentOrData);
  const activity = activityOverride ?? enchantActivities(blueprint)[0];
  if (!activity) return false;
  const restrictions = activity.restrictions ?? {};
  if (restrictions.allowMagical !== true && isMagical(base)) return false;

  const allowedTypes = new Set(stringList(restrictions.type).map(String).filter(Boolean));
  if (allowedTypes.size && !allowedTypes.has(String(base.type))) return false;

  const categories = new Set(stringList(restrictions.categories).map(normalize).filter(Boolean));
  if (categories.size) {
    const baseCategories = baseCategoryValues(base);
    if (![...categories].some(category => baseCategories.has(category))) return false;
  }

  const requiredProperties = new Set(stringList(restrictions.properties).map(normalize).filter(Boolean));
  if (requiredProperties.size) {
    const properties = basePropertyValues(base);
    // Native D&D5e Enchant restrictions require at least one listed property,
    // not every property in the restriction Set.
    if (![...requiredProperties].some(property => properties.has(property))) return false;
  }

  const knownCompatibility = knownBaseCompatibility(blueprint, base);
  if (knownCompatibility === false) return false;
  return true;
}

function effectBonus(effect) {
  for (const change of effectChanges(effect)) {
    if (String(change?.key) === "system.magicalBonus") {
      const value = Number(change.value);
      if (Number.isFinite(value)) return value;
    }
  }
  const match = String(effect?.name ?? "").match(/\+\s*([123])/);
  return match ? Number(match[1]) : 0;
}

function effectRarity(effect) {
  for (const change of effectChanges(effect)) {
    if (String(change?.key) === "system.rarity") return normalizeRarity(change.value);
  }
  return "none";
}

function profilePairs(blueprintData, activity) {
  const effects = new Map(enchantmentEffects(blueprintData).map(effect => [String(effect._id), effect]));
  const profiles = valuesOf(activity?.effects);
  const pairs = profiles
    .map(profile => ({ profile, effect: effects.get(String(profile?._id)) }))
    .filter(pair => pair.effect);
  if (pairs.length) return pairs;
  return [...effects.values()].map(effect => ({
    profile: {
      _id: effect._id,
      level: { min: null, max: null },
      riders: effect?.flags?.dnd5e?.enchantment?.riders ?? {}
    },
    effect
  }));
}

function pairAvailableAtLevel(pair, partyLevel) {
  if (!Number.isFinite(Number(partyLevel))) return true;
  const level = Number(partyLevel);
  const minimum = Number(pair?.profile?.level?.min);
  const maximum = Number(pair?.profile?.level?.max);
  if (Number.isFinite(minimum) && minimum > 0 && level < minimum) return false;
  if (Number.isFinite(maximum) && maximum > 0 && level > maximum) return false;
  return true;
}

function pairAllowedByProgression(pair, { allowedRarities = null, maxBonus = null } = {}) {
  if (Number.isFinite(Number(maxBonus)) && effectBonus(pair.effect) > Number(maxBonus)) return false;
  if (allowedRarities?.length) {
    const rarity = effectRarity(pair.effect);
    if (rarity !== "none" && !new Set(allowedRarities.map(normalizeRarity)).has(rarity)) return false;
  }
  return true;
}

function collectUuidStrings(value, output = new Set()) {
  if (typeof value === "string") {
    const patterns = [
      /@UUID\[([^\]]+)\]/g,
      /(Compendium\.[\w.-]+\.RollTable\.[\w-]+)/g,
      /(RollTable\.[\w-]+)/g
    ];
    for (const pattern of patterns) {
      for (const match of value.matchAll(pattern)) output.add(match[1]);
    }
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (String(value?.uuid ?? "").includes("RollTable")) output.add(String(value.uuid));
  for (const child of Array.isArray(value) ? value : Object.values(value)) collectUuidStrings(child, output);
  return output;
}

function damageTypeOptions() {
  const output = new Map();
  const configured = globalThis.CONFIG?.DND5E?.damageTypes ?? {};
  for (const [key, data] of Object.entries(configured)) {
    const labelValue = typeof data === "string" ? data : (data?.label ?? key);
    const label = globalThis.game?.i18n?.localize?.(labelValue) ?? labelValue;
    output.set(normalize(key), { key, label });
    output.set(normalize(labelValue), { key, label });
    output.set(normalize(label), { key, label });
  }
  const fallbacks = {
    acid: "Acid", bludgeoning: "Bludgeoning", cold: "Cold", fire: "Fire", force: "Force",
    lightning: "Lightning", necrotic: "Necrotic", piercing: "Piercing", poison: "Poison",
    psychic: "Psychic", radiant: "Radiant", slashing: "Slashing", thunder: "Thunder"
  };
  for (const [key, label] of Object.entries(fallbacks)) {
    output.set(normalize(key), output.get(normalize(key)) ?? { key, label });
    output.set(normalize(label), output.get(normalize(label)) ?? { key, label });
  }
  return output;
}

const DIRECT_RESISTANCE_TYPES = Object.freeze([
  "acid", "cold", "fire", "force", "lightning",
  "necrotic", "poison", "psychic", "radiant", "thunder"
]);

function directResistanceSelection() {
  const key = DIRECT_RESISTANCE_TYPES[Math.floor(Math.random() * DIRECT_RESISTANCE_TYPES.length)];
  const option = damageTypeOptions().get(normalize(key)) ?? { key, label: key.charAt(0).toUpperCase() + key.slice(1) };
  return selectionFromText(option.label, { value: option.key, kind: "damageType", source: "direct-percentage" });
}

function selectionFromText(text, extra = {}) {
  const raw = String(text ?? "").trim();
  const normalized = normalize(raw);
  const damage = damageTypeOptions().get(normalized)
    ?? [...damageTypeOptions().entries()].find(([key]) => normalized === key || normalized.includes(key))?.[1];
  return {
    ...extra,
    text: raw,
    normalized,
    label: damage?.label ?? raw,
    value: damage?.key ?? normalized.replaceAll("-", ""),
    kind: damage ? "damageType" : "text"
  };
}

function tableResultUuid(result) {
  if (result?.uuid) return String(result.uuid);
  const collection = String(result?.documentCollection ?? "");
  const id = String(result?.documentId ?? "");
  if (!collection || !id) return "";
  if (collection.startsWith("Compendium.")) return `${collection}.${id}`;
  if (collection.includes(".")) return `Compendium.${collection}.${id}`;
  return `${collection}.${id}`;
}

async function rollTableDocument(table, uuid = "") {
  if (!table || table.documentName !== "RollTable") return null;
  const rolled = await table.roll({ recursive: false });
  const results = valuesOf(rolled?.results);
  const result = results.find(candidate => candidate) ?? null;
  if (!result) return null;
  const text = result?.name ?? result?.text ?? result?.description ?? result?.range?.join?.("-") ?? "";
  const resultUuid = tableResultUuid(result);
  return selectionFromText(text, {
    uuid: uuid || table.uuid || "",
    resultUuid,
    resultId: result?._id ?? result?.id ?? ""
  });
}

function relatedTableScore(recordName, blueprintName, blueprintIdentifier) {
  const name = normalize(recordName);
  if (!name) return 0;
  if (name === blueprintName || name === blueprintIdentifier) return 100;
  if ((blueprintName && name.includes(blueprintName)) || (blueprintName && blueprintName.includes(name))) return 80;
  const nameTokens = new Set(name.split("-").filter(token => token.length > 2));
  const blueprintTokens = new Set(`${blueprintName}-${blueprintIdentifier}`.split("-").filter(token => token.length > 2));
  const overlap = [...nameTokens].filter(token => blueprintTokens.has(token)).length;
  return overlap * 10;
}

async function findRelatedRollTable(blueprintDocument, blueprintData) {
  if (typeof game === "undefined" || !game?.packs) return null;
  const blueprintName = normalize(blueprintData?.name);
  const blueprintIdentifier = normalize(foundry.utils.getProperty(blueprintData, "system.identifier"));
  const sourcePack = blueprintDocument?.pack ? game.packs.get(blueprintDocument.pack) : null;
  const packageName = sourcePack?.metadata?.packageName ?? "";
  const candidates = [...game.packs].map(entry => entry?.[1] ?? entry).filter(pack =>
    pack?.documentName === "RollTable"
    && (!packageName || pack.metadata?.packageName === packageName)
  );

  const ranked = [];
  for (const pack of candidates) {
    try {
      const index = await pack.getIndex({ fields: ["name"] });
      for (const record of index) {
        const score = relatedTableScore(record.name, blueprintName, blueprintIdentifier);
        if (score > 0) ranked.push({ pack, record, score });
      }
    } catch (error) {
      console.warn("HAMMER Materialization Core | Related RollTable index failed", pack.collection, error);
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  for (const candidate of ranked.slice(0, 8)) {
    try {
      const table = await candidate.pack.getDocument(candidate.record._id);
      const result = await rollTableDocument(table, table?.uuid);
      if (result) return result;
    } catch (error) {
      console.warn("HAMMER Materialization Core | Related RollTable lookup failed", candidate.pack.collection, error);
    }
  }
  return null;
}

async function rollLinkedTable(blueprintData, blueprintDocument = null) {
  const refs = [...collectUuidStrings(blueprintData)].filter(uuid => uuid.includes("RollTable"));
  for (const uuid of refs) {
    try {
      const table = await fromUuid(uuid);
      const result = await rollTableDocument(table, uuid);
      if (result) return result;
    } catch (error) {
      console.warn("HAMMER Materialization Core | RollTable resolution failed", uuid, error);
    }
  }
  return findRelatedRollTable(blueprintDocument, blueprintData);
}

function substituteSelectionTokens(value, selection) {
  if (!selection || typeof value !== "string") return value;
  const text = String(selection.label || selection.text || "");
  const normalized = String(selection.value || selection.normalized || "").replaceAll("-", "");
  return value
    .replaceAll("{{damageType}}", normalized)
    .replaceAll("{damageType}", normalized)
    .replaceAll("{{type}}", normalized)
    .replaceAll("{type}", normalized)
    .replaceAll("@damageType", normalized)
    .replaceAll("@type", normalized)
    .replaceAll("{{label}}", text)
    .replaceAll("{label}", text);
}

function keyNeedsSelection(key) {
  const normalized = normalize(key);
  return normalized.includes("resistance")
    || normalized.includes("traits-dr")
    || normalized.includes("damage-type")
    || normalized.includes("damage-parts")
    || normalized.includes("damage-base-types");
}

function replaceVariableData(value, selection, key = "") {
  if (!selection) return value;
  if (Array.isArray(value)) return value.map(child => replaceVariableData(child, selection, key));
  if (value && typeof value === "object") {
    const output = clone(value);
    for (const [childKey, child] of Object.entries(output)) output[childKey] = replaceVariableData(child, selection, `${key}.${childKey}`);
    return output;
  }
  if (typeof value !== "string") return value;
  const substituted = substituteSelectionTokens(value, selection);
  const normalized = normalize(substituted);
  if (keyNeedsSelection(key) && VARIABLE_VALUES.has(normalized)) return selection.value;
  try {
    const parsed = JSON.parse(substituted);
    const replaced = replaceVariableData(parsed, selection, key);
    return JSON.stringify(replaced);
  } catch (_error) {
    return substituted;
  }
}

function pairSearchText(pair) {
  return normalize(`${pair.effect?.name ?? ""} ${pair.effect?.description ?? ""} ${JSON.stringify(effectChanges(pair.effect))}`);
}

function pairMatchesSelection(pair, selection) {
  if (!selection?.normalized) return false;
  const text = pairSearchText(pair);
  const candidates = [selection.normalized, normalize(selection.value), normalize(selection.label)].filter(Boolean);
  return candidates.some(candidate => text.includes(candidate) || candidate.includes(normalize(pair.effect?.name)));
}

function selectionFromPair(pair) {
  const text = pairSearchText(pair);
  for (const option of new Map([...damageTypeOptions()].map(([, value]) => [value.key, value])).values()) {
    if (text.includes(normalize(option.key)) || text.includes(normalize(option.label))) {
      return selectionFromText(option.label, { value: option.key, kind: "damageType" });
    }
  }
  return null;
}

function effectHasUnresolvedChoice(effect) {
  return effectChanges(effect).some(change => {
    if (!keyNeedsSelection(change?.key)) return false;
    const value = change?.value;
    if (typeof value !== "string") return false;
    const normalized = normalize(value);
    if (VARIABLE_VALUES.has(normalized)) return true;
    try {
      const parsed = JSON.parse(value);
      const flattened = JSON.stringify(parsed).toLowerCase();
      return [...VARIABLE_VALUES].filter(Boolean).some(candidate => flattened.includes(`"${candidate}"`));
    } catch (_error) {
      return false;
    }
  });
}

async function chooseProfilePair(blueprintData, activity, {
  requestedBonus = null,
  blueprintDocument = null,
  partyLevel = null,
  allowedRarities = null,
  maxBonus = null,
  forcedSelection = null
} = {}) {
  let pairs = profilePairs(blueprintData, activity)
    .filter(pair => pairAvailableAtLevel(pair, partyLevel))
    .filter(pair => pairAllowedByProgression(pair, { allowedRarities, maxBonus }));
  if (!pairs.length) return { pair: null, tableResult: null, reason: "noAvailableProfiles" };

  const numericBonus = Number(requestedBonus);
  if (Number.isFinite(numericBonus) && numericBonus > 0) {
    const matches = pairs.filter(pair => effectBonus(pair.effect) === numericBonus);
    if (!matches.length) return { pair: null, tableResult: null, reason: "noMatchingBonusProfile" };
    pairs = matches;
  }

  const tableResult = forcedSelection
    ? selectionFromText(forcedSelection.text ?? forcedSelection.label ?? forcedSelection.value ?? forcedSelection, forcedSelection)
    : isArmorOfResistanceBlueprint(blueprintData)
      ? directResistanceSelection()
      : await rollLinkedTable(blueprintData, blueprintDocument);
  if (tableResult?.normalized) {
    const matched = pairs.find(pair => pairMatchesSelection(pair, tableResult));
    if (matched) return { pair: matched, tableResult, reason: "tableProfile" };
  }

  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  const inferredSelection = tableResult ?? selectionFromPair(pair);
  return {
    pair,
    tableResult: inferredSelection,
    reason: tableResult ? "tableAppliedToProfile" : inferredSelection ? "profileSelection" : "randomProfile"
  };
}

function freshId() {
  return foundry.utils.randomID(16);
}

function remapReferencedIds(value, idMap) {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(child => remapReferencedIds(child, idMap));
  for (const [key, child] of Object.entries(value)) value[key] = remapReferencedIds(child, idMap);
  return value;
}

function cloneRiderActivities(resultData, blueprintData, riderIds, idMap = new Map()) {
  if (!riderIds?.length) return [];
  const activities = foundry.utils.getProperty(blueprintData, "system.activities") ?? {};
  const output = foundry.utils.getProperty(resultData, "system.activities") ?? {};
  const copied = [];
  for (const sourceId of riderIds) {
    const source = activities[sourceId] ?? valuesOf(activities).find(activity => String(activity?._id) === String(sourceId));
    if (!source) continue;
    const rider = remapReferencedIds(clone(source), idMap);
    const id = freshId();
    rider._id = id;
    output[id] = rider;
    copied.push({ sourceId, id, kind: "activity" });
  }
  foundry.utils.setProperty(resultData, "system.activities", output);
  return copied;
}

function cloneRiderEffects(resultData, blueprintData, riderIds) {
  const idMap = new Map();
  if (!riderIds?.length) return { copied: [], idMap };
  resultData.effects ??= [];
  const sources = effectDataList(blueprintData);
  const copied = [];
  for (const sourceId of riderIds) {
    const source = sources.find(effect => String(effect?._id) === String(sourceId));
    if (!source) continue;
    const rider = clone(source);
    const id = freshId();
    idMap.set(String(sourceId), id);
    rider._id = id;
    rider.origin = null;
    resultData.effects.push(rider);
    copied.push({ sourceId, id, kind: "effect" });
  }
  return { copied, idMap };
}

function activityUuid(blueprintDocument, activityId) {
  try {
    const activity = blueprintDocument?.system?.activities?.get?.(activityId);
    if (activity?.uuid) return activity.uuid;
  } catch (_error) { /* Use deterministic fallback. */ }
  return `${blueprintDocument?.uuid ?? "Item.temporary"}.Activity.${activityId}`;
}

function isResistanceBlueprint(blueprintData) {
  const identity = normalize(`${blueprintData?.name ?? ""} ${foundry.utils.getProperty(blueprintData, "system.identifier") ?? ""}`);
  return identity.includes("resistance") || identity.includes("resistencia");
}

function isArmorOfResistanceBlueprint(blueprintData) {
  const identity = normalize(`${blueprintData?.name ?? ""} ${foundry.utils.getProperty(blueprintData, "system.identifier") ?? ""}`);
  return identity.includes("armor-of-resistance") || identity.includes("armadura-de-resistencia");
}

function resolvedArmorResistanceDescription(blueprintData, selection) {
  if (!selection || selection.kind !== "damageType" || !isArmorOfResistanceBlueprint(blueprintData)) return "";
  const label = String(selection.label || selection.text || selection.value || "").trim();
  if (!label) return "";
  return `<p>While you wear this armor, you have Resistance to ${label} damage.</p>`;
}

/** Resolve the description mutation stored inside an Enchantment Effect.
 * D&D5e Armor of Resistance documents append their generic table text through
 * a system.description.value change. Updating only ActiveEffect.description
 * leaves that table on the generated Item, so both locations must be resolved. */
function resolveBlueprintDescriptionChanges(effect, blueprintData, selection) {
  const output = clone(effect);
  const specificResistanceDescription = resolvedArmorResistanceDescription(blueprintData, selection);
  const resolved = Boolean(selection);
  const changes = effectChanges(output).map(sourceChange => {
    const change = clone(sourceChange);
    const key = String(change?.key ?? "");
    if (!["system.description", "system.description.value", "system.description.chat"].includes(key)) return change;
    if (specificResistanceDescription && key !== "system.description.chat") {
      change.value = specificResistanceDescription;
      return change;
    }
    if (typeof change.value === "string") {
      change.value = cleanResolvedBlueprintDescription(change.value, { resolved });
    }
    return change;
  });
  setEffectChanges(output, changes);
  output.description = specificResistanceDescription || cleanResolvedBlueprintDescription(output.description, { resolved });
  return output;
}

export function isMeaningfullyMaterializedData(documentOrData, { bonus = null } = {}) {
  const data = asData(documentOrData);
  const expected = Number(bonus);
  if (!Number.isFinite(expected) || expected <= 0) return true;
  const name = String(data.name ?? "");
  const weaponBonus = Number(foundry.utils.getProperty(data, "system.magicalBonus") ?? 0);
  const armorBonus = Number(foundry.utils.getProperty(data, "system.armor.magicalBonus") ?? 0);
  const properties = new Set(propertyValues(data).map(normalize));
  const rarity = normalizeRarity(foundry.utils.getProperty(data, "system.rarity"));
  return name.includes(`+${expected}`)
    && Math.max(weaponBonus, armorBonus) === expected
    && rarity !== "none"
    && (properties.has("mgc") || properties.has("magical"));
}

function ensureResolvedSelectionName(effect, blueprintData, selection) {
  if (!selection || selection.kind !== "damageType" || !isResistanceBlueprint(blueprintData)) return effect;
  const output = clone(effect);
  const changes = effectChanges(output).map(change => clone(change));
  const label = String(selection.label || selection.text || "").trim();
  const nameChange = changes.find(change => String(change?.key) === "name");
  if (nameChange) {
    const raw = String(nameChange.value ?? "");
    if (!normalize(raw).includes(normalize(label))) {
      if (/potion of resistance/i.test(raw)) {
        nameChange.value = raw.replace(/potion of resistance/i, `Potion of ${label} Resistance`);
      } else if (/armor of resistance/i.test(raw)) {
        // The source blueprint name is not a valid concrete target name. Keep
        // the base placeholder so a Plate Armor becomes Plate Armor of Fire
        // Resistance instead of losing or duplicating its identity.
        nameChange.value = `{} of ${label} Resistance`;
      } else if (/of resistance/i.test(raw)) {
        nameChange.value = raw.replace(/of resistance/i, `of ${label} Resistance`);
      } else if (/\{(?:item|base)?\}|\{\}/i.test(raw)) {
        nameChange.value = `${raw} of ${label} Resistance`;
      } else {
        nameChange.value = `{} of ${label} Resistance`;
      }
    }
  } else {
    changes.push({ key: "name", mode: globalThis.CONST?.ACTIVE_EFFECT_MODES?.OVERRIDE ?? 5, value: `{} of ${label} Resistance`, priority: 20 });
  }
  setEffectChanges(output, changes);
  return output;
}

function applyTableSelectionToEffect(effect, tableResult, blueprintData = null) {
  if (!tableResult) return effect;
  let output = clone(effect);
  output.name = substituteSelectionTokens(output.name, tableResult);
  if (typeof output.description === "string") output.description = substituteSelectionTokens(output.description, tableResult);
  const changes = effectChanges(output).map(change => {
    const next = clone(change);
    next.value = replaceVariableData(next.value, tableResult, next.key);
    return next;
  });
  setEffectChanges(output, changes);
  output = ensureResolvedSelectionName(output, blueprintData, tableResult);
  return output;
}

function displayFromEffect(data, effect) {
  const display = {
    name: data.name,
    img: data.img,
    type: data.type,
    subtype: foundry.utils.getProperty(data, "system.type.value"),
    rarity: foundry.utils.getProperty(data, "system.rarity"),
    magicalBonus: Number(foundry.utils.getProperty(data, "system.magicalBonus") ?? 0),
    priceValue: Number(foundry.utils.getProperty(data, "system.price.value") ?? 0),
    priceDenomination: foundry.utils.getProperty(data, "system.price.denomination") ?? "gp"
  };
  for (const change of effectChanges(effect)) {
    const key = String(change?.key ?? "");
    const value = change?.value;
    if (key === "name" && typeof value === "string") {
      display.name = value.includes("{}") ? value.replaceAll("{}", display.name ?? "") : value;
    } else if (key === "img" && value) display.img = value;
    else if (key === "system.rarity" && value) display.rarity = value;
    else if (key === "system.magicalBonus") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) display.magicalBonus = Math.max(display.magicalBonus, numeric);
    } else if (key === "system.type.value" && value) display.subtype = value;
    else if (key === "system.price.value") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) display.priceValue = numeric;
    } else if (key === "system.price.denomination" && value) display.priceDenomination = value;
  }
  return display;
}

function validateResolvedBlueprintContract({ blueprintData, baseData, resultData, effect, selection, activity }) {
  if (!canMaterializeOnto(blueprintData, baseData, activity)) return { ok: false, reason: "incompatibleTarget" };
  if (!isArmorOfResistanceBlueprint(blueprintData)) return { ok: true };

  const selectedType = normalize(selection?.value ?? selection?.label ?? "");
  if (selection?.kind !== "damageType" || !DIRECT_RESISTANCE_TYPES.includes(selectedType)) {
    return { ok: false, reason: "unresolvedResistanceType" };
  }

  const resolvedName = normalize(resultData?.name);
  if (!resolvedName.includes("resistance") || !resolvedName.includes(selectedType)) {
    return { ok: false, reason: "unresolvedResistanceName" };
  }

  const resistanceChanges = effectChanges(effect).filter(change => keyNeedsSelection(change?.key));
  if (!resistanceChanges.length) return { ok: false, reason: "missingResistanceEffect" };
  const serializedResistance = JSON.stringify(resistanceChanges).toLowerCase();
  if (!serializedResistance.includes(selectedType)) return { ok: false, reason: "missingResistanceEffect" };
  const conflictingType = DIRECT_RESISTANCE_TYPES.find(type => type !== selectedType && serializedResistance.includes(type));
  if (conflictingType) return { ok: false, reason: "conflictingResistanceEffect" };

  const serializedEffect = JSON.stringify(effect ?? {}).toLowerCase();
  if (/rolltable|roll table|following table|choose (?:a |the )?(?:damage )?type|1d10/.test(serializedEffect)) {
    return { ok: false, reason: "genericResistanceInstructionsRemain" };
  }
  if (effectHasUnresolvedChoice(effect)) return { ok: false, reason: "unresolvedChoice" };
  return { ok: true };
}

function validateAndPrepareData(data, effect = null) {
  const fallback = displayFromEffect(data, effect);
  try {
    const ItemClass = globalThis.CONFIG?.Item?.documentClass;
    if (!ItemClass) return { ok: true, display: fallback, validation: "unavailable" };
    const temporary = new ItemClass(clone(data), { parent: null, pack: null, strict: true });
    temporary.prepareData?.();
    const validationResult = temporary.validate?.({ strict: true });
    if (validationResult === false) throw new Error("Temporary Item failed strict validation.");
    const serialized = temporary.toObject?.();
    if (!serialized) throw new Error("Temporary Item could not be serialized.");
    return {
      ok: true,
      validation: "temporary-item",
      display: {
        name: temporary.name && temporary.name !== data.name ? temporary.name : fallback.name,
        img: temporary.img && temporary.img !== data.img ? temporary.img : fallback.img,
        type: temporary.type ?? fallback.type,
        subtype: temporary.system?.type?.value ?? fallback.subtype,
        rarity: temporary.system?.rarity ?? fallback.rarity,
        magicalBonus: Math.max(Number(temporary.system?.magicalBonus ?? 0), Number(fallback.magicalBonus ?? 0)),
        priceValue: Math.max(Number(temporary.system?.price?.value ?? 0), Number(fallback.priceValue ?? 0)),
        priceDenomination: temporary.system?.price?.denomination ?? fallback.priceDenomination
      }
    };
  } catch (error) {
    console.warn("HAMMER Materialization Core | Temporary Item validation failed", error);
    return { ok: false, reason: "validationFailed", error, display: fallback };
  }
}

function addCoreFlags(data, metadata) {
  data.flags ??= {};
  data.flags[CORE_FLAG] = { materialized: true, ...metadata };
}

function shuffle(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

export function inspectBlueprintSupport(documentOrData) {
  const data = asData(documentOrData);
  const activities = enchantActivities(data);
  const effects = enchantmentEffects(data);
  const profileCount = activities.reduce((count, activity) => count + profilePairs(data, activity).length, 0);
  const itemRiderCount = activities.reduce((count, activity) => count + valuesOf(activity?.effects).reduce((inner, profile) => inner + stringList(profile?.riders?.item).length, 0), 0);
  const recipe = materializationRecipe(data);
  const nativeSupported = activities.length > 0 && effects.length > 0 && profileCount > 0 && itemRiderCount === 0;
  return {
    candidate: activities.length > 0 || Boolean(recipe),
    supported: nativeSupported || Boolean(recipe),
    nativeSupported,
    recipeSupported: Boolean(recipe),
    recipeId: recipe?.id ?? "",
    activityCount: activities.length,
    effectCount: effects.length,
    profileCount,
    itemRiderCount,
    reason: nativeSupported ? "supported" : recipe ? "supportedRecipeFallback" : !activities.length ? "notBlueprint" : !effects.length ? "missingEnchantmentEffects" : !profileCount ? "missingProfiles" : itemRiderCount ? "hasItemRiders" : "unsupported"
  };
}

export async function materializeNativeBlueprint({
  blueprintDocument,
  baseDocument,
  requestedBonus = null,
  partyLevel = null,
  allowedRarities = null,
  maxBonus = null,
  selection = null
}) {
  const blueprintData = asData(blueprintDocument);
  const baseData = asData(baseDocument);
  const activities = shuffle(enchantActivities(blueprintData).filter(activity => canMaterializeOnto(blueprintData, baseData, activity)));
  if (!activities.length || !hasNativeBlueprintData(blueprintData)) {
    if (hasMaterializationRecipe(blueprintData)
      && recipeTargetCompatibility(blueprintData, baseData, blueprintData) !== false) {
      const recipe = await materializeRecipe({
        sourceDocument: blueprintDocument,
        baseDocument,
        requestedBonus,
        maxBonus,
        selection
      });
      if (recipe.ok) return recipe;
      return { ok: false, reason: recipe.reason ?? "recipeFailed", failures: ["unsupportedNativeBlueprint", recipe.reason ?? "recipeFailed"] };
    }
    return { ok: false, reason: "unsupportedBlueprint" };
  }

  const failures = [];
  for (const activity of activities) {
    const chosen = await chooseProfilePair(blueprintData, activity, {
      requestedBonus,
      blueprintDocument,
      partyLevel,
      allowedRarities,
      maxBonus,
      forcedSelection: selection
    });
    const pair = chosen.pair;
    const tableResult = chosen.tableResult;
    if (!pair?.effect) {
      failures.push(chosen.reason || "noProfile");
      continue;
    }

    const result = clone(baseData);
    delete result._id;
    result.effects = Array.isArray(result.effects) ? result.effects : valuesOf(result.effects);

    const riders = pair.profile?.riders ?? pair.effect?.flags?.dnd5e?.enchantment?.riders ?? {};
    const itemRiders = stringList(riders.item);
    if (itemRiders.length) {
      failures.push("unsupportedItemRiders");
      continue;
    }
    const riderEffects = cloneRiderEffects(result, blueprintData, stringList(riders.effect));
    const copiedRiders = [
      ...riderEffects.copied,
      ...cloneRiderActivities(result, blueprintData, stringList(riders.activity), riderEffects.idMap)
    ];

    let enchantment = applyTableSelectionToEffect(pair.effect, tableResult, blueprintData);
    enchantment = resolveBlueprintDescriptionChanges(enchantment, blueprintData, tableResult);
    if (effectHasUnresolvedChoice(enchantment)) {
      failures.push("unresolvedChoice");
      continue;
    }
    const resolvedBonus = effectBonus(enchantment);
    const identity = materializeIdentityChanges(result, enchantment, {
      selectionLabel: tableResult?.label ?? tableResult?.text ?? ""
    });
    if (!identity.ok) {
      failures.push(identity.reason ?? "unresolvedNameMarker");
      continue;
    }
    enchantment = identity.effect;
    const sourceEffectId = String(enchantment._id ?? pair.profile?._id ?? "");
    enchantment._id = freshId();
    enchantment.type = "enchantment";
    enchantment.disabled = false;
    enchantment.origin = activityUuid(blueprintDocument, activity._id);
    enchantment.flags ??= {};
    enchantment.flags.dnd5e ??= {};
    enchantment.flags.dnd5e.enchantmentProfile = sourceEffectId;
    enchantment.flags[CORE_FLAG] = {
      blueprintUuid: blueprintDocument?.uuid ?? "",
      activityId: activity._id ?? "",
      sourceEffectId,
      tableUuid: tableResult?.uuid ?? "",
      tableResult: tableResult?.text ?? "",
      tableResultValue: tableResult?.value ?? ""
    };
    result.effects.push(enchantment);

    const contract = validateResolvedBlueprintContract({
      blueprintData,
      baseData,
      resultData: result,
      effect: enchantment,
      selection: tableResult,
      activity
    });
    if (!contract.ok) {
      failures.push(contract.reason ?? "targetContractFailed");
      continue;
    }

    const metadata = {
      kind: "blueprint",
      blueprintUuid: blueprintDocument?.uuid ?? "",
      baseUuid: baseDocument?.uuid ?? "",
      activityId: activity._id ?? "",
      sourceEffectId,
      requestedBonus: Number(requestedBonus ?? 0),
      resolvedBonus,
      tableUuid: tableResult?.uuid ?? "",
      tableResult: tableResult?.text ?? "",
      tableResultValue: tableResult?.value ?? "",
      tableResultKind: tableResult?.kind ?? "",
      profileChoiceReason: chosen.reason ?? "",
      partyLevel: Number(partyLevel ?? 0),
      riders: copiedRiders,
      strategy: "native-enchantment",
      materialized: true,
      targetContract: "validated"
    };
    addCoreFlags(result, metadata);

    const validation = validateAndPrepareData(result, enchantment);
    if (!validation.ok) {
      failures.push(validation.reason ?? "validationFailed");
      continue;
    }
    const recipeIssues = hasMaterializationRecipe(blueprintData) ? recipeOutputIssues(blueprintData, result) : [];
    if (recipeIssues.length) {
      failures.push(`recipeContract:${recipeIssues[0]}`);
      continue;
    }
    return {
      ok: true,
      documentData: result,
      display: validation.display,
      metadata: { ...metadata, validation: validation.validation }
    };
  }

  // The native D&D5e template flow is authoritative. A versioned recipe is
  // attempted only after every native activity/profile failed. This recovers
  // official families whose SRD and PHB/DMG documents encode the same Item in
  // different template structures.
  if (hasMaterializationRecipe(blueprintData)
    && recipeTargetCompatibility(blueprintData, baseData, blueprintData) !== false) {
    const recipe = await materializeWithRecipe({
      sourceDocument: blueprintDocument,
      baseDocument,
      requestedBonus,
      maxBonus,
      selection
    });
    if (recipe.ok) {
      const validation = validateAndPrepareData(recipe.documentData);
      if (validation.ok) {
        return {
          ok: true,
          documentData: recipe.documentData,
          display: validation.display,
          metadata: {
            ...(recipe.metadata ?? {}),
            validation: validation.validation,
            nativeFailures: [...failures]
          }
        };
      }
      failures.push(validation.reason ?? "recipeValidationFailed");
    } else failures.push(recipe.reason ?? "recipeFailed");
  }

  return { ok: false, reason: failures.at(-1) ?? "noProfile", failures };
}

export async function materializeRecipe(options = {}) {
  const result = await materializeWithRecipe(options);
  if (!result.ok) return result;
  const validation = validateAndPrepareData(result.documentData);
  if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error, issues: result.issues ?? [] };
  return {
    ...result,
    display: validation.display,
    metadata: { ...(result.metadata ?? {}), validation: validation.validation }
  };
}

function defaultAmmoDamage(source = null) {
  const base = clone(source?.base ?? source ?? {});
  return {
    base: {
      number: base.number ?? null,
      denomination: base.denomination ?? null,
      types: valuesOf(base.types),
      custom: { enabled: Boolean(base.custom?.enabled), formula: String(base.custom?.formula ?? "") },
      scaling: { number: Number(base.scaling?.number ?? 1) || 1 }
    },
    replace: Boolean(source?.replace)
  };
}

function normalizeAmmunitionBaseData(data) {
  if (!isAmmunitionData(data) || data.type === "consumable") return data;
  const original = clone(data.system ?? {});
  const typeSource = original.type ?? {};
  data.type = "consumable";
  data.system = {
    activities: clone(original.activities ?? {}),
    uses: {
      spent: Number(original.uses?.spent ?? 0) || 0,
      recovery: clone(original.uses?.recovery ?? []),
      autoDestroy: Boolean(original.uses?.autoDestroy),
      max: String(original.uses?.max ?? "")
    },
    description: clone(original.description ?? { value: "", chat: "" }),
    identifier: String(original.identifier ?? ""),
    source: clone(original.source ?? {}),
    identified: original.identified !== false,
    unidentified: clone(original.unidentified ?? { description: "" }),
    container: original.container ?? null,
    quantity: Math.max(1, Number(original.quantity ?? 1) || 1),
    weight: clone(original.weight ?? { value: 0, units: "lb" }),
    price: clone(original.price ?? { value: 0, denomination: "gp" }),
    rarity: String(original.rarity ?? ""),
    attunement: String(original.attunement ?? ""),
    attuned: Boolean(original.attuned),
    equipped: Boolean(original.equipped),
    damage: defaultAmmoDamage(original.damage),
    magicalBonus: String(original.magicalBonus ?? ""),
    properties: clone(original.properties ?? []),
    type: {
      value: "ammo",
      subtype: String(typeSource.subtype ?? original.ammunition?.type ?? "")
    }
  };
  return data;
}

export function materializeSyntheticEnhancement({ baseDocument, bonus, qualityPriceAdditions = {} }) {
  const result = normalizeAmmunitionBaseData(asData(baseDocument));
  delete result._id;
  const numericBonus = Math.max(0, Math.min(3, Math.floor(Number(bonus ?? 0))));
  if (!numericBonus) {
    const metadata = { kind: "sellable", family: "", baseUuid: baseDocument?.uuid ?? "", bonus: 0, strategy: "base-copy", materialized: false };
    const validation = validateAndPrepareData(result);
    if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error };
    return { ok: true, documentData: result, display: validation.display, metadata: { ...metadata, validation: validation.validation } };
  }

  const cleanName = String(result.name ?? "").replace(/\s+\+[123]\s*$/, "");
  const resolvedName = canonicalizeItemName(`${cleanName} +${numericBonus}`, { baseName: cleanName });
  if (!resolvedName.ok) return { ok: false, reason: resolvedName.reason };
  result.name = resolvedName.name;
  if (result.type === "equipment" && foundry.utils.hasProperty(result, "system.armor")) {
    foundry.utils.setProperty(result, "system.armor.magicalBonus", String(numericBonus));
  } else {
    foundry.utils.setProperty(result, "system.magicalBonus", String(numericBonus));
  }
  foundry.utils.setProperty(result, "system.rarity", ENCHANTMENT_RARITY[numericBonus] ?? "uncommon");

  const properties = foundry.utils.getProperty(result, "system.properties");
  if (Array.isArray(properties) && !properties.includes("mgc")) properties.push("mgc");
  else if (properties instanceof Set) properties.add("mgc");
  else if (properties && typeof properties === "object") properties.mgc = true;
  else foundry.utils.setProperty(result, "system.properties", ["mgc"]);

  const currentPrice = Math.max(0, Number(foundry.utils.getProperty(result, "system.price.value") ?? 0));
  const addition = Math.max(0, Number(qualityPriceAdditions?.[numericBonus] ?? 0));
  foundry.utils.setProperty(result, "system.price", {
    value: Math.max(1, currentPrice + addition),
    denomination: foundry.utils.getProperty(result, "system.price.denomination") ?? "gp"
  });
  const metadata = {
    kind: "generator",
    family: "enhancement",
    baseUuid: baseDocument?.uuid ?? "",
    bonus: numericBonus,
    strategy: "synthetic"
  };
  addCoreFlags(result, metadata);
  const validation = validateAndPrepareData(result);
  if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error };
  if (!isMeaningfullyMaterializedData(result, { bonus: numericBonus })) {
    return { ok: false, reason: "incompleteSyntheticEnhancement" };
  }
  return { ok: true, documentData: result, display: validation.display, metadata: { ...metadata, materialized: true, validation: validation.validation } };
}

export async function materializeEnhancement({
  templateDocument = null,
  baseDocument,
  bonus,
  qualityPriceAdditions = {},
  partyLevel = null,
  allowedRarities = null,
  maxBonus = null
}) {
  if (templateDocument) {
    const native = await materializeNativeBlueprint({
      blueprintDocument: templateDocument,
      baseDocument,
      requestedBonus: bonus,
      partyLevel,
      allowedRarities,
      maxBonus
    });
    if (native.ok) {
      native.metadata.kind = "generator";
      native.metadata.family = "enhancement";
      native.metadata.bonus = Number(bonus ?? 0);
      native.metadata.strategy = "native-enchantment";
      foundry.utils.setProperty(native.documentData, `flags.${CORE_FLAG}`, native.metadata);
      return native;
    }
  }
  return materializeSyntheticEnhancement({ baseDocument, bonus, qualityPriceAdditions });
}

/**
 * Shared headless contract used by manual Item creation and Supplier. The Core
 * never creates a World document; callers decide whether to preview, validate,
 * or persist the returned itemData.
 */
export async function materialize({
  source,
  baseItem = null,
  selections = {},
  progression = {},
  mode = "automatic",
  createDocument = false
} = {}) {
  if (createDocument) {
    return {
      ok: false,
      reason: "headlessCoreDoesNotCreateDocuments",
      itemData: null,
      diagnostic: { mode, coreVersion: MATERIALIZATION_ENGINE_VERSION }
    };
  }
  if (!source) return { ok: false, reason: "missingSource", itemData: null, diagnostic: { mode } };

  const nature = classifyDocumentNature(source, { generator: selections.generator ?? null });
  let result;
  if (selections.variantDocument) {
    const itemData = asData(selections.variantDocument);
    delete itemData._id;
    const canonical = canonicalizeItemName(itemData.name, { fallbackName: itemData.name });
    if (!canonical.ok) return { ok: false, reason: canonical.reason, itemData: null, diagnostic: { mode, nature } };
    itemData.name = canonical.name;
    const validation = validateAndPrepareData(itemData);
    result = validation.ok
      ? { ok: true, documentData: itemData, display: validation.display, metadata: { kind: "variant", strategy: "concrete-variant", validation: validation.validation } }
      : { ok: false, reason: validation.reason, error: validation.error };
  } else if (nature.materializerKind === "blueprint") {
    if (!baseItem) return { ok: false, reason: "missingBaseItem", itemData: null, diagnostic: { mode, nature } };
    result = await materializeNativeBlueprint({
      blueprintDocument: source,
      baseDocument: baseItem,
      requestedBonus: selections.bonus ?? null,
      selection: selections.tableResult ?? selections.selection ?? null,
      partyLevel: progression.partyLevel ?? progression.level ?? null,
      allowedRarities: progression.allowedRarities ?? null,
      maxBonus: progression.maxBonus ?? null
    });
  } else if (nature.materializerKind === "generator" || selections.generator) {
    if (!baseItem) return { ok: false, reason: "missingBaseItem", itemData: null, diagnostic: { mode, nature } };
    result = await materializeEnhancement({
      templateDocument: source,
      baseDocument: baseItem,
      bonus: selections.bonus ?? progression.bonus ?? 0,
      qualityPriceAdditions: progression.qualityPriceAdditions ?? {},
      partyLevel: progression.partyLevel ?? progression.level ?? null,
      allowedRarities: progression.allowedRarities ?? null,
      maxBonus: progression.maxBonus ?? null
    });
  } else {
    const itemData = asData(source);
    delete itemData._id;
    const canonical = canonicalizeItemName(itemData.name, { fallbackName: itemData.name });
    if (!canonical.ok) return { ok: false, reason: canonical.reason, itemData: null, diagnostic: { mode, nature } };
    itemData.name = canonical.name;
    const validation = validateAndPrepareData(itemData);
    result = validation.ok
      ? { ok: true, documentData: itemData, display: validation.display, metadata: { kind: "sellable", strategy: "copy", validation: validation.validation } }
      : { ok: false, reason: validation.reason, error: validation.error };
  }

  return {
    ok: result.ok === true,
    reason: result.reason ?? "",
    itemData: result.documentData ?? null,
    display: result.display ?? null,
    diagnostic: {
      coreVersion: MATERIALIZATION_ENGINE_VERSION,
      mode,
      nature,
      metadata: result.metadata ?? {},
      failures: result.failures ?? [],
      error: result.error?.message ?? ""
    }
  };
}

export {
  MATERIALIZATION_RECIPE_REGISTRY,
  MATERIALIZATION_RECIPE_SCHEMA_VERSION,
  canonicalizeItemName,
  hasMaterializationRecipe,
  isAmmunitionData,
  isSelfContainedSellableData,
  knownBaseCompatibility,
  materializationRecipe,
  recipeOutputIssues,
  recipeTargetCompatibility
};

export const MaterializationCore = Object.freeze({
  version: MATERIALIZATION_ENGINE_VERSION,
  classifyDocumentNature,
  isBlueprintCandidateData,
  isSelfContainedSellableData,
  inspectBlueprintSupport,
  canMaterializeOnto,
  knownBaseCompatibility,
  canonicalizeItemName,
  materialize,
  materializeNativeBlueprint,
  materializeRecipe,
  materializeEnhancement,
  materializeSyntheticEnhancement,
  isMeaningfullyMaterializedData,
  hasMaterializationRecipe,
  materializationRecipe,
  recipeTargetCompatibility,
  recipeOutputIssues,
  recipes: MATERIALIZATION_RECIPE_REGISTRY,
  recipeSchemaVersion: MATERIALIZATION_RECIPE_SCHEMA_VERSION
});
